import type { Editor } from "@tiptap/react";
import {
  TELEGRAM_MAX_RICH_LENGTH,
  TELEGRAM_MAX_CAPTION_LENGTH,
  CHAR_COUNTER_WARNING_THRESHOLD,
  CHAR_COUNTER_DANGER_THRESHOLD,
  resolveMessageLimit,
} from "@/lib/constants";
import { useEditorStore } from "@/store/editorStore";
import { t, ti, pluralWords } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { Scissors } from "lucide-react";
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

  const limit = resolveMessageLimit(publishMode, hasMedia);

  const warningAt =
    publishMode === "rich" ? Math.floor(TELEGRAM_MAX_RICH_LENGTH * 0.85) :
    hasMedia ? Math.floor(TELEGRAM_MAX_CAPTION_LENGTH * 0.85) :
    CHAR_COUNTER_WARNING_THRESHOLD;
  const dangerAt =
    publishMode === "rich" ? Math.floor(TELEGRAM_MAX_RICH_LENGTH * 0.97) :
    hasMedia ? Math.floor(TELEGRAM_MAX_CAPTION_LENGTH * 0.97) :
    CHAR_COUNTER_DANGER_THRESHOLD;

  const splitGaps = useEditorStore((s) => s.splitGaps);
  const msgCount  = splitGaps.length + 1;
  // Rich mode splits into multiple sendRichMessage calls exactly like normal
  // mode splits into multiple sendMessage calls (see PublishPanel.tsx's
  // publishViaRichMessage, which already iterates splitJsonAtGaps chunks) —
  // excluding it here just made the counter show a misleading "N over" danger
  // state on a post that Telegram will actually accept just fine, split.
  const isSplit   = splitGaps.length > 0 && !hasMedia;

  const pct       = isSplit ? 1 : Math.min(count / limit, 1);
  const isWarning = !isSplit && count >= warningAt;
  const isDanger  = !isSplit && count >= dangerAt;
  const isOverflow = !isSplit && count > limit;

  const barColor = isSplit
    ? "var(--accent)"
    : isOverflow || isDanger
    ? "var(--danger)"
    : isWarning
    ? "var(--warning)"
    : "var(--success)";

  const textColor = isSplit
    ? "var(--accent)"
    : isOverflow
    ? "var(--danger)"
    : isDanger
    ? "var(--warning)"
    : "var(--text-muted)";

  const words = editor.storage.characterCount?.words() ?? 0;

  return (
    <div
      className="char-counter-root flex items-center gap-3 px-4 flex-shrink-0 border-t"
      style={{
        height: 32,
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--bg-surface)",
      }}
    >
      {hasMedia && publishMode !== "rich" && (
        <span className="text-2xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
          {t("counter.caption")}
        </span>
      )}

      <span className="text-2xs flex-shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
        {pluralWords(words)}
      </span>

      <div
        className="char-counter-bar flex-1 h-1 rounded-full overflow-hidden"
        style={{ backgroundColor: "var(--bg-elevated)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct * 100}%`, backgroundColor: barColor }}
        />
      </div>

      <span
        className={clsx("char-counter-text text-2xs font-medium tabular-nums flex-shrink-0 flex items-center gap-1")}
        style={{ color: textColor }}
      >
        {isSplit ? (
          <>
            <Scissors size={10} />
            {ti("counter.splitHint", { n: msgCount })}
          </>
        ) : isOverflow ? (
          <span className="animate-pulse">+{count - limit} {t("counter.over")}</span>
        ) : (
          <span>{count.toLocaleString("ru")} / {limit.toLocaleString("ru")}</span>
        )}
      </span>
    </div>
  );
}
