import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Strikethrough, EyeOff,
  Quote, List, ListOrdered, Link, Smile, Image, Film,
  Heading1, Heading2, Heading3, Code2, Minus, MoreHorizontal,
  Undo2, Redo2, Code, FileUp, Scissors, LayoutGrid,
  Subscript as SubscriptIcon, Superscript as SuperscriptIcon,
  Highlighter, ChevronsDownUp, Anchor, Music, ClipboardType,
} from "lucide-react";
import { ToolbarButton, ToolbarSeparator } from "./ToolbarButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { BlockPalette } from "./BlockPalette";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useEditorStore } from "@/store/editorStore";
import { useUiStore } from "@/store/uiStore";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import { ANCHOR_TOP_NAME } from "@/extensions/BlockAnchor";

// Inserts (once) an invisible anchor marker at the very start of the post,
// then drops a jump-back link at the current cursor position — text is
// whatever the user set in Settings (settings.anchorLinkText), defaulting to
// the translated "👆 Лифт". Rich-message-only — Telegram's regular HTML
// doesn't support in-document anchors (Bot API 10.1, June 2026).
function insertJumpToTopLink(editor: Editor, linkText: string) {
  const { state, view } = editor;
  const { schema } = state;

  let hasAnchor = false;
  state.doc.descendants((node) => {
    if (node.type.name === "anchorPoint") hasAnchor = true;
  });

  const tr = state.tr;
  if (!hasAnchor) {
    tr.insert(0, schema.nodes.anchorPoint.create());
  }

  const insertPos = tr.mapping.map(state.selection.to);
  const linkMark = schema.marks.link.create({ href: `#${ANCHOR_TOP_NAME}` });
  tr.insert(insertPos, schema.text(linkText, [linkMark]));

  view.dispatch(tr);
  editor.commands.focus();
}

interface EditorToolbarProps {
  editor: Editor;
  onLinkClick: () => void;
  onEmojiClick: () => void;
  onSnippetClick: () => void;
  onMediaClick: (type: "image" | "video" | "file" | "audio") => void;
  onSplitClick?: () => void;
  splitActive?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconType = React.ComponentType<any>;

// Every button, in original visual order, as data instead of inline JSX —
// lets desktop (unchanged: full horizontal scroll strip, all buttons) and
// mobile (priority subset inline + rest in a BottomSheet, see below) render
// from the exact same definitions instead of risking the two lists drifting
// apart. `mobilePriority` marks the ~8 buttons the plan called out as
// always-visible on mobile (bold/italic/underline/H1-H3/list/image);
// everything else — including undo/redo, which desktop keeps up front —
// moves into "Ещё" on mobile, where a labeled list row is more legible than
// a hover-only tooltip on an icon nobody can hover.
type ToolbarEntry =
  | { type: "separator" }
  | {
      type: "button";
      id: string;
      mobilePriority: boolean;
      title: string;
      icon: IconType;
      isActive: boolean;
      disabled?: boolean;
      onClick: () => void;
    };

export function EditorToolbar({
  editor,
  onLinkClick,
  onEmojiClick,
  onSnippetClick,
  onMediaClick,
  onSplitClick,
  splitActive,
}: EditorToolbarProps) {
  useSettingsStore((s) => s.language);
  const publishMode = useEditorStore((s) => s.publishMode);
  const anchorLinkText = useSettingsStore((s) => s.anchorLinkText);
  const toast = useUiStore((s) => s.toast);
  const isMobile = useIsMobileLayout();
  const [showMore, setShowMore] = useState(false);
  // Desktop already has BlockPalette permanently docked in the right sidebar
  // — this bottom sheet is purely the mobile substitute for that (no sidebar
  // room on a phone), reusing the exact same component instead of building a
  // second block-picker. BlockPalette's own tap-to-select-then-insert flow
  // already works without a mouse (drag is additive, not required).
  const [showAddBlock, setShowAddBlock] = useState(false);

  // Appends a short "— note" to a tooltip when this button's output looks/
  // behaves differently (or vanishes) in the current publish mode — purely
  // informational, unlike `disabled` which blocks the action outright.
  function withHint(base: string, hint: string | null): string {
    return hint ? `${base} — ${hint}` : base;
  }

  // Translate vertical wheel scroll into horizontal so the toolbar can be
  // scrolled with a normal mouse wheel when its buttons overflow (compact mode).
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
    // Ignore genuine horizontal scrolls (trackpads) — only remap vertical intent.
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
  }

