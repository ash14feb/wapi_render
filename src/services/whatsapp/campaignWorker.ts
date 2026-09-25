import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { sendTemplateMessage } from "../meta/meta-client";
import { publish } from "../realtime";

const SEND_GAP_MS = 400;
const running = new Set<string>();

export interface CampaignHeader {
    kind: "image" | "video" | "document";
    link?: string;
    id?: string;
}

export interface CampaignPayload {
    body: string[];
    header: CampaignHeader | null;
}

/** Parses parametersJson; supports the legacy plain-array shape. */
export function parseCampaignPayload(json: string | null): CampaignPayload {
    if (!json) return { body: [], header: null };
    try {
        const parsed: unknown = JSON.parse(json);
        if (Array.isArray(parsed)) return { body: parsed.filter((x): x is string => typeof x === "string"), header: null };
        if (parsed && typeof parsed === "object") {
            const o = parsed as { body?: unknown; header?: unknown };
            const header =
                o.header && typeof o.header === "object" &&
                    ["image", "video", "document"].includes((o.header as { kind?: string }).kind ?? "")
                    ? (o.header as CampaignHeader)
                    : null;
            return {
                body: Array.isArray(o.body) ? o.body.filter((x): x is string => typeof x === "string") : [],
                header,
            };
        }
    } catch {
        // fall through
    }
    return { body: [], header: null };
}

/** Components for the send payload: header media first, then body params.
 * AUTHENTICATION templates MUST also carry the OTP a second time in a
 * button component (type button, sub_type url, index 0) — Meta rejects
 * the send with "Invalid parameter" otherwise. */
export function buildCampaignComponents(payload: CampaignPayload, authOtp?: string) {
    const components: Array<Record<string, unknown>> = [];
    if (payload.header) {
        const { kind, link, id } = payload.header;
        components.push({
            type: "header",
            parameters: [{ type: kind, [kind]: id ? { id } : { link } }],
        });
    }
    if (payload.body.length > 0) {
        components.push({
            type: "body",
            parameters: payload.body.map((text) => ({ type: "text", text })),
        });
    }
    if (authOtp) {
        components.push({
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: authOtp }],
        });
    }
    return components.length > 0 ? components : undefined;
}

export type CampaignSendFn = (args: {
    phoneNumberId: string;
    accessToken: string;
    graphVersion: string;
    to: string;
    templateName: string;
    templateCategory?: string | null;
    language: string;
    payload: CampaignPayload;
}) => Promise<string>;

const defaultSend: CampaignSendFn = async (args) =>
    sendTemplateMessage({
        phoneNumberId: args.phoneNumberId,
        accessToken: args.accessToken,
        graphVersion: args.graphVersion,
        to: args.to,
        templateName: args.templateName,
        language: args.language,
        components: buildCampaignComponents(
            args.payload,
            // AUTHENTICATION templates need the OTP duplicated in a button component.
            args.templateCategory === "AUTHENTICATION" ? args.payload.body[0] : undefined,
        ) as never,
    });

async function emitProgress(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return;
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
    publish(campaign.tenantId, {
        type: "campaign.updated",
        campaignId,
        campaign: {
            id: campaignId,
            status: campaign.status,
            total,
            pending: counts.PENDING ?? 0,
            sent: counts.SENT ?? 0,
            failed: counts.FAILED ?? 0,
            cancelled: counts.CANCELLED ?? 0,
        },
    });
}

