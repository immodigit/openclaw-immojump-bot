import { describe, expect, it } from "vitest";
import { parsePluginConfig } from "../src/config.js";

describe("parsePluginConfig", () => {
  it("parses a minimal webhook account", () => {
    const cfg = parsePluginConfig({
      accounts: {
        main: {
          enabled: true,
          serverUrl: "https://app.immojump.de",
          auth: { botToken: "t".repeat(40) },
          transport: {
            mode: "webhook",
            listenPort: 8788,
            webhookSecret: "s".repeat(32)
          }
        }
      }
    });
    expect(cfg.accounts.main.transport.mode).toBe("webhook");
    if (cfg.accounts.main.transport.mode === "webhook") {
      expect(cfg.accounts.main.transport.listenHost).toBe("127.0.0.1");
    }
  });

  it("substitutes ${ENV} placeholders", () => {
    const prev = process.env.IMMOJUMP_TEST_TOKEN;
    process.env.IMMOJUMP_TEST_TOKEN = "secret-token-from-env";
    try {
      const cfg = parsePluginConfig({
        accounts: {
          main: {
            enabled: true,
            serverUrl: "https://app.immojump.de",
            auth: { botToken: "${IMMOJUMP_TEST_TOKEN}" },
            transport: { mode: "polling", pollIntervalMs: 5000 }
          }
        }
      });
      expect(cfg.accounts.main.auth.botToken).toBe("secret-token-from-env");
    } finally {
      process.env.IMMOJUMP_TEST_TOKEN = prev;
    }
  });

  it("rejects auth without botToken", () => {
    expect(() =>
      parsePluginConfig({
        accounts: {
          main: {
            enabled: true,
            serverUrl: "https://app.immojump.de",
            auth: {},
            transport: { mode: "polling" }
          }
        }
      })
    ).toThrow();
  });

  it("rejects webhookSecret shorter than 16 chars", () => {
    expect(() =>
      parsePluginConfig({
        accounts: {
          main: {
            enabled: true,
            serverUrl: "https://app.immojump.de",
            auth: { botToken: "t".repeat(40) },
            transport: {
              mode: "webhook",
              listenPort: 8788,
              webhookSecret: "tooShort"
            }
          }
        }
      })
    ).toThrow();
  });
});
