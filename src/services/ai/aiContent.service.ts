import { prisma } from "../../config/prisma";
import type {
  AiConversationStateInput,
  KnowledgeEntryInput,
  OfferInput,
  UpdateKnowledgeEntryInput,
  UpdateOfferInput,
} from "../../validators/ai.validator";
import { AiServiceError } from "./aiSettings.service";

export async function listKnowledge(tenantId: string) {
  return prisma.aiKnowledgeEntry.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function createKnowledge(tenantId: string, input: KnowledgeEntryInput) {
  return prisma.aiKnowledgeEntry.create({
    data: {
      tenantId,
      title: input.title.trim(),
      content: input.content.trim(),
      category: input.category?.trim() || null,
      active: input.active,
      sortOrder: input.sortOrder,
    },
  });
}

export async function updateKnowledge(tenantId: string, id: string, input: UpdateKnowledgeEntryInput) {
  const existing = await prisma.aiKnowledgeEntry.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw new AiServiceError("KNOWLEDGE_NOT_FOUND", "Knowledge entry not found", 404);
  return prisma.aiKnowledgeEntry.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content.trim() } : {}),
      ...(input.category !== undefined ? { category: input.category?.trim() || null } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
}

export async function deleteKnowledge(tenantId: string, id: string) {
  const existing = await prisma.aiKnowledgeEntry.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw new AiServiceError("KNOWLEDGE_NOT_FOUND", "Knowledge entry not found", 404);
  await prisma.aiKnowledgeEntry.delete({ where: { id: existing.id } });
  return { deleted: true };
}

function offerData(input: OfferInput | UpdateOfferInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.code !== undefined) data.code = input.code?.trim() || null;
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.discountType !== undefined) data.discountType = input.discountType;
  if (input.discountValue !== undefined) data.discountValue = input.discountValue;
  if (input.minOrderValue !== undefined) data.minOrderValue = input.minOrderValue ?? null;
  if (input.maxDiscountValue !== undefined) data.maxDiscountValue = input.maxDiscountValue ?? null;
  if (input.validFrom !== undefined) data.validFrom = input.validFrom ? new Date(input.validFrom) : null;
  if (input.validTo !== undefined) data.validTo = input.validTo ? new Date(input.validTo) : null;
  if (input.active !== undefined) data.active = input.active;
  return data;
}

export async function listOffers(tenantId: string) {
  return prisma.aiOffer.findMany({
    where: { tenantId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

export async function createOffer(tenantId: string, input: OfferInput) {
  try {
    return await prisma.aiOffer.create({
      data: {
        tenantId,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        description: input.description?.trim() || null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minOrderValue: input.minOrderValue ?? null,
        maxDiscountValue: input.maxDiscountValue ?? null,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validTo: input.validTo ? new Date(input.validTo) : null,
        active: input.active,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw new AiServiceError("OFFER_CODE_DUPLICATE", "An offer with this code already exists", 409);
    }
    throw err;
  }
}

export async function updateOffer(tenantId: string, id: string, input: UpdateOfferInput) {
  const existing = await prisma.aiOffer.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw new AiServiceError("OFFER_NOT_FOUND", "Offer not found", 404);
  try {
    return await prisma.aiOffer.update({ where: { id: existing.id }, data: offerData(input) });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw new AiServiceError("OFFER_CODE_DUPLICATE", "An offer with this code already exists", 409);
    }
    throw err;
  }
}

export async function deleteOffer(tenantId: string, id: string) {
  const existing = await prisma.aiOffer.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw new AiServiceError("OFFER_NOT_FOUND", "Offer not found", 404);
  await prisma.aiOffer.delete({ where: { id: existing.id } });
  return { deleted: true };
}

export async function listResponseLogs(
  tenantId: string,
  options: { status?: string; cursor?: string; limit?: number } = {},
) {
  const take = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const items = await prisma.aiResponseLog.findMany({
    where: {
      tenantId,
      ...(options.status ? { status: options.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    take: take + 1,
  });
  const hasMore = items.length > take;
  const page = hasMore ? items.slice(0, take) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
}

export async function getAiStats(tenantId: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [groups, handoffs, knowledgeCount, offersCount] = await Promise.all([
    prisma.aiResponseLog.groupBy({
      by: ["status"],
      where: { tenantId, createdAt: { gte: start } },
      _count: true,
    }),
    prisma.aiConversationState.count({ where: { tenantId, handoffAt: { gte: start } } }),
    prisma.aiKnowledgeEntry.count({ where: { tenantId, active: true } }),
    prisma.aiOffer.count({ where: { tenantId, active: true } }),
  ]);
  const byStatus: Record<string, number> = {};
  for (const group of groups) byStatus[group.status] = group._count;
  return {
    repliesToday: byStatus.SUCCESS ?? 0,
    handoffsToday: handoffs,
    errorsToday: byStatus.FAILED ?? 0,
    policyViolationsToday: byStatus.POLICY_VIOLATION ?? 0,
    knowledgeCount,
    offersCount,
  };
}

async function assertConversation(tenantId: string, conversationId: string): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  });
  if (!conversation) throw new AiServiceError("CONVERSATION_NOT_FOUND", "Conversation not found", 404);
}

export async function getConversationAiState(tenantId: string, conversationId: string) {
  await assertConversation(tenantId, conversationId);
  const state = await prisma.aiConversationState.findUnique({ where: { conversationId } });
  if (!state) {
    return {
      conversationId,
      aiEnabled: null,
      summary: null,
      facts: {},
      handoffAt: null,
      lastAiReplyAt: null,
      consecutiveErrors: 0,
      lastError: null,
    };
  }
  let facts: Record<string, unknown> = {};
  try {
    facts = state.factsJson ? (JSON.parse(state.factsJson) as Record<string, unknown>) : {};
  } catch {
    facts = {};
  }
  return {
    conversationId,
    aiEnabled: state.aiEnabled,
    summary: state.summary,
    facts,
    handoffAt: state.handoffAt?.toISOString() ?? null,
    lastAiReplyAt: state.lastAiReplyAt?.toISOString() ?? null,
    consecutiveErrors: state.consecutiveErrors,
    lastError: state.lastError,
  };
}

export async function updateConversationAiState(
  tenantId: string,
  conversationId: string,
  input: AiConversationStateInput,
) {
  await assertConversation(tenantId, conversationId);
  const existing = await prisma.aiConversationState.findUnique({ where: { conversationId } });
  const data: Record<string, unknown> = {};
  if (input.aiEnabled !== undefined) data.aiEnabled = input.aiEnabled;
  if (input.resetMemory) {
    data.summary = null;
    data.factsJson = null;
    data.turnsSinceSummary = 0;
    data.consecutiveErrors = 0;
    data.lastError = null;
  }
  if (input.aiEnabled === true) {
    data.handoffAt = null;
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: "OPEN" } });
  }
  if (existing) {
    await prisma.aiConversationState.update({ where: { id: existing.id }, data });
  } else {
    await prisma.aiConversationState.create({ data: { tenantId, conversationId, ...data } });
  }
  return getConversationAiState(tenantId, conversationId);
}
