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
/**
 * Defense difficulty. Multiplies the wave budget and the enemy's per-wave hp/dmg scaling,
 * and sets the fort's toughness and the starting coins. Normal is the tuned baseline.
 */
export const DIFFICULTY = {
  easy: { label: 'Easy', budget: 0.75, hp: 0.85, dmg: 0.85, fort: 1.3, coins: 200 },
  normal: { label: 'Normal', budget: 1, hp: 1, dmg: 1, fort: 1, coins: 150 },
  hard: { label: 'Hard', budget: 1.25, hp: 1.12, dmg: 1.1, fort: 0.85, coins: 130 },
};
export const difficultyOf = key => DIFFICULTY[key] || DIFFICULTY.normal;

export function waveComposition(n, budgetMul = 1) {
  const out = [];
  let budget = Math.round(waveBudget(n) * budgetMul);
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

/**
 * After-action report for the wave that just ended: what it cost, what survived, and how
 * rough the next one looks compared to this one. Pure and deterministic so the HUD can
 * render it and tests can pin it.
 *
 * @param {object} o
 * @param {Array}  [o.units]    live units ({team, type, veteran}) at the moment the wave cleared
 * @param {number} [o.lost]     casualties this wave (st.stats.blue.lost delta)
 * @param {number} [o.converted]dweebs kidnapped and turned this wave
 * @param {number} [o.wave]     the wave that just cleared
 * @param {number} [o.reward]   coins earned for clearing it
 * @returns {{ wave:number, lost:number, converted:number, alive:number, veterans:number,
 *             composition:Object<string,number>, next:number, trend:'calmer'|'same'|'darker', reward:number }}
 */
export function afterAction({ units = [], lost = 0, converted = 0, wave = 1, reward = 0 } = {}) {
  const composition = {};
  let alive = 0, veterans = 0;
  for (const u of units) {
    if (!u || u.team !== 'blue' || !u.alive) continue;
    if (u.type === 'decoy') continue;
    alive++;
    composition[u.type] = (composition[u.type] || 0) + 1;
    if (u.veteran) veterans++;
  }
  const had = alive + lost;
  const next = wave + 1;
  const trend = threatTrend(wave, next);
  return { wave, lost, converted, alive, had, veterans, composition, next, trend, reward };
}

/** Is the next wave harder, much harder, or (rarely) a breather? Boss waves count as worse. */
export function threatTrend(from, to) {
  if (!(to > from)) return 'same';
  if (isBossWave(to)) return 'darker';
  const a = waveThreat(from), b = waveThreat(to);
  const ratio = (b.hp + b.dps * 20) / Math.max(1, a.hp + a.dps * 20);
  return ratio >= 1.35 ? 'darker' : ratio <= 1.06 ? 'calmer' : 'same';
}
