import { t, ti } from "@/lib/i18n";

// Human-readable countdown to a target time, localized: "in 1h 15m",
// "через 1 ч 15 мин", "dans 5 min", etc. Shared between the sidebar's
// "Next post" widget and the dashboard hero block.
export function formatTimeUntil(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return t("sidebar.widget.dueNow");
  const mins = Math.round(diffMs / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0
    ? ti("sidebar.widget.inHoursMinutes", { h, m })
    : ti("sidebar.widget.inMinutes", { m });
}