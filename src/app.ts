import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config/env";
import { healthRouter } from "./routes/health.routes";
import { authRouter } from "./routes/auth.routes";
import { campaignsRouter } from "./routes/campaigns.routes";
import { contactsRouter } from "./routes/contacts.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { whatsappRouter } from "./routes/whatsapp.routes";
import { conversationsRouter } from "./routes/conversations.routes";
import { mediaRouter } from "./routes/media.routes";
import { realtimeRouter } from "./routes/realtime.routes";
import { webhookRouter } from "./routes/webhook.routes";
import { botsRouter } from "./routes/bots.routes";
import { errorHandler } from "./middleware/errorHandler";

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  const allowedOrigins = config.frontendUrl
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser requests (no Origin header, e.g. webhooks/health checks)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    }),
  );
  // Raw body captured ONLY for webhook signature verification.
  app.use(
    "/api/v1/webhooks",
    express.json({
      limit: "1mb",
      verify: (req: import("express").Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.json({ limit: "256kb" }));

  app.use(healthRouter);
  app.use("/api/v1", healthRouter);
  app.use("/api/v1", authRouter);
  app.use("/api/v1", campaignsRouter);
  app.use("/api/v1", contactsRouter);
  app.use("/api/v1", dashboardRouter);
  app.use("/api/v1", whatsappRouter);
  app.use("/api/v1", conversationsRouter);
  app.use("/api/v1", mediaRouter);
  app.use("/api/v1", realtimeRouter);
  app.use("/api/v1", webhookRouter);
  app.use("/api/v1", botsRouter);

  app.use(errorHandler);

  return app;
}
