import { Router } from "express";
import {
  cancelCampaignHandler,
  createCampaignHandler,
  getCampaignHandler,
  listCampaignsHandler,
  sendCampaignHandler,
  tickScheduledCampaignsHandler,
} from "../controllers/campaigns.controller";
import { authenticate } from "../middleware/auth";

export const campaignsRouter = Router();

campaignsRouter.get("/campaigns", authenticate, listCampaignsHandler);
campaignsRouter.post("/campaigns", authenticate, createCampaignHandler);
// Static /tick must come BEFORE /:id or "tick" is parsed as an id (and hits auth).
campaignsRouter.get("/campaigns/tick", tickScheduledCampaignsHandler);
campaignsRouter.post("/campaigns/tick", tickScheduledCampaignsHandler);
campaignsRouter.get("/campaigns/:id", authenticate, getCampaignHandler);
campaignsRouter.post("/campaigns/:id/send", authenticate, sendCampaignHandler);
campaignsRouter.post("/campaigns/:id/cancel", authenticate, cancelCampaignHandler);
