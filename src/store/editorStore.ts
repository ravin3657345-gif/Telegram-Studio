import { create } from "zustand";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_GIF_TYPES,
  TELEGRAM_MAX_MEDIA_GROUP,
  TELEGRAM_MAX_PHOTO_SIZE,
  TELEGRAM_MAX_VIDEO_SIZE,
  TELEGRAM_MAX_FILE_SIZE,
} from "@/lib/constants";

export type SaveStatus    = "idle" | "saving" | "saved" | "error";
export type MediaType     = "image" | "video" | "gif" | "file";
export type PublishMode   = "normal" | "rich" | "telegraph";

export interface MediaItem {
  id: string;
  file: File;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  mediaType: MediaType;
}

interface EditorState {
  splitGaps:   number[];   // gap indices between top-level blocks where a divider sits
  lockedGaps:  number[];   // gaps the user manually placed / moved (auto-split won't clear them)
  setSplitGaps: (gaps: number[], locked?: number[]) => void;

  draftId:           string | null;
  editingHistoryId:  string | null;
  draftTitle:        string;
  postTitle:         string;
  includeTitle:      boolean;
  contentJson:       string;
  media:             MediaItem[];
  saveStatus:        SaveStatus;
  lastSavedAt:       Date | null;
  publishMode:       PublishMode;
  /** "draft" | "scheduled" | "published" — loaded from the draft row itself,
   *  not derived. Used to gate editing/scheduling of Rich posts once queued
   *  (Telegram has no editRichMessage — see PublishPanel/EditorPage). */
  draftStatus:       string;
  templateName:      string | null; // set when the current draft was created from a template

  setDraftId:           (id: string | null) => void;
  setEditingHistoryId:  (id: string | null) => void;
  setDraftTitle:     (title: string) => void;
  setPostTitle:      (title: string) => void;
  setIncludeTitle:   (v: boolean) => void;
  setContentJson:    (json: string) => void;
  setPublishMode:    (mode: PublishMode) => void;
  setDraftStatus:    (status: string) => void;
  setTemplateName:   (name: string | null) => void;

  addMedia:     (files: File[]) => { added: number; errors: string[] };
  removeMedia:  (id: string) => void;
  reorderMedia: (ids: string[]) => void;

  setSaveStatus:  (status: SaveStatus) => void;
  setLastSavedAt: (date: Date) => void;

  resetEditor: () => void;
}

function detectMediaType(file: File): MediaType {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return "image";
  if (ALLOWED_GIF_TYPES.includes(file.type) && file.type === "image/gif") return "gif";
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) return "video";
  return "file";
}

function validateFile(file: File): string | null {
  const type = detectMediaType(file);
  if (type === "image" && file.size > TELEGRAM_MAX_PHOTO_SIZE)
    return `${file.name}: изображение слишком большое (макс. 10 МБ)`;
  if ((type === "video" || type === "gif") && file.size > TELEGRAM_MAX_VIDEO_SIZE)
    return `${file.name}: видео слишком большое (макс. 50 МБ)`;
  if (type === "file" && file.size > TELEGRAM_MAX_FILE_SIZE)
    return `${file.name}: файл слишком большой (макс. 50 МБ)`;
  return null;
}

const INITIAL_STATE = {
  draftId:          null as string | null,
  editingHistoryId: null as string | null,
  draftTitle:       "Новый пост",
  postTitle:        "",
  includeTitle:     true,
  contentJson:      "",
  media:            [] as MediaItem[],
  saveStatus:       "idle" as SaveStatus,
  lastSavedAt:      null as Date | null,
  publishMode:      "normal" as PublishMode,
  draftStatus:      "draft" as string,
  splitGaps:        [] as number[],
  lockedGaps:       [] as number[],
  templateName:     null as string | null,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  ...INITIAL_STATE,

  setSplitGaps: (gaps, locked) =>
    set({ splitGaps: gaps, lockedGaps: locked ?? get().lockedGaps }),

  setDraftId:           (id) => set({ draftId: id }),
  setEditingHistoryId:  (id) => set({ editingHistoryId: id }),
  setDraftTitle:   (title) => set({ draftTitle: title }),
  setPostTitle:    (title) => set({ postTitle: title }),
  setIncludeTitle: (v)     => set({ includeTitle: v }),
  setContentJson:  (json)  => set({ contentJson: json }),
  setPublishMode:  (mode)  => set({ publishMode: mode }),
  setDraftStatus:  (status) => set({ draftStatus: status }),
  setTemplateName: (name)  => set({ templateName: name }),

  addMedia(files) {
    const existing = get().media;
    const slots    = TELEGRAM_MAX_MEDIA_GROUP - existing.length;
    const errors: string[] = [];
    const added: MediaItem[] = [];

    for (const file of files) {
      if (added.length >= slots) {
        errors.push(`Нельзя прикрепить больше ${TELEGRAM_MAX_MEDIA_GROUP} файлов`);
        break;
      }
      const err = validateFile(file);
      if (err) { errors.push(err); continue; }

      const mediaType  = detectMediaType(file);
      const previewUrl = URL.createObjectURL(file);

      added.push({
        id: crypto.randomUUID(),
        file,
        previewUrl,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        mediaType,
      });
    }

    set({ media: [...existing, ...added] });
    return { added: added.length, errors };
  },

  removeMedia(id) {
    const item = get().media.find((m) => m.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    set({ media: get().media.filter((m) => m.id !== id) });
  },

  reorderMedia(ids) {
    const map = new Map(get().media.map((m) => [m.id, m]));
    const reordered = ids.map((id) => map.get(id)).filter(Boolean) as MediaItem[];
    set({ media: reordered });
  },

  setSaveStatus:  (status) => set({ saveStatus: status }),
  setLastSavedAt: (date)   => set({ lastSavedAt: date }),

  resetEditor() {
    get().media.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    set({ ...INITIAL_STATE });
  },
}));
