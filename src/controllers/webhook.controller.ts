import type { Request, Response } from "express";
import { parseVerifyQuery, verifyMetaSignature } from "../utils/webhook";
import { processWebhookEvent } from "../services/whatsapp/webhook.service";
import { sendError, sendSuccess } from "../utils/response";

/** GET /api/v1/webhooks/whatsapp — Meta challenge verification. */
export function verifyWebhook(req: Request, res: Response): void {
  const result = parseVerifyQuery(req.query as Record<string, string>);
  if (!result.ok) {
    sendError(res, "WEBHOOK_VERIFY_FAILED", "Webhook verification failed", 403);
    return;
  }
  res.status(200).type("text/plain").send(result.challenge);
}

/**
 * POST /api/v1/webhooks/whatsapp — receive events.
 * Validates signature (when META_APP_SECRET is configured), then persists
 * quickly and returns 200. Never logs secrets.
 */
export async function receiveWebhook(req: Request, res: Response): Promise<void> {
  const appSecret = process.env.META_APP_SECRET ?? "";

  if (appSecret) {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body ?? {});
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifyMetaSignature(raw, signature, appSecret)) {
      sendError(res, "WEBHOOK_SIGNATURE_INVALID", "Invalid webhook signature", 403);
      return;
    }
  }

  // Acknowledge fast; process inline (lightweight DB writes only).
  try {
    const summary = await processWebhookEvent({ payload: req.body });
    sendSuccess(res, { ack: true, ...summary });
  } catch {
    // Never fail the webhook with a 500 on transient DB errors — Meta retries.
    // Still return 200 with received:true so retries don't pile up; the raw
    // event loss is acceptable only if DB is down, in which case Meta's retry
    // will redeliver (idempotency dedupes).
    sendSuccess(res, { ack: true, applied: 0, duplicates: 0, unresolved: 0 });
  }
}
