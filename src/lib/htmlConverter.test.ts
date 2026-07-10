import { describe, it, expect } from "vitest";
import {
  tiptapToTelegramHtml,
  tiptapToPlainText,
  segmentDocument,
  splitJsonAtGaps,
  splitIntoMessagesAtGaps,
  type TextSegment,
} from "./htmlConverter";

// Helpers to build TipTap JSON compactly
const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const para = (...children: unknown[]) => ({ type: "paragraph", content: children });
const text = (t: string, marks?: unknown[]) =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t };
const mark = (type: string, attrs?: unknown) => (attrs ? { type, attrs } : { type });

describe("tiptapToTelegramHtml", () => {
  it("returns empty string for invalid JSON", () => {
    expect(tiptapToTelegramHtml("not json")).toBe("");
  });

  it("renders a plain paragraph", () => {
    expect(tiptapToTelegramHtml(doc(para(text("Hello"))))).toBe("Hello");
  });

  it("applies bold and italic marks", () => {
    const out = tiptapToTelegramHtml(doc(para(text("Hi", [mark("bold")]))));
    expect(out).toBe("<b>Hi</b>");
    const it2 = tiptapToTelegramHtml(doc(para(text("Hi", [mark("italic")]))));
    expect(it2).toBe("<i>Hi</i>");
  });

  it("drops subscript/superscript/highlight marks — Telegram's regular sendMessage HTML doesn't support <sub>/<sup>/<mark>, only Rich Messages do", () => {
    expect(tiptapToTelegramHtml(doc(para(text("Hi", [mark("subscript")]))))).toBe("Hi");
    expect(tiptapToTelegramHtml(doc(para(text("Hi", [mark("superscript")]))))).toBe("Hi");
    expect(tiptapToTelegramHtml(doc(para(text("Hi", [mark("highlight")]))))).toBe("Hi");
  });

  it("escapes HTML-significant characters", () => {
    expect(tiptapToTelegramHtml(doc(para(text("a < b & c > d"))))).toBe(
      "a &lt; b &amp; c &gt; d",
    );
  });

  it("only allows http(s) links", () => {
    const good = tiptapToTelegramHtml(
      doc(para(text("x", [mark("link", { href: "https://a.com" })]))),
    );
    expect(good).toBe('<a href="https://a.com">x</a>');

    const bad = tiptapToTelegramHtml(
      doc(para(text("x", [mark("link", { href: "javascript:alert(1)" })]))),
    );
    expect(bad).toBe("x"); // dangerous scheme dropped
  });

  it("escapes quotes in link href", () => {
    const out = tiptapToTelegramHtml(
      doc(para(text("x", [mark("link", { href: 'https://a.com/"onmouseover' })]))),
    );
    expect(out).not.toContain('"onmouseover');
    expect(out).toContain("%22");
  });

  it("renders headings as bold", () => {
    const h1 = tiptapToTelegramHtml(
      doc({ type: "heading", attrs: { level: 1 }, content: [text("Title")] }),
    );
    expect(h1).toBe("<b>Title</b>");
  });

  it("renders blockFaq (spoiler) as an expandable blockquote", () => {
    const out = tiptapToTelegramHtml(
      doc({ type: "blockFaq", attrs: { question: "Q", answer: "plain answer" } }),
    );
    expect(out).toBe("<blockquote expandable>Q\nplain answer</blockquote>");
  });

  it("converts blockFaq's rich-text answer markup instead of escaping it", () => {
    // Regression: the answer is sanitized mini-HTML from a contentEditable
    // body, not plain text — it must come out as real <b> tags, not &lt;b&gt;.
    const out = tiptapToTelegramHtml(
      doc({ type: "blockFaq", attrs: { question: "Q", answer: "<b>bold</b> and <i>italic</i>" } }),
    );
    expect(out).toContain("<b>bold</b> and <i>italic</i>");
    expect(out).not.toContain("&lt;b&gt;");
  });

  it("skips blockFaq entirely when both question and answer are empty", () => {
    expect(tiptapToTelegramHtml(doc({ type: "blockFaq", attrs: { question: "", answer: "" } }))).toBe("");
  });

  it("renders a code block with language class", () => {
    const out = tiptapToTelegramHtml(
      doc({ type: "codeBlock", attrs: { language: "rust" }, content: [text("fn main(){}")] }),
    );
    expect(out).toContain('<pre><code class="language-rust">');
    expect(out).toContain("fn main(){}");
  });

  it("renders an unchecked checkItem with an empty box", () => {
    const out = tiptapToTelegramHtml(doc({ type: "checkItem", attrs: { checked: false }, content: [text("Buy milk")] }));
    expect(out).toBe("☐ Buy milk");
  });

  it("renders a checked checkItem with a filled box", () => {
    const out = tiptapToTelegramHtml(doc({ type: "checkItem", attrs: { checked: true }, content: [text("Done")] }));
    expect(out).toBe("☑ Done");
  });

  it("renders a callout as an emoji-prefixed blockquote", () => {
    const out = tiptapToTelegramHtml(
      doc({ type: "callout", attrs: { emoji: "💡" }, content: [para(text("Heads up"))] }),
    );
    expect(out).toBe("<blockquote>💡 Heads up</blockquote>");
  });

  it("drops anchorPoint — anchors only work in Rich messages, not regular HTML", () => {
    const out = tiptapToTelegramHtml(doc({ type: "anchorPoint" }, para(text("hi"))));
    expect(out).not.toContain("name=");
    expect(out).toContain("hi");
  });
});

