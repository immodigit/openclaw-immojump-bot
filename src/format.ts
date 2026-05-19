// immoJUMP rendert Kommentar-Bodies als HTML, nicht als Markdown.
// Mit ``_…_`` blieben die Unterstriche als Zeichen stehen. ``<em>`` wird
// sauber kursiv dargestellt.
export const THINKING_PLACEHOLDER = "🤔 <em>Denke nach…</em>";
export const EMPTY_REPLY_FALLBACK = "<em>(keine Antwort generiert)</em>";

export type ReplyStageKind = "tool" | "block" | "final";

export type ReplyStagePayload = {
  text?: string;
  toolName?: string;
  toolStatus?: "started" | "succeeded" | "failed";
};

const MAX_BODY_CHARS = 8000;

function truncate(s: string, max = MAX_BODY_CHARS): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function formatReplyUpdate(
  kind: ReplyStageKind,
  payload: ReplyStagePayload,
  previous: string
): string {
  if (kind === "final") {
    const text = (payload.text ?? "").trim();
    return text ? truncate(text) : EMPTY_REPLY_FALLBACK;
  }
  if (kind === "tool") {
    const status =
      payload.toolStatus === "succeeded"
        ? "✓"
        : payload.toolStatus === "failed"
          ? "✗"
          : "⚙️";
    const line = `${status} ${payload.toolName ?? "tool"}`;
    return truncate(previous === THINKING_PLACEHOLDER ? line : `${previous}\n${line}`);
  }
  // block (intermediate text chunk)
  const text = (payload.text ?? "").trim();
  if (!text) return previous;
  return truncate(previous === THINKING_PLACEHOLDER ? text : `${previous}\n\n${text}`);
}

export function formatReplyFailure(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return `⚠️ <em>Bot-Fehler:</em> ${msg.slice(0, 500)}`;
}
