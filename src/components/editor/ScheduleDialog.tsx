import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X, Check } from "lucide-react";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { Dialog, DialogTitle, DialogDescription, VisuallyHidden } from "@/components/ui/Dialog";

interface ScheduleDialogProps {
  onConfirm: (isoDate: string) => void;
  onClose: () => void;
}

// Jan 1–7 2024 = Mon–Sun
const WEEKDAY_DATES = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1));

function pad(n: number) { return String(n).padStart(2, "0"); }

function getFirstWeekday(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return (d + 6) % 7; // Monday = 0
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// ─── Scroll picker (hours / minutes) ─────────────────────────────────────────

interface PickerProps {
  value: number;
  options: number[];
  onChange: (v: number) => void;
}

function ScrollPicker({ value, options, onChange }: PickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const idx = options.indexOf(value);
    if (listRef.current && idx >= 0) {
      listRef.current.scrollTop = Math.max(0, (idx - 2) * 32);
    }
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, value, options]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 68, height: 36,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 10px",
          border: "1.5px solid var(--border-default)",
          borderRadius: 8,
          backgroundColor: "var(--bg-input)",
          cursor: "pointer",
          gap: 4,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", lineHeight: 1 }}>
          {pad(value)}
        </span>
        {open
          ? <ChevronUp size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          : <ChevronDown size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        }
      </button>

      {open && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 0,
            width: 88,
            maxHeight: 168,
            overflowY: "auto",
            border: "1px solid var(--border-default)",
            borderRadius: 10,
            backgroundColor: "var(--bg-surface)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            zIndex: 200,
          }}
        >
          {options.map(opt => (
            <div
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                height: 32,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0 12px",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: opt === value ? 600 : 400,
                color: opt === value ? "var(--accent)" : "var(--text-primary)",
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <span>{pad(opt)}</span>
              {opt === value && <Check size={12} style={{ color: "var(--accent)" }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function ScheduleDialog({ onConfirm, onClose }: ScheduleDialogProps) {
  const language = useSettingsStore(s => s.language) ?? "ru";

  const now = new Date();

  const initDate = new Date(now.getTime() + 5 * 60_000);

  const [viewYear, setViewYear]   = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

  const [selYear, setSelYear]   = useState(initDate.getFullYear());
  const [selMonth, setSelMonth] = useState(initDate.getMonth());
  const [selDay, setSelDay]     = useState(initDate.getDate());

  const [hour, setHour]     = useState(initDate.getHours());
  const [minute, setMinute] = useState(initDate.getMinutes());

  const hours   = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const selectedDate = new Date(selYear, selMonth, selDay, hour, minute, 0, 0);
  const isPast = selectedDate <= new Date();

  function handleConfirm() {
    if (isPast) return;
    onConfirm(selectedDate.toISOString());
  }

  function handleReset() {
    const d = new Date(Date.now() + 5 * 60_000);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelYear(d.getFullYear());
    setSelMonth(d.getMonth());
    setSelDay(d.getDate());
    setHour(d.getHours());
    setMinute(d.getMinutes());
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const firstWd  = getFirstWeekday(viewYear, viewMonth);
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(firstWd).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function isDayDisabled(day: number) {
    return new Date(viewYear, viewMonth, day, 23, 59) < new Date();
  }

  function isSelected(day: number) {
    return viewYear === selYear && viewMonth === selMonth && day === selDay;
  }

  function isToday(day: number) {
    return viewYear === now.getFullYear() && viewMonth === now.getMonth() && day === now.getDate();
  }

  function selectDay(day: number) {
    if (isDayDisabled(day)) return;
    setSelYear(viewYear);
    setSelMonth(viewMonth);
    setSelDay(day);
  }

  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      style={{
        width: 296,
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
            <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
              {t("schedule.title")}
            </span>
          </DialogTitle>
          <VisuallyHidden><DialogDescription>{t("schedule.title")}</DialogDescription></VisuallyHidden>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)", lineHeight: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Month / year navigation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 6px" }}>
          <button
            onClick={prevMonth}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: "var(--text-muted)", borderRadius: 6, lineHeight: 0 }}
          >
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
            {new Date(viewYear, viewMonth, 1).toLocaleDateString(language, { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase())}
          </span>
          <button
            onClick={nextMonth}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: "var(--accent)", borderRadius: 6, lineHeight: 0 }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Weekday headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 8px 2px" }}>
          {WEEKDAY_DATES.map((d, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: 11.5, fontWeight: 500, color: "var(--text-muted)", paddingBottom: 4 }}>
              {d.toLocaleDateString(language, { weekday: "short" }).replace(/\.$/, "")}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 8px 10px", gap: "1px 0" }}>
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} style={{ height: 32 }} />;
            const disabled = isDayDisabled(day);
            const selected = isSelected(day);
            const today    = isToday(day);
            return (
              <div
                key={idx}
                onClick={() => selectDay(day)}
                style={{
                  height: 32,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: "50%",
                  fontSize: 13.5,
                  cursor: disabled ? "default" : "pointer",
                  fontWeight: selected ? 700 : today ? 600 : 400,
                  backgroundColor: selected ? "var(--accent)" : "transparent",
                  color: selected ? "#fff" : disabled ? "var(--text-muted)" : today ? "var(--accent)" : "var(--text-primary)",
                  opacity: disabled ? 0.35 : 1,
                  transition: "background-color 0.1s",
                }}
                onMouseEnter={e => { if (!disabled && !selected) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (!disabled && !selected) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                {day}
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ height: 1, backgroundColor: "var(--border-subtle)" }} />

        {/* Time row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px" }}>
          <ScrollPicker value={hour} options={hours} onChange={setHour} />
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1, marginTop: -2 }}>:</span>
          <ScrollPicker value={minute} options={minutes} onChange={setMinute} />
          <div style={{ flex: 1 }} />
          <button
            onClick={handleReset}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--accent)", fontWeight: 500, padding: "4px 6px", borderRadius: 6 }}
          >
            {t("schedule.reset")}
          </button>
        </div>

        {/* Validation error */}
        {isPast && (
          <div style={{ padding: "0 14px 8px", fontSize: 12, color: "#ff4d4d" }}>
            {t("schedule.futureError")}
          </div>
        )}

        {/* Confirm */}
        <div style={{ padding: isPast ? "0 14px 14px" : "0 14px 14px" }}>
          <button
            onClick={handleConfirm}
            disabled={isPast}
            style={{
              width: "100%", height: 38,
              borderRadius: 10, border: "none",
              cursor: isPast ? "not-allowed" : "pointer",
              backgroundColor: isPast ? "var(--bg-elevated)" : "var(--accent)",
              color: isPast ? "var(--text-muted)" : "#fff",
              fontSize: 14, fontWeight: 600,
              opacity: isPast ? 0.55 : 1,
              transition: "background-color 0.15s, opacity 0.15s",
            }}
          >
            {t("schedule.confirm")}
          </button>
        </div>
    </Dialog>
  );
}
