import { Router } from "express";
import {
  createBotRuleHandler,
  deleteBotRuleHandler,
  listBotRulesHandler,
  updateBotRuleHandler,
} from "../controllers/bots.controller";
import { authenticate } from "../middleware/auth";

export const botsRouter = Router();

botsRouter.get("/bots/rules", authenticate, listBotRulesHandler);
botsRouter.post("/bots/rules", authenticate, createBotRuleHandler);
botsRouter.put("/bots/rules/:id", authenticate, updateBotRuleHandler);
botsRouter.delete("/bots/rules/:id", authenticate, deleteBotRuleHandler);
