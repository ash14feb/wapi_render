import { config } from "../../config/env";
import { prisma } from "../../config/prisma";

/** Send an Instagram DM reply via Messenger Platform for Instagram. */
export async function sendInstagramText(recipientId: string, text: string): Promise<string> {
  const token = process.env.INSTAGRAM_PAGE_TOKEN ?? "";
  const version = (config.meta.graphVersion || "v21.0").replace(/^v?/, "v");
  if (!token) throw new Error("INSTAGRAM_PAGE_TOKEN is not configured");
  const res = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram send failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`);
  return String((body as any).message_id ?? "sent");
}

/** Persist inbound Instagram webhook + extract message summaries for UI. */
export async function processInstagramWebhook(payload: any): Promise<{ applied: number }> {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  let applied = 0;
  for (const entry of entries) {
    for (const m of entry?.messaging ?? []) {
      const senderId = m?.sender?.id ?? "unknown";
      const text = m?.message?.text ?? m?.postback?.title ?? "";
      try {
        await prisma.webhookEvent.create({
          data: {
            eventType: "instagram:message",
            externalEventId: `ig:${m?.message?.mid ?? Date.now()}-${Math.random().toString(36).slice(2)}`,
            payloadJson: JSON.stringify({ senderId, text, raw: m }).slice(0, 20000),
            processingStatus: "PROCESSED",
          },
        });
        applied++;
      } catch { /* ignore */ }
    }
  }
  return { applied };
}
