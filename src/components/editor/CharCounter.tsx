import type { Editor } from "@tiptap/react";
import {
  TELEGRAM_MAX_TEXT_LENGTH,
  TELEGRAM_MAX_RICH_LENGTH,
  TELEGRAM_MAX_CAPTION_LENGTH,
  CHAR_COUNTER_WARNING_THRESHOLD,
  CHAR_COUNTER_DANGER_THRESHOLD,
} from "@/lib/constants";
import { useEditorStore } from "@/store/editorStore";
import { t, pluralWords } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import clsx from "clsx";

interface CharCounterProps {
  editor: Editor;
}

export function CharCounter({ editor }: CharCounterProps) {
  const count = editor.storage.characterCount?.characters() ?? 0;
  const publishMode = useEditorStore((s) => s.publishMode);
  useSettingsStore((s) => s.language);

  let hasMedia = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "blockImage" || node.type.name === "blockVideo") {
      hasMedia = true;
    }
  });

  const limit = hasMedia
    ? TELEGRAM_MAX_CAPTION_LENGTH
    : publishMode === "rich"
    ? TELEGRAM_MAX_RICH_LENGTH
    : TELEGRAM_MAX_TEXT_LENGTH;

  const warningAt = hasMedia ? Math.floor(TELEGRAM_MAX_CAPTION_LENGTH * 0.85) : CHAR_COUNTER_WARNING_THRESHOLD;
  const dangerAt  = hasMedia ? Math.floor(TELEGRAM_MAX_CAPTION_LENGTH * 0.97) : CHAR_COUNTER_DANGER_THRESHOLD;

  const pct        = Math.min(count / limit, 1);
  const isWarning  = count >= warningAt;
  const isDanger   = count >= dangerAt;
  const isOverflow = count > limit;

  const barColor = isOverflow || isDanger
    ? "var(--danger)"
    : isWarning
    ? "var(--warning)"
    : "var(--success)";

  const textColor = isOverflow
    ? "var(--danger)"
    : isDanger
    ? "var(--warning)"
    : "var(--text-muted)";

  const words = editor.storage.characterCount?.words() ?? 0;

  return (
    <div
      className="flex items-center gap-3 px-4 flex-shrink-0 border-t"
      style={{
        height: 32,
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--bg-surface)",
      }}
    >
      {hasMedia && (
        <span className="text-2xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
          {t("counter.caption")}
        </span>
      )}

      <span className="text-2xs flex-shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
        {pluralWords(words)}
      </span>

      <div
        className="flex-1 h-1 rounded-full overflow-hidden"
        style={{ backgroundColor: "var(--bg-elevated)" }}
      >
        <div
          className={clsx("h-full rounded-full transition-all duration-300", isOverflow && "animate-pulse")}
          style={{ width: `${pct * 100}%`, backgroundColor: barColor }}
        />
      </div>

      <span
        className={clsx("text-2xs font-medium tabular-nums flex-shrink-0", isOverflow && "animate-pulse")}
        style={{ color: textColor }}
      >
        {isOverflow ? (
          <span>+{count - limit} {t("counter.over")}</span>
        ) : (
          <span>{count.toLocaleString("ru")} / {limit.toLocaleString("ru")}</span>
        )}
      </span>
    </div>
  );
}
