import { prisma } from "../../config/prisma";

export async function loadActiveKnowledge(tenantId: string) {
  return prisma.aiKnowledgeEntry.findMany({
    where: { tenantId, active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 100,
  });
}

export async function loadActiveOffers(tenantId: string) {
  return prisma.aiOffer.findMany({
    where: { tenantId, active: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export async function loadBusinessName(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  return tenant?.name ?? "this business";
}
