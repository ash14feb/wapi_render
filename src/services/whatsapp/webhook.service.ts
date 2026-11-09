import { prisma } from "../../config/prisma";
import { webhookPayloadSchema } from "../../validators/webhook.validator";
import { publish, toEventMessage } from "../realtime";
import { summarizeFlowResponse } from "../../utils/flowBuilder";
import { handleInboundAutomation } from "./automation";
import { clearOptOut, isOptOutRequest, isOptedOut, markOptedOut, splitTags, OPTED_OUT_TAG } from "./optOut";
import { showTypingIndicator } from "./typing";
import type { BotContact } from "./botEngine";

const STATUS_MAP: Record<string, string> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

function toDate(ts?: string): Date | undefined {
  if (!ts) return undefined;
  const n = Number(ts);
  if (!Number.isFinite(n)) return undefined;
  return new Date(n * 1000);
}

function messageText(m: {
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
  interactive?: { type?: string; nfm_reply?: { response_json?: string; body?: string }; button_reply?: { title?: string } };
}): string | undefined {
  if (m.type === "text" || m.text?.body) return m.text?.body;
  if (m.interactive?.nfm_reply) {
    try {
      return summarizeFlowResponse(m.interactive.nfm_reply.response_json ?? "{}");
    } catch {
      return m.interactive.nfm_reply.body ?? "Flow response received";
    }
  }
  if (m.interactive?.button_reply?.title) return m.interactive.button_reply.title;
  return m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? undefined;
}

function messageMediaId(m: {
  image?: { id?: string };
  video?: { id?: string };
  document?: { id?: string };
  audio?: { id?: string };
  sticker?: { id?: string };
}): string | undefined {
  return m.image?.id ?? m.video?.id ?? m.document?.id ?? m.audio?.id ?? m.sticker?.id;
}

/** Cheap in-memory dedupe for status callbacks (Redis pub/sub replaces it when multi-instance). */
const seenStatusKeys = new Set<string>();
function statusKeySeen(key: string): boolean {
  if (seenStatusKeys.has(key)) return true;
  seenStatusKeys.add(key);
  if (seenStatusKeys.size > 20_000) seenStatusKeys.clear();
  return false;
}

function recordEvent(data: Parameters<typeof prisma.webhookEvent.create>[0]["data"]): void {
  void prisma.webhookEvent.create({ data }).catch(() => undefined);
}

/**
 * Persist + apply one Meta webhook payload.
 * Idempotent: duplicate deliveries (same wamid) do not create duplicate messages.
 * Never throws for unknown/unresolvable events — records them and returns counts.
 */
