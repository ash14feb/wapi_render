import { Router } from "express";
import { dashboardSummaryHandler } from "../controllers/dashboard.controller";
import { authenticate } from "../middleware/auth";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard/summary", authenticate, dashboardSummaryHandler);
