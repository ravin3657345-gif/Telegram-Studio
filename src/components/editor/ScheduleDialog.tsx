import { useState } from "react";
import { Clock, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";

interface ScheduleDialogProps {
  onConfirm: (isoDate: string) => void;
  onClose: () => void;
}

function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function ScheduleDialog({ onConfirm, onClose }: ScheduleDialogProps) {
  const minDate = new Date(Date.now() + 60_000);
  const [value, setValue] = useState(toLocalDatetimeValue(minDate));
  useSettingsStore((s) => s.language);

  function handleConfirm() {
    const date = new Date(value);
    if (isNaN(date.getTime())) return;
    if (date <= new Date()) return;
    onConfirm(date.toISOString());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-xl shadow-xl p-6 w-80"
        style={{
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock size={16} style={{ color: "var(--accent)" }} />
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {t("schedule.title")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-white/10 transition-colors"
          >
            <X size={14} style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        {/* DateTime input */}
        <div className="mb-5">
          <label
            className="block text-xs mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            {t("schedule.dateLabel")}
          </label>
          <input
            type="datetime-local"
            value={value}
            min={toLocalDatetimeValue(minDate)}
            onChange={(e) => setValue(e.target.value)}
            className="w-full h-9 rounded-md border px-3 text-sm focus:outline-none"
            style={{
              backgroundColor: "var(--bg-input)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
              colorScheme: "dark",
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" fullWidth onClick={onClose}>
            {t("schedule.cancel")}
          </Button>
          <Button variant="primary" size="sm" fullWidth onClick={handleConfirm}>
            {t("schedule.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
