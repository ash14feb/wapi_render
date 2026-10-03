import { config } from "../../config/env";
import { prisma } from "../../config/prisma";

/** Send an Instagram DM reply. Supports Instagram-Login apps (IG user token, default)
 * and Facebook-Login apps (Page token) via INSTAGRAM_USE_PAGE_TOKEN=true. */
export async function sendInstagramText(recipientId: string, text: string): Promise<string> {
    const token = (process.env.INSTAGRAM_PAGE_TOKEN ?? "").trim();
    if (!token) throw new Error("INSTAGRAM_PAGE_TOKEN is not configured");
    const usePageFlow = (process.env.INSTAGRAM_USE_PAGE_TOKEN ?? "").toLowerCase() === "true";
    if (usePageFlow) {
        const version = (config.meta.graphVersion || "v21.0").replace(/^v?/, "v");
        const res = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Instagram send failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`);
        return String((body as any).message_id ?? "sent");
    }
    // Instagram Login flow: POST https://graph.instagram.com/{v}/{ig-id}/messages
    const igId = (process.env.INSTAGRAM_IG_USER_ID ?? "").trim();
    if (!igId) throw new Error("Set INSTAGRAM_IG_USER_ID to your Business IG id (e.g. 17841459475571473 for itsreviver)");
    const res = await fetch(`https://graph.instagram.com/v25.0/${igId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Instagram send failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`);
    return String((body as any).id ?? (body as any).message_id ?? "sent");
}

/** Persist inbound Instagram webhook + extract message summaries for UI. */
export async function processInstagramWebhook(payload: any): Promise<{ applied: number }> {
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    let applied = 0;
    let sawMessaging = false;
    for (const entry of entries) {
        const entryIgId = entry?.id ? String(entry.id) : undefined;
        const items: { m: any; via: string }[] = [
            ...(entry?.messaging ?? []).map((m: any) => ({ m, via: "messaging" })),
            ...(entry?.standby ?? []).map((m: any) => ({ m, via: "standby" })),
        ];
        for (const { m, via } of items) {
            sawMessaging = true;
            const senderId = m?.sender?.id ?? entry?.sender?.id ?? entryIgId ?? "unknown";
            const kind = m?.message ? "message" : m?.postback ? "postback" : m?.read ? "read" : m?.reaction ? "reaction" : "other";
            let text =
                m?.message?.text ?? m?.message?.quick_reply?.payload ?? m?.postback?.title ?? m?.postback?.payload ??
                (m?.read ? `seen ${m.read.mid ?? ""}`.trim() : m?.reaction ? `reaction ${m.reaction?.reaction ?? ""} on ${m.reaction?.mid ?? ""}`.trim() : JSON.stringify(m).slice(0, 300));
            const mid = m?.message?.mid ?? m?.read?.mid ?? m?.reaction?.mid ?? m?.postback?.mid ?? null;
            // Fallback: read receipts carry the seen message's mid — try fetching its body.
            if (kind === "read" && mid) {
                try {
                    const tok = (process.env.INSTAGRAM_PAGE_TOKEN ?? "").trim();
                    if (tok) {
                        const r = await fetch(`https://graph.instagram.com/v25.0/${encodeURIComponent(mid)}?fields=id,text,created_time,from,to&access_token=${encodeURIComponent(tok)}`);
                        const j = (await r.json().catch(() => ({}))) as { text?: string; from?: { id?: string } };
                        if (r.ok && j.text) {
                            text = j.text;
                            const fromId = j.from?.id;
                            await prisma.webhookEvent.create({
                                data: {
                                    eventType: "instagram:message",
                                    externalEventId: `ig:${mid}-fetched`,
                                    payloadJson: JSON.stringify({ senderId: fromId ?? senderId, text, kind: "message", via: `${via}+fetch`, raw: j }).slice(0, 20000),
                                    processingStatus: "PROCESSED",
                                },
                            });
                            applied++;
                        }
                    }
                } catch { /* best-effort only */ }
            }
            try {
                await prisma.webhookEvent.create({
                    data: {
                        eventType: `instagram:${kind}`,
                        externalEventId: `ig:${mid ?? Date.now()}-${Math.random().toString(36).slice(2)}`,
                        payloadJson: JSON.stringify({ senderId, text, kind, via, raw: m }).slice(0, 20000),
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
