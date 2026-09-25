import { Router } from "express";
import { completeOnboardingHandler, createTemplateHandler, listAccountsHandler, listTemplatesHandler, onboardingConfigHandler, sendTemplateHandler, syncTemplatesHandler } from "../controllers/whatsapp.controller";
import { authenticate } from "../middleware/auth";

export const whatsappRouter = Router();

whatsappRouter.post("/whatsapp/send/template", authenticate, sendTemplateHandler);
whatsappRouter.get("/whatsapp/accounts", authenticate, listAccountsHandler);
whatsappRouter.get("/whatsapp/templates", authenticate, listTemplatesHandler);
whatsappRouter.post("/whatsapp/templates", authenticate, createTemplateHandler);
whatsappRouter.post("/whatsapp/templates/sync", authenticate, syncTemplatesHandler);
whatsappRouter.get("/whatsapp/onboarding/config", authenticate, onboardingConfigHandler);
whatsappRouter.post("/whatsapp/onboarding/complete", authenticate, completeOnboardingHandler);
