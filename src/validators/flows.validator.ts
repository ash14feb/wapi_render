import { z } from "zod";

const fieldSchema = z.object({
  kind: z.enum(["text", "textarea", "number", "email", "dropdown", "checkbox", "radio", "date"]),
  label: z.string().min(1).max(120),
  name: z.string().min(1).max(64),
  required: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.string().min(1).max(120)).max(50).optional(),
});

const screenSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  fields: z.array(fieldSchema).max(20),
});

export const createFlowSchema = z.object({
  name: z.string().min(1).max(100),
  categories: z.array(z.string().min(1).max(40)).max(5).optional(),
  screens: z.array(screenSchema).min(1).max(10),
});

export const updateFlowSchema = z.object({
  name: z.string().min(1).max(100).optional(),
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
