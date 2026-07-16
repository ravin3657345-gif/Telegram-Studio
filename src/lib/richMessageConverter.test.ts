import { describe, it, expect } from "vitest";
import { tiptapToRichHtml } from "./richMessageConverter";

const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const para = (...children: unknown[]) => ({ type: "paragraph", content: children });
const text = (t: string, marks?: unknown[]) =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t };
const mark = (type: string) => ({ type });

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

  it("renders images as tg://photo?id= references and records photos", () => {
    const { html, photos } = tiptapToRichHtml(
      doc({ type: "blockImage", attrs: { fileId: "f9", fileName: "p.jpg", mimeType: "image/jpeg" } }),
    );
    expect(photos).toHaveLength(1);
    expect(html).toContain(`<img src="tg://photo?id=${photos[0].attachName}"/>`);
  });

  it("renders subscript/superscript/highlight as <sub>/<sup>/<mark> — confirmed supported by the Rich HTML style docs, unlike regular sendMessage", () => {
    expect(tiptapToRichHtml(doc(para(text("Hi", [mark("subscript")])))).html).toContain("<sub>Hi</sub>");
    expect(tiptapToRichHtml(doc(para(text("Hi", [mark("superscript")])))).html).toContain("<sup>Hi</sup>");
    expect(tiptapToRichHtml(doc(para(text("Hi", [mark("highlight")])))).html).toContain("<mark>Hi</mark>");
  });

  it("wraps 2+ adjacent images/videos in a <tg-collage>, using the confirmed-working <img>/<video src> tags inside", () => {
    const { html, photos } = tiptapToRichHtml(
      doc(
        { type: "blockImage", attrs: { fileId: "a", fileName: "a.jpg", mimeType: "image/jpeg" } },
        { type: "blockImage", attrs: { fileId: "b", fileName: "b.jpg", mimeType: "image/jpeg" } },
        { type: "blockVideo", attrs: { fileId: "c", fileName: "c.mp4", mimeType: "video/mp4" } },
      ),
    );
    expect(photos).toHaveLength(3);
    expect(html).toBe(
      `<tg-collage><img src="tg://photo?id=${photos[0].attachName}"/>` +
      `<img src="tg://photo?id=${photos[1].attachName}"/>` +
      `<video src="tg://video?id=${photos[2].attachName}"/></tg-collage>`,
    );
  });

  it("wraps a run in <tg-slideshow> when the group's layout is set to slideshow", () => {
    const { html, photos } = tiptapToRichHtml(
      doc(
        { type: "blockImage", attrs: { fileId: "a", fileName: "a.jpg", mimeType: "image/jpeg", groupLayout: "slideshow" } },
        { type: "blockImage", attrs: { fileId: "b", fileName: "b.jpg", mimeType: "image/jpeg", groupLayout: "slideshow" } },
      ),
    );
    expect(html).toBe(
      `<tg-slideshow><img src="tg://photo?id=${photos[0].attachName}"/>` +
      `<img src="tg://photo?id=${photos[1].attachName}"/></tg-slideshow>`,
    );
  });

  it("does not wrap a lone image in <tg-collage>", () => {
    const { html } = tiptapToRichHtml(
      doc(
        { type: "blockImage", attrs: { fileId: "a", fileName: "a.jpg", mimeType: "image/jpeg" } },
        para(text("between")),
        { type: "blockImage", attrs: { fileId: "b", fileName: "b.jpg", mimeType: "image/jpeg" } },
      ),
    );
    expect(html).not.toContain("tg-collage");
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

  it("renders an unchecked checkItem as a native HTML checkbox list item", () => {
    const { html } = tiptapToRichHtml(doc({ type: "checkItem", attrs: { checked: false }, content: [text("Buy milk")] }));
    expect(html).toBe('<ul><li><input type="checkbox">Buy milk</li></ul>');
  });

  it("renders a checked checkItem with the checked attribute", () => {
    const { html } = tiptapToRichHtml(doc({ type: "checkItem", attrs: { checked: true }, content: [text("Done")] }));
    expect(html).toBe('<ul><li><input type="checkbox" checked>Done</li></ul>');
  });

  it("groups consecutive checkItems into a single <ul>", () => {
    const { html } = tiptapToRichHtml(
      doc(
        { type: "checkItem", attrs: { checked: true }, content: [text("One")] },
        { type: "checkItem", attrs: { checked: false }, content: [text("Two")] },
      ),
    );
    expect(html).toBe(
      '<ul><li><input type="checkbox" checked>One</li>' +
      '<li><input type="checkbox">Two</li></ul>',
    );
  });

  it("renders a callout as an emoji-prefixed blockquote", () => {
    const { html } = tiptapToRichHtml(
      doc({ type: "callout", attrs: { emoji: "💡" }, content: [para(text("Heads up"))] }),
    );
    expect(html).toBe("<blockquote>💡 Heads up</blockquote>");
  });

  it("renders a blockquote's paragraph content nested inside <blockquote>", () => {
    const { html } = tiptapToRichHtml(
      doc({ type: "blockquote", content: [para(text("Quoted text"))] }),
    );
    expect(html).toBe("<blockquote><p>Quoted text</p></blockquote>");
  });

  // Live-tested 2026-07-09 against the real API: a <pre><code> nested inside
  // <blockquote> comes back from Telegram as its own separate "pre" block, not
  // flattened text — so the converter must recurse into nested block content
  // instead of extracting inline text only.
  it("preserves a code block nested inside a blockquote as a real <pre><code>, not flattened text", () => {
    const { html } = tiptapToRichHtml(
      doc({
        type: "blockquote",
        content: [
          para(text("Before:")),
          { type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] },
          para(text("After.")),
        ],
      }),
    );
    expect(html).toBe(
      "<blockquote><p>Before:</p><pre><code>const x = 1;</code></pre><p>After.</p></blockquote>",
    );
  });

  // Live-tested 2026-07-09: sent <blockquote expandable> and got back a plain
  // non-collapsible blockquote from Telegram — Rich Messages don't support
  // this attribute at all (unlike regular sendMessage HTML), so the converter
  // must never emit it, regardless of the block's `expandable` attribute.
  it("never emits an 'expandable' attribute on <blockquote> (unsupported by Rich Messages)", () => {
    const { html } = tiptapToRichHtml(
      doc({ type: "blockquote", attrs: { expandable: true }, content: [para(text("Quoted"))] }),
    );
    expect(html).not.toContain("expandable");
    expect(html).toBe("<blockquote><p>Quoted</p></blockquote>");
  });

  it("converts a blockFaq answer's mini-HTML markup into real Rich HTML tags, not escaped literal text", () => {
    // Regression: the answer used to go through escapeHtml(), turning
    // "<b>bold</b>" into the literal text "&lt;b&gt;bold&lt;/b&gt;" instead of
    // real bold formatting.
    const { html } = tiptapToRichHtml(
      doc({ type: "blockFaq", attrs: { question: "Q", answer: "<b>bold</b> plain" } }),
    );
    expect(html).toBe("<details><summary>Q</summary><b>bold</b> plain</details>");
  });

  it("renders an anchorPoint as an invisible named anchor", () => {
    const { html } = tiptapToRichHtml(doc({ type: "anchorPoint" }));
    expect(html).toBe('<a name="top"></a>');
  });

  it("puts a leading anchorPoint BEFORE the title, not after (regression: 'Лифт' jumped past the title instead of to it)", () => {
    const { html } = tiptapToRichHtml(
      doc({ type: "anchorPoint" }, para(text("body"))),
      "My Title",
    );
    expect(html).toBe('<a name="top"></a><h2>My Title</h2><p>body</p>');
  });

  it("renders a link with a #top href unchanged, for jump-to-anchor links", () => {
    const { html } = tiptapToRichHtml(
      doc(para(text("👆 Лифт", [{ type: "link", attrs: { href: "#top" } }]))),
    );
    expect(html).toBe('<p><a href="#top">👆 Лифт</a></p>');
  });

  it("renders a blockTable as <table> with <th> header row and <td> body rows", () => {
    const { html } = tiptapToRichHtml(
      doc({
        type: "blockTable",
        content: [
          { type: "tableRow", content: [
            { type: "tableCell", attrs: { header: true }, content: [text("A")] },
            { type: "tableCell", attrs: { header: true }, content: [text("B")] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", attrs: { header: false }, content: [text("1")] },
            { type: "tableCell", attrs: { header: false }, content: [text("2")] },
          ] },
        ],
      }),
    );
    expect(html).toBe("<table bordered><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>");
  });

  it("renders a blockMap as <tg-map lat long zoom>", () => {
    const { html } = tiptapToRichHtml(
      doc({ type: "blockMap", attrs: { lat: 55.7558, long: 37.6173, zoom: 15 } }),
    );
    expect(html).toBe('<tg-map lat="55.7558" long="37.6173" zoom="15"></tg-map>');
  });

  it("renders a blockFormula as <tg-math-block>, escaping < and >", () => {
    const { html } = tiptapToRichHtml(
      doc({ type: "blockFormula", attrs: { expression: "a < b \\frac{n}{2}" } }),
    );
    expect(html).toBe("<tg-math-block>a &lt; b \\frac{n}{2}</tg-math-block>");
  });

  it("omits an empty blockFormula entirely", () => {
    const { html } = tiptapToRichHtml(
      doc({ type: "blockFormula", attrs: { expression: "   " } }),
    );
    expect(html).toBe("");
  });
});
