// Converts TipTap JSON → HTML for Telegram's sendRichMessage (Bot API 10.1).
// Paragraphs use <p> tags (not \n\n) because sendRichMessage parses real HTML.

interface TiptapMark { type: string; attrs?: Record<string, unknown> }
interface TiptapNode {
  type: string;
  text?: string;
  marks?: TiptapMark[];
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
}

// ─── RichText tree ───────────────────────────────────────────────────────────

type RichTextPlain      = { type: "plain";         text: string };
type RichTextNested     = { type: "bold" | "italic" | "underline" | "strikethrough" | "code" | "spoiler" | "subscript" | "superscript" | "marked"; text: RichText };
type RichTextUrl        = { type: "url";            text: RichText; url: string };
type RichTextConcat     = { type: "concat";         texts: RichText[] };
type RichText = RichTextPlain | RichTextNested | RichTextUrl | RichTextConcat;

function plainText(s: string): RichTextPlain {
  return { type: "plain", text: s };
}

function concatRichText(parts: RichText[]): RichText {
  if (parts.length === 0) return plainText("");
  if (parts.length === 1) return parts[0];
  return { type: "concat", texts: parts };
}

function applyMarksToRichText(inner: RichText, marks: TiptapMark[]): RichText {
  let result = inner;
  for (const m of marks) {
    switch (m.type) {
      case "bold":        result = { type: "bold",        text: result }; break;
      case "italic":      result = { type: "italic",      text: result }; break;
      case "underline":   result = { type: "underline",   text: result }; break;
      case "strike":      result = { type: "strikethrough", text: result }; break;
      case "code":        result = { type: "code",        text: result }; break;
      case "spoiler":     result = { type: "spoiler",     text: result }; break;
      case "subscript":   result = { type: "subscript",   text: result }; break;
      case "superscript": result = { type: "superscript", text: result }; break;
      case "highlight":   result = { type: "marked",      text: result }; break;
      case "link": {
        const url = m.attrs?.href as string | undefined;
        if (url) result = { type: "url", text: result, url };
        break;
      }
    }
  }
  return result;
}

function buildRichText(nodes: TiptapNode[]): RichText {
  const parts: RichText[] = [];

  function walk(node: TiptapNode) {
    if (node.type === "text") {
      const raw = node.text ?? "";
      if (!raw) return;
      let rt: RichText = plainText(raw);
      if (node.marks?.length) rt = applyMarksToRichText(rt, node.marks);
      parts.push(rt);
      return;
    }
    if (node.type === "hardBreak") {
      parts.push(plainText("\n"));
      return;
    }
    for (const child of node.content ?? []) walk(child);
  }

  for (const node of nodes) walk(node);
  return concatRichText(parts);
}

// ─── Photo items ──────────────────────────────────────────────────────────────

export interface RichPhotoItem {
  attachName: string;
  dataBase64: string;
  mimeType: string;
  fileName: string;
  fileId: string;
}

type RichBlockParagraph    = { type: "paragraph";       text: RichText };
type RichBlockHeading      = { type: "section_heading"; text: RichText; level: number };
type RichBlockQuote        = { type: "block_quotation" | "block_expandable_quotation"; text: RichText };
type RichBlockPre          = { type: "preformatted";    text: RichText; language?: string };
type RichBlockList         = { type: "list";            items: { text: RichText }[]; ordered: boolean };
type RichBlockDivider      = { type: "divider" };
type RichBlockPhoto        = { type: "photo";           photo: string };
type RichBlockVideo        = { type: "video";           video: string };
type RichBlockDetails      = { type: "details";         summary: RichText; blocks: RichBlock[] };
type RichBlock =
  | RichBlockParagraph | RichBlockHeading | RichBlockQuote
  | RichBlockPre | RichBlockList | RichBlockDivider | RichBlockPhoto | RichBlockVideo
  | RichBlockDetails;

// ─── Block conversion ─────────────────────────────────────────────────────────

