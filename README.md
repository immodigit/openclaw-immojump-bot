# OpenClaw immoJUMP Channel Plugin

OpenClaw channel plugin that lets an agent participate in the **immoJUMP feed** as a first-class bot user — replies land in the same activity thread the bot was mentioned in, visible to the whole team, audited by the existing RBAC.

This is the B2B-internal counterpart to [openclaw-rocketchat-bot](https://github.com/immodigit/openclaw-rocketchat-bot). It deliberately does **not** wire OpenClaw into consumer messengers (Telegram, WhatsApp, …) — professional real-estate investors and asset managers work in their tooling, not in private chats.

## How it talks to immoJUMP

Two inbound transports:

- **`webhook`** *(recommended)* — the plugin opens a small HTTP listener; the immoJUMP backend POSTs a HMAC-signed event whenever the bot is mentioned (`mention.created`, `comment.reply`). No polling overhead, near-instant delivery.
- **`polling`** *(fallback for hosts that can't expose any inbound port)* — the plugin pulls `GET /api/bots/me/mentions?since=…` on an interval.

Outbound is always REST against the immoJUMP backend, authenticated with the bot's bearer token:

- `POST /api/activities/<id>/comments` — drop a "🤔 Thinking…" placeholder into the activity thread
- `PATCH /api/activities/<id>/comments/<id>` — overwrite the placeholder as tool/block/final stages arrive (one editable message per turn, matching the OpenClaw streaming UX)
- `GET /api/bots/me` — self-bootstrap (organisation, available tools, etc.)

## Install

```bash
openclaw plugins install ./
```

Or, once published to npm:

```bash
openclaw plugins install @immodigit/openclaw-immojump-bot
```

## Config example

```yaml
channels:
  immojump:
    accounts:
      main:
        enabled: true
        serverUrl: "https://app.immojump.de"
        auth:
          botToken: "${IMMOJUMP_BOT_TOKEN}"   # the bot's bearer (see immoJUMP /settings/bots)
        transport:
          mode: "webhook"
          listenHost: "127.0.0.1"
          listenPort: 8788
          webhookSecret: "${IMMOJUMP_WEBHOOK_SECRET}"
        mentionNames:
          - "leadbot"
        # Optional — pin to a specific OpenClaw agent id; defaults to `main`.
        agent: "leadbot"
```

Polling-mode fallback:

```yaml
        transport:
          mode: "polling"
          pollIntervalMs: 5000
```

## Status

🚧 **Scaffold** — manifest + plugin lifecycle in place; transport implementations stubbed pending immoJUMP backend Phase 2.1 (outbound-webhook) and Phase 2.3 (comment-edit endpoint).

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT — see [LICENSE](./LICENSE).
