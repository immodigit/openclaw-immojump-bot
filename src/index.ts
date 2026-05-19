import { immojumpPlugin, listAccountIds, resolveAccount, startGateway } from "./plugin.js";

type GatewayApi = {
  registerGatewayMethod(name: string, handler: (ctx: unknown) => Promise<void>): void;
  registerChannel?(args: { plugin: unknown }): void;
};

function wireStartAccount(api: GatewayApi, callerLabel: string): void {
  if (typeof api.registerGatewayMethod !== "function") {
    // eslint-disable-next-line no-console
    console.error(`[immojump-bot] ${callerLabel}: registerGatewayMethod missing on api — startAccount cannot be wired`);
    return;
  }
  api.registerGatewayMethod("immojump.gateway.startAccount", (ctx) =>
    startGateway(ctx as Parameters<typeof startGateway>[0])
  );
  // eslint-disable-next-line no-console
  console.error(`[immojump-bot] ${callerLabel}: registered immojump.gateway.startAccount`);
}

export function register(api: GatewayApi): void {
  // Some host runtimes only invoke register() and skip activate(); the
  // gateway-method wiring must live here too so channel accounts can
  // start regardless of which lifecycle hook the host picks.
  // eslint-disable-next-line no-console
  console.error(`[immojump-bot] register() called, hasRegisterChannel=${typeof api.registerChannel === "function"}`);
  api.registerChannel?.({ plugin: immojumpPlugin });
  wireStartAccount(api, "register");
}

export function activate(api: GatewayApi): void {
  // eslint-disable-next-line no-console
  console.error(`[immojump-bot] activate() called`);
  wireStartAccount(api, "activate");
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
    wireStartAccount(api, "registerFull");
  }
};
