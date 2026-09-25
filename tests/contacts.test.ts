import { describe, expect, it } from "vitest";
import { createContactSchema, updateContactSchema } from "../src/validators/contacts.validator";

describe("createContactSchema", () => {
  it("accepts E.164 digits with optional plus", () => {
    expect(createContactSchema.safeParse({ phone: "919986439557", name: "Asha" }).success).toBe(true);
    expect(createContactSchema.safeParse({ phone: "+14155552671" }).success).toBe(true);
  });

  it("rejects short/garbage phones", () => {
    expect(createContactSchema.safeParse({ phone: "123" }).success).toBe(false);
    expect(createContactSchema.safeParse({ phone: "not-a-phone" }).success).toBe(false);
  });

  it("rejects bad email but allows empty", () => {
    expect(createContactSchema.safeParse({ phone: "919986439557", email: "nope" }).success).toBe(false);
    expect(createContactSchema.safeParse({ phone: "919986439557", email: "" }).success).toBe(true);
  });
});

describe("updateContactSchema", () => {
  it("accepts partial updates and rejects empty ones", () => {
    expect(updateContactSchema.safeParse({ name: "New" }).success).toBe(true);
    expect(updateContactSchema.safeParse({}).success).toBe(false);
  });
});
