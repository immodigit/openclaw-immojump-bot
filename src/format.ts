import { marked } from "marked";

// immoJUMP rendert Kommentar-Bodies als HTML, nicht als Markdown. Die
// Agents produzieren naturgemaess Markdown (``**bold**``, ``- liste``,
// usw.) — ohne Konvertierung sieht der Nutzer literale Sterne und
// Bindestriche. ``markdownToHtml`` wandelt Agent-Text in HTML; die
// Plugin-eigenen Bausteine (THINKING_PLACEHOLDER, EMPTY_REPLY_FALLBACK,
// TOOL_PROGRESS_HEADER, Fehler-Praefix) sind schon als HTML formuliert.
export const THINKING_PLACEHOLDER = "🤔 <em>Denke nach…</em>";
// Ein leiser fall-back, der dem Operator erklaert *was* passiert ist und
// *wie weiter* — statt nur "(keine Antwort generiert)" zu rufen oder die
// Nachricht ganz zu loeschen (was den User mit einem leeren Thread und
// keinerlei Signal zurueck laesst, dass der Bot ueberhaupt versucht hat).
export const EMPTY_REPLY_FALLBACK =
  "⚠️ <em>Ich habe gerade keine Antwort produziert — vermutlich fehlt mir ein Tool oder Kontext. Schreib mir bitte nochmal mit mehr Details.</em>";
// Ueberschrift ueber der Live-Liste "woran arbeite ich gerade". Sobald das
// erste Tool laeuft, ersetzt diese Fortschrittsansicht den statischen
// THINKING_PLACEHOLDER — der Nutzer sieht dann konkret, was der Agent tut
// und wie er vorgeht, statt nur ein eingefrorenes "Denke nach…".
export const TOOL_PROGRESS_HEADER = "🛠️ <em>Ich arbeite daran …</em>";

export type ReplyStageKind = "tool" | "block" | "final";

export type ReplyStagePayload = {
  text?: string;
};

// Veraenderlicher Render-Zustand, der durch ``formatReplyUpdate`` gereicht
// wird: der aktuell sichtbare Kommentar-Body plus die rollierende Liste der
// Tool-Fortschrittszeilen. Wird einmal pro Antwort-Lifecycle angelegt und
// in place mutiert.
export type ReplyRenderState = {
  /** Der Body, den der Nutzer aktuell sieht. */
  previous: string;
  /** Tool-Fortschrittszeilen, neueste zuletzt. */
  progressLines: string[];
};

const MAX_BODY_CHARS = 8000;
// Die Fortschrittsansicht bleibt kompakt — nur die juengsten Schritte
// bleiben sichtbar, aeltere rollen oben raus (wie die Telegram-Progress-
// Drafts in OpenClaw).
const MAX_PROGRESS_LINES = 6;

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

// Minimaler HTML-Escaper fuer Tool-Zeilen: die kommen als Klartext vom Host
// (z.B. ein Dateipfad mit ``<``) und landen direkt im HTML-Kommentar-Body.
function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Eine Tool-Lieferung in eine kurze, nicht-technische Fortschrittszeile
// uebersetzen. Der OpenClaw-Host formatiert Tool-Aktivitaet bereits lesbar
// ("🔎 Web Search: …", "📖 from docs/…") — diesen Text nehmen wir bevorzugt
// und setzen nur dann eine generische Zeile, wenn die Lieferung leer ist.
export function toolProgressLine(payload: ReplyStagePayload): string {
  const raw = (payload.text ?? "").trim();
  return raw || "🛠️ Arbeitsschritt läuft …";
}

// Die rollierende Tool-Fortschrittsliste in einen HTML-Kommentar-Body
// rendern: eine Ueberschrift plus eine Zeile pro Schritt.
export function renderToolProgress(lines: string[]): string {
  if (lines.length === 0) return TOOL_PROGRESS_HEADER;
  const body = lines.map((line) => escapeHtml(line)).join("<br>");
  return `${TOOL_PROGRESS_HEADER}<br>${body}`;
}

// True, wenn ``body`` das Live-Tool-Geruest ist (Platzhalter oder
// Fortschrittsansicht) — also noch kein echter Antworttext.
export function isToolProgressBody(body: string): boolean {
  return body === THINKING_PLACEHOLDER || body.startsWith(TOOL_PROGRESS_HEADER);
}

export function formatReplyUpdate(
  kind: ReplyStageKind,
  payload: ReplyStagePayload,
  state: ReplyRenderState
): string {
  if (kind === "final") {
    const text = (payload.text ?? "").trim();
    return text ? truncate(markdownToHtml(text)) : EMPTY_REPLY_FALLBACK;
  }
  if (kind === "tool") {
    const line = toolProgressLine(payload);
    const lines = state.progressLines;
    // Direkt aufeinanderfolgende Duplikate ueberspringen, damit eine
    // gespraechige Tool-Schleife die Ansicht nicht zumuellt.
    if (lines[lines.length - 1] !== line) {
      lines.push(line);
      if (lines.length > MAX_PROGRESS_LINES) {
        lines.splice(0, lines.length - MAX_PROGRESS_LINES);
      }
    }
    return renderToolProgress(lines);
  }
  // block (Zwischenstueck der echten Antwort) — auch markdown-konvertieren,
  // sonst sieht der Nutzer Zwischenstaende mit Sternen/Bindestrichen.
  // Echter Antworttext loest das Tool-Fortschrittsgeruest ab; sonst
  // haengen wir an den bisherigen Body an.
  const text = (payload.text ?? "").trim();
  if (!text) return state.previous;
  const html = markdownToHtml(text);
  const base = isToolProgressBody(state.previous) ? "" : state.previous;
  return truncate(base ? `${base}\n\n${html}` : html);
}

export function formatReplyFailure(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return `⚠️ <em>Bot-Fehler:</em> ${msg.slice(0, 500)}`;
}
