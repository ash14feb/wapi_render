import { Router } from "express";
import {
  getConversationHandler,
  listConversationsHandler,
  listMessagesHandler,
  sendMessageHandler,
} from "../controllers/conversations.controller";
import { authenticate } from "../middleware/auth";

export const conversationsRouter = Router();

// NOTE: authenticate is applied per-route (not via router.use) so that
// unauthenticated /api/v1 routes mounted after this router (e.g. webhooks)
// are not blocked with a 401.
conversationsRouter.get("/conversations", authenticate, listConversationsHandler);
conversationsRouter.get("/conversations/:id", authenticate, getConversationHandler);
conversationsRouter.get("/conversations/:id/messages", authenticate, listMessagesHandler);
conversationsRouter.post("/conversations/:id/messages", authenticate, sendMessageHandler);
