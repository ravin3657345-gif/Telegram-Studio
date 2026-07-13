import { Paperclip, X, FileText, Plus } from "lucide-react";
import { useAttachmentStore } from "@/store/attachmentStore";
import { TELEGRAM_MAX_FILE_SIZE } from "@/lib/constants";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";

const WARN_BYTES = 40 * 1024 * 1024;

function shortSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

interface AttachmentZoneProps {
  onAddClick: () => void;
}

export function AttachmentZone({ onAddClick }: AttachmentZoneProps) {
  const { files, removeFile } = useAttachmentStore();
  useSettingsStore((s) => s.language);

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const isOver = totalBytes > TELEGRAM_MAX_FILE_SIZE;
  const isWarn = !isOver && totalBytes > WARN_BYTES;

  const barColor    = isOver ? "var(--danger)" : isWarn ? "var(--warning)" : "var(--success)";
  const countColor  = isOver ? "var(--danger)" : isWarn ? "var(--warning)" : "var(--text-secondary)";
  const barPct      = Math.min((totalBytes / TELEGRAM_MAX_FILE_SIZE) * 100, 100);
  const totalDisplay = totalBytes < 1024 * 1024
    ? `${Math.ceil(totalBytes / 1024)} КБ`
    : `${(totalBytes / 1024 / 1024).toFixed(1)} МБ`;

  return (
    <div
      className="border-t flex-shrink-0"
      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
    >
      {/* Main row */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 min-h-[46px]">
        {/* Paperclip icon — bigger */}
        <Paperclip
          size={16}
          style={{ color: "var(--text-muted)", flexShrink: 0 }}
        />

        {/* File chips or placeholder */}
        <div className="flex items-center gap-2 flex-1 flex-wrap overflow-hidden" style={{ maxHeight: 64 }}>
          {files.length === 0 ? (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("attach.empty")}
            </span>
          ) : (
            files.map((f) => (
              <div
                key={f.id}
                className="attachment-chip flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md flex-shrink-0"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  maxWidth: 200,
                }}
              >
                <FileText size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <span
                  className="text-xs truncate"
                  style={{ color: "var(--text-secondary)", maxWidth: 110 }}
                  title={f.name}
                >
                  {f.name}
                </span>
                <span className="text-2xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {shortSize(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="flex items-center justify-center rounded-full hover:bg-white/10 transition-colors flex-shrink-0 ml-0.5"
                  style={{ width: 18, height: 18, color: "var(--text-muted)" }}
                >
                  <X size={11} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add button — bigger and more prominent */}
        <button
          type="button"
          onClick={onAddClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--accent)] hover:text-white flex-shrink-0"
          style={{
            color: "var(--accent)",
            border: "1.5px solid var(--accent)",
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            transition: "all 0.15s",
          }}
        >
          <Plus size={13} />
          {t("attach.add")}
        </button>

        {/* Size counter — only when files exist */}
        {files.length > 0 && (
          <span
            className="text-xs tabular-nums font-medium flex-shrink-0"
            style={{ color: countColor }}
          >
            {totalDisplay}
            <span style={{ opacity: 0.5 }}> / 50МБ</span>
          </span>
        )}
      </div>

      {/* Progress bar — only when files exist */}
      {files.length > 0 && (
        <div
          className="mx-3 mb-2 h-[3px] rounded-full overflow-hidden"
          style={{ backgroundColor: "var(--bg-elevated)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${barPct}%`, backgroundColor: barColor }}
          />
        </div>
      )}
    </div>
  );
}
