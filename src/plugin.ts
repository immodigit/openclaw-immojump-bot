import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { sendReplyLifecycle, shouldHandleInboundEvent } from "./channel.js";
import { ImmoJumpClient } from "./client.js";
import {
  parseChannelConfig,
  parsePluginConfig,
  type PluginAccountConfig
} from "./config.js";
import { createLongpollTransport } from "./inbound/longpoll.js";
import { createPollingTransport } from "./inbound/polling.js";
import { createWebhookTransport } from "./inbound/webhook.js";
import type { InboundEvent, InboundTransport } from "./inbound/types.js";

export type OpenClawConfig = {
  session?: { store?: string };
  channels?: { immojump?: unknown };
};

export type ResolvedAccount = PluginAccountConfig & { accountId: string };

// Surface of ctx.channelRuntime we actually use, modelled on what the
// host runtime in OpenClaw 2026.5.x exposes. Keys discovered by
// diagnostic dump on first boot — only the subset we depend on is
// typed here; the host has many more helpers we don't need.
type ResolvedAgentRoute = {
  agentId: string;
  sessionKey: string;
  accountId?: string;
  mainSessionKey?: string;
};

type DeliverInfo = { kind: "tool" | "block" | "final" };

export type ImmoChannelRuntime = {
  routing: {
    resolveAgentRoute(params: {
      cfg: unknown;
      channel: string;
      accountId: string;
      peer: { kind: string; id: string };
    }): ResolvedAgentRoute;
  };
  session: {
    resolveStorePath(store: string | undefined, opts: { agentId: string }): string;
    readSessionUpdatedAt(params: { storePath: string; sessionKey: string }): number | undefined;
    recordInboundSession(params: {
      storePath: string;
      sessionKey: string;
      ctx: Record<string, unknown>;
      updateLastRoute?: {
        sessionKey: string;
        channel: string;
        to: string;
        accountId?: string;
      };
      onRecordError(err: unknown): void;
    }): Promise<void>;
  };
  reply: {
    resolveEnvelopeFormatOptions(cfg: unknown): unknown;
    formatAgentEnvelope(params: {
      channel: string;
      from: string;
      timestamp?: number;
      previousTimestamp?: number;
      envelope: unknown;
      body: string;
    }): string;
    finalizeInboundContext<T extends Record<string, unknown>>(ctx: T): T;
    dispatchReplyWithBufferedBlockDispatcher(params: {
      ctx: Record<string, unknown>;
      cfg: unknown;
      dispatcherOptions: {
        deliver(payload: unknown, info: DeliverInfo): Promise<void>;
        onError?(err: unknown, info: DeliverInfo): void;
      };
    }): Promise<unknown>;
  };
};

// Legacy scaffold name — kept for the `ctx.channelRuntime` field type
// on GatewayContext below.
export type ChannelRuntimeLike = ImmoChannelRuntime;

/**
 * Apply the optional ``account.agent`` override to a resolved route.
 *
 * OpenClaw session keys follow ``agent:<id>:<channel>:<peer.kind>:<peer.id>``;
 * we rebuild the segment so the override agent's own session store and
 * key are used. If the format doesn't match we keep the original to
 * avoid crashing on a runtime format change.
 */
function applyAgentOverride(route: ResolvedAgentRoute, override?: string): ResolvedAgentRoute {
  if (!override || override === route.agentId) return route;
  const rebuild = (sk: string): string => {
    const parts = sk.split(":");
    if (parts.length >= 2 && parts[0] === "agent") {
      parts[1] = override;
      return parts.join(":");
    }
    return sk;
  };
  return {
    ...route,
    agentId: override,
    sessionKey: rebuild(route.sessionKey),
    mainSessionKey: route.mainSessionKey ? rebuild(route.mainSessionKey) : undefined
  };
}

function normalizePayloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as { text?: unknown };
  return typeof p.text === "string" ? p.text : "";
}

export function listAccountIds(cfg: OpenClawConfig): string[] {
  const ids = Object.keys(parseChannelConfig(cfg).accounts);
  // eslint-disable-next-line no-console
  console.error(`[immojump-bot] listAccountIds() -> [${ids.join(",")}]`);
  return ids;
}

export function resolveAccount(cfg: unknown, accountId?: string): ResolvedAccount | null {
  // eslint-disable-next-line no-console
  console.error(`[immojump-bot] resolveAccount(accountId=${accountId})`);
  if (!accountId) return null;
  const accounts = parseChannelConfig(cfg as OpenClawConfig).accounts;
  const account = accounts[accountId];
  return account ? { ...account, accountId } : null;
}

