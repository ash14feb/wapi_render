// Usage: node scripts/encrypt-token.js "<PLAINTEXT_META_TOKEN>"
// Prints the encrypted value to store in whatsapp_accounts.encrypted_access_token.
// Reads ENCRYPTION_KEY from backend/.env (same key the API uses at send time).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const token = process.argv[2];
if (!token) {
  console.error('Usage: node scripts/encrypt-token.js "<PLAINTEXT_META_TOKEN>"');
  process.exit(1);
}

function loadEnvKey() {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return "";
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith("ENCRYPTION_KEY="));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

const raw = loadEnvKey();
if (!raw) {
  console.error("ENCRYPTION_KEY not found in environment or backend/.env");
  process.exit(1);
}

const key = crypto.createHash("sha256").update(raw).digest();
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
console.log(`${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`);
