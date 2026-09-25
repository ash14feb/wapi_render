import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { sendTextMessage } from "../meta/meta-client";
import { publish, toEventMessage } from "../realtime";

/**
 * Rule-based chatbot: matches inbound text against tenant BotRules and replies.
 * Runs fire-and-forget AFTER the webhook 200 — never blocks ingestion.
 * Precedence: EXACT > STARTS_WITH > CONTAINS > DEFAULT. Per-number rules
 * (whatsappAccountId set) beat global rules at the same match level.
 */

interface BotContext {
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  encryptedAccessToken: string;
  conversationId: string;
  contactId: string;
  text: string;
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

export async function handleInboundBot(ctx: BotContext): Promise<void> {
  const text = ctx.text.trim().toLowerCase();
  if (!text) return;

  // Built-in opt-out: STOP/UNSUBSCRIBE tags the contact, no reply.
  if (text === "stop" || text === "unsubscribe" || text === "opt out" || text === "opt-out") {
    await prisma.contact.update({
      where: { id: ctx.contactId },
      data: { tags: "opted_out" },
    }).catch(() => undefined);
    return;
  }

  const rules = await prisma.botRule.findMany({
    where: {
      tenantId: ctx.tenantId,
      active: true,
      OR: [{ whatsappAccountId: null }, { whatsappAccountId: ctx.accountId }],
    },
    orderBy: { sortOrder: "asc" },
    take: 100,
  });

  let best: (typeof rules[number]) | null = null;
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
  if (!best) return;

  // Handoff: mark conversation for a human instead of replying.
  if (best.handoff) {
    await prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { status: "PENDING_HUMAN" },
    }).catch(() => undefined);
    publish(ctx.tenantId, { type: "conversation.updated", conversationId: ctx.conversationId });
    if (!best.replyText.trim()) return; // handoff-only rule, no auto message
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(ctx.encryptedAccessToken);
  } catch {
    return;
  }
  let whatsappMessageId: string;
  try {
    whatsappMessageId = await sendTextMessage({
      phoneNumberId: ctx.phoneNumberId,
      accessToken,
      graphVersion: config.meta.graphVersion,
      to: (await prisma.contact.findUnique({ where: { id: ctx.contactId }, select: { phone: true } }))?.phone ?? "",
      body: best.replyText,
    });
  } catch {
    return;
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
}
