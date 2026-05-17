import { describe, expect, it } from "vitest";
import { EMPTY_REPLY_FALLBACK, THINKING_PLACEHOLDER, formatReplyUpdate } from "../src/format.js";

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

  it("uses final text verbatim when non-empty", () => {
    expect(formatReplyUpdate("final", { text: "Hello, world." }, "prev")).toBe("Hello, world.");
  });
});