describe("tiptapToPlainText", () => {
  it("extracts plain text without markup", () => {
    const out = tiptapToPlainText(doc(para(text("Bold", [mark("bold")]))));
    expect(out).toBe("Bold");
  });

  it("joins paragraphs with blank lines", () => {
    const out = tiptapToPlainText(doc(para(text("a")), para(text("b"))));
    expect(out).toContain("a");
    expect(out).toContain("b");
  });
});

describe("segmentDocument", () => {
  it("returns a single text segment for text-only content", () => {
    const segs = segmentDocument(doc(para(text("hello"))));
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
  });

  it("splits text and media into separate segments", () => {
    const segs = segmentDocument(
      doc(
        para(text("before")),
        { type: "blockImage", attrs: { fileId: "f1", src: "blob:x" } },
        para(text("after")),
      ),
    );
    expect(segs.map((s) => s.type)).toEqual(["text", "image", "text"]);
  });

  it("prepends the post title to the first text segment", () => {
    const segs = segmentDocument(doc(para(text("body"))), "My Title");
    const first = segs[0] as TextSegment;
    expect(first.html).toContain('data-post-title="1"');
    expect(first.html).toContain("My Title");
  });

  it("escapes the post title", () => {
    const segs = segmentDocument(doc(para(text("body"))), "a & <b>");
    const first = segs[0] as TextSegment;
    expect(first.html).toContain("a &amp; &lt;b&gt;");
  });
});

describe("splitJsonAtGaps", () => {
  const threeBlocks = doc(para(text("A")), para(text("B")), para(text("C")));

  it("returns the whole doc unchanged when there are no gaps", () => {
    const out = splitJsonAtGaps(threeBlocks, []);
    expect(out).toHaveLength(1);
  });

  it("splits into two chunks at a single gap", () => {
    const out = splitJsonAtGaps(threeBlocks, [1]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('"A"');
    expect(out[1]).toContain('"B"');
    expect(out[1]).toContain('"C"');
  });

  it("splits into three chunks at two gaps", () => {
    const out = splitJsonAtGaps(threeBlocks, [1, 2]);
    expect(out).toHaveLength(3);
  });

  it("ignores gaps at the document boundaries", () => {
    expect(splitJsonAtGaps(threeBlocks, [0, 3])).toHaveLength(1);
  });

  it("de-duplicates repeated gap indices", () => {
    expect(splitJsonAtGaps(threeBlocks, [1, 1, 1])).toHaveLength(2);
  });
});

describe("splitIntoMessagesAtGaps", () => {
  const twoBlocks = doc(para(text("first")), para(text("second")));

  it("produces one message group per chunk", () => {
    const msgs = splitIntoMessagesAtGaps(twoBlocks, [1]);
    expect(msgs).toHaveLength(2);
    expect((msgs[0][0] as TextSegment).html).toContain("first");
    expect((msgs[1][0] as TextSegment).html).toContain("second");
  });

  it("adds the title only to the first message", () => {
    const msgs = splitIntoMessagesAtGaps(twoBlocks, [1], "T");
    expect((msgs[0][0] as TextSegment).html).toContain("data-post-title");
    expect((msgs[1][0] as TextSegment).html).not.toContain("data-post-title");
  });
});
