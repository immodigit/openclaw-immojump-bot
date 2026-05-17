import { ImmoJumpClient } from "./client.js";
import {
  EMPTY_REPLY_FALLBACK,
  formatReplyFailure,
  formatReplyUpdate,
  THINKING_PLACEHOLDER,
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
  // We deliberately do NOT re-check the mention text here. The immo-calc
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

  let lastBody = THINKING_PLACEHOLDER;
  let finalSeen = false;

  const flush = async (next: string): Promise<void> => {
    if (next === lastBody) return;
    await opts.client.updateComment(placeholder.id, next);
    lastBody = next;
  };

  if ("finalText" in opts && opts.finalText !== undefined) {
    await flush(opts.finalText.trim() || EMPTY_REPLY_FALLBACK);
    return;
  }

  const session: ReplySession = {
    commentId: placeholder.id,
    async update({ kind, payload }) {
      const next = formatReplyUpdate(kind, payload, lastBody);
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
    if (!finalSeen) await flush(lastBody === THINKING_PLACEHOLDER ? EMPTY_REPLY_FALLBACK : lastBody);
  } catch (err) {
    await session.fail(err);
  }
}
