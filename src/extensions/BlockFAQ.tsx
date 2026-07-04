import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { useState, useRef } from "react";
import { ChevronDown, X } from "lucide-react";
import { t } from "@/lib/i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FAQView({ node, updateAttributes, deleteNode, selected }: any) {
  const [open, setOpen] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const { question = "", answer = "" } = node.attrs as { question: string; answer: string };

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) setTimeout(() => answerRef.current?.focus(), 50);
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
        {/* Question row */}
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
            🙈
          </span>
          <input
            value={question}
            onChange={(e) => updateAttributes({ question: e.target.value })}
            placeholder={t("block.spoilerTitle")}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!open) setOpen(true);
                setTimeout(() => answerRef.current?.focus(), 50);
              }
              e.stopPropagation();
            }}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: 14,
              fontWeight: 500,
              outline: "none",
              cursor: "text",
            }}
          />
          <ChevronDown
            size={15}
            style={{
              color: "var(--text-muted)",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
              flexShrink: 0,
              pointerEvents: "none",
            }}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteNode();
            }}
            title={t("block.delete")}
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              borderRadius: 4,
              color: "var(--text-muted)",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#e05252")}
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")
            }
          >
            <X size={13} />
          </button>
        </div>

        {/* Answer body — shown when expanded */}
        {open && (
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-surface)",
            }}
          >
            <textarea
              ref={answerRef}
              value={answer}
              onChange={(e) => updateAttributes({ answer: e.target.value })}
              placeholder={t("block.spoilerAnswer")}
              onKeyDown={(e) => e.stopPropagation()}
              rows={3}
              style={{
                width: "100%",
                border: "none",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: 13,
                lineHeight: "1.6",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const BlockFAQ = Node.create({
  name: "blockFaq",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      question: { default: "" },
      answer:   { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-block-faq]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-faq": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FAQView);
  },
});
