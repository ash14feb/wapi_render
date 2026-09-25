import type { Request, Response } from "express";
import { AuthError, login, me, refresh, register } from "../services/auth/auth.service";
import { loginSchema, refreshSchema, registerSchema } from "../validators/auth.validator";
import { sendError, sendSuccess } from "../utils/response";

function handleAuthError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof AuthError) {
    sendError(res, err.code, err.message, err.status);
    return;
  }
  sendError(res, "AUTH_FAILED", fallback, 500);
}

export async function registerHandler(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await register(parsed.data), 201);
  } catch (err) {
    handleAuthError(res, err, "Unable to register");
  }
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await login(parsed.data));
  } catch (err) {
    handleAuthError(res, err, "Unable to log in");
  }
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(res, await refresh(parsed.data.refreshToken));
  } catch (err) {
    handleAuthError(res, err, "Unable to refresh token");
  }
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  try {
    sendSuccess(res, await me(req.auth.userId, req.auth.tenantId));
  } catch (err) {
    handleAuthError(res, err, "Unable to load profile");
  }
}
