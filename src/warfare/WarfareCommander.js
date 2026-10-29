// WarfareCommander.js — AI commander power usage for Dweeb Warfare.
//
// commanderDecide (src/sim/warfareAI.js) buys units and plants the rally flag; this layer adds
// the commander's *powers*: supply drops when the army is bleeding, artillery barrages on dense
// enemy clumps, and stance shifts (charge the push, turtle when outgunned).
//
// On top of that, each AI commander has a PERSONALITY — a distinct play style with its own
// recruit bias, aggression threshold, preferred stance and favourite powers. The personality is
// drawn from the battle seed (or set explicitly), so lockstep peers always agree on it.
//
// The brain is plain per-battle memory held by the controller — never sim state — so the sim
// stays pure and lockstep peers never diverge over it: every command it emits is an ordinary
// sim command. Deterministic: decisions are pure functions of (st, brain, team, personality),
// no Math.random.
import { commanderDecide } from '../sim/warfareAI.js';
import { stats, otherTeam } from '../sim/warfareUnits.js';
import { AI_PERSONALITIES } from '../sim/warfareBattle.js';

export const SUP_EVERY = 600;    // ticks between supply drops (20 s)
export const ART_EVERY = 900;    // ticks between barrages (30 s)
export const STANCE_EVERY = 1200; // ticks between stance rethinks (40 s)
const HORN_EVERY = 750;          // ticks between war horns (25 s)
const REP_EVERY = 900;           // ticks between fort repairs (30 s)
const TRAP_EVERY = 700;          // ticks between spike pits (~23 s)
const SUP_MIN_COINS = 60;  // keep a recruit reserve before spending on powers
const ART_MIN_COINS = 80;
const HORN_MIN_COINS = 60;
const REP_MIN_COINS = 80;
const TRAP_MIN_COINS = 60;
const SUP_HURT_N = 3;      // own hurt units that justify a drop
const ART_CLUMP_N = 3;     // enemies in a clump worth shelling

/**
 * AI commander personalities, keyed by AI_PERSONALITIES (src/sim/warfareBattle.js).
 *   bias     — recruit order the personality prefers (null = commanderDecide's counter-pick)
 *   attackAt — push the rally forward once our army value exceeds the enemy's by this factor
 *   stance   — 'charge' | 'defense' | 'auto' (auto = charge when winning, turtle when outgunned)
 *   horn     — sounds the war horn on the attack
 *   mender   — repairs a merely scuffed fort, not just a cracking one
 *   trapper  — seeds spike pits on enemy clumps
 */
export const PERSONALITIES = {
  tactician: {
    name: 'Tactician', title: 'THE TACTICIAN', desc: 'Textbook counter-play. Sound, patient, beatable.',
    bias: null, attackAt: 1.25, stance: 'auto', horn: false, mender: false, trapper: false,
  },
  brawler: {
    name: 'Brawler', title: 'BRAWLER BAX', desc: 'Sends everything at you, then sounds the war horn.',
    bias: ['kami', 'stealer', 'kami', 'shield'], attackAt: 0.9, stance: 'charge',
    horn: true, mender: false, trapper: false,
  },
  turtle: {
    name: 'Turtle', title: 'SIEGE MISTRESS', desc: 'Shield walls, repaired forts, endless patience.',
    bias: ['shield', 'shield', 'rocket', 'rocket'], attackAt: 1.7, stance: 'defense',
    horn: false, mender: true, trapper: false,
  },
  trickster: {
    name: 'Trickster', title: 'TRIXIE THE TRICKSTER', desc: 'Stealers, spike pits and other rude surprises.',
    bias: ['stealer', 'rocket', 'stealer', 'kami'], attackAt: 1.1, stance: 'auto',
    horn: false, mender: false, trapper: true,
  },
};
for (const k of AI_PERSONALITIES) {
  if (!PERSONALITIES[k]) throw new Error(`missing AI personality: ${k}`);
}

export function personalityOf(key) {
  return PERSONALITIES[key] || PERSONALITIES.tactician;
}

