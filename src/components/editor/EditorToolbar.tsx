import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Strikethrough, EyeOff,
  Quote, List, ListOrdered, Link, Smile, Image, Film,
  Heading1, Heading2, Heading3, Code2, Minus,
  Undo2, Redo2, Code, FileUp, Scissors,
  Subscript as SubscriptIcon, Superscript as SuperscriptIcon,
  Highlighter, ChevronsDownUp, Anchor, Music,
} from "lucide-react";
import { ToolbarButton, ToolbarSeparator } from "./ToolbarButton";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useEditorStore } from "@/store/editorStore";
import { useUiStore } from "@/store/uiStore";
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
  onMediaClick: (type: "image" | "video" | "file" | "audio") => void;
  onHtmlView: () => void;
  showHtmlView: boolean;
  onSplitClick?: () => void;
  splitActive?: boolean;
}

export function EditorToolbar({
  editor,
  onLinkClick,
  onEmojiClick,
  onMediaClick,
  onHtmlView,
  showHtmlView,
  onSplitClick,
  splitActive,
}: EditorToolbarProps) {
  useSettingsStore((s) => s.language);
  const publishMode = useEditorStore((s) => s.publishMode);
  const anchorLinkText = useSettingsStore((s) => s.anchorLinkText);
  const toast = useUiStore((s) => s.toast);

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

  return (
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
      <ToolbarButton
        title={t("toolbar.undo")}
        icon={Undo2}
        isActive={false}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      />
      <ToolbarButton
        title={t("toolbar.redo")}
        icon={Redo2}
        isActive={false}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      />

      <ToolbarSeparator />

      <ToolbarButton
        title={withHint(t("toolbar.h1"), publishMode === "normal" ? t("toolbar.headingDegrades") : null)}
        icon={Heading1}
        isActive={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolbarButton
        title={withHint(t("toolbar.h2"), publishMode === "normal" ? t("toolbar.headingDegrades") : null)}
        icon={Heading2}
        isActive={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        title={withHint(t("toolbar.h3"), publishMode === "normal" ? t("toolbar.heading3Degrades") : null)}
        icon={Heading3}
        isActive={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />

      <ToolbarSeparator />

      <ToolbarButton title={t("toolbar.bold")} icon={Bold}
        isActive={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().toggleBold()}
      />
      <ToolbarButton title={t("toolbar.italic")} icon={Italic}
        isActive={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().toggleItalic()}
      />
      <ToolbarButton title={t("toolbar.underline")} icon={Underline}
        isActive={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}
        disabled={!editor.can().toggleUnderline()}
      />
      <ToolbarButton title={t("toolbar.strike")} icon={Strikethrough}
        isActive={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().toggleStrike()}
      />
      <ToolbarButton title={t("toolbar.code")} icon={Code}
        isActive={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}
        disabled={!editor.can().toggleCode()}
      />
      <ToolbarButton
        title={t("toolbar.spoiler")}
        icon={EyeOff}
        isActive={editor.isActive("spoiler")} onClick={() => editor.chain().focus().toggleSpoiler().run()}
        disabled={!editor.can().toggleMark("spoiler")}
      />
      <ToolbarButton
        title={withHint(t("toolbar.subscript"), publishMode !== "rich" ? t("toolbar.richOnlyFormat") : null)}
        icon={SubscriptIcon}
        isActive={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()}
      />
      <ToolbarButton
        title={withHint(t("toolbar.superscript"), publishMode !== "rich" ? t("toolbar.richOnlyFormat") : null)}
        icon={SuperscriptIcon}
        isActive={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()}
      />
      <ToolbarButton
        title={withHint(t("toolbar.highlight"), publishMode !== "rich" ? t("toolbar.richOnlyFormat") : null)}
        icon={Highlighter}
        isActive={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}
      />

      <ToolbarSeparator />

      <ToolbarButton title={t("toolbar.quote")} icon={Quote}
        isActive={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}
        disabled={!editor.can().toggleBlockquote()}
      />
      {editor.isActive("blockquote") && (
        <ToolbarButton
          title={
            // Rich messages don't support the `expandable` attribute —
            // only the normal publish mode does.
            publishMode !== "normal"
              ? t("toolbar.collapsibleUnavail")
              : editor.getAttributes("blockquote").expandable
                ? t("toolbar.makeNormal")
                : t("toolbar.makeCollapsible")
          }
          icon={ChevronsDownUp}
          isActive={!!editor.getAttributes("blockquote").expandable}
          disabled={publishMode !== "normal"}
          onClick={() => {
            if (publishMode !== "normal") {
              toast("warning", t("toolbar.collapsibleUnavail"), t("toolbar.collapsibleUnavailHint"));
              return;
            }
            (editor.commands as any).toggleBlockquoteExpandable();
          }}
        />
      )}
      <ToolbarButton title={t("toolbar.codeBlock")} icon={Code2}
        isActive={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        disabled={!editor.can().toggleCodeBlock()}
      />
      <ToolbarButton
        title={withHint(t("toolbar.list"), publishMode === "normal" ? t("toolbar.listDegrades") : null)}
        icon={List}
        isActive={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={!editor.can().toggleBulletList()}
      />
      <ToolbarButton
        title={withHint(t("toolbar.orderedList"), publishMode === "normal" ? t("toolbar.listDegrades") : null)}
        icon={ListOrdered}
        isActive={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={!editor.can().toggleOrderedList()}
      />
      <ToolbarButton
        title={withHint(t("toolbar.divider"), publishMode === "normal" ? t("toolbar.dividerDegrades") : null)}
        icon={Minus}
        isActive={false} onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />

      <ToolbarSeparator />

      <ToolbarButton title={t("toolbar.link")} icon={Link}
        isActive={editor.isActive("link")} onClick={onLinkClick}
      />
      <ToolbarButton title={t("toolbar.emoji")} icon={Smile} isActive={false} onClick={onEmojiClick} />
      <ToolbarButton
        title={
          publishMode !== "rich"
            ? `${t("anchor.insert")} — ${t("anchor.unavail")}`
            : t("anchor.insert")
        }
        icon={Anchor}
        isActive={false}
        disabled={publishMode !== "rich"}
        onClick={() => {
          if (publishMode !== "rich") {
            toast("warning", t("anchor.unavail"), t("anchor.unavailHint"));
            return;
          }
          insertJumpToTopLink(editor, anchorLinkText.trim() || t("anchor.linkText"));
        }}
      />

      <ToolbarSeparator />

      <ToolbarButton title={t("toolbar.image")} icon={Image} isActive={false} onClick={() => onMediaClick("image")} />
      <ToolbarButton title={t("toolbar.video")} icon={Film} isActive={false} onClick={() => onMediaClick("video")} />
      <ToolbarButton
        title={
          publishMode !== "normal"
            ? `${t("toolbar.file")} — ${t("toolbar.fileWarning")}`
            : t("toolbar.file")
        }
        icon={FileUp}
        isActive={false}
        disabled={publishMode !== "normal"}
        onClick={() => {
          if (publishMode !== "normal") {
            toast("warning", t("toolbar.fileWarning"), t("toolbar.fileHint"));
            return;
          }
          onMediaClick("file");
        }}
      />
      <ToolbarButton
        title={
          publishMode !== "rich"
            ? `${t("toolbar.audio")} — ${t("slash.audioWarning")}`
            : t("toolbar.audio")
        }
        icon={Music}
        isActive={false}
        disabled={publishMode !== "rich"}
        onClick={() => {
          if (publishMode !== "rich") {
            toast("warning", t("slash.audioWarning"), t("slash.audioHint"));
            return;
          }
          onMediaClick("audio");
        }}
      />

      <ToolbarSeparator />

      <ToolbarButton
        title={t("toolbar.html")}
        icon={() => (
          <span className="text-2xs font-mono font-bold leading-none">&lt;/&gt;</span>
        )}
        isActive={showHtmlView}
        onClick={onHtmlView}
      />

      {onSplitClick && (
        <>
          <ToolbarSeparator />
          <ToolbarButton
            title={t("toolbar.split")}
            icon={Scissors}
            isActive={!!splitActive}
            onClick={onSplitClick}
          />
        </>
      )}
    </div>
  );
}
