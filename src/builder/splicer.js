// splicer.js — DNA splicer: combine traits from two parent dweebs.
//
// Each trait is picked from parent A or B. The mask controls the mix.

export const TRAITS = ['bodyShape', 'feet', 'brows', 'mouth', 'palette', 'primaryColor', 'appendages'];

/**
 * Splice two parent configs into a child.
 * @param {object} parentA
 * @param {object} parentB
 * @param {object} mask trait -> 'a' | 'b' (default: random 50/50)
 * @param {function} rng
 * @returns {object} child config
 */
export function splice(parentA, parentB, mask = {}, rng = Math.random) {
  const child = { name: `Splice of ${parentA.name || 'A'} & ${parentB.name || 'B'}` };
  for (const trait of TRAITS) {
    const pick = mask[trait] || (rng() < 0.5 ? 'a' : 'b');
    child[trait] = pick === 'a' ? parentA[trait] : parentB[trait];
  }
  // Accent color follows the palette's parent for harmony.
  const paletteParent = mask.palette || (child.palette === parentA.palette ? 'a' : 'b');
  child.accentColor = paletteParent === 'a' ? parentA.accentColor : parentB.accentColor;
  return child;
}

/**
 * Generate a random mask (for "surprise splice").
 * @param {function} rng
 * @returns {object} mask
 */
export function randomMask(rng = Math.random) {
  const mask = {};
  for (const trait of TRAITS) {
    mask[trait] = rng() < 0.5 ? 'a' : 'b';
  }
  return mask;
}
