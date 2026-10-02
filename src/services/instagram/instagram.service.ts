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
    let sawMessaging = false;
    for (const entry of entries) {
        const entryIgId = entry?.id ? String(entry.id) : undefined;
        for (const m of entry?.messaging ?? []) {
            sawMessaging = true;
            const senderId = m?.sender?.id ?? entry?.sender?.id ?? entryIgId ?? "unknown";
            const kind = m?.message ? "message" : m?.postback ? "postback" : m?.read ? "read" : m?.reaction ? "reaction" : "other";
            const text =
                m?.message?.text ?? m?.message?.quick_reply?.payload ?? m?.postback?.title ?? m?.postback?.payload ??
                (m?.read ? `seen ${m.read.mid ?? ""}`.trim() : m?.reaction ? `reaction ${m.reaction?.reaction ?? ""} on ${m.reaction?.mid ?? ""}`.trim() : JSON.stringify(m).slice(0, 300));
            const mid = m?.message?.mid ?? m?.read?.mid ?? m?.reaction?.mid ?? m?.postback?.mid ?? null;
            try {
                await prisma.webhookEvent.create({
                    data: {
                        eventType: `instagram:${kind}`,
                        externalEventId: `ig:${mid ?? Date.now()}-${Math.random().toString(36).slice(2)}`,
                        payloadJson: JSON.stringify({ senderId, text, kind, raw: m }).slice(0, 20000),
                        processingStatus: "PROCESSED",
                    },
                });
                applied++;
            } catch { /* ignore */ }
        }
    }
    if (!sawMessaging) {
        try {
            await prisma.webhookEvent.create({
                data: {
                    eventType: "instagram:test",
                    externalEventId: `ig:test:${Date.now()}`,
                    payloadJson: JSON.stringify(payload ?? {}).slice(0, 20000),
                    processingStatus: "PROCESSED",
                },
            });
            applied++;
        } catch { /* ignore */ }
    }
    return { applied };
}
