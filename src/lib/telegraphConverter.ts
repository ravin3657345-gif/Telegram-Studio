// Converts TipTap JSON to Telegraph Node format.
// Images use "file:<fileId>" as src placeholder — Rust replaces them with real URLs after upload.

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

// Telegraph node types
export type TelegraphNode = string | TelegraphElement;

export interface TelegraphElement {
  tag: string;
  attrs?: Record<string, string>;
  children?: TelegraphNode[];
}

export interface TelegraphImagePayload {
  fileId: string;
  dataBase64: string;
  mimeType: string;
  fileName: string;
}

// ─── Inline conversion ────────────────────────────────────────────────────────

function applyMarks(text: string, marks: TiptapMark[]): TelegraphNode {
  let node: TelegraphNode = text;
  // Apply marks from last to first so first mark is outermost tag
  for (const mark of [...marks].reverse()) {
    switch (mark.type) {
      case "bold":
        node = { tag: "b", children: [node] };
        break;
      case "italic":
        node = { tag: "i", children: [node] };
        break;
      case "underline":
        node = { tag: "u", children: [node] };
        break;
      case "strike":
        node = { tag: "s", children: [node] };
        break;
      case "code":
        node = { tag: "code", children: [node] };
        break;
      case "link": {
        const href = (mark.attrs?.href as string) ?? "";
        if (href) node = { tag: "a", attrs: { href }, children: [node] };
        break;
      }
      // spoiler, textStyle — no Telegraph equivalent, skip
    }
  }
  return node;
}

function convertInline(nodes: TiptapNode[]): TelegraphNode[] {
  return nodes
    .map((n): TelegraphNode | null => {
      if (n.type === "text") return applyMarks(n.text ?? "", n.marks ?? []);
      if (n.type === "hardBreak") return { tag: "br" };
      // Nested inline (shouldn't normally happen, but handle)
      const children = convertInline(n.content ?? []);
      return children.length ? { tag: "span" as string, children } : null;
    })
    .filter((n): n is TelegraphNode => n !== null && n !== "");
}

// ─── Block conversion ─────────────────────────────────────────────────────────

function convertBlock(node: TiptapNode): TelegraphNode[] {
  switch (node.type) {
    case "paragraph": {
      const children = convertInline(node.content ?? []);
      // Empty paragraph → single space so Telegraph doesn't skip it
      return [{ tag: "p", children: children.length ? children : [" "] }];
    }

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const children = convertInline(node.content ?? []);
      // Telegraph only supports h3 and h4
      const tag = level <= 2 ? "h3" : "h4";
      return [{ tag, children }];
    }

    case "blockquote": {
      // Flatten paragraphs inside blockquote to inline children
      const children = (node.content ?? []).flatMap((child) =>
        convertInline(child.content ?? [])
      );
      return [{ tag: "blockquote", children }];
    }

    case "codeBlock": {
      const text = extractText(node);
      return [{ tag: "pre", children: [{ tag: "code", children: [text] }] }];
    }

    case "bulletList": {
      const items: TelegraphElement[] = (node.content ?? []).map((li) => ({
        tag: "li",
        children: (li.content ?? []).flatMap(convertBlock),
      }));
      return [{ tag: "ul", children: items }];
    }

    case "orderedList": {
      const items: TelegraphElement[] = (node.content ?? []).map((li) => ({
        tag: "li",
        children: (li.content ?? []).flatMap(convertBlock),
      }));
      return [{ tag: "ol", children: items }];
    }

    case "horizontalRule":
      return [{ tag: "hr" }];

    case "blockImage": {
      const fileId = (node.attrs?.fileId as string) ?? "";
      const alt = (node.attrs?.alt as string) ?? "";
      return [
        {
          tag: "figure",
          children: [
            { tag: "img", attrs: { src: `file:${fileId}`, alt } },
          ],
        },
      ];
    }

    case "blockVideo":
      // Telegraph doesn't support arbitrary video uploads — skip
      return [];

    default:
      return [];
  }
}

function extractText(node: TiptapNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(extractText).join("");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TelegraphConvertResult {
  nodes: TelegraphNode[];
  fileIds: string[]; // ordered list of fileIds found in blockImage nodes
}

/**
 * Convert TipTap JSON to an array of Telegraph nodes.
 * Images produce "file:<fileId>" placeholders.
 * If postTitle is given, prepend it as an h3 heading.
 */
export function tiptapToTelegraphNodes(
  json: string,
  postTitle = ""
): TelegraphConvertResult {
  let doc: TiptapNode;
  try {
    doc = JSON.parse(json) as TiptapNode;
  } catch {
    return { nodes: [], fileIds: [] };
  }

  const nodes: TelegraphNode[] = [];
  const fileIds: string[] = [];

  // Heading from postTitle
  if (postTitle.trim()) {
    nodes.push({ tag: "h3", children: [postTitle.trim()] });
  }

  for (const block of doc.content ?? []) {
    if (block.type === "blockImage") {
      const fileId = (block.attrs?.fileId as string) ?? "";
      if (fileId && !fileIds.includes(fileId)) fileIds.push(fileId);
    }
    nodes.push(...convertBlock(block));
  }

  return { nodes, fileIds };
}
