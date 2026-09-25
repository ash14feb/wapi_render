import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  apiUrl: process.env.API_URL ?? "http://localhost:5000",
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "",
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
  meta: {
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    graphVersion: process.env.META_GRAPH_VERSION ?? "v21.0",
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
    systemUserAccessToken: process.env.META_SYSTEM_USER_ACCESS_TOKEN ?? "",
    configId: process.env.META_CONFIG_ID ?? "",
    redirectUri: process.env.META_REDIRECT_URI ?? "",
  },
};

export function validateRequiredConfig(): void {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
}
