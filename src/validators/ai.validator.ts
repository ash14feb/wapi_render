import { z } from "zod";

export const salesPlaybookSchema = z.object({
  valueProposition: z.string().max(4000).default(""),
  keyBenefits: z.array(z.string().max(500)).max(30).default([]),
  differentiators: z.array(z.string().max(500)).max(30).default([]),
  objections: z
    .array(
      z.object({
        objection: z.string().min(1).max(1000),
        response: z.string().min(1).max(2000),
      }),
    )
    .max(50)
    .default([]),
  closingGuidance: z.string().max(4000).default(""),
});

export const discountPolicySchema = z.object({
  maxDiscountPercent: z.number().min(0).max(100).default(0),
  allowGenericDiscounts: z.boolean().default(false),
  requireHumanApprovalAbove: z.number().min(0).max(100).default(0),
  currency: z.string().min(1).max(10).default("USD"),
  notes: z.string().max(2000).default(""),
});

export const updateAiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  providerBaseUrl: z.string().url().max(500).optional(),
  apiKey: z.string().min(1).max(8192).optional(),
  clearApiKey: z.boolean().optional(),
  model: z.string().min(1).max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(4096).optional(),
  requestTimeoutMs: z.number().int().min(3000).max(60000).optional(),
  maxRetries: z.number().int().min(0).max(3).optional(),
  historyWindow: z.number().int().min(2).max(50).optional(),
  systemPrompt: z.string().max(20000).optional(),
  businessInfo: z.string().max(20000).nullable().optional(),
  language: z.string().min(1).max(40).optional(),
  tone: z.string().min(1).max(60).optional(),
  humanLike: z.boolean().optional(),
  replyDelayMs: z.number().int().min(0).max(5000).optional(),
  salesPlaybook: salesPlaybookSchema.nullable().optional(),
  discountPolicy: discountPolicySchema.nullable().optional(),
  handoffEnabled: z.boolean().optional(),
  handoffInstructions: z.string().max(4000).nullable().optional(),
  fallbackMessage: z.string().max(4096).nullable().optional(),
});

export const aiTestSchema = z.object({
  providerBaseUrl: z.string().url().max(500).optional(),
  apiKey: z.string().min(1).max(8192).optional(),
  model: z.string().min(1).max(200).optional(),
});

export const aiPlaygroundSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
});

export const knowledgeEntrySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20000),
  category: z.string().max(100).nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10000).default(0),
});

export const updateKnowledgeEntrySchema = knowledgeEntrySchema.partial();

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid date" });

export const offerSchema = z
  .object({
    name: z.string().min(1).max(200),
    code: z.string().max(60).nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
    discountType: z.enum(["PERCENT", "FIXED"]).default("PERCENT"),
    discountValue: z.number().int().min(0).max(100000000).default(0),
    minOrderValue: z.number().int().min(0).max(100000000).nullable().optional(),
    maxDiscountValue: z.number().int().min(0).max(100000000).nullable().optional(),
    validFrom: isoDate.nullable().optional(),
    validTo: isoDate.nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine((v) => v.discountType !== "PERCENT" || v.discountValue <= 100, {
    message: "Percent discounts must be between 0 and 100",
    path: ["discountValue"],
  });

export const updateOfferSchema = offerSchema.innerType().partial();

export const aiConversationStateSchema = z.object({
  aiEnabled: z.boolean().nullable().optional(),
  resetMemory: z.boolean().optional(),
});

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;
export type AiTestInput = z.infer<typeof aiTestSchema>;
export type AiPlaygroundInput = z.infer<typeof aiPlaygroundSchema>;
export type KnowledgeEntryInput = z.infer<typeof knowledgeEntrySchema>;
export type UpdateKnowledgeEntryInput = z.infer<typeof updateKnowledgeEntrySchema>;
export type OfferInput = z.infer<typeof offerSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
export type AiConversationStateInput = z.infer<typeof aiConversationStateSchema>;
