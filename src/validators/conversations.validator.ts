import { z } from "zod";

const textMessage = z.object({
  text: z.string().min(1).max(4096),
});

const mediaMessage = z.object({
  mediaKind: z.enum(["image", "video", "document"]),
  mediaId: z.string().min(1).max(256).optional(),
  mediaLink: z.string().url().max(2048).optional(),
  caption: z.string().max(1024).optional(),
  filename: z.string().max(255).optional(),
}).refine((v) => v.mediaId ?? v.mediaLink, {
  message: "Media message needs mediaId (uploaded) or mediaLink",
});

export const sendMessageSchema = z.union([textMessage, mediaMessage]);

// Back-compat export for existing imports.
export const sendTextSchema = textMessage;

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendTextInput = z.infer<typeof textMessage>;
