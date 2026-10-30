// src/sim/warfareBattle.js — the Dweeb Warfare battle simulation.
//
// Deterministic and headless: a plain-object state stepped at a fixed 30 Hz with a seeded Rng.
// No three.js, no DOM, no Math.random, no trig. The view (src/warfare/) reads `state.units`
// and `state.events` after each step and turns them into meshes, juice and sound; online peers
// run the same sim from the same seed and only exchange commands.
//
// Modes:
//   defense — you hold the west fort against escalating waves (boss every 5, win after FINAL_WAVE)
//   versus  — two commanders, two forts, passive income; destroy the other fort to win
import { Rng, hashString } from './rng.js';
import { stats, otherTeam, bounty, RECRUITABLE } from './warfareUnits.js';
import { computeDamage, splashFalloff, knockback, COVER_RADIUS } from './warfareDamage.js';
import { pickTarget, shouldRetreat, flankGoal, REJOIN_AT } from './warfareAI.js';
import { FINAL_WAVE, isBossWave, waveComposition, waveScaling, waveReward, DIFFICULTY } from './warfareWaves.js';
/* AI personality keys live here so the sim (lockstep, seeded) can draw them while the
 * behaviour definitions stay in src/warfare/WarfareCommander.js (which imports this way). */
export const AI_PERSONALITIES = Object.freeze(['tactician', 'brawler', 'turtle', 'trickster']);

export const WF_HZ = 30;
export const WF_DT = 1 / WF_HZ;
export const FIELD = Object.freeze({ halfX: 40, halfZ: 22 });
export const FORT_X = 36;
export const FORT_RADIUS = 3.2;
export const PREP_FIRST = 25 * WF_HZ;
export const PREP_BETWEEN = 14 * WF_HZ;
export const ARMY_CAP = 60;
export const DEFENSE_FORT_HP = 2000;
/** Inflatable decoy power: coin cost, lifetime in ticks, and the pop it leaves behind. */
export const DECOY_COST = 20;
export const DECOY_TTL = 12 * WF_HZ;
/** Units chip forts for this fraction of their unit damage (forts are sturdy toys). */
export const FORT_DMG_MULT = 0.6;
/** Defenders drop what they're doing for enemies this close to their fort. */
export const FORT_ALARM = 16;
/** Stealers convert captives anywhere inside this ring around their fort (the pen). */
export const PEN_REACH = 4;
export const SPAWN_GAP = 8;
export const VERSUS_INCOME = 4;
/** Versus sudden death: after this many ticks both forts start to crumble and repairs stop working.
 *  The side with the stronger standing army crumbles slower, so a stalemate always ends. */
export const SUDDEN_DEATH_TICK = 30 * 150;
export const SUDDEN_DEATH_DRAIN = 1;     // base fort hp lost per tick in sudden death          // coins per second per side in versus

// Army morale (separate from per-unit shouldRetreat): losses shake the whole line, kills steady it.
export const MORALE_ROUT_AT = 0.3;       // below this a broken army starts to rout
export const MORALE_RALLY_BOOST = 0.35;  // a commander's rally order steadies the line
export const MORALE_RECOVER = 0.00025;   // passive recovery per tick (slow, ~0.0075/s)
export const MORALE_HURT_LOSS = 0.03;    // morale lost over a full unit's worth of HP damage
export const MORALE_HURT_GAIN = 0.006;   // morale gained by the attacker over the same damage
export const MORALE_FORT_RESTORE = 0.2;  // routed units reaching home steady the army
export const MORALE_RALLY_GAIN = 0.012;  // small morale bump for every kill
export const MORALE_BOSS_GAIN = 0.25;    // felling a boss is a big swing
export const MORALE_BOSS_LOSS = 0.4;     // losing a boss is a big swing
export const ROUT_TICKS = 4 * WF_HZ;     // a rout is dramatic but temporary
export const ROUT_COOLDOWN = 6 * WF_HZ;  // grace before the same unit can break again
/** Units that never rout: bosses, and shields — the wall holds even when the army wavers,
 *  otherwise one barrel chain breaks the line and the rockets it exists to counter mop it up. */
export const STEADFAST = new Set(['boss', 'shield']);
/** Shields take this fraction of barrel-blast damage. */
export const BARREL_SHIELD_BRACE = 0.4;
export const ROUT_TAKE_DMG = 0.5;        // routed units take reduced damage while fleeing
/** Commander stances and their army-wide speed multiplier. */
export const STANCE_SPEED = Object.freeze({ charge: 1.35, defense: 0.8 });
/** Ticks a supply drop's +35% speed boost lasts (then the army falls back to its stance pace). */
export const SUPPLY_BOOST_TICKS = 10 * WF_HZ;
/** Artillery also cracks the enemy fort for this fraction of its splash damage. */
export const ARTILLERY_FORT_FRAC = 0.5;
/** Toy-battlefield layouts: symmetric dowel-bundle barricade sets, one picked per battle by seed. */
export const MAP_LAYOUTS = Object.freeze([
  { name: 'CROSSROADS', barricades: Object.freeze([
    { x: -2, z: -13, r: 1.5 }, { x: 2, z: -4.5, r: 1.5 }, { x: -2, z: 4.5, r: 1.5 }, { x: 2, z: 13, r: 1.5 },
  ]) },
  { name: 'GAUNTLET', barricades: Object.freeze([
    { x: 0, z: -9, r: 2.2 }, { x: 0, z: 9, r: 2.2 }, { x: -16, z: -8, r: 1.6 }, { x: 16, z: 8, r: 1.6 },
  ]) },
  { name: 'OPEN FIELD', barricades: Object.freeze([]) },
  { name: 'CORNERS', barricades: Object.freeze([
    { x: -15, z: -11, r: 1.8 }, { x: 15, z: 11, r: 1.8 }, { x: 15, z: -11, r: 1.8 }, { x: -15, z: 11, r: 1.8 },
  ]) },
  { name: 'CANYON', barricades: Object.freeze([
    { x: 0, z: -13, r: 2.6 }, { x: 0, z: 13, r: 2.6 },
    { x: -24, z: -13, r: 1.4 }, { x: 24, z: 13, r: 1.4 }, { x: 24, z: -13, r: 1.4 }, { x: -24, z: 13, r: 1.4 },
  ]) },
  { name: 'ISLETS', barricades: Object.freeze([
    { x: 8, z: 6, r: 1.2 }, { x: -8, z: -6, r: 1.2 }, { x: -8, z: 6, r: 1.2 }, { x: 8, z: -6, r: 1.2 },
    { x: 22, z: 0, r: 1.5 }, { x: -22, z: 0, r: 1.5 }, { x: 0, z: 16, r: 1.3 }, { x: 0, z: -16, r: 1.3 },
  ]) },
]);
/** War horn: this damage multiplier and +20% speed for WARHORN_TICKS on the whole army. */
export const WARHORN_COST = 20;
export const WARHORN_TICKS = 8 * WF_HZ;
export const WARHORN_DMG_MUL = 1.3;
/** Fortify: patch the commander's own fort for this much HP. */
export const REPAIR_COST = 30;
export const REPAIR_AMOUNT = 400;
/** Spike pit: an aimed trap that chews enemies standing in it, then collapses. */
export const TRAP_COST = 20;
export const TRAP_RADIUS = 3.2;
export const TRAP_TICKS = 25 * WF_HZ;
export const TRAP_DPS = 90;
export const MAX_TRAPS = 6;
/** Campaign veterans fight on with this much extra max HP. */
export const VETERAN_HP_MUL = 1.15;
export const MAX_VETERANS = 12;
/** Dowel-bundle barricades in no-man's land: circles units slide around (default layout). */
export const BARRICADES = MAP_LAYOUTS[0].barricades;

/**
 * Destructible battlefield furniture. Barrels chain-explode; crates pop into a little loot for
 * whoever broke them. These are intentionally non-blocking for pathing so they never make the
 * sim unstable or trap a unit.
 */
export const PROP_TYPES = Object.freeze({
  barrel: Object.freeze({ hp: 40, r: 0.52, blast: 4.6, dmg: 90 }),
  crate: Object.freeze({ hp: 30, r: 0.6, blast: 3.0, dmg: 20 }),
});
const MAX_PROP_CHAIN = 3;
const CRATE_LOOT = 8;

/** Speed multiplier per formation stance (the [R] toggle). Recruits inherit the current stance. */
function stanceSpeedMul(st, team) {
  const s = st.stance && st.stance[team];
  return s ? (STANCE_SPEED[s] ?? 1) : 1;
}

/** Damage multiplier for attackers standing on a battleground's high ground. */
export const HIGH_GROUND_MULT = 1.15;
function groundMult(st, x, z) {
  for (const r of st.highGround || []) {
    if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.h / 2) return HIGH_GROUND_MULT;
  }
  return 1;
}

/** True if (x,z) is inside any mud circle. */
function inMud(st, x, z) {
  for (const m of st.mud || []) {
    const dx = x - m.x, dz = z - m.z;
    if (dx * dx + dz * dz <= m.r * m.r) return true;
  }
  return false;
}

