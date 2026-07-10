import { describe, it, expect } from "vitest";
import {
  resolveMessageLimit,
  TELEGRAM_MAX_RICH_LENGTH,
  TELEGRAM_MAX_CAPTION_LENGTH,
  TELEGRAM_MAX_TEXT_LENGTH,
} from "./constants";

describe("resolveMessageLimit", () => {
  it("rich mode is always 32,768 regardless of media — the bug this guards against", () => {
    expect(resolveMessageLimit("rich", false)).toBe(TELEGRAM_MAX_RICH_LENGTH);
    expect(resolveMessageLimit("rich", true)).toBe(TELEGRAM_MAX_RICH_LENGTH);
  });

  it("normal mode drops to the caption limit once media is attached", () => {
    expect(resolveMessageLimit("normal", true)).toBe(TELEGRAM_MAX_CAPTION_LENGTH);
  });

  it("normal mode without media uses the plain text limit", () => {
    expect(resolveMessageLimit("normal", false)).toBe(TELEGRAM_MAX_TEXT_LENGTH);
  });

  it("telegraph mode behaves like normal mode (media -> caption, else text)", () => {
    expect(resolveMessageLimit("telegraph", true)).toBe(TELEGRAM_MAX_CAPTION_LENGTH);
    expect(resolveMessageLimit("telegraph", false)).toBe(TELEGRAM_MAX_TEXT_LENGTH);
  });
});
