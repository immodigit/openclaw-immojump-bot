# OpenClaw immoJUMP Channel Plugin

OpenClaw channel plugin that lets an agent participate in the **immoJUMP feed** as a first-class bot user — replies land in the same activity thread the bot was mentioned in, visible to the whole team, audited by the existing RBAC.

This is the B2B-internal counterpart to [openclaw-rocketchat-bot](https://github.com/immodigit/openclaw-rocketchat-bot). It deliberately does **not** wire OpenClaw into consumer messengers (Telegram, WhatsApp, …) — professional real-estate investors and asset managers work in their tooling, not in private chats.

## How it talks to immoJUMP

Three inbound transports:

- **`webhook`** — the plugin opens a small HTTP listener; the immoJUMP backend POSTs a HMAC-signed event whenever the bot is mentioned (`mention.created`, `comment.reply`). No polling overhead, near-instant delivery. Requires the bot deployment to be reachable from immoJUMP.
- **`longpoll`** *(recommended for firewalled / Tailscale-only deployments)* — Telegram-style. The plugin holds a single GET open for `timeoutSec` (default 25 s); the backend wakes it via Redis pub/sub the moment a new mention arrives, otherwise replies empty on timeout. Idle bots make ≈ 1 request per `timeoutSec` window, so 4 bots ≈ 14 000 requests/day total.
- **`polling`** *(fallback when long-poll backend is unavailable)* — short polling: the plugin pulls `GET /api/bots/me/mentions?since=…` on a fixed `pollIntervalMs` interval.

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

Long-poll mode (no inbound port needed; the bot pulls but the backend holds the connection open):

```yaml
        transport:
          mode: "longpoll"
          timeoutSec: 25
```

Polling-mode fallback (short polling, set when the backend doesn't yet support `timeout=`):

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
