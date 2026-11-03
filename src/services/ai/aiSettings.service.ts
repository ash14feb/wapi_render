import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { decryptToken, encryptToken } from "../../utils/crypto";
import { discountPolicySchema, salesPlaybookSchema, type AiPlaygroundInput, type AiTestInput, type UpdateAiSettingsInput } from "../../validators/ai.validator";
import { loadActiveKnowledge, loadActiveOffers, loadBusinessName } from "./aiContext.service";
import { AiProviderError, chatCompletion, isOfficialOpenAi } from "./openaiClient";
import {
  buildSystemPrompt,
  evaluateDiscountPolicy,
  parseAiReply,
  parseJsonObject,
} from "./promptBuilder";
import type { AiDiscountPolicy, AiRuntimeConfig, AiSalesPlaybook } from "./types";

export class AiServiceError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AiServiceError";
    this.code = code;
    this.status = status;
  }
}

export interface AiSettingsDto {
  id: string | null;
  enabled: boolean;
  providerBaseUrl: string;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs: number;
  maxRetries: number;
  historyWindow: number;
  systemPrompt: string;
  businessInfo: string | null;
  language: string;
  tone: string;
  humanLike: boolean;
  replyDelayMs: number;
  salesPlaybook: AiSalesPlaybook | null;
  discountPolicy: AiDiscountPolicy | null;
  handoffEnabled: boolean;
  handoffInstructions: string | null;
  fallbackMessage: string | null;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  updatedAt: string | null;
}

const DEFAULTS: Omit<AiSettingsDto, "id" | "updatedAt" | "lastTestAt" | "lastTestStatus"> = {
  enabled: false,
  providerBaseUrl: "https://api.openai.com/v1",
  hasApiKey: false,
  apiKeyLast4: null,
  model: "gpt-4o-mini",
  temperature: 0.7,
  maxTokens: 600,
  requestTimeoutMs: 20000,
  maxRetries: 1,
  historyWindow: 12,
  systemPrompt: "",
  businessInfo: null,
  language: "auto",
  tone: "friendly",
  humanLike: true,
  replyDelayMs: 0,
  salesPlaybook: null,
  discountPolicy: null,
  handoffEnabled: true,
  handoffInstructions: null,
  fallbackMessage: "Thanks for your message. A team member will follow up with you shortly.",
};

