import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { createContactSchema, updateContactSchema } from "../validators/contacts.validator";
import { sendError, sendSuccess } from "../utils/response";

/** GET /api/v1/contacts?search= — tenant-scoped, for campaign targeting. */
export async function listContactsHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const take = 50;
  const items = await prisma.contact.findMany({
    where: {
      tenantId: req.auth.tenantId,
      ...(search
        ? { OR: [{ phone: { startsWith: search } }, { name: { startsWith: search } }] }
        : {}),
    },
    select: { id: true, phone: true, name: true, profileName: true, email: true, tags: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1,
  });
  const hasMore = items.length > take;
  const page = hasMore ? items.slice(0, take) : items;
  sendSuccess(res, { items: page, nextCursor: hasMore ? page[page.length - 1].id : null });
}

/** POST /api/v1/contacts */
export async function createContactHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    sendSuccess(
      res,
      await prisma.contact.create({
        data: {
          tenantId: req.auth.tenantId,
          phone: parsed.data.phone,
          name: parsed.data.name,
          profileName: parsed.data.profileName,
          email: parsed.data.email || undefined,
          tags: parsed.data.tags,
        },
      }),
      201,
    );
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      sendError(res, "CONTACT_EXISTS", "A contact with this phone number already exists", 409);
      return;
    }
    sendError(res, "CONTACT_FAILED", "Unable to create contact", 500);
  }
}

/** PUT /api/v1/contacts/:id */
export async function updateContactHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const parsed = updateContactSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    return;
  }
  try {
    const existing = await prisma.contact.findFirst({
      where: { id: req.params.id, tenantId: req.auth.tenantId },
    });
    if (!existing) {
      sendError(res, "CONTACT_NOT_FOUND", "Contact not found", 404);
      return;
    }
    sendSuccess(
      res,
      await prisma.contact.update({
        where: { id: existing.id },
        data: {
          ...parsed.data,
          email: parsed.data.email === "" ? null : parsed.data.email,
        },
      }),
    );
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      sendError(res, "CONTACT_EXISTS", "A contact with this phone number already exists", 409);
      return;
    }
    sendError(res, "CONTACT_FAILED", "Unable to update contact", 500);
  }
}

/** DELETE /api/v1/contacts/:id (cascades conversations, messages, campaign links). */
export async function deleteContactHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }
  const existing = await prisma.contact.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  });
  if (!existing) {
    sendError(res, "CONTACT_NOT_FOUND", "Contact not found", 404);
    return;
  }
  await prisma.contact.delete({ where: { id: existing.id } });
  sendSuccess(res, { deleted: true });
}
