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
import { Rng } from './rng.js';
import { stats, otherTeam, bounty, RECRUITABLE } from './warfareUnits.js';
import { computeDamage, splashFalloff, knockback, COVER_RADIUS } from './warfareDamage.js';
import { pickTarget, shouldRetreat, flankGoal, REJOIN_AT } from './warfareAI.js';
import { FINAL_WAVE, isBossWave, waveComposition, waveScaling, waveReward, DIFFICULTY } from './warfareWaves.js';

export const WF_HZ = 30;
export const WF_DT = 1 / WF_HZ;
export const FIELD = Object.freeze({ halfX: 40, halfZ: 22 });
export const FORT_X = 36;
export const FORT_RADIUS = 3.2;
export const PREP_FIRST = 25 * WF_HZ;
export const PREP_BETWEEN = 14 * WF_HZ;
export const ARMY_CAP = 60;
export const DEFENSE_FORT_HP = 2000;
/** Units chip forts for this fraction of their unit damage (forts are sturdy toys). */
export const FORT_DMG_MULT = 0.6;
/** Defenders drop what they're doing for enemies this close to their fort. */
export const FORT_ALARM = 16;
/** Stealers convert captives anywhere inside this ring around their fort (the pen). */
export const PEN_REACH = 4;
export const SPAWN_GAP = 8;
export const VERSUS_INCOME = 4;          // coins per second per side in versus
/** Dowel-bundle barricades in no-man's land: circles units slide around. */
export const BARRICADES = Object.freeze([
  { x: -2, z: -13, r: 1.5 }, { x: 2, z: -4.5, r: 1.5 }, { x: -2, z: 4.5, r: 1.5 }, { x: 2, z: 13, r: 1.5 },
]);

/** Speed multiplier per formation stance (the [R] toggle). Recruits inherit the current stance. */
export const STANCE_SPEED = Object.freeze({ charge: 1.35, defense: 0.8 });
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
const KNOCK_DECAY = 0.86;
/** Magnet Crane commander toy: cost, pull radius, ring it drags enemies to, pull fraction, attack stun. */
export const MAGNET = { cost: 30, radius: 14, ring: 2.5, pull: 0.6, stunTicks: 12 };

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
 */
export function createBattle({ seed = 1, mode = 'defense', army = true, coins, difficulty = 'normal', barricades, highGround } = {}) {
  const versus = mode === 'versus';
  const dkey = !versus && Object.hasOwn(DIFFICULTY, difficulty) ? difficulty : 'normal';
  const diff = DIFFICULTY[dkey];
  const fortHp = versus ? 1200 : Math.round(DEFENSE_FORT_HP * diff.fort);
  const st = {
    mode, seed, tick: 0, difficulty: dkey, diff, rng: new Rng(seed), nextId: 1,
    units: [], shells: [], events: [],
    forts: {
      blue: { x: -FORT_X, z: 0, hp: fortHp, maxHp: fortHp, r: FORT_RADIUS, invulnerable: false },
      red: { x: FORT_X, z: 0, hp: 1200, maxHp: 1200, r: FORT_RADIUS, invulnerable: !versus },
    },
    rally: { blue: { x: -22, z: 0 }, red: { x: 22, z: 0 } },
    barricades: (barricades ?? BARRICADES).map(b => ({ ...b })),
    highGround: (highGround ?? []).map(r => ({ ...r })),
    coins: { blue: coins ?? (versus ? 150 : diff.coins), red: versus ? (coins ?? 150) : 0 },
    wave: 0,
    phase: versus ? 'battle' : 'prep',
    prepTicks: versus ? 0 : PREP_FIRST,
    spawnQueue: [], spawnCd: 0, scaling: { hpMul: 1, dmgMul: 1 },
    winner: null, income: versus ? VERSUS_INCOME : 0,
    stats: { blue: teamStats(), red: teamStats(), wavesCleared: 0 },
  };
  if (army) {
    const start = versus ? ['shield', 'shield', 'shield', 'rocket', 'rocket'] : ['shield', 'shield', 'shield', 'shield', 'rocket', 'rocket', 'stealer'];
    for (const t of start) spawnUnit(st, 'blue', t, { x: -26 + st.rng.range(-3, 3), z: st.rng.range(-8, 8) });
    if (versus) for (const t of start) spawnUnit(st, 'red', t, { x: 26 + st.rng.range(-3, 3), z: st.rng.range(-8, 8) });
  }
  return st;
}

/** Add a unit. Returns it. */
export function spawnUnit(st, team, type, { x, z, hpMul = 1, dmgMul = 1 } = {}) {
  const s = stats(type);
  const id = st.nextId++;
  const u = {
    id, team, type, x, z, vx: 0, vz: 0, kx: 0, kz: 0,
    hp: s.hp * hpMul, maxHp: s.hp * hpMul, dmgMul,
    cd: st.rng.int(Math.max(1, s.cooldown || 1)),
    state: 'fight', targetId: 0, carrying: 0, carriedBy: 0,
    flankSide: (id & 1) ? 1 : -1, alive: true, radius: s.radius,
    dash: 0, dashCd: 60, enraged: false, speedMul: stanceSpeedMul(st, team), cdMul: 1,
  };
  st.units.push(u);
  st.events.push({ type: 'spawn', id, team, unit: type, x, z });
  return u;
}

