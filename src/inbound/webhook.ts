import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { InboundEvent, InboundHandler, InboundTransport } from "./types.js";

export type WebhookTransportOptions = {
  host: string;
  port: number;
  secret: string;
  handler: InboundHandler;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
};

const SIGNATURE_HEADER = "x-immojump-signature";

function verifySignature(secret: string, body: string, headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(headerValue);
  return a.length === b.length && timingSafeEqual(a, b);
}

type BackendEnvelope = {
  v?: number;
  event?: string;
  event_id?: string;
  delivered_at?: string;
  bot?: { user_id?: string; organisation_id?: string; username?: string };
  mention?: {
    notification_id?: string;
    headline?: string;
    body?: string;
    url?: string;
    created_at?: string;
    feed_event_id?: string | null;
    comment_id?: string | null;
  };
};

/**
 * Translate the immoJUMP outbound-webhook envelope (nested, snake_case)
 * into the flat camelCase shape the rest of the plugin works with.
 * `text` is taken from the original notification body / headline so the
 * agent has something to react to even though the backend does not ship
 * the full post HTML in the webhook today.
 */
function normaliseEvent(envelope: BackendEnvelope): InboundEvent | null {
  if (!envelope || envelope.event !== "mention.created") return null;
  const mention = envelope.mention ?? {};
  const bot = envelope.bot ?? {};
  return {
    id: envelope.event_id ?? mention.notification_id ?? "",
    type: "mention.created",
    feedEventId: mention.feed_event_id ?? null,
    commentId: mention.comment_id ?? null,
    text: [mention.headline, mention.body].filter(Boolean).join(" — "),
    senderUserId: bot.user_id ?? "",
    createdAt: mention.created_at ?? envelope.delivered_at ?? new Date().toISOString(),
  };
}

export function createWebhookTransport(opts: WebhookTransportOptions): InboundTransport {
  let server: Server | null = null;
  const log = opts.logger ?? (() => {});

  return {
    async start() {
      server = createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/inbound") {
          res.statusCode = 404;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c as Buffer));
        req.on("end", async () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (!verifySignature(opts.secret, raw, req.headers[SIGNATURE_HEADER] as string)) {
            log("webhook signature mismatch");
            res.statusCode = 401;
            res.end();
            return;
          }
          let envelope: BackendEnvelope;
          try {
            envelope = JSON.parse(raw) as BackendEnvelope;
          } catch (err) {
            log("webhook body parse error", { err: String(err) });
            res.statusCode = 400;
            res.end();
            return;
          }
          const event = normaliseEvent(envelope);
          if (!event) {
            log("webhook payload not recognised", { event: envelope.event });
            res.statusCode = 422;
            res.end();
            return;
          }
          try {
            await opts.handler(event);
            res.statusCode = 202;
            res.end();
          } catch (err) {
            log("webhook handler error", { err: String(err), eventId: event.id });
            res.statusCode = 500;
            res.end();
          }
        });
      });
      await new Promise<void>((resolve) => server!.listen(opts.port, opts.host, () => resolve()));
      log(`webhook listening`, { host: opts.host, port: opts.port });
    },
    async stop() {
      if (!server) return;
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  };
}
