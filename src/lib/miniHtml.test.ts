import { describe, it, expect } from "vitest";
import { miniHtmlToTelegramHtml, miniHtmlToPlainText, parseMiniHtml } from "./miniHtml";

describe("parseMiniHtml", () => {
  it("returns an empty array for empty input", () => {
    expect(parseMiniHtml("")).toEqual([]);
  });

  it("parses plain text with no tags", () => {
    expect(parseMiniHtml("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("parses a single mark", () => {
    expect(parseMiniHtml("<b>hi</b>")).toEqual([
      { type: "mark", mark: "b", children: [{ type: "text", text: "hi" }] },
    ]);
  });

  it("maps strong/em to b/i", () => {
    expect(parseMiniHtml("<strong>x</strong>")).toEqual([
      { type: "mark", mark: "b", children: [{ type: "text", text: "x" }] },
    ]);
    expect(parseMiniHtml("<em>x</em>")).toEqual([
      { type: "mark", mark: "i", children: [{ type: "text", text: "x" }] },
    ]);
  });

  it("unwraps span without adding a node", () => {
    expect(parseMiniHtml("<span>x</span>")).toEqual([{ type: "text", text: "x" }]);
  });

  it("handles nested marks", () => {
    expect(parseMiniHtml("<b><i>x</i></b>")).toEqual([
      {
        type: "mark", mark: "b",
        children: [{ type: "mark", mark: "i", children: [{ type: "text", text: "x" }] }],
      },
    ]);
  });

  it("converts <br> to a break", () => {
    expect(parseMiniHtml("a<br>b")).toEqual([
      { type: "text", text: "a" },
      { type: "break" },
      { type: "text", text: "b" },
    ]);
  });

  it("inserts a paragraph gap between consecutive <p> blocks but not before the first", () => {
    const nodes = parseMiniHtml("<p>one</p><p>two</p>");
    expect(nodes).toEqual([
      { type: "text", text: "one" },
      { type: "break" },
      { type: "break" },
      { type: "text", text: "two" },
    ]);
  });

  it("decodes HTML entities in text", () => {
    expect(parseMiniHtml("a &lt; b &amp; c &gt; d")).toEqual([
      { type: "text", text: "a < b & c > d" },
    ]);
  });

  it("ignores unknown/unwhitelisted tags without crashing", () => {
    expect(parseMiniHtml("<script>evil</script>ok")).toEqual([
      { type: "text", text: "evil" },
      { type: "text", text: "ok" },
    ]);
  });
});

describe("miniHtmlToTelegramHtml", () => {
  it("renders marks as Telegram-safe tags", () => {
    expect(miniHtmlToTelegramHtml("<b>bold</b> <i>italic</i>")).toBe("<b>bold</b> <i>italic</i>");
  });

  it("converts strong/em to b/i", () => {
    expect(miniHtmlToTelegramHtml("<strong>x</strong> <em>y</em>")).toBe("<b>x</b> <i>y</i>");
  });

  it("escapes raw text that isn't part of the tag whitelist", () => {
    // Text nodes are already entity-decoded by parseMiniHtml, then re-escaped here —
    // regression guard: must not come out double-escaped or unescaped.
    expect(miniHtmlToTelegramHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("converts <p> paragraphs and <br> to newlines", () => {
    expect(miniHtmlToTelegramHtml("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
    expect(miniHtmlToTelegramHtml("a<br>b")).toBe("a\nb");
  });

  it("returns an empty string for empty input", () => {
    expect(miniHtmlToTelegramHtml("")).toBe("");
  });
});

describe("miniHtmlToPlainText", () => {
  it("strips marks, keeps text", () => {
    expect(miniHtmlToPlainText("<b>bold</b> plain")).toBe("bold plain");
  });

  it("keeps paragraph/line breaks as newlines", () => {
    expect(miniHtmlToPlainText("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
  });
});
