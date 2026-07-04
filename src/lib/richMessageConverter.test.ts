import { describe, it, expect } from "vitest";
import { tiptapToRichBlocks, tiptapToRichHtml } from "./richMessageConverter";

const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const para = (...children: unknown[]) => ({ type: "paragraph", content: children });
const text = (t: string, marks?: unknown[]) =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t };

describe("tiptapToRichBlocks", () => {
  it("returns empty blocks for invalid JSON", () => {
    expect(tiptapToRichBlocks("nope")).toEqual({ blocksJson: "[]", photos: [] });
  });

  it("converts a paragraph to a paragraph block", () => {
    const { blocksJson } = tiptapToRichBlocks(doc(para(text("hello"))));
    const blocks = JSON.parse(blocksJson);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("drops empty paragraphs", () => {
    const { blocksJson } = tiptapToRichBlocks(doc(para(text("   "))));
    expect(JSON.parse(blocksJson)).toEqual([]);
  });

  it("prepends the title as a heading", () => {
    const { blocksJson } = tiptapToRichBlocks(doc(para(text("body"))), "Title");
    const blocks = JSON.parse(blocksJson);
    expect(blocks[0].type).toBe("section_heading");
  });

  it("collects photos as attach:// placeholders", () => {
    const { blocksJson, photos } = tiptapToRichBlocks(
      doc({ type: "blockImage", attrs: { fileId: "f1", fileName: "a.png", mimeType: "image/png" } }),
    );
    expect(photos).toHaveLength(1);
    expect(photos[0].fileId).toBe("f1");
    const blocks = JSON.parse(blocksJson);
    expect(blocks[0].photo).toBe(`attach://${photos[0].attachName}`);
  });
});

describe("tiptapToRichHtml", () => {
  it("wraps paragraphs in <p> tags", () => {
    const { html } = tiptapToRichHtml(doc(para(text("hi"))));
    expect(html).toBe("<p>hi</p>");
  });

  it("escapes HTML-significant characters in text (regression: escapeHtml was a no-op)", () => {
    const { html } = tiptapToRichHtml(doc(para(text("a < b & c > d"))));
    expect(html).toContain("a &lt; b &amp; c &gt; d");
    expect(html).not.toContain("a < b & c > d");
  });

  it("escapes the title", () => {
    const { html } = tiptapToRichHtml(doc(para(text("x"))), "T & <script>");
    expect(html).toContain("<h2>T &amp; &lt;script&gt;</h2>");
  });

  it("renders images as attach placeholders and records photos", () => {
    const { html, photos } = tiptapToRichHtml(
      doc({ type: "blockImage", attrs: { fileId: "f9", fileName: "p.jpg", mimeType: "image/jpeg" } }),
    );
    expect(photos).toHaveLength(1);
    expect(html).toContain(`<img src="attach://${photos[0].attachName}"/>`);
  });

  it("renders bullet lists", () => {
    const { html } = tiptapToRichHtml(
      doc({
        type: "bulletList",
        content: [{ type: "listItem", content: [para(text("one"))] }],
      }),
    );
    expect(html).toBe("<ul><li>one</li></ul>");
  });
});
