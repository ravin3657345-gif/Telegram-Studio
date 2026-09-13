/**
 * Recurring posts — a standing rule ("каждый день в 09:00") that the scheduler
 * turns into a real scheduled post every time it comes due. Mirrors
 * `commands::recurring::RecurringInfo` / `RecurringPayload` on the Rust side.
 */

/** How often a rule repeats. */
export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface RecurringPostInfo {
  id: string;
  draftId: string | null;
  channelId: string;
  channelTitle: string;
  botId: string;
  contentPreview: string;
  frequency: RecurrenceFrequency;
  /** ISO weekday for `weekly`: 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Day of month for `monthly`, 1–28. */
  dayOfMonth: number;
  /** Local `HH:MM`. */
  timeOfDay: string;
  enabled: boolean;
  /** UTC RFC 3339 of the next firing, or null while disabled. */
  nextRunAt: string | null;
  lastRunAt: string | null;
  mediaCount: number;
}

export interface RecurringPostPayload {
  botId: string | null;
  /** One rule per channel; the UI splits a multi-channel choice into several. */
  channelIds: string[];
  contentHtml: string;
  media: {
    fileName: string;
    mimeType: string;
    mediaType: string;
    dataBase64: string;
  }[];
  draftId: string | null;
  frequency: RecurrenceFrequency;
  weekday: number;
  dayOfMonth: number;
  timeOfDay: string;
}
