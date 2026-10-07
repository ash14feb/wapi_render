import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { buildFlowJson, validateScreens } from "../../utils/flowBuilder";
import type { FlowScreen } from "../../utils/flowBuilder";
import { createFlow, listFlows, publishFlow, sendFlowMessage, uploadFlowJson } from "../meta/meta-client";
import { WhatsappServiceError } from "./whatsapp.service";
import type { CreateFlowInput, SendFlowInput, UpdateFlowInput } from "../../validators/flows.validator";

function resolveAccount(tenantId: string, whatsappAccountId?: string) {
  return whatsappAccountId
    ? prisma.whatsappAccount.findFirst({ where: { id: whatsappAccountId, tenantId } })
    : prisma.whatsappAccount.findFirst({ where: { tenantId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

function tokenOf(encrypted: string): string {
  try {
    return decryptToken(encrypted);
  } catch {
    throw new WhatsappServiceError("WHATSAPP_CREDENTIAL_ERROR", "Unable to decrypt WhatsApp credential", 500);
  }
}

export async function listLocalFlows(tenantId: string) {
  return prisma.whatsappFlow.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" } });
}

export async function createLocalFlow(tenantId: string, input: CreateFlowInput) {
  const err = validateScreens(input.screens as FlowScreen[]);
  if (err) throw new WhatsappServiceError("FLOW_VALIDATION_ERROR", err, 400);
  const flowJson = JSON.stringify(buildFlowJson(input.screens as FlowScreen[]));
  try {
    return await prisma.whatsappFlow.create({
      data: { tenantId, name: input.name, status: "DRAFT", categories: JSON.stringify(input.categories ?? ["OTHER"]), flowJson },
    });
  } catch {
    throw new WhatsappServiceError("FLOW_EXISTS", "A flow with this name already exists", 409);
  }
}

export async function updateLocalFlow(tenantId: string, id: string, input: UpdateFlowInput) {
  const existing = await prisma.whatsappFlow.findFirst({ where: { id, tenantId } });
  if (!existing) throw new WhatsappServiceError("FLOW_NOT_FOUND", "Flow not found", 404);
  if (existing.status === "PUBLISHED") throw new WhatsappServiceError("FLOW_LOCKED", "Published flows are read-only — Meta locks them. Duplicate it to iterate.", 400);
  const data: { name?: string; flowJson?: string; version?: { increment: number } } = {};
  if (input.name) data.name = input.name;
  if (input.screens) {
    const err = validateScreens(input.screens as FlowScreen[]);
    if (err) throw new WhatsappServiceError("FLOW_VALIDATION_ERROR", err, 400);
    data.flowJson = JSON.stringify(buildFlowJson(input.screens as FlowScreen[]));
    data.version = { increment: 1 };
  }
  try {
    return await prisma.whatsappFlow.update({ where: { id }, data });
  } catch {
    throw new WhatsappServiceError("FLOW_EXISTS", "A flow with this name already exists", 409);
  }
}

export async function deleteLocalFlow(tenantId: string, id: string) {
  const existing = await prisma.whatsappFlow.findFirst({ where: { id, tenantId } });
  if (!existing) throw new WhatsappServiceError("FLOW_NOT_FOUND", "Flow not found", 404);
  if (existing.status === "PUBLISHED") throw new WhatsappServiceError("FLOW_LOCKED", "Published flows cannot be deleted locally. Deprecate in Meta first.", 400);
  await prisma.whatsappFlow.delete({ where: { id } });
  return { deleted: true };
}

/** Pushes draft to Meta (create + upload JSON + publish), like template sync. */
export async function publishLocalFlow(tenantId: string, id: string, whatsappAccountId?: string) {
  const flow = await prisma.whatsappFlow.findFirst({ where: { id, tenantId } });
  if (!flow) throw new WhatsappServiceError("FLOW_NOT_FOUND", "Flow not found", 404);
  const account = await resolveAccount(tenantId, whatsappAccountId);
  if (!account) throw new WhatsappServiceError("WHATSAPP_ACCOUNT_NOT_FOUND", "No WhatsApp account found for tenant", 404);
  const accessToken = tokenOf(account.encryptedAccessToken);
  const gv = config.meta.graphVersion;
  try {
    let metaFlowId = flow.metaFlowId;
    if (!metaFlowId) {
      const created = await createFlow({ wabaId: account.wabaId, accessToken, graphVersion: gv, name: flow.name, categories: JSON.parse(flow.categories ?? '["OTHER"]') as string[] });
      metaFlowId = created.id;
    }
    await uploadFlowJson({ flowId: metaFlowId as string, accessToken, graphVersion: gv, flowJson: flow.flowJson });
    await publishFlow({ flowId: metaFlowId as string, accessToken, graphVersion: gv });
    return await prisma.whatsappFlow.update({ where: { id }, data: { metaFlowId, status: "PUBLISHED" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Meta publish failed";
    const status = (err as { status?: number }).status ?? 502;
    throw new WhatsappServiceError("FLOW_PUBLISH_FAILED", `Meta: ${message}`, status);
  } finally {
    // accessToken is a local copy; nothing to clear.
  }
}

/** Pulls Meta flows into local list (mirrors template sync). */
export async function syncFlowsFromMeta(tenantId: string, whatsappAccountId?: string): Promise<{ synced: number }> {
  const account = await resolveAccount(tenantId, whatsappAccountId);
  if (!account) throw new WhatsappServiceError("WHATSAPP_ACCOUNT_NOT_FOUND", "No WhatsApp account found for tenant", 404);
  const accessToken = tokenOf(account.encryptedAccessToken);
  let raw: unknown[];
  try {
    raw = await listFlows({ wabaId: account.wabaId, accessToken, graphVersion: config.meta.graphVersion });
  } catch (err) {
    throw new WhatsappServiceError("FLOW_SYNC_FAILED", err instanceof Error ? err.message : "Meta sync failed", (err as { status?: number }).status ?? 502);
  }
  let synced = 0;
  for (const item of raw) {
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") continue;
    const status = typeof r.status === "string" ? r.status.toUpperCase() : "UNKNOWN";
    const existing = await prisma.whatsappFlow.findFirst({ where: { tenantId, metaFlowId: r.id } });
    if (existing) {
      await prisma.whatsappFlow.update({ where: { id: existing.id }, data: { status, name: r.name } });
    } else {
      const nameTaken = await prisma.whatsappFlow.findFirst({ where: { tenantId, name: r.name } });
      await prisma.whatsappFlow.create({
        data: {
          tenantId,
          metaFlowId: r.id,
          name: nameTaken ? `${r.name}_meta` : r.name,
          status,
          categories: JSON.stringify(r.categories ?? ["OTHER"]),
          flowJson: '{"version":"7.1","screens":[]}',
        },
      });
    }
    synced += 1;
  }
  return { synced };
}

export async function sendFlow(tenantId: string, id: string, input: SendFlowInput) {
  const flow = await prisma.whatsappFlow.findFirst({ where: { id, tenantId } });
  if (!flow) throw new WhatsappServiceError("FLOW_NOT_FOUND", "Flow not found", 404);
  if (flow.status !== "PUBLISHED" || !flow.metaFlowId) {
    throw new WhatsappServiceError("FLOW_NOT_PUBLISHED", "Only PUBLISHED flows can be sent. Publish first.", 400);
  }
  const account = await resolveAccount(tenantId, input.whatsappAccountId);
  if (!account) throw new WhatsappServiceError("WHATSAPP_ACCOUNT_NOT_FOUND", "No WhatsApp account found for tenant", 404);
  const accessToken = tokenOf(account.encryptedAccessToken);
  let firstScreen = "COMPLETE";
  try {
    const parsed = JSON.parse(flow.flowJson) as { screens?: { id?: string }[] };
    firstScreen = parsed.screens?.[0]?.id ?? "COMPLETE";
  } catch { /* fallback */ }
  const flowToken = `${flow.id}:${Date.now()}`;
  try {
    const whatsappMessageId = await sendFlowMessage({
      phoneNumberId: account.phoneNumberId,
      accessToken,
      graphVersion: config.meta.graphVersion,
      to: input.to,
      flowId: flow.metaFlowId,
      cta: input.cta,
      flowToken,
      headerText: input.headerText,
      bodyText: input.bodyText,
      footerText: input.footerText,
      firstScreen,
    });
    // Record send for response attribution (phone + 24h window match on reply).
    await prisma.webhookEvent.create({
      data: { tenantId, eventType: "whatsapp.flow.sent", externalEventId: whatsappMessageId, payloadJson: JSON.stringify({ flowId: flow.id, metaFlowId: flow.metaFlowId, phone: input.to }).slice(0, 2000), processingStatus: "PROCESSED", processedAt: new Date() },
    });
    return { whatsappMessageId };
  } catch (err) {
    throw new WhatsappServiceError("FLOW_SEND_FAILED", err instanceof Error ? err.message : "Meta send failed", (err as { status?: number }).status ?? 502);
  }
}

export async function flowResponses(tenantId: string, id: string) {
  const flow = await prisma.whatsappFlow.findFirst({ where: { id, tenantId } });
  if (!flow) throw new WhatsappServiceError("FLOW_NOT_FOUND", "Flow not found", 404);
  return prisma.whatsappFlowResponse.findMany({ where: { tenantId, flowId: id }, orderBy: { receivedAt: "desc" }, take: 50 });
}
