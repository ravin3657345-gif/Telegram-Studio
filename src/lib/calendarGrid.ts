// Pure month-grid date math shared by SchedulePage and DraftsPage's calendar view.

/** Jan 1–7 2024 = Mon–Sun — used to derive locale weekday names. */
export const WEEKDAY_BASE_DATES = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1));

export function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday-based weekday index (0=Mon … 6=Sun). */
export function weekdayMon(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Builds a calendar grid padded to full weeks (always a multiple of 7 cells). */
export function buildCalendarGrid(year: number, month: number): Array<Date | null> {
  const firstDay = startOfMonth(year, month);
  const startPad = weekdayMon(firstDay);
  const days = daysInMonth(year, month);
  const grid: Array<Date | null> = [];

  for (let i = 0; i < startPad; i++) grid.push(null);
  for (let d = 1; d <= days; d++) grid.push(new Date(year, month, d));
  while (grid.length % 7 !== 0) grid.push(null);
  return grid;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Distance to `target` split into whole days/hours/minutes, plus which
 * direction it points. Localization stays with the caller — this is only the
 * arithmetic behind "через 2 ч 15 мин" (SchedulePage's detail dialog).
 */
export function countdownParts(
  target: Date,
  now: Date
): { past: boolean; d: number; h: number; m: number } {
  const diffMin = Math.round((target.getTime() - now.getTime()) / 60_000);
  const mins = Math.abs(diffMin);
  return {
    past: diffMin < 0,
    d: Math.floor(mins / 1440),
    h: Math.floor((mins % 1440) / 60),
    m: mins % 60,
  };
}
