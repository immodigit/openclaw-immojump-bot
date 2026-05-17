import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createWebhookTransport } from "../src/inbound/webhook.js";
import type { InboundEvent } from "../src/inbound/types.js";

const SECRET = "test-secret-must-be-long-enough";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

let transport: { stop(): Promise<void> } | null = null;

afterEach(async () => {
  await transport?.stop();
  transport = null;
});

describe("webhook transport", () => {
  it("rejects bodies with bad signature", async () => {
    let called = false;
    const port = 18788 + Math.floor(Math.random() * 1000);
    const t = createWebhookTransport({
      host: "127.0.0.1",
      port,
      secret: SECRET,
      handler: async () => {
        called = true;
      }
    });
    await t.start();
    transport = t;
    const resp = await fetch(`http://127.0.0.1:${port}/inbound`, {
      method: "POST",
      headers: { "x-immojump-signature": "sha256=deadbeef", "content-type": "application/json" },
      body: "{}"
    });
    expect(resp.status).toBe(401);
    expect(called).toBe(false);
  });

  it("dispatches valid events", async () => {
    const received: InboundEvent[] = [];
    const port = 19788 + Math.floor(Math.random() * 1000);
    const t = createWebhookTransport({
      host: "127.0.0.1",
      port,
      secret: SECRET,
      handler: async (e) => {
        received.push(e);
      }
    });
    await t.start();
    transport = t;
    const event: InboundEvent = {
      id: "evt_1",
      type: "mention.created",
      activityId: "act_1",
      commentId: "c_1",
      text: "@bot hello",
      senderUserId: "u_1",
      createdAt: "2026-05-17T12:00:00Z"
    };
    const body = JSON.stringify(event);
    const resp = await fetch(`http://127.0.0.1:${port}/inbound`, {
      method: "POST",
      headers: { "x-immojump-signature": sign(body), "content-type": "application/json" },
      body
    });
    expect(resp.status).toBe(202);
    expect(received).toEqual([event]);
  });
});
