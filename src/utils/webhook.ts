import crypto from "crypto";

/** HMAC-SHA256 signature check per Meta docs: X-Hub-Signature-256: sha256=<hex>. */
export function verifyMetaSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const [algo, hash] = signatureHeader.split("=");
  if (algo !== "sha256" || !hash) return false;
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? rawBody : Buffer.from(rawBody))
    .digest("hex");
  const a = Buffer.from(hash, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseVerifyQuery(query: {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}): { ok: true; challenge: string } | { ok: false; reason: string } {
  if (query["hub.mode"] !== "subscribe") return { ok: false, reason: "invalid mode" };
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
  if (!expected) return { ok: false, reason: "verify token not configured" };
  if (query["hub.verify_token"] !== expected) return { ok: false, reason: "token mismatch" };
  if (!query["hub.challenge"]) return { ok: false, reason: "missing challenge" };
  return { ok: true, challenge: query["hub.challenge"] };
}
