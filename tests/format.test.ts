import { describe, expect, it } from "vitest";
import {
  EMPTY_REPLY_FALLBACK,
  THINKING_PLACEHOLDER,
  formatReplyUpdate,
  markdownToHtml
} from "../src/format.js";

describe("formatReplyUpdate", () => {
  it("replaces the placeholder on first tool stage", () => {
    const out = formatReplyUpdate(
      "tool",
      { toolName: "get_contact", toolStatus: "started" },
      THINKING_PLACEHOLDER
    );
    expect(out).toContain("get_contact");
    expect(out).not.toContain(THINKING_PLACEHOLDER);
  });

  it("appends successive tool stages", () => {
    const after1 = formatReplyUpdate(
      "tool",
      { toolName: "get_contact", toolStatus: "succeeded" },
      THINKING_PLACEHOLDER
    );
    const after2 = formatReplyUpdate(
      "tool",
      { toolName: "post_comment", toolStatus: "started" },
      after1
    );
    expect(after2.split("\n")).toHaveLength(2);
  });

  it("returns fallback for empty final text", () => {
    expect(formatReplyUpdate("final", { text: "" }, "anything")).toBe(EMPTY_REPLY_FALLBACK);
    expect(formatReplyUpdate("final", { text: "   " }, "anything")).toBe(EMPTY_REPLY_FALLBACK);
  });

  it("converts agent markdown to HTML on final", () => {
    // Plain text gets wrapped in <p> by Marked — that's fine, immoJUMP
    // renders <p> blocks natively.
    const out = formatReplyUpdate("final", { text: "Hello, world." }, "prev");
    expect(out).toBe("<p>Hello, world.</p>");
  });

  it("renders **bold** as <strong> on final", () => {
    const out = formatReplyUpdate("final", { text: "Take **Region** and go." }, THINKING_PLACEHOLDER);
    expect(out).toContain("<strong>Region</strong>");
    expect(out).not.toContain("**");
  });

  it("renders bullet lists as <ul><li> on final", () => {
    const out = formatReplyUpdate(
      "final",
      { text: "Optionen:\n- alpha\n- beta\n- gamma" },
      THINKING_PLACEHOLDER
    );
    expect(out).toMatch(/<ul>.*<li>alpha<\/li>.*<\/ul>/s);
    expect(out).not.toMatch(/^- /m);
  });

  it("preserves the placeholder when block payload has no text", () => {
    const out = formatReplyUpdate("block", { text: "" }, THINKING_PLACEHOLDER);
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
