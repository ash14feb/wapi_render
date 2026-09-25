import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { sendError, sendSuccess } from "../utils/response";

/** GET /api/v1/dashboard/summary — tenant-scoped aggregates (no per-record scan). */
export async function dashboardSummaryHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const tenantId = req.auth.tenantId;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [messagesToday, deliveredToday, openConversations, totalCampaigns, account] = await Promise.all([
    prisma.message.count({ where: { tenantId, createdAt: { gte: startOfDay } } }),
    prisma.message.count({ where: { tenantId, status: "DELIVERED", createdAt: { gte: startOfDay } } }),
    prisma.conversation.count({ where: { tenantId, status: "OPEN" } }),
    prisma.campaign.count({ where: { tenantId } }),
    prisma.whatsappAccount.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        businessName: true,
        displayPhoneNumber: true,
        wabaId: true,
        phoneNumberId: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  sendSuccess(res, {
    messagesToday,
    deliveredToday,
    openConversations,
    totalCampaigns,
    whatsapp: account
      ? { ...account, connected: account.status === "ACTIVE" }
      : null,
  });
}
