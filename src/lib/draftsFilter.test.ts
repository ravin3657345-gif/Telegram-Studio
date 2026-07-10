import { describe, it, expect } from "vitest";
import { filterDrafts, sortDrafts, filterAndSortDrafts } from "./draftsFilter";

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe("filterDrafts", () => {
  const drafts = [
    { id: "1", updatedAt: iso(1000), status: "draft" as const },
    { id: "2", updatedAt: iso(1000 * 60 * 40), status: "published" as const },
    { id: "3", updatedAt: iso(0), status: "scheduled" as const },
  ];

  it("keeps only drafts matching an allowed status set", () => {
    expect(filterDrafts(drafts, new Set(["published"])).map((d) => d.id)).toEqual(["2"]);
    expect(filterDrafts(drafts, new Set(["draft", "scheduled"])).map((d) => d.id)).toEqual(["1", "3"]);
  });

  it("returns everything when all statuses are allowed", () => {
    expect(filterDrafts(drafts, new Set(["draft", "scheduled", "published"]))).toHaveLength(3);
  });

  it("returns nothing when no statuses are allowed", () => {
    expect(filterDrafts(drafts, new Set())).toEqual([]);
  });
});

describe("sortDrafts", () => {
  it("sorts by title case-insensitively", () => {
    const drafts = [
      { id: "1", title: "banana", updatedAt: iso(0), status: "draft" as const },
      { id: "2", title: "Apple", updatedAt: iso(0), status: "draft" as const },
      { id: "3", title: "cherry", updatedAt: iso(0), status: "draft" as const },
    ];
    expect(sortDrafts(drafts, "title").map((d) => d.id)).toEqual(["2", "1", "3"]);
  });

  it("prefers postTitle over title when sorting", () => {
    const drafts = [
      { id: "1", postTitle: "Zeta", title: "Alpha", updatedAt: iso(0), status: "draft" as const },
      { id: "2", postTitle: "Beta", title: "Omega", updatedAt: iso(0), status: "draft" as const },
    ];
    expect(sortDrafts(drafts, "title").map((d) => d.id)).toEqual(["2", "1"]);
  });

  it("sorts by most-recently-updated first", () => {
    const drafts = [
      { id: "1", updatedAt: iso(5000), status: "draft" as const },
      { id: "2", updatedAt: iso(1000), status: "draft" as const },
      { id: "3", updatedAt: iso(9000), status: "draft" as const },
    ];
    expect(sortDrafts(drafts, "updated").map((d) => d.id)).toEqual(["2", "1", "3"]);
  });

  it("sorts by earliest scheduled date, unscheduled last", () => {
    const drafts = [
      { id: "1", updatedAt: iso(0), status: "draft" as const, scheduledAt: null },
      { id: "2", updatedAt: iso(0), status: "scheduled" as const, scheduledAt: iso(-20000) }, // later (further in future)
      { id: "3", updatedAt: iso(0), status: "scheduled" as const, scheduledAt: iso(-5000) }, // sooner
    ];
    expect(sortDrafts(drafts, "scheduled").map((d) => d.id)).toEqual(["3", "2", "1"]);
  });

  it("does not mutate the input array", () => {
    const drafts = [
      { id: "1", updatedAt: iso(5000), status: "draft" as const },
      { id: "2", updatedAt: iso(1000), status: "draft" as const },
    ];
    const original = [...drafts];
    sortDrafts(drafts, "updated");
    expect(drafts).toEqual(original);
  });
});

describe("filterAndSortDrafts", () => {
  it("filters then sorts", () => {
    const drafts = [
      { id: "1", title: "banana", updatedAt: iso(1000), status: "published" as const },
      { id: "2", title: "apple", updatedAt: iso(1000 * 60 * 40), status: "draft" as const },
      { id: "3", title: "cherry", updatedAt: iso(0), status: "scheduled" as const },
    ];
    const out = filterAndSortDrafts(drafts, new Set(["published", "scheduled"]), "title");
    expect(out.map((d) => d.id)).toEqual(["1", "3"]); // banana < cherry, draft excluded
  });
});
