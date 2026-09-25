import { z } from "zod";

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(16)
  .regex(/^\+?[1-9]\d{6,14}$/, "Phone must be digits, E.164 style (e.g. 919986439557)");

export const createContactSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(1).max(120).optional(),
  profileName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  tags: z.string().trim().max(2000).optional(),
});

export const updateContactSchema = createContactSchema
  .omit({ phone: true })
  .extend({ phone: phoneSchema.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
