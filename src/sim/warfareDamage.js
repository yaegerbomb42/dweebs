// src/sim/warfareDamage.js — Dweeb Warfare damage maths. Pure functions, no state.
import { counterMult, stats } from './warfareUnits.js';

/** Splash falloff: full damage at the centre, 40% at the edge, 0 outside. */
export function splashFalloff(d, radius) {
  if (d >= radius) return 0;
  return 1 - 0.6 * (d / radius);
}

/** Shield cover: allies within this radius of a friendly shield take half splash. */
export const COVER_RADIUS = 2.4;
export const COVER_MULT = 0.5;

/**
 * Damage one hit deals.
 * @param {string} att attacker type
 * @param {string} def defender type
 * @param {object} [o]
 * @param {number} [o.base]    base damage (defaults to the attacker's stat)
 * @param {number} [o.dmgMul]  attacker's wave scaling
 * @param {number} [o.falloff] splash falloff 0..1
 * @param {boolean} [o.covered] defender is inside a friendly shield's cover
 */
export function computeDamage(att, def, { base, dmgMul = 1, falloff = 1, covered = false } = {}) {
  const b = base ?? stats(att).dmg;
  let dmg = b * dmgMul * falloff * counterMult(att, def);
  if (covered && def !== 'shield') dmg *= COVER_MULT;
  return dmg;
}

/** Knockback speed (m/s) a hit gives: bigger hits push more, heavy units barely budge. */
export function knockback(dmg, defMass) {
  const k = (2 + dmg * 0.09) / defMass;
  return k > 9 ? 9 : k;
}
