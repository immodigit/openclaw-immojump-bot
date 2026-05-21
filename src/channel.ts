import { ImmoJumpClient } from "./client.js";
import {
  EMPTY_REPLY_FALLBACK,
  formatReplyFailure,
  formatReplyUpdate,
  isToolProgressBody,
  THINKING_PLACEHOLDER,
  type ReplyRenderState,
  type ReplyStageKind,
  type ReplyStagePayload
} from "./format.js";
import type { InboundEvent } from "./inbound/types.js";

export type ChannelRuleOptions = {
  botUserId: string;
  mentionNames: string[];
};

export function shouldHandleInboundEvent(event: InboundEvent, opts: ChannelRuleOptions): boolean {
  // Loop-prevention: never react to our own activity.
  if (event.senderUserId === opts.botUserId) return false;
  // Plumbing-prevention: we need an event id to post the reply against.
  if (!event.feedEventId) return false;
  // We deliberately do NOT re-check the mention text here. The immoJUMP
  // backend already resolved the @-mention to this specific bot (otherwise
  // the webhook wouldn't have fired); re-parsing the visible body —
  // which only contains the notification headline, not the original
  // post HTML — produced false negatives. ``mentionNames`` stays on the
  // config purely for documentation / future routing decisions.
  void opts.mentionNames;
  return true;
}

export type ReplySession = {
  commentId: string;
  update(params: { kind: ReplyStageKind; payload: ReplyStagePayload }): Promise<void>;
  hasFinalUpdate(): boolean;
  fail(error: unknown): Promise<void>;
};

export type SendReplyLifecycleOptions = {
  client: ImmoJumpClient;
  feedEventId: string;
} & (
  | { finalText: string; run?: never }
  | { finalText?: never; run(session: ReplySession): Promise<void> }
);

export async function sendReplyLifecycle(opts: SendReplyLifecycleOptions): Promise<void> {
  const placeholder = await opts.client.postComment(opts.feedEventId, THINKING_PLACEHOLDER);

  // Render-Zustand: der aktuell sichtbare Body plus die rollierende Liste
  // der Tool-Fortschrittszeilen. Sobald das erste Tool laeuft, ersetzt die
  // Fortschrittsansicht den statischen "Denke nach…"-Platzhalter.
  const state: ReplyRenderState = {
    previous: THINKING_PLACEHOLDER,
    progressLines: []
  };
  let finalSeen = false;

  const flush = async (next: string): Promise<void> => {
    if (next === state.previous) return;
    await opts.client.updateComment(placeholder.id, next);
    state.previous = next;
  };

  if ("finalText" in opts && opts.finalText !== undefined) {
    await flush(opts.finalText.trim() || EMPTY_REPLY_FALLBACK);
    return;
  }

  const session: ReplySession = {
    commentId: placeholder.id,
    async update({ kind, payload }) {
      const next = formatReplyUpdate(kind, payload, state);
      if (kind === "final") finalSeen = true;
      await flush(next);
    },
    hasFinalUpdate() {
      return finalSeen;
    },
    async fail(error) {
      await flush(formatReplyFailure(error));
    }
  };

  try {
    await opts.run!(session);
    if (!finalSeen) {
      // Empty-final path: the agent produced no text for the final
      // stage (model abort, no tools, persona refusing the prompt, …).
      //
      // Earlier we tried "delete placeholder when the body is still
      // THINKING_PLACEHOLDER" (lifted from rocketchat-bot 57d5f46).
      // That turned out wrong for our UX: when a user explicitly
      // @-mentions a bot and the placeholder vanishes, it looks like
      // the bot crashed rather than telegraphing what's going on.
      // Always show the (now actionable) EMPTY_REPLY_FALLBACK instead.
      if (isToolProgressBody(state.previous)) {
        // Es ist nur der Platzhalter oder die Tool-Fortschrittsansicht
        // sichtbar — beides ist keine echte Antwort. Den handlungs-
        // leitenden Fallback einsetzen.
        await flush(EMPTY_REPLY_FALLBACK);
      } else {
        // We already streamed partial block chunks; keep them so
        // the user sees what the agent attempted.
        await flush(state.previous);
      }
    }
  } catch (err) {
    await session.fail(err);
  }
}
