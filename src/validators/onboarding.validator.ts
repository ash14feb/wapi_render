import { z } from "zod";

export const completeOnboardingSchema = z.object({
  code: z.string().min(1).max(2048),
  businessId: z.string().min(1).max(64).optional(),
  wabaId: z.string().min(1).max(64).optional(),
  phoneNumberIds: z.array(z.string().min(1).max(64)).min(1).max(20).optional(),
  pin: z.string().min(4).max(12).optional(),
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
