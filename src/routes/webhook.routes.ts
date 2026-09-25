import { Router } from "express";
import { receiveWebhook, verifyWebhook } from "../controllers/webhook.controller";

export const webhookRouter = Router();

webhookRouter.get("/webhooks/whatsapp", verifyWebhook);
webhookRouter.post("/webhooks/whatsapp", receiveWebhook);
