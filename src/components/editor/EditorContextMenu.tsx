import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Heading1, Heading2, Heading3, Pilcrow, Quote, Code2,
  List, ListOrdered, Minus, Image, Film, HelpCircle, BarChart2, Trash2,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useEditorStore } from "@/store/editorStore";
import { useUiStore } from "@/store/uiStore";
import { t } from "@/lib/i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconType = React.ComponentType<any>;

interface MenuItem {
  icon: IconType;
  label: string;
  action: () => void;
  divider?: boolean;
}

function deleteCurrentBlock(editor: Editor) {
  editor.chain().focus().command(({ state, dispatch }) => {
    const { selection, tr } = state;
    const { $from } = selection;
    if ("node" in selection) {
      if (dispatch) dispatch(tr.deleteSelection());
      return true;
    }
    if ($from.depth < 1) return false;
    const pos  = $from.before(1);
    const node = $from.node(1);
    if (!node || node.type.name === "doc") return false;
    if (dispatch) dispatch(tr.delete(pos, pos + node.nodeSize));
    return true;
  }).run();
}

function buildItems(editor: Editor): MenuItem[] {
  return [
    {
      icon: Trash2,
      label: t("context.delete"),
      action: () => deleteCurrentBlock(editor),
    },
    {
      icon: Pilcrow,
      label: t("context.paragraph"),
      divider: true,
      action: () => editor.chain().focus().setParagraph().run(),
    },
    {
      icon: Heading1,
      label: t("context.h1"),
      action: () => editor.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      icon: Heading2,
      label: t("context.h2"),
      action: () => editor.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      icon: Heading3,
      label: t("context.h3"),
      action: () => editor.chain().focus().setHeading({ level: 3 }).run(),
      divider: true,
    },
    {
      icon: Quote,
      label: t("context.quote"),
      action: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      icon: Code2,
      label: t("context.codeBlock"),
      action: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      icon: List,
      label: t("context.list"),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      label: t("context.orderedList"),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      icon: Minus,
      label: t("context.divider"),
      action: () => editor.chain().focus().setHorizontalRule().run(),
      divider: true,
    },
    {
      icon: Image,
      label: t("context.image"),
      action: () => document.getElementById("editor-image-input")?.click(),
    },
    {
      icon: Film,
      label: t("context.video"),
      action: () => document.getElementById("editor-video-input")?.click(),
      divider: true,
    },
    {
      icon: HelpCircle,
      label: t("context.faq"),
      action: () =>
        editor.commands.insertContent({ type: "blockFaq", attrs: { question: "", answer: "" } }),
    },
    {
      icon: BarChart2,
      label: t("context.poll"),
      action: () => {
        const mode = useEditorStore.getState().publishMode;
        if (mode === "rich" || mode === "telegraph") {
          useUiStore.getState().toast("warning", t("context.pollWarning"), t("context.pollHint"));
          return;
        }
        editor.commands.insertContent({
          type: "blockPoll",
          attrs: { question: "", options: ["", ""], isAnonymous: true, allowsMultipleAnswers: false },
        });
      },
    },
  ];
}

interface EditorContextMenuProps {
  editor: Editor;
  x: number;
  y: number;
  onClose: () => void;
}

export function EditorContextMenu({ editor, x, y, onClose }: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleDown, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 200;
  const menuH = 530;
  const left = Math.min(x, vw - menuW - 8);
  const spaceBelow = vh - y - 8;
  const top  = spaceBelow >= menuH ? y : Math.max(8, y - menuH);

  const items = buildItems(editor);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9998,
        minWidth: menuW,
        maxHeight: vh - 16,
        overflowY: "auto",
        backgroundColor: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        borderRadius: 10,
        padding: "4px 0",
        userSelect: "none",
      }}
    >
      <div
        className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        {t("context.insertBlock")}
      </div>
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <div key={i}>
            {item.divider && (
              <div
                style={{ height: 1, backgroundColor: "var(--border-subtle)", margin: "4px 8px" }}
              />
            )}
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
              onClick={() => {
                item.action();
                onClose();
              }}
            >
              <Icon size={14} strokeWidth={1.75} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
              {item.label}
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
