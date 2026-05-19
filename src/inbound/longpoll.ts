import type { ImmoJumpClient } from "../client.js";
import type { InboundEvent, InboundHandler, InboundTransport } from "./types.js";

export type LongpollTransportOptions = {
  client: ImmoJumpClient;
  /** Seconds the backend will hold the connection waiting for new mentions. */
  timeoutSec: number;
  handler: InboundHandler;
  /** Cursor store — opaque ISO string, persisted between restarts. */
  loadCursor(): Promise<string | null>;
  saveCursor(cursor: string): Promise<void>;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
};

// Backoff schedule (ms) applied after a transport error. Resets on the
// next successful response. Capped well below the long-poll window so a
// flapping backend recovers within a single timeout cycle.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export function createLongpollTransport(opts: LongpollTransportOptions): InboundTransport {
  let stopping = false;
  let loopPromise: Promise<void> | null = null;
  let failureCount = 0;
  const log = opts.logger ?? (() => {});

  async function tick(): Promise<void> {
    const since = (await opts.loadCursor()) ?? undefined;
    const mentions = await opts.client.listMentions(since, opts.timeoutSec);
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
  }

  async function loop(): Promise<void> {
    while (!stopping) {
      try {
        await tick();
        failureCount = 0;
      } catch (err) {
        if (stopping) return;
        const backoff = BACKOFF_MS[Math.min(failureCount, BACKOFF_MS.length - 1)];
        failureCount += 1;
        log("longpoll tick error", { err: String(err), backoffMs: backoff });
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  return {
    async start() {
      stopping = false;
      loopPromise = loop();
    },
    async stop() {
      stopping = true;
      // Best-effort wait — the in-flight request will resolve at most
      // (timeoutSec + 10s) later when its fetch aborts.
      if (loopPromise) {
        await Promise.race([
          loopPromise,
          new Promise((resolve) => setTimeout(resolve, 1000))
        ]);
      }
      loopPromise = null;
    }
  };
}
