// Converts TipTap JSON document to Telegram HTML for real-time preview.
// Mirror of src-tauri/src/telegram/markup.rs (used client-side only).

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

    case "blockFaq": {
      const q = escapeHtml((node.attrs?.question as string) ?? "");
      const a = escapeHtml((node.attrs?.answer as string) ?? "");
      if (!q && !a) return "";
      const body = a ? `${q}\n${a}` : q;
      return `<blockquote expandable>${body}</blockquote>\n\n`;
    }

    // Block media nodes — skipped in text conversion (handled separately in publishing)
    case "blockImage":
    case "blockVideo":
    case "blockPoll":
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
      case "subscript":
        result = `<sub>${result}</sub>`;
        break;
      case "superscript":
        result = `<sup>${result}</sup>`;
        break;
      case "highlight":
        result = `<mark>${result}</mark>`;
        break;
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
