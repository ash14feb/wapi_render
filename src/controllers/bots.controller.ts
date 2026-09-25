import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { botRuleSchema, updateBotRuleSchema } from "../validators/bots.validator";
import { sendError, sendSuccess } from "../utils/response";

/** GET /api/v1/bots/rules */
export async function listBotRulesHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  sendSuccess(
    res,
    await prisma.botRule.findMany({
      where: { tenantId: req.auth.tenantId },
      include: { whatsappAccount: { select: { id: true, businessName: true, displayPhoneNumber: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 200,
    }),
  );
}

/** POST /api/v1/bots/rules */
export async function createBotRuleHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = botRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  if (parsed.data.whatsappAccountId) {
    const ok = await prisma.whatsappAccount.findFirst({
      where: { id: parsed.data.whatsappAccountId, tenantId: req.auth.tenantId },
      select: { id: true },
    });
    if (!ok) {
      sendError(res, "WHATSAPP_ACCOUNT_NOT_FOUND", "WhatsApp number not found", 404);
      return;
    }
  }
  sendSuccess(
    res,
    await prisma.botRule.create({
      data: {
        tenantId: req.auth.tenantId,
        name: parsed.data.name,
        whatsappAccountId: parsed.data.whatsappAccountId ?? null,
        matchType: parsed.data.matchType,
        trigger: parsed.data.matchType === "DEFAULT" ? "" : parsed.data.trigger,
        replyText: parsed.data.replyText,
        handoff: parsed.data.handoff,
        active: parsed.data.active,
        sortOrder: parsed.data.sortOrder,
      },
    }),
    201,
  );
}

/** PUT /api/v1/bots/rules/:id */
export async function updateBotRuleHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = updateBotRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  const existing = await prisma.botRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  });
  if (!existing) {
    sendError(res, "BOT_RULE_NOT_FOUND", "Bot rule not found", 404);
    return;
  }
  sendSuccess(
    res,
    await prisma.botRule.update({
      where: { id: existing.id },
      data: {
        ...parsed.data,
        whatsappAccountId: parsed.data.whatsappAccountId ?? undefined,
      },
    }),
  );
}

/** DELETE /api/v1/bots/rules/:id */
export async function deleteBotRuleHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const existing = await prisma.botRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  });
  if (!existing) {
    sendError(res, "BOT_RULE_NOT_FOUND", "Bot rule not found", 404);
    return;
  }
  await prisma.botRule.delete({ where: { id: existing.id } });
  sendSuccess(res, { deleted: true });
}
