import { invoke } from "@tauri-apps/api/core";
import type { Bot } from "@/types/bot";
import type { Channel } from "@/types/channel";
import type { Draft, DraftSummary, DraftPayload } from "@/types/draft";
import type { AppSettings } from "@/types/settings";
import type { Template, SaveTemplatePayload } from "@/types/template";
import type {
  BotInfo,
  PublishPayload,
  PublishResult,
  ScheduledPostInfo,
} from "@/types/publish";

// ── Боты ────────────────────────────────────────────────────────────────────

export const validateBotToken = (token: string): Promise<BotInfo> =>
  invoke("validate_bot_token", { token });

export const getBots = (): Promise<Bot[]> =>
  invoke("get_bots");

export const addBot = (token: string): Promise<Bot> =>
  invoke("add_bot", { token });

export const deleteBot = (botId: string): Promise<void> =>
  invoke("delete_bot", { botId });

// ── Каналы ───────────────────────────────────────────────────────────────────

export const getChannels = (botId?: string): Promise<Channel[]> =>
  invoke("get_channels", { botId: botId ?? null });

export const addChannel = (
  botId: string,
  channelUsername: string
): Promise<Channel> =>
  invoke("add_channel", { botId, channelUsername });

export const deleteChannel = (channelId: string): Promise<void> =>
  invoke("delete_channel", { channelId });

// ── Черновики ────────────────────────────────────────────────────────────────

export const getDrafts = (): Promise<DraftSummary[]> =>
  invoke("get_drafts");

export const getDraft = (draftId: string): Promise<Draft> =>
  invoke("get_draft", { draftId });

export const upsertDraft = (payload: DraftPayload): Promise<Draft> =>
  invoke("upsert_draft", { payload });

export const deleteDraft = (draftId: string): Promise<void> =>
  invoke("delete_draft", { draftId });

// ── Настройки ────────────────────────────────────────────────────────────────

export const getSettings = (): Promise<AppSettings> =>
  invoke("get_settings");

export const updateSetting = (key: string, value: string): Promise<void> =>
  invoke("update_setting", { key, value });

// ── Публикация ───────────────────────────────────────────────────────────────

export const publishPost = (payload: PublishPayload): Promise<PublishResult[]> =>
  invoke("publish_post", { payload });

export const schedulePost = (payload: PublishPayload): Promise<ScheduledPostInfo[]> =>
  invoke("schedule_post", { payload });

export const getScheduledPosts = (): Promise<ScheduledPostInfo[]> =>
  invoke("get_scheduled_posts");

export const cancelScheduledPost = (postId: string): Promise<void> =>
  invoke("cancel_scheduled_post", { postId });

// ── Telegraph ─────────────────────────────────────────────────────────────────

export interface TelegraphImagePayload {
  fileId: string;
  dataBase64: string;
  mimeType: string;
  fileName: string;
}

export interface TelegraphPublishPayload {
  title: string;
  nodesJson: string;
  images: TelegraphImagePayload[];
}

export interface TelegraphPublishResult {
  url: string;
  path: string;
}

// ── Rich message (Bot API 10.1) ───────────────────────────────────────────────

export interface RichPhotoPayload {
  attachName: string;
  dataBase64: string;
  mimeType: string;
  fileName: string;
}

export interface PublishRichPayload {
  botId: string;
  channelIds: string[];
  blocksJson: string;
  photos: RichPhotoPayload[];
  draftId?: string | null;
}

export const publishRichPost = (payload: PublishRichPayload): Promise<PublishResult[]> =>
  invoke("publish_rich_post", { payload });

export interface PollPayload {
  botId: string;
  channelIds: string[];
  question: string;
  options: string[];
  isAnonymous: boolean;
  allowsMultipleAnswers: boolean;
}

export const sendPoll = (payload: PollPayload): Promise<PublishResult[]> =>
  invoke("send_poll", { payload });

export const telegraphPublish = (
  payload: TelegraphPublishPayload
): Promise<TelegraphPublishResult> =>
  invoke("telegraph_publish", { payload });

export const telegraphOpenLogin = (): Promise<void> =>
  invoke("telegraph_open_login");

// ── История публикаций ────────────────────────────────────────────────────────

export const getHistory = (): Promise<unknown[]> =>
  invoke("get_history");

export const schedulePostDelete = (historyId: string, deleteAt: string | null): Promise<void> =>
  invoke("schedule_post_delete", { payload: { historyId, deleteAt } });

export interface HistoryForEdit {
  historyId:      string;
  contentJson:    string;
  postTitle:      string;
  telegramMsgId:  number | null;
  telegramChatId: string | null;
  botId:          string;
  attachments: {
    fileId:      string;
    dataBase64:  string;
    mimeType:    string;
    fileName:    string;
  }[];
}

export const getHistoryForEdit = (historyId: string): Promise<HistoryForEdit> =>
  invoke("get_history_for_edit", { historyId });

export const editPublishedPost = (historyId: string, newText: string): Promise<void> =>
  invoke("edit_published_post", { historyId, newText });

// ── Шаблоны ──────────────────────────────────────────────────────────────────

export const getTemplates = (): Promise<Template[]> =>
  invoke("get_templates");

export const saveTemplate = (payload: SaveTemplatePayload): Promise<Template> =>
  invoke("save_template", { payload });

export const deleteTemplate = (templateId: string): Promise<void> =>
  invoke("delete_template", { templateId });
