export interface Channel {
  id: string;
  botId: string;
  telegramId: string;
  title: string;
  username?: string | null;
  description?: string | null;
  avatarPath?: string | null;
  memberCount?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
