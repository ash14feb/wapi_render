import type { Request, Response } from "express";
import {
  createKnowledge,
  createOffer,
  deleteKnowledge,
  deleteOffer,
  getAiStats,
  getConversationAiState,
  listKnowledge,
  listOffers,
  listResponseLogs,
  updateConversationAiState,
  updateKnowledge,
  updateOffer,
} from "../services/ai/aiContent.service";
import {
  AiServiceError,
  getAiSettings,
  runPlayground,
  testAiProvider,
  updateAiSettings,
} from "../services/ai/aiSettings.service";
import {
  aiConversationStateSchema,
  aiPlaygroundSchema,
  aiTestSchema,
  knowledgeEntrySchema,
  offerSchema,
  updateAiSettingsSchema,
  updateKnowledgeEntrySchema,
  updateOfferSchema,
} from "../validators/ai.validator";
import { sendError, sendSuccess } from "../utils/response";

function requireAuth(req: Request): req is Request & { auth: NonNullable<Request["auth"]> } {
  return !!req.auth;
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof AiServiceError) {
    sendError(res, err.code, err.message, err.status);
    return;
  }
  sendError(res, "AI_REQUEST_FAILED", "AI request failed", 500);
}

export async function getAiSettingsHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await getAiSettings(req.auth.tenantId));
  } catch (err) {
    handleError(res, err);
  }
}

export async function updateAiSettingsHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = updateAiSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await updateAiSettings(req.auth.tenantId, req.auth.userId, parsed.data));
  } catch (err) {
    handleError(res, err);
  }
}

export async function testAiProviderHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = aiTestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await testAiProvider(req.auth.tenantId, parsed.data));
  } catch (err) {
    handleError(res, err);
  }
}

export async function runPlaygroundHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = aiPlaygroundSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await runPlayground(req.auth.tenantId, parsed.data));
  } catch (err) {
    handleError(res, err);
  }
}

export async function getAiStatsHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await getAiStats(req.auth.tenantId));
  } catch (err) {
    handleError(res, err);
  }
}

export async function listKnowledgeHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await listKnowledge(req.auth.tenantId));
  } catch (err) {
    handleError(res, err);
  }
}

export async function createKnowledgeHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = knowledgeEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await createKnowledge(req.auth.tenantId, parsed.data), 201);
  } catch (err) {
    handleError(res, err);
  }
}

export async function updateKnowledgeHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = updateKnowledgeEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await updateKnowledge(req.auth.tenantId, req.params.id, parsed.data));
  } catch (err) {
    handleError(res, err);
  }
}

export async function deleteKnowledgeHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await deleteKnowledge(req.auth.tenantId, req.params.id));
  } catch (err) {
    handleError(res, err);
  }
}

export async function listOffersHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await listOffers(req.auth.tenantId));
  } catch (err) {
    handleError(res, err);
  }
}

export async function createOfferHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = offerSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await createOffer(req.auth.tenantId, parsed.data), 201);
  } catch (err) {
    handleError(res, err);
  }
}

export async function updateOfferHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = updateOfferSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await updateOffer(req.auth.tenantId, req.params.id, parsed.data));
  } catch (err) {
    handleError(res, err);
  }
}

export async function deleteOfferHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await deleteOffer(req.auth.tenantId, req.params.id));
  } catch (err) {
    handleError(res, err);
  }
}

export async function listAiLogsHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 30;
    sendSuccess(res, await listResponseLogs(req.auth.tenantId, { status, cursor, limit }));
  } catch (err) {
    handleError(res, err);
  }
}

export async function getConversationAiStateHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await getConversationAiState(req.auth.tenantId, req.params.id));
  } catch (err) {
    handleError(res, err);
  }
}

export async function updateConversationAiStateHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = aiConversationStateSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await updateConversationAiState(req.auth.tenantId, req.params.id, parsed.data));
  } catch (err) {
    handleError(res, err);
  }
}
