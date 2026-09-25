import { describe, expect, it } from "vitest";
import { createCampaignSchema } from "../src/validators/campaigns.validator";
import { sendMessageSchema } from "../src/validators/conversations.validator";

describe("createCampaignSchema", () => {
  it("accepts a valid campaign", () => {
    const r = createCampaignSchema.safeParse({
      name: "Festival blast",
      templateId: "tmpl_1",
      contactIds: ["c1", "c2"],
      parameters: ["Asha"],
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty contact lists and oversized blasts", () => {
    expect(
      createCampaignSchema.safeParse({ name: "x", templateId: "t", contactIds: [] }).success,
    ).toBe(false);
    expect(
      createCampaignSchema.safeParse({
        name: "x",
        templateId: "t",
        contactIds: Array(1001).fill("c"),
      }).success,
    ).toBe(false);
  });

  it("rejects bad scheduledAt", () => {
    expect(
      createCampaignSchema.safeParse({
        name: "x",
        templateId: "t",
        contactIds: ["c1"],
        scheduledAt: "tomorrow",
      }).success,
    ).toBe(false);
  });
});

describe("sendMessageSchema", () => {
  it("accepts text or media (not neither)", () => {
    expect(sendMessageSchema.safeParse({ text: "hi" }).success).toBe(true);
    expect(
      sendMessageSchema.safeParse({ mediaKind: "image", mediaId: "123" }).success,
    ).toBe(true);
    expect(
      sendMessageSchema.safeParse({ mediaKind: "image" }).success,
    ).toBe(false);
  });
});
