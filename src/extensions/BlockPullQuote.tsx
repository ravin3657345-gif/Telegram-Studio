import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { t } from "@/lib/i18n";

// Bot API 10.2's InputRichBlockPullQuotation — "a quotation with centered
// text", corresponds to the HTML tag <aside>. Rich Messages only, same as
// blockTable/blockMap/blockFormula (see PublishPanel.tsx's
// pullquoteBlockedOutsideRich) — <aside> has no normal-mode Telegram HTML
// equivalent at all.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PullQuoteView({ node, updateAttributes }: any) {
  return (
    <NodeViewWrapper
      as="aside"
      style={{
        textAlign: "center",
        padding: "18px 24px",
        margin: "0 0 14px",
        borderRadius: 10,
        background: "linear-gradient(to bottom, color-mix(in srgb, var(--accent) 6%, transparent), transparent)",
        color: "var(--text-secondary)",
        fontStyle: "italic",
      }}
    >
      <span aria-hidden style={{ color: "var(--accent)", opacity: 0.5, fontSize: "1.4em" }}>„</span>
      <NodeViewContent as="span" style={{ display: "inline" }} />
      <span aria-hidden style={{ color: "var(--accent)", opacity: 0.5, fontSize: "1.4em" }}>“</span>
      <input
        contentEditable={false}
        value={node.attrs.credit ?? ""}
        onChange={(e) => updateAttributes({ credit: e.target.value || null })}
        placeholder={t("quote.creditPlaceholder")}
        style={{
          display: "block",
          margin: "6px auto 0",
          border: "none",
          background: "transparent",
          font: "inherit",
          fontSize: "0.85em",
          fontStyle: "normal",
          fontWeight: 600,
          color: "var(--accent)",
          outline: "none",
          textAlign: "center",
        }}
      />
    </NodeViewWrapper>
  );
}

export const BlockPullQuote = Node.create({
  name: "pullquote",
  group: "block",
  content: "inline*",

  addAttributes() {
    return {
      credit: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-credit"),
        renderHTML: (attrs) => (attrs.credit ? { "data-credit": attrs.credit } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "aside" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["aside", mergeAttributes({ class: "tiptap-pullquote" }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PullQuoteView);
  },
});
