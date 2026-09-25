import { describe, expect, it, vi } from "vitest";
import { __resetHub, publish, subscribe, subscriberCount } from "../src/services/realtime";

function fakeRes() {
  return { write: vi.fn() };
}

const msg = {
  id: "m1",
  conversationId: "c1",
  direction: "INBOUND",
  messageType: "TEXT",
  textContent: "hi",
  status: "RECEIVED",
  messageTimestamp: null,
  createdAt: new Date().toISOString(),
};

describe("realtime hub", () => {
  it("delivers only to same-tenant subscribers", () => {
    __resetHub();
    const a = fakeRes();
    const b = fakeRes();
    const unsubA = subscribe({ tenantId: "t1", res: a as never });
    subscribe({ tenantId: "t2", res: b as never });

    expect(publish("t1", { type: "message.created", conversationId: "c1", message: msg })).toBe(1);
    expect(a.write).toHaveBeenCalledOnce();
    expect(b.write).not.toHaveBeenCalled();

    unsubA();
    expect(subscriberCount("t1")).toBe(0);
    expect(subscriberCount()).toBe(1);
    __resetHub();
  });

  it("drops dead subscribers without throwing", () => {
    __resetHub();
    const dead = { write: vi.fn(() => { throw new Error("closed"); }) };
    subscribe({ tenantId: "t1", res: dead as never });
    expect(() => publish("t1", { type: "message.created", conversationId: "c1", message: msg })).not.toThrow();
    expect(subscriberCount()).toBe(0);
  });
});
