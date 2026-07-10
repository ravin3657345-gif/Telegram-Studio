import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Anchor } from "lucide-react";
import { t } from "@/lib/i18n";

export const ANCHOR_TOP_NAME = "top";

function AnchorPointView() {
  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        margin: "6px 0",
        padding: "3px 10px",
        borderRadius: 6,
        border: "1px dashed var(--border-default)",
        color: "var(--text-muted)",
        fontSize: 11,
        width: "fit-content",
        userSelect: "none",
      }}
    >
      <Anchor size={11} />
      <span>{t("anchor.marker")}</span>
    </NodeViewWrapper>
  );
}

// Invisible marker (`<a name="top"></a>` in Rich HTML output) that a
// "⬆ Наверх" link elsewhere in the post can jump back to. Only meaningful in
// Rich publish mode — Telegram's regular/Telegraph HTML don't support it.
export const BlockAnchor = Node.create({
  name: "anchorPoint",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-anchor-point]" }];
  },

  renderHTML() {
    return ["div", { "data-anchor-point": "true" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AnchorPointView);
  },
});
