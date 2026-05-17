import { z } from "zod";

const authSchema = z
  .object({
    botToken: z.string().min(1)
  })
  .strict();

const webhookTransportSchema = z
  .object({
    mode: z.literal("webhook"),
    listenHost: z.string().min(1).default("127.0.0.1"),
    listenPort: z.number().int().min(1).max(65535),
    webhookSecret: z.string().min(16)
  })
  .strict();

const pollingTransportSchema = z
  .object({
    mode: z.literal("polling"),
    pollIntervalMs: z.number().int().min(1000).default(5000)
  })
  .strict();

const transportSchema = z.preprocess(
  (value) => value ?? { mode: "polling" },
  z.discriminatedUnion("mode", [webhookTransportSchema, pollingTransportSchema])
);

const accountSchema = z
  .object({
    enabled: z.boolean(),
    serverUrl: z.string().min(1),
    auth: authSchema,
    transport: transportSchema,
    mentionNames: z.array(z.string().min(1)).default([]),
    agent: z.string().min(1).optional()
  })
  .strict();

const pluginConfigSchema = z
  .object({
    accounts: z.record(z.string().min(1), accountSchema)
  })
  .strict();

export type PluginConfig = z.infer<typeof pluginConfigSchema>;
export type PluginAccountConfig = PluginConfig["accounts"][string];

function substituteEnvVars(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map((v) => substituteEnvVars(v, env));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteEnvVars(v, env);
    }
    return out;
  }
  return value;
}

export function parsePluginConfig(raw: unknown): PluginConfig {
  return pluginConfigSchema.parse(substituteEnvVars(raw));
}

export function parseChannelConfig(cfg: { channels?: { immojump?: unknown } }): PluginConfig {
  return parsePluginConfig(cfg.channels?.immojump ?? { accounts: {} });
}
