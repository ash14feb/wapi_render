import type { Request, Response } from "express";
import { upload, uploadMedia } from "../services/whatsapp/media.service";
import { WhatsappServiceError } from "../services/whatsapp/whatsapp.service";
import { sendError, sendSuccess } from "../utils/response";

export function uploadMediaHandler(req: Request, res: Response): void {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const single = upload.single("file");
  single(req, res, (err: unknown) => {
    (async () => {
      if (err) {
        sendError(res, "VALIDATION_ERROR", err instanceof Error ? err.message : "Upload failed", 400);
        return;
      }
      if (!req.file) {
        sendError(res, "VALIDATION_ERROR", "Attach a file as multipart field 'file'", 400);
        return;
      }
      try {
        const rawPurpose =
          typeof req.query.purpose === "string"
            ? req.query.purpose
            : typeof req.body?.purpose === "string"
              ? req.body.purpose
              : "send";
        const purpose = rawPurpose === "sample" ? "sample" : "send";
        const result = await uploadMedia(
          (req.auth as NonNullable<Request["auth"]>).tenantId,
          req.file,
          typeof req.body?.whatsappAccountId === "string" ? req.body.whatsappAccountId : undefined,
          purpose,
        );
        sendSuccess(res, result, 201);
      } catch (e) {
        if (e instanceof WhatsappServiceError) sendError(res, e.code, e.message, e.status);
        else sendError(res, "MEDIA_UPLOAD_FAILED", "Unable to upload media", 502);
      }
    })().catch(() => sendError(res, "MEDIA_UPLOAD_FAILED", "Unable to upload media", 502));
  });
}
