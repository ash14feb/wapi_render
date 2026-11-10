import type { Request, Response } from "express";
import { prisma } from "../config/prisma";

/** Liveness probe (GET /health) — process is up; no dependencies touched. */
export function healthCheck(_req: Request, res: Response): void {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      service: "whatsapp-saas-backend",
      timestamp: new Date().toISOString(),
    },
  });
}

/** Readiness probe (GET /api/v1/health) — verifies the database is reachable. */
export async function readinessCheck(_req: Request, res: Response): Promise<void> {
  let database: "ok" | "down" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }

  const ready = database === "ok";
  res.status(ready ? 200 : 503).json({
    success: ready,
    data: {
      status: ready ? "ok" : "degraded",
      service: "whatsapp-saas-backend",
      checks: { database },
      timestamp: new Date().toISOString(),
    },
  });
}
