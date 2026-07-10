import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { Check } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CheckItemView({ node, updateAttributes }: any) {
  const checked = !!node.attrs.checked;

  return (
    <NodeViewWrapper as="div" style={{ position: "relative", margin: "3px 0", paddingLeft: 24, minHeight: 18 }}>
      {/* Editable content first — required by TipTap (see Blockquote.tsx),
          the checkbox is a non-editable control absolutely positioned over
          the reserved left padding — same pattern as Blockquote's corner
          toggle button, just anchored left instead of top-right. Avoids
          flex `order` entirely, so DOM order and visual order always match
          (matters for cursor/keyboard navigation inside the text). */}
      <NodeViewContent
        as="span"
        style={{
          display: "inline-block",
          minWidth: 1,
          textDecoration: checked ? "line-through" : "none",
          color: checked ? "var(--text-muted)" : "var(--text-primary)",
          transition: "color 0.15s ease",
        }}
      />
      <button
        contentEditable={false}
        onClick={() => updateAttributes({ checked: !checked })}
        style={{
          position: "absolute",
          left: 0,
          top: 2,
          width: 16,
          height: 16,
          borderRadius: 4,
          border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-default)"}`,
          background: checked ? "var(--accent)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          transition: "background-color 0.12s ease, border-color 0.12s ease, transform 0.12s ease",
        }}
        onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(0.85)"; }}
        onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
      >
        {checked && <Check size={11} color="#fff" strokeWidth={3} />}
      </button>
    </NodeViewWrapper>
  );
}

export const BlockCheckItem = Node.create({
  name: "checkItem",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-checked") === "true",
        renderHTML: (attrs) => ({ "data-checked": attrs.checked ? "true" : "false" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-check-item]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-check-item": "" }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CheckItemView);
  },

  // TipTap's default splitBlock exits to a plain paragraph when the cursor is
  // at the end of the block — fine for headings, but it would turn "press
  // Enter to add the next to-do" into "press Enter to leave the checklist".
  // Force the split to stay a checkItem, and only exit to a paragraph when
  // the current item is empty (matches how list exits work everywhere else).
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== this.name) return false;

        if ($from.parent.content.size === 0) {
          return this.editor.chain().focus().setParagraph().run();
        }

        return this.editor
          .chain()
          .focus()
          .command(({ tr, dispatch }) => {
            if (dispatch) {
              tr.split(tr.selection.from, 1, [{ type: this.type, attrs: { checked: false } }]);
            }
            return true;
          })
          .run();
      },
    };
  },
});
