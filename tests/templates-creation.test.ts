import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const createMessageTemplate = vi.fn();
const upsert = vi.fn(async ({ create }: { create: unknown }) => create);

vi.mock("../src/config/prisma", () => ({
  prisma: {
    whatsappAccount: { findFirst },
    messageTemplate: { upsert: (...a: unknown[]) => upsert(a[0] as { create: unknown }) },
  },
}));
vi.mock("../src/config/env", () => ({
  config: { meta: { graphVersion: "v25.0" } },
}));
vi.mock("../src/utils/crypto", () => ({ decryptToken: () => "tok" }));
vi.mock("../src/services/meta/meta-client", () => ({
  createMessageTemplate: (...a: unknown[]) => createMessageTemplate(...a),
  fetchMessageTemplates: vi.fn(),
}));

const { createTemplate } = await import("../src/services/whatsapp/templates.service");

const base = {
  name: "testtemplate",
  language: "en_US",
  category: "UTILITY" as const,
  bodyText: "Hi {{1}}, your order {{2}} is ready.",
  examples: ["Sarah", "ORD-110"],
};

describe("createTemplate pre-flight validation", () => {
  beforeEach(() => {
    findFirst.mockReset();
    createMessageTemplate.mockReset();
    findFirst.mockResolvedValue({ wabaId: "999", encryptedAccessToken: "enc" });
    createMessageTemplate.mockResolvedValue({ id: "t1", status: "PENDING" });
  });

  it("does not call Meta when the body has a trailing variable", async () => {
    await expect(
      createTemplate("tenant1", { ...base, bodyText: "Hi {{1}}, Your Bill no is {{2}}", examples: ["Sarah", "ORD-110"] }),
    ).rejects.toThrow(/cannot end with a variable/);
    expect(createMessageTemplate).not.toHaveBeenCalled();
  });

  it("reports every violation at once", async () => {
    const err = await createTemplate("tenant1", {
      ...base,
      bodyText: "{{1}}Your order {{3}}",
      examples: ["a"],
      footerText: "Ref {{1}}",
    }).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.status).toBe(400);
    expect(err.details.issues.length).toBeGreaterThanOrEqual(3);
  });

  it("calls Meta once and persists when the body is valid", async () => {
    const out = await createTemplate("tenant1", base);
    expect(createMessageTemplate).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ name: "testtemplate", status: "PENDING" });
  });

  it("skips body rules for AUTHENTICATION templates", async () => {
    await createTemplate("tenant1", { name: "otp_code", language: "en_US", category: "AUTHENTICATION" });
    expect(createMessageTemplate).toHaveBeenCalledTimes(1);
  });
});
