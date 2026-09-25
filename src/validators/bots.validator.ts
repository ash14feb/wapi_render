import { z } from "zod";

export const botRuleSchema = z.object({
  name: z.string().min(1).max(200),
  whatsappAccountId: z.string().min(1).max(64).nullable().optional(),
  matchType: z.enum(["EXACT", "CONTAINS", "STARTS_WITH", "DEFAULT"]).default("CONTAINS"),
  trigger: z.string().max(500).default(""),
  replyText: z.string().min(1).max(4096),
  handoff: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10000).default(0),
});

export const updateBotRuleSchema = botRuleSchema.partial();

export type BotRuleInput = z.infer<typeof botRuleSchema>;
export type UpdateBotRuleInput = z.infer<typeof updateBotRuleSchema>;
