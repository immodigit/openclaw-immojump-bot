import type { Mention } from "../client.js";
import type { InboundEvent } from "./types.js";

/**
 * Strip HTML to readable plain text for the agent prompt. immoJUMP feed
 * posts and comments are stored as HTML; the agent wants prose, not tags.
 */
export function htmlToText(html: string): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Compose the agent-facing inbound text from a mention.
 *
 * With an enriched backend (``event`` / ``thread`` / ``trigger_text``
 * present) the agent sees the whole conversation — the thread-root post,
 * the last few replies, and the exact message that mentioned it. With an
 * older backend that only sends the notification headline, it falls back
 * to ``body_html`` so nothing breaks.
 */
export function buildMentionText(m: Mention): string {
  const enriched = Boolean(m.event || m.trigger_text);
  if (!enriched) {
    return htmlToText(m.body_html);
  }
  const parts: string[] = [];
  if (m.event) {
    const who = (m.event.user_name || "Jemand").trim();
    const head = htmlToText(
      [m.event.title, m.event.message].filter(Boolean).join("\n")
    );
    parts.push(`[immoJUMP-Feed — Beitrag von ${who}]\n${head || "(kein Text)"}`);
  }
  const thread = m.thread ?? [];
  if (thread.length > 0) {
    const lines = thread
      .map((c) => {
        const txt = htmlToText(c.message);
        return txt ? `${(c.user_name || "Jemand").trim()}: ${txt}` : "";
      })
      .filter((line) => line.length > 0);
    if (lines.length > 0) {
      parts.push(`[Letzte Antworten im Thread]\n${lines.join("\n")}`);
    }
  }
  const trigger = htmlToText(m.trigger_text ?? m.body_html);
  parts.push(
    `[Erwähnung an dich — darauf sollst du antworten]\n${trigger || "(kein Text)"}`
  );
  return parts.join("\n\n");
}

/**
 * Map a backend ``Mention`` to the plugin's normalized ``InboundEvent``.
 * Shared by the longpoll and polling transports so the agent body is
 * built identically regardless of transport.
 */
export function mentionToInboundEvent(m: Mention): InboundEvent {
  return {
    id: m.id,
    type: "mention.created",
    feedEventId: m.feed_event_id ?? null,
    commentId: m.comment_id,
    text: buildMentionText(m),
    senderUserId: m.sender_user_id,
    createdAt: m.created_at
  };
}
