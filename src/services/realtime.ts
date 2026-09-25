import type { Response } from "express";

// Minimal in-process SSE hub. Single API instance: subscribers are grouped
// by tenant so tenants never receive each other's events. For multi-instance
// deployments replace with Redis pub/sub (same publish/subscribe interface).

export interface RealtimeMessage {
  id: string;
  conversationId: string;
  direction: string;
  messageType: string;
  textContent: string | null;
  status: string;
  messageTimestamp: string | null;
  createdAt: string;
}

export interface CampaignProgress {
  id: string;
  status: string;
  total: number;
  pending: number;
  sent: number;
  failed: number;
  cancelled: number;
}

export type RealtimeEvent =
  | { type: "message.created" | "message.updated"; conversationId: string; message: RealtimeMessage }
  | { type: "campaign.updated"; campaignId: string; campaign: CampaignProgress }
  | { type: "conversation.updated"; conversationId: string };

type Subscriber = { tenantId: string; res: Response };

const subscribers = new Set<Subscriber>();

export function subscribe(sub: Subscriber): () => void {
  subscribers.add(sub);
  return () => {
    subscribers.delete(sub);
  };
}

export function publish(tenantId: string, event: RealtimeEvent): number {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  let delivered = 0;
  for (const sub of subscribers) {
    if (sub.tenantId !== tenantId) continue;
    try {
      sub.res.write(payload);
      delivered += 1;
    } catch {
      subscribers.delete(sub);
    }
  }
  return delivered;
}

export function subscriberCount(tenantId?: string): number {
  if (!tenantId) return subscribers.size;
  let n = 0;
  for (const sub of subscribers) if (sub.tenantId === tenantId) n += 1;
  return n;
}

/** Test-only: reset hub state. */
export function __resetHub(): void {
  subscribers.clear();
}

interface StorableMessage {
  id: string;
  conversationId: string;
  direction: string;
  messageType: string;
  textContent: string | null;
  status: string;
  messageTimestamp: Date | null;
  createdAt: Date;
}

export function toEventMessage(m: StorableMessage): RealtimeMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    messageType: m.messageType,
    textContent: m.textContent,
    status: m.status,
    messageTimestamp: m.messageTimestamp?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}
