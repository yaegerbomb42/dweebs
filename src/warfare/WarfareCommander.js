// WarfareCommander.js — AI commander power usage for Dweeb Warfare.
//
// commanderDecide (src/sim/warfareAI.js) buys units and plants the rally flag; this layer adds
// the commander's *powers*: supply drops when the army is bleeding, artillery barrages on dense
// enemy clumps, and stance shifts (charge the push, turtle when outgunned).
//
// The brain is plain per-battle memory held by the controller — never sim state — so the sim
// stays pure and lockstep peers never diverge over it: every command it emits is an ordinary
// sim command. Deterministic: decisions are pure functions of (st, brain, team), no Math.random.
import { commanderDecide } from '../sim/warfareAI.js';
import { stats } from '../sim/warfareUnits.js';

export const SUP_EVERY = 600;    // ticks between supply drops (20 s)
export const ART_EVERY = 900;    // ticks between barrages (30 s)
export const STANCE_EVERY = 1200; // ticks between stance rethinks (40 s)
const SUP_MIN_COINS = 60;  // keep a recruit reserve before spending on powers
const ART_MIN_COINS = 80;
const SUP_HURT_N = 3;      // own hurt units that justify a drop
const ART_CLUMP_N = 3;     // enemies in a clump worth shelling

const freshSide = () => ({ supT: -1e9, artT: -1e9, stanceT: -1e9, stance: '' });

/** Per-battle AI memory. One per battle, reset on every _begin. */
export function createCommanderBrain() {
  return { blue: freshSide(), red: freshSide() };
}

/** Densest enemy cluster: {x, z, n} or null. Deterministic scan, ties go to the lower unit id. */
function densestClump(st, team) {
  let best = null;
  for (const u of st.units) {
    if (!u.alive || u.team === team || u.carriedBy) continue;
    let n = 0;
    for (const o of st.units) {
      if (!o.alive || o.team === team || o.carriedBy) continue;
      const dx = o.x - u.x, dz = o.z - u.z;
      if (dx * dx + dz * dz <= 36) n++;
    }
    if (!best || n > best.n || (n === best.n && u.id < best.id)) best = { x: u.x, z: u.z, n, id: u.id };
  }
  return best && best.n >= ART_CLUMP_N ? best : null;
}

/**
 * Full AI turn for `team`: recruits + rally from commanderDecide, plus powers.
 * @returns {Array} commands (plain JSON, safe for the lockstep outbox)
 */
export function commanderTurn(st, brain, team) {
  const cmds = commanderDecide(st, team);
  const b = brain[team];
  if (!b) return cmds;
  const coins = st.coins[team];

  // Supply: the army is bleeding and we can afford it without gutting recruitment.
  if (coins >= SUP_MIN_COINS && st.tick - b.supT >= SUP_EVERY) {
    let hurt = 0;
    for (const u of st.units) {
      if (u.alive && u.team === team && !u.carriedBy && u.hp < u.maxHp * 0.6 && ++hurt >= SUP_HURT_N) break;
    }
    if (hurt >= SUP_HURT_N) { cmds.push({ type: 'supply', team }); b.supT = st.tick; }
  }

  // Artillery: shell the densest enemy clump, rounded to 1 dp like the server does.
  if (coins >= ART_MIN_COINS && st.tick - b.artT >= ART_EVERY) {
    const c = densestClump(st, team);
    if (c) {
      cmds.push({ type: 'artillery', team, x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10 });
      b.artT = st.tick;
    }
  }

  // Stance: charge when the push is on, turtle when outgunned.
  if (st.tick - b.stanceT >= STANCE_EVERY) {
    let mine = 0, theirs = 0;
    for (const u of st.units) {
      if (!u.alive) continue;
      if (u.team === team) mine += stats(u.type).cost;
      else theirs += stats(u.type).cost;
    }
    const want = mine > theirs * 1.25 ? 'charge' : 'defense';
    if (want !== b.stance) cmds.push({ type: 'stance', team, stance: want });
    b.stance = want;
    b.stanceT = st.tick;
  }
  return cmds;
}