  const entries: ToolbarEntry[] = [
    { type: "button", id: "undo", mobilePriority: false, title: t("toolbar.undo"), icon: Undo2, isActive: false,
      onClick: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
    { type: "button", id: "redo", mobilePriority: false, title: t("toolbar.redo"), icon: Redo2, isActive: false,
      onClick: () => editor.chain().focus().redo().run(), disabled: !editor.can().redo() },

    { type: "separator" },

    { type: "button", id: "h1", mobilePriority: true,
      title: withHint(t("toolbar.h1"), publishMode === "normal" ? t("toolbar.headingDegrades") : null),
      icon: Heading1, isActive: editor.isActive("heading", { level: 1 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { type: "button", id: "h2", mobilePriority: true,
      title: withHint(t("toolbar.h2"), publishMode === "normal" ? t("toolbar.headingDegrades") : null),
      icon: Heading2, isActive: editor.isActive("heading", { level: 2 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { type: "button", id: "h3", mobilePriority: true,
      title: withHint(t("toolbar.h3"), publishMode === "normal" ? t("toolbar.heading3Degrades") : null),
      icon: Heading3, isActive: editor.isActive("heading", { level: 3 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },

    { type: "separator" },

    { type: "button", id: "bold", mobilePriority: true, title: t("toolbar.bold"), icon: Bold,
      isActive: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run(),
      disabled: !editor.can().toggleBold() },
    { type: "button", id: "italic", mobilePriority: true, title: t("toolbar.italic"), icon: Italic,
      isActive: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run(),
      disabled: !editor.can().toggleItalic() },
    { type: "button", id: "underline", mobilePriority: true, title: t("toolbar.underline"), icon: Underline,
      isActive: editor.isActive("underline"), onClick: () => editor.chain().focus().toggleUnderline().run(),
      disabled: !editor.can().toggleUnderline() },
    { type: "button", id: "strike", mobilePriority: false, title: t("toolbar.strike"), icon: Strikethrough,
      isActive: editor.isActive("strike"), onClick: () => editor.chain().focus().toggleStrike().run(),
      disabled: !editor.can().toggleStrike() },
    { type: "button", id: "code", mobilePriority: false, title: t("toolbar.code"), icon: Code,
      isActive: editor.isActive("code"), onClick: () => editor.chain().focus().toggleCode().run(),
      disabled: !editor.can().toggleCode() },
    { type: "button", id: "spoiler", mobilePriority: false, title: t("toolbar.spoiler"), icon: EyeOff,
      isActive: editor.isActive("spoiler"), onClick: () => editor.chain().focus().toggleSpoiler().run(),
      disabled: !editor.can().toggleMark("spoiler") },
    { type: "button", id: "subscript", mobilePriority: false,
      title: withHint(t("toolbar.subscript"), publishMode !== "rich" ? t("toolbar.richOnlyFormat") : null),
      icon: SubscriptIcon, isActive: editor.isActive("subscript"),
      onClick: () => editor.chain().focus().toggleSubscript().run() },
    { type: "button", id: "superscript", mobilePriority: false,
      title: withHint(t("toolbar.superscript"), publishMode !== "rich" ? t("toolbar.richOnlyFormat") : null),
      icon: SuperscriptIcon, isActive: editor.isActive("superscript"),
      onClick: () => editor.chain().focus().toggleSuperscript().run() },
    { type: "button", id: "highlight", mobilePriority: false,
      title: withHint(t("toolbar.highlight"), publishMode !== "rich" ? t("toolbar.richOnlyFormat") : null),
      icon: Highlighter, isActive: editor.isActive("highlight"),
      onClick: () => editor.chain().focus().toggleHighlight().run() },

    { type: "separator" },

    { type: "button", id: "quote", mobilePriority: false, title: t("toolbar.quote"), icon: Quote,
      isActive: editor.isActive("blockquote"), onClick: () => editor.chain().focus().toggleBlockquote().run(),
      disabled: !editor.can().toggleBlockquote() },
    ...(editor.isActive("blockquote")
      ? [{
          type: "button" as const, id: "collapsible", mobilePriority: false,
          title:
            // Rich messages don't support the `expandable` attribute —
            // only the normal publish mode does.
            publishMode !== "normal"
              ? t("toolbar.collapsibleUnavail")
              : editor.getAttributes("blockquote").expandable
                ? t("toolbar.makeNormal")
                : t("toolbar.makeCollapsible"),
          icon: ChevronsDownUp,
          isActive: !!editor.getAttributes("blockquote").expandable,
          disabled: publishMode !== "normal",
          onClick: () => {
            if (publishMode !== "normal") {
              toast("warning", t("toolbar.collapsibleUnavail"), t("toolbar.collapsibleUnavailHint"));
              return;
            }
            (editor.commands as any).toggleBlockquoteExpandable();
          },
        }]
      : []),
    { type: "button", id: "codeBlock", mobilePriority: false, title: t("toolbar.codeBlock"), icon: Code2,
      isActive: editor.isActive("codeBlock"), onClick: () => editor.chain().focus().toggleCodeBlock().run(),
      disabled: !editor.can().toggleCodeBlock() },
    { type: "button", id: "list", mobilePriority: true,
      title: withHint(t("toolbar.list"), publishMode === "normal" ? t("toolbar.listDegrades") : null),
      icon: List, isActive: editor.isActive("bulletList"),
      onClick: () => editor.chain().focus().toggleBulletList().run(), disabled: !editor.can().toggleBulletList() },
    { type: "button", id: "orderedList", mobilePriority: false,
      title: withHint(t("toolbar.orderedList"), publishMode === "normal" ? t("toolbar.listDegrades") : null),
      icon: ListOrdered, isActive: editor.isActive("orderedList"),
      onClick: () => editor.chain().focus().toggleOrderedList().run(), disabled: !editor.can().toggleOrderedList() },
    { type: "button", id: "divider", mobilePriority: false,
      title: withHint(t("toolbar.divider"), publishMode === "normal" ? t("toolbar.dividerDegrades") : null),
      icon: Minus, isActive: false, onClick: () => editor.chain().focus().setHorizontalRule().run() },

    { type: "separator" },

    { type: "button", id: "link", mobilePriority: false, title: t("toolbar.link"), icon: Link,
      isActive: editor.isActive("link"), onClick: onLinkClick },
    { type: "button", id: "emoji", mobilePriority: false, title: t("toolbar.emoji"), icon: Smile,
      isActive: false, onClick: onEmojiClick },
    { type: "button", id: "snippet", mobilePriority: false, title: t("toolbar.snippet"), icon: ClipboardType,
      isActive: false, onClick: onSnippetClick },
    { type: "button", id: "anchor", mobilePriority: false,
      title: publishMode !== "rich" ? `${t("anchor.insert")} — ${t("anchor.unavail")}` : t("anchor.insert"),
      icon: Anchor, isActive: false, disabled: publishMode !== "rich",
      onClick: () => {
        if (publishMode !== "rich") {
          toast("warning", t("anchor.unavail"), t("anchor.unavailHint"));
          return;
        }
        insertJumpToTopLink(editor, anchorLinkText.trim() || t("anchor.linkText"));
      } },

    { type: "separator" },

    { type: "button", id: "image", mobilePriority: true, title: t("toolbar.image"), icon: Image,
      isActive: false, onClick: () => onMediaClick("image") },
    { type: "button", id: "video", mobilePriority: false, title: t("toolbar.video"), icon: Film,
      isActive: false, onClick: () => onMediaClick("video") },
    { type: "button", id: "file", mobilePriority: false,
      title: publishMode !== "normal" ? `${t("toolbar.file")} — ${t("toolbar.fileWarning")}` : t("toolbar.file"),
      icon: FileUp, isActive: false, disabled: publishMode !== "normal",
      onClick: () => {
        if (publishMode !== "normal") {
          toast("warning", t("toolbar.fileWarning"), t("toolbar.fileHint"));
          return;
        }
        onMediaClick("file");
      } },
    { type: "button", id: "audio", mobilePriority: false,
      title: publishMode !== "rich" ? `${t("toolbar.audio")} — ${t("slash.audioWarning")}` : t("toolbar.audio"),
      icon: Music, isActive: false, disabled: publishMode !== "rich",
      onClick: () => {
        if (publishMode !== "rich") {
          toast("warning", t("slash.audioWarning"), t("slash.audioHint"));
          return;
        }
        onMediaClick("audio");
      } },

    ...(onSplitClick
      ? ([
          { type: "separator" },
          { type: "button", id: "split", mobilePriority: false, title: t("toolbar.split"), icon: Scissors,
            isActive: !!splitActive, onClick: onSplitClick },
        ] as ToolbarEntry[])
      : []),
  ];

  const visibleEntries = isMobile
    ? entries.filter((e) => e.type === "button" && e.mobilePriority)
    : entries;
  const overflowEntries = entries.filter((e) => e.type === "button" && !e.mobilePriority);

  return (
    <>
      <div
        onWheel={handleWheel}
        className="flex items-center gap-0.5 px-2 flex-shrink-0 border-b overflow-x-auto toolbar-scroll"
        style={{
          height: 44,
          minHeight: 44,
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          scrollbarWidth: "thin",
          scrollbarColor: "var(--border-default) transparent",
        }}
      >
        {isMobile && (
          <ToolbarButton
            title={t("palette.title")}
            icon={LayoutGrid}
            isActive={showAddBlock}
            onClick={() => setShowAddBlock(true)}
          />
        )}

        {visibleEntries.map((e, i) =>
          e.type === "separator" ? (
            <ToolbarSeparator key={`sep-${i}`} />
          ) : (
            <ToolbarButton
              key={e.id}
              title={e.title}
              icon={e.icon}
              isActive={e.isActive}
              disabled={e.disabled}
              onClick={e.onClick}
            />
          )
        )}

        {isMobile && (
          <ToolbarButton
            title={t("toolbar.more")}
            icon={MoreHorizontal}
            isActive={showMore}
            onClick={() => setShowMore(true)}
          />
        )}
      </div>

      {isMobile && showAddBlock && (
        <BottomSheet title={t("palette.title")} onOpenChange={(open) => !open && setShowAddBlock(false)} maxHeight="75vh">
          {/* BlockPalette's `fill` mode expects a bounded-height flex parent
              (true of its desktop home, EditorPage.tsx's right panel) — the
              sheet body itself has no fixed height, just overflow-y:auto, so
              `flex-1` inside BlockPalette would have nothing to grow against
              without this explicit height. */}
          <div style={{ height: "65vh", display: "flex" }}>
            <BlockPalette editor={editor} fill />
          </div>
        </BottomSheet>
      )}

      {isMobile && showMore && (
        <BottomSheet title={t("toolbar.more")} onOpenChange={(open) => !open && setShowMore(false)}>
          {overflowEntries.map((e) => {
            if (e.type !== "button") return null;
            const Icon = e.icon;
            return (
              <button
                key={e.id}
                type="button"
                disabled={e.disabled}
                onClick={() => { e.onClick(); setShowMore(false); }}
                className="flex items-center gap-3 w-full text-left rounded-lg disabled:opacity-40"
                style={{
                  padding: "12px 14px",
                  backgroundColor: e.isActive ? "var(--accent-subtle)" : "transparent",
                  color: e.isActive ? "var(--accent)" : "var(--text-primary)",
                  fontSize: 14,
                }}
              >
                <Icon size={18} strokeWidth={e.isActive ? 2.25 : 1.75} style={{ flexShrink: 0 }} />
                {e.title}
              </button>
            );
          })}
        </BottomSheet>
      )}
    </>
  );
}
