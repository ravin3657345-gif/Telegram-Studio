// Converts TipTap JSON document to Telegram HTML for real-time preview.
import { miniHtmlToTelegramHtml } from "./miniHtml";

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  text?: string;
  marks?: TiptapMark[];
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
}

export function tiptapToTelegramHtml(json: string): string {
  let doc: TiptapNode;
  try {
    doc = JSON.parse(json) as TiptapNode;
  } catch {
    return "";
  }

  if (!doc.content) return "";

  return doc.content
    .map((node) => renderNode(node))
    .join("")
    .trimEnd();
}

function renderNode(node: TiptapNode): string {
  switch (node.type) {
    case "paragraph":
      return renderInline(node) + "\n\n";

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const text = renderInline(node);
      // H1/H2 → bold, H3 → italic bold
      if (level <= 2) return `<b>${text}</b>\n\n`;
      return `<b><i>${text}</i></b>\n\n`;
    }

    case "blockquote": {
      const inner = (node.content ?? []).map(renderNode).join("").trimEnd();
      const tag = node.attrs?.expandable ? "blockquote expandable" : "blockquote";
      return `<${tag}>${inner}</${tag.split(" ")[0]}>\n\n`;
    }

    case "codeBlock": {
      const code = extractText(node);
      const lang = (node.attrs?.language as string | undefined) ?? "";
      return `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>\n\n`;
    }

    case "horizontalRule":
      return "─────────────\n\n";

    case "bulletList": {
      const items = (node.content ?? [])
        .map((li) => "• " + renderListItem(li).trim())
        .join("\n");
      return items + "\n\n";
    }

    case "orderedList": {
      const items = (node.content ?? [])
        .map((li, i) => `${i + 1}. ` + renderListItem(li).trim())
        .join("\n");
      return items + "\n\n";
    }

    case "hardBreak":
      return "\n";

    case "checkItem": {
      const checked = !!node.attrs?.checked;
      const box = checked ? "☑" : "☐";
      return `${box} ${renderInline(node)}\n`;
    }

    case "callout": {
      const emoji = (node.attrs?.emoji as string) || "💡";
      const inner = (node.content ?? []).map(renderNode).join("").trimEnd();
      return `<blockquote>${emoji} ${inner}</blockquote>\n\n`;
    }

    case "blockFaq": {
      const q = escapeHtml((node.attrs?.question as string) ?? "");
      // The answer is sanitized mini-HTML (bold/italic/underline/strike + paragraphs)
      // from the spoiler body editor, not plain text — convert its markup rather
      // than escaping it wholesale (which would show literal <b> tags to users).
      const a = miniHtmlToTelegramHtml((node.attrs?.answer as string) ?? "");
      if (!q && !a) return "";
      const body = a ? `${q}\n${a}` : q;
      return `<blockquote expandable>${body}</blockquote>\n\n`;
    }

    // Block media nodes — skipped in text conversion (handled separately in publishing)
    case "blockImage":
    case "blockVideo":
    case "blockPoll":
    case "messageSplit":
      return "";

    // Tables, audio, maps and formulas are Rich-mode only (Bot API 10.1) —
    // publish is blocked outside Rich mode while any of these exist in the
    // post (see PublishPanel.tsx), but no-op here too as a safety net rather
    // than falling through to renderInline, which would garble things (a
    // table's cell text into a run-on string; none of the others have any
    // meaningful plain-text form at all).
    case "blockTable":
    case "blockAudio":
    case "blockMap":
    case "blockFormula":
      return "";

    // Anchors only work in Rich messages (Bot API 10.1) — no-op elsewhere.
    case "anchorPoint":
      return "";

    default:
      return renderInline(node);
  }
}

function renderListItem(node: TiptapNode): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type === "paragraph") return renderInline(child);
      return renderNode(child);
    })
    .join("")
    .trimEnd();
}

function renderInline(node: TiptapNode): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type === "hardBreak") return "\n";
      if (child.type === "text") return applyMarks(child.text ?? "", child.marks ?? []);
      return renderInline(child);
    })
    .join("");
}

