import type { NextFunction, Request, Response } from "express";
import { sendError } from "../utils/response";

/** Restricts a route to the given tenant roles. Must run after `authenticate`. */
export function requireRole(...roles: string[]) {
  const allowed = new Set(roles.map((r) => r.toUpperCase()));
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      sendError(res, "UNAUTHORIZED", "Authentication required", 401);
      return;
    }
    const role = (req.auth.role ?? "").toUpperCase();
    if (!allowed.has(role)) {
      sendError(res, "FORBIDDEN", "You do not have permission to perform this action", 403);
      return;
    }
    next();
  };
}
