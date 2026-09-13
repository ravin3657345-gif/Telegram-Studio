import { useState } from "react";
import { X, Repeat } from "lucide-react";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { Dialog, DialogTitle, DialogDescription, VisuallyHidden } from "@/components/ui/Dialog";
import type { RecurrenceFrequency } from "@/types/recurring";

/** What the dialog hands back — the rule itself, not a single instant. */
export interface RecurrenceSpec {
  frequency: RecurrenceFrequency;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  dayOfMonth: number;
  /** Local `HH:MM`. */
  timeOfDay: string;
}

interface RecurrenceDialogProps {
  onConfirm: (spec: RecurrenceSpec) => void;
  onClose: () => void;
  /** Channels the repeats will be created for, so "where" is confirmed
   * alongside "when" — same reasoning as ScheduleDialog's channelTitles. */
  channelTitles?: string[];
  busy?: boolean;
}

/** Jan 1–7 2024 was Mon–Sun, so this maps index 0 → Monday. */
const WEEKDAY_DATES = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1));

/** The UI caps the monthly day at 28 so the rule can never be "skipped" in a
 * short month — see `Frequency::Monthly` in the core crate. */
const MAX_MONTHLY_DAY = 28;

const FREQUENCIES: { key: RecurrenceFrequency; labelKey: "repeat.daily" | "repeat.weekly" | "repeat.monthly" }[] = [
  { key: "daily",   labelKey: "repeat.daily" },
  { key: "weekly",  labelKey: "repeat.weekly" },
  { key: "monthly", labelKey: "repeat.monthly" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function selectStyle(): React.CSSProperties {
  return {
    height: 34,
    padding: "0 8px",
    borderRadius: 8,
    border: "1px solid var(--border-default)",
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13.5,
    fontWeight: 500,
    outline: "none",
    cursor: "pointer",
  };
}

export function RecurrenceDialog({ onConfirm, onClose, channelTitles, busy }: RecurrenceDialogProps) {
  const language = useSettingsStore((s) => s.language) ?? "ru";

  // Default to "tomorrow at the current time, rounded up to the next 5 min" —
  // a plausible first guess the user only has to nudge, never fill in from
  // scratch.
  const soon = new Date(Date.now() + 5 * 60_000);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("daily");
  // JS getDay() is Sunday = 0; the backend wants ISO Monday = 1.
  const [weekday, setWeekday]     = useState(((soon.getDay() + 6) % 7) + 1);
  const [dayOfMonth, setDayOfMonth] = useState(Math.min(soon.getDate(), MAX_MONTHLY_DAY));
  const [hour, setHour]           = useState(soon.getHours());
  const [minute, setMinute]       = useState(Math.ceil(soon.getMinutes() / 5) * 5 % 60);

  const hours   = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  function handleConfirm() {
    if (busy) return;
    onConfirm({ frequency, weekday, dayOfMonth, timeOfDay: `${pad(hour)}:${pad(minute)}` });
  }

  return (
    <Dialog
      mobileSheet
      onOpenChange={(open) => !open && onClose()}
      style={{
        width: 320,
        borderRadius: 16,
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 8px" }}>
        <DialogTitle asChild>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
            <Repeat size={15} style={{ color: "var(--accent)" }} />
            {t("repeat.title")}
          </span>
        </DialogTitle>
        <VisuallyHidden><DialogDescription>{t("repeat.title")}</DialogDescription></VisuallyHidden>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)", lineHeight: 0 }}
        >
          <X size={16} />
        </button>
      </div>

      <p style={{ padding: "0 16px 12px", fontSize: 11.5, lineHeight: 1.45, color: "var(--text-muted)" }}>
        {t("repeat.hint")}
      </p>

      {/* Frequency */}
      <div style={{ padding: "0 16px 10px" }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {t("repeat.frequency")}
        </p>
        <div style={{ display: "flex", gap: 4, backgroundColor: "var(--bg-elevated)", borderRadius: 9, padding: 3 }}>
          {FREQUENCIES.map((f) => {
            const active = frequency === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFrequency(f.key)}
                style={{
                  flex: 1, height: 30, borderRadius: 7, border: "none", cursor: "pointer",
                  fontSize: 12.5, fontWeight: active ? 600 : 500,
                  backgroundColor: active ? "var(--accent)" : "transparent",
                  color: active ? "#fff" : "var(--text-secondary)",
                  transition: "background-color 0.15s, color 0.15s",
                }}
              >
                {t(f.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Frequency-specific picker */}
      {frequency === "weekly" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 10px" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{t("repeat.weekday")}</span>
          <select
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
            style={{ ...selectStyle(), flex: 1 }}
          >
            {WEEKDAY_DATES.map((d, i) => (
              <option key={i} value={i + 1}>
                {d.toLocaleDateString(language, { weekday: "long" }).replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </div>
      )}

      {frequency === "monthly" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 10px" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{t("repeat.dayOfMonth")}</span>
          <select
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(Number(e.target.value))}
            style={{ ...selectStyle(), flex: 1 }}
          >
            {Array.from({ length: MAX_MONTHLY_DAY }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {/* Time */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 12px" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{t("repeat.time")}</span>
        <select value={hour} onChange={(e) => setHour(Number(e.target.value))} style={selectStyle()}>
          {hours.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
        </select>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginTop: -1 }}>:</span>
        <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} style={selectStyle()}>
          {minutes.map((m) => <option key={m} value={m}>{pad(m)}</option>)}
        </select>
      </div>

      {/* Where it goes, and the one-rule-per-channel consequence — a rule that
          quietly multiplied itself across channels would be a nasty surprise. */}
      {channelTitles && channelTitles.length > 0 && (
        <p style={{ padding: "0 16px 10px", fontSize: 11.5, lineHeight: 1.4, color: "var(--text-muted)" }} title={channelTitles.join(", ")}>
          {channelTitles.join(", ")}
          {channelTitles.length > 1 ? ` · ${t("repeat.perChannel")}` : ""}
        </p>
      )}

      <div style={{ padding: "0 16px 16px" }}>
        <button
          onClick={handleConfirm}
          disabled={!!busy}
          style={{
            width: "100%", height: 38, borderRadius: 10, border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            backgroundColor: busy ? "var(--bg-elevated)" : "var(--accent)",
            color: busy ? "var(--text-muted)" : "#fff",
            fontSize: 14, fontWeight: 600,
            opacity: busy ? 0.55 : 1,
            transition: "background-color 0.15s, opacity 0.15s",
          }}
        >
          {t("repeat.confirm")}
        </button>
      </div>
    </Dialog>
  );
}