/** Sequentially sends all PENDING recipients. Re-entrant safe; cancellable. */
export async function processCampaign(campaignId: string, sendFn: CampaignSendFn = defaultSend): Promise<void> {
    if (running.has(campaignId)) return;
    running.add(campaignId);
    try {
        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            include: { template: true },
        });
        if (!campaign || !campaign.template) return;
        const { tenantId } = campaign;

        const account = campaign.whatsappAccountId
            ? await prisma.whatsappAccount.findFirst({
                where: { id: campaign.whatsappAccountId, tenantId, status: "ACTIVE" },
                orderBy: { createdAt: "asc" },
            })
            : await prisma.whatsappAccount.findFirst({
                where: { tenantId, status: "ACTIVE" },
                orderBy: { createdAt: "asc" },
            });
        if (!account) {
            await prisma.campaign.update({ where: { id: campaignId }, data: { status: "FAILED", completedAt: new Date() } });
            await emitProgress(campaignId);
            return;
        }

        let accessToken: string;
        try {
            accessToken = decryptToken(account.encryptedAccessToken);
        } catch {
            await prisma.campaign.update({ where: { id: campaignId }, data: { status: "FAILED", completedAt: new Date() } });
            await emitProgress(campaignId);
            return;
        }

        try {
            const payload = parseCampaignPayload(campaign.parametersJson);
            for (; ;) {
                const current = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
                if (!current || current.status !== "SENDING") break;

                // Batch fetch PENDING recipients (was: one findFirst per loop = N queries).
                const batch = await prisma.campaignRecipient.findMany({
                    where: { campaignId, tenantId, status: "PENDING" },
                    orderBy: { createdAt: "asc" },
                    include: { contact: true },
                    take: 25,
                });
                if (batch.length === 0) break;

                for (const recipient of batch) {

                    try {
                        const wamid = await sendFn({
                            phoneNumberId: account.phoneNumberId,
                            accessToken,
                            graphVersion: config.meta.graphVersion,
                            to: recipient.contact.phone,
                            templateName: campaign.template.name,
                            templateCategory: campaign.template.category,
                            language: campaign.template.language,
                            payload,
                        });

                        const conversation = await prisma.conversation.upsert({
                            where: {
                                tenantId_whatsappAccountId_contactId: {
                                    tenantId,
                                    whatsappAccountId: account.id,
                                    contactId: recipient.contactId,
                                },
                            },
                            update: { lastMessageAt: new Date() },
                            create: {
                                tenantId,
                                whatsappAccountId: account.id,
                                contactId: recipient.contactId,
                                status: "OPEN",
                                lastMessageAt: new Date(),
                            },
                        });
                        const message = await prisma.message.create({
                            data: {
                                tenantId,
                                conversationId: conversation.id,
                                whatsappMessageId: wamid,
                                direction: "OUTBOUND",
                                messageType: "TEMPLATE",
                                textContent: campaign.template.name,
                                status: "SENT",
                                messageTimestamp: new Date(),
                            },
                        });
                        await prisma.campaignRecipient.update({
                            where: { id: recipient.id },
                            data: { status: "SENT", messageId: message.id },
                        });
                    } catch (err) {
                        await prisma.campaignRecipient.update({
                            where: { id: recipient.id },
                            data: {
                                status: "FAILED",
                                errorMessage: err instanceof Error ? err.message.slice(0, 1000) : "send failed",
                            },
                        });
                    }
                } // end for recipient batch

                await emitProgress(campaignId);
                await new Promise((r) => setTimeout(r, SEND_GAP_MS));
            }
        } finally {
            accessToken = "";
        }

        const final = await prisma.campaign.findUnique({ where: { id: campaignId } });
        if (final && final.status === "SENDING") {
            await prisma.campaign.update({
                where: { id: campaignId },
                data: { status: "SENT", completedAt: new Date() },
            });
            await emitProgress(campaignId);
        }
    } finally {
        running.delete(campaignId);
    }
}

export function __isCampaignRunning(id: string): boolean {
    return running.has(id);
}

let schedulerTimer: NodeJS.Timeout | null = null;

/** Picks up due SCHEDULED campaigns. Called by Vercel Cron (see /campaigns/tick). */
export async function tickScheduledCampaigns(): Promise<{ started: number }> {
    try {
        const due = await prisma.campaign.findMany({
            where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
            select: { id: true },
            take: 10,
        });
        for (const c of due) {
            await prisma.campaign.updateMany({
                where: { id: c.id, status: "SCHEDULED" },
                data: { status: "SENDING", startedAt: new Date() },
            });
            void processCampaign(c.id).catch(() => undefined);
        }
        return { started: due.length };
    } catch {
        return { started: 0 };
    }
}

/** Local-dev only: polls due campaigns. Do NOT use on Vercel — use /campaigns/tick cron instead. */
export function startCampaignScheduler(intervalMs = 30000): void {
    if (schedulerTimer) return;
    schedulerTimer = setInterval(() => {
        void tickScheduledCampaigns().catch(() => undefined);
    }, intervalMs);
}
