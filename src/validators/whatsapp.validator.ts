import { z } from "zod";

const languageSchema = z.string().min(2).max(10);

const textParam = z.object({ type: z.literal("text"), text: z.string().min(1).max(1024) });

const mediaRef = z
  .object({ link: z.string().url().max(2048).optional(), id: z.string().min(1).max(256).optional() })
  .refine((v) => v.link ?? v.id, { message: "Media parameter needs link or id" });

const mediaParam = z.object({
  type: z.enum(["image", "video", "document"]),
  image: mediaRef.optional(),
  video: mediaRef.optional(),
  document: mediaRef.optional(),
});

const bodyComponentSchema = z.object({
  type: z.literal("body"),
  parameters: z.array(textParam).max(20).optional(),
});

const headerComponentSchema = z.object({
  type: z.literal("header"),
  parameters: z.array(mediaParam).max(1).optional(),
});

const buttonComponentSchema = z.object({
  type: z.literal("button"),
  sub_type: z.enum(["quick_reply", "url"]).optional(),
  index: z.string().regex(/^\d+$/).optional(),
  parameters: z.array(textParam).max(20).optional(),
});

const componentSchema = z.union([bodyComponentSchema, headerComponentSchema, buttonComponentSchema]);

export const sendTemplateSchema = z.object({
  to: z.string().regex(/^\+?[1-9]\d{7,14}$/, "Recipient phone must be E.164 format"),
  templateName: z.string().min(1).max(512),
  language: languageSchema.default("en"),
  components: z.array(componentSchema).max(10).optional(),
  whatsappAccountId: z.string().min(1).max(64).optional(),
});

export type SendTemplateInput = z.infer<typeof sendTemplateSchema>;
