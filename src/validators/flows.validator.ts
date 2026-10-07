import { z } from "zod";

export const FLOW_CATEGORIES = ["SIGN_UP", "SIGN_IN", "APPOINTMENT_BOOKING", "LEAD_GENERATION", "CONTACT_US", "CUSTOMER_SUPPORT", "SURVEY", "SHOPPING", "LOYALTY", "DATA_APPEND", "OTHER"] as const;

// Meta flow names behave like template names: lowercase snake_case.
export const flowNameSchema = z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, "Flow name must be lowercase letters, numbers, underscores only (e.g. cod_confirm_form)");

// Meta ids (screen id, option id, field name): alphabets + underscores only.
const metaId = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z_]*$/, "Must start with a letter, alphabets and underscores only (no numbers)");

const fieldSchema = z.object({
  kind: z.enum(["text", "textarea", "number", "email", "dropdown", "checkbox", "radio", "date"]),
  label: z.string().min(1).max(120),
  name: metaId,
  required: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.string().min(1).max(120)).max(50).optional(),
});

const screenSchema = z.object({
  id: metaId,
  title: z.string().min(1).max(120),
  fields: z.array(fieldSchema).max(20),
});

export const createFlowSchema = z.object({
  name: flowNameSchema,
  categories: z.array(z.enum(FLOW_CATEGORIES as unknown as [string, ...string[]])).max(5).optional(),
  screens: z.array(screenSchema).min(1).max(10),
});

export const updateFlowSchema = z.object({
  name: flowNameSchema.optional(),
  screens: z.array(screenSchema).min(1).max(10).optional(),
});

export const sendFlowSchema = z.object({
  to: z.string().regex(/^\+?[1-9]\d{7,14}$/, "Recipient phone must be E.164 format"),
  cta: z.string().min(1).max(30).default("Open form"),
  headerText: z.string().max(60).optional(),
  bodyText: z.string().min(1).max(1024),
  footerText: z.string().max(60).optional(),
  whatsappAccountId: z.string().min(1).max(64).optional(),
});

export type CreateFlowInput = z.infer<typeof createFlowSchema>;
export type UpdateFlowInput = z.infer<typeof updateFlowSchema>;
export type SendFlowInput = z.infer<typeof sendFlowSchema>;
