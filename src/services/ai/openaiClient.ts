import { promises as dns } from "node:dns";

export type AiChatRole = "system" | "user" | "assistant";

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface ChatCompletionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  jsonMode?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  requestId: string | null;
}

export class AiProviderError extends Error {
  status: number | null;
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, status: number | null = null, retryable = false) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80") || normalized.startsWith("ff")) return true;
  return isPrivateIpv4(normalized);
}

function isDevelopment(): boolean {
  return (process.env.NODE_ENV ?? "development") !== "production";
}

const DNS_CACHE_MS = 5 * 60 * 1000;
const dnsCache = new Map<string, { at: number; addresses: Array<{ address: string }> }>();

/** Blocks localhost/private destinations to reduce SSRF risk on a tenant-supplied URL. */
export async function assertSafeProviderUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AiProviderError("AI_URL_INVALID", "AI provider URL is not valid", 400);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const dev = isDevelopment();

  if (url.protocol !== "https:" && !(dev && url.protocol === "http:")) {
    throw new AiProviderError("AI_URL_INSECURE", "AI provider URL must use HTTPS", 400);
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "0.0.0.0"
  ) {
    if (!dev) throw new AiProviderError("AI_URL_BLOCKED", "AI provider URL is not allowed", 400);
  }

  // Hostnames are authoritative here (tenants can't repoint DNS at our DB);
  // a short TTL keeps the hot reply path free of a lookup per message.
  const cached = dnsCache.get(host);
  const now = Date.now();
  let addresses: Array<{ address: string }>;
  if (cached && now - cached.at < DNS_CACHE_MS) {
    addresses = cached.addresses;
  } else {
    addresses = await dns.lookup(host, { all: true }).catch(() => []);
    if (addresses.length > 0) {
      if (dnsCache.size > 200) dnsCache.clear();
      dnsCache.set(host, { at: now, addresses });
    }
  }
  if (addresses.length === 0) {
    throw new AiProviderError("AI_URL_UNRESOLVED", "Unable to resolve the AI provider host", 400);
  }
  for (const entry of addresses) {
    if (isPrivateIp(entry.address) && !(dev && (host === "localhost" || host.endsWith(".localhost")))) {
      throw new AiProviderError("AI_URL_PRIVATE", "AI provider URL resolves to a private address", 400);
    }
  }
  return url;
}

export function normalizeChatCompletionsUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) {
    url.pathname = path;
  } else {
    url.pathname = `${path}/chat/completions`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isOfficialOpenAi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

function providerErrorMessage(status: number, raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string; type?: string } };
    return (parsed.error?.message ?? raw).slice(0, 800);
  } catch {
    return raw.slice(0, 800) || `AI provider returned HTTP ${status}`;
  }
}

function readContent(payload: unknown): string | null {
  const data = payload as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }>; refusal?: string | null };
      text?: string;
    }>;
  };
  const choice = data.choices?.[0];
  if (!choice) return null;
  const content = choice.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.map((part) => part?.text ?? "").join("");
    return text || null;
  }
  if (typeof choice.message?.refusal === "string") return choice.message.refusal;
  if (typeof choice.text === "string") return choice.text;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls an OpenAI-compatible /chat/completions endpoint using fetch.
 * Retries only transient failures (429/5xx/network); never logs the key.
 */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  if (!opts.apiKey.trim()) {
    throw new AiProviderError("AI_API_KEY_MISSING", "AI API key is not configured", 400);
  }
  if (!opts.model.trim()) {
    throw new AiProviderError("AI_MODEL_MISSING", "AI model is not configured", 400);
  }
  await assertSafeProviderUrl(opts.baseUrl);
  const url = normalizeChatCompletionsUrl(opts.baseUrl);
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 20000, 3000), 60000);
  const maxRetries = Math.min(Math.max(opts.maxRetries ?? 1, 0), 3);
  const jsonMode = opts.jsonMode ?? isOfficialOpenAi(opts.baseUrl);
  const started = Date.now();

  let useMaxCompletionTokens = false;
  let includeTemperature = true;
  let lastError: AiProviderError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: opts.messages,
        stream: false,
      };
      if (useMaxCompletionTokens) body.max_completion_tokens = opts.maxTokens ?? 600;
      else body.max_tokens = opts.maxTokens ?? 600;
      if (includeTemperature && opts.temperature !== undefined) body.temperature = opts.temperature;
      if (jsonMode) body.response_format = { type: "json_object" };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const raw = await res.text();
      if (!res.ok) {
        const message = providerErrorMessage(res.status, raw);
        if (res.status === 400 && /max_tokens/i.test(message) && !useMaxCompletionTokens) {
          useMaxCompletionTokens = true;
          lastError = new AiProviderError("AI_BAD_REQUEST", message, 400, false);
          continue;
        }
        if (res.status === 400 && /temperature/i.test(message) && includeTemperature) {
          includeTemperature = false;
          lastError = new AiProviderError("AI_BAD_REQUEST", message, 400, false);
          continue;
        }
        const retryable = res.status === 429 || res.status >= 500;
        throw new AiProviderError(
          res.status === 401 || res.status === 403 ? "AI_AUTH_FAILED" : "AI_PROVIDER_ERROR",
          message,
          res.status,
          retryable,
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new AiProviderError("AI_BAD_RESPONSE", "AI provider returned invalid JSON", res.status, true);
      }
      const content = readContent(payload);
      if (!content || !content.trim()) {
        throw new AiProviderError("AI_EMPTY_RESPONSE", "AI provider returned an empty response", res.status, true);
      }
      const usage = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      return {
        content,
        model: (payload as { model?: string }).model ?? opts.model,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        latencyMs: Date.now() - started,
        requestId: res.headers.get("x-request-id"),
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof AiProviderError) {
        lastError = err;
        if (!err.retryable || attempt >= maxRetries) throw err;
      } else if (err instanceof Error && err.name === "AbortError") {
        lastError = new AiProviderError("AI_TIMEOUT", `AI request timed out after ${timeoutMs}ms`, null, true);
        if (attempt >= maxRetries) throw lastError;
      } else {
        const message = err instanceof Error ? err.message : "AI request failed";
        lastError = new AiProviderError("AI_NETWORK_ERROR", message, null, true);
        if (attempt >= maxRetries) throw lastError;
      }
      await sleep(500 * (attempt + 1));
    }
  }

  throw lastError ?? new AiProviderError("AI_PROVIDER_ERROR", "AI request failed", null, false);
}
