export interface Template {
  id: string;
  name: string;
  contentJson: string;
  parseMode: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTemplatePayload {
  id?: string;
  name: string;
  contentJson: string;
  parseMode?: string;
}
