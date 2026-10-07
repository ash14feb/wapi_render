import type { Request, Response } from "express";
import { sendError, sendSuccess } from "../utils/response";
import { createFlowSchema, sendFlowSchema, updateFlowSchema } from "../validators/flows.validator";
import { createLocalFlow, deleteLocalFlow, flowResponses, listLocalFlows, publishLocalFlow, sendFlow, syncFlowsFromMeta, updateLocalFlow } from "../services/whatsapp/flows.service";

function tenantId(req: Request): string {
  return req.auth?.tenantId ?? "";
}

export async function handleFlowsError(res: Response, err: unknown): Promise<void> {
  const e = err as { status?: number; code?: string; message?: string };
  sendError(res, e.code ?? "FLOW_ERROR", e.message ?? "Flow operation failed", e.status ?? 500);
}

export async function getFlows(req: Request, res: Response): Promise<void> {
  try {
    sendSuccess(res, { flows: await listLocalFlows(tenantId(req)) });
  } catch (err) {
    await handleFlowsError(res, err);
  }
}

export async function postFlow(req: Request, res: Response): Promise<void> {
  const parsed = createFlowSchema.safeParse(req.body);
  if (!parsed.success) { sendError(res, "VALIDATION_ERROR", "Invalid flow definition", 400, parsed.error.flatten()); return; }
  try {
    sendSuccess(res, { flow: await createLocalFlow(tenantId(req), parsed.data) }, 201);
  } catch (err) {
    await handleFlowsError(res, err);
  }
}

export async function putFlow(req: Request, res: Response): Promise<void> {
  const parsed = updateFlowSchema.safeParse(req.body);
  if (!parsed.success) { sendError(res, "VALIDATION_ERROR", "Invalid flow update", 400, parsed.error.flatten()); return; }
  try {
    sendSuccess(res, { flow: await updateLocalFlow(tenantId(req), req.params.id, parsed.data) });
  } catch (err) {
    await handleFlowsError(res, err);
  }
}

export async function removeFlow(req: Request, res: Response): Promise<void> {
  try {
    sendSuccess(res, await deleteLocalFlow(tenantId(req), req.params.id));
  } catch (err) {
    await handleFlowsError(res, err);
  }
}

export async function publishFlowHandler(req: Request, res: Response): Promise<void> {
  try {
    const { whatsappAccountId } = (req.body ?? {}) as { whatsappAccountId?: string };
    sendSuccess(res, { flow: await publishLocalFlow(tenantId(req), req.params.id, whatsappAccountId) });
  } catch (err) {
    await handleFlowsError(res, err);
  }
}

export async function syncFlows(req: Request, res: Response): Promise<void> {
  try {
    const { whatsappAccountId } = (req.body ?? {}) as { whatsappAccountId?: string };
    sendSuccess(res, await syncFlowsFromMeta(tenantId(req), whatsappAccountId));
  } catch (err) {
    await handleFlowsError(res, err);
  }
}

export async function sendFlowHandler(req: Request, res: Response): Promise<void> {
  const parsed = sendFlowSchema.safeParse(req.body);
  if (!parsed.success) { sendError(res, "VALIDATION_ERROR", "Invalid send payload", 400, parsed.error.flatten()); return; }
  try {
    sendSuccess(res, await sendFlow(tenantId(req), req.params.id, parsed.data));
  } catch (err) {
    await handleFlowsError(res, err);
  }
}

export async function getFlowResponses(req: Request, res: Response): Promise<void> {
  try {
    sendSuccess(res, { responses: await flowResponses(tenantId(req), req.params.id) });
  } catch (err) {
    await handleFlowsError(res, err);
  }
}
