import { marked } from "marked";

// immoJUMP rendert Kommentar-Bodies als HTML, nicht als Markdown. Die
// Agents produzieren naturgemaess Markdown (``**bold**``, ``- liste``,
// usw.) — ohne Konvertierung sieht der Nutzer literale Sterne und
// Bindestriche. ``markdownToHtml`` wandelt Agent-Text in HTML; die
// Plugin-eigenen Bausteine (THINKING_PLACEHOLDER, EMPTY_REPLY_FALLBACK,
// Fehler-Praefix) sind schon als HTML formuliert.
export const THINKING_PLACEHOLDER = "🤔 <em>Denke nach…</em>";
export const EMPTY_REPLY_FALLBACK = "<em>(keine Antwort generiert)</em>";

export type ReplyStageKind = "tool" | "block" | "final";

export type ReplyStagePayload = {
  text?: string;
  toolName?: string;
  toolStatus?: "started" | "succeeded" | "failed";
};

const MAX_BODY_CHARS = 8000;

// Marked-Konfig: GFM (Tabellen, Strikethrough) + ``breaks: true`` damit
// einfache Zeilenumbruche zu ``<br>`` werden — sonst sieht der Nutzer
// Listenpunkte alle auf einer Zeile, weil Markdown sonst zwei NL pro
// Bruch verlangt.
marked.setOptions({ gfm: true, breaks: true });

export function markdownToHtml(input: string): string {
  if (!input) return "";
  try {
    // ``parse`` ist sync wenn keine async-Walks registriert sind. Es
    // gibt einen Sync-Wrapper, falls die Default-Konfig je async wird.
    const out = marked.parse(input, { async: false }) as string;
    return out.trim();
  } catch {
    // Bei Marked-Crash auf den Roh-Text zurueckfallen — besser literal
    // als gar nichts.
    return input;
  }
}

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
    return text ? truncate(markdownToHtml(text)) : EMPTY_REPLY_FALLBACK;
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
  // block (intermediate text chunk) — auch markdown-konvertieren, sonst
  // sieht der Nutzer Zwischenstaende mit Sternen/Bindestrichen.
  const text = (payload.text ?? "").trim();
  if (!text) return previous;
  const html = markdownToHtml(text);
  return truncate(previous === THINKING_PLACEHOLDER ? html : `${previous}\n\n${html}`);
}

export function formatReplyFailure(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return `⚠️ <em>Bot-Fehler:</em> ${msg.slice(0, 500)}`;
}
