import type { Request, Response } from "express";
import {
  getConversation,
  listConversations,
  listMessages,
  sendConversationMessage,
} from "../services/whatsapp/conversations.service";
import { WhatsappServiceError } from "../services/whatsapp/whatsapp.service";
import { sendMessageSchema } from "../validators/conversations.validator";
import { sendError, sendSuccess } from "../utils/response";

function requireAuth(req: Request): req is Request & { auth: NonNullable<Request["auth"]> } {
  return !!req.auth;
}

export async function listConversationsHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 25;
  sendSuccess(res, await listConversations(req.auth.tenantId, search, cursor, limit));
}

export async function getConversationHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await getConversation(req.auth.tenantId, req.params.id));
  } catch (err) {
    if (err instanceof WhatsappServiceError) sendError(res, err.code, err.message, err.status);
    else sendError(res, "CONVERSATION_FAILED", "Unable to load conversation", 500);
  }
}

export async function listMessagesHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    sendSuccess(res, await listMessages(req.auth.tenantId, req.params.id, cursor, limit));
  } catch (err) {
    if (err instanceof WhatsappServiceError) sendError(res, err.code, err.message, err.status);
    else sendError(res, "MESSAGES_FAILED", "Unable to load messages", 500);
  }
}

export async function sendMessageHandler(req: Request, res: Response): Promise<void> {
  if (!requireAuth(req)) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(
      res,
      await sendConversationMessage(req.auth.tenantId, req.params.id, parsed.data),
      201,
    );
  } catch (err) {
    if (err instanceof WhatsappServiceError) sendError(res, err.code, err.message, err.status);
    else sendError(res, "WHATSAPP_SEND_FAILED", "Unable to send WhatsApp message", 502);
  }
}
