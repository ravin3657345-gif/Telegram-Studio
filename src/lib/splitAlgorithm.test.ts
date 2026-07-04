import { describe, it, expect } from "vitest";
import { computeAutoGaps, segmentSizes } from "./splitAlgorithm";

describe("computeAutoGaps", () => {
  it("returns no gaps when total is within the limit", () => {
    expect(computeAutoGaps([100, 200, 300], 4096)).toEqual([]);
  });

  it("returns no gaps for an empty document", () => {
    expect(computeAutoGaps([], 4096)).toEqual([]);
  });

  it("places a single gap when two blocks exceed the limit together", () => {
    // block0=3000, block1=2000 → 5000 > 4096 → divider before block 1
    expect(computeAutoGaps([3000, 2000], 4096)).toEqual([1]);
    expect(segmentSizes([3000, 2000], [1])).toEqual([3000, 2000]);
  });

  it("keeps a single oversized block in its own message (no gap placed inside a block)", () => {
    // one block alone larger than the limit cannot be split by gaps
    expect(computeAutoGaps([9000], 4096)).toEqual([]);
  });

  it("splits a long run of blocks into multiple messages", () => {
    // 10 blocks of 1000 chars, limit 4096 → messages of ~4000 chars each
    const blocks = Array(10).fill(1000);
    const gaps = computeAutoGaps(blocks, 4096);
    const sizes = segmentSizes(blocks, gaps);
    // Every message must be within the limit
    expect(sizes.every((s) => s <= 4096)).toBe(true);
    // 10_000 chars / 4096 → at least 3 messages
    expect(sizes.length).toBeGreaterThanOrEqual(3);
  });

  it("regression: 17_655 chars over many blocks creates 4+ messages", () => {
    // Simulate the reported bug: a large pasted article
    const blocks: number[] = [];
    let remaining = 17_655;
    while (remaining > 0) {
      const b = Math.min(250, remaining); // ~250-char paragraphs
      blocks.push(b);
      remaining -= b;
    }
    const gaps = computeAutoGaps(blocks, 4096);
    const sizes = segmentSizes(blocks, gaps);
    expect(sizes.every((s) => s <= 4096)).toBe(true);
    expect(sizes.length).toBeGreaterThanOrEqual(5); // 17655/4096 ≈ 4.3 → 5 messages
  });

  it("regression: does NOT stop splitting after 2-3 messages", () => {
    // 20 blocks of 1000 → must produce ~5 messages, not cap at 2-3
    const blocks = Array(20).fill(1000);
    const gaps = computeAutoGaps(blocks, 4096);
    const sizes = segmentSizes(blocks, gaps);
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    expect(sizes.every((s) => s <= 4096)).toBe(true);
  });

  it("skips trailing empty block (TipTap always appends one)", () => {
    // content exactly fills two messages, then an empty paragraph
    const blocks = [4000, 4000, 0];
    const gaps = computeAutoGaps(blocks, 4096);
    // divider before block 1, and NOT before the empty block 2
    expect(gaps).toEqual([1]);
  });

  it("does not place a divider with zero characters below it", () => {
    const blocks = [3000, 3000, 0, 0];
    const gaps = computeAutoGaps(blocks, 4096);
    const sizes = segmentSizes(blocks, gaps);
    // no message should be empty
    expect(sizes.every((s) => s > 0)).toBe(true);
  });

  it("respects a user-locked gap as a hard boundary", () => {
    // Without lock, [2000,2000,2000] (6000 > 4096) would split at index 2.
    // With a lock at 1, each side is packed independently.
    const blocks = [2000, 2000, 2000];
    const gaps = computeAutoGaps(blocks, 4096, [1]);
    expect(gaps).toContain(1);
    const sizes = segmentSizes(blocks, gaps);
    expect(sizes.every((s) => s <= 4096)).toBe(true);
  });

  it("re-splits an oversized segment created by a locked gap", () => {
    // Lock at 1 leaves blocks 1..3 = 3000+3000 = 6000 > limit → needs another gap
    const blocks = [1000, 3000, 3000];
    const gaps = computeAutoGaps(blocks, 4096, [1]);
    const sizes = segmentSizes(blocks, gaps);
    expect(sizes.every((s) => s <= 4096)).toBe(true);
    expect(gaps).toContain(1);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores out-of-range locked gaps", () => {
    const blocks = [100, 100];
    expect(computeAutoGaps(blocks, 4096, [0, 5, -1])).toEqual([]);
  });

  it("handles limit of 0 gracefully (returns only valid locked gaps)", () => {
    expect(computeAutoGaps([100, 100, 100], 0, [1])).toEqual([1]);
  });

  it("caption limit (1024) produces more, smaller messages than text limit", () => {
    const blocks = Array(10).fill(500); // 5000 total
    const textGaps = computeAutoGaps(blocks, 4096);
    const capGaps = computeAutoGaps(blocks, 1024);
    expect(capGaps.length).toBeGreaterThan(textGaps.length);
    expect(segmentSizes(blocks, capGaps).every((s) => s <= 1024)).toBe(true);
  });
});

describe("segmentSizes", () => {
  it("sums block sizes between gaps", () => {
    expect(segmentSizes([1, 2, 3, 4], [2])).toEqual([3, 7]);
  });

  it("returns the whole doc as one segment when there are no gaps", () => {
    expect(segmentSizes([1, 2, 3], [])).toEqual([6]);
  });
});
