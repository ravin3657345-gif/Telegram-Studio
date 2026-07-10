import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { useState } from "react";

const EMOJI_CHOICES = ["💡", "📌", "⚠️", "✅", "🔥", "❗", "ℹ️", "🎯"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CalloutView({ node, updateAttributes }: any) {
  const emoji = (node.attrs.emoji as string) || "💡";
  const [open, setOpen] = useState(false);

  return (
    <NodeViewWrapper
      as="div"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        margin: "10px 0",
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--accent-subtle)",
        border: "1px solid var(--border-default)",
      }}
    >
      <span
        contentEditable={false}
        onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 18, lineHeight: 1.4, cursor: "pointer", position: "relative", flexShrink: 0 }}
      >
        {emoji}
        {open && (
          <div
            contentEditable={false}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 4,
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              width: 132,
              padding: 6,
              borderRadius: 8,
              zIndex: 20,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
            }}
          >
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                onClick={(ev) => { ev.stopPropagation(); updateAttributes({ emoji: e }); setOpen(false); }}
                style={{ fontSize: 16, background: "none", border: "none", cursor: "pointer", padding: 3, borderRadius: 4 }}
                onMouseEnter={(ev) => ((ev.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-hover)")}
                onMouseLeave={(ev) => ((ev.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </span>
      <NodeViewContent as="div" style={{ flex: 1, color: "var(--text-primary)", lineHeight: 1.5 }} />
    </NodeViewWrapper>
  );
}

export const BlockCallout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (el) => el.getAttribute("data-emoji") ?? "💡",
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-callout": "" }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
