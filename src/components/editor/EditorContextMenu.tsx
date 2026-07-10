import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  Heading1, Heading2, Heading3, Pilcrow, Quote, Code2,
  List, ListOrdered, Minus, Image, Film, HelpCircle, BarChart2, Trash2,
  ChevronsDownUp, Copy, CheckSquare, Lightbulb, Scissors,
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
}

interface MenuSection {
  header: string;
  items: MenuItem[];
}

// Every action below is anchored to the explicit `pos`/`node` the menu was
// opened for, rather than "whatever the current selection happens to be" —
// clicking the external "⋯" button can shift DOM focus away from the editor
// before the click handler even runs, which was silently losing an
// earlier-set selection and making "Изменить тип" act on the wrong block
// (or nothing) depending on timing. Setting the selection and applying the
// change in the same synchronous chain removes that race entirely.
function deleteBlockAt(editor: Editor, pos: number, node: PMNode) {
  editor.chain().focus().command(({ tr, dispatch }) => {
    if (dispatch) dispatch(tr.delete(pos, pos + node.nodeSize));
    return true;
  }).run();
}

function insertNodeAt(editor: Editor, pos: number, content: Record<string, unknown>) {
  editor.chain().focus().insertContentAt(pos, content).run();
}

function insertImageAt(editor: Editor, pos: number) {
  editor.chain().focus().setTextSelection(pos).run();
  document.getElementById("editor-image-input")?.click();
}

function insertVideoAt(editor: Editor, pos: number) {
  editor.chain().focus().setTextSelection(pos).run();
  document.getElementById("editor-video-input")?.click();
}

function insertPollAt(editor: Editor, pos: number) {
  const mode = useEditorStore.getState().publishMode;
  if (mode === "rich" || mode === "telegraph") {
    useUiStore.getState().toast("warning", t("context.pollWarning"), t("context.pollHint"));
    return;
  }
  insertNodeAt(editor, pos, {
    type: "blockPoll",
    attrs: { question: "", options: ["", ""], isAnonymous: true, allowsMultipleAnswers: false },
  });
}

// Items that insert a brand-new block at an explicit position — used both for
// "empty space" (position = end of doc) and "insert after this block".
function makeInsertItems(editor: Editor, pos: number): MenuItem[] {
  return [
    { icon: Pilcrow,     label: t("context.paragraph"),   action: () => insertNodeAt(editor, pos, { type: "paragraph" }) },
    { icon: Heading1,    label: t("context.h1"),          action: () => insertNodeAt(editor, pos, { type: "heading", attrs: { level: 1 } }) },
    { icon: Heading2,    label: t("context.h2"),          action: () => insertNodeAt(editor, pos, { type: "heading", attrs: { level: 2 } }) },
    { icon: Heading3,    label: t("context.h3"),          action: () => insertNodeAt(editor, pos, { type: "heading", attrs: { level: 3 } }) },
    { icon: Quote,       label: t("context.quote"),       action: () => insertNodeAt(editor, pos, { type: "blockquote", content: [{ type: "paragraph" }] }) },
    { icon: Code2,       label: t("context.codeBlock"),   action: () => insertNodeAt(editor, pos, { type: "codeBlock" }) },
    { icon: List,        label: t("context.list"),        action: () => insertNodeAt(editor, pos, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }) },
    { icon: ListOrdered, label: t("context.orderedList"), action: () => insertNodeAt(editor, pos, { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }) },
    { icon: CheckSquare, label: t("context.checklist"),   action: () => insertNodeAt(editor, pos, { type: "checkItem", attrs: { checked: false } }) },
    { icon: Lightbulb,   label: t("context.callout"),     action: () => insertNodeAt(editor, pos, { type: "callout", attrs: { emoji: "💡" }, content: [{ type: "paragraph" }] }) },
    { icon: Minus,       label: t("context.divider"),     action: () => insertNodeAt(editor, pos, { type: "horizontalRule" }) },
    { icon: Image,       label: t("context.image"),       action: () => insertImageAt(editor, pos) },
    { icon: Film,        label: t("context.video"),       action: () => insertVideoAt(editor, pos) },
    { icon: HelpCircle,  label: t("context.faq"),         action: () => insertNodeAt(editor, pos, { type: "blockFaq", attrs: { question: "", answer: "" } }) },
    { icon: BarChart2,   label: t("context.poll"),        action: () => insertPollAt(editor, pos) },
  ];
}

// "Convert to" only makes sense for text/container blocks (paragraph, heading,
// quote, code, lists), never for atom blocks (image, video, poll, faq,
// document, divider), which have nothing to convert. `pos` anchors the
// selection to the block the menu was actually opened for (see note above).
function makeConvertItems(editor: Editor, pos: number): MenuItem[] {
  const at = () => editor.chain().focus().setTextSelection(pos + 1);
  return [
    { icon: Pilcrow,     label: t("context.paragraph"),   action: () => at().setParagraph().run() },
    { icon: Heading1,    label: t("context.h1"),          action: () => at().setHeading({ level: 1 }).run() },
    { icon: Heading2,    label: t("context.h2"),          action: () => at().setHeading({ level: 2 }).run() },
    { icon: Heading3,    label: t("context.h3"),          action: () => at().setHeading({ level: 3 }).run() },
    { icon: Quote,       label: t("context.quote"),       action: () => at().toggleBlockquote().run() },
    { icon: Code2,       label: t("context.codeBlock"),   action: () => at().toggleCodeBlock().run() },
    { icon: List,        label: t("context.list"),        action: () => at().toggleBulletList().run() },
    { icon: ListOrdered, label: t("context.orderedList"), action: () => at().toggleOrderedList().run() },
  ];
}

