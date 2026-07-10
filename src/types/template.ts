import type { DraftAttachment } from "./draft";

export type TemplateCategory = "announcements" | "collections" | "engagement" | "promo" | "other";

export interface Template {
  id: string;
  name: string;
  contentJson: string;
  parseMode: string;
  category: TemplateCategory;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Only populated by getTemplate(id), empty ([]) in the getTemplates() list. */
  attachments: DraftAttachment[];
}

export interface SaveTemplatePayload {
  id?: string;
  name: string;
  contentJson: string;
  parseMode?: string;
  category?: TemplateCategory;
  attachments?: DraftAttachment[];
}
