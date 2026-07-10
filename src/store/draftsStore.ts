import { create } from "zustand";
import type { DraftSummary } from "@/types/draft";

interface DraftsState {
  drafts: DraftSummary[];
  isLoading: boolean;
  setDrafts: (drafts: DraftSummary[]) => void;
  removeDraft: (id: string) => void;
  restoreDraft: (draft: DraftSummary) => void;
  setLoading: (v: boolean) => void;
}

export const useDraftsStore = create<DraftsState>((set) => ({
  drafts:    [],
  isLoading: false,
  setDrafts:   (drafts) => set({ drafts }),
  removeDraft: (id)     =>
    set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) })),
  // Re-inserts a draft removed via an optimistic delete that the user undid.
  // Appended rather than restored to its original index — sort order is
  // re-derived on render anyway, and a duplicate id is impossible here since
  // the delete that preceded this always removed it first.
  restoreDraft: (draft) =>
    set((s) => (s.drafts.some((d) => d.id === draft.id) ? s : { drafts: [...s.drafts, draft] })),
  setLoading:  (v)      => set({ isLoading: v }),
}));