function parsePlaybook(raw: string | null): AiSalesPlaybook | null {
  const parsed = parseJsonObject<unknown>(raw);
  if (!parsed) return null;
  const result = salesPlaybookSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function parseDiscountPolicy(raw: string | null): AiDiscountPolicy | null {
  const parsed = parseJsonObject<unknown>(raw);
  if (!parsed) return null;
  const result = discountPolicySchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function toDto(row: {
  id: string;
  enabled: boolean;
  providerBaseUrl: string;
  encryptedApiKey: string | null;
  apiKeyLast4: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs: number;
  maxRetries: number;
  historyWindow: number;
  systemPrompt: string;
  businessInfo: string | null;
  language: string;
  tone: string;
  humanLike: boolean;
  replyDelayMs: number;
  salesPlaybookJson: string | null;
  discountPolicyJson: string | null;
  handoffEnabled: boolean;
  handoffInstructions: string | null;
  fallbackMessage: string | null;
  lastTestAt: Date | null;
  lastTestStatus: string | null;
  updatedAt: Date;
} | null): AiSettingsDto {
  if (!row) return { ...DEFAULTS, id: null, lastTestAt: null, lastTestStatus: null, updatedAt: null };
  return {
    id: row.id,
    enabled: row.enabled,
    providerBaseUrl: row.providerBaseUrl,
    hasApiKey: Boolean(row.encryptedApiKey),
    apiKeyLast4: row.apiKeyLast4,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    requestTimeoutMs: row.requestTimeoutMs,
    maxRetries: row.maxRetries,
    historyWindow: row.historyWindow,
    systemPrompt: row.systemPrompt,
    businessInfo: row.businessInfo,
    language: row.language,
    tone: row.tone,
    humanLike: row.humanLike,
    replyDelayMs: row.replyDelayMs,
    salesPlaybook: parsePlaybook(row.salesPlaybookJson),
    discountPolicy: parseDiscountPolicy(row.discountPolicyJson),
    handoffEnabled: row.handoffEnabled,
    handoffInstructions: row.handoffInstructions,
    fallbackMessage: row.fallbackMessage,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getAiSettings(tenantId: string): Promise<AiSettingsDto> {
  const row = await prisma.aiSetting.findUnique({ where: { tenantId } });
  return toDto(row);
}

export async function updateAiSettings(
  tenantId: string,
  userId: string,
  input: UpdateAiSettingsInput,
): Promise<AiSettingsDto> {
  const existing = await prisma.aiSetting.findUnique({ where: { tenantId } });
  const willEnable = input.enabled ?? existing?.enabled ?? false;
  const willHaveKey = input.clearApiKey ? false : Boolean(input.apiKey || existing?.encryptedApiKey);
  if (willEnable && !willHaveKey) {
    throw new AiServiceError("AI_API_KEY_REQUIRED", "Configure an AI API key before enabling the AI agent");
  }
  if (input.clearApiKey && willEnable) {
    throw new AiServiceError("AI_API_KEY_REQUIRED", "Disable the AI agent before removing its API key");
  }

  const data: Record<string, unknown> = {};
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.providerBaseUrl !== undefined) data.providerBaseUrl = input.providerBaseUrl.trim().replace(/\/+$/, "");
  if (input.model !== undefined) data.model = input.model.trim();
  if (input.temperature !== undefined) data.temperature = input.temperature;
  if (input.maxTokens !== undefined) data.maxTokens = input.maxTokens;
  if (input.requestTimeoutMs !== undefined) data.requestTimeoutMs = input.requestTimeoutMs;
  if (input.maxRetries !== undefined) data.maxRetries = input.maxRetries;
  if (input.historyWindow !== undefined) data.historyWindow = input.historyWindow;
  if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt;
  if (input.businessInfo !== undefined) data.businessInfo = input.businessInfo;
  if (input.language !== undefined) data.language = input.language;
  if (input.tone !== undefined) data.tone = input.tone;
  if (input.humanLike !== undefined) data.humanLike = input.humanLike;
  if (input.replyDelayMs !== undefined) data.replyDelayMs = input.replyDelayMs;
  if (input.handoffEnabled !== undefined) data.handoffEnabled = input.handoffEnabled;
  if (input.handoffInstructions !== undefined) data.handoffInstructions = input.handoffInstructions;
  if (input.fallbackMessage !== undefined) data.fallbackMessage = input.fallbackMessage;
  if (input.salesPlaybook !== undefined) {
    data.salesPlaybookJson = input.salesPlaybook ? JSON.stringify(input.salesPlaybook) : null;
  }
  if (input.discountPolicy !== undefined) {
    data.discountPolicyJson = input.discountPolicy ? JSON.stringify(input.discountPolicy) : null;
  }
  if (input.apiKey) {
    data.encryptedApiKey = encryptToken(input.apiKey);
    data.apiKeyLast4 = input.apiKey.slice(-4);
  }
  if (input.clearApiKey) {
    data.encryptedApiKey = null;
    data.apiKeyLast4 = null;
  }
  data.updatedBy = userId;

  const saved = await prisma.aiSetting.upsert({
    where: { tenantId },
    update: data as Prisma.AiSettingUpdateInput,
    create: {
      tenantId,
      systemPrompt: "",
      ...data,
    } as Prisma.AiSettingUncheckedCreateInput,
  });

  await prisma.auditLog
    .create({
      data: {
        tenantId,
        userId,
        action: "ai.settings.updated",
        entityType: "AiSetting",
        entityId: saved.id,
        metadataJson: JSON.stringify({
          fields: Object.keys(data),
          apiKeyChanged: Boolean(input.apiKey || input.clearApiKey),
        }),
      },
    })
    .catch(() => undefined);

  return toDto(saved);
}

export async function getRuntimeAiConfig(tenantId: string): Promise<AiRuntimeConfig | null> {
  const row = await prisma.aiSetting.findUnique({ where: { tenantId } });
  if (!row || !row.enabled || !row.encryptedApiKey || !row.model.trim()) return null;
  let apiKey: string;
  try {
    apiKey = decryptToken(row.encryptedApiKey);
  } catch {
    return null;
  }
  return {
    tenantId: row.tenantId,
    providerBaseUrl: row.providerBaseUrl,
    apiKey,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    requestTimeoutMs: row.requestTimeoutMs,
    maxRetries: row.maxRetries,
    historyWindow: row.historyWindow,
    systemPrompt: row.systemPrompt,
    businessInfo: row.businessInfo,
    language: row.language,
    tone: row.tone,
    humanLike: row.humanLike,
    replyDelayMs: row.replyDelayMs,
    salesPlaybook: parsePlaybook(row.salesPlaybookJson),
    discountPolicy: parseDiscountPolicy(row.discountPolicyJson),
    handoffEnabled: row.handoffEnabled,
    handoffInstructions: row.handoffInstructions,
    fallbackMessage: row.fallbackMessage,
  };
}

function asServiceError(err: unknown): AiServiceError {
  if (err instanceof AiServiceError) return err;
  if (err instanceof AiProviderError) {
    return new AiServiceError(err.code, err.message, err.status ?? 502);
  }
  return new AiServiceError("AI_REQUEST_FAILED", err instanceof Error ? err.message : "AI request failed", 502);
}

async function recordTestStatus(tenantId: string, status: string): Promise<void> {
  await prisma.aiSetting
    .update({
      where: { tenantId },
      data: { lastTestAt: new Date(), lastTestStatus: status.slice(0, 500) },
    })
    .catch(() => undefined);
}

export async function testAiProvider(tenantId: string, overrides: AiTestInput) {
  const row = await prisma.aiSetting.findUnique({ where: { tenantId } });
  const baseUrl = overrides.providerBaseUrl ?? row?.providerBaseUrl ?? DEFAULTS.providerBaseUrl;
  const model = overrides.model ?? row?.model ?? DEFAULTS.model;
  let apiKey = overrides.apiKey ?? "";
  if (!apiKey && row?.encryptedApiKey) {
    try {
      apiKey = decryptToken(row.encryptedApiKey);
    } catch {
      throw new AiServiceError("AI_CREDENTIAL_ERROR", "Stored AI API key cannot be decrypted", 500);
    }
  }
  if (!apiKey) throw new AiServiceError("AI_API_KEY_REQUIRED", "Enter an API key before testing");

  try {
    const result = await chatCompletion({
      baseUrl,
      apiKey,
      model,
      messages: [
        { role: "system", content: "You are a connectivity test. Reply with exactly: ok" },
        { role: "user", content: "Reply with exactly: ok" },
      ],
      temperature: 0,
      maxTokens: 8,
      timeoutMs: 15000,
      maxRetries: 0,
      jsonMode: false,
    });
    await recordTestStatus(tenantId, "OK");
    return {
      ok: true,
      model: result.model,
      latencyMs: result.latencyMs,
      sample: result.content.trim().slice(0, 200),
    };
  } catch (err) {
    const serviceError = asServiceError(err);
    await recordTestStatus(tenantId, `FAILED: ${serviceError.message}`);
    throw serviceError;
  }
}

export async function runPlayground(tenantId: string, input: AiPlaygroundInput) {
  const config = await getRuntimeAiConfig(tenantId);
  if (!config) {
    throw new AiServiceError("AI_NOT_CONFIGURED", "Save an API key, model, and enable the AI agent before testing");
  }
  const [businessName, knowledge, offers] = await Promise.all([
    loadBusinessName(tenantId),
    loadActiveKnowledge(tenantId),
    loadActiveOffers(tenantId),
  ]);
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const systemPrompt = buildSystemPrompt({
    config,
    businessName,
    knowledge,
    offers,
    memory: null,
    contactName: "Test customer",
    inboundText: lastUser,
  });
  try {
    const result = await chatCompletion({
      baseUrl: config.providerBaseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages: [{ role: "system", content: systemPrompt }, ...input.messages],
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      jsonMode: isOfficialOpenAi(config.providerBaseUrl),
    });
    const parsed = parseAiReply(result.content);
    const policy = evaluateDiscountPolicy(parsed, offers, config.discountPolicy);
    return {
      reply: policy.violation ? config.fallbackMessage ?? parsed.reply : parsed.reply,
      raw: result.content,
      parsed,
      policy,
      model: result.model,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  } catch (err) {
    throw asServiceError(err);
  }
}
