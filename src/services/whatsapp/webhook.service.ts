import { prisma } from "../../config/prisma";
import { webhookPayloadSchema } from "../../validators/webhook.validator";
import { publish, toEventMessage } from "../realtime";
import { handleInboundBot } from "./botEngine";

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
}): string | undefined {
  if (m.type === "text" || m.text?.body) return m.text?.body;
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
    await prisma.webhookEvent.create({
      data: {
        tenantId: null,
        eventType: "whatsapp.unknown",
        externalEventId: null,
        payloadJson: rawJson,
        processingStatus: "FAILED",
        errorMessage: "Unrecognized webhook payload shape",
      },
    });
    return { received: 0, applied: 0, duplicates: 0, unresolved: 1 };
  }

  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id;

      const account = phoneNumberId
        ? await prisma.whatsappAccount.findFirst({ where: { phoneNumberId } })
        : null;
      const tenantId = account?.tenantId ?? null;

      const profileName = value.contacts?.[0]?.profile?.name;

      for (const m of value.messages ?? []) {
        received += 1;
        const externalId = m.id;
        if (!account || !tenantId) {
          unresolved += 1;
          await prisma.webhookEvent.create({
            data: {
              tenantId: null,
              eventType: "whatsapp.message.inbound",
              externalEventId: `${phoneNumberId ?? "unknown"}:${externalId}`,
              payloadJson: JSON.stringify(m).slice(0, 65535),
              processingStatus: "UNRESOLVED_TENANT",
              errorMessage: "No WhatsApp account matched phone_number_id",
            },
          });
          continue;
        }

        // Idempotency: wamid unique per tenant.
        const existing = await prisma.message.findUnique({
          where: { tenantId_whatsappMessageId: { tenantId, whatsappMessageId: externalId } },
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
        });

        try {
          const [created] = await prisma.$transaction([
            prisma.message.create({
              data: {
                tenantId,
                conversationId: conversation.id,
                whatsappMessageId: externalId,
                direction: "INBOUND",
                messageType: (m.type ?? "TEXT").toUpperCase(),
                textContent: messageText(m),
                mediaId: messageMediaId(m),
                status: "RECEIVED",
                messageTimestamp: toDate(m.timestamp),
              },
            }),
            prisma.webhookEvent.create({
              data: {
                tenantId,
                eventType: "whatsapp.message.inbound",
                externalEventId: externalId,
                payloadJson: JSON.stringify(m).slice(0, 65535),
                processingStatus: "PROCESSED",
                processedAt: new Date(),
              },
            }),
          ]);
          applied += 1;
          publish(tenantId, {
            type: "message.created",
            conversationId: conversation.id,
            message: toEventMessage(created),
          });
          // Rule-based bot reply: fire-and-forget, never blocks webhook 200.
          const inboundText = messageText(m);
          if (inboundText) {
            void handleInboundBot({
              tenantId,
              accountId: account.id,
              phoneNumberId: account.phoneNumberId,
              encryptedAccessToken: account.encryptedAccessToken,
              conversationId: conversation.id,
              contactId: contact.id,
              text: inboundText,
            }).catch(() => undefined);
          }
        } catch (err) {
          // Unique-conflict race on retry → duplicate, not an error.
          if ((err as { code?: string }).code === "P2002") duplicates += 1;
          else {
            await prisma.webhookEvent.create({
              data: {
                tenantId,
                eventType: "whatsapp.message.inbound",
                externalEventId: externalId,
                payloadJson: JSON.stringify(m).slice(0, 65535),
                processingStatus: "FAILED",
                errorMessage: err instanceof Error ? err.message : "persist failed",
              },
            });
          }
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

        const existingEvent = await prisma.webhookEvent.findFirst({
          where: { tenantId, externalEventId: `status:${externalId}:${mapped}` },
        });
        if (existingEvent) {
          duplicates += 1;
          continue;
        }

        const target = await prisma.message.findUnique({
          where: { tenantId_whatsappMessageId: { tenantId, whatsappMessageId: externalId } },
        });
        const errTitle = s.errors?.[0]?.title;
        const errCode = s.errors?.[0]?.code?.toString();
        if (target) {
          const [updated] = await prisma.$transaction([
            prisma.message.update({
              where: { id: target.id },
              data: {
                status: mapped,
                errorCode: errCode ?? (mapped === "FAILED" ? target.errorCode : null),
                errorMessage: errTitle ?? (mapped === "FAILED" ? target.errorMessage : null),
              },
            }),
            prisma.webhookEvent.create({
              data: {
                tenantId,
                eventType: "whatsapp.message.status",
                externalEventId: `status:${externalId}:${mapped}`,
                payloadJson: JSON.stringify(s).slice(0, 65535),
                processingStatus: "PROCESSED",
                processedAt: new Date(),
              },
            }),
          ]);
          publish(tenantId, {
            type: "message.updated",
            conversationId: target.conversationId,
            message: toEventMessage(updated),
          });
        } else {
          // Status for unknown message: record event, resolve later if message arrives.
          await prisma.webhookEvent.create({
            data: {
              tenantId,
              eventType: "whatsapp.message.status",
              externalEventId: `status:${externalId}:${mapped}`,
              payloadJson: JSON.stringify(s).slice(0, 65535),
              processingStatus: "PROCESSED",
              processedAt: new Date(),
            },
          });
        }
        applied += 1;
      }
    }
  }

  return { received, applied, duplicates, unresolved };
}
