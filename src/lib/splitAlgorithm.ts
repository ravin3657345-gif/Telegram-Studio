// Pure, side-effect-free split algorithm shared by useAutoSplit and its tests.
//
// A "gap" is an integer index 1..N-1 sitting *before* top-level block N.
// gap 2 means: a divider between block 1 and block 2 (a new message starts at block 2).

/**
 * Given the per-block character counts, a length limit, and any user-locked
 * gaps, compute where automatic dividers should be placed.
 *
 * Each sub-segment between locked gaps is packed independently, so a manually
 * placed divider never leaves an oversized segment next to it. Empty blocks
 * (e.g. TipTap's trailing paragraph, blank lines) are skipped so no divider is
 * ever placed with zero characters below it.
 *
 * @param blocks per-block character counts, in document order
 * @param limit  max characters per message
 * @param locked user-placed gaps that must be preserved as hard boundaries
 * @returns sorted, de-duplicated list of gap indices (auto + locked)
 */
export function computeAutoGaps(
  blocks: number[],
  limit: number,
  locked: number[] = [],
): number[] {
  if (limit <= 0) return [...new Set(locked)].sort((a, b) => a - b);

  const total = blocks.reduce((s, b) => s + b, 0);
  const lockedSorted = [...new Set(locked)]
    .filter((g) => g > 0 && g < blocks.length)
    .sort((a, b) => a - b);

  // Nothing to split — keep only the user's locked gaps.
  if (total <= limit) return lockedSorted;

  const boundaries = [0, ...lockedSorted, blocks.length];
  const autoGaps: number[] = [];

  for (let s = 0; s < boundaries.length - 1; s++) {
    const segStart = boundaries[s];
    const segEnd = boundaries[s + 1];
    let acc = 0;
    for (let i = segStart; i < segEnd; i++) {
      const b = blocks[i];
      if (b === 0) continue; // skip empty blocks
      if (acc > 0 && acc + b > limit) {
        autoGaps.push(i);
        acc = b;
      } else {
        acc += b;
      }
    }
  }

  return [...new Set([...autoGaps, ...lockedSorted])].sort((a, b) => a - b);
}

/**
 * The character count of each message that results from applying `gaps` to
 * `blocks`. Useful for validation and tests.
 */
export function segmentSizes(blocks: number[], gaps: number[]): number[] {
  const sorted = [...new Set(gaps)].sort((a, b) => a - b).filter((g) => g > 0 && g < blocks.length);
  const bounds = [0, ...sorted, blocks.length];
  const sizes: number[] = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    let sum = 0;
    for (let i = bounds[s]; i < bounds[s + 1]; i++) sum += blocks[i];
    sizes.push(sum);
  }
  return sizes;
}
