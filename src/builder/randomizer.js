// randomizer.js — "Surprise me" part randomizer for the builder.
//
// Picks a random valid config from the part catalogs.

import {
  BODY_SHAPES, APPENDAGES, FEET_TYPES, BROW_STYLES, MOUTH_STYLES,
  ELEMENTAL_PALETTES,
} from './CustomDweebModel.js';

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate a random dweeb config.
 * @param {function} rng
 * @returns {object} config
 */
export function randomConfig(rng = Math.random) {
  const paletteId = pick(Object.keys(ELEMENTAL_PALETTES), rng);
  const palette = ELEMENTAL_PALETTES[paletteId];
  return {
    name: `Wild ${pick(['Bob', 'Zed', 'Mip', 'Glorp', 'Snax'], rng)}`,
    bodyShape: pick(BODY_SHAPES, rng),
    appendages: [pick(APPENDAGES, rng), pick(APPENDAGES, rng)],
    feet: pick(FEET_TYPES, rng),
    brows: pick(BROW_STYLES, rng),
    mouth: pick(MOUTH_STYLES, rng),
    palette: paletteId,
    primaryColor: palette.primaryColor,
    accentColor: palette.accentColor,
  };
}
