import { Router } from "express";
import {
  createKnowledgeHandler,
  createOfferHandler,
  deleteKnowledgeHandler,
  deleteOfferHandler,
  getAiSettingsHandler,
  getAiStatsHandler,
  getConversationAiStateHandler,
  listAiLogsHandler,
  listKnowledgeHandler,
  listOffersHandler,
  runPlaygroundHandler,
  testAiProviderHandler,
  updateAiSettingsHandler,
  updateConversationAiStateHandler,
  updateKnowledgeHandler,
  updateOfferHandler,
} from "../controllers/ai.controller";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";

export const aiRouter = Router();

const adminOnly = requireRole("OWNER", "ADMIN");

aiRouter.get("/ai/settings", authenticate, getAiSettingsHandler);
aiRouter.put("/ai/settings", authenticate, adminOnly, updateAiSettingsHandler);
aiRouter.post("/ai/test", authenticate, adminOnly, testAiProviderHandler);
aiRouter.post("/ai/playground", authenticate, adminOnly, runPlaygroundHandler);
aiRouter.get("/ai/stats", authenticate, getAiStatsHandler);
aiRouter.get("/ai/logs", authenticate, listAiLogsHandler);

aiRouter.get("/ai/knowledge", authenticate, listKnowledgeHandler);
aiRouter.post("/ai/knowledge", authenticate, adminOnly, createKnowledgeHandler);
aiRouter.put("/ai/knowledge/:id", authenticate, adminOnly, updateKnowledgeHandler);
aiRouter.delete("/ai/knowledge/:id", authenticate, adminOnly, deleteKnowledgeHandler);

aiRouter.get("/ai/offers", authenticate, listOffersHandler);
aiRouter.post("/ai/offers", authenticate, adminOnly, createOfferHandler);
aiRouter.put("/ai/offers/:id", authenticate, adminOnly, updateOfferHandler);
aiRouter.delete("/ai/offers/:id", authenticate, adminOnly, deleteOfferHandler);

aiRouter.get("/ai/conversations/:id/state", authenticate, getConversationAiStateHandler);
aiRouter.put("/ai/conversations/:id/state", authenticate, updateConversationAiStateHandler);
