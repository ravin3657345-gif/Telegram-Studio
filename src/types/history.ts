export type PublicationStatus = "success" | "failed";

export interface HistoryItem {
  id: string;
  draftId?: string | null;
  channelId: string;
  botId: string;
  telegramMsgId?: number | null;
  contentJson: string;
  status: PublicationStatus;
  errorMessage?: string | null;
  publishedAt: string;
  channelTitle?: string;
  botUsername?: string;
}
