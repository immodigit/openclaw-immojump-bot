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

## Memory — tool-progress feature & inbound context

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
- **Deploy:** push to `main`; an OpenClaw instance's initContainer pulls
  `github:immodigit/openclaw-immojump-bot#main` (env `IMMOJUMP_PLUGIN_REF`) and
  rebuilds the plugin on pod start — redeploy by restarting the pod. Verify:
  `grep -c TOOL_PROGRESS_HEADER ~/.openclaw/extensions/openclaw-immojump-bot/dist/format.js`.
- **e2e test:** drive the immoJUMP feed REST API with a bot Bearer token +
  header `X-Organisation-Id`. `POST /api/organisation-feed/post {message}` — a
  plain `@nickname` in the text triggers that bot (mention regex
  `@([\w.\-]{2,32})`, resolved by `OrganisationMember.nickname`). Poll
  `GET /api/organisation-feed/<event_id>/comments`. Trigger one bot from another
  by posting as a different bot (a mention's own actor is skipped).
- **Mention inbound context:** the agent receives the *full conversation*, not
  just the notification headline. `inbound/mention-mapper.ts` (`buildMentionText`)
  composes the thread-root post + the last ~4 thread comments + the full
  triggering text from the enriched `Mention` (`event` / `thread` /
  `trigger_text`); `htmlToText` strips feed HTML to prose. This depends on the
  immoJUMP backend `GET /api/bots/me/mentions` sending those fields;
  `buildMentionText` falls back to `body_html` against an older backend. Without
  the enriched fields a mentioned bot only sees a short snippet and
  strict-persona agents ask for clarification instead of acting.