function applyMarks(text: string, marks: TiptapMark[]): string {
  let result = escapeHtml(text);

  for (const mark of [...marks].reverse()) {
    switch (mark.type) {
      case "bold":
        result = `<b>${result}</b>`;
        break;
      case "italic":
        result = `<i>${result}</i>`;
        break;
      case "underline":
        result = `<u>${result}</u>`;
        break;
      case "strike":
        result = `<s>${result}</s>`;
        break;
      case "code":
        result = `<code>${result}</code>`;
        break;
      case "spoiler":
        result = `<tg-spoiler>${result}</tg-spoiler>`;
        break;
      // subscript/superscript/highlight have no equivalent in Telegram's
      // regular sendMessage HTML — only Rich Messages support <sub>/<sup>/
      // <mark> (confirmed against the official "Formatting options" section,
      // which lists the tags supported here and doesn't include them; sending
      // an unsupported tag makes Telegram reject the whole message). Drop the
      // mark and keep the plain text, same graceful-degradation the
      // Telegraph converter already does for marks it can't represent.
      case "link": {
        const href = mark.attrs?.href as string | undefined;
        if (href && /^https?:\/\//i.test(href)) {
          result = `<a href="${href.replace(/"/g, "%22")}">${result}</a>`;
        }
        break;
      }
    }
  }

  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Block segmenting (for multi-message publishing and preview) ──────────────

export type TextSegment     = { type: "text";     html: string };
export type ImageSegment    = { type: "image";    fileId: string; fileName: string; mimeType: string; src: string };
export type VideoSegment    = { type: "video";    fileId: string; fileName: string; mimeType: string; src: string };
export type FileSegment     = { type: "file";     fileId: string; fileName: string; mimeType: string; fileSize: number };
export type PollSegment     = { type: "poll";     question: string; options: string[]; isAnonymous: boolean; allowsMultipleAnswers: boolean };
export type ContentSegment  = TextSegment | ImageSegment | VideoSegment | FileSegment | PollSegment;

/**
 * Splits a TipTap document into content segments.
 * Text runs are merged; each image/video becomes its own segment.
 * @param postTitle If set, prepended as bold to the first text segment.
 */
export function segmentDocument(json: string, postTitle = ""): ContentSegment[] {
  let doc: TiptapNode;
  try { doc = JSON.parse(json) as TiptapNode; }
  catch { return []; }

  const segments: ContentSegment[] = [];
  let textNodes: TiptapNode[] = [];

  function flushText() {
    if (textNodes.length === 0) return;
    const partial = { type: "doc" as const, content: textNodes };
    const html = tiptapToTelegramHtml(JSON.stringify(partial));
    if (html.trim()) segments.push({ type: "text", html });
    textNodes = [];
  }

  for (const node of doc.content ?? []) {
    if (node.type === "blockImage") {
      flushText();
      segments.push({
        type: "image",
        fileId:   node.attrs?.fileId   as string ?? "",
        fileName: node.attrs?.fileName as string ?? "image.jpg",
        mimeType: node.attrs?.mimeType as string ?? "image/jpeg",
        src:      node.attrs?.src      as string ?? "",
      });
    } else if (node.type === "blockVideo") {
      flushText();
      segments.push({
        type: "video",
        fileId:   node.attrs?.fileId   as string ?? "",
        fileName: node.attrs?.fileName as string ?? "video.mp4",
        mimeType: node.attrs?.mimeType as string ?? "video/mp4",
        src:      node.attrs?.src      as string ?? "",
      });
    } else if (node.type === "blockDocument") {
      flushText();
      segments.push({
        type:     "file",
        fileId:   node.attrs?.fileId   as string ?? "",
        fileName: node.attrs?.fileName as string ?? "document",
        mimeType: (node.attrs?.mimeType as string || "application/octet-stream"),
        fileSize: node.attrs?.fileSize as number ?? 0,
      });
    } else if (node.type === "blockPoll") {
      flushText();
      const opts = node.attrs?.options;
      segments.push({
        type:                 "poll",
        question:             (node.attrs?.question as string) ?? "",
        options:              (Array.isArray(opts) ? opts : []) as string[],
        isAnonymous:          (node.attrs?.isAnonymous as boolean) ?? true,
        allowsMultipleAnswers:(node.attrs?.allowsMultipleAnswers as boolean) ?? false,
      });
    } else {
      textNodes.push(node);
    }
  }
  flushText();

  // Prepend title to first text segment (or create one if none)
  if (postTitle.trim()) {
    const esc = postTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // <b> is the only heading-style supported by sendMessage HTML;
    // data-post-title is stripped by Telegram but used by our preview CSS
    const titleHtml = `<b data-post-title="1">${esc}</b>`;
    const firstText = segments.find((s): s is TextSegment => s.type === "text");
    if (firstText) {
      firstText.html = titleHtml + "\n\n" + firstText.html;
    } else {
      segments.unshift({ type: "text", html: titleHtml });
    }
  }

  return segments;
}

// ─── Split TipTap JSON at messageSplit nodes ─────────────────────────────────

/** Returns one JSON string per message (split at messageSplit nodes). */
export function splitJsonByMessageSplits(json: string): string[] {
  let doc: TiptapNode;
  try { doc = JSON.parse(json) as TiptapNode; }
  catch { return [json]; }

  const groups: TiptapNode[][] = [[]];
  for (const node of doc.content ?? []) {
    if (node.type === "messageSplit") {
      groups.push([]);
    } else {
      groups[groups.length - 1].push(node);
    }
  }

  return groups
    .filter((g) => g.length > 0)
    .map((nodes) => JSON.stringify({ type: "doc", content: nodes }));
}

// ─── Split into messages at messageSplit nodes ───────────────────────────────

/**
 * Splits the document at messageSplit nodes and returns an array of segment
 * groups — one group per Telegram message. Each group is the same
 * ContentSegment[] you would get from segmentDocument for that chunk of content.
 */
export function splitIntoMessages(json: string, postTitle = ""): ContentSegment[][] {
  let doc: TiptapNode;
  try { doc = JSON.parse(json) as TiptapNode; }
  catch { return [[]]; }

  // Partition top-level nodes into groups separated by messageSplit nodes
  const groups: TiptapNode[][] = [[]];
  for (const node of doc.content ?? []) {
    if (node.type === "messageSplit") {
      groups.push([]);
    } else {
      groups[groups.length - 1].push(node);
    }
  }

  // Convert each group into segments using the same logic as segmentDocument
  const messages: ContentSegment[][] = groups
    .filter((g) => g.length > 0)
    .map((nodes) => buildSegments(nodes));

  if (messages.length === 0) return [[]];

  // Prepend title to the first message (same logic as segmentDocument)
  if (postTitle.trim()) {
    const esc = postTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const titleHtml = `<b data-post-title="1">${esc}</b>`;
    const firstText = messages[0].find((s): s is TextSegment => s.type === "text");
    if (firstText) {
      firstText.html = titleHtml + "\n\n" + firstText.html;
    } else {
      messages[0].unshift({ type: "text", html: titleHtml });
    }
  }

  return messages;
}

function buildSegments(nodes: TiptapNode[]): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let textNodes: TiptapNode[] = [];

  function flushText() {
    if (textNodes.length === 0) return;
    const partial = { type: "doc" as const, content: textNodes };
    const html = tiptapToTelegramHtml(JSON.stringify(partial));
    if (html.trim()) segments.push({ type: "text", html });
    textNodes = [];
  }

  for (const node of nodes) {
    if (node.type === "blockImage") {
      flushText();
      segments.push({
        type: "image",
        fileId:   (node.attrs?.fileId   as string) ?? "",
        fileName: (node.attrs?.fileName as string) ?? "image.jpg",
        mimeType: (node.attrs?.mimeType as string) ?? "image/jpeg",
        src:      (node.attrs?.src      as string) ?? "",
      });
    } else if (node.type === "blockVideo") {
      flushText();
      segments.push({
        type: "video",
        fileId:   (node.attrs?.fileId   as string) ?? "",
        fileName: (node.attrs?.fileName as string) ?? "video.mp4",
        mimeType: (node.attrs?.mimeType as string) ?? "video/mp4",
        src:      (node.attrs?.src      as string) ?? "",
      });
    } else if (node.type === "blockDocument") {
      flushText();
      segments.push({
        type:     "file",
        fileId:   (node.attrs?.fileId   as string) ?? "",
        fileName: (node.attrs?.fileName as string) ?? "document",
        mimeType: (node.attrs?.mimeType as string) ?? "application/octet-stream",
        fileSize: (node.attrs?.fileSize as number) ?? 0,
      });
    } else if (node.type === "blockPoll") {
      flushText();
      const opts = node.attrs?.options;
      segments.push({
        type:                  "poll",
        question:              (node.attrs?.question              as string)  ?? "",
        options:               (Array.isArray(opts) ? opts : []) as string[],
        isAnonymous:           (node.attrs?.isAnonymous           as boolean) ?? true,
        allowsMultipleAnswers: (node.attrs?.allowsMultipleAnswers as boolean) ?? false,
      });
    } else if (node.type !== "messageSplit") {
      textNodes.push(node);
    }
  }
  flushText();
  return segments;
}

