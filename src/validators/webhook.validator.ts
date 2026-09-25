import { z } from "zod";

// Loose, defensive shapes. Field names come from Meta's webhook payload
// reference (object/entry/changes/value/messages/statuses/contacts/metadata).
// Unknown fields are ignored so payload evolution doesn't break ingestion.

const mediaObjectSchema = z
  .object({
    id: z.string().optional(),
    mime_type: z.string().optional(),
    caption: z.string().optional(),
    filename: z.string().optional(),
  })
  .passthrough();

const metaMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().optional(),
    timestamp: z.string().optional(),
    type: z.string().optional(),
    text: z.object({ body: z.string() }).partial().optional(),
    image: mediaObjectSchema.optional(),
    video: mediaObjectSchema.optional(),
    document: mediaObjectSchema.optional(),
    audio: mediaObjectSchema.optional(),
    sticker: mediaObjectSchema.optional(),
  })
  .passthrough();

const metaStatusSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().optional(),
    timestamp: z.string().optional(),
    errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();

const metaValueSchema = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z
      .object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    contacts: z
      .array(
        z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).passthrough().optional() }).passthrough(),
      )
      .optional(),
    messages: z.array(metaMessageSchema).optional(),
    statuses: z.array(metaStatusSchema).optional(),
  })
  .passthrough();

const metaChangeSchema = z
  .object({ field: z.string().optional(), value: metaValueSchema.optional() })
  .passthrough();

export const webhookPayloadSchema = z
  .object({
    object: z.string().optional(),
    entry: z
      .array(z.object({ id: z.string().optional(), changes: z.array(metaChangeSchema).optional() }).passthrough())
      .optional(),
  })
  .passthrough();

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type MetaValue = z.infer<typeof metaValueSchema>;
