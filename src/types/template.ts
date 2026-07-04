export type TemplateCategory = "announcements" | "collections" | "engagement" | "promo" | "other";

export interface Template {
  id: string;
  name: string;
  contentJson: string;
  parseMode: string;
  category: TemplateCategory;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTemplatePayload {
  id?: string;
  name: string;
  contentJson: string;
  parseMode?: string;
  category?: TemplateCategory;
}