function convertBlock(
  node: TiptapNode,
  photos: RichPhotoItem[],
  imgCounter: { n: number },
): RichBlock[] {
  switch (node.type) {
    case "paragraph": {
      const rt = buildRichText(node.content ?? []);
      if (rt.type === "plain" && !rt.text.trim()) return [];
      return [{ type: "paragraph", text: rt }];
    }

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const rt = buildRichText(node.content ?? []);
      return [{ type: "section_heading", text: rt, level }];
    }

    case "blockquote": {
      const paragraphs = node.content ?? [];
      const inlines: TiptapNode[] = [];
      for (let i = 0; i < paragraphs.length; i++) {
        if (i > 0) inlines.push({ type: "hardBreak" });
        inlines.push(...(paragraphs[i].content ?? []));
      }
      const rt = buildRichText(inlines);
      if (node.attrs?.expandable) {
        return [{ type: "block_expandable_quotation", text: rt }];
      }
      return [{ type: "block_quotation", text: rt }];
    }

    case "codeBlock": {
      const raw = (node.content ?? []).map((n) => n.text ?? "").join("");
      const lang = (node.attrs?.language as string | undefined) ?? "";
      return [{ type: "preformatted", text: plainText(raw), language: lang || undefined }];
    }

    case "bulletList": {
      const items = (node.content ?? []).map((li) => {
        const inlines = (li.content ?? []).flatMap((p) => p.content ?? []);
        return { text: buildRichText(inlines) };
      });
      return [{ type: "list", items, ordered: false }];
    }

    case "orderedList": {
      const items = (node.content ?? []).map((li) => {
        const inlines = (li.content ?? []).flatMap((p) => p.content ?? []);
        return { text: buildRichText(inlines) };
      });
      return [{ type: "list", items, ordered: true }];
    }

    case "horizontalRule":
      return [{ type: "divider" }];

    case "blockFaq": {
      const q = (node.attrs?.question as string) ?? "";
      const a = (node.attrs?.answer   as string) ?? "";
      if (!q && !a) return [];
      const answerBlock: RichBlock = { type: "paragraph", text: plainText(a) };
      return [{
        type: "details",
        summary: plainText(q),
        blocks: a ? [answerBlock] : [],
      } as RichBlockDetails];
    }

    case "blockDetails": {
      const s = (node.attrs?.summary as string) ?? "";
      const c = (node.attrs?.content as string) ?? "";
      if (!s && !c) return [];
      return [{
        type: "details",
        summary: plainText(s),
        blocks: c ? [{ type: "paragraph" as const, text: plainText(c) }] : [],
      } as RichBlockDetails];
    }

    case "blockImage": {
      const fileId   = (node.attrs?.fileId   as string) ?? "";
      const fileName = (node.attrs?.fileName as string) ?? "image.jpg";
      const mimeType = (node.attrs?.mimeType as string) ?? "image/jpeg";
      const attachName = `img_${imgCounter.n++}`;
      photos.push({ attachName, dataBase64: "", mimeType, fileName, fileId });
      return [{ type: "photo", photo: `attach://${attachName}` }];
    }

    case "blockVideo": {
      const fileId   = (node.attrs?.fileId   as string) ?? "";
      const fileName = (node.attrs?.fileName as string) ?? "video.mp4";
      const mimeType = (node.attrs?.mimeType as string) ?? "video/mp4";
      const attachName = `vid_${imgCounter.n++}`;
      photos.push({ attachName, dataBase64: "", mimeType, fileName, fileId });
      return [{ type: "video", video: `attach://${attachName}` }];
    }

    case "blockPoll":
      // Polls are not supported in Rich messages — caller should warn user
      return [];

    default:
      return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RichMessageResult {
  blocksJson: string;
  photos: RichPhotoItem[];
}

// old alias kept for PublishPanel import
export interface RichPhotoItemOld extends RichPhotoItem {}

export function tiptapToRichBlocks(json: string, postTitle = ""): RichMessageResult {
  let doc: TiptapNode;
  try { doc = JSON.parse(json) as TiptapNode; }
  catch { return { blocksJson: "[]", photos: [] }; }

  const blocks: RichBlock[] = [];
  const photos: RichPhotoItem[] = [];
  const imgCounter = { n: 0 };

  if (postTitle.trim()) {
    blocks.push({ type: "section_heading", text: plainText(postTitle.trim()), level: 1 });
  }

  for (const node of doc.content ?? []) {
    blocks.push(...convertBlock(node, photos, imgCounter));
  }

  return { blocksJson: JSON.stringify(blocks), photos };
}

// Converts TipTap JSON to HTML for sendRichMessage.
// Text nodes use the same converter as normal publish (preserves lists, spacing, etc.)
// Media blocks become <img>/<video> placeholders that Rust replaces with real URLs.
export function tiptapToRichHtml(json: string, postTitle = ""): { html: string; photos: RichPhotoItem[] } {
  let doc: TiptapNode;
  try { doc = JSON.parse(json) as TiptapNode; }
  catch { return { html: "", photos: [] }; }

  const photos: RichPhotoItem[] = [];
  let counter = 0;
  const parts: string[] = [];

  if (postTitle.trim()) {
    const esc = escapeHtml(postTitle.trim());
    parts.push(`<h2>${esc}</h2>`);
  }

  for (const node of doc.content ?? []) {
    if (node.type === "horizontalRule") {
      parts.push("<hr/>");
    } else if (node.type === "blockFaq") {
      const q = escapeHtml((node.attrs?.question as string) ?? "");
      const a = escapeHtml((node.attrs?.answer   as string) ?? "");
      if (q || a) {
        parts.push(`<details><summary>${q}</summary>${a}</details>`);
      }
    } else if (node.type === "blockImage") {
      const attachName = `img_${counter++}`;
      photos.push({
        attachName,
        dataBase64: "",
        mimeType:  (node.attrs?.mimeType as string) ?? "image/jpeg",
        fileName:  (node.attrs?.fileName as string) ?? "image.jpg",
        fileId:    (node.attrs?.fileId   as string) ?? "",
      });
      parts.push(`<img src="attach://${attachName}"/>`);
    } else if (node.type === "blockVideo") {
      const attachName = `vid_${counter++}`;
      photos.push({
        attachName,
        dataBase64: "",
        mimeType:  (node.attrs?.mimeType as string) ?? "video/mp4",
        fileName:  (node.attrs?.fileName as string) ?? "video.mp4",
        fileId:    (node.attrs?.fileId   as string) ?? "",
      });
      parts.push(`<video src="attach://${attachName}"/>`);
    } else if (node.type === "bulletList") {
      const lis = (node.content ?? []).map((li) => `<li>${extractRichText(li)}</li>`).join("");
      if (lis) parts.push(`<ul>${lis}</ul>`);
    } else if (node.type === "orderedList") {
      const lis = (node.content ?? []).map((li) => `<li>${extractRichText(li)}</li>`).join("");
      if (lis) parts.push(`<ol>${lis}</ol>`);
    } else {
      switch (node.type) {
        case "paragraph": {
          const text = extractRichText(node);
          if (text.trim()) parts.push(`<p>${text}</p>`);
          break;
        }
        case "heading": {
          const lvl = (node.attrs?.level as number) ?? 2;
          const text = extractRichText(node);
          if (text.trim()) parts.push(`<h${lvl}>${text}</h${lvl}>`);
          break;
        }
        case "blockquote": {
          const inner = (node.content ?? []).map(extractRichText).join("<br>");
          if (inner.trim()) {
            const tag = node.attrs?.expandable ? "blockquote expandable" : "blockquote";
            parts.push(`<${tag}>${inner}</${tag.split(" ")[0]}>`);
          }
          break;
        }
        case "codeBlock": {
          const raw = (node.content ?? []).map((n) => n.text ?? "").join("");
          const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          if (esc) parts.push(`<pre><code>${esc}</code></pre>`);
          break;
        }
        default: {
          const text = extractRichText(node);
          if (text.trim()) parts.push(`<p>${text}</p>`);
        }
      }
    }
  }

  return { html: parts.join(""), photos };
}

// Helper: extract text from a list/table cell with inline marks as HTML
function extractRichText(node: TiptapNode): string {
  if (node.type === "text") {
    let text = escapeHtml(node.text ?? "");
    for (const mark of [...(node.marks ?? [])].reverse()) {
      switch (mark.type) {
        case "bold": text = `<b>${text}</b>`; break;
        case "italic": text = `<i>${text}</i>`; break;
        case "underline": text = `<u>${text}</u>`; break;
        case "strike": text = `<s>${text}</s>`; break;
        case "code": text = `<code>${text}</code>`; break;
        case "spoiler":     text = `<tg-spoiler>${text}</tg-spoiler>`; break;
        case "subscript":   text = `<sub>${text}</sub>`; break;
        case "superscript": text = `<sup>${text}</sup>`; break;
        case "highlight":   text = `<mark>${text}</mark>`; break;
        case "link": {
          const href = mark.attrs?.href as string | undefined;
          if (href) text = `<a href="${href}">${text}</a>`;
          break;
        }
      }
    }
    return text;
  }
  if (node.content) {
    return node.content.map(extractRichText).join("");
  }
  return "";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
