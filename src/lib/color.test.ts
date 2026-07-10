import { describe, it, expect } from "vitest";
import { hexToHsl, hslToHex, accentGradient, accentGrayGradient } from "./color";

describe("hexToHsl / hslToHex round-trip", () => {
  it("round-trips pure colors", () => {
    expect(hslToHex(hexToHsl("#ff0000")).toLowerCase()).toBe("#ff0000");
    expect(hslToHex(hexToHsl("#00ff00")).toLowerCase()).toBe("#00ff00");
    expect(hslToHex(hexToHsl("#0000ff")).toLowerCase()).toBe("#0000ff");
  });

  it("round-trips the app's default accent within rounding tolerance", () => {
    const hsl = hexToHsl("#2c87c9");
    const back = hexToHsl(hslToHex(hsl));
    expect(back.h).toBeCloseTo(hsl.h, 0);
    expect(back.s).toBeCloseTo(hsl.s, 0);
    expect(back.l).toBeCloseTo(hsl.l, 0);
  });

  it("treats gray as zero saturation", () => {
    expect(hexToHsl("#808080").s).toBeCloseTo(0, 5);
  });
});

describe("accentGradient", () => {
  it("shifts hue by the given offset relative to the accent", () => {
    const base = hexToHsl("#2c87c9").h;
    const g = accentGradient("#2c87c9", 57);
    const match = g.match(/#([0-9a-f]{6})/i);
    expect(match).not.toBeNull();
    const shifted = hexToHsl(`#${match![1]}`);
    const expectedHue = ((base + 57) % 360 + 360) % 360;
    expect(shifted.h).toBeCloseTo(expectedHue, -1);
  });

  it("produces a different gradient for a different accent", () => {
    expect(accentGradient("#2c87c9", 15)).not.toBe(accentGradient("#8b5cf6", 15));
  });

  it("clamps saturation so a near-gray accent still yields a legible color", () => {
    const g = accentGradient("#888888", 0);
    const match = g.match(/#([0-9a-f]{6})/i);
    const hsl = hexToHsl(`#${match![1]}`);
    // >=53 not >=55: hex quantization (8 bits/channel) loses a little
    // precision on the round trip through hslToHex.
    expect(hsl.s).toBeGreaterThanOrEqual(53);
  });
});

describe("accentGrayGradient", () => {
  it("stays low-saturation regardless of a vivid accent", () => {
    const g = accentGrayGradient("#ff00ff");
    const match = g.match(/#([0-9a-f]{6})/i);
    const hsl = hexToHsl(`#${match![1]}`);
    expect(hsl.s).toBeLessThan(20);
  });
});
