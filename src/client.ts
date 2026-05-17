export type ImmoJumpClientOptions = {
  serverUrl: string;
  botToken: string;
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
  activity_id: string;
  comment_id: string | null;
  body_html: string;
  sender_user_id: string;
  created_at: string;
};

export type Comment = {
  id: string;
  activity_id: string;
  body: string;
  author_user_id: string;
  created_at: string;
  updated_at: string | null;
};

export class ImmoJumpClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;

  constructor(opts: ImmoJumpClientOptions) {
    this.base = opts.serverUrl.replace(/\/+$/, "");
    this.token = opts.botToken;
    this.fetcher = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async whoami(): Promise<BotIdentity> {
    return this.request<BotIdentity>("GET", "/api/bots/me");
  }

  async listMentions(sinceIso?: string): Promise<Mention[]> {
    const qs = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : "";
    const resp = await this.request<{ mentions: Mention[] }>("GET", `/api/bots/me/mentions${qs}`);
    return resp.mentions;
  }

  async postComment(activityId: string, body: string): Promise<Comment> {
    return this.request<Comment>("POST", `/api/activities/${activityId}/comments`, { body });
  }

  async updateComment(activityId: string, commentId: string, body: string): Promise<Comment> {
    return this.request<Comment>(
      "PATCH",
      `/api/activities/${activityId}/comments/${commentId}`,
      { body }
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await this.fetcher(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
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