/** Speed multiplier for a unit at (x,z): applies mud slow if in mud. */
function terrainSpeedMul(st, x, z) {
  return inMud(st, x, z) ? MUD_SPEED_MUL : 1;
}

/**
 * Chew through destructible barricades ({hp}) caught in a blast. Deterministic: fixed array
 * order, no rng, so both lockstep peers break the same bundles on the same tick.
 */
function damageBarricades(st, x, z, radius, dmg, attTeam) {
  if (!(dmg > 0)) return;
  for (let i = st.barricades.length - 1; i >= 0; i--) {
    const b = st.barricades[i];
    if (!(b.hp > 0)) continue;
    if (Math.hypot(b.x - x, b.z - z) > radius + b.r) continue;
    b.hp -= dmg;
    if (b.hp <= 0) {
      st.barricades.splice(i, 1);
      st.events.push({ type: 'barricadeDown', team: attTeam, x: b.x, z: b.z, r: b.r });
    }
  }
}

function propStats(type) {
  return PROP_TYPES[type] || PROP_TYPES.crate;
}

/**
 * Seed barrels and crates from a dedicated stream (seed + map id) so adding props never shifts
 * the main battle RNG. Positions avoid forts, barricades and the opening armies.
 */
function seedProps(st, seed, mapId) {
  const props = [];
  if (!st || !Array.isArray(st.barricades)) return props;
  const rng = new Rng((seed ^ hashString(`props:${mapId}`)) >>> 0);
  const fits = (x, z, gap) => {
    if (!(Math.abs(x) <= FIELD.halfX - 5) || !(Math.abs(z) <= FIELD.halfZ - 4)) return false;
    for (const team of ['blue', 'red']) {
      const f = st.forts && st.forts[team];
      if (f && Math.hypot(x - f.x, z - f.z) < f.r + 6) return false;
    }
    for (const b of st.barricades) {
      if (b && Math.hypot(x - b.x, z - b.z) < (b.r || 0) + 2.6) return false;
    }
    for (const u of st.units || []) {
      if (u && u.alive && Math.hypot(x - u.x, z - u.z) < 3) return false;
    }
    for (const p of props) {
      if (Math.hypot(x - p.x, z - p.z) < gap) return false;
    }
    return true;
  };
  const spot = gap => {
    for (let i = 0; i < 24; i++) {
      const x = rng.range(-FIELD.halfX + 6, FIELD.halfX - 6);
      const z = rng.range(-FIELD.halfZ + 4, FIELD.halfZ - 4);
      if (fits(x, z, gap)) return { x, z };
    }
    return null;
  };
  const add = (type, x, z) => {
    const cfg = propStats(type);
    props.push({ id: props.length + 1, type, x, z, hp: cfg.hp, maxHp: cfg.hp, r: cfg.r });
  };
  // Barrel clusters: two or three close together, so one good rocket can start a chain.
  const offsets = [[0, 0], [1.35, 0.45], [-0.9, 1.05]];
  const clusters = 3 + rng.int(3);
  for (let c = 0; c < clusters; c++) {
    const base = spot(3.4);
    if (!base) continue;
    const n = 2 + rng.int(2);
    for (let i = 0; i < Math.min(n, offsets.length); i++) {
      const x = base.x + offsets[i][0] + rng.spread(0.22);
      const z = base.z + offsets[i][1] + rng.spread(0.22);
      if (fits(x, z, 0.95)) add('barrel', x, z);
    }
  }
  // Loot crates spread around the field on their own.
  const crates = 3 + rng.int(3);
  for (let i = 0; i < crates; i++) {
    const s = spot(2.6);
    if (s) add('crate', s.x, s.z);
  }
  return props;
}

/**
 * Chew through barrels/crates caught in a blast. Deterministic: reverse array order, no rng.
 * A barrel that dies explodes for everyone (attTeam null), and can chain to nearby props.
 */
export function damageProps(st, x, z, radius, dmg, attTeam, { chain = 0 } = {}) {
  if (!st || !Array.isArray(st.props) || !(dmg > 0)) return;
  const boom = [];
  for (let i = st.props.length - 1; i >= 0; i--) {
    const p = st.props[i];
    if (!p || !(p.hp > 0)) continue;
    if (Math.hypot(p.x - x, p.z - z) > radius + (p.r || 0.6)) continue;
    p.hp -= dmg;
    if (p.hp > 0) continue;
    st.props.splice(i, 1);
    const cfg = propStats(p.type);
    if (Array.isArray(st.events)) st.events.push({ type: 'propBoom', prop: p.type, id: p.id, x: p.x, z: p.z, r: cfg.blast, team: attTeam ?? null });
    if (p.type === 'crate' && (attTeam === 'blue' || attTeam === 'red') && st.coins) {
      st.coins[attTeam] += CRATE_LOOT;
      if (st.stats && st.stats[attTeam]) st.stats[attTeam].coinsEarned += CRATE_LOOT;
    }
    if (p.type === 'barrel') boom.push(p);
  }
  for (const p of boom) {
    if (chain >= MAX_PROP_CHAIN) continue;
    const cfg = propStats(p.type);
    splash(st, p.x, p.z, cfg.blast, null, 'barrel', 1, { chain: chain + 1 });
  }
}

const ACCEL = 0.25;
/** Brute charge: dash at a target 4–10 m away. */
export const CHARGE = Object.freeze({ min: 4, max: 10, ticks: 18, cooldown: 150, speedMul: 2.4 });
/** Boss enrage below this HP fraction: faster, quicker slams, calls in kamis. */
export const ENRAGE_AT = 0.5;
export const ENRAGE_KAMIS = 2;
/** Sneak backstab multiplier vs a target busy fighting someone else. */
export const BACKSTAB = 1.6;
/** Rockets stay this far behind their side's most advanced shield. */
export const ROCKET_BEHIND_SHIELD = 3;
/** Mud terrain: units inside a mud circle move at this fraction of their speed. */
export const MUD_SPEED_MUL = 0.55;
/** Mud terrain: rockets inside mud reload this fraction slower (multiply cooldown). */
export const MUD_ROCKET_RELOAD_MUL = 1.25;
const KNOCK_DECAY = 0.86;
/** Magnet Crane commander toy: cost, pull radius, ring it drags enemies to, pull fraction, attack stun. */
export const MAGNET = { cost: 30, radius: 14, ring: 2.5, pull: 0.6, stunTicks: 12 };
/** Kills needed to reach rank 1/2/3. Ranks carry small deterministic stat bumps. */
export const RANK_KILLS = Object.freeze([2, 4, 7]);
export const RANK_MAX = RANK_KILLS.length;
const RANK_DMG_MUL = 1.12;
const RANK_HP_MUL = 1.12;
const RANK_SPEED_MUL = 1.05;
/** Callsigns handed to rank-3 survivors. Picked from the seeded rng, never Math.random. */
const CALLSIGNS = Object.freeze(['Ace', 'Viper', 'Ghost', 'Maverick', 'Rook', 'Badger', 'Comet', 'Warden']);

function teamStats() {
  return { kills: 0, lost: 0, converted: 0, recruited: 0, coinsEarned: 0, dmgDealt: 0 };
}

/**
 * @param {object} [o]
 * @param {number} [o.seed]
 * @param {'defense'|'versus'} [o.mode]
 * @param {boolean} [o.army] spawn the starting armies (tests turn this off for duels)
 * @param {Array} [o.barricades] battleground barricade circles (default: the meadow ring)
 * @param {Array} [o.highGround] battleground high-ground rects {x,z,w,h}
 * @param {Array} [o.mud] battleground mud circles {x,z,r}
 * @param {string} [o.mapId] battleground id (seeds the deterministic prop layout)
 * @param {'random'|number|string} [o.map] battlefield layout: 'random' (drawn from the seed,
 *   so lockstep peers agree), a MAP_LAYOUTS index, or a layout name. Defaults to CROSSROADS,
 *   the classic map the balance tests are tuned on.
 * @param {number} [o.waves] waves to survive in defense (campaign missions run shorter tours)
 * @param {Array<{type:string,hpFrac:number}>} [o.veterans] surviving campaign units that fight on
 * @param {'random'|string|{blue:string,red:string}} [o.personality] AI commander personality,
 *   drawn from the seed when 'random' so lockstep peers agree
 * @param {number} [o.aiLevel] versus income multiplier for the red AI (difficulty handicap)
 */
