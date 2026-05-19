export type ImmoJumpClientOptions = {
  serverUrl: string;
  botToken: string;
  /**
   * Pinned organisation id. Sent as `X-Organisation-Id` on every
   * request — the bot has no session so the backend can't infer the
   * org from `current_user.current_organisation_id`. Typically taken
   * from the `whoami()` response on startup.
   */
  organisationId?: string;
  fetchImpl?: typeof fetch;
};

export type BotIdentity = {
  bot_user_id: string;
  nickname: string;
  display_name: string | null;
  organisation_id: string;
};

export type Mention = {
  id: string;
  activity_id?: string;
  feed_event_id?: string;
  comment_id: string | null;
  body_html: string;
  sender_user_id: string;
  created_at: string;
};

export type Comment = {
  id: string;
  user_id: number;
  user_name?: string | null;
  message: string;
  created_at: string;
};

export class ImmoJumpClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private organisationId: string | undefined;

  constructor(opts: ImmoJumpClientOptions) {
    this.base = opts.serverUrl.replace(/\/+$/, "");
    this.token = opts.botToken;
    this.organisationId = opts.organisationId;
    this.fetcher = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  setOrganisation(orgId: string): void {
    this.organisationId = orgId;
  }

  async whoami(): Promise<BotIdentity> {
    const identity = await this.request<BotIdentity>("GET", "/api/bots/me");
    if (!this.organisationId) this.organisationId = identity.organisation_id;
    return identity;
  }

  /**
   * Pull the next batch of mentions for the calling bot.
   *
   * - ``sinceIso`` — the ``created_at`` of the last mention already
   *   processed. Server returns notifications strictly newer than this.
   * - ``timeoutSec`` — Telegram-style long-polling. ``0`` (default)
   *   returns immediately; ``1..50`` makes the server hold the
   *   connection up to N seconds via Redis pub/sub until a new mention
   *   arrives. Cuts request volume ~5-10x vs short polling at 5s.
   *
   * The HTTP call's own timeout is set to ``timeoutSec + 10`` so the
   * client doesn't abort while the server is legitimately waiting.
   */
  async listMentions(sinceIso?: string, timeoutSec?: number): Promise<Mention[]> {
    const params: string[] = [];
    if (sinceIso) params.push(`since=${encodeURIComponent(sinceIso)}`);
    if (timeoutSec && timeoutSec > 0) params.push(`timeout=${timeoutSec}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    const fetchTimeoutMs = timeoutSec && timeoutSec > 0
      ? (timeoutSec + 10) * 1000
      : undefined;
    const resp = await this.request<{ mentions: Mention[] }>(
      "GET",
      `/api/bots/me/mentions${qs}`,
      undefined,
      { signalTimeoutMs: fetchTimeoutMs },
    );
    return resp.mentions;
  }

  /**
   * Post a comment into an OrgFeedEvent thread. The bot's reply lives
   * here as long as the lifecycle runs — successive `updateComment`
   * calls edit this same comment as tool/block/final stages stream in.
   */
  async postComment(feedEventId: string, message: string): Promise<Comment> {
    return this.request<Comment>(
      "POST",
      `/api/organisation-feed/${feedEventId}/comments`,
      { message }
    );
  }

  async updateComment(commentId: string, message: string): Promise<Comment> {
    return this.request<Comment>(
      "PATCH",
      `/api/organisation-feed/comments/${commentId}`,
      { message }
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { signalTimeoutMs?: number },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (this.organisationId) headers["X-Organisation-Id"] = this.organisationId;
    // Long-polling requests need a generous client-side timeout — the
    // server holds the connection for ``timeoutSec`` seconds before
    // responding. We allow a 10s grace beyond that for header/body
    // transfer, then abort.
    const controller = opts?.signalTimeoutMs ? new AbortController() : undefined;
    const timer = controller && opts?.signalTimeoutMs
      ? setTimeout(() => controller.abort(), opts.signalTimeoutMs)
      : undefined;
    try {
      const resp = await this.fetcher(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`immoJUMP ${method} ${path} -> ${resp.status} ${resp.statusText}: ${text}`);
      }
      if (resp.status === 204) return undefined as T;
      return (await resp.json()) as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