const dirOf = team => (team === 'blue' ? 1 : -1);

/** Apply commands from a commander (local input, AI, or a network peer). */
export function applyCommand(st, c) {
  if (!c || st.phase === 'won' || st.phase === 'lost') return false;
  if (c.type === 'rally') {
    st.rally[c.team] = { x: clamp(+c.x || 0, -FIELD.halfX + 2, FIELD.halfX - 2), z: clamp(+c.z || 0, -FIELD.halfZ + 2, FIELD.halfZ - 2) };
    st.events.push({ type: 'rally', team: c.team, x: st.rally[c.team].x, z: st.rally[c.team].z });
    return true;
  }
  if (c.type === 'recruit') {
    if (!RECRUITABLE.includes(c.unit)) return false;
    if (st.mode === 'defense' && c.team !== 'blue') return false;
    const cost = stats(c.unit).cost;
    if (st.coins[c.team] < cost) return false;
    let n = 0;
    for (const u of st.units) if (u.alive && u.team === c.team) n++;
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
    damageBarricades(st, tx, tz, splashR, splashDmg, c.team);
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
        u.speedMul = 1.35;
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
  return false;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function kill(st, u, attTeam, kx, kz) {
  if (!u.alive) return;
  u.alive = false;
  u.hp = 0;
  st.events.push({ type: 'death', id: u.id, team: u.team, unit: u.type, x: u.x, z: u.z, kx, kz });
  st.stats[u.team].lost++;
  if (attTeam && attTeam !== u.team) {
    st.stats[attTeam].kills++;
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

/** Damage `t` from an attacker of (team, type) at (ax, az). */
function hurt(st, t, dmg, attTeam, attType, ax, az) {
  if (!t.alive || dmg <= 0) return;
  t.hp -= dmg;
  const dx = t.x - ax, dz = t.z - az;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  const kb = knockback(dmg, stats(t.type).mass);
  const kx = (dx / d) * kb, kz = (dz / d) * kb;
  if (!t.carriedBy) { t.kx += kx; t.kz += kz; }
  st.stats[attTeam].dmgDealt += dmg;
  st.events.push({ type: 'hit', id: t.id, team: t.team, unit: t.type, src: attType, dmg, x: t.x, z: t.z, kx, kz });
  if (t.hp <= 0) kill(st, t, attTeam, kx, kz);
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
function splash(st, x, z, radius, attTeam, attType, dmgMul, { cover = false, base, ax, az } = {}) {
  const hg = groundMult(st, ax ?? x, az ?? z);
  for (const e of st.units) {
    if (!e.alive || e.team === attTeam) continue;
    const dx = e.x - x, dz = e.z - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const f = splashFalloff(d, radius + e.radius * 0.5);
    if (f <= 0) continue;
    const dmg = computeDamage(attType, e.type, { base, dmgMul: dmgMul * hg, falloff: f, covered: cover && isCovered(st, e) });
    hurt(st, e, dmg, attTeam, attType, x, z);
  }
  damageBarricades(st, x, z, radius, (stats(attType).dmg || 0) * dmgMul, attTeam);
}

function hurtFort(st, team, dmg, attType) {
  const f = st.forts[team];
  if (f.invulnerable || f.hp <= 0) return;
  dmg *= FORT_DMG_MULT;
  f.hp = Math.max(0, f.hp - dmg);
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
    x1: tx + tvx * lead, z1: tz + tvz * lead, t: 0, T, dmgMul: u.dmgMul, splash: s.splash,
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
    splash(st, sh.x1, sh.z1, sh.splash, sh.team, sh.src, sh.dmgMul, { cover: true, ax: sh.x0, az: sh.z0 });
    const enemy = otherTeam(sh.team);
    const f = st.forts[enemy];
    const fx = sh.x1 - f.x, fz = sh.z1 - f.z;
    if (fx * fx + fz * fz <= (f.r + 1.5) * (f.r + 1.5)) hurtFort(st, enemy, stats(sh.src).dmg * sh.dmgMul * 0.6, sh.src);
  }
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
  if (u.carriedBy) {
    const c = st.byId.get(u.carriedBy);
    if (c && c.alive) { u.x = c.x; u.z = c.z; u.vx = c.vx; u.vz = c.vz; u.kx = 0; u.kz = 0; return; }
    u.carriedBy = 0;
  }
  if (u.cd > 0) u.cd--;
  if (u.dashCd > 0) u.dashCd--;
  if (u.dash > 0) u.dash--;
  if (u.type === 'boss' && !u.enraged && u.hp < u.maxHp * ENRAGE_AT) {
    u.enraged = true;
    u.speedMul = 1.35;
    u.cdMul = 0.8;
    st.events.push({ type: 'enrage', id: u.id, team: u.team, x: u.x, z: u.z });
    for (let i = 0; i < ENRAGE_KAMIS; i++) {
      spawnUnit(st, u.team, 'kami', { x: u.x + dirOf(u.team) * -1.5, z: u.z + (i - 1) * 2.2, hpMul: st.scaling.hpMul, dmgMul: st.scaling.dmgMul });
    }
  }
  const speed = s.speed * u.speedMul * (u.dash > 0 ? CHARGE.speedMul : 1);
  const home = st.forts[u.team];
  const enemyTeam = otherTeam(u.team);
  const efort = st.forts[enemyTeam];

  // Stealer hauling a captive home
  if (u.carrying) {
    const v = st.byId.get(u.carrying);
    if (!v || !v.alive) { u.carrying = 0; }
    else {
      seek(u, home.x, home.z, s.carrySpeed);
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

  // Target selection (staggered so 120 units don't all think on the same tick)
  let t = u.targetId ? st.byId.get(u.targetId) : null;
  if (!t || !t.alive || t.carriedBy || t.team === u.team || (st.tick + u.id) % 6 === 0) {
    t = pickTarget(u, enemies) || fortAlarm(st, u, enemies);
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
        if (u.cd <= 0) { u.cd = Math.round(s.cooldown * u.cdMul); fireShell(st, u, t.x, t.z, t.vx, t.vz); }
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
        splash(st, u.x, u.z, s.splash, u.team, u.type, u.dmgMul, { ax: u.x, az: u.z });
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
          splash(st, t.x, t.z, r, u.team, u.type, u.dmgMul * (charging ? 1.5 : 1), { ax: u.x, az: u.z });
          u.dash = 0;
        } else {
          const backstab = u.type === 'sneak' && t.targetId && t.targetId !== u.id;
          const base = s.dmg * (backstab ? BACKSTAB : 1);
          if (backstab) st.events.push({ type: 'backstab', id: u.id, team: u.team, x: t.x, z: t.z });
          hurt(st, t, computeDamage(u.type, t.type, { dmgMul: u.dmgMul * groundMult(st, u.x, u.z), base }), u.team, u.type, u.x, u.z);
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
        hurtFort(st, enemyTeam, s.dmg * u.dmgMul * 2.5, u.type);
        kill(st, u, null, 0, 0);
      } else if (u.cd <= 0) {
        u.cd = Math.round((s.cooldown || 30) * u.cdMul);
        if (s.attack === 'rocket') fireShell(st, u, efort.x, efort.z, 0, 0);
        else hurtFort(st, enemyTeam, s.dmg * u.dmgMul, u.type);
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
  u.x = x + (dx / d) * min;
  u.z = z + (dz / d) * min;
}

function updatePhase(st) {
  if (st.mode === 'versus') {
    if (st.income && st.tick % WF_HZ === 0) { st.coins.blue += st.income; st.coins.red += st.income; }
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
  if (st.wave >= FINAL_WAVE) { end(st, 'blue'); return; }
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
  for (const u of st.units) if (!st.byId.has(u.id)) st.byId.set(u.id, u);

  const blue = [], red = [];
  for (const u of st.units) if (u.alive) (u.team === 'blue' ? blue : red).push(u);
  st.front = { blue: frontShield(blue, 1), red: frontShield(red, -1) };
  for (const u of st.units) {
    if (!u.alive) continue;
    updateUnit(st, u, u.team === 'blue' ? red : blue);
  }
  updateShells(st);
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
  mix(st.units.length); mix(st.shells.length);
  // Battleground state: a broken barricade or a flipped stance must show up in the hash,
  // or two peers could silently disagree about the board after a reconnect.
  mix(st.barricades.length);
  for (const b of st.barricades) if (b.hp > 0) mix(Math.round(b.hp * 10));
  mix(st.stance?.blue === 'defense' ? 2 : st.stance?.blue === 'charge' ? 3 : 1);
  mix(st.stance?.red === 'defense' ? 2 : st.stance?.red === 'charge' ? 3 : 1);
  mix(Math.round(st.rally.blue.x * 100)); mix(Math.round(st.rally.blue.z * 100));
  mix(Math.round(st.rally.red.x * 100)); mix(Math.round(st.rally.red.z * 100));
  for (const u of st.units) {
    mix(u.id); mix(u.team === 'blue' ? 1 : 2);
    mix(Math.round(u.x * 1000)); mix(Math.round(u.z * 1000)); mix(Math.round(u.hp * 100));
    mix(u.carrying); mix(u.carriedBy);
  }
  return h >>> 0;
}

/** Live counts for the HUD. */
export function armyCounts(st) {
  const c = { blue: 0, red: 0 };
  for (const u of st.units) if (u.alive) c[u.team]++;
  return c;
}
