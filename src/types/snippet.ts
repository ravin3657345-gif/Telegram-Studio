export interface Snippet {
  id: string;
  name: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSnippetPayload {
  id?: string;
  name: string;
  content: string;
}
