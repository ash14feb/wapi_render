import type { Request, Response } from "express";
import { sendSuccess } from "../utils/response";

export function healthCheck(_req: Request, res: Response): void {
  sendSuccess(res, {
    status: "ok",
    service: "whatsapp-saas-backend",
    timestamp: new Date().toISOString(),
  });
}
