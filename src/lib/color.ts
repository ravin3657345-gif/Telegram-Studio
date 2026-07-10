// Small hex/HSL helpers used to derive a family of colors from the user's
// chosen accent (settingsStore's accentColor) instead of hardcoding
// independent hex values that ignore it — see TemplatesPage's category
// gradients.

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
    case g: h = ((b - r) / d + 2) * 60; break;
    default: h = ((r - g) / d + 4) * 60; break;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.min(100, Math.max(0, s)) / 100;
  const ll = Math.min(100, Math.max(0, l)) / 100;

  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (hh < 60)       [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else               [r, g, b] = [c, 0, x];

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// A two-stop diagonal gradient hue-rotated from the accent, so the whole
// family of derived colors shifts together when the user picks a different
// accent instead of staying a fixed independent palette. Saturation is
// clamped so a very muted or very neon accent still produces a legible,
// non-washed-out, non-eye-searing result.
export function accentGradient(accentHex: string, hueOffset: number): string {
  const base = hexToHsl(accentHex);
  const s = Math.min(80, Math.max(55, base.s));
  const h = base.h + hueOffset;
  const light = hslToHex({ h, s, l: 55 });
  const dark  = hslToHex({ h, s, l: 42 });
  return `linear-gradient(135deg, ${light}, ${dark})`;
}

// "Other/misc" gets a quiet, low-saturation tint of the accent's own hue
// rather than a hue-rotated bright color — a neutral catch-all category
// shouldn't compete visually with the real ones.
export function accentGrayGradient(accentHex: string): string {
  const base = hexToHsl(accentHex);
  const light = hslToHex({ h: base.h, s: 10, l: 50 });
  const dark  = hslToHex({ h: base.h, s: 12, l: 34 });
  return `linear-gradient(135deg, ${light}, ${dark})`;
}
