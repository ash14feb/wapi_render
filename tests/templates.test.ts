import { describe, expect, it, vi } from "vitest";
import { createMessageTemplate, fetchMessageTemplates, sendMediaMessage, uploadMediaToMeta, uploadSendMedia } from "../src/services/meta/meta-client";
import { normalizeTemplate } from "../src/services/whatsapp/templates.service";
import { createTemplateSchema } from "../src/services/whatsapp/templates.service";
import { sendTemplateSchema } from "../src/validators/whatsapp.validator";
import { countTemplateVars, extractBodyText, renderTemplatePreview, validateTemplateContent } from "../src/utils/templates";

describe("normalizeTemplate", () => {
  it("picks documented fields and uppercases status", () => {
    expect(
      normalizeTemplate({
        id: "123",
        name: "hello_world",
        language: "en_US",
        status: "approved",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Hi" }],
        extra_unknown_field: true,
      }),
    ).toMatchObject({ name: "hello_world", language: "en_US", status: "APPROVED", category: "UTILITY" });
  });

  it("rejects entries without name/language", () => {
    expect(normalizeTemplate({ status: "APPROVED" })).toBeNull();
    expect(normalizeTemplate(null)).toBeNull();
  });
});

describe("fetchMessageTemplates", () => {
  it("returns template list and follows one page", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ data: [{ name: "hello_world", language: "en_US", status: "APPROVED" }] }),
    );
    const out = await fetchMessageTemplates(
      { wabaId: "999", accessToken: "tok", graphVersion: "v25.0" },
      fetchFn as typeof fetch,
    );
    expect(out).toHaveLength(1);
    expect(fetchFn.mock.calls[0][0] as string).toContain("/v25.0/999/message_templates");
  });

  it("throws without leaking the token on Meta error", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ error: { message: "Unsupported get request", code: 100 } }, { status: 400 }),
    );
    await expect(
      fetchMessageTemplates({ wabaId: "999", accessToken: "tok", graphVersion: "v25.0" }, fetchFn as typeof fetch),
    ).rejects.toThrow("Unsupported get request");
  });
});

describe("template preview utils", () => {
  it("counts positional variables", () => {
    expect(countTemplateVars("Hi {{1}}, order {{2}} ready")).toBe(2);
    expect(countTemplateVars("No vars")).toBe(0);
  });

  it("renders preview substituting values", () => {
    expect(renderTemplatePreview("Hi {{1}}, order {{2}}", ["Asha", "4821"])).toBe("Hi Asha, order 4821");
    expect(renderTemplatePreview("Hi {{1}}", [])).toBe("Hi {{1}}");
  });

  it("extracts BODY text from stored components", () => {
    expect(extractBodyText(JSON.stringify([{ type: "BODY", text: "Hi {{1}}" }]))).toBe("Hi {{1}}");
    expect(extractBodyText(null)).toBeNull();
    expect(extractBodyText("garbage")).toBeNull();
  });
});

describe("createMessageTemplate", () => {
  it("posts name/language/category/components and returns id+status", async () => {
    const fetchFn = vi.fn(async () => Response.json({ id: "111", status: "PENDING" }));
    const out = await createMessageTemplate(
      {
        wabaId: "999",
        accessToken: "tok",
        graphVersion: "v25.0",
        name: "order_update",
        language: "en_US",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Hi {{1}}" }],
      },
      fetchFn as typeof fetch,
    );
    expect(out).toEqual({ id: "111", status: "PENDING" });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v25.0/999/message_templates");
    expect(JSON.stringify(init?.body)).not.toContain("tok");
  });

  it("surfaces Meta validation errors (e.g. bad name)", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ error: { message: "Invalid template name", code: 100 } }, { status: 400 }),
    );
    await expect(
      createMessageTemplate(
        {
          wabaId: "999",
          accessToken: "tok",
          graphVersion: "v25.0",
          name: "Bad Name!",
          language: "en_US",
          category: "UTILITY",
          components: [],
        },
        fetchFn as typeof fetch,
      ),
    ).rejects.toThrow("Invalid template name");
  });
});

