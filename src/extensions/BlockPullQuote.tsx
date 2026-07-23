import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { t } from "@/lib/i18n";

// Bot API 10.2's InputRichBlockPullQuotation — "a quotation with centered
// text", corresponds to the HTML tag <aside>. Rich Messages only, same as
// blockTable/blockMap/blockFormula (see PublishPanel.tsx's
// pullquoteBlockedOutsideRich) — <aside> has no normal-mode Telegram HTML
// equivalent at all.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Same visual recipe as BlockquoteView (Blockquote.tsx) — left-border
// accent, padding, gradient, italic — matched on request so the two quote
// blocks read as siblings in the editor. Telegram still renders <aside>'s
// text centered regardless of our editor styling (that's the whole point of
// the pull quote block per Bot API 10.2), so this is a look-only match, not
// a behavior change.
function PullQuoteView({ node, updateAttributes }: any) {
  return (
    <NodeViewWrapper
      as="aside"
      style={{
        borderLeft: "3px solid var(--accent)",
        padding: "6px 36px 6px 14px",
        margin: "0 0 14px",
        borderRadius: "0 6px 6px 0",
        background: "linear-gradient(to right, color-mix(in srgb, var(--accent) 5%, transparent), transparent)",
        color: "var(--text-secondary)",
        fontStyle: "italic",
        textAlign: "center",
      }}
    >
      {/* A plain inline flow here was landing the quote marks and the text
          on three separate visual lines instead of flanking the text on one
          — some part of the NodeView plumbing between them was forcing a
          break. A flex row sidesteps whatever that was: flex items always
          lay out in a row regardless, `wrap` still lets a long quote wrap
          naturally instead of forcing one unbreakable line. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "center", gap: 6 }}>
        <span aria-hidden style={{ color: "var(--accent)", opacity: 0.5, fontSize: "1.4em" }}>„</span>
        <NodeViewContent as="span" style={{ display: "inline" }} />
        <span aria-hidden style={{ color: "var(--accent)", opacity: 0.5, fontSize: "1.4em" }}>“</span>
      </div>
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
