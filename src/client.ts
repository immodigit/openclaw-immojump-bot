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

  async listMentions(sinceIso?: string): Promise<Mention[]> {
    const qs = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : "";
    const resp = await this.request<{ mentions: Mention[] }>("GET", `/api/bots/me/mentions${qs}`);
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (this.organisationId) headers["X-Organisation-Id"] = this.organisationId;
    const resp = await this.fetcher(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`immoJUMP ${method} ${path} -> ${resp.status} ${resp.statusText}: ${text}`);
    }
    if (resp.status === 204) return undefined as T;
    return (await resp.json()) as T;
  }
}
