import { immojumpPlugin, listAccountIds, resolveAccount, startGateway } from "./plugin.js";

type GatewayApi = {
  registerGatewayMethod(name: string, handler: (ctx: unknown) => Promise<void>): void;
  registerChannel?(args: { plugin: unknown }): void;
};

export function register(api: GatewayApi): void {
  // Diagnostic — track which lifecycle hook the host actually calls.
  // The host runtime varies between bundled-channel vs. external-plugin
  // discovery paths; when accounts don't start it's almost always
  // because activate() wasn't reached.
  // eslint-disable-next-line no-console
  console.error(`[immojump-bot] register() called, hasRegisterChannel=${typeof api.registerChannel === "function"}`);
  api.registerChannel?.({ plugin: immojumpPlugin });
}

export function activate(api: GatewayApi): void {
  // eslint-disable-next-line no-console
  console.error(`[immojump-bot] activate() called, hasRegisterGatewayMethod=${typeof api.registerGatewayMethod === "function"}`);
  api.registerGatewayMethod("immojump.gateway.startAccount", (ctx) =>
    startGateway(ctx as Parameters<typeof startGateway>[0])
  );
}

export default {
  id: "immojump",
  name: "immoJUMP",
  description:
    "Channel plugin: agent participates in the immoJUMP activity feed via mentions, with webhook inbound and comment-edit streaming.",
  plugin: immojumpPlugin,
  config: {
    listAccountIds,
    resolveAccount,
    isConfigured(account: unknown) {
      const a = account as { serverUrl?: string; auth?: { botToken?: string } } | null | undefined;
      return Boolean(a?.serverUrl && a.auth?.botToken);
    }
  },
  register,
  activate,
  registerFull(api: GatewayApi) {
    api.registerGatewayMethod("immojump.gateway.startAccount", (ctx) =>
      startGateway(ctx as Parameters<typeof startGateway>[0])
    );
  }
};
