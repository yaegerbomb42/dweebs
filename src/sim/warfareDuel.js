// src/sim/warfareDuel.js — headless equal-cost duels between two unit types. Used by the balance
// tests and tools/warfare-duels.mjs to prove the counter triangle holds in the real sim.
import { createBattle, stepBattle, spawnUnit, WF_HZ } from './warfareBattle.js';
import { stats } from './warfareUnits.js';

/**
 * Fight `budget` coins of type a (blue) against `budget` coins of type b (red) in open field.
 * @returns {{winner: 'blue'|'red'|null, blueShare: number, ticks: number}}
 *   blueShare: blue's share of total surviving cost (1 = blue flawless, 0 = red flawless)
 */
export function duel(a, b, { budget = 280, seed = 1, maxSeconds = 120 } = {}) {
  const st = createBattle({ seed, mode: 'versus', army: false, coins: 0 });
  st.income = 0;
  st.forts.blue.invulnerable = true;
  st.forts.red.invulnerable = true;
  st.rally.blue = { x: 6, z: 0 };
  st.rally.red = { x: -6, z: 0 };
  const na = Math.max(1, Math.floor(budget / stats(a).cost));
  const nb = Math.max(1, Math.floor(budget / stats(b).cost));
  for (let i = 0; i < na; i++) spawnUnit(st, 'blue', a, { x: -14 + st.rng.range(-2, 2), z: (i - na / 2) * 1.4 });
  for (let i = 0; i < nb; i++) spawnUnit(st, 'red', b, { x: 14 + st.rng.range(-2, 2), z: (i - nb / 2) * 1.4 });
  const max = maxSeconds * WF_HZ;
  while (st.tick < max && !st.winner) stepBattle(st, []);
  let cb = 0, cr = 0;
  for (const u of st.units) {
    const v = stats(u.type).cost * (u.hp / u.maxHp);
    if (u.team === 'blue') cb += v; else cr += v;
  }
  const tot = cb + cr;
  // Timeouts (a side kiting or healing at home) are decided on surviving value.
  const share = tot > 0 ? cb / tot : 0.5;
  const winner = st.winner || (share > 0.6 ? 'blue' : share < 0.4 ? 'red' : null);
  return { winner, blueShare: share, ticks: st.tick };
}
