export type InboundEvent = {
  /** Event-id from backend; used for idempotency. */
  id: string;
  /** Event type — currently `mention.created`. */
  type: "mention.created";
  /**
   * OrgFeedEvent id (the thread root). The bot's reply is posted as a
   * comment on this event via `POST /api/organisation-feed/<id>/
   * comments`. May be `null` for legacy/non-feed mention sources — the
   * plugin should ignore those (or fall back to URL parsing).
   */
  feedEventId: string | null;
  /**
   * OrgFeedComment id in which the @-mention itself appeared, when the
   * trigger was a comment-on-comment (vs. a top-level mention in the
   * thread). Useful as reply-to context for the agent; not required
   * for posting the reply.
   */
  commentId: string | null;
  /** Raw mention text (HTML — the plugin may strip tags). */
  text: string;
  /** Who triggered the mention. */
  senderUserId: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
};

export type InboundTransport = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type InboundHandler = (event: InboundEvent) => Promise<void>;
