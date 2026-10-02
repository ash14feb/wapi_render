import type { Request, Response } from "express";
import { z } from "zod";
import { parseVerifyQuery, verifyMetaSignature } from "../utils/webhook";
import { sendError, sendSuccess } from "../utils/response";
import { processInstagramWebhook, sendInstagramText } from "../services/instagram/instagram.service";
import { prisma } from "../config/prisma";

/** GET /api/v1/webhooks/instagram — Meta challenge verification (same VERIFY_TOKEN as WhatsApp). */
export function verifyInstagram(req: Request, res: Response): void {
    const result = parseVerifyQuery(req.query as Record<string, string>);
    if (!result.ok) { sendError(res, "WEBHOOK_VERIFY_FAILED", "Webhook verification failed", 403); return; }
    res.status(200).type("text/plain").send(result.challenge);
}

/** POST /api/v1/webhooks/instagram — inbound DMs/comments. HMAC-verified, fast-ack. */
export async function receiveInstagram(req: Request, res: Response): Promise<void> {
    const appSecret = process.env.META_APP_SECRET ?? "";
    if (appSecret) {
        const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body ?? {});
        if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, appSecret)) {
            sendError(res, "WEBHOOK_SIGNATURE_INVALID", "Invalid webhook signature", 403);
            return;
        }
    }
    try {
        const summary = await processInstagramWebhook(req.body);
        sendSuccess(res, { ack: true, ...summary });
    } catch {
        sendSuccess(res, { ack: true, applied: 0 });
    }
}

const sendSchema = z.object({ to: z.string().min(1).max(64), text: z.string().min(1).max(1000) });

/** POST /api/v1/integrations/instagram/send (auth) — reply to an IG user. */
export async function instagramSend(req: Request, res: Response): Promise<void> {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "VALIDATION_ERROR", "to + text required", 400, parsed.error.flatten()); return; }
    try {
        const messageId = await sendInstagramText(parsed.data.to, parsed.data.text);
        sendSuccess(res, { messageId });
    } catch (err) {
        sendError(res, "INSTAGRAM_SEND_FAILED", err instanceof Error ? err.message : "Send failed", 502);
    }
}

/** GET /api/v1/integrations/instagram/events (auth) — recent IG DMs. */ 
export async function instagramEvents(_req: Request, res: Response): Promise<void> {
    try {
        const rows = await prisma.webhookEvent.findMany({
            where: { eventType: { startsWith: "instagram:" } },
            orderBy: { receivedAt: "desc" },
            take: 20,
            select: { eventType: true, payloadJson: true, receivedAt: true },
        });
        sendSuccess(res, {
            events: rows.map((r) => {
                try {
                    const p = JSON.parse(r.payloadJson) as { senderId?: string; text?: string };
                    if (r.eventType === "instagram:test") return { senderId: "meta-test", text: "webhook test ping OK", receivedAt: r.receivedAt };
                    return { senderId: p.senderId ?? "?", text: p.text ?? "", receivedAt: r.receivedAt };
                } catch { return { senderId: "?", text: "", receivedAt: r.receivedAt }; }
            }),
        });
    } catch {
        sendSuccess(res, { events: [] });
    }
}
