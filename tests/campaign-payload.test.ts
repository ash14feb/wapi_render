import { describe, expect, it } from "vitest";
import { buildCampaignComponents, parseCampaignPayload } from "../src/services/whatsapp/campaignWorker";
import { extractHeaderFormat } from "../src/utils/templates";

describe("parseCampaignPayload", () => {
  it("parses the object shape", () => {
    expect(
      parseCampaignPayload(JSON.stringify({ body: ["Asha"], header: { kind: "image", id: "4::x" } })),
    ).toEqual({ body: ["Asha"], header: { kind: "image", id: "4::x" } });
  });

  it("supports the legacy plain-array shape", () => {
    expect(parseCampaignPayload(JSON.stringify(["Asha"]))).toEqual({ body: ["Asha"], header: null });
  });

  it("falls back to empty on null/garbage", () => {
    expect(parseCampaignPayload(null)).toEqual({ body: [], header: null });
    expect(parseCampaignPayload("garbage")).toEqual({ body: [], header: null });
  });
});

describe("buildCampaignComponents", () => {
  it("emits header + body for media-header templates", () => {
    expect(
      buildCampaignComponents({ body: [], header: { kind: "image", id: "4::x" } }),
    ).toEqual([
      { type: "header", parameters: [{ type: "image", image: { id: "4::x" } }] },
    ]);
  });

  it("emits body-only when there is no header", () => {
    expect(buildCampaignComponents({ body: ["Asha"], header: null })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Asha" }] },
    ]);
  });

  it("emits undefined when there is nothing to fill", () => {
    expect(buildCampaignComponents({ body: [], header: null })).toBeUndefined();
  });
});

describe("extractHeaderFormat", () => {
  it("detects media headers case-insensitively", () => {
    expect(extractHeaderFormat(JSON.stringify([{ type: "HEADER", format: "IMAGE" }]))).toBe("IMAGE");
    expect(extractHeaderFormat(JSON.stringify([{ type: "header", format: "image" }]))).toBe("IMAGE");
    expect(extractHeaderFormat(JSON.stringify([{ type: "BODY", text: "hi" }]))).toBeNull();
    expect(extractHeaderFormat(null)).toBeNull();
  });
});
