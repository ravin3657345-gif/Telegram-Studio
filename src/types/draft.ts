export type DraftStatus = "draft" | "scheduled" | "published";
export type ParseMode  = "HTML" | "MarkdownV2";

export interface DraftMedia {
  id: string;
  draftId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  sortOrder: number;
  createdAt: string;
}

export interface DraftButton {
  id: string;
  draftId: string;
  rowIndex: number;
  colIndex: number;
  label: string;
  url?: string | null;
  callback?: string | null;
}

export interface DraftAttachment {
  fileId: string;
  dataBase64: string;
  mimeType: string;
  fileName: string;
}

export interface Draft {
  id: string;
  title?: string | null;
  postTitle: string;
  contentJson: string;
  contentText?: string | null;
  parseMode: ParseMode;
  status: DraftStatus;
  templateId?: string | null;
  templateName?: string | null;
  media: DraftMedia[];
  buttons: DraftButton[];
  attachments: DraftAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface DraftSummary {
  id: string;
  title?: string | null;
  postTitle: string;
  contentText?: string | null;
  mediaCount: number;
  buttonCount: number;
  status: DraftStatus;
  /** Earliest still-pending scheduled_posts.scheduled_at for this draft, if any. */
  scheduledAt?: string | null;
  updatedAt: string;
}

export interface DraftPayload {
  id?: string;
  title?: string;
  postTitle?: string;
  contentJson: string;
  contentText?: string;
  parseMode?: ParseMode;
  templateId?: string;
  attachments?: DraftAttachment[];
}
