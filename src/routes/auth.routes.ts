import { Router } from "express";
import { loginHandler, meHandler, refreshHandler, registerHandler } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/auth/register", registerHandler);
authRouter.post("/auth/login", loginHandler);
authRouter.post("/auth/refresh", refreshHandler);
authRouter.get("/auth/me", authenticate, meHandler);
