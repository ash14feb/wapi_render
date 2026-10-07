import { z } from "zod";
import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { countTemplateVars } from "../../utils/templates";
import { createMessageTemplate, fetchMessageTemplates } from "../meta/meta-client";
import { WhatsappServiceError } from "./whatsapp.service";

export interface NormalizedTemplate {
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string;
  componentsJson: string | null;
}

/** Pick only the documented template fields; ignore everything else. */
export function normalizeTemplate(raw: unknown): NormalizedTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name : "";
  const language = typeof r.language === "string" ? r.language : "";
  if (!name || !language) return null;
  return {
    metaTemplateId: typeof r.id === "string" ? r.id : null,
    name,
    language,
    category: typeof r.category === "string" ? r.category : null,
    status: typeof r.status === "string" ? r.status.toUpperCase() : "UNKNOWN",
    componentsJson: r.components !== undefined ? JSON.stringify(r.components).slice(0, 65535) : null,
  };
}

function resolveAccount(tenantId: string, whatsappAccountId?: string) {
  return whatsappAccountId
    ? prisma.whatsappAccount.findFirst({ where: { id: whatsappAccountId, tenantId } })
    : prisma.whatsappAccount.findFirst({
        where: { tenantId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      });
}

export async function syncTemplates(
  tenantId: string,
  whatsappAccountId?: string,
): Promise<{ synced: number }> {
  const account = await resolveAccount(tenantId, whatsappAccountId);
  if (!account) {
    throw new WhatsappServiceError("WHATSAPP_ACCOUNT_NOT_FOUND", "No WhatsApp account found for tenant", 404);
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(account.encryptedAccessToken);
  } catch {
    throw new WhatsappServiceError("WHATSAPP_CREDENTIAL_ERROR", "Unable to decrypt WhatsApp credential", 500);
  }

  let raw: unknown[];
  try {
    raw = await fetchMessageTemplates({
      wabaId: account.wabaId,
      accessToken,
      graphVersion: config.meta.graphVersion,
    });
  } catch (err) {
    throw new WhatsappServiceError(
      "TEMPLATE_SYNC_FAILED",
      err instanceof Error ? err.message : "Meta sync failed",
      (err as { status?: number }).status ?? 502,
    );
  } finally {
    accessToken = "";
  }

  let synced = 0;
  for (const item of raw) {
    const t = normalizeTemplate(item);
    if (!t) continue;
    await prisma.messageTemplate.upsert({
      where: { tenantId_name_language: { tenantId, name: t.name, language: t.language } },
      update: {
        metaTemplateId: t.metaTemplateId,
        category: t.category,
        status: t.status,
        componentsJson: t.componentsJson,
      },
      create: { tenantId, ...t },
    });
    synced += 1;
  }
  return { synced };
}

export const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "Name must be lowercase alphanumeric with underscores"),
  language: z.string().min(2).max(10),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
  headerFormat: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "NONE"]).optional(),
  headerText: z.string().max(60).optional(),
  // Media handle from POST /whatsapp/media/upload (required for IMAGE/VIDEO/DOCUMENT headers).
  headerHandle: z.string().min(1).max(512).optional(),
  // Custom body — required for UTILITY/MARKETING. AUTHENTICATION uses Meta's
  // fixed preset text + OTP button, so body/header/footer/examples are ignored.
  bodyText: z.string().max(1024).optional(),
  footerText: z.string().max(60).optional(),
  // One sample value per {{n}} variable, in order — required by Meta review.
  examples: z.array(z.string().min(1).max(1024)).max(20).optional(),
  // CTA / interactive buttons (UTILITY + MARKETING only).
  // URL supports one trailing variable: url must end with {{1}} + example sample URL.
  buttons: z
    .array(
      z.object({
        type: z.enum(["URL", "PHONE_NUMBER", "QUICK_REPLY", "COPY_CODE", "FLOW"]),
        text: z.string().min(1).max(25),
        url: z.string().max(2000).optional(),
        phoneNumber: z.string().max(20).optional(),
        example: z.string().max(2000).optional(),
        flowId: z.string().max(128).optional(),
        navigateScreen: z.string().max(64).optional(),
      }),
    )
    .max(10)
    .optional(),
  // AUTHENTICATION only: code expiry minutes shown in the footer (1-60).
  codeExpirationMinutes: z.number().int().min(1).max(60).optional(),
  whatsappAccountId: z.string().min(1).max(64).optional(),
}).superRefine((v, ctx) => {
  if (v.category === "AUTHENTICATION") {
    if (v.buttons?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Buttons are not allowed on AUTHENTICATION templates", path: ["buttons"] });
    }
    return;
  }
  if (!v.bodyText?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bodyText is required for UTILITY/MARKETING templates", path: ["bodyText"] });
  }
  const fmt = v.headerFormat ?? (v.headerText ? "TEXT" : undefined);
  if (fmt === "TEXT" && !v.headerText) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "headerText is required for TEXT headers", path: ["headerText"] });
  }
  if (fmt && ["IMAGE", "VIDEO", "DOCUMENT"].includes(fmt) && !v.headerHandle) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `headerHandle (from media upload) is required for ${fmt} headers`, path: ["headerHandle"] });
  }
  const buttons = v.buttons ?? [];
  if (buttons.length > 10) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Max 10 buttons per template", path: ["buttons"] });
  }
  const count = (t: string) => buttons.filter((b) => b.type === t).length;
  if (count("URL") > 2) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Max 2 URL buttons per template", path: ["buttons"] });
  if (count("PHONE_NUMBER") > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Max 1 phone-number button per template", path: ["buttons"] });
  if (count("COPY_CODE") > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Max 1 copy-code button per template", path: ["buttons"] });
  if (count("FLOW") > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Max 1 Flow button per template", path: ["buttons"] });
  buttons.forEach((b, i) => {
    if (b.type === "URL") {
      if (!b.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Button ${i + 1}: URL is required`, path: ["buttons", i, "url"] });
      else {
        if (!/^https?:\/\/.+/.test(b.url)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Button ${i + 1}: URL must start with http(s)://`, path: ["buttons", i, "url"] });
        const vars = (b.url.match(/\{\{\d+\}\}/g) ?? []).length;
        if (vars > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Button ${i + 1}: only one trailing {{1}} variable is allowed`, path: ["buttons", i, "url"] });
        if (vars === 1 && !/\{\{1\}\}$/.test(b.url)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Button ${i + 1}: the {{1}} variable must be at the end of the URL`, path: ["buttons", i, "url"] });
        if (vars === 1 && !b.example) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Button ${i + 1}: a sample URL is required when the URL has {{1}}`, path: ["buttons", i, "example"] });
      }
    }
    if (b.type === "PHONE_NUMBER" && !b.phoneNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Button ${i + 1}: phone number is required`, path: ["buttons", i, "phoneNumber"] });
    }
    if (b.type === "FLOW" && !b.flowId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Button ${i + 1}: published Flow ID is required`, path: ["buttons", i, "flowId"] });
    }
  });
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

function buildCustomComponents(input: CreateTemplateInput): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  const rawFormat = input.headerFormat ?? (input.headerText ? "TEXT" : undefined);
  const headerFormat = rawFormat === "NONE" ? undefined : rawFormat;
  if (headerFormat === "TEXT") {
    components.push({ type: "HEADER", format: "TEXT", text: input.headerText });
  } else if (headerFormat && input.headerHandle) {
    components.push({
      type: "HEADER",
      format: headerFormat,
      example: { header_handle: [input.headerHandle] },
    });
  }
  const varCount = countTemplateVars(input.bodyText ?? "");
  const body: Record<string, unknown> = { type: "BODY", text: input.bodyText };
  if (varCount > 0) body.example = { body_text: [input.examples ?? []] };
  components.push(body);
  if (input.footerText) {
    components.push({ type: "FOOTER", text: input.footerText });
  }
  const buttons = input.buttons ?? [];
  if (buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map((b) => {
        switch (b.type) {
          case "URL": {
            const hasVar = /\{\{1\}\}$/.test(b.url ?? "");
            return {
              type: "URL",
              text: b.text,
              url: b.url,
              ...(hasVar && b.example ? { example: [b.example] } : {}),
            };
          }
          case "PHONE_NUMBER":
            return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
          case "COPY_CODE":
            return { type: "COPY_CODE", text: b.text, ...(b.example ? { example: b.example } : {}) };
          case "FLOW":
            return {
              type: "FLOW",
              text: b.text,
              flow_id: b.flowId,
              flow_action: "navigate",
              ...(b.navigateScreen ? { navigate_screen: b.navigateScreen } : {}),
            };
          case "QUICK_REPLY":
          default:
            return { type: "QUICK_REPLY", text: b.text };
        }
      }),
    });
  }
  return components;
}

export async function createTemplate(tenantId: string, input: CreateTemplateInput) {
  const account = await resolveAccount(tenantId, input.whatsappAccountId);
  if (!account) {
    throw new WhatsappServiceError("WHATSAPP_ACCOUNT_NOT_FOUND", "No WhatsApp account found for tenant", 404);
  }

  const varCount = countTemplateVars(input.bodyText ?? "");
  const examples = input.examples ?? [];
  if (input.category !== "AUTHENTICATION" && varCount > 0 && examples.length !== varCount) {
    throw new WhatsappServiceError(
      "VALIDATION_ERROR",
      `Body has ${varCount} variable(s); provide exactly ${varCount} example value(s)`,
      400,
    );
  }

  // AUTHENTICATION templates use Meta's fixed preset text + OTP copy-code
  // button (custom body/header/media are not allowed in this category).
  // Shape verified against the official collection example.
  const components: Array<Record<string, unknown>> =
    input.category === "AUTHENTICATION"
      ? [
          { type: "BODY", add_security_recommendation: true },
          { type: "FOOTER", code_expiration_minutes: input.codeExpirationMinutes ?? 10 },
          {
            type: "BUTTONS",
            buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy Code" }],
          },
        ]
      : buildCustomComponents(input);

  let accessToken: string;
  try {
    accessToken = decryptToken(account.encryptedAccessToken);
  } catch {
    throw new WhatsappServiceError("WHATSAPP_CREDENTIAL_ERROR", "Unable to decrypt WhatsApp credential", 500);
  }

  let created: { id: string; status: string };
  try {
    created = await createMessageTemplate({
      wabaId: account.wabaId,
      accessToken,
      graphVersion: config.meta.graphVersion,
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    });
  } catch (err) {
    throw new WhatsappServiceError(
      "TEMPLATE_CREATE_FAILED",
      err instanceof Error ? err.message : "Meta create failed",
      (err as { status?: number }).status ?? 502,
      // Full Meta body: code, error_subcode, error_data.blame_field, fbtrace_id
      (err as { metaBody?: unknown }).metaBody ?? undefined,
    );
  } finally {
    accessToken = "";
  }

  return prisma.messageTemplate.upsert({
    where: { tenantId_name_language: { tenantId, name: input.name, language: input.language } },
    update: {
      metaTemplateId: created.id,
      category: input.category,
      status: created.status,
      componentsJson: JSON.stringify(components),
    },
    create: {
      tenantId,
      metaTemplateId: created.id,
      name: input.name,
      language: input.language,
      category: input.category,
      status: created.status,
      componentsJson: JSON.stringify(components),
    },
  });
}

export function listTemplates(tenantId: string) {
  return prisma.messageTemplate.findMany({
    where: { tenantId },
    orderBy: [{ name: "asc" }, { language: "asc" }],
  });
}
