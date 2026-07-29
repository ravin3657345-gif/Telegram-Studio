import { invoke } from "@tauri-apps/api/core";
import type { Bot } from "@/types/bot";
import type { Channel } from "@/types/channel";
import type { Draft, DraftSummary, DraftPayload } from "@/types/draft";
import type { AppSettings } from "@/types/settings";
import type { Template, SaveTemplatePayload } from "@/types/template";
import type { Snippet, SaveSnippetPayload } from "@/types/snippet";
import type {
  BotInfo,
  MediaPayload,
  PublishPayload,
  PublishResult,
  ScheduledPostInfo,
  TodayStats,
} from "@/types/publish";

// ── Боты ────────────────────────────────────────────────────────────────────

export const validateBotToken = (token: string): Promise<BotInfo> =>
  invoke("validate_bot_token", { token });

export const getBots = (): Promise<Bot[]> =>
  invoke("get_bots");

// Bot.token from getBots()/addBot() is already masked server-side — this
// fetches the real value, only called from an explicit show/copy action.
export const revealBotToken = (botId: string): Promise<string> =>
  invoke("reveal_bot_token", { botId });

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

export const updateChannelBot = (channelId: string, botId: string): Promise<void> =>
  invoke("update_channel_bot", { channelId, botId });

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

export interface UpdateScheduledContentPayload {
  draftId: string;
  contentHtml: string;
  media: MediaPayload[];
}

// Re-syncs the content snapshot of an already-scheduled post after the
// underlying draft is edited — a no-op if nothing is currently pending for
// this draft (see src-tauri/src/commands/publish.rs::update_scheduled_post_content).
export const updateScheduledPostContent = (payload: UpdateScheduledContentPayload): Promise<void> =>
  invoke("update_scheduled_post_content", { payload });

export const getTodayStats = (): Promise<TodayStats> =>
  invoke("get_today_stats");

// ── Rich message (Bot API 10.1) ───────────────────────────────────────────────

export interface RichPhotoPayload {
  attachName: string;
  dataBase64: string;
  mimeType: string;
  fileName: string;
}

export interface PublishRichPayload {
  botId?: string | null;
  channelIds: string[];
  richHtml: string;
  photos: RichPhotoPayload[];
  draftId?: string | null;
}

export const publishRichPost = (payload: PublishRichPayload): Promise<PublishResult[]> =>
  invoke("publish_rich_post", { payload });

export interface ScheduleRichPayload {
  botId?: string | null;
  channelIds: string[];
  richHtml: string;
  photos: RichPhotoPayload[];
  draftId?: string | null;
  scheduleAt: string;
}

export const scheduleRichPost = (payload: ScheduleRichPayload): Promise<ScheduledPostInfo[]> =>
  invoke("schedule_rich_post", { payload });

// Deliberately no Rich-mode counterpart to updateScheduledPostContent —
// editing an already-scheduled Rich post is blocked entirely (see
// EditorPage.tsx's isRichScheduledLocked). Rich only supports "compose
// fresh, then publish or schedule once".

export interface PollPayload {
  botId?: string | null;
  channelIds: string[];
  question: string;
  options: string[];
  isAnonymous: boolean;
  allowsMultipleAnswers: boolean;
}

export const sendPoll = (payload: PollPayload): Promise<PublishResult[]> =>
  invoke("send_poll", { payload });

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
  publishMode:    string;
  attachments: {
    fileId:      string;
    dataBase64:  string;
    mimeType:    string;
    fileName:    string;
  }[];
}

export const getHistoryForEdit = (historyId: string): Promise<HistoryForEdit> =>
  invoke("get_history_for_edit", { historyId });

export const editPublishedPost = (historyId: string, newText: string, contentJson?: string): Promise<void> =>
  invoke("edit_published_post", { historyId, newText, contentJson: contentJson ?? null });

export const republishRichPost = (
  historyId: string,
  richHtml: string,
  photos: RichPhotoPayload[],
  contentJson?: string,
): Promise<void> =>
  invoke("republish_rich_post", { historyId, richHtml, photos, contentJson: contentJson ?? null });

// ── Шаблоны ──────────────────────────────────────────────────────────────────

export const getTemplates = (): Promise<Template[]> =>
  invoke("get_templates");

export const getTemplate = (templateId: string): Promise<Template> =>
  invoke("get_template", { templateId });

export const saveTemplate = (payload: SaveTemplatePayload): Promise<Template> =>
  invoke("save_template", { payload });

export const deleteTemplate = (templateId: string): Promise<void> =>
  invoke("delete_template", { templateId });

export const recordTemplateUse = (templateId: string): Promise<void> =>
  invoke("record_template_use", { templateId });

// ── Сниппеты ─────────────────────────────────────────────────────────────────

export const getSnippets = (): Promise<Snippet[]> =>
  invoke("get_snippets");

export const saveSnippet = (payload: SaveSnippetPayload): Promise<Snippet> =>
  invoke("save_snippet", { payload });

export const deleteSnippet = (snippetId: string): Promise<void> =>
  invoke("delete_snippet", { snippetId });

// ── Лицензия ─────────────────────────────────────────────────────────────────

export const getLicenseStatus = (): Promise<boolean> =>
  invoke("get_license_status");

export const activateLicense = (key: string): Promise<void> =>
  invoke("activate_license", { key });
