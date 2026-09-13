import { ti } from "@/lib/i18n";
import type { RecurrenceFrequency } from "@/types/recurring";

/** The parts of a rule needed to describe or display it. */
export interface RecurrenceLike {
  frequency: RecurrenceFrequency;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  dayOfMonth: number;
  /** Local `HH:MM`. */
  timeOfDay: string;
}

/**
 * ISO weekday 1 = Monday … 7 = Sunday, in the user's language.
 *
 * `Intl` already returns the name in the form each language actually uses —
 * lowercase in ru/fr/es/pl ("вторник"), capitalised in en ("Tuesday") — which is
 * exactly how it sits inside the sentence templates, so the raw output is
 * returned unchanged rather than case-munged.
 */
export function weekdayName(weekday: number, language: string): string {
  const index = Math.min(Math.max(Math.trunc(weekday), 1), 7) - 1;
  // 2024-01-01 was a Monday, so the offsets line up with ISO numbering.
  return new Date(2024, 0, 1 + index).toLocaleDateString(language, { weekday: "long" });
}

/** "Каждый день в 09:00" / "Каждый вторник в 09:00" / "Каждое 15 число в 09:00" */
export function describeRecurrence(rule: RecurrenceLike, language: string): string {
  switch (rule.frequency) {
    case "weekly":
      return ti("repeat.scheduleWeekly", {
        weekday: weekdayName(rule.weekday, language),
        time: rule.timeOfDay,
      });
    case "monthly":
      return ti("repeat.scheduleMonthly", { day: rule.dayOfMonth, time: rule.timeOfDay });
    default:
      return ti("repeat.scheduleDaily", { time: rule.timeOfDay });
  }
}

/**
 * The next firing as a local date-time, or `null` while the rule is paused or
 * its stored instant is unreadable.
 */
export function formatNextRun(iso: string | null, language: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(language, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
