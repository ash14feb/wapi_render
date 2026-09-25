import { Router } from "express";
import { eventsHandler } from "../controllers/realtime.controller";
import { authenticateQuery } from "../middleware/authQuery";

export const realtimeRouter = Router();

realtimeRouter.get("/realtime/events", authenticateQuery, eventsHandler);
