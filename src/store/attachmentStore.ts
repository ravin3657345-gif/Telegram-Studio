import { create } from "zustand";
import { fileRegistry } from "@/lib/fileRegistry";
import { TELEGRAM_MAX_FILE_SIZE } from "@/lib/constants";

export interface AttachedFile {
  id: string;
  name: string;
  size: number;   // bytes
  mimeType: string;
}

interface AttachmentState {
  files: AttachedFile[];
  /** Add files; returns names of files that exceeded the 50 MB limit. */
  addFiles: (incoming: File[]) => string[];
  /** Register a file that's already in fileRegistry (e.g. restored from draft_media). */
  addRegistered: (id: string, name: string, size: number, mimeType: string) => void;
  removeFile: (id: string) => void;
  /** Reset store state only — fileRegistry cleanup is the caller's responsibility. */
  clearAll: () => void;
}

export const useAttachmentStore = create<AttachmentState>((set) => ({
  files: [],

  addFiles: (incoming) => {
    const oversized: string[] = [];
    const toAdd: AttachedFile[] = [];
    for (const f of incoming) {
      if (f.size > TELEGRAM_MAX_FILE_SIZE) {
        oversized.push(f.name);
        continue;
      }
      const { id } = fileRegistry.add(f);
      toAdd.push({
        id,
        name: f.name,
        size: f.size,
        mimeType: f.type || "application/octet-stream",
      });
    }
    if (toAdd.length > 0) set((s) => ({ files: [...s.files, ...toAdd] }));
    return oversized;
  },

  addRegistered: (id, name, size, mimeType) => {
    set((s) => ({
      files: s.files.some((f) => f.id === id)
        ? s.files
        : [...s.files, { id, name, size, mimeType: mimeType || "application/octet-stream" }],
    }));
  },

  removeFile: (id) => {
    fileRegistry.remove(id);
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
  },

  clearAll: () => set({ files: [] }),
}));
