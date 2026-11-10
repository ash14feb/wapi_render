import { Router } from "express";
import { loginHandler, meHandler, refreshHandler, registerHandler } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimit";

export const authRouter = Router();

authRouter.post("/auth/register", authRateLimiter, registerHandler);
authRouter.post("/auth/login", authRateLimiter, loginHandler);
authRouter.post("/auth/refresh", authRateLimiter, refreshHandler);
authRouter.get("/auth/me", authenticate, meHandler);
