import { BubbleMenu, type Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Strikethrough, Code, EyeOff,
  Link, Eraser,
} from "lucide-react";
import { ColorPicker } from "./ColorPicker";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";

interface InlineBubbleMenuProps {
  editor: Editor;
  onLinkClick: () => void;
}

export function InlineBubbleMenu({ editor, onLinkClick }: InlineBubbleMenuProps) {
  useSettingsStore((s) => s.language);
  const isMobile = useIsMobileLayout();
  // Desktop keeps 24px buttons (mouse); mobile bumps the whole bar up to
  // thumb-sized 32px targets and larger glyphs — a text-selection bubble is
  // already hard to hit on touch, the buttons inside shouldn't make it worse.
  const iconSize = isMobile ? 15 : 13;

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 100,
        placement: "top",
        offset: [0, 6],
        arrow: false,
        onMount(instance) {
          const box = instance.popper.querySelector<HTMLElement>(".tippy-box");
          if (box) box.style.cssText = "background:none;border:none;box-shadow:none;padding:0;max-width:none;border-radius:0;";
          const content = instance.popper.querySelector<HTMLElement>(".tippy-content");
          if (content) content.style.cssText = "padding:0;";
        },
      }}
      shouldShow={({ from, to, editor: ed }) => {
        if (from === to) return false;
        // Не показывать меню если выделен блок изображения или видео
        let hasMedia = false;
        ed.state.doc.nodesBetween(from, to, (node) => {
          if (node.type.name === "blockImage" || node.type.name === "blockVideo") hasMedia = true;
        });
        return !hasMedia;
      }}
    >
      <div
        className="flex items-center gap-0.5 rounded-lg"
        style={{
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          padding: isMobile ? "4px 6px" : "2px 4px",
        }}
      >
        <BubbleBtn
          title={t("bubble.bold")}
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={iconSize} />
        </BubbleBtn>
        <BubbleBtn
          title={t("bubble.italic")}
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={iconSize} />
        </BubbleBtn>
        <BubbleBtn
          title={t("bubble.underline")}
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline size={iconSize} />
        </BubbleBtn>
        <BubbleBtn
          title={t("bubble.strike")}
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={iconSize} />
        </BubbleBtn>
        <BubbleBtn
          title={t("bubble.code")}
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code size={iconSize} />
        </BubbleBtn>
        <BubbleBtn
          title={t("bubble.spoiler")}
          active={editor.isActive("spoiler")}
          onClick={() => editor.chain().focus().toggleSpoiler().run()}
        >
          <EyeOff size={iconSize} />
        </BubbleBtn>

        <Divider />

        <BubbleBtn
          title={t("bubble.link")}
          active={editor.isActive("link")}
          onClick={onLinkClick}
        >
          <Link size={iconSize} />
        </BubbleBtn>

        <Divider />

        <ColorPicker editor={editor} />

        <Divider />

        <BubbleBtn
          title={t("bubble.clear")}
          active={false}
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        >
          <Eraser size={iconSize} />
        </BubbleBtn>
      </div>
    </BubbleMenu>
  );
}

function Divider() {
  return (
    <div
      className="w-px mx-0.5 self-stretch"
      style={{ backgroundColor: "var(--border-subtle)", minHeight: 16 }}
    />
  );
}

function BubbleBtn({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  const isMobile = useIsMobileLayout();
  const size = isMobile ? 32 : 24;
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center rounded transition-colors"
      style={{
        width: size,
        height: size,
        backgroundColor: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--text-secondary)",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {children}
    </button>
  );
}
