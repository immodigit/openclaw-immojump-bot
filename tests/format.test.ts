import { describe, expect, it } from "vitest";
import {
  EMPTY_REPLY_FALLBACK,
  THINKING_PLACEHOLDER,
  TOOL_PROGRESS_HEADER,
  type ReplyRenderState,
  formatReplyUpdate,
  markdownToHtml
} from "../src/format.js";

function freshState(): ReplyRenderState {
  return { previous: THINKING_PLACEHOLDER, progressLines: [] };
}

describe("formatReplyUpdate", () => {
  it("replaces the placeholder with a tool-progress view on the first tool stage", () => {
    const state = freshState();
    const out = formatReplyUpdate("tool", { text: "🔎 Web Search: immobilien" }, state);
    expect(out).toContain(TOOL_PROGRESS_HEADER);
    expect(out).toContain("Web Search");
    expect(out).not.toContain(THINKING_PLACEHOLDER);
  });

  it("falls back to a generic line for a tool delivery without text", () => {
    const state = freshState();
    const out = formatReplyUpdate("tool", {}, state);
    expect(out).toContain(TOOL_PROGRESS_HEADER);
    expect(out).toContain("Arbeitsschritt läuft");
  });

  it("accumulates successive tool stages as separate lines", () => {
    const state = freshState();
    formatReplyUpdate("tool", { text: "📖 get_contact" }, state);
    const out = formatReplyUpdate("tool", { text: "✍️ post_comment" }, state);
    expect(state.progressLines).toEqual(["📖 get_contact", "✍️ post_comment"]);
    expect(out).toContain("get_contact");
    expect(out).toContain("post_comment");
  });

  it("skips consecutive duplicate tool lines", () => {
    const state = freshState();
    formatReplyUpdate("tool", { text: "📖 get_contact" }, state);
    formatReplyUpdate("tool", { text: "📖 get_contact" }, state);
    expect(state.progressLines).toEqual(["📖 get_contact"]);
  });

  it("caps the tool-progress list so it stays compact", () => {
    const state = freshState();
    for (let i = 0; i < 12; i++) {
      formatReplyUpdate("tool", { text: `step ${i}` }, state);
    }
    expect(state.progressLines).toHaveLength(6);
    expect(state.progressLines[0]).toBe("step 6");
    expect(state.progressLines[5]).toBe("step 11");
  });

  it("escapes HTML in tool lines", () => {
    const state = freshState();
    const out = formatReplyUpdate("tool", { text: "read <config>.ts" }, state);
    expect(out).toContain("&lt;config&gt;");
    expect(out).not.toContain("<config>");
  });

  it("returns fallback for empty final text", () => {
    expect(formatReplyUpdate("final", { text: "" }, freshState())).toBe(EMPTY_REPLY_FALLBACK);
    expect(formatReplyUpdate("final", { text: "   " }, freshState())).toBe(EMPTY_REPLY_FALLBACK);
  });

  it("converts agent markdown to HTML on final", () => {
    // Plain text gets wrapped in <p> by Marked — that's fine, immoJUMP
    // renders <p> blocks natively.
    const out = formatReplyUpdate("final", { text: "Hello, world." }, freshState());
    expect(out).toBe("<p>Hello, world.</p>");
  });

  it("renders **bold** as <strong> on final", () => {
    const out = formatReplyUpdate("final", { text: "Take **Region** and go." }, freshState());
    expect(out).toContain("<strong>Region</strong>");
    expect(out).not.toContain("**");
  });

  it("renders bullet lists as <ul><li> on final", () => {
    const out = formatReplyUpdate(
      "final",
      { text: "Optionen:\n- alpha\n- beta\n- gamma" },
      freshState()
    );
    expect(out).toMatch(/<ul>.*<li>alpha<\/li>.*<\/ul>/s);
    expect(out).not.toMatch(/^- /m);
  });

  it("drops the tool-progress scaffold once the final answer arrives", () => {
    const state = freshState();
    state.previous = formatReplyUpdate("tool", { text: "🔎 Suche" }, state);
    const out = formatReplyUpdate("final", { text: "Fertige Antwort." }, state);
    expect(out).toBe("<p>Fertige Antwort.</p>");
    expect(out).not.toContain(TOOL_PROGRESS_HEADER);
  });

  it("preserves the placeholder when block payload has no text", () => {
    const out = formatReplyUpdate("block", { text: "" }, freshState());
    expect(out).toBe(THINKING_PLACEHOLDER);
  });
});

describe("markdownToHtml", () => {
  it("returns empty string for empty input", () => {
    expect(markdownToHtml("")).toBe("");
  });

  it("converts bold + italic", () => {
    const out = markdownToHtml("**bold** and *italic*");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
  });

  it("converts a fenced code block", () => {
    const out = markdownToHtml("```json\n{\"a\":1}\n```");
    expect(out).toContain("<pre>");
    expect(out).toContain("<code");
    expect(out).toContain("{&quot;a&quot;:1}");
  });

  it("turns single newlines into <br> (breaks: true)", () => {
    const out = markdownToHtml("line one\nline two");
    expect(out).toMatch(/line one<br\s*\/?>/);
  });
});