const freshSide = () => ({ supT: -1e9, artT: -1e9, stanceT: -1e9, stance: '', hornT: -1e9, repT: -1e9, trapT: -1e9, biasI: 0 });

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

/** Total coin value of each side's living army. */
function armyValue(st, team) {
  let mine = 0, theirs = 0;
  for (const u of st.units) {
    if (!u.alive) continue;
    if (u.team === team) mine += stats(u.type).cost;
    else theirs += stats(u.type).cost;
  }
  return { mine, theirs };
}

const r1 = v => Math.round(v * 10) / 10;

/** Next affordable unit from the personality's bias cycle (deterministic via brain.biasI). */
function pickBias(brain, bias, coins) {
  for (let k = 0; k < bias.length; k++) {
    const t = bias[(brain.biasI + k) % bias.length];
    if (coins >= stats(t).cost) { brain.biasI += k + 1; return t; }
  }
  return null;
}

/**
 * Full AI turn for `team`: recruits + rally from commanderDecide, reshaped by the commander's
 * personality, plus powers.
 * @returns {Array} commands (plain JSON, safe for the lockstep outbox)
 */
export function commanderTurn(st, brain, team, personality = 'tactician') {
  const P = personalityOf(personality);
  const base = commanderDecide(st, team);
  const b = brain[team];
  if (!b) return base;
  const coins = st.coins[team];
  const { mine, theirs } = armyValue(st, team);
  const attack = mine > theirs * P.attackAt || mine >= 420;
  const cmds = [];

  // Personality recruit bias: swap commanderDecide's counter-pick for our own flavour,
  // skipping the buy when the biased pick is unaffordable right now.
  for (const c of base) {
    if (c.type === 'recruit' && P.bias) {
      const unit = pickBias(b, P.bias, coins);
      if (unit) cmds.push({ ...c, unit });
    } else if (c.type !== 'rally') {
      cmds.push(c);
    }
  }

  // Personality rally: same geometry as commanderDecide, but the aggression threshold is ours.
  const enemy = otherTeam(team);
  const fort = st.forts[enemy];
  const home = st.forts[team];
  const dir = fort.x > home.x ? 1 : -1;
  const x = attack ? fort.x - dir * 6 : home.x + dir * 10;
  if (!st.rally[team] || st.rally[team].x !== x) cmds.push({ type: 'rally', team, x, z: 0 });

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
      cmds.push({ type: 'artillery', team, x: r1(c.x), z: r1(c.z) });
      b.artT = st.tick;
    }
  }

  // War horn: brawlers sound it on the attack; anyone sounds it when clearly winning a push.
  if (coins >= HORN_MIN_COINS && st.tick - b.hornT >= HORN_EVERY) {
    if ((P.horn && attack) || mine > theirs * 1.5) { cmds.push({ type: 'warhorn', team }); b.hornT = st.tick; }
  }

  // Repair: menders fix a scuffed fort; everyone else waits until it is cracking.
  const myFort = st.forts[team];
  if (coins >= REP_MIN_COINS && st.tick - b.repT >= REP_EVERY && !myFort.invulnerable &&
      myFort.hp < myFort.maxHp * (P.mender ? 0.8 : 0.5)) {
    cmds.push({ type: 'repair', team }); b.repT = st.tick;
  }

  // Spike pit: trappers seed pits on enemy clumps.
  if (P.trapper && coins >= TRAP_MIN_COINS && st.tick - b.trapT >= TRAP_EVERY) {
    const c = densestClump(st, team);
    if (c) {
      cmds.push({ type: 'trap', team, x: r1(c.x), z: r1(c.z) });
      b.trapT = st.tick;
    }
  }

  // Stance: charge when the push is on, turtle when outgunned — unless the personality insists.
  if (st.tick - b.stanceT >= STANCE_EVERY) {
    const want = P.stance !== 'auto' ? P.stance : (mine > theirs * 1.25 ? 'charge' : 'defense');
    if (want !== b.stance) cmds.push({ type: 'stance', team, stance: want });
    b.stance = want;
    b.stanceT = st.tick;
  }
  return cmds;
}
