import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { encryptToken } from "../../utils/crypto";
import { buildInstallUrl, normalizeShopDomain } from "../../utils/shopify";
import { sendTemplate } from "../whatsapp/whatsapp.service";

/** Persist Shopify connections in Tenant-scoped table. Falls back gracefully pre-migration. */
async function tableExists(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM shopify_connections LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function getConnection(tenantId: string) {
  if (!(await tableExists())) return null;
  return (prisma as any).shopifyConnection.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
}

export async function saveConnection(tenantId: string, shop: string, accessToken: string, scopes: string) {
  const encrypted = encryptToken(accessToken);
  if (!(await tableExists())) return { shop, tenantId, status: "ACTIVE" };
  return (prisma as any).shopifyConnection.upsert({
    where: { tenantId_shop: { tenantId, shop } },
    update: { encryptedAccessToken: encrypted, scopes, status: "ACTIVE" },
    create: { tenantId, shop, encryptedAccessToken: encrypted, scopes, status: "ACTIVE" },
  });
}

export async function removeConnection(tenantId: string) {
  if (!(await tableExists())) return;
  await (prisma as any).shopifyConnection.updateMany({ where: { tenantId }, data: { status: "DISCONNECTED" } });
}

export function installUrl(shop: string, state: string): string {
  const clean = normalizeShopDomain(shop);
  if (!clean) throw new Error("Invalid shop domain. Use <store>.myshopify.com");
  if (!config.shopify.apiKey) throw new Error("SHOPIFY_API_KEY is not configured");
  const redirectUri = `${config.apiUrl}/api/v1/integrations/shopify/callback`;
  return buildInstallUrl(clean, config.shopify.apiKey, config.shopify.scopes, redirectUri, state);
}

export async function exchangeCode(shop: string, code: string): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.shopify.apiKey, client_secret: config.shopify.apiSecret, code }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed (${res.status})`);
  return res.json() as Promise<{ access_token: string; scope: string }>;
}

/** Map Shopify order/checkout payload → WhatsApp template send. Non-blocking, best-effort. */
export async function notifyOrderEvent(tenantId: string, kind: "ORDER_CREATED" | "ORDER_FULFILLED" | "CHECKOUT_ABANDONED", payload: any): Promise<void> {
  const phoneRaw = payload?.phone ?? payload?.customer?.phone ?? payload?.shipping_address?.phone ?? payload?.billing_address?.phone;
  const { normalizePhone } = await import("../../utils/shopify");
  const to = normalizePhone(phoneRaw);
  if (!to) return;
  const orderName = payload?.name ?? payload?.order_number ?? "";
  const total = payload?.total_price ?? payload?.current_total_price ?? "";
  const templateName =
    kind === "ORDER_CREATED" ? "order_confirm" : kind === "ORDER_FULFILLED" ? "shipment_update" : "abandoned_checkout";
  try {
    await sendTemplate(tenantId, {
      to,
      templateName,
      language: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: String(orderName) }, { type: "text", text: String(total) }] }],
    });
  } catch {
    // best-effort: webhook already acked; failure visible in campaign/message logs
  }
}
