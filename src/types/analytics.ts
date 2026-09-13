/**
 * Publication analytics. Mirrors `commands::analytics::PublicationAnalytics`.
 * Aggregated from local publication history — Telegram's Bot API exposes no
 * view or reach counters for channel posts.
 */

export interface ChannelBucket {
  title: string;
  published: number;
}

export interface PublicationAnalytics {
  published: number;
  failed: number;
  /** Top channels by successful posts, most active first. */
  byChannel: ChannelBucket[];
  /** Local hour of day (0–23), or null when there is nothing to compare yet. */
  bestHour: number | null;
}
