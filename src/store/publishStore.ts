import { create } from "zustand";
import type { PublishResult } from "@/types/publish";

type PublishStatus = "idle" | "publishing" | "done" | "error" | "scheduling";

interface PublishState {
  selectedChannelIds: string[];
  status: PublishStatus;
  results: PublishResult[];
  lastError: string | null;

  toggleChannel: (id: string) => void;
  setChannels: (ids: string[]) => void;
  setStatus: (s: PublishStatus) => void;
  setResults: (r: PublishResult[]) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const usePublishStore = create<PublishState>()((set) => ({
  selectedChannelIds: [],
  status: "idle",
  results: [],
  lastError: null,

  toggleChannel: (id) =>
    set((s) => ({
      selectedChannelIds: s.selectedChannelIds.includes(id)
        ? s.selectedChannelIds.filter((x) => x !== id)
        : [...s.selectedChannelIds, id],
    })),

  setChannels: (ids) => set({ selectedChannelIds: ids }),
  setStatus: (status) => set({ status }),
  setResults: (results) => set({ results }),
  setError: (lastError) => set({ lastError }),
  reset: () =>
    set({ status: "idle", results: [], lastError: null }),
}));
