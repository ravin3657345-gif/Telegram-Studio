import { useRef, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import { useIsLandscape } from "@/hooks/useIsLandscape";

const MAX_CHARS = 100;

export function PostTitleInput() {
  const { postTitle, setPostTitle, includeTitle, setIncludeTitle } = useEditorStore();
  useSettingsStore((s) => s.language);
  const ref = useRef<HTMLTextAreaElement>(null);
  const remaining = MAX_CHARS - postTitle.length;
  // Landscape on a phone has ~360-400px of height total — the fixed 18/14px
  // padding + text-2xl this took regardless of orientation ate a large chunk
  // of that before any actual content showed (confirmed during planning: this
  // was one of several fixed-size chunks stacking up to the reported "тесно
  // в landscape" complaint). Portrait mobile and desktop are unaffected.
  // Both hooks called unconditionally (not `a() && b()`, which would skip
  // the second call — and thus violate React's hook-call-order rule —
  // whenever isMobile is false) then combined afterward.
  const isMobile = useIsMobileLayout();
  const isLandscape = useIsLandscape();
  const compact = isMobile && isLandscape;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value.replace(/\n/g, "");
    if (val.length <= MAX_CHARS) setPostTitle(val);
    autoResize();
  }

  function autoResize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => { autoResize(); }, [postTitle]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      document.querySelector<HTMLElement>(".tiptap")?.focus();
    }
  }

  return (
    <div
      className="relative border-b flex-shrink-0"
      style={{
        borderColor: "var(--border-subtle)",
        padding: compact ? "8px 100px 8px 20px" : "18px 145px 14px 40px",
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={postTitle}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onInput={autoResize}
        placeholder={t("editor.titlePlaceholder")}
        className={
          "post-title-input w-full resize-none overflow-hidden bg-transparent font-bold leading-tight outline-none "
          + (compact ? "text-lg" : "text-2xl")
        }
        style={{
          color: includeTitle ? "var(--text-primary)" : "var(--text-muted)",
          caretColor: "var(--accent)",
          letterSpacing: "-0.3px",
          textDecoration: includeTitle ? "none" : "line-through",
          opacity: includeTitle ? 1 : 0.5,
          transition: "opacity 0.15s, color 0.15s",
        }}
      />

      <button
        onClick={() => setIncludeTitle(!includeTitle)}
        title={includeTitle ? t("editor.includeTitleOn") : t("editor.includeTitleOff")}
        style={{
          position: "absolute",
          top: compact ? 8 : 16,
          right: 10,
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px 4px 8px",
          borderRadius: 8,
          border: `1.5px solid ${includeTitle ? "var(--accent)" : "var(--border-default)"}`,
          background: includeTitle ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--bg-elevated)",
          color: includeTitle ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 500,
          transition: "all 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        {includeTitle ? <Eye size={13} /> : <EyeOff size={13} />}
        <span>{includeTitle ? t("editor.withTitle") : t("editor.noTitle")}</span>
      </button>

      {remaining <= 20 && (
        <span
          className="absolute bottom-2.5 right-5 text-2xs tabular-nums select-none"
          style={{ color: remaining <= 5 ? "var(--danger)" : "var(--text-muted)" }}
        >
          {remaining}
        </span>
      )}
    </div>
  );
}
