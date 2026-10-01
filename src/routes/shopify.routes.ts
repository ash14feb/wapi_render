import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { shopifyCallback, shopifyConnect, shopifyDisconnect, shopifyStatus, shopifyWebhook } from "../controllers/shopify.controller";

export const shopifyRouter = Router();

shopifyRouter.get("/integrations/shopify/status", authenticate, shopifyStatus);
shopifyRouter.post("/integrations/shopify/connect", authenticate, shopifyConnect);
shopifyRouter.delete("/integrations/shopify/disconnect", authenticate, shopifyDisconnect);
// Public: OAuth redirect + inbound event webhooks (HMAC-verified inside controller).
shopifyRouter.get("/integrations/shopify/callback", shopifyCallback);
shopifyRouter.post("/integrations/shopify/webhooks", shopifyWebhook);
