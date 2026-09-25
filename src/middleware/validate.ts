import type { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { sendError } from "../utils/response";

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendError(_res, "VALIDATION_ERROR", "Invalid request body", 400, result.error.flatten());
      return;
    }
    req.body = result.data;
    next();
  };
}
