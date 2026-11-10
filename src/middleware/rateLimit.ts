import rateLimit from "express-rate-limit";
import { sendError } from "../utils/response";

/**
 * Credential endpoints are the only unauthenticated write surface, so they get
 * a per-IP budget. Successful logins still count: the goal is to bound online
 * password guessing and account-spam registration, not to meter normal use.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, "RATE_LIMITED", "Too many attempts. Try again later.", 429);
  },
});
