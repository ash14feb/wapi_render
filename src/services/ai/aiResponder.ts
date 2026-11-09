import { prisma } from "../../config/prisma";
import { config as appConfig } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { sendTextMessage } from "../meta/meta-client";
import { publish, toEventMessage } from "../realtime";
import { isOptedOut } from "../whatsapp/optOut";
import { showTypingIndicator, clearTypingIndicator } from "../whatsapp/typing";
import { loadActiveKnowledge, loadActiveOffers, loadBusinessName } from "./aiContext.service";
import { getRuntimeAiConfig, type AiServiceError } from "./aiSettings.service";
import { AiProviderError, chatCompletion, isOfficialOpenAi } from "./openaiClient";
import {
  buildChatMessages,
  buildSystemPrompt,
  evaluateDiscountPolicy,
  mergeMemoryFacts,
  parseAiReply,
  parseJsonObject,
} from "./promptBuilder";
import type { AiParsedReply, AiPolicyResult, AiRuntimeConfig } from "./types";

export interface AiInboundContext {
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  encryptedAccessToken: string;
  conversationId: string;
  contactId: string;
  /** Contact snapshot from ingestion (falls back to a DB read when absent). */
  contact?: { id: string; phone: string; tags: string | null };
  /** Inbound wamid for typing-indicator refreshes. */
  inboundWamid?: string;
  inboundMessageId: string;
  text: string;
}

export interface AiOutcome {
  attempted: boolean;
  replySent: boolean;
  handoff: boolean;
  skippedReason?: string;
  error?: string;
}

const SAFE_POLICY_REPLY =
  "I'm not able to confirm that pricing here. Let me connect you with a team member who can help.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function excerpt(value: string | null | undefined, max = 2000): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function ensureState(tenantId: string, conversationId: string) {
  const existing = await prisma.aiConversationState.findUnique({ where: { conversationId } });
  if (existing) return existing;
  return prisma.aiConversationState
    .create({ data: { tenantId, conversationId } })
    .catch(async () => {
      const raced = await prisma.aiConversationState.findUnique({ where: { conversationId } });
      if (!raced) throw new Error("Unable to initialize AI conversation state");
      return raced;
    });
}

async function sendAiText(ctx: AiInboundContext, text: string): Promise<{ id: string; whatsappMessageId: string | null }> {
  let accessToken: string;
  try {
    accessToken = decryptToken(ctx.encryptedAccessToken);
  } catch {
    throw new Error("Unable to decrypt WhatsApp credential");
  }
  let whatsappMessageId: string;
  try {
    whatsappMessageId = await sendTextMessage({
      phoneNumberId: ctx.phoneNumberId,
      accessToken,
      graphVersion: appConfig.meta.graphVersion,
      to:
        ctx.contact?.phone ??
        (await prisma.contact.findUnique({ where: { id: ctx.contactId }, select: { phone: true } }))?.phone ??
        "",
      body: text.slice(0, 4096),
    });
  } finally {
    accessToken = "";
  }
  const saved = await prisma.message.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      whatsappMessageId,
      direction: "OUTBOUND",
      messageType: "AI",
      textContent: text.slice(0, 4096),
      status: "SENT",
      messageTimestamp: new Date(),
    },
  });
  publish(ctx.tenantId, {
    type: "message.created",
    conversationId: ctx.conversationId,
    message: toEventMessage(saved),
  });
  void prisma.conversation
    .update({ where: { id: ctx.conversationId }, data: { lastMessageAt: new Date() } })
    .catch(() => undefined);
  return { id: saved.id, whatsappMessageId };
}