export function createBattle({ seed = 1, mode = 'defense', army = true, coins, difficulty = 'normal', barricades, highGround, mud, mapId = 'meadow', map, waves, veterans, personality = 'random', aiLevel = 1 } = {}) {
  const versus = mode === 'versus';
  const dkey = !versus && Object.hasOwn(DIFFICULTY, difficulty) ? difficulty : 'normal';
  const diff = DIFFICULTY[dkey];
  const fortHp = versus ? 1200 : Math.round(DEFENSE_FORT_HP * diff.fort);
  const fw = Number.isInteger(waves) && waves >= 1 ? waves : FINAL_WAVE;
  const st = {
    mode, seed, mapId, tick: 0, difficulty: dkey, diff, rng: new Rng(seed), nextId: 1,
    units: [], shells: [], events: [], props: [], traps: [],
    forts: {
      blue: { x: -FORT_X, z: 0, hp: fortHp, maxHp: fortHp, r: FORT_RADIUS, invulnerable: false },
      red: { x: FORT_X, z: 0, hp: 1200, maxHp: 1200, r: FORT_RADIUS, invulnerable: !versus },
    },
    rally: { blue: { x: -22, z: 0 }, red: { x: 22, z: 0 } },
    // barricades/highGround are set after the map layout is resolved (see below).
    coins: { blue: coins ?? (versus ? 150 : diff.coins), red: versus ? (coins ?? 150) : 0 },
    wave: 0, finalWave: fw,
    phase: versus ? 'battle' : 'prep',
    prepTicks: versus ? 0 : PREP_FIRST,
    spawnQueue: [], spawnCd: 0, scaling: { hpMul: 1, dmgMul: 1 },
    winner: null, income: versus ? VERSUS_INCOME : 0, incomeRed: versus ? VERSUS_INCOME * aiLevel : 0,
    morale: { blue: 1, red: 1 },
    routed: { blue: false, red: false },
    stats: { blue: teamStats(), red: teamStats(), wavesCleared: 0 },
  };
  // Personalities come from their own seeded stream so the draw never perturbs the main
  // rng sequence: every spawn position and behaviour pinned by earlier tests stays bit-identical.
  const pRng = new Rng(((seed * 31 + 7) | 0) >>> 0);
  const pickP = p => p && p !== 'random' && AI_PERSONALITIES.includes(p) ? p
    : AI_PERSONALITIES[pRng.int(AI_PERSONALITIES.length)];
  st.aiPersonality = typeof personality === 'object' && personality
    ? { blue: pickP(personality.blue), red: pickP(personality.red) }
    : { blue: pickP(personality), red: pickP(personality) };
  const mapIdx = map === 'random' ? st.rng.int(MAP_LAYOUTS.length)
    : typeof map === 'number' ? ((map % MAP_LAYOUTS.length) + MAP_LAYOUTS.length) % MAP_LAYOUTS.length
    : typeof map === 'string' ? Math.max(0, MAP_LAYOUTS.findIndex(m => m.name === map)) : 0;
  const layout = MAP_LAYOUTS[mapIdx];
  st.mapName = layout.name;
  // Named map layouts and the explicit barricades/highGround overrides share one slot:
  // an explicit array wins, the named layout is the fallback (index 0 is the classic
  // meadow ring, so default battles are unchanged), and the sim always owns its copies.
  st.barricades = (barricades ?? layout.barricades).map(b => ({ ...b }));
  st.highGround = (highGround ?? []).map(r => ({ ...r }));
  st.mud = (mud ?? []).map(m => ({ ...m }));
  if (army) {
    const start = versus ? ['shield', 'shield', 'shield', 'rocket', 'rocket'] : ['shield', 'shield', 'shield', 'shield', 'rocket', 'rocket', 'stealer'];
    for (const t of start) spawnUnit(st, 'blue', t, { x: -26 + st.rng.range(-3, 3), z: st.rng.range(-8, 8) });
    if (versus) for (const t of start) spawnUnit(st, 'red', t, { x: 26 + st.rng.range(-3, 3), z: st.rng.range(-8, 8) });
  }
  st.props = seedProps(st, seed, mapId);
  if (veterans) {
    const f = st.forts.blue;
    let n = 0;
    for (const v of veterans) {
      if (n >= MAX_VETERANS) break;
      let ok = true;
      try { stats(v.type); } catch { ok = false; }
      if (!ok) continue;
      const u = spawnUnit(st, 'blue', v.type, {
        x: f.x + (f.r + 2) + st.rng.range(-2, 2), z: st.rng.range(-6, 6), hpMul: VETERAN_HP_MUL,
      });
      u.hp = u.maxHp * Math.min(1, Math.max(0.5, +v.hpFrac || 1));
      u.veteran = true;
      st.events.push({ type: 'veteran', id: u.id, team: 'blue', unit: v.type, x: u.x, z: u.z });
      n++;
    }
  }
  return st;
}

/** Add a unit. Returns it. */
export function spawnUnit(st, team, type, { x, z, hpMul = 1, dmgMul = 1 } = {}) {
  const s = stats(type);
  const id = st.nextId++;
  const decoy = type === 'decoy';
  const u = {
    id, team, type, x, z, vx: 0, vz: 0, kx: 0, kz: 0,
    hp: s.hp * hpMul, maxHp: s.hp * hpMul, dmgMul,
    cd: st.rng.int(Math.max(1, s.cooldown || 1)),
    state: 'fight', targetId: 0, carrying: 0, carriedBy: 0,
    flankSide: (id & 1) ? 1 : -1, alive: true, radius: s.radius,
    dash: 0, dashCd: 60, enraged: false, speedMul: stanceSpeedMul(st, team), boostMul: 1, boostT: 0, cdMul: 1,
    routTicks: 0, routCd: 0,
    kills: 0, rank: 0, name: null, rankSpeedMul: 1,
    rageT: 0,
    lastAttackerId: 0, lastHurtTick: -1e9, grudgeId: 0, pushT: 0,
    decoy, ttl: decoy ? DECOY_TTL : 0,
  };
  st.units.push(u);
  st.events.push({ type: 'spawn', id, team, unit: type, x, z });
  return u;
}

const dirOf = team => (team === 'blue' ? 1 : -1);

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

function ensureMoraleState(st) {
  if (!st) return;
  if (!st.morale || typeof st.morale !== 'object') st.morale = { blue: 1, red: 1 };
  if (typeof st.morale.blue !== 'number' || !Number.isFinite(st.morale.blue)) st.morale.blue = 1;
  if (typeof st.morale.red !== 'number' || !Number.isFinite(st.morale.red)) st.morale.red = 1;
  if (!st.routed || typeof st.routed !== 'object') st.routed = { blue: false, red: false };
}

function moraleOf(st, team) {
  const m = st && st.morale ? st.morale[team] : undefined;
  return typeof m === 'number' && Number.isFinite(m) ? m : 1;
}

function dropCarry(st, u) {
  if (!u || !u.carrying) return;
  const v = st && st.byId && typeof st.byId.get === 'function' ? st.byId.get(u.carrying) : null;
  if (v) v.carriedBy = 0;
  u.carrying = 0;
}

/** Pull every routed unit of a team back into the fight (rally / morale recovery). */
function clearRout(st, team) {
  if (!st || !Array.isArray(st.units)) return;
  for (const u of st.units) {
    if (!u || u.team !== team || u.state !== 'rout') continue;
    u.state = 'fight';
    u.routTicks = 0;
    u.targetId = 0;
  }
}

/**
 * Change one army's morale. Crossing the rout threshold emits a single rout event per army;
 * climbing back above it emits a rally event so routed units stop fleeing.
 */
function setMorale(st, team, value, source = '') {
  if (!st || (team !== 'blue' && team !== 'red')) return;
  if (!Array.isArray(st.events)) st.events = [];
  ensureMoraleState(st);
  const prev = st.morale[team];
  const next = clamp01(value);
  st.morale[team] = next;
  const fort = st.forts && st.forts[team];
  const x = fort ? fort.x : 0;
  const z = fort ? fort.z : 0;
  if (prev >= MORALE_ROUT_AT && next < MORALE_ROUT_AT && !st.routed[team]) {
    st.routed[team] = true;
    st.events.push({ type: 'rout', team, morale: next, x, z, source });
  } else if (prev < MORALE_ROUT_AT && next >= MORALE_ROUT_AT && st.routed[team]) {
    st.routed[team] = false;
    clearRout(st, team);
    if (source !== 'rally') st.events.push({ type: 'rally', team, morale: next, recovered: true, x, z, source });
  }
}

/** Effective damage multiplier: wave scaling times the war-horn rage bonus. */
const dmgMulOf = u => (u.rageT > 0 ? u.dmgMul * WARHORN_DMG_MUL : u.dmgMul);

