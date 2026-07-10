// Parses the tiny, DOMPurify-sanitized HTML subset produced by the spoiler
// body's contentEditable field (see PURIFY_CONFIG in BlockFAQ.tsx:
// b/i/u/s/strong/em/span/p/br only) into a small AST, and renders it back out
// as Telegram-safe HTML or plain text.
//
// Deliberately DOM-free (no DOMParser) so this stays a pure string function —
// consistent with every other converter in this codebase — and runs
// identically in the browser and in vitest's default "node" environment.

export type MiniHtmlMark = "b" | "i" | "u" | "s";

export type MiniHtmlNode =
  | { type: "text"; text: string }
  | { type: "mark"; mark: MiniHtmlMark; children: MiniHtmlNode[] }
  | { type: "break" };

const TAG_RE = /<(\/?)(\w+)[^>]*>/g;

const MARK_MAP: Record<string, MiniHtmlMark> = {
  b: "b", strong: "b",
  i: "i", em: "i",
  u: "u",
  s: "s",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Parses a sanitized mini-HTML fragment into a lightweight node tree. */
export function parseMiniHtml(html: string): MiniHtmlNode[] {
  if (!html) return [];

  interface Frame { children: MiniHtmlNode[] }
  const root: Frame = { children: [] };
  const stack: Frame[] = [root];

  const pushText = (raw: string) => {
    const text = decodeEntities(raw);
    if (text) stack[stack.length - 1].children.push({ type: "text", text });
  };

  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(html))) {
    pushText(html.slice(lastIndex, match.index));
    lastIndex = TAG_RE.lastIndex;

    const [, closingSlash, rawTag] = match;
    const tag = rawTag.toLowerCase();
    const closing = closingSlash === "/";

    if (tag === "br") {
      stack[stack.length - 1].children.push({ type: "break" });
      continue;
    }
    if (tag === "p") {
      // Treat each new <p> (after the first) as a paragraph gap; </p> is a no-op.
      if (!closing) {
        const cur = stack[stack.length - 1].children;
        if (cur.length > 0) cur.push({ type: "break" }, { type: "break" });
      }
      continue;
    }
    if (tag === "span") continue; // transparent wrapper — no mark, no structure

    const mark = MARK_MAP[tag];
    if (!mark) continue; // unknown tag — ignore rather than break

    if (!closing) {
      const frame: Frame = { children: [] };
      stack[stack.length - 1].children.push({ type: "mark", mark, children: frame.children });
      stack.push(frame);
    } else if (stack.length > 1) {
      stack.pop();
    }
  }
  pushText(html.slice(lastIndex));

  return root.children;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders a parsed mini-HTML tree as Telegram-safe inline HTML (b/i/u/s + \n). */
export function renderMiniHtmlNodesToTelegramHtml(nodes: MiniHtmlNode[]): string {
  return nodes
    .map((n): string => {
      if (n.type === "text") return escapeHtml(n.text);
      if (n.type === "break") return "\n";
      return `<${n.mark}>${renderMiniHtmlNodesToTelegramHtml(n.children)}</${n.mark}>`;
    })
    .join("");
}

/** Convenience: parse + render straight to Telegram-safe HTML. */
export function miniHtmlToTelegramHtml(html: string): string {
  return renderMiniHtmlNodesToTelegramHtml(parseMiniHtml(html)).trim();
}

/** Renders a parsed mini-HTML tree as plain text (marks stripped, breaks → \n). */
export function renderMiniHtmlNodesToPlainText(nodes: MiniHtmlNode[]): string {
  return nodes
    .map((n): string => {
      if (n.type === "text") return n.text;
      if (n.type === "break") return "\n";
      return renderMiniHtmlNodesToPlainText(n.children);
    })
    .join("");
}

/** Convenience: parse + flatten straight to plain text. */
export function miniHtmlToPlainText(html: string): string {
  return renderMiniHtmlNodesToPlainText(parseMiniHtml(html)).trim();
}