async function logResponse(params: {
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId?: string | null;
  status: string;
  model?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  requestExcerpt?: string | null;
  responseExcerpt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await prisma.aiResponseLog
    .create({
      data: {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        inboundMessageId: params.inboundMessageId,
        outboundMessageId: params.outboundMessageId ?? null,
        status: params.status,
        model: params.model ?? null,
        latencyMs: params.latencyMs ?? null,
        promptTokens: params.promptTokens ?? null,
        completionTokens: params.completionTokens ?? null,
        requestExcerpt: excerpt(params.requestExcerpt),
        responseExcerpt: excerpt(params.responseExcerpt),
        errorCode: params.errorCode ?? null,
        errorMessage: excerpt(params.errorMessage),
      },
    })
    .catch(() => undefined);
}

async function summarizeConversation(
  config: AiRuntimeConfig,
  history: Array<{ direction: string; textContent: string | null }>,
  customerText: string,
  assistantReply: string,
  previousSummary: string | null,
): Promise<string> {
  const transcript = history
    .slice(-20)
    .map((m) => `${m.direction === "INBOUND" ? "Customer" : "Assistant"}: ${m.textContent ?? ""}`)
    .join("\n");
  const prompt = `You maintain a compact CRM memory for a WhatsApp sales conversation.
Write at most 6 sentences covering: customer identity, needs, budget, objections, offers quoted, decisions, and the next step.
Do not invent information. Return plain text only, no JSON.

Previous summary:
${previousSummary ?? "(none)"}

Transcript:
${transcript}
Customer: ${customerText}
Assistant: ${assistantReply}`;
  const result = await chatCompletion({
    baseUrl: config.providerBaseUrl,
    apiKey: config.apiKey,
    model: config.model,
    messages: [
      { role: "system", content: "You summarize sales conversations accurately and concisely." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    maxTokens: 350,
    timeoutMs: config.requestTimeoutMs,
    maxRetries: 0,
    jsonMode: false,
  });
  return result.content.trim().slice(0, 4000);
}

function policyLogStatus(policy: AiPolicyResult): string {
  return policy.violation ? "POLICY_VIOLATION" : "SUCCESS";
}

export async function handleInboundAi(ctx: AiInboundContext): Promise<AiOutcome> {
  const runtime = await getRuntimeAiConfig(ctx.tenantId);
  if (!runtime) return { attempted: false, replySent: false, handoff: false, skippedReason: "ai_not_configured" };

  const conversation = await prisma.conversation.findFirst({
    where: { id: ctx.conversationId, tenantId: ctx.tenantId },
    include: {
      contact: { select: { phone: true, name: true, profileName: true, tags: true } },
    },
  });
  if (!conversation) return { attempted: false, replySent: false, handoff: false, skippedReason: "conversation_not_found" };
  if (isOptedOut(conversation.contact.tags)) {
    return { attempted: false, replySent: false, handoff: false, skippedReason: "opted_out" };
  }

  const state = await ensureState(ctx.tenantId, ctx.conversationId);
  if (state.aiEnabled === false) {
    return { attempted: false, replySent: false, handoff: false, skippedReason: "ai_paused" };
  }

  const stale = new Date(Date.now() - 120_000);
  const lock = await prisma.aiConversationState.updateMany({
    where: {
      id: state.id,
      OR: [{ processingAt: null }, { processingAt: { lt: stale } }],
    },
    data: { processingAt: new Date() },
  });
  if (lock.count === 0) {
    return { attempted: true, replySent: false, handoff: false, skippedReason: "already_processing" };
  }

  const started = Date.now();
  const refreshTyping = () => {
    if (!ctx.inboundWamid) return;
    showTypingIndicator({
      conversationId: ctx.conversationId,
      phoneNumberId: ctx.phoneNumberId,
      encryptedAccessToken: ctx.encryptedAccessToken,
      inboundWamid: ctx.inboundWamid,
    });
  };
  try {
    const [businessName, knowledge, offers, history] = await Promise.all([
      loadBusinessName(ctx.tenantId),
      loadActiveKnowledge(ctx.tenantId),
      loadActiveOffers(ctx.tenantId),
      prisma.message.findMany({
        where: {
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId,
          id: { not: ctx.inboundMessageId },
          textContent: { not: null },
        },
        orderBy: { createdAt: "desc" },
        take: Math.max(2, runtime.historyWindow),
        select: { direction: true, textContent: true },
      }),
    ]);
    history.reverse();

    const memoryFacts = parseJsonObject<Record<string, string | null>>(state.factsJson) ?? {};
    const systemPrompt = buildSystemPrompt({
      config: runtime,
      businessName,
      knowledge,
      offers,
      memory: { summary: state.summary, facts: memoryFacts },
      contactName: conversation.contact.name ?? conversation.contact.profileName,
      inboundText: ctx.text,
    });
    const providerMessages = buildChatMessages({
      systemPrompt,
      history,
      currentText: ctx.text,
    });

    refreshTyping();
    const result = await chatCompletion({
      baseUrl: runtime.providerBaseUrl,
      apiKey: runtime.apiKey,
      model: runtime.model,
      messages: providerMessages,
      temperature: runtime.temperature,
      maxTokens: runtime.maxTokens,
      timeoutMs: runtime.requestTimeoutMs,
      maxRetries: runtime.maxRetries,
      jsonMode: isOfficialOpenAi(runtime.providerBaseUrl),
    });

    const parsed: AiParsedReply = parseAiReply(result.content);
    const policy = evaluateDiscountPolicy(parsed, offers, runtime.discountPolicy);
    const policyBlocked = policy.violation || policy.requireHandoff;
    const handoff = policyBlocked || (runtime.handoffEnabled && parsed.handoff);
    // A blocked reply may itself contain the unapproved discount, so replace it.
    let reply = policyBlocked ? runtime.fallbackMessage || SAFE_POLICY_REPLY : parsed.reply;
    if (!reply.trim()) reply = runtime.fallbackMessage || "Thanks for your message. A team member will follow up shortly.";

    if (handoff) {
      await prisma.conversation.update({
        where: { id: ctx.conversationId },
        data: { status: "PENDING_HUMAN" },
      }).catch(() => undefined);
      publish(ctx.tenantId, { type: "conversation.updated", conversationId: ctx.conversationId });
    }

    if (runtime.replyDelayMs > 0) {
      // Meta dismisses the typing indicator after ~25s; keep it alive while we wait.
      refreshTyping();
      await sleep(Math.min(runtime.replyDelayMs, 5000));
    }
    refreshTyping();

    // Re-check immediately before sending: a STOP or a human takeover may have
    // landed while the provider call was in flight.
    const [freshContact, freshState] = await Promise.all([
      prisma.contact.findUnique({ where: { id: ctx.contactId }, select: { tags: true } }),
      prisma.aiConversationState.findUnique({ where: { id: state.id }, select: { aiEnabled: true } }),
    ]);
    if (freshContact && isOptedOut(freshContact.tags)) {
      return { attempted: true, replySent: false, handoff: false, skippedReason: "opted_out" };
    }
    if (freshState?.aiEnabled === false) {
      return { attempted: true, replySent: false, handoff: false, skippedReason: "ai_paused" };
    }

    const saved = await sendAiText(ctx, reply);
    const mergedFacts = mergeMemoryFacts(state.factsJson, parsed.memory);
    const turns = state.turnsSinceSummary + 1;

    // Bookkeeping runs after the customer already has the reply: persist state,
    // refresh the summary every 8 turns (best-effort), and log the response.
    void prisma.aiConversationState
      .update({
        where: { id: state.id },
        data: {
          lastAiReplyAt: new Date(),
          factsJson: Object.keys(mergedFacts).length ? JSON.stringify(mergedFacts) : null,
          turnsSinceSummary: turns,
          consecutiveErrors: 0,
          lastError: null,
          ...(handoff ? { handoffAt: new Date() } : {}),
        },
      })
      .catch(() => undefined);

    if (turns >= 8) {
      void summarizeConversation(runtime, history, ctx.text, reply, state.summary)
        .then((summary) =>
          prisma.aiConversationState.update({
            where: { id: state.id },
            data: { summary, turnsSinceSummary: 0 },
          }),
        )
        .catch(() => undefined);
    }

    await logResponse({
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      inboundMessageId: ctx.inboundMessageId,
      outboundMessageId: saved.id,
      status: policyLogStatus(policy),
      model: result.model,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      requestExcerpt: ctx.text,
      responseExcerpt: reply,
      errorCode: policy.code,
      errorMessage: policy.message,
    });

    return { attempted: true, replySent: true, handoff };
  } catch (err) {
    let fallbackSent = false;
    const errorCode = err instanceof AiProviderError ? err.code : "AI_RESPONSE_FAILED";
    const message = err instanceof Error ? err.message : "AI response failed";
    const nextErrors = state.consecutiveErrors + 1;
    const shouldHandoff = nextErrors >= 3;
    if (shouldHandoff) {
      await prisma.conversation.update({
        where: { id: ctx.conversationId },
        data: { status: "PENDING_HUMAN" },
      }).catch(() => undefined);
      publish(ctx.tenantId, { type: "conversation.updated", conversationId: ctx.conversationId });
    }
    await prisma.aiConversationState.update({
      where: { id: state.id },
      data: {
        consecutiveErrors: nextErrors,
        lastError: message.slice(0, 2000),
        ...(shouldHandoff ? { handoffAt: new Date() } : {}),
      },
    }).catch(() => undefined);

    if (nextErrors === 1 && runtime.fallbackMessage) {
      try {
        await sendAiText(ctx, runtime.fallbackMessage);
        fallbackSent = true;
      } catch {
        // Do not mask the original provider error.
      }
    }

    await logResponse({
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      inboundMessageId: ctx.inboundMessageId,
      status: "FAILED",
      model: runtime.model,
      latencyMs: Date.now() - started,
      requestExcerpt: ctx.text,
      errorCode,
      errorMessage: message,
    });

    return { attempted: true, replySent: fallbackSent, handoff: shouldHandoff, error: message };
  } finally {
    if (ctx.inboundWamid) clearTypingIndicator(ctx.conversationId);
    await prisma.aiConversationState
      .update({ where: { id: state.id }, data: { processingAt: null } })
      .catch(() => undefined);
  }
}

export type { AiServiceError };
