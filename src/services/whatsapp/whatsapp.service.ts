import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { decryptToken } from "../../utils/crypto";
import { sendTemplateMessage } from "../meta/meta-client";
import { publish, toEventMessage } from "../realtime";
import type { SendTemplateInput } from "../../validators/whatsapp.validator";

export class WhatsappServiceError extends Error {
    status: number;
    code: string;
    details?: unknown;
    constructor(code: string, message: string, status = 400, details?: unknown) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export async function sendTemplate(
    tenantId: string,
    input: SendTemplateInput,
): Promise<{ whatsappMessageId: string; messageId: string }> {
    const account = input.whatsappAccountId
        ? await prisma.whatsappAccount.findFirst({
            where: { id: input.whatsappAccountId, tenantId },
        })
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

    let whatsappMessageId: string;
    try {
        whatsappMessageId = await sendTemplateMessage({
            phoneNumberId: account.phoneNumberId,
            accessToken,
            graphVersion: config.meta.graphVersion,
            to: input.to,
            templateName: input.templateName,
            language: input.language,
            components: input.components,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Meta send failed";
        const status = (err as { status?: number }).status ?? 502;
        throw new WhatsappServiceError("WHATSAPP_SEND_FAILED", message, status);
    } finally {
        accessToken = "";
    }

    // Persist outbound message with tenant isolation.
    const contact = await prisma.contact.upsert({
        where: { tenantId_phone: { tenantId, phone: input.to } },
        update: {},
        create: { tenantId, phone: input.to },
    });

    const conversation = await prisma.conversation.upsert({
        where: {
            tenantId_whatsappAccountId_contactId: {
                tenantId,
                whatsappAccountId: account.id,
                contactId: contact.id,
            },
        },
        update: { lastMessageAt: new Date() },
        create: {
            tenantId,
            whatsappAccountId: account.id,
            contactId: contact.id,
            status: "OPEN",
            lastMessageAt: new Date(),
        },
    });

    const saved = await prisma.message.create({
        data: {
            tenantId,
            conversationId: conversation.id,
            whatsappMessageId,
            direction: "OUTBOUND",
            messageType: "TEMPLATE",
            textContent: input.templateName,
            status: "SENT",
            messageTimestamp: new Date(),
        },
    });
    publish(tenantId, {
        type: "message.created",
        conversationId: conversation.id,
        message: toEventMessage(saved),
    });

    return { whatsappMessageId, messageId: saved.id };
}
