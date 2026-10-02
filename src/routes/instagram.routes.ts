import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { instagramEvents, instagramSend, receiveInstagram, verifyInstagram } from "../controllers/instagram.controller";

export const instagramRouter = Router();

// Public Meta webhooks (challenge + HMAC inside controller).
instagramRouter.get("/webhooks/instagram", verifyInstagram);
instagramRouter.post("/webhooks/instagram", receiveInstagram);
// Authed helpers for UI.
instagramRouter.post("/integrations/instagram/send", authenticate, instagramSend);
instagramRouter.get("/integrations/instagram/events", authenticate, instagramEvents);