function isConfigured(account: Partial<ResolvedAccount> | null | undefined): boolean {
  return Boolean(account?.serverUrl && account?.auth?.botToken);
}

function inspectAccount(cfg: unknown, accountId?: string):
  | { accountId: string; enabled: boolean; serverUrl: string; transportMode: string }
  | null {
  if (!accountId) return null;
  const account = parseChannelConfig(cfg as OpenClawConfig).accounts[accountId];
  return account
    ? {
        accountId,
        enabled: account.enabled,
        serverUrl: account.serverUrl,
        transportMode: account.transport.mode
      }
    : null;
}

export const immojumpPlugin = {
  id: "immojump",
  config: {
    listAccountIds,
    resolveAccount,
    isConfigured
  },
  gateway: {
    startAccount: startGateway
  },
  base: {
    id: "immojump",
    setup: {
      resolveAccount,
      inspectAccount
    }
  }
};

type GatewayContext = {
  accountId: string;
  account?: ResolvedAccount;
  cfg?: OpenClawConfig;
  abortSignal?: AbortSignal;
  channelRuntime?: ChannelRuntimeLike;
  setStatus?: (status: string) => void;
};

async function loadCursor(path: string): Promise<string | null> {
  try {
    return (await fs.readFile(path, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

async function saveCursor(path: string, value: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, value, "utf8");
}

export async function startGateway(ctx: GatewayContext): Promise<void> {
  // eslint-disable-next-line no-console
  console.error(`[immojump-bot] startGateway(accountId=${ctx.accountId})`);
  const account =
    ctx.account ?? resolveAccount(ctx.cfg ?? {}, ctx.accountId);
  if (!account || !isConfigured(account) || !account.enabled) {
    ctx.setStatus?.(`immojump:${ctx.accountId}:disabled`);
    return;
  }

  const client = new ImmoJumpClient({
    serverUrl: account.serverUrl,
    botToken: account.auth.botToken
  });
  const identity = await client.whoami();
  ctx.setStatus?.(
    `immojump:${ctx.accountId}:connected as @${identity.nickname} (${identity.bot_user_id})`
  );

  const cr = ctx.channelRuntime as ImmoChannelRuntime | undefined;

  const handler = async (event: InboundEvent): Promise<void> => {
    // eslint-disable-next-line no-console
    console.error(
      `[immojump-bot] handler() account=${ctx.accountId} event.id=${event.id} feedEventId=${event.feedEventId} senderUserId=${event.senderUserId}`
    );
    if (
      !shouldHandleInboundEvent(event, {
        botUserId: identity.bot_user_id,
        mentionNames: [identity.nickname, ...account.mentionNames]
      })
    ) {
      // eslint-disable-next-line no-console
      console.error(`[immojump-bot] handler() account=${ctx.accountId} -> shouldHandle=false, skip`);
      return;
    }
    if (!event.feedEventId) {
      // eslint-disable-next-line no-console
      console.error(`[immojump-bot] handler() account=${ctx.accountId} -> no feedEventId, skip`);
      return;
    }
    const feedEventId = event.feedEventId;
    // eslint-disable-next-line no-console
    console.error(`[immojump-bot] handler() account=${ctx.accountId} dispatching to agent=${account.agent ?? '<default>'}`);

    if (!cr) {
      // No host runtime — fail loudly so the operator notices the gateway
      // misconfiguration instead of getting silent "Thinking…" forever.
      await sendReplyLifecycle({
        client,
        feedEventId,
        finalText:
          "_(OpenClaw channelRuntime fehlt im host-context — keine Agent-Loop verfügbar)_"
      });
      return;
    }

    // Resolve the agent route the host wants for this peer, then apply
    // the account.agent override so each immoJUMP bot can pin its own
    // persona (rex-recherche, clara-crm, ...).
    const baseRoute = cr.routing.resolveAgentRoute({
      cfg: ctx.cfg ?? {},
      channel: "immojump",
      accountId: ctx.accountId,
      peer: { kind: "feed_event", id: feedEventId }
    });
    const route = applyAgentOverride(baseRoute, account.agent);
    const storePath = cr.session.resolveStorePath(ctx.cfg?.session?.store, {
      agentId: route.agentId
    });
    const previousTimestamp = cr.session.readSessionUpdatedAt({
      storePath,
      sessionKey: route.sessionKey
    });
    const envelopeOptions = cr.reply.resolveEnvelopeFormatOptions(ctx.cfg ?? {});
    const timestamp = Date.parse(event.createdAt) || Date.now();
    const conversationLabel = `immojump://${feedEventId}`;

    const body = cr.reply.formatAgentEnvelope({
      channel: "immoJUMP",
      from: conversationLabel,
      timestamp,
      previousTimestamp,
      envelope: envelopeOptions,
      body: event.text
    });

    const ctxPayload = cr.reply.finalizeInboundContext({
      Body: body,
      BodyForAgent: event.text,
      RawBody: event.text,
      CommandBody: event.text,
      From: event.senderUserId,
      To: conversationLabel,
      SessionKey: route.sessionKey,
      AccountId: route.accountId ?? ctx.accountId,
      ChatType: "feed_event",
      ConversationLabel: conversationLabel,
      SenderId: event.senderUserId,
      Provider: "immojump",
      Surface: "immojump",
      MessageSid: event.id,
      MessageSidFull: event.id,
      Timestamp: timestamp,
      OriginatingChannel: "immojump",
      OriginatingTo: conversationLabel
    } as Record<string, unknown>);

    await cr.session.recordInboundSession({
      storePath,
      sessionKey: route.sessionKey,
      ctx: ctxPayload,
      updateLastRoute: {
        sessionKey: route.mainSessionKey ?? route.sessionKey,
        channel: "immojump",
        to: conversationLabel,
        accountId: route.accountId ?? ctx.accountId
      },
      onRecordError: (err) =>
        ctx.setStatus?.(`immojump:${ctx.accountId}:record-error:${String(err)}`)
    });

    await sendReplyLifecycle({
      client,
      feedEventId,
      run: async (session) => {
        await cr.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx: ctxPayload,
          cfg: ctx.cfg ?? {},
          dispatcherOptions: {
            deliver: async (payload, info) => {
              const text = normalizePayloadText(payload);
              // Tool-Fortschritts-Lieferungen zeigen wir auch ohne Text —
              // sie signalisieren "ein Arbeitsschritt laeuft". block/final
              // ohne Text tragen nichts, die ueberspringen wir weiterhin.
              if (!text && info.kind !== "tool") return;
              await session.update({ kind: info.kind, payload: { text } });
            },
            onError: (err, info) =>
              ctx.setStatus?.(
                `immojump:${ctx.accountId}:dispatch-error:${info.kind}:${String(err)}`
              )
          }
        });
      }
    });
  };

  let transport: InboundTransport;
  if (account.transport.mode === "webhook") {
    transport = createWebhookTransport({
      host: account.transport.listenHost,
      port: account.transport.listenPort,
      secret: account.transport.webhookSecret,
      handler,
      logger: (msg, meta) =>
        ctx.setStatus?.(`immojump:${ctx.accountId}:webhook:${msg}${meta ? " " + JSON.stringify(meta) : ""}`)
    });
  } else {
    const stateDir =
      ctx.cfg?.session?.store ?? join(homedir(), ".openclaw", "channels", "immojump");
    const cursorPath = join(stateDir, ctx.accountId, "cursor.txt");
    const cursorIO = {
      loadCursor: () => loadCursor(cursorPath),
      saveCursor: (v: string) => saveCursor(cursorPath, v)
    };
    if (account.transport.mode === "longpoll") {
      transport = createLongpollTransport({
        client,
        timeoutSec: account.transport.timeoutSec,
        handler,
        ...cursorIO,
        logger: (msg, meta) =>
          ctx.setStatus?.(`immojump:${ctx.accountId}:longpoll:${msg}${meta ? " " + JSON.stringify(meta) : ""}`)
      });
    } else {
      transport = createPollingTransport({
        client,
        intervalMs: account.transport.pollIntervalMs,
        handler,
        ...cursorIO,
        logger: (msg, meta) =>
          ctx.setStatus?.(`immojump:${ctx.accountId}:polling:${msg}${meta ? " " + JSON.stringify(meta) : ""}`)
      });
    }
  }

  await transport.start();

  // The OpenClaw gateway treats a returning startGateway as "channel
  // exited" and tries to auto-restart it. On restart the webhook listener
  // would EADDRINUSE the still-bound port. Block here until the runtime
  // explicitly asks us to stop via abortSignal — that way the same
  // transport instance stays alive for the whole gateway session.
  await new Promise<void>((resolve) => {
    const signal = ctx.abortSignal;
    if (!signal) return; // no signal → block forever, gateway shutdown kills the process
    if (signal.aborted) {
      transport.stop().catch(() => {});
      resolve();
      return;
    }
    signal.addEventListener("abort", () => {
      transport.stop().catch(() => {});
      resolve();
    });
  });
}

export { parsePluginConfig };
