import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config, primaryFrontendUrl } from "../config/env";
import { sendError, sendSuccess } from "../utils/response";
import { normalizeShopDomain, verifyShopifyHmac, verifyShopifyOAuthQuery } from "../utils/shopify";
import { exchangeCode, getConnection, installUrl, notifyOrderEvent, removeConnection, saveConnection } from "../services/shopify/shopify.service";
import { prisma } from "../config/prisma";

const connectSchema = z.object({ shop: z.string().min(3).max(128) });

function tenantId(req: Request): string | null {
    return req.auth?.tenantId ?? null;
}

/** GET /api/v1/integrations/shopify/status (auth) — connection state for UI. */
export async function shopifyStatus(req: Request, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { sendError(res, "UNAUTHORIZED", "Missing auth", 401); return; }
    const conn = await getConnection(tid).catch(() => null);
    sendSuccess(res, {
        connected: !!conn && (conn as any).status === "ACTIVE",
        shop: (conn as any)?.shop ?? null,
        scopes: (conn as any)?.scopes ?? null,
        configured: !!config.shopify.apiKey,
    });
}

/** POST /api/v1/integrations/shopify/connect (auth) { shop } → { installUrl } */
export async function shopifyConnect(req: Request, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { sendError(res, "UNAUTHORIZED", "Missing auth", 401); return; }
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "VALIDATION_ERROR", "Invalid shop domain", 400, parsed.error.flatten()); return; }
    const shop = normalizeShopDomain(parsed.data.shop);
    if (!shop) { sendError(res, "VALIDATION_ERROR", "Use <store>.myshopify.com", 400); return; }
    try {
        const state = jwt.sign({ tenantId: tid, shop }, config.jwtAccessSecret || "dev", { expiresIn: "10m" });
        sendSuccess(res, { installUrl: installUrl(shop, state) });
    } catch (err) {
        sendError(res, "SHOPIFY_CONFIG_ERROR", err instanceof Error ? err.message : "Connect failed", 500);
    }
}

/** GET /api/v1/integrations/shopify/callback?code&hmac&shop&state (public, Shopify redirects here). */
export async function shopifyCallback(req: Request, res: Response): Promise<void> {
    const q = req.query as Record<string, string>;
    if (!verifyShopifyOAuthQuery(q, config.shopify.apiSecret)) { res.status(403).send("Shopify HMAC invalid"); return; }
    const shop = normalizeShopDomain(q.shop ?? "");
    if (!shop || !q.code || !q.state) { res.status(400).send("Missing shop/code/state"); return; }
    let tenantIdFromState = "";
    try {
        const decoded = jwt.verify(q.state, config.jwtAccessSecret || "dev") as { tenantId: string; shop: string };
        tenantIdFromState = decoded.tenantId;
    } catch { res.status(403).send("State expired — reconnect from the app"); return; }
    try {
        const tok = await exchangeCode(shop, q.code);
        await saveConnection(tenantIdFromState, shop, tok.access_token, tok.scope ?? config.shopify.scopes);
        // TODO: register webhooks via Admin API (orders/create, orders/fulfilled, checkouts/update) once token saved.
        res.redirect(`${primaryFrontendUrl()}/integrations?shopify=connected&shop=${shop}`);
    } catch {
        res.redirect(`${primaryFrontendUrl()}/integrations?shopify=error`);
    }
}

/** DELETE /api/v1/integrations/shopify/disconnect (auth) */
export async function shopifyDisconnect(req: Request, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { sendError(res, "UNAUTHORIZED", "Missing auth", 401); return; }
    await removeConnection(tid);
    sendSuccess(res, { disconnected: true });
}

/** POST /api/v1/integrations/shopify/webhooks (public, HMAC-verified). */
export async function shopifyWebhook(req: Request, res: Response): Promise<void> {
    const secret = config.shopify.apiSecret;
    const topic = (req.headers["x-shopify-topic"] as string | undefined) ?? "";
    const shop = (req.headers["x-shopify-shop-domain"] as string | undefined) ?? "";
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyShopifyHmac(raw, req.headers["x-shopify-hmac-sha256"] as string | undefined, secret)) {
        try {
            await prisma.webhookEvent.create({
                data: {
                    eventType: `shopify:${topic || "unknown"}:auth_failed`,
                    externalEventId: `shopify:authfail:${Date.now()}`,
                    payloadJson: JSON.stringify({ shop, topic, hint: "HMAC mismatch — check SHOPIFY_API_SECRET" }).slice(0, 2000),
                    processingStatus: "FAILED",
                    errorMessage: "HMAC mismatch",
                },
            });
        } catch { /* ignore */ }
        sendError(res, "WEBHOOK_SIGNATURE_INVALID", "Invalid Shopify signature", 403);
        return;
    }
    // Resolve tenant by shop domain; ack fast regardless.
    let tid: string | null = null;
    try {
        const row = await (prisma as any).shopifyConnection.findFirst({ where: { shop, status: "ACTIVE" } });
        tid = row?.tenantId ?? null;
    } catch { /* table may not exist yet — still ack 200 */ }
    res.status(200).json({ ok: true });
    // Persist every webhook for DB visibility (best-effort, never blocks ack).
    const externalId = String((req.body as any)?.id ?? (req.headers["x-shopify-webhook-id"] as string | undefined) ?? `${topic}:${Date.now()}`);
    const payloadJson = JSON.stringify(req.body ?? {}).slice(0, 50000);
    try {
        if (tid) {
            await prisma.webhookEvent.upsert({
                where: { tenantId_externalEventId: { tenantId: tid, externalEventId: `shopify:${externalId}` } },
                update: { processingStatus: "PROCESSED", payloadJson },
                create: {
                    tenantId: tid,
                    eventType: `shopify:${topic || "unknown"}`,
                    externalEventId: `shopify:${externalId}`,
                    payloadJson,
                    processingStatus: "PROCESSED",
                },
            });
        } else {
            await prisma.webhookEvent.create({
                data: {
                    eventType: `shopify:${topic || "unknown"}`,
                    externalEventId: `shopify:${externalId}`,
                    payloadJson,
                    processingStatus: "UNRESOLVED",
                    errorMessage: `No ACTIVE connection for shop ${shop}`,
                },
            });
        }
    } catch { /* table/unique edge — ignore */ }
    if (!tid) return;
    const kind = topic === "orders/create" ? "ORDER_CREATED" : topic === "orders/fulfilled" ? "ORDER_FULFILLED" : topic.startsWith("checkouts/") ? "CHECKOUT_ABANDONED" : null;
    if (kind) void notifyOrderEvent(tid, kind, req.body);
}

/** GET /api/v1/integrations/shopify/events (auth) — recent webhook deliveries for UI. */
export async function shopifyEvents(req: Request, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { sendError(res, "UNAUTHORIZED", "Missing auth", 401); return; }
    try {
        const rows = await prisma.webhookEvent.findMany({
            where: { tenantId: tid, eventType: { startsWith: "shopify:" } },
            orderBy: { receivedAt: "desc" },
            take: 20,
            select: { eventType: true, externalEventId: true, processingStatus: true, errorMessage: true, receivedAt: true },
        });
        sendSuccess(res, { events: rows });
    } catch {
        sendSuccess(res, { events: [] });
    }
}
