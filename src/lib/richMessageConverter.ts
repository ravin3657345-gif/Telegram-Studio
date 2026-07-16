// Converts TipTap JSON → HTML for Telegram's sendRichMessage (Bot API 10.1).
// Paragraphs use <p> tags (not \n\n) because sendRichMessage parses real HTML.
//
// InputRichMessage (what sendRichMessage actually accepts) is just a plain
// `{ html }` string — there is no JSON-blocks-tree input format. The
// RichBlock/RichText object tree Telegram documents is what you get BACK when
// reading an already-sent rich message, not something you construct to send.

import { miniHtmlToTelegramHtml } from "./miniHtml";
import { ANCHOR_TOP_NAME } from "@/extensions/BlockAnchor";

interface TiptapMark { type: string; attrs?: Record<string, unknown> }
interface TiptapNode {
  type: string;
  text?: string;
  marks?: TiptapMark[];
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
}

export interface RichPhotoItem {
  attachName: string;
  dataBase64: string;
  mimeType: string;
  fileName: string;
  fileId: string;
}

// Renders one blockImage/blockVideo node as a tg://photo?id=/tg://video?id=
// reference and records it in `photos` for attachment — shared by lone media
// and <tg-collage> runs. Bot API 10.2's InputRichMessageMedia lets media be
// specified this way instead of a public HTTP(S) URL: `attachName` doubles as
// both the tg://…?id= value and the multipart form field name the raw bytes
// get attached under (see publishViaRichMessage in PublishPanel.tsx and
// send_rich_message in src-tauri/src/telegram/methods.rs). Confirmed by an
// earlier live test: <photo>URL</photo>/<video>URL</video> (content-based,
// per docs) is NOT recognized — Telegram strips the tag and keeps the bare URL
// text, which then auto-links instead of rendering as media. Always use the
// self-closing <img src="..."/>/<video src="..."/> form that's confirmed to
// work standalone; if the <tg-collage> wrapper itself isn't recognized either,
// these inner tags still render fine on their own, just not grid-grouped.
function renderRichMediaTag(
  node: TiptapNode,
  photos: RichPhotoItem[],
  nextCounter: () => number,
): string {
  const isVideo = node.type === "blockVideo";
  const attachName = `${isVideo ? "vid" : "img"}_${nextCounter()}`;
  photos.push({
    attachName,
    dataBase64: "",
    mimeType: (node.attrs?.mimeType as string) ?? (isVideo ? "video/mp4" : "image/jpeg"),
    fileName: (node.attrs?.fileName as string) ?? (isVideo ? "video.mp4" : "image.jpg"),
    fileId:   (node.attrs?.fileId   as string) ?? "",
  });
  const ref = `tg://${isVideo ? "video" : "photo"}?id=${attachName}`;
  return isVideo ? `<video src="${ref}"/>` : `<img src="${ref}"/>`;
}

// Converts a list of sibling TipTap block nodes to concatenated Rich HTML.
// Used both for the document's top-level content and recursively for content
// nested inside a blockquote (blockquote's schema is `content: "block+"` —
// live-tested 2026-07-09: Telegram genuinely preserves a block nested inside a
// <blockquote> as its own nested block, e.g. a <pre><code> inside a quote came
// back as a separate "pre" block, not flattened text) — same grouping/lookahead
// logic (media runs, checklist runs) applies at any nesting depth.
function convertBlockList(
  nodes: TiptapNode[],
  photos: RichPhotoItem[],
  counter: { n: number },
): string {
  const parts: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (node.type === "blockImage" || node.type === "blockVideo") {
      // Group 2+ adjacent media blocks into a <tg-collage> grid or a
      // <tg-slideshow> carousel (user's choice per group, editor's
      // MediaGroupLayoutToggle) — mirrors how the normal publish mode bundles
      // consecutive media into one sendMediaGroup. A lone image/video stays a
      // plain <img>/<video> tag.
      const run: TiptapNode[] = [node];
      while (
        i + 1 < nodes.length &&
        (nodes[i + 1].type === "blockImage" || nodes[i + 1].type === "blockVideo")
      ) {
        run.push(nodes[++i]);
      }
      const isGroup = run.length > 1;
      const tags = run.map((n) => renderRichMediaTag(n, photos, () => counter.n++));
      if (isGroup) {
        const layout = (run[0].attrs?.groupLayout as string) ?? "collage";
        if (layout === "slideshow") {
          parts.push(`<tg-slideshow>${tags.join("")}</tg-slideshow>`);
        } else {
          parts.push(`<tg-collage>${tags.join("")}</tg-collage>`);
        }
      } else {
        parts.push(tags[0]);
      }
      continue;
    }

    if (node.type === "checkItem") {
      // Native checkbox list items (<ul><li><input type="checkbox">...) instead
      // of a plain paragraph with a ☑/☐ glyph — group consecutive checkItems
      // into one <ul>, same lookahead pattern as the media grouping above.
      const run: TiptapNode[] = [node];
      while (i + 1 < nodes.length && nodes[i + 1].type === "checkItem") run.push(nodes[++i]);
      const lis = run.map((n) => {
        const checkedAttr = n.attrs?.checked ? " checked" : "";
        return `<li><input type="checkbox"${checkedAttr}>${extractRichText(n)}</li>`;
      }).join("");
      parts.push(`<ul>${lis}</ul>`);
      continue;
    }

    const html = convertSingleNode(node, photos, counter);
    if (html) parts.push(html);
  }

  return parts.join("");
}

