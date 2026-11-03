import { handleInboundAi, type AiInboundContext, type AiOutcome } from "../ai/aiResponder";
import { handleInboundBot, type BotContext, type BotOutcome } from "./botEngine";

/**
 * Inbound automation precedence:
 *   opt-out → keyword rules → AI sales agent → DEFAULT rule fallback.
 *
 * Deterministic keyword rules always win, so businesses keep exact control over
 * pricing/telephone answers; the AI only sees messages no specific rule matched.
 */

export interface InboundAutomationContext extends BotContext {
  inboundMessageId: string;
}

export interface AutomationOutcome {
  source: "BOT" | "AI" | "DEFAULT" | "NONE";
  bot: BotOutcome;
  ai?: AiOutcome;
}

export async function handleInboundAutomation(
  ctx: InboundAutomationContext,
): Promise<AutomationOutcome> {
  const bot = await handleInboundBot(ctx, { deferDefault: true });
  if (bot.replySent || bot.handoff) return { source: "BOT", bot };

  // A specific rule matched but its send failed: don't try a second reply path.
  if (bot.matchedType && bot.matchedType !== "DEFAULT") return { source: "BOT", bot };
  if (
    bot.skippedReason === "opted_out" ||
    bot.skippedReason === "empty_text" ||
    bot.skippedReason === "contact_not_found"
  ) {
    return { source: "NONE", bot };
  }

  const aiCtx: AiInboundContext = {
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    phoneNumberId: ctx.phoneNumberId,
    encryptedAccessToken: ctx.encryptedAccessToken,
    conversationId: ctx.conversationId,
    contactId: ctx.contactId,
    inboundMessageId: ctx.inboundMessageId,
    text: ctx.text,
  };
  let ai: AiOutcome;
  try {
    ai = await handleInboundAi(aiCtx);
  } catch (err) {
    // Never let an AI/DB failure suppress the deterministic DEFAULT rule.
    ai = {
      attempted: true,
      replySent: false,
      handoff: false,
      error: err instanceof Error ? err.message : "ai_failed",
    };
  }
  if (ai.replySent || ai.handoff) return { source: "AI", bot, ai };

  // A human owns this conversation: don't let the DEFAULT rule talk over them.
  if (ai.skippedReason === "ai_paused" || ai.skippedReason === "pending_human") {
    return { source: "NONE", bot, ai };
  }

  if (ai.attempted || bot.matchedType === "DEFAULT") {
    const fallback = await handleInboundBot(ctx, { defaultRuleOnly: true });
    if (fallback.replySent || fallback.handoff) return { source: "DEFAULT", bot, ai };
  }

  return { source: "NONE", bot, ai };
}
