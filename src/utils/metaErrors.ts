export interface MetaErrorDetail {
  message: string;
  code?: number;
  subcode?: number;
  type?: string;
  /** error_data.blame_field — the exact request field Meta rejected. */
  blameField?: string;
  traceId?: string;
  hint?: string;
}

interface RawMetaError {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
  error_data?: { details?: string; blame_field?: string };
  fbtrace_id?: string;
}

const HINTS: Record<number, string> = {
  4: "The app hit the Cloud API rate limit. Wait a few minutes and try again.",
  190: "The access token is invalid or expired. Reconnect WhatsApp in Settings and try again.",
  100: "A parameter was rejected. Check the field marked in the error and compare it with Meta's template format rules.",
  131026: "This customer cannot receive WhatsApp messages (invalid number or not on WhatsApp).",
  131047: "The 24-hour customer service window has closed. Use an approved template to re-open the conversation.",
  131053: "The media sample could not be downloaded by Meta. Re-upload the sample file.",
  132000: "Meta rejected the template content. Review the body text, variables and samples.",
  132001: "No approved template matches this name and language. Check the template and its language code.",
  132005: "The template text is too long or a parameter exceeds its limit.",
  132007: "The template contains content Meta flags as policy-violating. Rewrite it and resubmit.",
  132012: "A template parameter is empty or has the wrong number of samples.",
  132015: "The template is paused by Meta and cannot be sent right now.",
  132018: "This category is not allowed for the template content (e.g. marketing text in a utility template).",
  132019: "This template needs more sample values or was rejected for content. Review the samples.",
  132068: "The WhatsApp account is restricted. Check Account Quality in WhatsApp Manager.",
};

function asRaw(body: unknown): RawMetaError | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  return err && typeof err === "object" ? (err as RawMetaError) : null;
}

export function readMetaError(err: unknown): MetaErrorDetail | null {
  const raw = asRaw((err as { metaBody?: unknown } | null)?.metaBody);
  if (raw) {
    const subcode = raw.error_subcode;
    return {
      message: raw.message ?? (err instanceof Error ? err.message : "Meta rejected the request"),
      code: raw.code,
      subcode,
      type: raw.type,
      blameField: raw.error_data?.blame_field,
      traceId: raw.fbtrace_id,
      hint: raw.code !== undefined ? HINTS[subcode ?? raw.code] : undefined,
    };
  }
  // No structured body: keep the raw Graph message, which already describes the failure.
  if (err instanceof Error) return { message: err.message };
  return null;
}
