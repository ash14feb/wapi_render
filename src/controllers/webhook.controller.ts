import type { Request, Response } from "express";
import { parseVerifyQuery, verifyMetaSignature } from "../utils/webhook";
import { processWebhookEvent } from "../services/whatsapp/webhook.service";
import { webhookPayloadSchema } from "../validators/webhook.validator";
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
 * Validates the signature, acknowledges within milliseconds, then processes
 * asynchronously. Idempotency (wamid dedupe) makes Meta's retries safe.
 */
export function receiveWebhook(req: Request, res: Response): void {
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!appSecret) {
    sendError(res, "SERVER_MISCONFIGURED", "META_APP_SECRET is not configured", 500);
    return;
  }

  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!raw || !verifyMetaSignature(raw, signature, appSecret)) {
    sendError(res, "WEBHOOK_SIGNATURE_INVALID", "Invalid webhook signature", 403);
    return;
  }

  const payload = req.body;
  const parsed = webhookPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    // Not a Meta messages payload: persist for diagnosis, still ack.
    void processWebhookEvent({ payload }).catch(() => undefined);
    sendSuccess(res, { ack: true });
    return;
  }

  setImmediate(() => {
    void processWebhookEvent({ payload }).catch(() => undefined);
  });
  sendSuccess(res, { ack: true });
}
