import { prisma } from "../../config/prisma";
import { countTemplateVars, extractBodyText, extractHeaderFormat } from "../../utils/templates";
import { WhatsappServiceError } from "./whatsapp.service";
import type { CreateCampaignInput } from "../../validators/campaigns.validator";
import { processCampaign } from "./campaignWorker";

export async function createCampaign(tenantId: string, input: CreateCampaignInput) {
  const template = await prisma.messageTemplate.findFirst({
    where: { id: input.templateId, tenantId },
  });
  if (!template) throw new WhatsappServiceError("TEMPLATE_NOT_FOUND", "Template not found", 404);
  if (template.status !== "APPROVED") {
    throw new WhatsappServiceError("TEMPLATE_NOT_APPROVED", "Only APPROVED templates can be used in campaigns", 400);
  }

  const varCount = countTemplateVars(extractBodyText(template.componentsJson) ?? "");
  const parameters = input.parameters ?? [];
  if (varCount !== parameters.length) {
    throw new WhatsappServiceError(
      "VALIDATION_ERROR",
      `Template has ${varCount} variable(s); provide exactly ${varCount} shared parameter(s)`,
      400,
    );
  }

  // Templates with a media header require the header asset on every send —
  // otherwise Meta rejects with #132012 (parameter format mismatch).
  const headerFormat = extractHeaderFormat(template.componentsJson);
  const needsHeaderMedia = !!headerFormat && headerFormat !== "TEXT";
  if (needsHeaderMedia && !input.headerMedia) {
    throw new WhatsappServiceError(
      "VALIDATION_ERROR",
      `Template has a ${headerFormat} header; provide headerMedia (upload via POST /whatsapp/media/upload or a public link)`,
      400,
    );
  }
  if (needsHeaderMedia && input.headerMedia && input.headerMedia.kind !== headerFormat.toLowerCase()) {
    throw new WhatsappServiceError(
      "VALIDATION_ERROR",
      `Template header is ${headerFormat} but headerMedia kind is ${input.headerMedia.kind}`,
      400,
    );
  }

  const contacts = await prisma.contact.findMany({
    where: { tenantId, id: { in: input.contactIds } },
    select: { id: true },
  });
  if (contacts.length === 0) {
    throw new WhatsappServiceError("NO_RECIPIENTS", "None of the contacts belong to this tenant", 400);
  }
  const uniqueIds = [...new Set(contacts.map((c) => c.id))];

  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const status = scheduledAt && scheduledAt.getTime() > Date.now() ? "SCHEDULED" : "DRAFT";

  // Honor the UI's selected sending number; fall back to first ACTIVE at send time.
  let whatsappAccountId: string | null = null;
  if (input.whatsappAccountId) {
    const selected = await prisma.whatsappAccount.findFirst({
      where: { id: input.whatsappAccountId, tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!selected) throw new WhatsappServiceError("WHATSAPP_ACCOUNT_NOT_FOUND", "Selected WhatsApp number not found", 404);
    whatsappAccountId = selected.id;
  }

  return prisma.campaign.create({
    data: {
      tenantId,
      name: input.name,
      templateId: template.id,
      whatsappAccountId,
      parametersJson: JSON.stringify({ body: parameters, header: input.headerMedia ?? null }),
      status,
      scheduledAt,
      recipients: {
        create: uniqueIds.map((contactId) => ({ tenantId, contactId, status: "PENDING" })),
      },
    },
    include: { _count: { select: { recipients: true } } },
  });
}

export async function recipientCounts(campaignId: string) {
  const groups = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: true,
  });
  const counts: Record<string, number> = { PENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0 };
  let total = 0;
  for (const g of groups) {
    counts[g.status] = (counts[g.status] ?? 0) + g._count;
    total += g._count;
  }
  return { ...counts, total };
}

