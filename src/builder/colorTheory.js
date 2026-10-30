// colorTheory.js — complementary palette suggestions for the builder.
//
// Given a primary hex color, suggest a harmonious accent using classic color
// theory: complementary (180°), analogous (±30°), or triadic (120°).

/** Convert #rrggbb to {h, s, l} (h in 0-360). */
export function hexToHsl(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** Convert {h, s, l} back to #rrggbb. */
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Suggest harmonious accents for a primary color.
 * @returns {{complementary, analogous: [string, string], triadic: [string, string]}}
 */
export function suggestAccents(primaryHex) {
  const { h, s, l } = hexToHsl(primaryHex);
  const sat = Math.max(s, 0.5); // ensure vivid suggestions
  return {
    complementary: hslToHex(h + 180, sat, l),
    analogous: [hslToHex(h - 30, sat, l), hslToHex(h + 30, sat, l)],
    triadic: [hslToHex(h + 120, sat, l), hslToHex(h + 240, sat, l)],
  };
}
