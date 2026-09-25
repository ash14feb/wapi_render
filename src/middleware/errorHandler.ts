import type { NextFunction, Request, Response } from "express";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isProd = process.env.NODE_ENV === "production";
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: isProd ? "Internal server error" : err.message,
    },
  });
}
