# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **OpenClaw channel plugin** (`@immodigit/openclaw-immojump-bot`) that lets an
OpenClaw agent participate in the immoJUMP activity feed as a first-class bot:
it answers @-mentions directly inside the feed, posting/streaming its reply as a
comment on the mentioned OrgFeedEvent. Loaded by OpenClaw at runtime — no
standalone server.

## Commands

```bash
npm run build        # tsc -p tsconfig.build.json → dist/
npm test             # vitest run (tests/**/*.test.ts)
npm run typecheck    # tsc --noEmit -p tsconfig.json
```

## Architecture

- `src/index.ts` — plugin entry/registration.
- `src/plugin.ts` — the `immojumpPlugin` object (`.config`, `.gateway`, `.base`);
  `startGateway` resolves the agent route and runs the reply lifecycle via the
  host's `dispatchReplyWithBufferedBlockDispatcher` (`deliver(payload,{kind})`).
- `src/channel.ts` — `sendReplyLifecycle`: posts a placeholder comment, then
  edits it on each tool/block/final delivery.
- `src/format.ts` — renders comment bodies (immoJUMP comments are **HTML**, so
  agent markdown is converted via `marked`).
- `src/client.ts` — `ImmoJumpClient`: REST against the immoJUMP backend
  (`/api/bots/me`, `/api/bots/me/mentions` long-poll, `/api/organisation-feed/*`).
- Inbound transports: `longpoll` / `polling` / `webhook` (`src/inbound/`).

## Memory — tool-progress feature & live ops (Stand 2026-05-20)

- **Tool-progress view:** `format.ts`/`channel.ts` render a live progress view —
  `🛠️ <em>Ich arbeite daran …</em>` plus a rolling list of step lines (cap 6,
  HTML-escaped, consecutive duplicates skipped) — from `kind:"tool"` deliveries,
  replacing the static "Denke nach…" placeholder. The final answer replaces the
  view. `ReplyRenderState` ({previous, progressLines}) threads state through
  `formatReplyUpdate`.
- **Host gating (important):** the OpenClaw host only emits `kind:"tool"`
  deliveries when verbose progress is on. Requires
  `agents.defaults.verboseDefault: "on"` (+ `toolProgressDetail: "explain"`) in
  the instance's `~/.openclaw/openclaw.json`. Without it the comment goes
  placeholder → final with no progress view. Plugin code is necessary but NOT
  sufficient.
- **Deploy:** push to `main`; the OpenClaw pod's initContainer pulls
  `github:immodigit/openclaw-immojump-bot#main` (env `IMMOJUMP_PLUGIN_REF=main`)
  and rebuilds on pod start. Redeploy = `kubectl delete pod <openclaw-pod> -n <openclaw-namespace>`.
  Verify: `grep -c TOOL_PROGRESS_HEADER ~/.openclaw/extensions/openclaw-immojump-bot/dist/format.js`.
- **Runs in:** K8s ns `<openclaw-namespace>`, pod `<openclaw-pod>`, 4 bots — `clara-crm`,
  `otto-outreach`, `rex-recherche`, `wanda-website` — on beta.immojump.de,
  org `<org-id>`. (`<scratch-namespace>` ns is a
  scratch instance with NO immojump accounts configured.)
- **e2e test:** immoJUMP feed REST with a bot Bearer token (env
  `IMMOJUMP_BOT_TOKEN_<BOT>` in `<openclaw-pod>`) + header
  `X-Organisation-Id`. `POST /api/organisation-feed/post {message}` — a plain
  `@nickname` in the text triggers that bot (mention regex `@([\w.\-]{2,32})`,
  resolved by `OrganisationMember.nickname`). Poll
  `GET /api/organisation-feed/<event_id>/comments`. Trigger bot B by posting as a
  different bot A (the mention's own actor is skipped).
- **Known limitation:** a mentioned bot's inbound (`Mention.body_html` from
  `/api/bots/me/mentions`) carries only the notification headline + ~120-char
  snippet, not the full post/comment text. Strict-persona bots (e.g.
  `rex-recherche`) then reply "ich sehe nur die Erwähnung, nicht den Beitragstext"
  and ask for parameters instead of running tools — so feed e2e of tool-using
  behaviour is unreliable. Pre-existing, separate from the tool-progress feature.