/** Apply commands from a commander (local input, AI, or a network peer). */
export function applyCommand(st, c) {
  if (!c || st.phase === 'won' || st.phase === 'lost') return false;
  if (c.type === 'rally') {
    st.rally[c.team] = { x: clamp(+c.x || 0, -FIELD.halfX + 2, FIELD.halfX - 2), z: clamp(+c.z || 0, -FIELD.halfZ + 2, FIELD.halfZ - 2) };
    ensureMoraleState(st);
    // Moving the rally flag only steadies a line that is actually breaking (so spam-clicking it
    // is not a free morale pump); then it is the commander's big "hold the line!" moment.
    const wasRouted = !!st.routed[c.team] || moraleOf(st, c.team) < MORALE_ROUT_AT;
    if (wasRouted) {
      st.morale[c.team] = clamp01(moraleOf(st, c.team) + MORALE_RALLY_BOOST);
      st.routed[c.team] = false;
      clearRout(st, c.team);
    }
    st.events.push({ type: 'rally', team: c.team, x: st.rally[c.team].x, z: st.rally[c.team].z, morale: st.morale[c.team], recovered: wasRouted });
    return true;
  }
  if (c.type === 'recruit') {
    if (!RECRUITABLE.includes(c.unit)) return false;
    if (st.mode === 'defense' && c.team !== 'blue') return false;
    const cost = stats(c.unit).cost;
    if (st.coins[c.team] < cost) return false;
    let n = 0;
    for (const u of st.units) if (u.alive && u.team === c.team && !u.decoy) n++;
    if (n >= ARMY_CAP) return false;
    st.coins[c.team] -= cost;
    const f = st.forts[c.team];
    spawnUnit(st, c.team, c.unit, { x: f.x + dirOf(c.team) * (f.r + 1.8), z: st.rng.range(-6, 6) });
    st.stats[c.team].recruited++;
    st.events.push({ type: 'recruit', team: c.team, unit: c.unit });
    return true;
  }
  if (c.type === 'startWave') {
    if (st.phase !== 'prep') return false;
    st.prepTicks = 0;
    return true;
  }
  if (c.type === 'artillery') {
    const cost = 25;
    if (st.coins[c.team] < cost) return false;
    st.coins[c.team] -= cost;
    const tx = clamp(+c.x || 0, -FIELD.halfX + 2, FIELD.halfX - 2);
    const tz = clamp(+c.z || 0, -FIELD.halfZ + 2, FIELD.halfZ - 2);
    const splashR = 8.5;
    const splashDmg = 160;
    st.events.push({ type: 'artillery', team: c.team, x: tx, z: tz, radius: splashR });
    for (const u of st.units) {
      if (!u.alive || u.team === c.team) continue;
      const dist = Math.hypot(u.x - tx, u.z - tz);
      if (dist < splashR) {
        const falloff = 1 - (dist / splashR);
        const dmg = Math.round(splashDmg * falloff);
        u.hp -= dmg;
        const kdirX = (u.x - tx) / Math.max(0.1, dist);
        const kdirZ = (u.z - tz) / Math.max(0.1, dist);
        u.kx += kdirX * 2.2 * falloff;
        u.kz += kdirZ * 2.2 * falloff;
        st.events.push({ type: 'hit', id: u.id, dmg, crit: true, x: u.x, z: u.z });
        if (u.hp <= 0) kill(st, u, c.team, kdirX * 3, kdirZ * 3);
      }
    }
    // Barrages also crack barricades and the enemy fort when it sits inside the blast.
    damageBarricades(st, tx, tz, splashR, splashDmg, c.team);
    damageProps(st, tx, tz, splashR, splashDmg, c.team);
    const foe = otherTeam(c.team);
    const ef = st.forts[foe];
    if (Math.hypot(ef.x - tx, ef.z - tz) <= splashR + ef.r) hurtFort(st, foe, splashDmg * ARTILLERY_FORT_FRAC, 'artillery');
    return true;
  }
  if (c.type === 'decoy') {
    if (st.coins[c.team] < DECOY_COST) return false;
    st.coins[c.team] -= DECOY_COST;
    const tx = clamp(+c.x || 0, -FIELD.halfX + 2, FIELD.halfX - 2);
    const tz = clamp(+c.z || 0, -FIELD.halfZ + 2, FIELD.halfZ - 2);
    spawnUnit(st, c.team, 'decoy', { x: tx, z: tz });
    st.events.push({ type: 'decoy', team: c.team, x: tx, z: tz });
    return true;
  }
  if (c.type === 'supply') {
    const cost = 15;
    if (st.coins[c.team] < cost) return false;
    st.coins[c.team] -= cost;
    const rally = st.rally[c.team] || st.forts[c.team];
    const tx = rally.x;
    const tz = rally.z;
    st.events.push({ type: 'supply', team: c.team, x: tx, z: tz });
    for (const u of st.units) {
      if (!u.alive || u.team !== c.team) continue;
      if (Math.hypot(u.x - tx, u.z - tz) < 14) {
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.45);
        // a temporary hustle on top of the stance pace — it decays, never clobbers the stance
        u.boostMul = 1.35;
        u.boostT = SUPPLY_BOOST_TICKS;
      }
    }
    return true;
  }
  if (c.type === 'stance') {
    const stance = c.stance === 'defense' ? 'defense' : 'charge';
    st.stance = st.stance || {};
    st.stance[c.team] = stance;
    st.events.push({ type: 'stance', team: c.team, stance });
    const mul = STANCE_SPEED[stance];
    for (const u of st.units) {
      if (u.alive && u.team === c.team) {
        u.speedMul = mul;
      }
    }
    return true;
  }
  if (c.type === 'magnet') {
    // Magnet Crane: yank every light enemy within MAGNET.radius toward a tight ring around our
    // rally flag. It's a knockback slide (not a teleport), so barricades still block it and the
    // view shows them skidding in. Bosses and brutes are too heavy to move.
    if (st.coins[c.team] < MAGNET.cost) return false;
    const rally = st.rally[c.team];
    if (!rally) return false;
    st.coins[c.team] -= MAGNET.cost;
    const enemyTeam = otherTeam(c.team);
    const tx = rally.x, tz = rally.z;
    st.events.push({ type: 'magnet', team: c.team, x: tx, z: tz, radius: MAGNET.radius, ringRadius: MAGNET.ring });
    const slide = (1 - KNOCK_DECAY) / WF_DT;   // knockback that integrates to the wanted distance
    for (const u of st.units) {
      if (!u.alive || u.team !== enemyTeam || u.carriedBy) continue;
      if (u.type === 'boss' || u.type === 'brute') continue;
      const dx = u.x - tx, dz = u.z - tz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= MAGNET.radius || dist <= MAGNET.ring) continue;
      const pull = (dist - MAGNET.ring) * MAGNET.pull;
      u.kx -= (dx / dist) * pull * slide;
      u.kz -= (dz / dist) * pull * slide;
      u.cd = Math.max(u.cd, MAGNET.stunTicks);
      st.events.push({ type: 'magnetPull', id: u.id, x: u.x, z: u.z });
    }
    return true;
  }
  if (c.type === 'warhorn') {
    let n = 0;
    for (const u of st.units) if (u.alive && u.team === c.team && !u.carriedBy) n++;
    if (!n || st.coins[c.team] < WARHORN_COST) return false;
    st.coins[c.team] -= WARHORN_COST;
    for (const u of st.units) {
      if (!u.alive || u.team !== c.team || u.carriedBy) continue;
      u.rageT = WARHORN_TICKS;
      if (u.boostT < WARHORN_TICKS) { u.boostMul = Math.max(u.boostMul, 1.2); u.boostT = WARHORN_TICKS; }
    }
    st.events.push({ type: 'warhorn', team: c.team, n, x: st.rally[c.team]?.x ?? 0, z: st.rally[c.team]?.z ?? 0 });
    return true;
  }
  if (c.type === 'repair') {
    const f = st.forts[c.team];
    if (f.invulnerable || f.hp >= f.maxHp || (st.mode === 'versus' && st.tick >= SUDDEN_DEATH_TICK) || st.coins[c.team] < REPAIR_COST) return false;
    st.coins[c.team] -= REPAIR_COST;
    f.hp = Math.min(f.maxHp, f.hp + REPAIR_AMOUNT);
    st.events.push({ type: 'repair', team: c.team, x: f.x, z: f.z, amount: REPAIR_AMOUNT });
    return true;
  }
  if (c.type === 'trap') {
    if (st.coins[c.team] < TRAP_COST) return false;
    let n = 0;
    for (const t of st.traps) if (t.team === c.team) n++;
    if (n >= MAX_TRAPS) return false;
    st.coins[c.team] -= TRAP_COST;
    const tx = clamp(+c.x || 0, -FIELD.halfX + 2, FIELD.halfX - 2);
    const tz = clamp(+c.z || 0, -FIELD.halfZ + 2, FIELD.halfZ - 2);
    st.traps.push({ team: c.team, x: tx, z: tz, r: TRAP_RADIUS, ticks: TRAP_TICKS, dps: TRAP_DPS });
    st.events.push({ type: 'trap', team: c.team, x: tx, z: tz, r: TRAP_RADIUS });
    return true;
  }
  return false;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Credit a hostile kill to the attacking unit and promote it past any rank thresholds. */
function creditKill(st, attId, attTeam) {
  if (!attId || !st.byId) return;
  const a = st.byId.get(attId);
  if (!a || !a.alive || a.team !== attTeam) return;
  a.kills = (a.kills || 0) + 1;
  while (a.rank < RANK_MAX && a.kills >= RANK_KILLS[a.rank]) {
    a.rank++;
    a.dmgMul *= RANK_DMG_MUL;
    a.maxHp = Math.round(a.maxHp * RANK_HP_MUL);
    a.hp = Math.min(a.maxHp, a.hp + a.maxHp * (RANK_HP_MUL - 1));
    a.rankSpeedMul = (a.rankSpeedMul || 1) * RANK_SPEED_MUL;
    if (a.rank >= RANK_MAX && !a.name) a.name = CALLSIGNS[st.rng.int(CALLSIGNS.length)];
    st.events.push({ type: 'promote', id: a.id, team: a.team, unit: a.type, rank: a.rank, name: a.name || '', x: a.x, z: a.z });
  }
}

