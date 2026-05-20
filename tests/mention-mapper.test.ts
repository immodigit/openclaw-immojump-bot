import { describe, expect, it } from "vitest";
import type { Mention } from "../src/client.js";
import {
  buildMentionText,
  htmlToText,
  mentionToInboundEvent
} from "../src/inbound/mention-mapper.js";

describe("htmlToText", () => {
  it("strips tags and decodes entities", () => {
    expect(htmlToText("<p>Hallo <strong>Welt</strong> &amp; mehr</p>")).toBe(
      "Hallo Welt & mehr"
    );
  });

  it("turns <br> and block ends into newlines", () => {
    expect(htmlToText("a<br>b<br/>c")).toBe("a\nb\nc");
  });

  it("renders list items with bullets", () => {
    const out = htmlToText("<ul><li>eins</li><li>zwei</li></ul>");
    expect(out).toContain("• eins");
    expect(out).toContain("• zwei");
  });
});

describe("buildMentionText", () => {
  const base: Mention = {
    id: "m1",
    feed_event_id: "e1",
    comment_id: null,
    body_html: "Erwähnung von Wanda",
    sender_user_id: "10",
    created_at: "2026-05-20T15:00:00Z"
  };

  it("falls back to body_html for an un-enriched (legacy) mention", () => {
    expect(buildMentionText(base)).toBe("Erwähnung von Wanda");
  });

  it("composes post + thread + trigger for an enriched mention", () => {
    const m: Mention = {
      ...base,
      trigger_kind: "comment",
      trigger_text: "<p>@rex bitte 3 Leads in München</p>",
      event: {
        id: "e1",
        title: "Akquise-Sprint",
        message: "<p>Wir brauchen neue Leads.</p>",
        user_name: "Wanda Website"
      },
      thread: [
        { id: "c1", user_name: "Clara CRM", message: "<p>Ich kümmere mich ums CRM.</p>" },
        { id: "c2", user_name: "Otto", message: "Outreach steht bereit" }
      ]
    };
    const out = buildMentionText(m);
    expect(out).toContain("[immoJUMP-Feed — Beitrag von Wanda Website]");
    expect(out).toContain("Akquise-Sprint");
    expect(out).toContain("Wir brauchen neue Leads.");
    expect(out).toContain("[Letzte Antworten im Thread]");
    expect(out).toContain("Clara CRM: Ich kümmere mich ums CRM.");
    expect(out).toContain("Otto: Outreach steht bereit");
    expect(out).toContain("[Erwähnung an dich — darauf sollst du antworten]");
    expect(out).toContain("@rex bitte 3 Leads in München");
    expect(out).not.toContain("<p>");
  });

  it("works with only event + trigger (no thread comments)", () => {
    const m: Mention = {
      ...base,
      trigger_text: "Mach was",
      event: { id: "e1", title: null, message: "Beitragstext", user_name: "Wanda" }
    };
    const out = buildMentionText(m);
    expect(out).toContain("Beitragstext");
    expect(out).toContain("Mach was");
    expect(out).not.toContain("[Letzte Antworten im Thread]");
  });
});

describe("mentionToInboundEvent", () => {
  it("maps a mention to a normalized inbound event", () => {
    const ev = mentionToInboundEvent({
      id: "m9",
      feed_event_id: "e9",
      comment_id: "c9",
      body_html: "x",
      sender_user_id: "42",
      created_at: "2026-05-20T16:00:00Z",
      trigger_text: "Hallo",
      event: { id: "e9", title: null, message: "Post", user_name: "A" }
    });
    expect(ev.type).toBe("mention.created");
    expect(ev.feedEventId).toBe("e9");
    expect(ev.commentId).toBe("c9");
    expect(ev.senderUserId).toBe("42");
    expect(ev.createdAt).toBe("2026-05-20T16:00:00Z");
    expect(ev.text).toContain("Post");
    expect(ev.text).toContain("Hallo");
  });
});