export async function processWebhookEvent(input: {
  payload: unknown;
}): Promise<{ received: number; applied: number; duplicates: number; unresolved: number }> {
  const parsed = webhookPayloadSchema.safeParse(input.payload);
  const rawJson = JSON.stringify(input.payload ?? null).slice(0, 65535);
  let received = 0;
  let applied = 0;
  let duplicates = 0;
  let unresolved = 0;

  if (!parsed.success) {
    recordEvent({
      tenantId: null,
      eventType: "whatsapp.unknown",
      payloadJson: rawJson,
      processingStatus: "FAILED",
      errorMessage: "Unrecognized webhook payload shape",
    });
    return { received: 0, applied: 0, duplicates: 0, unresolved: 1 };
  }

  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const hasMessages = (value.messages ?? []).length > 0;
      const hasStatuses = (value.statuses ?? []).length > 0;
      if (!hasMessages && !hasStatuses) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      const account = phoneNumberId
        ? await prisma.whatsappAccount.findFirst({
            where: { phoneNumberId },
            select: {
              id: true,
              tenantId: true,
              phoneNumberId: true,
              encryptedAccessToken: true,
            },
          })
        : null;
      const tenantId = account?.tenantId ?? null;
      const profileName = value.contacts?.[0]?.profile?.name;

      for (const m of value.messages ?? []) {
        received += 1;
        const externalId = m.id;
        if (!account || !tenantId) {
          unresolved += 1;
          recordEvent({
            tenantId: null,
            eventType: "whatsapp.message.inbound",
            externalEventId: `${phoneNumberId ?? "unknown"}:${externalId}`,
            payloadJson: JSON.stringify(m).slice(0, 65535),
            processingStatus: "UNRESOLVED_TENANT",
            errorMessage: "No WhatsApp account matched phone_number_id",
          });
          continue;
        }

        // Idempotency: wamid unique per tenant.
        const existing = await prisma.message.findUnique({
          where: { tenantId_whatsappMessageId: { tenantId, whatsappMessageId: externalId } },
          select: { id: true },
        });
        if (existing) {
          duplicates += 1;
          continue;
        }

        const phone = m.from ?? "unknown";
        const contact = await prisma.contact.upsert({
          where: { tenantId_phone: { tenantId, phone } },
          update: { profileName: profileName ?? undefined },
          create: { tenantId, phone, profileName },
        });

        const inboundText = messageText(m);

        // Opt-out lifecycle: applied synchronously so a STOP is recorded even if
        // the async bot engine never runs. Messaging the business again
        // re-subscribes a contact that previously opted out.
        let contactTags = contact.tags;
        if (inboundText && isOptOutRequest(inboundText)) {
          await markOptedOut(contact.id).catch(() => undefined);
          contactTags = contactTags ? `${contactTags},opted_out` : "opted_out";
        } else if (inboundText && isOptedOut(contact.tags)) {
          await clearOptOut(contact.id).catch(() => undefined);
          contactTags = splitTags(contact.tags)
            .filter((t) => t.toLowerCase() !== OPTED_OUT_TAG)
            .join(",") || null;
        }

        const conversation = await prisma.conversation.upsert({
          where: {
            tenantId_whatsappAccountId_contactId: {
              tenantId,
              whatsappAccountId: account.id,
              contactId: contact.id,
            },
          },
          update: { lastMessageAt: new Date(), status: "OPEN" },
          create: {
            tenantId,
            whatsappAccountId: account.id,
            contactId: contact.id,
            status: "OPEN",
            lastMessageAt: new Date(),
          },
          select: { id: true },
        });

        let created: { id: string; conversationId: string; direction: string; messageType: string; textContent: string | null; status: string; messageTimestamp: Date | null; createdAt: Date };
        try {
          created = await prisma.message.create({
            data: {
              tenantId,
              conversationId: conversation.id,
              whatsappMessageId: externalId,
              direction: "INBOUND",
              messageType: (m.type ?? "TEXT").toUpperCase(),
              textContent: inboundText,
              mediaId: messageMediaId(m),
              status: "RECEIVED",
              messageTimestamp: toDate(m.timestamp),
            },
          });
          applied += 1;
        } catch (err) {
          // Unique-conflict race on retry → duplicate, not an error.
          if ((err as { code?: string }).code === "P2002") {
            duplicates += 1;
          } else {
            recordEvent({
              tenantId,
              eventType: "whatsapp.message.inbound",
              externalEventId: externalId,
              payloadJson: JSON.stringify(m).slice(0, 65535),
              processingStatus: "FAILED",
              errorMessage: err instanceof Error ? err.message : "persist failed",
            });
          }
          continue;
        }

        publish(tenantId, {
          type: "message.created",
          conversationId: conversation.id,
          message: toEventMessage(created),
        });

        const nfm = (m as { interactive?: { nfm_reply?: { response_json?: string } } }).interactive?.nfm_reply;
        if (nfm?.response_json) void recordFlowResponse(tenantId, externalId, phone, nfm.response_json);

        // Rules → AI → default rule: fire-and-forget, never blocks webhook 200.
        if (inboundText) {
          if (!isOptedOut(contactTags)) {
            showTypingIndicator({
              conversationId: conversation.id,
              phoneNumberId: account.phoneNumberId,
              encryptedAccessToken: account.encryptedAccessToken,
              inboundWamid: externalId,
            });
          }
          const botContact: BotContact = {
            id: contact.id,
            phone: contact.phone,
            tags: contactTags,
          };
          void handleInboundAutomation({
            tenantId,
            accountId: account.id,
            phoneNumberId: account.phoneNumberId,
            encryptedAccessToken: account.encryptedAccessToken,
            conversationId: conversation.id,
            contactId: contact.id,
            contact: botContact,
            inboundWamid: externalId,
            inboundMessageId: created.id,
            text: inboundText,
          }).catch(() => undefined);
        }
      }

      for (const s of value.statuses ?? []) {
        received += 1;
        const externalId = s.id;
        if (!account || !tenantId) {
          unresolved += 1;
          continue;
        }
        const mapped = STATUS_MAP[(s.status ?? "").toLowerCase()];
        if (!mapped) continue;

        const statusEventKey = `status:${externalId}:${mapped}`;
        if (statusKeySeen(statusEventKey)) {
          duplicates += 1;
          continue;
        }

        const target = await prisma.message.findUnique({
          where: { tenantId_whatsappMessageId: { tenantId, whatsappMessageId: externalId } },
          select: { id: true, conversationId: true, errorCode: true, errorMessage: true },
        });
        const errTitle = s.errors?.[0]?.title;
        const errCode = s.errors?.[0]?.code?.toString();
        if (target) {
          const updated = await prisma.message.update({
            where: { id: target.id },
            data: {
              status: mapped,
              errorCode: errCode ?? (mapped === "FAILED" ? target.errorCode : null),
              errorMessage: errTitle ?? (mapped === "FAILED" ? target.errorMessage : null),
            },
          });
          publish(tenantId, {
            type: "message.updated",
            conversationId: target.conversationId,
            message: toEventMessage(updated),
          });
        }
        // Unknown message: the status arrived before our row — record for replay.
        if (!target || mapped === "FAILED") {
          recordEvent({
            tenantId,
            eventType: "whatsapp.message.status",
            externalEventId: statusEventKey,
            payloadJson: JSON.stringify(s).slice(0, 65535),
            processingStatus: "PROCESSED",
            processedAt: new Date(),
          });
        }
        applied += 1;
      }
    }
  }

  return { received, applied, duplicates, unresolved };
}

/** Flow form answers (nfm_reply): attributed to the most recent flow sent to this phone (24h). */
async function recordFlowResponse(
  tenantId: string,
  externalId: string,
  phone: string,
  responseJson: string,
): Promise<void> {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const sent = await prisma.webhookEvent.findFirst({
      where: { tenantId, eventType: "whatsapp.flow.sent", receivedAt: { gte: since }, payloadJson: { contains: phone } },
      orderBy: { receivedAt: "desc" },
      select: { payloadJson: true },
    });
    let flowId: string | null = null;
    try {
      flowId = (JSON.parse(sent?.payloadJson ?? "{}") as { flowId?: string }).flowId ?? null;
    } catch { /* keep null */ }
    await prisma.whatsappFlowResponse.create({
      data: { tenantId, flowId, phone, responseJson: responseJson.slice(0, 20000) },
    });
    await prisma.webhookEvent.create({
      data: {
        tenantId,
        eventType: "whatsapp.flow.response",
        externalEventId: externalId,
        payloadJson: JSON.stringify({ flowId, phone, response: JSON.parse(responseJson) }).slice(0, 20000),
        processingStatus: "PROCESSED",
        processedAt: new Date(),
      },
    });
  } catch { /* best-effort only */ }
}
