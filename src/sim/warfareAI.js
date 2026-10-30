// src/sim/warfareAI.js — Dweeb Warfare unit brains and the AI commander. Pure functions.
//
// Behaviours:
//   • target priority — each type scores enemies by distance minus a preference bonus
//     (rockets love clumps, stealers and sneaks hunt the backline, kamis go for shield walls),
//     with a stickiness bonus so units do not flicker between targets.
//   • flanking — flanker types arc around the front line instead of walking into it.
//   • retreat — fragile units fall back to their fort when low, heal, then rejoin.
import { stats, COUNTER_OF, RECRUITABLE, otherTeam } from './warfareUnits.js';

/** Per-type preference bonus (metres of "closeness") for attacking a given enemy type. */
export const PREFERENCES = Object.freeze({
  rocket: { shield: -6, stealer: 3, sneak: 3, kami: 2, netter: 1 },
  stealer: { rocket: 8, kami: 7, sneak: 3, shield: -5, netter: -4 },
  kami: { shield: 6, brute: 7, boss: 5, rocket: 2, netter: -5 },
  sneak: { rocket: 10, stealer: 3, shield: -6, netter: -3 },
  shield: { kami: 2, stealer: 1, netter: 4 },
  brute: { shield: 2, netter: 3 },
  boss: {},
  netter: { stealer: 6, kami: 6, rocket: -4, shield: -3 },
});

const CLUSTER_WEIGHT = { rocket: 2.5, kami: 1.5, boss: 1, brute: 0.5 };
const STICKY = 2.5;

/** How many of `units` stand within r of (x,z). */
export function countNear(units, x, z, r) {
  const r2 = r * r;
  let n = 0;
  for (const o of units) {
    if (!o.alive || o.carriedBy) continue;
    const dx = o.x - x, dz = o.z - z;
    if (dx * dx + dz * dz <= r2) n++;
  }
  return n;
}

/**
 * Pick the best enemy for unit `u` from `enemies` (same-order array, deterministic tie-break on id).
 * @returns the chosen enemy or null when nothing is inside aggro range
 */
export function pickTarget(u, enemies) {
  const s = stats(u.type);
  const pref = PREFERENCES[u.type] || {};
  const cw = CLUSTER_WEIGHT[u.type] || 0;
  const aggro = s.aggro;
  let best = null, bestScore = Infinity;
  for (const e of enemies) {
    if (!e.alive || e.carriedBy || e.team === u.team || e === u) continue;
    const dx = e.x - u.x, dz = e.z - u.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > aggro) continue;
    let score = d - (pref[e.type] || 0);
    if (s.attack === 'grab' && !stats(e.type).grabbable) score += 12; // stealers tackle heavies only as a last resort
    if (cw) score -= cw * countNear(enemies, e.x, e.z, 3.4);
    score -= 3 * (1 - e.hp / e.maxHp);            // finish off the wounded
    if (e.id === u.targetId) score -= STICKY;
    if (score < bestScore || (score === bestScore && best && e.id < best.id)) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** Should `u` fall back to heal? Kamis, brutes and bosses never retreat. */
export function shouldRetreat(u) {
  const at = stats(u.type).retreatAt;
  return at > 0 && u.hp / u.maxHp < at;
}

/** Retreating units rejoin once healed to this fraction. */
export const REJOIN_AT = 0.85;

/**
 * Flank waypoint: while far from the target, flankers aim at a point beside it so their path
 * arcs around the enemy front instead of running into it. Close in, they go straight.
 */
export function flankGoal(u, tx, tz) {
  const dx = tx - u.x, dz = tz - u.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  if (d < 6) return { x: tx, z: tz };
  const off = Math.min(9, d * 0.55) * (u.flankSide || 1);
  return { x: tx + (-dz / d) * off, z: tz + (dx / d) * off };
}

/**
 * AI commander (versus vs AI, and the red side of headless tests).
 * Buys the counter to whatever the opponent fields most of (by cost), and attacks once its army
 * outweighs the enemy's. Returns a list of commands for the battle sim.
 */
export function commanderDecide(state, team) {
  if (state.tick % 45 !== (team === 'red' ? 7 : 29)) return [];
  const cmds = [];
  const enemy = otherTeam(team);
  const weight = {};
  let mine = 0, theirs = 0;
  for (const u of state.units) {
    if (!u.alive) continue;
    const c = stats(u.type).cost;
    if (u.team === team) mine += c;
    else { theirs += c; weight[u.type] = (weight[u.type] || 0) + c; }
  }
  let topType = null, topW = 0;
  for (const t of Object.keys(weight).sort()) if (weight[t] > topW) { topW = weight[t]; topType = t; }
  const coins = state.coins[team];
  // Mix: mostly counters, sometimes a shield so there is always a front line.
  const cycle = RECRUITABLE[(state.tick / 45 | 0) % RECRUITABLE.length];
  const want = topType && (state.tick / 45 | 0) % 3 !== 0 ? COUNTER_OF[topType] : cycle;
  if (coins >= stats(want).cost) cmds.push({ type: 'recruit', team, unit: want });
  const fort = state.forts[enemy];
  const home = state.forts[team];
  const attack = mine > theirs * 1.25 || mine >= 420;
  const dir = fort.x > home.x ? 1 : -1;
  const x = attack ? fort.x - dir * 6 : home.x + dir * 10;
  if (!state.rally[team] || state.rally[team].x !== x) cmds.push({ type: 'rally', team, x, z: 0 });
  return cmds;
}
