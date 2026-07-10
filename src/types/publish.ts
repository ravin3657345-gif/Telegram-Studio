export interface MediaPayload {
  fileName: string;
  mimeType: string;
  /** "image" | "video" | "file" */
  mediaType: string;
  /** base64-encoded file content */
  dataBase64: string;
}

export interface ButtonPayload {
  label: string;
  url?: string | null;
  callbackData?: string | null;
}

export interface PublishPayload {
  botId?: string | null;
  channelIds: string[];
  contentHtml: string;
  media: MediaPayload[];
  /** rows → cols */
  buttons: ButtonPayload[][];
  draftId?: string | null;
  scheduleAt?: string | null;
}

export interface PublishResult {
  channelId: string;
  channelTitle: string;
  success: boolean;
  telegramMsgId?: number | null;
  errorMessage?: string | null;
  botUsername?: string | null;
}

export interface ScheduledPostInfo {
  id: string;
  draftId?: string | null;
  channelId: string;
  channelTitle: string;
  botId: string;
  scheduledAt: string;
  status: string;
  contentPreview?: string | null;
}

export interface TodayStats {
  published: number;
  failed: number;
}

export interface BotInfo {
  id: number;
  firstName: string;
  username?: string | null;
}
