import { z } from "zod";

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  templateId: z.string().min(1).max(64),
  contactIds: z.array(z.string().min(1)).min(1).max(1000),
  // Shared body values applied to every recipient (positional {{n}} order).
  parameters: z.array(z.string().max(1024)).max(20).optional(),
  // Header media for templates with an IMAGE/VIDEO/DOCUMENT header.
  // Upload a file first via POST /whatsapp/media/upload and pass its id,
  // or pass a public https link.
  headerMedia: z
    .object({
      kind: z.enum(["image", "video", "document"]),
      link: z.string().url().max(2048).optional(),
      id: z.string().min(1).max(256).optional(),
    })
    .refine((v) => v.link ?? v.id, { message: "Header media needs link or id" })
    .optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  whatsappAccountId: z.string().min(1).max(64).optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type HeaderMediaInput = NonNullable<CreateCampaignInput["headerMedia"]>;
