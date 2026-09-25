import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { sendError } from "../utils/response";

/**
 * Query-token auth for EventSource (browsers can't set Authorization headers
 * on SSE connections). Same JWT as Bearer auth, passed as ?token=.
 */
export function authenticateQuery(req: Request, res: Response, next: NextFunction): void {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const secret = process.env.JWT_ACCESS_SECRET ?? "";
  if (!token || !secret) {
    sendError(res, "UNAUTHORIZED", "Missing access token", 401);
    return;
  }
  try {
    const payload = jwt.verify(token, secret) as { userId: string; tenantId: string; role?: string };
    if (!payload.userId || !payload.tenantId) {
      sendError(res, "UNAUTHORIZED", "Invalid token payload", 401);
      return;
    }
    req.auth = { userId: payload.userId, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch {
    sendError(res, "UNAUTHORIZED", "Invalid or expired token", 401);
  }
}
