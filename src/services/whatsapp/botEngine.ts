import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { sendTextMessage } from "../meta/meta-client";
import { publish, toEventMessage } from "../realtime";
import { isOptOutRequest, isOptedOut, markOptedOut } from "./optOut";

/**
 * Rule-based chatbot: matches inbound text against tenant BotRules and replies.
 * Runs fire-and-forget AFTER the webhook 200 — never blocks ingestion.
 * Precedence: EXACT > STARTS_WITH > CONTAINS > DEFAULT. Per-number rules
 * (whatsappAccountId set) beat global rules at the same match level.
 */

export interface BotContext {
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  encryptedAccessToken: string;
  conversationId: string;
  contactId: string;
  text: string;
}

export interface BotOutcome {
  attempted: boolean;
  matchedType: string | null;
  replySent: boolean;
  handoff: boolean;
  skippedReason?: string;
  error?: string;
}

export interface BotOptions {
  /** When the best match is DEFAULT, don't send it yet (AI gets a chance first). */
  deferDefault?: boolean;
  /** Only consider DEFAULT rules (used as the final fallback after AI). */
  defaultRuleOnly?: boolean;
}

type BotRuleRecord = {
  id: string;
  matchType: string;
  trigger: string;
  replyText: string;
  handoff: boolean;
  whatsappAccountId: string | null;
};

function skipped(reason: string, attempted = true): BotOutcome {
  return { attempted, matchedType: null, replySent: false, handoff: false, skippedReason: reason };
}

function ruleMatches(matchType: string, trigger: string, text: string): boolean {
  const t = trigger.trim().toLowerCase();
  if (matchType === "DEFAULT") return true;
  if (!t) return false;
  if (matchType === "EXACT") return text === t;
  if (matchType === "STARTS_WITH") return text.startsWith(t);
  return text.includes(t); // CONTAINS
}

const RANK: Record<string, number> = { EXACT: 0, STARTS_WITH: 1, CONTAINS: 2, DEFAULT: 3 };

export async function handleInboundBot(ctx: BotContext, options: BotOptions = {}): Promise<BotOutcome> {
  const text = ctx.text.trim().toLowerCase();
  if (!text) return skipped("empty_text", false);

  // Built-in opt-out: STOP/UNSUBSCRIBE tags the contact, no reply.
  if (isOptOutRequest(text)) {
    await markOptedOut(ctx.contactId).catch(() => undefined);
    return skipped("opted_out");
  }

  const contact = await prisma.contact.findUnique({
    where: { id: ctx.contactId },
    select: { phone: true, tags: true },
  });
  // Never auto-reply to a contact that has opted out (defense in depth —
  // webhook ingestion normally clears the tag on a fresh inbound message).
  if (!contact) return skipped("contact_not_found");
  if (isOptedOut(contact.tags)) return skipped("opted_out");

  const rules = await prisma.botRule.findMany({
    where: {
      tenantId: ctx.tenantId,
      active: true,
      ...(options.defaultRuleOnly
        ? { matchType: "DEFAULT" }
        : { OR: [{ whatsappAccountId: null }, { whatsappAccountId: ctx.accountId }] }),
    },
    orderBy: { sortOrder: "asc" },
    take: 100,
  });

  let best: BotRuleRecord | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const r of rules) {
    if (!ruleMatches(r.matchType, r.trigger, text)) continue;
    const scoped = r.whatsappAccountId ? -0.5 : 0; // per-number wins ties
    const rank = (RANK[r.matchType] ?? 3) + scoped;
    if (rank < bestRank) {
      best = r;
      bestRank = rank;
    }
  }
  if (!best) return skipped("no_match");

  // AI fallback sits between specific keyword rules and the DEFAULT rule.
  if (best.matchType === "DEFAULT" && options.deferDefault) {
    return {
      attempted: true,
      matchedType: "DEFAULT",
      replySent: false,
      handoff: false,
      skippedReason: "deferred_default",
    };
  }

  // Handoff: mark conversation for a human instead of replying.
  if (best.handoff) {
    await prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { status: "PENDING_HUMAN" },
    }).catch(() => undefined);
    publish(ctx.tenantId, { type: "conversation.updated", conversationId: ctx.conversationId });
    if (!best.replyText.trim()) {
      return { attempted: true, matchedType: best.matchType, replySent: false, handoff: true };
    }
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(ctx.encryptedAccessToken);
  } catch {
    return {
      attempted: true,
      matchedType: best.matchType,
      replySent: false,
      handoff: false,
      error: "credential_decrypt_failed",
    };
  }
  let whatsappMessageId: string;
  try {
    whatsappMessageId = await sendTextMessage({
      phoneNumberId: ctx.phoneNumberId,
      accessToken,
      graphVersion: config.meta.graphVersion,
      to: contact.phone,
      body: best.replyText,
    });
  } catch (err) {
    return {
      attempted: true,
      matchedType: best.matchType,
      replySent: false,
      handoff: best.handoff,
      error: err instanceof Error ? err.message : "send_failed",
    };
  } finally {
    accessToken = "";
  }

  try {
    const saved = await prisma.message.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        whatsappMessageId,
        direction: "OUTBOUND",
        messageType: "BOT",
        textContent: best.replyText.slice(0, 4096),
        status: "SENT",
        messageTimestamp: new Date(),
      },
    });
    await prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { lastMessageAt: new Date() },
    });
    publish(ctx.tenantId, {
      type: "message.created",
      conversationId: ctx.conversationId,
      message: toEventMessage(saved),
    });
  } catch {
    // reply sent on Meta but not persisted — acceptable, webhook status update will reconcile
  }

  return { attempted: true, matchedType: best.matchType, replySent: true, handoff: best.handoff };
}
