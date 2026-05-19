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

export type ChannelRuntimeLike = {
  dispatch?(payload: {
    accountId: string;
    sessionKey: string;
    text: string;
    metadata: Record<string, unknown>;
  }): Promise<{ replyText?: string } | void>;
};

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

  // Diagnostic — capture the actual function signatures so we can wire
  // the agent turn correctly without guessing.
  const cr = ctx.channelRuntime as Record<string, unknown> | undefined;
  const dumpFn = (label: string, fn: unknown) => {
    if (typeof fn === "function") {
      const src = fn.toString();
      const sig = src.slice(0, Math.min(src.indexOf("{"), 240));
      // eslint-disable-next-line no-console
      console.error(`[immojump-bot] ${label} sig: ${sig.replace(/\s+/g, " ")}`);
    }
  };
  const turn = cr?.turn as Record<string, unknown> | undefined;
  const routing = cr?.routing as Record<string, unknown> | undefined;
  if (turn) {
    dumpFn("turn.run", turn.run);
    dumpFn("turn.runResolved", turn.runResolved);
    dumpFn("turn.runPrepared", turn.runPrepared);
    dumpFn("turn.buildContext", turn.buildContext);
  }
  if (routing) {
    dumpFn("routing.resolveAgentRoute", routing.resolveAgentRoute);
    dumpFn("routing.buildAgentSessionKey", routing.buildAgentSessionKey);
  }

  const handler = async (event: InboundEvent): Promise<void> => {
    if (
      !shouldHandleInboundEvent(event, {
        botUserId: identity.bot_user_id,
        mentionNames: [identity.nickname, ...account.mentionNames]
      })
    ) {
      return;
    }
    if (!event.feedEventId) return;
    const feedEventId = event.feedEventId;
    await sendReplyLifecycle({
      client,
      feedEventId,
      run: async (session) => {
        if (!ctx.channelRuntime?.dispatch) {
          await session.update({
            kind: "final",
            payload: {
              text: "_(OpenClaw channelRuntime not wired — plugin scaffold; no agent loop yet.)_"
            }
          });
          return;
        }
        const result = await ctx.channelRuntime.dispatch({
          accountId: ctx.accountId,
          sessionKey: `immojump:${ctx.accountId}:${feedEventId}`,
          text: event.text,
          metadata: {
            channel: "immojump",
            feedEventId,
            commentId: event.commentId,
            senderUserId: event.senderUserId,
            agent: account.agent
          }
        });
        await session.update({
          kind: "final",
          payload: { text: result?.replyText ?? "" }
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
