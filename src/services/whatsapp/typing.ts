import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { markReadWithTyping } from "../meta/meta-client";

/**
 * Native WhatsApp typing indicator, shown the moment an inbound message lands.
 * Meta dismisses it after ~25s, so `pingTyping` re-sends at most every 20s per
 * conversation. Never throws: a failed indicator must not affect replies.
 */

const PING_INTERVAL_MS = 20_000;
const lastPingByConversation = new Map<string, number>();

export interface TypingContext {
  conversationId: string;
  phoneNumberId: string;
  encryptedAccessToken: string;
  inboundWamid: string;
}

export function showTypingIndicator(ctx: TypingContext): void {
  const now = Date.now();
  const last = lastPingByConversation.get(ctx.conversationId) ?? 0;
  if (now - last < PING_INTERVAL_MS) return;
  lastPingByConversation.set(ctx.conversationId, now);
  if (lastPingByConversation.size > 5000) {
    for (const [key, at] of lastPingByConversation) {
      if (now - at > PING_INTERVAL_MS) lastPingByConversation.delete(key);
    }
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(ctx.encryptedAccessToken);
  } catch {
    return;
  }
  void markReadWithTyping({
    phoneNumberId: ctx.phoneNumberId,
    accessToken,
    graphVersion: config.meta.graphVersion,
    messageId: ctx.inboundWamid,
  }).catch(() => undefined);
}

export function clearTypingIndicator(conversationId: string): void {
  lastPingByConversation.delete(conversationId);
}
