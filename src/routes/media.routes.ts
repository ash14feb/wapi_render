import { Router } from "express";
import { uploadMediaHandler } from "../controllers/media.controller";
import { authenticate } from "../middleware/auth";

export const mediaRouter = Router();

mediaRouter.post("/whatsapp/media/upload", authenticate, uploadMediaHandler);
