// ColorAccess.js — colorblind accessibility remapping for the game palette
//
// Provides accessColor(hex, mode) that remaps the game's PALETTE colors to the
// Okabe-Ito colorblind-safe palette per mode. The Okabe-Ito palette is a set of
// 9 colors designed to be distinguishable by all color vision types.
//
// Modes: 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia'
// - 'off': returns original color unchanged
// - deuteranopia/protanopia: red-green confusion, so we avoid red/green pairs
//   and use the Okabe-Ito palette which is safe for these
// - tritanopia: blue-yellow confusion, Okabe-Ito is also safe here
//
// The Okabe-Ito palette (hex):
//   0: #000000  (black)
//   1: #E69F00  (orange)
//   2: #56B4E9  (sky blue)
//   3: #009E73  (bluish green)
//   4: #F0E442  (yellow)
//   5: #0072B2  (blue)
//   6: #D55E00  (vermilion)
//   7: #CC79A7  (reddish purple)
//   8: #FFFFFF  (white)

/** Okabe-Ito colorblind-safe palette */
const OKABE_ITO = [
  0x000000, // black
  0xE69F00, // orange
  0x56B4E9, // sky blue
  0x009E73, // bluish green
  0xF0E442, // yellow
  0x0072B2, // blue
  0xD55E00, // vermilion
  0xCC79A7, // reddish purple
  0xFFFFFF, // white
];

/** Original game PALETTE from Toon.js */
const PALETTE = {
  red: 0xff4d5e,
  orange: 0xff9a3c,
  yellow: 0xffd23f,
  green: 0x5ee06a,
  teal: 0x3ee6d0,
  blue: 0x3fa9ff,
  purple: 0xb56cff,
  pink: 0xff6fb5,
  white: 0xfff8ee,
  ink: 0x1b1030,
};

/**
 * Map original palette keys to Okabe-Ito indices for each colorblind mode.
 * These mappings preserve semantic meaning (team colors, UI states) while
 * using only colorblind-safe colors.
 */
const MODE_MAPS = {
  deuteranopia: {
    // Red-green confusion: avoid red/green pairings
    red: 6,       // vermilion (distinct from green)
    orange: 1,    // orange
    yellow: 4,    // yellow
    green: 3,     // bluish green (not confused with red)
    teal: 2,      // sky blue
    blue: 5,      // blue
    purple: 7,    // reddish purple
    pink: 7,      // reddish purple (close to pink)
    white: 8,     // white
    ink: 0,       // black
  },
  protanopia: {
    // Red-green confusion (protanopia: reduced red sensitivity)
    red: 6,       // vermilion
    orange: 1,    // orange
    yellow: 4,    // yellow
    green: 3,     // bluish green
    teal: 2,      // sky blue
    blue: 5,      // blue
    purple: 7,    // reddish purple
    pink: 1,      // orange (pink reads as yellowish)
    white: 8,
    ink: 0,
  },
  tritanopia: {
    // Blue-yellow confusion: avoid blue/yellow pairings
    red: 6,       // vermilion
    orange: 6,    // vermilion (orange reads yellowish)
    yellow: 4,    // yellow
    green: 3,     // bluish green (reads greenish)
    teal: 3,      // bluish green
    blue: 5,      // blue
    purple: 7,    // reddish purple (reads reddish)
    pink: 7,      // reddish purple
    white: 8,
    ink: 0,
  },
};

/**
 * Remap a color to the colorblind-safe palette.
 * @param {number|string} hex - Color as 0xRRGGBB number or '#RRGGBB' string
 * @param {string} mode - 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia'
 * @returns {number} - Remapped color as 0xRRGGBB number
 */
export function accessColor(hex, mode = 'off') {
  if (mode === 'off' || !mode) {
    return typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  }

  const map = MODE_MAPS[mode];
  if (!map) return typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;

  // If hex matches a known palette key, use the semantic mapping
  const num = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  for (const [key, val] of Object.entries(PALETTE)) {
    if (val === num) {
      return OKABE_ITO[map[key] ?? 0];
    }
  }

  // Fallback: find closest Okabe-Ito color by Euclidean distance in RGB
  return closestOkabeIto(num);
}

/** Find the closest Okabe-Ito color to an arbitrary RGB value. */
function closestOkabeIto(hex) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  let best = OKABE_ITO[0];
  let bestDist = Infinity;
  for (const c of OKABE_ITO) {
    const cr = (c >> 16) & 0xff;
    const cg = (c >> 8) & 0xff;
    const cb = c & 0xff;
    const dr = r - cr, dg = g - cg, db = b - cb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/** Get all palette colors remapped for a given mode. */
export function getAccessiblePalette(mode = 'off') {
  const out = {};
  for (const [key, val] of Object.entries(PALETTE)) {
    out[key] = accessColor(val, mode);
  }
  return out;
}

/** Shape badges for colorblind players — one per dweeb index, never color-only. */
export const SHAPE_BADGES = ['●', '▲', '■', '◆', '★', '✚', '♦', '♥'];

/** Get shape badge by dweeb index (cycles if more than 8). */
export function getShapeBadge(index) {
  return SHAPE_BADGES[index % SHAPE_BADGES.length];
}