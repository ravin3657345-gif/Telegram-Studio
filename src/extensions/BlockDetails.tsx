import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { useState, useRef } from "react";
import { t } from "@/lib/i18n";
import { ChevronDown, X } from "lucide-react";
import DOMPurify from "dompurify";

const PURIFY_CONFIG = { ALLOWED_TAGS: ["b", "i", "u", "s", "br", "p", "span", "strong", "em"] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DetailsView({ node, updateAttributes, deleteNode, selected }: any) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { summary = "", content = "" } = node.attrs as { summary: string; content: string };

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) setTimeout(() => contentRef.current?.focus(), 50);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.key === "b") { e.preventDefault(); document.execCommand("bold"); }
      if (e.key === "i") { e.preventDefault(); document.execCommand("italic"); }
      if (e.key === "u") { e.preventDefault(); document.execCommand("underline"); }
    }
  }

  return (
    <NodeViewWrapper as="div" contentEditable={false} style={{ margin: "6px 0" }}>
      <div
        style={{
          border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
          borderRadius: 8,
          overflow: "hidden",
          transition: "border-color 0.15s",
        }}
      >
        {/* Summary / title row */}
        <div
          onClick={toggleOpen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            backgroundColor: "var(--bg-elevated)",
            cursor: "pointer",
          }}
        >
          <span style={{ color: "var(--accent)", fontSize: 15, flexShrink: 0, userSelect: "none" }}>
            📎
          </span>
          <input
            value={summary}
            onChange={(e) => updateAttributes({ summary: e.target.value })}
            placeholder={t("block.spoilerTitle")}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (!open) setOpen(true); setTimeout(() => contentRef.current?.focus(), 50); }
              e.stopPropagation();
            }}
            style={{ flex: 1, border: "none", background: "transparent", color: "var(--text-primary)", fontSize: 14, fontWeight: 500, outline: "none", cursor: "text" }}
          />
          <ChevronDown size={15} style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0, pointerEvents: "none" }} />
          <button
            onClick={(e) => { e.stopPropagation(); deleteNode(); }}
            title={t("block.delete")}
            style={{ flexShrink: 0, display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 2, borderRadius: 4, color: "var(--text-muted)", transition: "color 0.15s" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#e05252")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
          >
            <X size={13} />
          </button>
        </div>

        {/* Rich-text content — contentEditable div supports Ctrl+B/I/U */}
        {open && (
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}>
            <div
              ref={contentRef}
              contentEditable
              suppressContentEditableWarning
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content, PURIFY_CONFIG) }}
              onInput={() => { if (contentRef.current) updateAttributes({ content: contentRef.current.innerHTML }); }}
              onKeyDown={handleKeyDown}
              style={{ outline: "none", color: "var(--text-secondary)", fontSize: 13, lineHeight: "1.6", minHeight: "2em", fontFamily: "inherit" }}
            />
            <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-muted)", opacity: 0.6 }}>
              {t("block.editingHint")}
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const BlockDetails = Node.create({
  name: "blockDetails",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      summary: { default: "" },
      content: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-block-details]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-details": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DetailsView);
  },
});
