import type { Request, Response } from "express";
import { subscribe } from "../services/realtime";

/** GET /api/v1/realtime/events — tenant-scoped SSE stream. */
export function eventsHandler(req: Request, res: Response): void {
  if (!req.auth) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    return;
  }
  const tenantId = req.auth.tenantId;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const unsubscribe = subscribe({ tenantId, res });

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      cleanup();
    }
  }, 25000);

  function cleanup(): void {
    clearInterval(heartbeat);
    unsubscribe();
  }

  req.on("close", cleanup);
}