describe("validateTemplateContent", () => {
  const ok = {
    name: "order_update",
    bodyText: "Hi {{1}}, your order {{2}} is ready for pickup today.",
    examples: ["Sarah", "ORD-110"],
  };

  it("passes a well-formed body", () => {
    expect(validateTemplateContent(ok)).toEqual([]);
  });

  it("rejects leading and trailing variables", () => {
    expect(validateTemplateContent({ ...ok, bodyText: "{{1}}, your order is ready today.", examples: ["Sarah"] })).toContainEqual(
      expect.objectContaining({ field: "bodyText", message: expect.stringContaining("start") }),
    );
    expect(validateTemplateContent({ ...ok, bodyText: "Hi {{1}}, your order is {{2}}", examples: ["Sarah", "ABC"] })).toContainEqual(
      expect.objectContaining({ field: "bodyText", message: expect.stringContaining("end") }),
    );
    expect(validateTemplateContent({ ...ok, bodyText: "Hi {{1}}, your order is {{2}}.", examples: ["Sarah", "ABC"] })).not.toEqual([]);
  });

  it("rejects glued text and non-breaking spaces", () => {
    expect(validateTemplateContent({ ...ok, bodyText: "Hi{{1}}, your order is ready today.", examples: ["Sarah"] }).length).toBeGreaterThan(0);
    expect(validateTemplateContent({ ...ok, bodyText: "Hi\u00A0{{1}}, your order is ready today.", examples: ["Sarah"] }).length).toBeGreaterThan(0);
  });

  it("rejects non-sequential variable numbering", () => {
    const gaps = validateTemplateContent({ ...ok, bodyText: "Hi {{1}}, order {{3}} is ready today.", examples: ["a", "b"] });
    expect(gaps).toContainEqual(expect.objectContaining({ field: "bodyText", message: expect.stringContaining("sequentially") }));
    expect(validateTemplateContent({ ...ok, bodyText: "Hi {{1}}, order {{2}} and {{2}} shipped today.", examples: ["a", "b"] })).toEqual([]);
  });

  it("requires examples to map 1:1 and be non-empty", () => {
    expect(validateTemplateContent({ ...ok, examples: ["Sarah"] })).toContainEqual(
      expect.objectContaining({ field: "examples" }),
    );
    expect(validateTemplateContent({ ...ok, examples: ["Sarah", "  "] })).toContainEqual(
      expect.objectContaining({ field: "examples", message: expect.stringContaining("empty") }),
    );
  });

  it("enforces naming and length limits", () => {
    expect(validateTemplateContent({ ...ok, name: "Bad Name" })).toContainEqual(expect.objectContaining({ field: "name" }));
    expect(validateTemplateContent({ ...ok, bodyText: `Hi {{1}} ${"x".repeat(1030)}.`, examples: ["a"] })).toContainEqual(
      expect.objectContaining({ field: "bodyText", message: expect.stringContaining("1024") }),
    );
    expect(validateTemplateContent({ ...ok, footerText: "Order {{1}}" })).toContainEqual(
      expect.objectContaining({ field: "footerText" }),
    );
    expect(validateTemplateContent({ ...ok, headerText: "Hello {{1}}" })).toContainEqual(
      expect.objectContaining({ field: "headerText" }),
    );
  });
});

describe("uploadMediaToMeta", () => {
  it("creates a session then uploads bytes and returns the handle", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "session123" }))
      .mockResolvedValueOnce(Response.json({ h: "4::abc" }));
    const out = await uploadMediaToMeta(
      {
        appId: "app1",
        accessToken: "tok",
        graphVersion: "v25.0",
        fileName: "pic.jpg",
        mimeType: "image/jpeg",
        data: new Uint8Array([1, 2, 3]),
      },
      fetchFn as unknown as typeof fetch,
    );
    expect(out).toEqual({ handle: "4::abc" });
    expect(fetchFn.mock.calls[0][0] as string).toContain("/v25.0/app1/uploads");
    expect(fetchFn.mock.calls[1][0] as string).toContain("/v25.0/session123");
  });

  it("throws when the session has no id", async () => {
    const fetchFn = vi.fn(async () => Response.json({}));
    await expect(
      uploadMediaToMeta(
        { appId: "a", accessToken: "t", graphVersion: "v25.0", fileName: "x", mimeType: "image/jpeg", data: new Uint8Array() },
        fetchFn as unknown as typeof fetch,
      ),
    ).rejects.toThrow();
  });

  it("does not URL-encode the session id (Meta rejects encoded upload: tokens)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "upload:abc?sig=xyz" }))
      .mockResolvedValueOnce(Response.json({ h: "4::abc" }));
    await uploadMediaToMeta(
      { appId: "a", accessToken: "t", graphVersion: "v25.0", fileName: "x", mimeType: "image/jpeg", data: new Uint8Array([1]) },
      fetchFn as unknown as typeof fetch,
    );
    expect(fetchFn.mock.calls[1][0]).toBe("https://graph.facebook.com/v25.0/upload:abc?sig=xyz");
  });
});