export async function listCampaigns(tenantId: string, cursor?: string, limit = 25) {
  const take = Math.min(Math.max(limit, 1), 50);
  const campaigns = await prisma.campaign.findMany({
    where: { tenantId },
    include: { template: { select: { id: true, name: true, language: true } } },
    orderBy: { createdAt: "desc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1,
  });
  const hasMore = campaigns.length > take;
  const page = hasMore ? campaigns.slice(0, take) : campaigns;
  // Single groupBy for the whole page (no per-campaign N+1).
  const ids = page.map((c) => c.id);
  const groups =
    ids.length > 0
      ? await prisma.campaignRecipient.groupBy({
          by: ["campaignId", "status"],
          where: { campaignId: { in: ids } },
          _count: true,
        })
      : [];
  const countsByCampaign = new Map<string, Record<string, number>>();
  for (const c of page) countsByCampaign.set(c.id, { PENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0, total: 0 });
  for (const g of groups) {
    const entry = countsByCampaign.get(g.campaignId)!;
    entry[g.status] = (entry[g.status] ?? 0) + g._count;
    entry.total += g._count;
  }
  return {
    items: page.map((c) => ({ ...c, counts: countsByCampaign.get(c.id)! })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function getCampaign(tenantId: string, id: string, recipientCursor?: string, recipientLimit = 50) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, tenantId },
    include: { template: true },
  });
  if (!campaign) throw new WhatsappServiceError("CAMPAIGN_NOT_FOUND", "Campaign not found", 404);
  const take = Math.min(Math.max(recipientLimit, 1), 100);
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: id, tenantId },
    include: { contact: { select: { id: true, phone: true, name: true, profileName: true } } },
    orderBy: { createdAt: "asc" },
    ...(recipientCursor ? { cursor: { id: recipientCursor }, skip: 1 } : {}),
    take: take + 1,
  });
  const hasMore = recipients.length > take;
  const page = hasMore ? recipients.slice(0, take) : recipients;
  const messageIds = page
    .map((r) => r.messageId)
    .filter((mid): mid is string => !!mid);
  const messages = messageIds.length > 0
    ? await prisma.message.findMany({
        where: { id: { in: messageIds }, tenantId },
        select: { id: true, status: true, whatsappMessageId: true, messageTimestamp: true, errorCode: true, errorMessage: true },
      })
    : [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  return {
    ...campaign,
    counts: await recipientCounts(campaign.id),
    recipients: page.map((r) => ({
      ...r,
      message: r.messageId ? byId.get(r.messageId) ?? null : null,
    })),
    recipientsNextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function sendCampaign(tenantId: string, id: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!campaign) throw new WhatsappServiceError("CAMPAIGN_NOT_FOUND", "Campaign not found", 404);
  if (!["DRAFT", "SCHEDULED"].includes(campaign.status)) {
    throw new WhatsappServiceError("CAMPAIGN_NOT_SENDABLE", `Campaign is ${campaign.status}`, 400);
  }
  const { total, PENDING } = (await recipientCounts(id)) as { total: number; PENDING: number };
  if (total === 0 || PENDING === 0) {
    throw new WhatsappServiceError("NO_RECIPIENTS", "Campaign has no pending recipients", 400);
  }
  await prisma.campaign.update({
    where: { id },
    data: { status: "SENDING", startedAt: campaign.startedAt ?? new Date() },
  });
  // Fire-and-forget: bulk sending must never block the HTTP request.
  void processCampaign(id).catch(() => undefined);
  return { started: true };
}

export async function cancelCampaign(tenantId: string, id: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!campaign) throw new WhatsappServiceError("CAMPAIGN_NOT_FOUND", "Campaign not found", 404);
  if (!["DRAFT", "SCHEDULED", "SENDING"].includes(campaign.status)) {
    throw new WhatsappServiceError("CAMPAIGN_NOT_CANCELLABLE", `Campaign is ${campaign.status}`, 400);
  }
  await prisma.$transaction([
    prisma.campaign.update({ where: { id }, data: { status: "CANCELLED", completedAt: new Date() } }),
    prisma.campaignRecipient.updateMany({
      where: { campaignId: id, tenantId, status: "PENDING" },
      data: { status: "CANCELLED" },
    }),
  ]);
  return { cancelled: true };
}
