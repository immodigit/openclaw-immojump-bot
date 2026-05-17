import type { ImmoJumpClient } from "../client.js";
import type { InboundEvent, InboundHandler, InboundTransport } from "./types.js";

export type PollingTransportOptions = {
  client: ImmoJumpClient;
  intervalMs: number;
  handler: InboundHandler;
  /** Cursor store — opaque ISO string, persisted between restarts. */
  loadCursor(): Promise<string | null>;
  saveCursor(cursor: string): Promise<void>;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
};

export function createPollingTransport(opts: PollingTransportOptions): InboundTransport {
  let timer: NodeJS.Timeout | null = null;
  let stopping = false;
  const log = opts.logger ?? (() => {});

  async function tick(): Promise<void> {
    if (stopping) return;
    try {
      const since = (await opts.loadCursor()) ?? undefined;
      const mentions = await opts.client.listMentions(since);
      for (const m of mentions) {
        const event: InboundEvent = {
          id: m.id,
          type: "mention.created",
          feedEventId: m.feed_event_id ?? null,
          commentId: m.comment_id,
          text: m.body_html,
          senderUserId: m.sender_user_id,
          createdAt: m.created_at
        };
        await opts.handler(event);
        await opts.saveCursor(m.created_at);
      }
    } catch (err) {
      log("polling tick error", { err: String(err) });
    }
  }

  return {
    async start() {
      stopping = false;
      await tick();
      timer = setInterval(tick, opts.intervalMs);
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
