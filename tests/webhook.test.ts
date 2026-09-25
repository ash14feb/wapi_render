import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { parseVerifyQuery, verifyMetaSignature } from "../src/utils/webhook";
import { webhookPayloadSchema } from "../src/validators/webhook.validator";

describe("webhook verification", () => {
  it("accepts a valid subscribe challenge", () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "test-token";
    const result = parseVerifyQuery({
      "hub.mode": "subscribe",
      "hub.verify_token": "test-token",
      "hub.challenge": "abc123",
    });
    expect(result).toEqual({ ok: true, challenge: "abc123" });
  });

  it("rejects a wrong verify token", () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "test-token";
    const result = parseVerifyQuery({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "abc123",
    });
    expect(result.ok).toBe(false);
  });
});

describe("webhook signature", () => {
  it("validates a correct HMAC signature", () => {
    const secret = "app-secret";
    const raw = JSON.stringify({ hello: "world" });
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyMetaSignature(raw, sig, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const secret = "app-secret";
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update("original").digest("hex");
    expect(verifyMetaSignature("tampered", sig, secret)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifyMetaSignature("body", undefined, "secret")).toBe(false);
  });
});

describe("webhook payload schema", () => {
  it("parses a message + status payload loosely", () => {
    const result = webhookPayloadSchema.safeParse({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "999", display_phone_number: "1555" },
                contacts: [{ wa_id: "1415", profile: { name: "Jane" } }],
                messages: [{ id: "wamid.1", from: "1415", timestamp: "1700000000", type: "text", text: { body: "hi" } }],
                statuses: [{ id: "wamid.0", status: "delivered", timestamp: "1700000001" }],
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-object payload", () => {
    expect(webhookPayloadSchema.safeParse("nope").success).toBe(false);
  });
});
