import { describe, expect, it } from "vitest";
import { buildCampaignComponents, parseCampaignPayload } from "../src/services/whatsapp/campaignWorker";
import { extractHeaderFormat } from "../src/utils/templates";

describe("parseCampaignPayload", () => {
  it("parses the object shape", () => {
    expect(
      parseCampaignPayload(JSON.stringify({ body: ["Asha"], header: { kind: "image", id: "4::x" } })),
    ).toEqual({ body: ["Asha"], header: { kind: "image", id: "4::x" }, buttons: [] });
  });

  it("supports the legacy plain-array shape", () => {
    expect(parseCampaignPayload(JSON.stringify(["Asha"]))).toEqual({ body: ["Asha"], header: null, buttons: [] });
  });

  it("keeps well-formed button values and drops malformed ones", () => {
    expect(
      parseCampaignPayload(
        JSON.stringify({
          body: ["Asha"],
          buttons: [
            { index: 0, kind: "url", value: "/orders/1" },
            { index: 1, kind: "copy_code", value: "SAVE20" },
            { index: "2", kind: "url", value: "/x" },
            { index: 3, kind: "phone", value: "+1" },
          ],
        }),
      ),
    ).toEqual({
      body: ["Asha"],
      header: null,
      buttons: [
        { index: 0, kind: "url", value: "/orders/1" },
        { index: 1, kind: "copy_code", value: "SAVE20" },
      ],
    });
  });

  it("falls back to empty on null/garbage", () => {
    expect(parseCampaignPayload(null)).toEqual({ body: [], header: null, buttons: [] });
    expect(parseCampaignPayload("garbage")).toEqual({ body: [], header: null, buttons: [] });
  });
});

describe("buildCampaignComponents", () => {
  it("emits header + body for media-header templates", () => {
    expect(
      buildCampaignComponents({ body: [], header: { kind: "image", id: "4::x" }, buttons: [] }),
    ).toEqual([
      { type: "header", parameters: [{ type: "image", image: { id: "4::x" } }] },
    ]);
  });

  it("emits body-only when there is no header", () => {
    expect(buildCampaignComponents({ body: ["Asha"], header: null, buttons: [] })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Asha" }] },
    ]);
  });

  it("emits undefined when there is nothing to fill", () => {
    expect(buildCampaignComponents({ body: [], header: null, buttons: [] })).toBeUndefined();
  });

  it("emits button params after body params", () => {
    expect(
      buildCampaignComponents({
        body: ["Asha"],
        header: null,
        buttons: [
          { index: 0, kind: "url", value: "/orders/1" },
          { index: 1, kind: "copy_code", value: "SAVE20" },
        ],
      }),
    ).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Asha" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "/orders/1" }] },
      { type: "button", sub_type: "copy_code", index: "1", parameters: [{ type: "coupon_code", coupon_code: "SAVE20" }] },
    ]);
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
