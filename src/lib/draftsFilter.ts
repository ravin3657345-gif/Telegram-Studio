// Pure filter/sort logic for the Drafts page — kept separate from the
// component so the Filters/Sort toolbar buttons have real, testable behavior
// instead of being decorative.

import type { DraftStatus } from "@/types/draft";
export type { DraftStatus };
export type DraftSortKey = "updated" | "title" | "scheduled";

export interface FilterableDraft {
  id: string;
  postTitle?: string | null;
  title?: string | null;
  updatedAt: string;
  status: DraftStatus;
  scheduledAt?: string | null;
}

export function filterDrafts<T extends FilterableDraft>(
  drafts: T[],
  allowedStatuses: ReadonlySet<DraftStatus>,
): T[] {
  return drafts.filter((d) => allowedStatuses.has(d.status));
}

export function sortDrafts<T extends FilterableDraft>(drafts: T[], sortBy: DraftSortKey): T[] {
  const copy = [...drafts];
  switch (sortBy) {
    case "title":
      return copy.sort((a, b) =>
        (a.postTitle || a.title || "").localeCompare(b.postTitle || b.title || "", undefined, {
          sensitivity: "base",
        }),
      );
    case "scheduled":
      // Scheduled items first (earliest first), unscheduled items last.
      return copy.sort((a, b) => {
        if (!a.scheduledAt && !b.scheduledAt) return 0;
        if (!a.scheduledAt) return 1;
        if (!b.scheduledAt) return -1;
        return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
      });
    case "updated":
    default:
      return copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
}

export function filterAndSortDrafts<T extends FilterableDraft>(
  drafts: T[],
  allowedStatuses: ReadonlySet<DraftStatus>,
  sortBy: DraftSortKey,
): T[] {
  return sortDrafts(filterDrafts(drafts, allowedStatuses), sortBy);
}

// Matches on whichever title is actually shown in the list (postTitle first,
// falling back to the secondary title) — same precedence used everywhere
// else a draft's display name is derived.
export function searchDrafts<T extends FilterableDraft>(drafts: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return drafts;
  return drafts.filter((d) => (d.postTitle || d.title || "").toLowerCase().includes(q));
}
