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
  return Object.keys(parseChannelConfig(cfg).accounts);
}

export function resolveAccount(cfg: unknown, accountId?: string): ResolvedAccount | null {
  if (!accountId) return null;
  const accounts = parseChannelConfig(cfg as OpenClawConfig).accounts;
  const account = accounts[accountId];
  return account ? { ...account, accountId } : null;
}

function isConfigured(account: Partial<ResolvedAccount> | null | undefined): boolean {
  return Boolean(account?.serverUrl && account?.auth?.botToken);
}

export const immojumpPlugin = {
  config: {
    listAccountIds,
    resolveAccount,
    isConfigured
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

  const handler = async (event: InboundEvent): Promise<void> => {
    if (
      !shouldHandleInboundEvent(event, {
        botUserId: identity.bot_user_id,
        mentionNames: [identity.nickname, ...account.mentionNames]
      })
    ) {
      return;
    }
    await sendReplyLifecycle({
      client,
      activityId: event.activityId,
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
          sessionKey: `immojump:${ctx.accountId}:${event.activityId}`,
          text: event.text,
          metadata: {
            channel: "immojump",
            activityId: event.activityId,
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
    transport = createPollingTransport({
      client,
      intervalMs: account.transport.pollIntervalMs,
      handler,
      loadCursor: () => loadCursor(cursorPath),
      saveCursor: (v) => saveCursor(cursorPath, v),
      logger: (msg, meta) =>
        ctx.setStatus?.(`immojump:${ctx.accountId}:polling:${msg}${meta ? " " + JSON.stringify(meta) : ""}`)
    });
  }

  await transport.start();

  if (ctx.abortSignal) {
    ctx.abortSignal.addEventListener("abort", () => {
      transport.stop().catch(() => {});
    });
  }
}

export { parsePluginConfig };
