// personality.js — dweeb personality traits.
//
// Traits affect arena behavior: aggression, showboating, caution.

export const TRAITS = {
  aggressive: {
    name: 'Aggressive', icon: '😤',
    desc: 'Seeks fights, +20% damage, -10% defense',
    dmgMul: 1.2, defMul: 0.9,
  },
  showboat: {
    name: 'Showboat', icon: '🤩',
    desc: 'Taunts often, +50% style gains',
    styleMul: 1.5,
  },
  cautious: {
    name: 'Cautious', icon: '🛡️',
    desc: 'Avoids danger, +20% defense, -10% damage',
    dmgMul: 0.9, defMul: 1.2,
  },
  lucky: {
    name: 'Lucky', icon: '🍀',
    desc: '10% chance to dodge KOs',
    dodgeChance: 0.1,
  },
  hothead: {
    name: 'Hothead', icon: '🤬',
    desc: 'Gets stronger when hurt: +5% dmg per 10% HP lost',
    rageScale: 0.05,
  },
};

export const TRAIT_IDS = Object.keys(TRAITS);

/**
 * Assign a random trait to a dweeb.
 * @param {function} rng
 * @returns {string} trait id
 */
export function randomTrait(rng = Math.random) {
  return TRAIT_IDS[Math.floor(rng() * TRAIT_IDS.length)];
}

/**
 * Get the effective damage multiplier for a dweeb with a trait.
 * @param {string} traitId
 * @param {number} hpFrac 0-1 (for hothead)
 */
export function traitDmgMul(traitId, hpFrac = 1) {
  const t = TRAITS[traitId];
  if (!t) return 1;
  let mul = t.dmgMul || 1;
  if (t.rageScale) {
    mul *= 1 + t.rageScale * ((1 - hpFrac) * 10);
  }
  return mul;
}

/** Get the defense multiplier. */
export function traitDefMul(traitId) {
  return TRAITS[traitId]?.defMul || 1;
}

/** Get the style multiplier. */
export function traitStyleMul(traitId) {
  return TRAITS[traitId]?.styleMul || 1;
}