function kill(st, u, attTeam, kx, kz, attId = 0) {
  if (!u.alive) return;
  u.alive = false;
  u.hp = 0;
  st.events.push({ type: 'death', id: u.id, team: u.team, unit: u.type, x: u.x, z: u.z, kx, kz });
  if (u.decoy) st.events.push({ type: 'pop', id: u.id, team: u.team, x: u.x, z: u.z });
  const bossDeath = u.type === 'boss';
  if (!u.decoy) {
    st.stats[u.team].lost++;           // a popped balloon is not a casualty
    const loss = bossDeath ? MORALE_BOSS_LOSS : u.type === 'brute' ? 0.09 : 0.05;
    setMorale(st, u.team, moraleOf(st, u.team) - loss, 'death');
  }
  if (attTeam && attTeam !== u.team && !u.decoy) {  // ...and pays no bounty
    st.stats[attTeam].kills++;
    setMorale(st, attTeam, moraleOf(st, attTeam) + (bossDeath ? MORALE_BOSS_GAIN : MORALE_RALLY_GAIN), 'kill');
    creditKill(st, attId, attTeam);
    const b = bounty(u.type);
    if (!(st.mode === 'defense' && attTeam === 'red')) {
      st.coins[attTeam] += b;
      st.stats[attTeam].coinsEarned += b;
    }
  }
  if (u.carrying) {
    const v = st.byId.get(u.carrying);
    if (v) v.carriedBy = 0;
    u.carrying = 0;
  }
  if (u.carriedBy) {
    const c = st.byId.get(u.carriedBy);
    if (c) c.carrying = 0;
    u.carriedBy = 0;
  }
}

/** Damage `t` from an attacker of (team, type) at (ax, az), crediting/retaliating against unit `attId`. */
function hurt(st, t, dmg, attTeam, attType, ax, az, attId = 0) {
  if (!t.alive || dmg <= 0) return;
  if (t.state === 'rout') dmg *= ROUT_TAKE_DMG;
  t.hp -= dmg;
  const frac = Math.min(1, dmg / Math.max(1, t.maxHp));
  setMorale(st, t.team, moraleOf(st, t.team) - frac * MORALE_HURT_LOSS, 'damage');
  if (attTeam && attTeam !== t.team) setMorale(st, attTeam, moraleOf(st, attTeam) + frac * MORALE_HURT_GAIN, 'damage');
  const dx = t.x - ax, dz = t.z - az;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  const kb = knockback(dmg, stats(t.type).mass);
  const kx = (dx / d) * kb, kz = (dz / d) * kb;
  if (!t.carriedBy) { t.kx += kx; t.kz += kz; }
  if (attTeam && st.stats && st.stats[attTeam]) st.stats[attTeam].dmgDealt += dmg;
  st.events.push({ type: 'hit', id: t.id, team: t.team, unit: t.type, src: attType, dmg, x: t.x, z: t.z, kx, kz });
  if (t.hp <= 0) kill(st, t, attTeam, kx, kz, attId);
  // Remember the attacker: a stationary unit with nothing to fight may nurse a grudge.
  // (The grudge itself is taken up in updateUnit — never here — so advancing walls don't scatter.)
  else if (attId && attId !== t.id) { t.lastAttackerId = attId; t.lastHurtTick = st.tick; }
}

