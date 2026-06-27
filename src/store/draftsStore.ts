import { create } from "zustand";
import type { DraftSummary } from "@/types/draft";

interface DraftsState {
  drafts: DraftSummary[];
  isLoading: boolean;
  setDrafts: (drafts: DraftSummary[]) => void;
  removeDraft: (id: string) => void;
  setLoading: (v: boolean) => void;
}

export const useDraftsStore = create<DraftsState>((set) => ({
  drafts:    [],
  isLoading: false,
  setDrafts:   (drafts) => set({ drafts }),
  removeDraft: (id)     =>
    set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) })),
  setLoading:  (v)      => set({ isLoading: v }),
}));
