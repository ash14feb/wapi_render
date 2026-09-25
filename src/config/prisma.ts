import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * On Vercel serverless, bundled files aren't reliably on disk, so a PEM
 * referenced via `sslcert=<path>` in DATABASE_URL may not resolve.
 * Instead, paste the CA content into the MYSQL_CA_CERT env var: on cold
 * start we write it to /tmp (writable on Lambda) and point sslcert there.
 */
function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? "";
  const ca = process.env.MYSQL_CA_CERT;
  if (ca && url && !url.includes("sslcert=")) {
    const path = "/tmp/aiven-ca.pem";
    try {
      if (!fs.existsSync(path)) {
        fs.writeFileSync(path, ca.replace(/\\n/g, "\n"), "utf8");
      }
      return `${url}${url.includes("?") ? "&" : "?"}sslcert=${path}`;
    } catch {
      // Fall through to the raw URL; the real error surfaces from Prisma.
    }
  }
  return url;
}

if (process.env.MYSQL_CA_CERT) {
  process.env.DATABASE_URL = resolveDatabaseUrl();
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? new PrismaClient();

// Cache on globalThis in ALL envs so Vercel warm invocations reuse the pool.
globalThis.__prisma = prisma;
