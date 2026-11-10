import { Router } from "express";
import { healthCheck, readinessCheck } from "../controllers/health.controller";

export const healthRouter = Router();

healthRouter.get("/health", healthCheck);
healthRouter.get("/api/v1/health", readinessCheck);
