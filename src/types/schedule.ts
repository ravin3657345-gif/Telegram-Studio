export type ScheduledStatus = "pending" | "sent" | "failed" | "cancelled";

export interface ScheduledPost {
  id: string;
  draftId: string;
  channelId: string;
  botId: string;
  scheduledAt: string;
  status: ScheduledStatus;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  draftTitle?: string;
  channelTitle?: string;
}
