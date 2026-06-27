import { useRef, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";

const MAX_CHARS = 100;

export function PostTitleInput() {
  const { postTitle, setPostTitle, includeTitle, setIncludeTitle } = useEditorStore();
  const ref = useRef<HTMLTextAreaElement>(null);
  const remaining = MAX_CHARS - postTitle.length;

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
        padding: "18px 40px 14px",
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={postTitle}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onInput={autoResize}
        placeholder="Заголовок поста…"
        className="w-full resize-none overflow-hidden bg-transparent text-2xl font-bold leading-tight outline-none"
        style={{
          color: includeTitle ? "var(--text-primary)" : "var(--text-muted)",
          caretColor: "var(--accent)",
          letterSpacing: "-0.3px",
          textDecoration: includeTitle ? "none" : "line-through",
          opacity: includeTitle ? 1 : 0.5,
          transition: "opacity 0.15s, color 0.15s",
        }}
      />

      {/* Toggle — включить/исключить заголовок из публикации */}
      <button
        onClick={() => setIncludeTitle(!includeTitle)}
        title={includeTitle ? "Не включать заголовок в публикацию" : "Включить заголовок в публикацию"}
        style={{
          position: "absolute",
          top: 16,
          right: 10,
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px 4px 8px",
          borderRadius: 8,
          border: `1.5px solid ${includeTitle ? "var(--accent)" : "var(--border-default)"}`,
          background: includeTitle ? "rgba(42,171,238,0.12)" : "var(--bg-elevated)",
          color: includeTitle ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 500,
          transition: "all 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        {includeTitle ? <Eye size={13} /> : <EyeOff size={13} />}
        <span>{includeTitle ? "Заголовок" : "Без заголовка"}</span>
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