// ─── Gap-based split (new overlay architecture) ──────────────────────────────

/**
 * Splits a TipTap doc JSON at gap indices and returns one JSON string per message.
 * gap N = divider before top-level block N (0-indexed).
 */
export function splitJsonAtGaps(json: string, gaps: number[]): string[] {
  let doc: TiptapNode;
  try { doc = JSON.parse(json) as TiptapNode; }
  catch { return [json]; }

  const nodes = doc.content ?? [];
  const sorted = [...new Set(gaps)].sort((a, b) => a - b).filter((g) => g > 0 && g < nodes.length);
  if (sorted.length === 0) return [json];

  const chunks: string[] = [];
  let start = 0;
  for (const g of sorted) {
    chunks.push(JSON.stringify({ type: "doc", content: nodes.slice(start, g) }));
    start = g;
  }
  chunks.push(JSON.stringify({ type: "doc", content: nodes.slice(start) }));

  return chunks.filter((c) => {
    try { return ((JSON.parse(c) as TiptapNode).content?.length ?? 0) > 0; }
    catch { return false; }
  });
}

/**
 * Splits the document at gap indices and returns one ContentSegment[] per message.
 * Replaces splitIntoMessages for the new overlay architecture.
 */
export function splitIntoMessagesAtGaps(
  json: string,
  gaps: number[],
  postTitle = "",
): ContentSegment[][] {
  const chunks = splitJsonAtGaps(json, gaps);

  const messages: ContentSegment[][] =
    chunks.length > 0
      ? chunks.map((c) => {
          let inner: TiptapNode;
          try { inner = JSON.parse(c) as TiptapNode; }
          catch { return []; }
          return buildSegments(inner.content ?? []);
        })
      : [[]];

  if (messages.length === 0) return [[]];

  if (postTitle.trim()) {
    const esc      = postTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const titleHtml = `<b data-post-title="1">${esc}</b>`;
    const firstText = messages[0].find((s): s is TextSegment => s.type === "text");
    if (firstText) {
      firstText.html = titleHtml + "\n\n" + firstText.html;
    } else {
      messages[0].unshift({ type: "text", html: titleHtml });
    }
  }

  return messages;
}

// ─── Plain text ───────────────────────────────────────────────────────────────

// Returns plain-text representation for character counting
export function tiptapToPlainText(json: string): string {
  let doc: TiptapNode;
  try {
    doc = JSON.parse(json) as TiptapNode;
  } catch {
    return "";
  }
  return extractText(doc).trimEnd();
}

function extractText(node: TiptapNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(extractText).join(
    node.type === "paragraph" ? "\n\n" : ""
  );
}