function convertSingleNode(
  node: TiptapNode,
  photos: RichPhotoItem[],
  counter: { n: number },
): string {
  switch (node.type) {
    case "paragraph": {
      const text = extractRichText(node);
      return text.trim() ? `<p>${text}</p>` : "";
    }
    case "heading": {
      const lvl = (node.attrs?.level as number) ?? 2;
      const text = extractRichText(node);
      return text.trim() ? `<h${lvl}>${text}</h${lvl}>` : "";
    }
    case "blockquote": {
      // Live-tested 2026-07-09: Rich Messages don't support an expandable/
      // collapsible blockquote at all — sent <blockquote expandable>, the
      // parsed-back message showed a plain non-collapsible blockquote with no
      // trace of the attribute. <details><summary> is the real collapsible
      // mechanism in Rich mode; a quote just stays a quote either way.
      const inner = convertBlockList(node.content ?? [], photos, counter);
      return inner.trim() ? `<blockquote>${inner}</blockquote>` : "";
    }
    case "codeBlock": {
      const raw = (node.content ?? []).map((n) => n.text ?? "").join("");
      const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return esc ? `<pre><code>${esc}</code></pre>` : "";
    }
    case "callout": {
      const emoji = (node.attrs?.emoji as string) || "💡";
      const inner = (node.content ?? []).map(extractRichText).join("<br>");
      return inner.trim() ? `<blockquote>${emoji} ${inner}</blockquote>` : "";
    }
    case "bulletList": {
      const lis = (node.content ?? []).map((li) => `<li>${extractRichText(li)}</li>`).join("");
      return lis ? `<ul>${lis}</ul>` : "";
    }
    case "orderedList": {
      const lis = (node.content ?? []).map((li) => `<li>${extractRichText(li)}</li>`).join("");
      return lis ? `<ol>${lis}</ol>` : "";
    }
    case "horizontalRule":
      return "<hr/>";
    case "blockTable": {
      const rows = (node.content ?? []).map((row) => {
        const cells = (row.content ?? []).map((cell) => {
          const tag = cell.attrs?.header ? "th" : "td";
          return `<${tag}>${extractRichText(cell)}</${tag}>`;
        }).join("");
        return `<tr>${cells}</tr>`;
      }).join("");
      // Without `bordered`, Telegram renders the cells' text with no visible
      // grid lines at all — just floating text roughly where the cells would
      // be, confirmed by a live send.
      return rows ? `<table bordered>${rows}</table>` : "";
    }
    case "blockAudio": {
      // Same tg://audio?id= reference + attachment mechanism as blockImage/
      // blockVideo (renderRichMediaTag) — kept separate since audio is never
      // grouped into a <tg-collage>/<tg-slideshow> the way photos/videos are.
      const attachName = `aud_${counter.n++}`;
      photos.push({
        attachName,
        dataBase64: "",
        mimeType: (node.attrs?.mimeType as string) ?? "audio/mpeg",
        fileName: (node.attrs?.fileName as string) ?? "audio.mp3",
        fileId:   (node.attrs?.fileId   as string) ?? "",
      });
      return `<audio src="tg://audio?id=${attachName}"></audio>`;
    }
    case "blockMap": {
      // <tg-map lat long zoom> — undocumented, confirmed by a live send
      // (2026-07-11): parsed back as {type:"map", location:{lat,long}, zoom,
      // width, height}. "latitude"/"longitude" attribute names are NOT
      // recognized and silently produce garbage coordinates — must be lat/long.
      // Also live-confirmed (2026-07-12, sales-bot demo A/B on a real phone):
      // a low zoom (12) rendered as a blank/grey box on mobile Telegram while
      // the exact same tag with zoom=15 rendered fine — desktop showed both
      // correctly either way. Root cause unconfirmed (mobile-only map tile
      // quirk?), but the default below stays at 15 specifically to avoid it —
      // don't lower it without testing on a real phone first.
      const lat = (node.attrs?.lat as number) ?? 0;
      const long = (node.attrs?.long as number) ?? 0;
      const zoom = (node.attrs?.zoom as number) ?? 15;
      return `<tg-map lat="${lat}" long="${long}" zoom="${zoom}"></tg-map>`;
    }
    case "blockFormula": {
      // <tg-math-block> — undocumented, confirmed by a live send
      // (2026-07-11): parsed back as {type:"mathematical_expression",
      // expression: "..."} with the raw LaTeX (backslashes included)
      // preserved as-is; JSON.stringify already handles the wire escaping,
      // no extra doubling needed on our end.
      const expr = (node.attrs?.expression as string) ?? "";
      // Escaped like codeBlock above — a "<"/">" in the LaTeX (e.g. an
      // inequality) would otherwise be parsed as an HTML tag boundary by
      // Telegram's HTML parser before it ever reaches the math renderer.
      const esc = expr.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return expr.trim() ? `<tg-math-block>${esc}</tg-math-block>` : "";
    }
    case "anchorPoint":
      // Invisible marker — Bot API 10.1 Rich Messages support in-document
      // anchors/jump links, unlike regular Telegram HTML messages.
      return `<a name="${ANCHOR_TOP_NAME}"></a>`;
    case "blockFaq": {
      const q = escapeHtml((node.attrs?.question as string) ?? "");
      // The answer is sanitized mini-HTML (bold/italic/underline/strike) from
      // the spoiler body editor — convert its markup to the matching Telegram
      // HTML tags rather than escaping it as literal text (which would show
      // raw "<b>...</b>" to readers instead of actual bold formatting).
      const a = miniHtmlToTelegramHtml((node.attrs?.answer as string) ?? "");
      return (q || a) ? `<details><summary>${q}</summary>${a}</details>` : "";
    }
    default: {
      const text = extractRichText(node);
      return text.trim() ? `<p>${text}</p>` : "";
    }
  }
}

// Converts TipTap JSON to HTML for sendRichMessage.
export function tiptapToRichHtml(json: string, postTitle = ""): { html: string; photos: RichPhotoItem[] } {
  let doc: TiptapNode;
  try { doc = JSON.parse(json) as TiptapNode; }
  catch { return { html: "", photos: [] }; }

  const photos: RichPhotoItem[] = [];
  const counter = { n: 0 };
  const parts: string[] = [];

  // insertJumpToTopLink() always inserts the anchor marker at doc position 0
  // (the start of the BODY), but the post title is a separate field rendered
  // before the body — left as-is, the anchor would land right after the
  // title instead of at the true top of the post, so "👆 Лифт" would jump
  // past the title instead of showing it. Emit the anchor first when it's
  // the body's first node, then the title, then the rest of the body.
  let bodyContent = doc.content ?? [];
  const [firstNode, ...restContent] = bodyContent;
  if (firstNode?.type === "anchorPoint") {
    parts.push(convertSingleNode(firstNode, photos, counter));
    bodyContent = restContent;
  }

  if (postTitle.trim()) {
    const esc = escapeHtml(postTitle.trim());
    parts.push(`<h2>${esc}</h2>`);
  }

  parts.push(convertBlockList(bodyContent, photos, counter));

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
