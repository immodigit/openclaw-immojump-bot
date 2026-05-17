export type InboundEvent = {
  /** Event-id from backend; used for idempotency. */
  id: string;
  /** Event type — currently `mention.created`. */
  type: "mention.created";
  /** Activity the comment lives in. */
  activityId: string;
  /** Comment in which the bot was mentioned. */
  commentId: string | null;
  /** Raw mention text (HTML stripped). */
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
