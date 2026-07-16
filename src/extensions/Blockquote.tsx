import { Node, mergeAttributes, wrappingInputRule } from "@tiptap/core";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { t } from "@/lib/i18n";

const FORBIDDEN_IN_QUOTE = new Set(["blockImage", "blockVideo"]);

/** true, если в документе есть blockquote, содержащий картинку или видео */
function quoteContainsMedia(doc: PMNode): boolean {
  let bad = false;
  doc.descendants((node: PMNode) => {
    if (bad) return false;
    if (node.type.name === "blockquote") {
      node.descendants((child: PMNode) => {
        if (FORBIDDEN_IN_QUOTE.has(child.type.name)) bad = true;
        return !bad;
      });
      return false; // не углубляемся — уже проверили потомков
    }
    return true;
  });
  return bad;
}
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { ChevronsDownUp } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BlockquoteView({ node, updateAttributes }: any) {
  const expandable: boolean = node.attrs.expandable ?? false;
  // Rich messages don't support expandable quotes — only normal mode does.
  const canToggleExpandable = useEditorStore((s) => s.publishMode) === "normal";

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
          : "linear-gradient(to right, color-mix(in srgb, var(--accent) 5%, transparent), transparent)",
        color: "var(--text-secondary)",
        fontStyle: "italic",
        position: "relative",
      }}
    >
      {/* Editable content first — required by TipTap */}
      <NodeViewContent as="span" />

      {/* Toggle button — non-editable, floats in the corner. Hidden in Rich mode:
          Rich messages don't support expandable quotes at all. */}
      {canToggleExpandable && (
        <button
          contentEditable={false}
          onClick={() => updateAttributes({ expandable: !expandable })}
          title={expandable ? t("quote.makeNormal") : t("quote.makeCollapsible")}
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
          {expandable ? t("quote.collapsed") : t("quote.collapse")}
        </button>
      )}
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
        ({ commands, state }: any) => {
          const { selection } = state;
          // NodeSelection — клик по atom-ноде (картинка, видео)
          if (selection instanceof NodeSelection) {
            const name = selection.node.type.name;
            if (name === "blockImage" || name === "blockVideo") return false;
          }
          // TextSelection — проверяем предка верхнего уровня
          const topNode = selection.$from.depth >= 1 ? selection.$from.node(1) : null;
          if (topNode && (topNode.type.name === "blockImage" || topNode.type.name === "blockVideo")) {
            return false;
          }
          return commands.toggleWrap(this.name);
        },
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

  // Typing "> " at the start of a line converts it to a quote — matches the
  // markdown shortcut every other block editor (Notion included) supports.
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*>\s$/,
        type: this.type,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockquoteView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        // Отклоняем любую транзакцию, после которой картинка/видео
        // оказались бы внутри цитаты — перекрывает тулбар, bubble,
        // горячие клавиши, вставку и drag&drop разом.
        filterTransaction: (tr) => {
          if (!tr.docChanged) return true;
          return !quoteContainsMedia(tr.doc);
        },
      }),
    ];
  },
});