function duplicateBlock(editor: Editor, pos: number, node: PMNode) {
  editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
}

// Manually force a message-split divider right before this block, regardless
// of length limits — the toolbar's Scissors button (useAutoSplit.recalculate)
// only auto-places dividers where the character limit is actually exceeded,
// so a short post has no way to split at an arbitrary point otherwise (e.g.
// to separate a <tg-collage> group from a <tg-slideshow> group, which
// Telegram rejects when combined in one Rich message). Locked so it survives
// the auto-split recompute that runs on every edit.
function insertSplitHere(editor: Editor, pos: number) {
  const index = editor.state.doc.resolve(pos).index(0);
  if (index <= 0) return;
  const { splitGaps, lockedGaps, setSplitGaps } = useEditorStore.getState();
  if (splitGaps.includes(index)) return;
  setSplitGaps([...splitGaps, index], [...lockedGaps, index]);
}

// Manage actions for the specific block under the cursor — duplicate/delete
// plus any block-type-specific toggles (currently: blockquote's collapsible
// switch, hidden in Rich mode since Rich messages don't support expandable quotes).
function makeManageItems(editor: Editor, pos: number, node: PMNode): MenuItem[] {
  const items: MenuItem[] = [
    { icon: Copy, label: t("context.duplicate"), action: () => duplicateBlock(editor, pos, node) },
    { icon: Scissors, label: t("context.splitHere"), action: () => insertSplitHere(editor, pos) },
    { icon: Trash2, label: t("context.delete"), action: () => deleteBlockAt(editor, pos, node) },
  ];
  if (node.type.name === "blockquote" && useEditorStore.getState().publishMode === "normal") {
    const expandable = (node.attrs.expandable as boolean) ?? false;
    items.push({
      icon: ChevronsDownUp,
      label: expandable ? t("quote.makeNormal") : t("quote.makeCollapsible"),
      action: () => {
        editor.chain().focus().setTextSelection(pos + 1).run();
        (editor.commands as any).toggleBlockquoteExpandable();
      },
    });
  }
  return items;
}

function buildSections(editor: Editor, blockPos: number | null): MenuSection[] {
  const node = blockPos !== null ? editor.state.doc.nodeAt(blockPos) : null;

  if (blockPos === null || !node) {
    return [
      { header: t("context.insertBlock"), items: makeInsertItems(editor, editor.state.doc.content.size) },
    ];
  }

  const sections: MenuSection[] = [
    { header: t("context.manageBlock"), items: makeManageItems(editor, blockPos, node) },
  ];
  if (!node.isAtom) {
    sections.push({ header: t("context.convertTo"), items: makeConvertItems(editor, blockPos) });
  }
  sections.push({ header: t("context.insertAfter"), items: makeInsertItems(editor, blockPos + node.nodeSize) });
  return sections;
}

interface EditorContextMenuProps {
  editor: Editor;
  x: number;
  y: number;
  blockPos: number | null;
  onClose: () => void;
}

export function EditorContextMenu({ editor, x, y, blockPos, onClose }: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuW = 200;
  const [coords, setCoords] = useState(() => ({
    left: Math.min(x, window.innerWidth - menuW - 8),
    top: y,
    maxHeight: window.innerHeight - y - 8,
  }));

  const sections = buildSections(editor, blockPos);

  // With ~25+ items across three sections, this menu is routinely taller
  // than the viewport — it always scrolls internally (maxHeight+overflow
  // below), so positioning must never try to fit the WHOLE menu on screen by
  // flipping it wholesale. Instead: anchor to whichever side (below/above the
  // click point) has more room, and clip maxHeight to exactly that much space
  // — the menu's edge nearest the click point stays glued to it either way,
  // rather than snapping to the top of the screen once it's too tall for both.
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const left = Math.min(x, vw - menuW - 8);
    const spaceBelow = vh - y - 8;
    const spaceAbove = y - 8;

    let top: number;
    let maxHeight: number;
    if (menuH <= spaceBelow || spaceBelow >= spaceAbove) {
      top = y;
      maxHeight = spaceBelow;
    } else {
      maxHeight = spaceAbove;
      top = Math.max(8, y - Math.min(menuH, spaceAbove));
    }
    setCoords({ left, top, maxHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, blockPos]);

  useLayoutEffect(() => {
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

  return createPortal(
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -4 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{
        position: "fixed",
        left: coords.left,
        top: coords.top,
        zIndex: 9998,
        minWidth: menuW,
        maxHeight: coords.maxHeight,
        overflowY: "auto",
        backgroundColor: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        borderRadius: 10,
        padding: "4px 0",
        userSelect: "none",
      }}
    >
      {sections.map((section, si) => (
        <div key={si} style={{ paddingTop: si > 0 ? 5 : 0 }}>
          {si > 0 && (
            <div style={{ height: 1, backgroundColor: "var(--border-default)", margin: "0 0 5px" }} />
          )}
          {/* Full-width tinted "shelf" — a thin divider + plain gray label reads
              as one continuous list once there are 20+ rows; a background band
              makes each group's boundary obvious at a glance. */}
          <div
            className="px-3 text-2xs font-bold uppercase"
            style={{
              color: "var(--text-muted)",
              letterSpacing: "0.07em",
              backgroundColor: "var(--bg-hover)",
              paddingTop: 5,
              paddingBottom: 5,
              marginBottom: 2,
            }}
          >
            {section.header}
          </div>
          {section.items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={i}
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
            );
          })}
        </div>
      ))}
    </motion.div>,
    document.body
  );
}
