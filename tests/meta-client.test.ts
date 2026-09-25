import { describe, expect, it, vi } from "vitest";
import { MetaApiError, sendTemplateMessage } from "../src/services/meta/meta-client";

const baseParams = {
  phoneNumberId: "123456789",
  accessToken: "secret-token",
  graphVersion: "v21.0",
  to: "+14155552671",
  templateName: "hello_world",
  language: "en_US",
};

describe("sendTemplateMessage", () => {
  it("returns the Meta message id on success", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ messages: [{ id: "wamid.test123" }] }),
    );
    const id = await sendTemplateMessage(baseParams, fetchFn as typeof fetch);
    expect(id).toBe("wamid.test123");
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(init?.body)).not.toContain("secret-token");
    expect(fetchFn.mock.calls[0][0] as string).toContain("/v21.0/123456789/messages");
  });

  it("throws MetaApiError without leaking the token on Meta error", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json(
        { error: { message: "Invalid OAuth access token", code: 190 } },
        { status: 400 },
      ),
    );
    const err = await sendTemplateMessage(baseParams, fetchFn as typeof fetch).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).status).toBe(400);
    expect((err as MetaApiError).message).not.toContain("secret-token");
  });

  it("throws MetaApiError on network failure", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const err = await sendTemplateMessage(baseParams, fetchFn as typeof fetch).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).status).toBe(502);
  });

  it("throws when Meta returns no message id", async () => {
    const fetchFn = vi.fn(async () => Response.json({ messages: [] }));
    await expect(
      sendTemplateMessage(baseParams, fetchFn as typeof fetch),
    ).rejects.toBeInstanceOf(MetaApiError);
  });
});
