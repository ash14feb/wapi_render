import type { Request, Response } from "express";
import {
  cancelCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
  sendCampaign,
} from "../services/whatsapp/campaigns.service";
import { WhatsappServiceError } from "../services/whatsapp/whatsapp.service";
import { createCampaignSchema } from "../validators/campaigns.validator";
import { sendError, sendSuccess } from "../utils/response";

function requireAuth(req: Request): req is Request & { auth: NonNullable<Request["auth"]> } {
  return !!req.auth;
}

export async function listCampaignsHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 25;
  sendSuccess(res, await listCampaigns(req.auth.tenantId, cursor, limit));
}

export async function createCampaignHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await createCampaign(req.auth.tenantId, parsed.data), 201);
  } catch (err) {
    if (err instanceof WhatsappServiceError) sendError(res, err.code, err.message, err.status);
    else sendError(res, "CAMPAIGN_FAILED", "Unable to create campaign", 500);
  }
}

export async function getCampaignHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    const recipientCursor = typeof req.query.recipientCursor === "string" ? req.query.recipientCursor : undefined;
    const recipientLimit = typeof req.query.recipientLimit === "string" ? Number(req.query.recipientLimit) : 50;
    sendSuccess(res, await getCampaign(req.auth.tenantId, req.params.id, recipientCursor, recipientLimit));
  } catch (err) {
    if (err instanceof WhatsappServiceError) sendError(res, err.code, err.message, err.status);
    else sendError(res, "CAMPAIGN_FAILED", "Unable to load campaign", 500);
  }
}

export async function sendCampaignHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    // 202: accepted into the background queue, not sent yet.
    sendSuccess(res, await sendCampaign(req.auth.tenantId, req.params.id), 202);
  } catch (err) {
    if (err instanceof WhatsappServiceError) sendError(res, err.code, err.message, err.status);
    else sendError(res, "CAMPAIGN_FAILED", "Unable to start campaign", 500);
  }
}

export async function cancelCampaignHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await cancelCampaign(req.auth.tenantId, req.params.id));
  } catch (err) {
    if (err instanceof WhatsappServiceError) sendError(res, err.code, err.message, err.status);
    else sendError(res, "CAMPAIGN_FAILED", "Unable to cancel campaign", 500);
  }
}

/** POST /api/v1/campaigns/tick — Vercel Cron entrypoint (replaces setInterval on serverless). */
export async function tickScheduledCampaignsHandler(req: Request, res: Response): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    sendError(res, "UNAUTHORIZED", "Invalid cron secret", 401);
    return;
  }
  const { tickScheduledCampaigns } = await import("../services/whatsapp/campaignWorker");
  sendSuccess(res, await tickScheduledCampaigns());
}
