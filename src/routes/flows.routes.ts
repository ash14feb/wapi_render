import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getFlowResponses, getFlows, postFlow, publishFlowHandler, putFlow, removeFlow, sendFlowHandler, syncFlows } from "../controllers/flows.controller";

export const flowsRouter = Router();

flowsRouter.get("/flows", authenticate, getFlows);
flowsRouter.post("/flows", authenticate, postFlow);
flowsRouter.put("/flows/:id", authenticate, putFlow);
flowsRouter.delete("/flows/:id", authenticate, removeFlow);
flowsRouter.post("/flows/:id/publish", authenticate, publishFlowHandler);
flowsRouter.post("/flows/sync", authenticate, syncFlows);
flowsRouter.post("/flows/:id/send", authenticate, sendFlowHandler);
flowsRouter.get("/flows/:id/responses", authenticate, getFlowResponses);
