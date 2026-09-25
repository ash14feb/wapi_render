import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { sendError } from "../utils/response";

interface AccessPayload {
  userId: string;
  tenantId: string;
  role?: string;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    sendError(res, "UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    return;
  }
  const secret = process.env.JWT_ACCESS_SECRET ?? "";
  if (!secret) {
    sendError(res, "SERVER_MISCONFIGURED", "JWT secret is not configured", 500);
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), secret) as AccessPayload;
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