function isCovered(st, t) {
  if (t.type === 'shield') return false;
  const r2 = COVER_RADIUS * COVER_RADIUS;
  for (const o of st.units) {
    if (!o.alive || o.team !== t.team || o.type !== 'shield' || o.carriedBy) continue;
    const dx = o.x - t.x, dz = o.z - t.z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/** Splash damage centred at (x, z). ax/az = the attacker's position (high-ground bonus). */
function splash(st, x, z, radius, attTeam, attType, dmgMul, { cover = false, base, ax, az, chain = 0, attId = 0 } = {}) {
  if (!st || !Array.isArray(st.units)) return;
  const propSrc = attType === 'barrel' ? propStats('barrel') : null;
  const srcBase = base ?? (propSrc ? propSrc.dmg : undefined);
  const srcDmg = propSrc ? propSrc.dmg : (stats(attType).dmg || 0);
  const hg = groundMult(st, ax ?? x, az ?? z);
  for (const e of st.units) {
    if (!e.alive || e.team === attTeam) continue;
    const dx = e.x - x, dz = e.z - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const f = splashFalloff(d, radius + e.radius * 0.5);
    if (f <= 0) continue;
    // Shields brace behind their disc against raw barrel blasts, like they soak rocket splash.
    const braced = propSrc && e.type === 'shield' ? BARREL_SHIELD_BRACE : 1;
    const dmg = braced * computeDamage(attType, e.type, { base: srcBase, dmgMul: dmgMul * hg, falloff: f, covered: cover && isCovered(st, e) });
    hurt(st, e, dmg, attTeam, attType, x, z, attId);
  }
  damageBarricades(st, x, z, radius, srcDmg * dmgMul, attTeam);
  damageProps(st, x, z, radius, srcDmg * dmgMul, attTeam, { chain });
}

function hurtFort(st, team, dmg, attType) {
  const f = st.forts[team];
  if (f.invulnerable || f.hp <= 0) return;
  dmg *= FORT_DMG_MULT;
  f.hp = Math.max(0, f.hp - dmg);
  const frac = dmg / Math.max(1, f.maxHp);
  setMorale(st, team, moraleOf(st, team) - Math.min(0.12, frac * 2.5), 'fort');
  const enemy = otherTeam(team);
  setMorale(st, enemy, moraleOf(st, enemy) + Math.min(0.03, frac * 0.5), 'fort');
  st.events.push({ type: 'fortHit', team, dmg, src: attType, x: f.x, z: f.z });
}

function fireShell(st, u, tx, tz, tvx, tvz) {
  const s = stats(u.type);
  const dx = tx - u.x, dz = tz - u.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const T = Math.max(10, Math.round((d / 15) * WF_HZ));
  const lead = (T * WF_DT) * 0.7;
  const sh = {
    team: u.team, src: u.type, ownerId: u.id, x0: u.x, z0: u.z,
    x1: tx + tvx * lead, z1: tz + tvz * lead, t: 0, T, dmgMul: dmgMulOf(u), splash: s.splash,
    x: u.x, z: u.z,
  };
  st.shells.push(sh);
  st.events.push({ type: 'fire', id: u.id, team: u.team, x: u.x, z: u.z, tx: sh.x1, tz: sh.z1, T });
  // recoil: rockets hop backwards a little
  u.kx -= (dx / (d || 1)) * 2.2;
  u.kz -= (dz / (d || 1)) * 2.2;
}

function updateShells(st) {
  for (let i = st.shells.length - 1; i >= 0; i--) {
    const sh = st.shells[i];
    sh.t++;
    const p = sh.t / sh.T;
    sh.x = sh.x0 + (sh.x1 - sh.x0) * p;
    sh.z = sh.z0 + (sh.z1 - sh.z0) * p;
    if (sh.t < sh.T) continue;
    st.shells.splice(i, 1);
    st.events.push({ type: 'explode', team: sh.team, src: sh.src, x: sh.x1, z: sh.z1, r: sh.splash });
    splash(st, sh.x1, sh.z1, sh.splash, sh.team, sh.src, sh.dmgMul, { cover: true, ax: sh.x0, az: sh.z0, attId: sh.ownerId });
    const enemy = otherTeam(sh.team);
    const f = st.forts[enemy];
    const fx = sh.x1 - f.x, fz = sh.z1 - f.z;
    if (fx * fx + fz * fz <= (f.r + 1.5) * (f.r + 1.5)) hurtFort(st, enemy, stats(sh.src).dmg * sh.dmgMul * 0.6, sh.src);
  }
}

/** Start a grudge: a stationary unit with no natural target answers whoever is hitting it,
 *  even past normal aggro. Breaks bombardment standoffs (a rocket plinking a held shield
 *  from 16 m forever) without scattering advancing walls — those keep their orders. */
function startGrudge(st, u) {
  if (!u.lastAttackerId || st.tick - u.lastHurtTick > 120) return null;
  if (u.vx * u.vx + u.vz * u.vz >= 1) return null;
  const a = st.byId.get(u.lastAttackerId);
  if (!a || !a.alive || a.team === u.team || a.carriedBy) return null;
  const dx = a.x - u.x, dz = a.z - u.z;
  const reach = stats(u.type).aggro * 2;
  if (dx * dx + dz * dz > reach * reach) return null;
  u.grudgeId = a.id;
  return a;
}

/** Keep nursing a grudge while the target is still a plausible chase. */
function keepGrudge(st, u) {
  if (!u.grudgeId) return null;
  const g = st.byId.get(u.grudgeId);
  if (!g || !g.alive || g.team === u.team || g.carriedBy) { u.grudgeId = 0; return null; }
  const dx = g.x - u.x, dz = g.z - u.z;
  const reach = stats(u.type).aggro * 2;
  if (dx * dx + dz * dz > reach * reach) { u.grudgeId = 0; return null; }
  return g;
}
/** Nearest enemy inside FORT_ALARM of u's own fort: defenders always answer a raid on home. */
function fortAlarm(st, u, enemies) {
  const f = st.forts[u.team];
  if (f.invulnerable) return null;
  let best = null, bd = Infinity;
  for (const e of enemies) {
    if (!e.alive || e.carriedBy || e.team === u.team) continue;
    const fx = e.x - f.x, fz = e.z - f.z;
    if (fx * fx + fz * fz > FORT_ALARM * FORT_ALARM) continue;
    const dx = e.x - u.x, dz = e.z - u.z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function formationSlot(u) {
  const dir = dirOf(u.team);
  const row = u.type === 'rocket' ? -4 : u.type === 'shield' ? 2 : u.type === 'kami' ? 0 : -1.5;
  const zOff = ((u.id * 7) % 11 - 5) * 1.2;
  const xOff = ((u.id * 3) % 5 - 2) * 0.9;
  return { x: row * dir + xOff, z: zOff };
}

function seek(u, gx, gz, speed, arrive = 0) {
  const dx = gx - u.x, dz = gz - u.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  let tvx = 0, tvz = 0;
  if (d > 0.05) {
    const sp = arrive > 0 && d < arrive ? speed * (d / arrive) : speed;
    tvx = (dx / d) * sp; tvz = (dz / d) * sp;
  }
  u.vx += (tvx - u.vx) * ACCEL;
  u.vz += (tvz - u.vz) * ACCEL;
}

function halt(u) {
  u.vx -= u.vx * ACCEL * 2;
  u.vz -= u.vz * ACCEL * 2;
}

function updateUnit(st, u, enemies) {
  const s = stats(u.type);
  if (u.type === 'medic') {
    // Medic: heal the most wounded ally in range before normal targeting
    const speed = s.speed * u.speedMul * (u.dash > 0 ? CHARGE.speedMul : 1);
    const home = st.forts[u.team];
    const enemyTeam = otherTeam(u.team);
    const efort = st.forts[enemyTeam];

    // Retreat and heal
    if (u.state === 'fight' && shouldRetreat(u)) {
      u.state = 'retreat';
      u.targetId = 0;
      st.events.push({ type: 'retreat', id: u.id, team: u.team, x: u.x, z: u.z });
    }
    if (u.state === 'retreat') {
      const dx = home.x - u.x, dz = home.z - u.z;
      const near = dx * dx + dz * dz <= (home.r + 4) * (home.r + 4);
      if (near) {
        halt(u);
        u.hp = Math.min(u.maxHp, u.hp + (u.maxHp * 0.08) / WF_HZ);
        if (u.hp >= u.maxHp * REJOIN_AT) u.state = 'fight';
      } else {
        seek(u, home.x + dirOf(u.team) * 2, home.z, speed * 1.1);
      }
      return;
    }

    // Heal pulse: find most wounded ally in range
    if (u.cd <= 0) {
      let best = null, bestPct = 1;
      for (const a of st.units) {
        if (!a.alive || a.team !== u.team || a === u || a.carriedBy) continue;
        const dx = a.x - u.x, dz = a.z - u.z;
        if (dx * dx + dz * dz > s.range * s.range) continue;
        const pct = a.hp / a.maxHp;
        if (pct < bestPct) { bestPct = pct; best = a; }
      }
      if (best) {
        halt(u);
        u.cd = Math.round(s.cooldown * u.cdMul);
        best.hp = Math.min(best.maxHp, best.hp + s.heal);
        st.events.push({ type: 'heal', id: best.id, x: best.x, z: best.z, healer: u.id, amount: s.heal });
        return;
      }
    }
    // No wounded ally: fall through to normal targeting with weak melee
  }
  if (u.carriedBy) {
    const c = st.byId.get(u.carriedBy);
    if (c && c.alive) { u.x = c.x; u.z = c.z; u.vx = c.vx; u.vz = c.vz; u.kx = 0; u.kz = 0; return; }
    u.carriedBy = 0;
  }
  // Inflatable decoy: no brain, no attack, just a ticking balloon that pops.
  if (u.decoy) {
    u.vx = 0; u.vz = 0;
    u.ttl--;
    if (u.ttl <= 0 || u.hp <= 0) kill(st, u, null, 0, 0);
    return;
  }
  if (u.cd > 0) u.cd--;
  if (u.dashCd > 0) u.dashCd--;
  if (u.dash > 0) u.dash--;
  if (u.boostT > 0 && --u.boostT === 0) u.boostMul = 1;
  if (u.rageT > 0) u.rageT--;
  if (u.type === 'boss' && !u.enraged && u.hp < u.maxHp * ENRAGE_AT) {
    u.enraged = true;
    u.speedMul = 1.35;
    u.cdMul = 0.8;
    st.events.push({ type: 'enrage', id: u.id, team: u.team, x: u.x, z: u.z });
    for (let i = 0; i < ENRAGE_KAMIS; i++) {
      spawnUnit(st, u.team, 'kami', { x: u.x + dirOf(u.team) * -1.5, z: u.z + (i - 1) * 2.2, hpMul: st.scaling.hpMul, dmgMul: st.scaling.dmgMul });
    }
  }
  const speed = s.speed * u.speedMul * (u.rankSpeedMul || 1) * u.boostMul * (u.dash > 0 ? CHARGE.speedMul : 1) * terrainSpeedMul(st, u.x, u.z);
  const home = st.forts[u.team];
  const enemyTeam = otherTeam(u.team);
  const efort = st.forts[enemyTeam];

  // Army morale: a broken line routs away from the front for a few seconds.
  if (u.routCd > 0) u.routCd--;
  const armyMorale = moraleOf(st, u.team);
  if (u.state === 'rout') {
    u.routTicks = Math.max(0, (u.routTicks || 0) - 1);
    const dx = home.x - u.x, dz = home.z - u.z;
    const nearHome = dx * dx + dz * dz <= (home.r + 4) * (home.r + 4);
    if (nearHome) {
      // Reaching the fort steadies the army and ends this unit's rout.
      u.state = 'fight';
      u.routTicks = 0;
      u.routCd = ROUT_COOLDOWN;
      u.targetId = 0;
      setMorale(st, u.team, moraleOf(st, u.team) + MORALE_FORT_RESTORE, 'fort');
      halt(u);
      return;
    }
    if (u.routTicks <= 0) {
      u.state = 'fight';
      u.routCd = ROUT_COOLDOWN;
      u.targetId = 0;
    } else {
      dropCarry(st, u);
      seek(u, home.x, home.z, speed * 1.15);
      return;
    }
  }
  if (u.state !== 'rout' && !STEADFAST.has(u.type) && u.routCd <= 0 && armyMorale < MORALE_ROUT_AT) {
    u.state = 'rout';
    u.routTicks = ROUT_TICKS;
    u.targetId = 0;
    dropCarry(st, u);
    if (st.routed && !st.routed[u.team]) {
      st.routed[u.team] = true;
      st.events.push({ type: 'rout', team: u.team, morale: armyMorale, x: u.x, z: u.z, source: 'unit' });
    }
    seek(u, home.x, home.z, speed * 1.15);
    return;
  }

  // Stealer hauling a captive home
  if (u.carrying) {
    const v = st.byId.get(u.carrying);
    if (!v || !v.alive) { u.carrying = 0; }
    else {
      const carrySpeed = s.carrySpeed * terrainSpeedMul(st, u.x, u.z);
      seek(u, home.x, home.z, carrySpeed);
      const dx = home.x - u.x, dz = home.z - u.z;
      if (dx * dx + dz * dz <= (home.r + PEN_REACH) * (home.r + PEN_REACH)) {
        const from = v.team;
        v.team = u.team;
        v.carriedBy = 0;
        v.hp = Math.max(v.hp, v.maxHp * 0.6);
        v.state = 'fight';
        v.targetId = 0;
        v.x = u.x + dirOf(u.team) * 1.5;
        u.carrying = 0;
        st.stats[u.team].converted++;
        st.stats[from].lost++;
        st.events.push({ type: 'convert', id: v.id, team: u.team, from, unit: v.type, x: v.x, z: v.z });
      }
      return;
    }
  }

  // Retreat and heal
  if (u.state === 'fight' && shouldRetreat(u)) {
    u.state = 'retreat';
    u.targetId = 0;
    st.events.push({ type: 'retreat', id: u.id, team: u.team, x: u.x, z: u.z });
  }
  if (u.state === 'retreat') {
    const dx = home.x - u.x, dz = home.z - u.z;
    const near = dx * dx + dz * dz <= (home.r + 4) * (home.r + 4);
    if (near) {
      halt(u);
      u.hp = Math.min(u.maxHp, u.hp + (u.maxHp * 0.08) / WF_HZ);
      if (u.hp >= u.maxHp * REJOIN_AT) u.state = 'fight';
    } else {
      seek(u, home.x + dirOf(u.team) * 2, home.z, speed * 1.1);
    }
    return;
  }

  // Target selection (staggered so 120 units don't all think on the same tick).
  // A grudge lets a stationary unit answer bombardment past aggro; a natural target always
  // ends one, so grudges never pull units off a real fight.
  let t = u.targetId ? st.byId.get(u.targetId) : null;
  if (!t || !t.alive || t.carriedBy || t.team === u.team) {
    u.grudgeId = 0;
    t = pickTarget(u, enemies) || fortAlarm(st, u, enemies) || startGrudge(st, u);
    u.targetId = t ? t.id : 0;
  } else if ((st.tick + u.id) % 6 === 0) {
    t = pickTarget(u, enemies) || fortAlarm(st, u, enemies);
    if (t) u.grudgeId = 0;
    else t = keepGrudge(st, u) || startGrudge(st, u);
    u.targetId = t ? t.id : 0;
  }

  if (t) {
    const dx = t.x - u.x, dz = t.z - u.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const reach = s.range + u.radius + t.radius;
    if (s.attack === 'rocket') {
      if (d < s.minRange) seek(u, u.x - dx, u.z - dz, speed);
      else if (d <= s.range) {
        halt(u);
        const rocketCdMul = inMud(st, u.x, u.z) ? MUD_ROCKET_RELOAD_MUL : 1;
        if (u.cd <= 0) { u.cd = Math.round(s.cooldown * u.cdMul * rocketCdMul); fireShell(st, u, t.x, t.z, t.vx, t.vz); }
      } else {
        // hold formation behind our own shield wall instead of walking out in front of it
        const front = st.front && st.front[u.team];
        const dir = dirOf(u.team);
        if (front !== null && front !== undefined && (u.x - front) * dir > -ROCKET_BEHIND_SHIELD && dx * dir > 0) seek(u, front - dir * (ROCKET_BEHIND_SHIELD + 0.5), u.z, speed, 1.5);
        else seek(u, t.x, t.z, speed);
      }
      return;
    }
    if (d <= reach) {
      halt(u);
      if (s.attack === 'blast') {
        st.events.push({ type: 'explode', team: u.team, src: u.type, x: u.x, z: u.z, r: s.splash, big: true });
        splash(st, u.x, u.z, s.splash, u.team, u.type, dmgMulOf(u), { ax: u.x, az: u.z, attId: u.id });
        kill(st, u, null, 0, 0);
        return;
      }
      if (s.attack === 'grab' && t.type === 'kami' && t !== u) {
        // Fuse flip: a stealer re-lights a kami and spins it back at its own side.
        const from = t.team;
        t.team = u.team;
        t.targetId = 0;
        t.kx -= dirOf(u.team) * -6;
        st.stats[u.team].converted++;
        st.stats[from].lost++;
        st.events.push({ type: 'convert', id: t.id, team: u.team, from, unit: t.type, x: t.x, z: t.z, flip: true });
        u.cd = s.cooldown;
        return;
      }
      if (s.attack === 'grab' && stats(t.type).grabbable && !t.carrying && !t.carriedBy) {
        u.carrying = t.id;
        t.carriedBy = u.id;
        t.targetId = 0;
        st.events.push({ type: 'grab', id: u.id, victim: t.id, team: u.team, x: t.x, z: t.z });
        return;
      }
      if (u.cd <= 0) {
        u.cd = Math.round(s.cooldown * u.cdMul);
        if (s.attack === 'slam') {
          const charging = u.dash > 0;
          const r = s.splash * (u.enraged ? 1.25 : 1);
          st.events.push({ type: 'slam', id: u.id, team: u.team, unit: u.type, x: u.x, z: u.z, r, charge: charging });
          splash(st, t.x, t.z, r, u.team, u.type, dmgMulOf(u) * (charging ? 1.5 : 1), { ax: u.x, az: u.z, attId: u.id });
          u.dash = 0;
        } else {
          const backstab = u.type === 'sneak' && t.targetId && t.targetId !== u.id;
          const base = s.dmg * (backstab ? BACKSTAB : 1);
          if (backstab) st.events.push({ type: 'backstab', id: u.id, team: u.team, x: t.x, z: t.z });
          hurt(st, t, computeDamage(u.type, t.type, { dmgMul: dmgMulOf(u) * groundMult(st, u.x, u.z), base }), u.team, u.type, u.x, u.z, u.id);
        }
      }
      return;
    }
    if (u.type === 'brute' && u.dashCd <= 0 && d >= CHARGE.min && d <= CHARGE.max) {
      u.dash = CHARGE.ticks;
      u.dashCd = CHARGE.cooldown;
      st.events.push({ type: 'charge', id: u.id, team: u.team, x: u.x, z: u.z });
    }
    const g = s.flanker ? flankGoal(u, t.x, t.z) : t;
    seek(u, g.x, g.z, speed);
    return;
  }

  // No unit target: hit the enemy fort if in reach, else march to the objective.
  const fdx = efort.x - u.x, fdz = efort.z - u.z;
  const fd = Math.sqrt(fdx * fdx + fdz * fdz);
  if (!efort.invulnerable && efort.hp > 0) {
    const freach = (s.attack === 'rocket' ? s.range : s.range + u.radius) + efort.r;
    if (fd <= freach) {
      halt(u);
      if (s.attack === 'blast') {
        st.events.push({ type: 'explode', team: u.team, src: u.type, x: u.x, z: u.z, r: s.splash, big: true });
        hurtFort(st, enemyTeam, s.dmg * dmgMulOf(u) * 2.5, u.type);
        kill(st, u, null, 0, 0);
      } else if (u.cd <= 0) {
        u.cd = Math.round((s.cooldown || 30) * u.cdMul);
        if (s.attack === 'rocket') fireShell(st, u, efort.x, efort.z, 0, 0);
        else hurtFort(st, enemyTeam, s.dmg * dmgMulOf(u), u.type);
      }
      return;
    }
  }
  const attacking = st.mode === 'defense' && u.team === 'red';
  if (attacking) { seek(u, efort.x, efort.z, speed); return; }
  const r = st.rally[u.team];
  const slot = formationSlot(u);
  seek(u, r.x + slot.x, r.z + slot.z, speed, 2.5);
}

/** x of a side's most advanced fighting shield (toward the enemy), or null. */
function frontShield(army, dir) {
  let best = null;
  for (const u of army) {
    if (u.type !== 'shield' || u.state !== 'fight' || u.carriedBy) continue;
    if (best === null || u.x * dir > best * dir) best = u.x;
  }
  return best;
}

function integrate(st) {
  const units = st.units;
  for (const u of units) {
    if (!u.alive || u.carriedBy) continue;
    u.x += (u.vx + u.kx) * WF_DT;
    u.z += (u.vz + u.kz) * WF_DT;
    u.kx *= KNOCK_DECAY;
    u.kz *= KNOCK_DECAY;
  }
  // Pairwise separation: heavier units shove lighter ones.
  const n = units.length;
  for (let i = 0; i < n; i++) {
    const a = units[i];
    if (!a.alive || a.carriedBy) continue;
    for (let j = i + 1; j < n; j++) {
      const b = units[j];
      if (!b.alive || b.carriedBy) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const min = a.radius + b.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      const over = min - d;
      const ma = stats(a.type).mass, mb = stats(b.type).mass;
      const wa = mb / (ma + mb), wb = ma / (ma + mb);
      const nx = d2 > 0 ? dx / d : 1, nz = d2 > 0 ? dz / d : 0;
      a.x -= nx * over * wa; a.z -= nz * over * wa;
      b.x += nx * over * wb; b.z += nz * over * wb;
    }
  }
  for (const u of units) {
    if (!u.alive || u.carriedBy) continue;
    if (!u.touching) u.pushT = 0;
    u.touching = false;
    for (const o of st.barricades) pushOut(u, o.x, o.z, o.r);
    for (const team of ['blue', 'red']) { const f = st.forts[team]; pushOut(u, f.x, f.z, f.r); }
    u.x = clamp(u.x, -FIELD.halfX, FIELD.halfX);
    u.z = clamp(u.z, -FIELD.halfZ, FIELD.halfZ);
  }
}

function pushOut(u, x, z, r) {
  const dx = u.x - x, dz = u.z - z;
  const min = r + u.radius;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2) || 0.001;
  const nx = dx / d, nz = dz / d;
  u.x = x + nx * min;
  u.z = z + nz * min;
  u.touching = true;
  u.pushT++;
  // Slide around, but only when genuinely stuck: a unit pressing head-on into a wall sits in
  // perfect equilibrium with its seek steering forever (e.g. the boss marching z=0 into a
  // barricade on the centre line). Brief brawl jostles never reach the threshold, so the
  // nudge can't perturb normal fighting. The drift always goes to the unit's deterministic
  // flank side so it can't oscillate; it stops the moment the unit isn't pressing in.
  if (u.pushT > 45) {
    const into = -(u.vx * nx + u.vz * nz);
    if (into > 0) {
      const slide = Math.min(into, 2) * 0.6 * (u.flankSide || 1);
      u.vx += -nz * slide;
      u.vz += nx * slide;
    }
  }
}

/** Spike pits chew on enemies standing in them (in 0.5 s chunks, so the event feed stays readable). */
function updateTraps(st) {
  for (let i = st.traps.length - 1; i >= 0; i--) {
    const t = st.traps[i];
    if (--t.ticks <= 0) {
      st.traps.splice(i, 1);
      st.events.push({ type: 'trapGone', team: t.team, x: t.x, z: t.z });
      continue;
    }
    if (st.tick % 15 !== 0) continue;
    const dmg = t.dps / 2;
    for (const u of st.units) {
      if (!u.alive || u.team === t.team || u.carriedBy) continue;
      const dx = u.x - t.x, dz = u.z - t.z;
      if (dx * dx + dz * dz <= t.r * t.r) hurt(st, u, dmg, t.team, 'trap', t.x, t.z);
    }
  }
}

function armyValue(st, team) {
  let v = 0;
  for (const u of st.units) if (u.alive && u.team === team && !u.decoy) v += stats(u.type).cost;
  return v;
}

function suddenDeath(st) {
  if (st.tick === SUDDEN_DEATH_TICK) st.events.push({ type: 'suddenDeath' });
  const blue = armyValue(st, 'blue'), red = armyValue(st, 'red');
  const ratio = (own, foe) => Math.min(2, Math.max(0.5, (foe + 1) / (own + 1)));
  st.forts.blue.hp -= SUDDEN_DEATH_DRAIN * ratio(blue, red);
  st.forts.red.hp -= SUDDEN_DEATH_DRAIN * ratio(red, blue);
}

function updatePhase(st) {
  if (st.mode === 'versus') {
    if (st.income && st.tick % WF_HZ === 0) { st.coins.blue += st.income; st.coins.red += st.incomeRed; }
    if (st.tick >= SUDDEN_DEATH_TICK) suddenDeath(st);
    return;
  }
  if (st.phase === 'prep') {
    if (st.prepTicks > 0) { st.prepTicks--; return; }
    st.wave++;
    st.phase = 'battle';
    st.spawnQueue = waveComposition(st.wave, st.diff.budget);
    const sc = waveScaling(st.wave);
    st.scaling = { hpMul: sc.hpMul * st.diff.hp, dmgMul: sc.dmgMul * st.diff.dmg };
    st.spawnCd = 0;
    st.events.push({ type: 'waveStart', wave: st.wave, boss: isBossWave(st.wave), count: st.spawnQueue.length });
    return;
  }
  if (st.phase !== 'battle') return;
  if (st.spawnQueue.length) {
    if (st.spawnCd > 0) { st.spawnCd--; return; }
    const type = st.spawnQueue.shift();
    const f = st.forts.red;
    const z = type === 'boss' ? 0 : st.rng.range(-15, 15);
    spawnUnit(st, 'red', type, { x: f.x - (f.r + 1.5), z, hpMul: st.scaling.hpMul, dmgMul: st.scaling.dmgMul });
    if (type === 'boss') st.events.push({ type: 'boss', wave: st.wave });
    st.spawnCd = SPAWN_GAP;
    return;
  }
  for (const u of st.units) if (u.alive && u.team === 'red') return;
  const reward = waveReward(st.wave);
  st.coins.blue += reward;
  st.stats.blue.coinsEarned += reward;
  st.stats.wavesCleared = st.wave;
  for (const u of st.units) if (u.alive && u.team === 'blue') u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
  st.events.push({ type: 'waveClear', wave: st.wave, reward });
  const finalWave = st.finalWave || FINAL_WAVE;
  if (st.wave >= finalWave) { end(st, 'blue'); return; }
  st.phase = 'prep';
  st.prepTicks = PREP_BETWEEN;
}

function end(st, winner) {
  st.phase = winner === 'blue' ? 'won' : 'lost';
  st.winner = winner;
  st.events.push({ type: winner === 'blue' ? 'win' : 'lose', winner });
}

/**
 * Advance one fixed tick.
 * @param {object} st battle state
 * @param {Array} [commands] commands to apply this tick (applied in order, before simulation)
 */
export function stepBattle(st, commands = []) {
  st.events = [];
  if (st.phase === 'won' || st.phase === 'lost') return st;
  st.tick++;
  st.byId = new Map();
  for (const u of st.units) st.byId.set(u.id, u);
  for (const c of commands) applyCommand(st, c);
  for (const u of st.units) if (!st.byId.has(u.id)) st.byId.set(u.id, u);
  updatePhase(st);
  ensureMoraleState(st);
  for (const team of ['blue', 'red']) {
    const m = st.morale[team];
    if (m < 1) setMorale(st, team, m + MORALE_RECOVER, 'time');
  }
  for (const u of st.units) if (!st.byId.has(u.id)) st.byId.set(u.id, u);

  const blue = [], red = [];
  for (const u of st.units) if (u.alive) (u.team === 'blue' ? blue : red).push(u);
  st.front = { blue: frontShield(blue, 1), red: frontShield(red, -1) };
  for (const u of st.units) {
    if (!u.alive) continue;
    updateUnit(st, u, u.team === 'blue' ? red : blue);
  }
  updateShells(st);
  updateTraps(st);
  integrate(st);
  st.units = st.units.filter(u => u.alive);

  if (st.forts.blue.hp <= 0) end(st, 'red');
  else if (st.mode === 'versus' && st.forts.red.hp <= 0) end(st, 'blue');
  else if (st.mode === 'versus') {
    // a side with no army, no coins to rebuild and nothing in the air has lost
    for (const team of ['blue', 'red']) {
      const alive = st.units.some(u => u.team === team);
      if (!alive && st.coins[team] < 25) { end(st, otherTeam(team)); break; }
    }
  }
  return st;
}

/** Order-sensitive 32-bit FNV-1a over everything that matters. Equal hashes ⇒ same battle. */
export function battleHash(st) {
  let h = 0x811c9dc5;
  const mix = v => { h ^= (v | 0); h = Math.imul(h, 0x01000193); };
  mix(st.tick); mix(st.wave); mix(st.coins.blue); mix(st.coins.red);
  mix(Math.round(st.forts.blue.hp * 10)); mix(Math.round(st.forts.red.hp * 10));
  mix(st.units.length); mix(st.shells.length); mix(st.traps.length); mix(st.finalWave || 0);
  // Battleground state: a broken barricade or a flipped stance must show up in the hash,
  // or two peers could silently disagree about the board after a reconnect.
  mix(st.barricades.length);
  for (const b of st.barricades) if (b.hp > 0) mix(Math.round(b.hp * 10));
  mix(st.mud.length);
  for (const m of st.mud) { mix(Math.round(m.x * 100)); mix(Math.round(m.z * 100)); mix(Math.round(m.r * 100)); }
  const props = Array.isArray(st.props) ? st.props : [];
  mix(props.length);
  for (const p of props) {
    if (!p) continue;
    mix(p.id); mix(p.type === 'barrel' ? 1 : 2);
    mix(Math.round(p.x * 100)); mix(Math.round(p.z * 100)); mix(Math.round(p.hp * 10));
  }
  for (const t of st.traps) {
    mix(Math.round(t.x * 100)); mix(Math.round(t.z * 100)); mix(t.ticks);
    mix(t.team === 'blue' ? 1 : 2);
  }
  // Commander-visible state also desyncs battles: a rally/stance the peer never got changes
  // every order that follows, so it belongs in the hash.
  const phaseCode = st.phase === 'prep' ? 1 : st.phase === 'battle' ? 2 : st.phase === 'won' ? 3 : 4;
  mix(phaseCode); mix(st.prepTicks); mix(st.spawnQueue.length);
  for (const team of ['blue', 'red']) {
    const r = st.rally[team];
    mix(Math.round(r.x * 100)); mix(Math.round(r.z * 100));
    const s = st.stance && st.stance[team];
    mix(s === 'defense' ? 2 : s === 'charge' ? 3 : 1);
  }
  mix(Math.round(moraleOf(st, 'blue') * 1000));
  mix(Math.round(moraleOf(st, 'red') * 1000));
  mix(st.routed?.blue ? 1 : 0); mix(st.routed?.red ? 1 : 0);
  for (const u of st.units) {
    mix(u.id); mix(u.team === 'blue' ? 1 : 2);
    mix(Math.round(u.x * 1000)); mix(Math.round(u.z * 1000)); mix(Math.round(u.hp * 100));
    mix(u.carrying); mix(u.carriedBy); mix(u.rank || 0); mix(u.kills || 0); mix(u.rageT || 0);
    mix(u.state === 'rout' ? 1 : u.state === 'retreat' ? 2 : 3);
    mix(u.routTicks || 0); mix(u.routCd || 0);
  }
  return h >>> 0;
}

/** Live counts for the HUD. */
export function armyCounts(st) {
  const c = { blue: 0, red: 0 };
  for (const u of st.units) if (u.alive) c[u.team]++;
  return c;
}
