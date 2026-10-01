import crypto from "crypto";

/** Verify Shopify webhook HMAC: X-Shopify-Hmac-Sha256 = base64(hmac-sha256(raw, secret)). */
export function verifyShopifyHmac(rawBody: Buffer | string, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac("sha256", secret).update(typeof rawBody === "string" ? rawBody : Buffer.from(rawBody)).digest("base64");
  const a = Buffer.from(hmacHeader, "utf8");
  const b = Buffer.from(digest, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Verify OAuth callback HMAC per Shopify docs (query params minus hmac/signature). */
export function verifyShopifyOAuthQuery(query: Record<string, string>, secret: string): boolean {
  const { hmac, signature: _sig, ...rest } = query;
  if (!hmac || !secret) return false;
  const message = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(hmac, "utf8");
  const b = Buffer.from(digest, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function normalizeShopDomain(shop: string): string | null {
  const s = shop.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return null;
  return s;
}

/** E.164 normalize — Shopify phones come in varied formats. Returns null if unusable. */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  const e164 = digits.startsWith("+") ? digits : `+${digits}`;
  return /^\+?[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export function buildInstallUrl(shop: string, apiKey: string, scopes: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: apiKey, scope: scopes, redirect_uri: redirectUri, state });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}
