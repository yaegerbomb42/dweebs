// src/sim/warfareWaves.js — Dweeb Warfare wave scaling. Pure and deterministic: wave N always
// has the same composition, so tests can pin the difficulty curve and online peers agree.
import { stats } from './warfareUnits.js';

export const FINAL_WAVE = 10;
export const BOSS_EVERY = 5;
export const isBossWave = n => n > 0 && n % BOSS_EVERY === 0;

/** Enemy stat scaling per wave: tougher and harder-hitting as the run goes on. */
export function waveScaling(n) {
  const k = Math.max(0, n - 1);
  return { hpMul: 1 + 0.09 * k, dmgMul: 1 + 0.05 * k };
}

/** Coin budget the enemy spends on wave N. Grows a bit faster than linear. */
export function waveBudget(n) {
  const k = Math.max(0, n - 1);
  return 100 + 55 * k + 5 * k * k;
}

/** Unit types the enemy has unlocked by wave N, in the order they cycle. */
export function unlockedTypes(n) {
  const t = ['shield', 'kami'];
  if (n >= 2) t.push('rocket');
  if (n >= 3) t.push('stealer');
  if (n >= 4) t.push('sneak');
  if (n >= 6) t.push('brute');
  return t;
}

/** Coins the defender earns for clearing wave N. */
export const waveReward = n => 80 + 20 * n;

/**
 * The exact spawn list for wave N (array of type names, spawn order).
 * Boss waves lead with the boss and spend 45% of the budget on escorts.
 * The cycle start rotates with N so consecutive waves feel different.
 */
export function waveComposition(n) {
  const out = [];
  let budget = waveBudget(n);
  if (isBossWave(n)) {
    out.push('boss');
    budget = Math.round(budget * (n >= 10 ? 0.55 : 0.45));
  }
  const types = unlockedTypes(n);
  let i = n % types.length;
  let misses = 0;
  while (misses < types.length) {
    const t = types[i % types.length];
    const c = stats(t).cost;
    if (c <= budget) { out.push(t); budget -= c; misses = 0; }
    else misses++;
    i++;
  }
  return out;
}

/** Summary used by tests and the HUD: count and total effective HP of a wave. */
export function waveThreat(n) {
  const comp = waveComposition(n);
  const { hpMul, dmgMul } = waveScaling(n);
  let hp = 0, dps = 0;
  for (const t of comp) {
    const s = stats(t);
    hp += s.hp * hpMul;
    dps += (s.dmg * dmgMul) / Math.max(1, s.cooldown || 30);
  }
  return { count: comp.length, hp, dps, boss: isBossWave(n) };
}