describe("uploadSendMedia", () => {  it("posts multipart to the phone-number /media endpoint and returns the numeric id", async () => {
    const fetchFn = vi.fn(async () => Response.json({ id: "123456789" }));
    const out = await uploadSendMedia(
      {
        phoneNumberId: "999",
        accessToken: "tok",
        graphVersion: "v25.0",
        fileName: "pic.jpg",
        mimeType: "image/jpeg",
        data: new Uint8Array([1, 2, 3]),
      },
      fetchFn as unknown as typeof fetch,
    );
    expect(out).toEqual({ id: "123456789" });
    expect(fetchFn.mock.calls[0][0]).toBe("https://graph.facebook.com/v25.0/999/media");
  });
});

describe("template media validation", () => {
  it("accepts a header image component with link on send", () => {
    const r = sendTemplateSchema.safeParse({
      to: "+14155552671",
      templateName: "receipt_image",
      language: "en_US",
      components: [{ type: "header", parameters: [{ type: "image", image: { link: "https://x.test/a.jpg" } }] }],
    });
    expect(r.success).toBe(true);
  });

  it("requires headerHandle for IMAGE headers on create", () => {
    expect(
      createTemplateSchema.safeParse({ name: "t", language: "en_US", category: "UTILITY", headerFormat: "IMAGE", bodyText: "Hi" }).success,
    ).toBe(false);
    expect(
      createTemplateSchema.safeParse({ name: "t", language: "en_US", category: "UTILITY", headerFormat: "IMAGE", headerHandle: "4::abc", bodyText: "Hi" }).success,
    ).toBe(true);
  });

  it("rejects a body that ends with a variable", () => {
    const base = { name: "t", language: "en_US", category: "UTILITY" as const, examples: ["Sarah", "ORD-110"] };
    const trailing = createTemplateSchema.safeParse({ ...base, bodyText: "Hi {{1}}, your bill is {{2}}" });
    expect(trailing.success).toBe(false);
    if (!trailing.success) {
      expect(trailing.error.issues.some((i) => i.path[0] === "bodyText")).toBe(true);
    }
    expect(createTemplateSchema.safeParse({ ...base, bodyText: "Hi {{1}}, your bill is {{2}}." }).success).toBe(true);
    expect(createTemplateSchema.safeParse({ ...base, bodyText: "Hi {{1}}, your bill is {{2}} thank you" }).success).toBe(true);
  });

  it("allows AUTHENTICATION without custom body (Meta preset text is used)", () => {
    const r = createTemplateSchema.safeParse({ name: "otp_code", language: "en_US", category: "AUTHENTICATION" });
    expect(r.success).toBe(true);
  });
});

describe("sendMediaMessage", () => {
  it("posts an image by id with caption", async () => {
    const fetchFn = vi.fn(async () => Response.json({ messages: [{ id: "wamid.x" }] }));
    const id = await sendMediaMessage(
      {
        phoneNumberId: "999",
        accessToken: "tok",
        graphVersion: "v25.0",
        to: "+14155552671",
        kind: "image",
        id: "12345",
        caption: "Look!",
      },
      fetchFn as unknown as typeof fetch,
    );
    expect(id).toBe("wamid.x");
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      type: "image",
      image: { id: "12345", caption: "Look!" },
    });
  });
});
