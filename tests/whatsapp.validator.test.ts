import { describe, expect, it } from "vitest";
import { sendTemplateSchema } from "../src/validators/whatsapp.validator";

describe("sendTemplateSchema", () => {
  it("accepts a valid template send request", () => {
    const result = sendTemplateSchema.safeParse({
      to: "+14155552671",
      templateName: "hello_world",
      language: "en_US",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-E.164 recipient", () => {
    const result = sendTemplateSchema.safeParse({
      to: "not-a-phone",
      templateName: "hello_world",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing template name", () => {
    const result = sendTemplateSchema.safeParse({ to: "+14155552671" });
    expect(result.success).toBe(false);
  });
});
