import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { sendMediaMessage, sendTextMessage } from "../meta/meta-client";
import { publish, toEventMessage, type RealtimeMessage } from "../realtime";
import { WhatsappServiceError } from "./whatsapp.service";
import { isOptedOut, OPTED_OUT_MESSAGE } from "./optOut";
import type { SendMessageInput } from "../../validators/conversations.validator";

type MessageDto = RealtimeMessage;

const PAGE_SIZE = 50;

export async function listConversations(tenantId: string, search?: string, cursor?: string, limit = 25) {
  const take = Math.min(Math.max(limit, 1), 50);
  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      ...(search
        ? {
            contact: {
              OR: [
                { phone: { startsWith: search } },
                { name: { startsWith: search } },
                { profileName: { startsWith: search } },
              ],
            },
          }
        : {}),
    },
    include: {
      contact: { select: { id: true, phone: true, name: true, profileName: true } },
      whatsappAccount: { select: { id: true, businessName: true, displayPhoneNumber: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1, // fetch one extra to compute nextCursor
  });

  // Single aggregate for unread counts across the page (no per-row _count N+1).
  const ids = conversations.map((c) => c.id);
  const unreadGroups =
    ids.length > 0
      ? await prisma.message.groupBy({
          by: ["conversationId"],
          where: { tenantId, conversationId: { in: ids }, direction: "INBOUND", status: "RECEIVED" },
          _count: true,
        })
      : [];
  const unreadByConv = new Map(unreadGroups.map((g) => [g.conversationId, g._count]));

  const hasMore = conversations.length > take;
  const page = hasMore ? conversations.slice(0, take) : conversations;
  return {
    items: page.map((c) => ({
      id: c.id,
      status: c.status,
      lastMessageAt: c.lastMessageAt,
      contact: c.contact,
      whatsappAccount: c.whatsappAccount,
      lastMessage: c.messages[0] ?? null,
      unreadCount: unreadByConv.get(c.id) ?? 0,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function getConversation(tenantId: string, id: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
    include: {
      contact: { select: { id: true, phone: true, name: true, profileName: true, tags: true } },
      whatsappAccount: { select: { id: true, businessName: true, displayPhoneNumber: true } },
    },
  });
  if (!conversation) throw new WhatsappServiceError("CONVERSATION_NOT_FOUND", "Conversation not found", 404);
  return conversation;
}

export async function listMessages(tenantId: string, conversationId: string, cursor?: string, limit = 50) {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  });
  if (!convo) throw new WhatsappServiceError("CONVERSATION_NOT_FOUND", "Conversation not found", 404);
  const take = Math.min(Math.max(limit, 1), 100);
  const items = await prisma.message.findMany({
    where: { tenantId, conversationId },
    orderBy: { createdAt: "desc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1,
  });
  const hasMore = items.length > take;
  const page = hasMore ? items.slice(0, take) : items;
  return { items: [...page].reverse(), nextCursor: hasMore ? page[page.length - 1].id : null };
}

export async function sendConversationText(
  tenantId: string,
  conversationId: string,
  text: string,
): Promise<{ whatsappMessageId: string; messageId: string }> {
  return sendConversationMessage(tenantId, conversationId, { text });
}

/**
 * Persists the outbound row as SENDING *before* calling Meta, so the reply is
 * visible to every inbox immediately and a failure is recorded as FAILED on
 * the same row. The caller gets the row id back as soon as Meta accepts.
 */
export async function sendConversationMessage(
  tenantId: string,
  conversationId: string,
  input: SendMessageInput,
): Promise<{ whatsappMessageId: string; messageId: string; message: MessageDto }> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      contact: { select: { phone: true, tags: true } },
      whatsappAccount: {
        select: { phoneNumberId: true, encryptedAccessToken: true },
      },
    },
  });
  if (!conversation) {
    throw new WhatsappServiceError("CONVERSATION_NOT_FOUND", "Conversation not found", 404);
  }
  if (isOptedOut(conversation.contact.tags)) {
    throw new WhatsappServiceError("CONTACT_OPTED_OUT", OPTED_OUT_MESSAGE, 403);
  }

  const isMedia = "mediaKind" in input;
  const messageType = isMedia ? input.mediaKind.toUpperCase() : "TEXT";
  const textContent = isMedia ? input.caption ?? null : (input as { text: string }).text;

  let accessToken: string;
  try {
    accessToken = decryptToken(conversation.whatsappAccount.encryptedAccessToken);
  } catch {
    throw new WhatsappServiceError("WHATSAPP_CREDENTIAL_ERROR", "Unable to decrypt WhatsApp credential", 500);
  }

  const pending = await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      messageType,
      textContent,
      ...(isMedia && input.mediaId ? { mediaId: input.mediaId } : {}),
      status: "SENDING",
      messageTimestamp: new Date(),
    },
  });
  publish(tenantId, {
    type: "message.created",
    conversationId: conversation.id,
    message: toEventMessage(pending),
  });

  let whatsappMessageId: string;
  try {
    const common = {
      phoneNumberId: conversation.whatsappAccount.phoneNumberId,
      accessToken,
      graphVersion: config.meta.graphVersion,
      to: conversation.contact.phone,
    };
    whatsappMessageId = isMedia
      ? await sendMediaMessage({
          ...common,
          kind: input.mediaKind,
          id: input.mediaId,
          link: input.mediaLink,
          caption: input.caption,
          filename: input.filename,
        })
      : await sendTextMessage({ ...common, body: (input as { text: string }).text });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Meta send failed";
    await prisma.message
      .update({
        where: { id: pending.id },
        data: { status: "FAILED", errorMessage: errorMessage.slice(0, 2000) },
      })
      .catch(() => undefined);
    publish(tenantId, {
      type: "message.updated",
      conversationId: conversation.id,
      message: toEventMessage({ ...pending, status: "FAILED" }),
    });
    throw new WhatsappServiceError(
      "WHATSAPP_SEND_FAILED",
      errorMessage,
      (err as { status?: number }).status ?? 502,
    );
  } finally {
    accessToken = "";
  }

  const saved = await prisma.message.update({
    where: { id: pending.id },
    data: { whatsappMessageId, status: "SENT" },
  });
  publish(tenantId, {
    type: "message.updated",
    conversationId: conversation.id,
    message: toEventMessage(saved),
  });
  void prisma.conversation
    .update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } })
    .catch(() => undefined);

  return { whatsappMessageId, messageId: saved.id, message: toEventMessage(saved) };
}
