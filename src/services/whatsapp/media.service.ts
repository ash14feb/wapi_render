import multer from "multer";
import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { uploadMediaToMeta, uploadSendMedia } from "../meta/meta-client";
import { WhatsappServiceError } from "./whatsapp.service";

const ALLOWED_MIME = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["video/mp4", "mp4"],
  ["application/pdf", "pdf"],
]);

const MAX_BYTES = 5 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported media type: ${file.mimetype}. Use JPEG/PNG/WebP, MP4 or PDF.`));
  },
});

export type UploadPurpose = "send" | "sample";

export async function uploadMedia(
  tenantId: string,
  file: Express.Multer.File,
  whatsappAccountId?: string,
  purpose: UploadPurpose = "send",
): Promise<{ handle: string; mimeType: string; size: number }> {
  if (purpose === "sample" && !config.meta.appId) {
    throw new WhatsappServiceError("SERVER_MISCONFIGURED", "META_APP_ID is not configured", 500);
  }
  const account = whatsappAccountId
    ? await prisma.whatsappAccount.findFirst({ where: { id: whatsappAccountId, tenantId } })
    : await prisma.whatsappAccount.findFirst({
        where: { tenantId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      });
  if (!account) {
    throw new WhatsappServiceError("WHATSAPP_ACCOUNT_NOT_FOUND", "No WhatsApp account found for tenant", 404);
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(account.encryptedAccessToken);
  } catch {
    throw new WhatsappServiceError("WHATSAPP_CREDENTIAL_ERROR", "Unable to decrypt WhatsApp credential", 500);
  }

  try {
    const ext = ALLOWED_MIME.get(file.mimetype) ?? "bin";
    if (purpose === "sample") {
      // Resumable handle — valid ONLY as example.header_handle at creation.
      const { handle } = await uploadMediaToMeta({
        appId: config.meta.appId,
        accessToken,
        graphVersion: config.meta.graphVersion,
        fileName: file.originalname || `upload.${ext}`,
        mimeType: file.mimetype,
        data: file.buffer,
      });
      return { handle, mimeType: file.mimetype, size: file.size };
    }
    // Numeric media id — valid as image/video/document id in send payloads.
    const { id } = await uploadSendMedia({
      phoneNumberId: account.phoneNumberId,
      accessToken,
      graphVersion: config.meta.graphVersion,
      fileName: file.originalname || `upload.${ext}`,
      mimeType: file.mimetype,
      data: file.buffer,
    });
    return { handle: id, mimeType: file.mimetype, size: file.size };
  } catch (err) {
    throw new WhatsappServiceError(
      "MEDIA_UPLOAD_FAILED",
      err instanceof Error ? err.message : "Meta upload failed",
      (err as { status?: number }).status ?? 502,
    );
  } finally {
    accessToken = "";
  }
}
