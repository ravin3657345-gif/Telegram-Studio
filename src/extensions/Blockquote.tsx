import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { ChevronsDownUp } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BlockquoteView({ node, updateAttributes }: any) {
  const expandable: boolean = node.attrs.expandable ?? false;

  return (
    <NodeViewWrapper
      as="blockquote"
      style={{
        borderLeft: `3px solid ${expandable ? "#7ab0e0" : "var(--accent)"}`,
        padding: "6px 36px 6px 14px",
        margin: "0 0 14px",
        borderRadius: "0 6px 6px 0",
        background: expandable
          ? "linear-gradient(to right, rgba(122,176,224,0.1), transparent)"
          : "linear-gradient(to right, rgba(42,171,238,0.05), transparent)",
        color: "var(--text-secondary)",
        fontStyle: "italic",
        position: "relative",
      }}
    >
      {/* Editable content first — required by TipTap */}
      <NodeViewContent as="span" />

      {/* Toggle button — non-editable, floats in the corner */}
      <button
        contentEditable={false}
        onClick={() => updateAttributes({ expandable: !expandable })}
        title={expandable ? "Сделать обычной цитатой" : "Сделать сворачиваемой"}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "flex",
          alignItems: "center",
          gap: 3,
          padding: "2px 6px",
          fontSize: 10,
          lineHeight: 1.5,
          borderRadius: 4,
          border: `1px solid ${expandable ? "#7ab0e0" : "var(--border-muted, #444)"}`,
          background: expandable ? "rgba(122,176,224,0.18)" : "transparent",
          color: expandable ? "#7ab0e0" : "var(--text-muted, #888)",
          cursor: "pointer",
          userSelect: "none",
          fontStyle: "normal",
          transition: "all 0.15s",
        }}
      >
        <ChevronsDownUp size={10} />
        {expandable ? "Своротная" : "Свернуть"}
      </button>
    </NodeViewWrapper>
  );
}

export const Blockquote = Node.create({
  name: "blockquote",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      expandable: {
        default: false,
        parseHTML: (el) => el.hasAttribute("expandable"),
        renderHTML: (attrs) => (attrs.expandable ? { expandable: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "blockquote" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["blockquote", mergeAttributes({ class: "tiptap-blockquote" }, HTMLAttributes), 0];
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): any {
    return {
      setBlockquote:
        () =>
        ({ commands }: any) =>
          commands.wrapIn(this.name),
      toggleBlockquote:
        () =>
        ({ commands }: any) =>
          commands.toggleWrap(this.name),
      unsetBlockquote:
        () =>
        ({ commands }: any) =>
          commands.lift(this.name),
      toggleBlockquoteExpandable:
        () =>
        ({ editor, commands }: any) => {
          const current = editor.getAttributes("blockquote").expandable ?? false;
          return commands.updateAttributes("blockquote", { expandable: !current });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-b": () => this.editor.commands.toggleBlockquote(),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockquoteView);
  },
});
