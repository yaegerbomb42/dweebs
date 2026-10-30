// WildsSim.js — "Dweeb Wilds": a huge open playground where trait-built Dweebs try to
// survive on their own. Pure, deterministic simulation (no three.js); WildsMode.js renders it.
//
// Every Dweeb is built with the same TraitBalance pipeline as the Brawl Sim (makeFighter),
// so its physical numbers (mass, grip, friction, jump, speed, reach…) and its personality
// weights (aggression, caution, cunning, curiosity, loyalty, showoff…) come straight from its
// traits. The utility AI below scores ~15 actions every think tick from those weights × needs.

import { makeFighter, rng32 } from './TraitBrawl.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const lerp = (a, b, t) => a + (b - a) * t;

export const WORLD = { half: 95 };
export const BIOMES = [
  { id: 'playroom', name: 'Toy Playroom', x: -48, z: -48, r: 36, ground: 0xe4e8ee },
  { id: 'junkyard', name: 'Junkyard Forts', x: 48, z: -48, r: 36, ground: 0xb98d5f },
  { id: 'park', name: 'Swing Park', x: -48, z: 48, r: 36, ground: 0x7cc46a },
  { id: 'beach', name: 'Sandbox Beach', x: 48, z: 48, r: 36, ground: 0xf0d79a },
  { id: 'machine', name: 'Gear Works', x: 0, z: 0, r: 26, ground: 0x9aa3b0 },
];
export const MATCH = { zoneStart: 60, zoneEnd: 230, timeLimit: 280, zoneMin: 7 };

export function biomeAt(x, z) {
  let best = null, bd = 1e9;
  for (const b of BIOMES) { const d = Math.hypot(x - b.x, z - b.z) / b.r; if (d < bd) { bd = d; best = b; } }
  return bd < 1.15 ? best : null;
}

// ─── World generation ───────────────────────────────────────────────────────
export function generateWorld(seed) {
  const r = rng32(seed * 7 + 3);
  const W = { props: [], hides: [], breakables: [], hazards: [], zones: [], pickups: [], decor: [] };
  let id = 0;
  const P = (o) => { o.id = `${o.type}${id++}`; W.props.push(o); return o; };
  const around = (b, rad = b.r * 0.8) => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad; return { x: b.x + Math.cos(a) * d, z: b.z + Math.sin(a) * d }; };
  const free = (b, minD = 4, rad) => { for (let i = 0; i < 30; i++) { const p = around(b, rad); if (![...W.props, ...W.hides, ...W.breakables, ...W.zones].some(o => dist(o, p) < minD + (o.r || 1))) return p; } return around(b, rad); };
  const B = Object.fromEntries(BIOMES.map(b => [b.id, b]));
  const colors = [0x2f6fe0, 0xe03a3a, 0xf28a1e, 0x5ee06a, 0xb25ee0, 0xffd23f, 0x1fb5a8];
  const col = () => colors[Math.floor(r() * colors.length)];

  // Toy Playroom: tube slides, trampolines, chalkboards, toy-block piles, tunnels
  const pr = B.playroom;
  for (let i = 0; i < 5; i++) { const p = free(pr, 6); const a = r() * Math.PI * 2, L = 9 + r() * 4; P({ type: 'slide', x: p.x, z: p.z, r: 2, color: col(), top: { x: p.x, z: p.z }, bottom: { x: p.x + Math.cos(a) * L, z: p.z + Math.sin(a) * L }, h: 5 + r() * 2 }); }
  for (let i = 0; i < 6; i++) { const p = free(pr, 3); P({ type: 'tramp', ...p, r: 1.7, color: col() }); }
  for (let i = 0; i < 5; i++) { const p = free(pr, 3); W.breakables.push({ id: `board${id++}`, kind: 'board', ...p, r: 1.6, rot: r() * 3, hp: 110, maxHp: 110 }); }
  for (let i = 0; i < 3; i++) { const p = free(pr, 3); W.hides.push({ id: `tunnel${id++}`, kind: 'tunnel', ...p, r: 1.5, rot: r() * 3, color: col() }); }

  // Junkyard Forts: two crate forts with watchtowers, tire piles, wrecking-ball pendulums
  const jy = B.junkyard;
  for (const side of [-1, 1]) {
    const cx = jy.x + side * 16, cz = jy.z + (r() - 0.5) * 10;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; if (i === 3) continue; W.breakables.push({ id: `crate${id++}`, kind: 'crate', x: cx + Math.cos(a) * 6, z: cz + Math.sin(a) * 6, r: 1, rot: a, hp: 70, maxHp: 70 }); }
    P({ type: 'gym', x: cx, z: cz, r: 2.2, h: 6, tower: true, color: 0x8a5a35 });
  }
  for (let i = 0; i < 5; i++) { const p = free(jy, 3); W.hides.push({ id: `tires${id++}`, kind: 'tires', ...p, r: 1.6, rot: 0 }); }
  for (let i = 0; i < 2; i++) { const p = free(jy, 6); const a = r() * Math.PI; W.hazards.push({ id: `pend${id++}`, kind: 'pendulum', x: p.x, z: p.z, ax: Math.cos(a), az: Math.sin(a), len: 7, speed: 1.1 + r() * 0.6, phase: r() * 6, bob: { x: p.x, z: p.z, y: 1 }, dmg: 22 }); }
  W.hazards.push({ id: `ball${id++}`, kind: 'ball', x: jy.x, z: jy.z + 14, vx: 7, vz: 0, r: 1.6, color: 0x2b2b2b, lane: { x: jy.x, z: jy.z + 14, hx: 28, hz: 2 }, dmg: 14 });

  // Swing Park: merry-go-rounds, swings, seesaws, jungle gyms
  const pk = B.park;
  for (let i = 0; i < 3; i++) { const p = free(pk, 5); P({ type: 'merry', ...p, r: 3, color: col(), ang: 0, omega: 1 + r() }); }
  for (let i = 0; i < 4; i++) { const p = free(pk, 4); P({ type: 'swing', ...p, r: 2, rot: r() * 3, color: col(), phase: r() * 6 }); }
  for (let i = 0; i < 3; i++) { const p = free(pk, 4); P({ type: 'seesaw', ...p, r: 2.4, rot: r() * 3, color: col(), phase: r() * 6 }); }
  for (let i = 0; i < 3; i++) { const p = free(pk, 5); P({ type: 'gym', ...p, r: 2.4, h: 4, color: col() }); }
  for (let i = 0; i < 2; i++) { const p = free(pk, 3); W.hides.push({ id: `box${id++}`, kind: 'box', ...p, r: 1.4, rot: r() * 3 }); }

  // Sandbox Beach: sand pits, puddles, beach-ball roller, cardboard boxes
  const bc = B.beach;
  for (let i = 0; i < 4; i++) { const p = free(bc, 6); W.zones.push({ id: `sand${id++}`, kind: 'sand', ...p, r: 4 + r() * 3 }); }
  for (let i = 0; i < 6; i++) { const p = free(bc, 3); W.zones.push({ id: `puddle${id++}`, kind: 'puddle', ...p, r: 2 + r() * 2 }); }
  for (let i = 0; i < 3; i++) { const p = free(bc, 3); W.hides.push({ id: `box${id++}`, kind: 'box', ...p, r: 1.4, rot: r() * 3 }); }
  W.hazards.push({ id: `ball${id++}`, kind: 'ball', x: bc.x, z: bc.z, vx: 5, vz: 4, r: 1.9, color: 0xff6b9e, lane: { x: bc.x, z: bc.z, hx: 24, hz: 24 }, dmg: 9, beach: true });
  for (let i = 0; i < 2; i++) { const p = free(bc, 3); P({ type: 'tramp', ...p, r: 1.7, color: col() }); }

  // Gear Works (centre): conveyors, moving platforms, pendulums, rolling ball, crates
  const mc = B.machine;
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; W.zones.push({ id: `conv${id++}`, kind: 'conveyor', x: mc.x + Math.cos(a) * 13, z: mc.z + Math.sin(a) * 13, r: 3, len: 10, w: 3, dx: -Math.sin(a), dz: Math.cos(a), speed: 6 }); }
  for (let i = 0; i < 3; i++) { const p = free(mc, 4, 16); const a = r() * Math.PI; P({ type: 'platform', x: p.x, z: p.z, r: 1.8, a: { x: p.x - Math.cos(a) * 7, z: p.z - Math.sin(a) * 7 }, b: { x: p.x + Math.cos(a) * 7, z: p.z + Math.sin(a) * 7 }, phase: r() * 6, color: col(), cur: { x: p.x, z: p.z } }); }
  for (let i = 0; i < 3; i++) { const p = free(mc, 5, 20); const a = r() * Math.PI; W.hazards.push({ id: `pend${id++}`, kind: 'pendulum', x: p.x, z: p.z, ax: Math.cos(a), az: Math.sin(a), len: 6, speed: 1.3 + r() * 0.7, phase: r() * 6, bob: { x: p.x, z: p.z, y: 1 }, dmg: 18 }); }
  W.hazards.push({ id: `ball${id++}`, kind: 'ball', x: mc.x, z: mc.z, vx: 0, vz: 8, r: 1.5, color: 0x6b7280, lane: { x: mc.x, z: mc.z, hx: 3, hz: 22 }, dmg: 16 });
  for (let i = 0; i < 6; i++) { const p = free(mc, 3, 22); W.breakables.push({ id: `crate${id++}`, kind: 'crate', ...p, r: 1, rot: r() * 3, hp: 60, maxHp: 60 }); }
  P({ type: 'gym', x: mc.x, z: mc.z, r: 2.6, h: 5, color: 0xffd23f });

  // Decor: trees, rocks, tires, fences — non-colliding scatter for the renderer
  for (let i = 0; i < 260; i++) {
    const x = (r() - 0.5) * 2 * (WORLD.half + 20), z = (r() - 0.5) * 2 * (WORLD.half + 20);
    const b = biomeAt(x, z);
    if ([...W.props, ...W.hides, ...W.breakables, ...W.zones].some(o => dist(o, { x, z }) < (o.r || 1) + 3)) continue;
    const kind = !b ? (r() < 0.6 ? 'rock' : 'tree') : b.id === 'park' ? 'tree' : b.id === 'junkyard' ? (r() < 0.5 ? 'tire' : 'rock') : b.id === 'beach' ? (r() < 0.3 ? 'rock' : 'shell') : b.id === 'playroom' ? 'block' : 'bolt';
    W.decor.push({ kind, x, z, s: 0.6 + r() * 1.2, rot: r() * 6, color: col() });
  }
  for (const o of [...W.props, ...W.hides, ...W.breakables]) o.biome = biomeAt(o.x, o.z)?.id;
  return W;
}

const PICKUPS = {
  food: { icon: '🍎', biomeW: { beach: 3, park: 2 } },
  energy: { icon: '⚡', biomeW: { playroom: 2, machine: 2 } },
  health: { icon: '❤️', biomeW: { junkyard: 2 } },
  toy: { icon: '🧱', biomeW: { playroom: 3, junkyard: 2 } },
};

// ─── Simulation ─────────────────────────────────────────────────────────────
export class WildsSim {
  /** entrants: [{name, traits, core, color, shape, ai, player}] */
  constructor(entrants, { seed = 1, timeLimit = MATCH.timeLimit } = {}) {
    this.seed = seed;
    this.rng = rng32(seed);
    this.world = generateWorld(seed);
    this.t = 0; this.timeLimit = timeLimit; this.over = false;
    this.events = []; this.feed = []; this.highlights = [];
    this.zone = { x: (this.rng() - 0.5) * 30, z: (this.rng() - 0.5) * 30, r: 160 };
    this.pickupSeq = 0;
    this.dweebs = entrants.map((e, i) => this.makeDweeb(e, i, entrants.length));
    for (let i = 0; i < 46; i++) this.spawnPickup();
    this.deaths = 0;
  }

  makeDweeb(e, i, n) {
    const f = makeFighter({ ...e, team: i }, i);
    const s = f.stats;
    // Spawn ring around the map, everybody drops in from the sky.
    const a = (i / n) * Math.PI * 2 + 0.3, R = 70;
    Object.assign(f, {
      isPlayer: !!e.player, x: Math.cos(a) * R, z: Math.sin(a) * R, y: 30 + this.rng() * 8, vy: 0, airborne: true, dropping: true,
      playful: (s.curiosity + s.showoff) / 2 + (f.tags.has('tramper') || f.tags.has('slider') ? 0.15 : 0),
      hunger: 100, fun: 70, hungerRate: 0.32 + 0.25 * s.weight + 0.18 * s.speed + 0.1 * s.size,
      funRate: 0.15 + 0.55 * ((s.curiosity + s.showoff) / 2),
      sight: 16 + 16 * s.curiosity + 8 * s.focus + 6 * s.caution,
      hidden: false, hideSpot: null, use: null, holding: null, ally: null, allyT: 0,
      thought: 'Dropping in…', dist: 0, flings: 0, eats: 0, plays: 0, ambushes: 0, hazardHits: 0, bigHit: 0, deathT: null, cause: null,
      place: 0, score: 0, hurtCd: {}, explore: null, lastSay: -9, lastPick: null, wait: 0,
    });
    f.hp = f.maxHp; f.sta = f.maxSta;
    f.thinkT = 0.3 + this.rng() * 0.5;
    return f;
  }

  spawnPickup() {
    const r = this.rng, types = Object.keys(PICKUPS);
    let type = types[Math.floor(r() * types.length)];
    const b = BIOMES[Math.floor(r() * BIOMES.length)];
    const w = PICKUPS[type].biomeW[b.id] || 1; if (w < 2 && r() < 0.4) type = 'food';
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * b.r * 0.9;
    this.world.pickups.push({ id: ++this.pickupSeq, type, x: b.x + Math.cos(a) * d, z: b.z + Math.sin(a) * d, y: 0, vx: 0, vz: 0, vy: 0, heldBy: null, thrown: null });
  }

  alive() { return this.dweebs.filter(d => d.alive); }
  emit(e) {
    this.events.push(e);
    if (e.text) { this.feed.unshift({ t: this.t, text: e.text, f: e.f }); if (this.feed.length > 40) this.feed.length = 40; }
    if (e.hl) this.highlights.push({ t: this.t, text: e.text, f: e.f });
  }
  say(f, text, chance = 0.35) { if (this.t - f.lastSay > 5 && this.rng() < chance) { f.lastSay = this.t; this.emit({ type: 'think', f: f.idx, text }); } }

  zoneRadius(t = this.t) {
    if (t < MATCH.zoneStart) return 160;
    const u = clamp((t - MATCH.zoneStart) / (MATCH.zoneEnd - MATCH.zoneStart), 0, 1);
    const R = lerp(120, MATCH.zoneMin, 1 - (1 - u) * (1 - u));
    return t > MATCH.zoneEnd ? Math.max(0, MATCH.zoneMin - (t - MATCH.zoneEnd) * 0.3) : R;
  }

  canSee(f, o) {
    if (!o.alive || o.dropping) return false;
    const d = dist(f, o);
    let range = f.sight * (f.use?.obj?.type === 'gym' ? 1.6 : 1);
    if (o.hidden) range = 2.5 + 4 * f.stats.cunning;
    return d < range;
  }
  isFoe(f, o) { return o !== f && o.alive && !(f.ally === o && f.allyT > 0); }

  // ─── Utility AI ────────────────────────────────────────────────────────────
  decide(f) {
    const r = this.rng, A = f.ai, S = f.stats, W = this.world;
    const hpR = f.hp / f.maxHp, staR = f.sta / f.maxSta, hunR = f.hunger / 100, funR = f.fun / 100;
    const foes = this.dweebs.filter(o => this.isFoe(f, o) && this.canSee(f, o));
    let foe = null, fs = -1e9;
    for (const o of foes) { const sc = -dist(f, o) * (1 - A.focus * 0.5) + (1 - o.hp / o.maxHp) * 15 * A.focus; if (sc > fs) { fs = sc; foe = o; } }
    const fd = foe ? dist(f, foe) : 99;
    const myPow = f.hp * (f.dmg + 4), foePow = foe ? foe.hp * (foe.dmg + 4) : 1;
    const ratio = foe ? foePow / myPow : 0; // >1 = they're scarier
    const threat = foe ? clamp(1 - fd / f.sight, 0, 1) : 0;
    const aliveN = this.alive().length;
    const zr = this.zoneRadius(this.t + 12), zd = dist(f, this.zone);
    const outside = zd > zr - 3;
    const nearest = (arr, fn = () => true) => { let m = null, md = 1e9; for (const p of arr) { if (!fn(p)) continue; const d = dist(f, p); if (d < md && dist(p, this.zone) < this.zoneRadius(this.t + 8)) { md = d; m = p; } } return m; };
    const pick = type => nearest(W.pickups, p => p.type === type && !p.heldBy && !p.thrown);
    const food = pick('food'), med = pick('health'), nrg = pick('energy'), toy = f.holding ? null : pick('toy');
    const hide = nearest(W.hides, h => !this.dweebs.some(o => o !== f && o.alive && o.hideSpot === h));
    const brk = nearest(W.breakables, b => b.hp > 0);
    const noise = () => (r() - 0.5) * 0.4 * (1.25 - A.focus) * (funR < 0.2 ? 1.6 : 1);
    const dpen = (p, k = 60) => (p ? dist(f, p) / k : 9);
    // playground affinity: what this body/personality enjoys
    const aff = {
      tramp: S.bounce + S.jump * 0.6 + (f.tags.has('tramper') ? 0.5 : 0),
      slide: S.speed * 0.6 + S.agility * 0.5 + (f.tags.has('slider') ? 0.5 : 0),
      merry: S.grip * 0.7 + A.showoff * 0.6 + 0.1,
      swing: A.showoff * 0.8 + S.jump * 0.3,
      seesaw: A.loyalty * 0.4 + S.weight * 0.5,
      platform: A.curiosity * 0.8 + S.grip * 0.3,
      gym: S.grip * 0.7 + S.agility * 0.4 + A.caution * 0.3,
    };
    const play = nearest(W.props, p => p.type !== 'gym' || !p.tower);
    const lookout = nearest(W.props, p => p.type === 'gym');
    const playAff = play ? aff[play.type] || 0.3 : 0;
    const tg = f.tags;

    const opts = {
      zone: outside ? 2.2 + (zd - zr) / 15 + A.caution * 0.4 : -9,
      forage: food ? Math.pow(1 - hunR, 1.2) * 3.2 - dpen(food) - threat * A.caution * 0.6 + 0.05 : -9,
      heal: med && hpR < 0.75 ? (1 - hpR) * 2.0 - dpen(med) - threat * 0.4 : -9,
      energize: nrg && staR < 0.5 ? (1 - staR) * 1.6 - dpen(nrg) : -9,
      rest: (1 - staR) * 1.5 + (f.hidden ? 0.3 : 0) - threat * (1.2 - A.caution * 0.5) - 0.15,
      explore: 0.25 + A.curiosity * 0.8 - threat * 0.6 + (aliveN > 4 ? 0.1 : -0.2),
      hide: hide ? (foe ? A.caution * 1.1 + (1 - hpR) * 0.9 + A.cunning * 0.3 - A.aggression * 0.6 + (ratio > 1.2 ? 0.4 : 0) : A.caution * 0.4 + (1 - hpR) * 0.5 - 0.35) - dpen(hide, 40) + (tg.has('coward') ? 0.4 : 0) : -9,
      flee: foe && fd < 12 ? (ratio - 1) * 0.8 - 0.2 + (1 - hpR) * 1.1 + A.caution * 0.7 - A.bravery * 0.9 + (tg.has('coward') ? 0.5 : 0) : -9,
      fight: foe ? -0.15 + A.aggression * 1.2 + A.bravery * 0.45 + hpR * 0.5 - (ratio - 1) * 0.5 - fd / 25 + (aliveN <= 3 ? 0.4 : 0) + (tg.has('berserk') ? 0.5 : 0) - (f.hunger < 15 ? 0.4 : 0) : -9,
      ambush: foe && f.hidden && fd > 3 ? A.cunning * 1.3 + A.caution * 0.4 - A.aggression * 0.2 + 0.1 : -9,
      throw: f.holding && foe && fd > 3 && fd < 17 ? 0.7 + S.throwPower + S.accuracy * 0.4 + (tg.has('ranged') ? 0.4 : 0) : -9,
      grab: toy ? S.throwPower * 0.9 + A.curiosity * 0.3 + (tg.has('grabber') ? 0.4 : 0) - dpen(toy, 30) - 0.1 : -9,
      play: play ? (1 - funR) * 1.8 * (0.4 + f.playful) + playAff * 0.6 + 0.15 - dpen(play, 45) - threat * (0.3 + A.caution) : -9,
      climb: lookout ? A.caution * 0.6 + S.grip * 0.4 + (foe && ratio > 1 ? 0.3 : 0) + (1 - staR) * 0.3 - dpen(lookout, 35) - 0.35 : -9,
      smash: brk ? S.strength * 0.9 + A.aggression * 0.35 + (1 - hunR) * 0.3 - dpen(brk, 30) - 0.35 + (tg.has('smasher') ? 0.5 : 0) : -9,
      ally: foe && !f.ally && !foe.ally && aliveN > 3 && fd < 10 ? A.loyalty * 1.2 + foe.ai.loyalty * 0.6 - A.aggression * 0.6 - 0.35 : -9,
      betray: f.ally && f.allyT > 0 && f.ally.alive && (aliveN <= 3 || (A.cunning > 0.6 && f.ally.hp / f.ally.maxHp < 0.35)) ? A.cunning * 1.2 + A.aggression * 0.6 - A.loyalty * 1.1 : -9,
    };
    if (f.use && !outside && !(foe && threat > 0.5)) opts.keepPlaying = 0.6 + f.playful * 0.6 + (1 - funR) * 0.5;
    let best = 'explore', bv = -1e9;
    for (const [k, v] of Object.entries(opts)) { const s = v + noise(); if (s > bv) { bv = s; best = k; } }
    if (best === 'keepPlaying') return;
    if (f.use && best !== 'ambush' && best !== 'rest') this.leaveUse(f);
    if (best !== 'hide' && best !== 'ambush' && best !== 'rest') { f.hidden = false; f.hideSpot = null; }
    f.decisions[best] = (f.decisions[best] || 0) + 1;
    const plan = { kind: best, foe, t: 0 };
    const icon = { food: '🍎', health: '❤️', energy: '⚡', toy: '🧱' };
    switch (best) {
      case 'zone': plan.goal = { x: this.zone.x, z: this.zone.z }; f.thought = '🌀 Storm’s coming — run to the safe zone!'; break;
      case 'forage': plan.goal = food; f.thought = `😋 Hungry… going for ${icon.food}`; break;
      case 'heal': plan.goal = med; f.thought = `🩹 Hurt — grabbing ${icon.health}`; break;
      case 'energize': plan.goal = nrg; f.thought = `😮‍💨 Tired — chasing ${icon.energy}`; break;
      case 'grab': plan.goal = toy; f.thought = '🧱 Ooh, something to throw'; break;
      case 'rest': f.thought = f.hidden ? '😴 Napping in hiding' : '😮‍💨 Catching breath'; break;
      case 'explore': {
        if (!f.explore || dist(f, f.explore) < 4 || r() < 0.15) {
          const zr2 = Math.min(this.zoneRadius(this.t + 20), WORLD.half - 5);
          const b = r() < 0.6 ? BIOMES[Math.floor(r() * BIOMES.length)] : null;
          let p = b ? { x: b.x + (r() - 0.5) * b.r, z: b.z + (r() - 0.5) * b.r } : { x: this.zone.x + (r() - 0.5) * zr2 * 1.6, z: this.zone.z + (r() - 0.5) * zr2 * 1.6 };
          const d = dist(p, this.zone); if (d > zr2) p = { x: this.zone.x + (p.x - this.zone.x) * zr2 / d * 0.8, z: this.zone.z + (p.z - this.zone.z) * zr2 / d * 0.8 };
          p.x = clamp(p.x, -WORLD.half + 3, WORLD.half - 3); p.z = clamp(p.z, -WORLD.half + 3, WORLD.half - 3);
          f.explore = p;
        }
        plan.goal = f.explore; const bm = biomeAt(f.explore.x, f.explore.z); f.thought = `🧭 Exploring${bm ? ' toward ' + bm.name : ''}`; break;
      }
      case 'hide': plan.goal = hide; plan.spot = hide; f.thought = foe ? `🫣 ${foe.name} looks scary — hiding` : '🫣 Lying low'; break;
      case 'flee': f.thought = `💨 Running from ${foe.name}!`; break;
      case 'fight': f.thought = `⚔️ Going after ${foe.name}`; break;
      case 'ambush': f.thought = `🐍 Waiting to ambush ${foe.name}…`; break;
      case 'throw': f.thought = `🎯 Lobbing a toy at ${foe.name}`; break;
      case 'play': plan.goal = play; plan.obj = play; f.thought = { tramp: '🦘 Trampoline time!', slide: '🛝 Slide!!', merry: '🎠 Merry-go-round!', swing: '🌀 Swings!', seesaw: '⚖️ Seesaw!', platform: '🚂 Riding the moving platform', gym: '🧗 Jungle gym!' }[play.type] || '🎈 Playing'; break;
      case 'climb': plan.goal = lookout; plan.obj = lookout; f.thought = lookout.tower ? '🗼 Climbing the watchtower to look around' : '🧗 Climbing up for a better view'; break;
      case 'smash': plan.goal = brk; plan.brk = brk; f.thought = `🔨 Smashing a ${brk.kind} for loot`; break;
      case 'ally': f.thought = `🤝 Offering ${foe.name} a truce`; break;
      case 'betray': f.thought = `😈 Time to turn on ${f.ally.name}`; break;
    }
    if (best !== f.lastPick) {
      const lines = { hide: `${f.name} ducked into hiding`, flee: `${f.name} is running from ${foe?.name}`, climb: `${f.name} is climbing for a lookout`, ambush: `${f.name} is lying in wait…`, play: `${f.name} wants to play`, smash: `${f.name} is wrecking stuff`, fight: `${f.name} picked a fight with ${foe?.name}` };
      if (lines[best]) this.say(f, lines[best]);
    }
    f.lastPick = best;
    f.plan = plan;
  }

  leaveUse(f) {
    const u = f.use; if (!u) return;
    f.use = null; f.ride = null;
    if (u.obj?.type === 'gym') { f.y = Math.max(f.y, 0.5); f.airborne = true; f.vy = 1; }
  }

  steer(f, goal, dt, mul = 1) {
    let dx = goal.x - f.x, dz = goal.z - f.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    dx /= d; dz /= d;
    // cautious Dweebs steer wide of swinging/rolling hazards; reckless ones barrel through
    const avoid = 0.3 + f.ai.caution * 1.6;
    for (const h of this.world.hazards) {
      const p = h.kind === 'pendulum' ? h.bob : h; const hd = Math.hypot(f.x - p.x, f.z - p.z);
      if (hd < 6 && hd > 0.01) { const w = avoid * (1 - hd / 6); dx += (f.x - p.x) / hd * w; dz += (f.z - p.z) / hd * w; }
    }
    const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    const bored = f.fun < 15 ? 0.85 : 1, starving = f.hunger <= 0 ? 0.7 : 1;
    const sp = f.moveSpeed * mul * (f.sta > 5 ? 1 : 0.5) * bored * starving * (f.airborne ? 0.6 : 1) * (f.inSand ? 0.45 + 0.35 * f.stats.strength : 1);
    const slip = f.inPuddle ? Math.min(0.95, f.slip + 0.35) : f.slip;
    const k = Math.min(1, f.accel * dt * (f.airborne ? 0.3 : 1) * (0.25 + 0.75 * (1 - slip * 0.7)));
    f.vx += (dx * sp - f.vx) * k; f.vz += (dz * sp - f.vz) * k;
    f.face = Math.atan2(dx, dz);
    return d;
  }

  damage(o, amt, by, cause, kb = null) {
    if (!o.alive || o.dropping) return 0;
    const dealt = Math.max(1, Math.round(amt * o.armorMul * (o.blocking ? 0.4 : 1)));
    o.hp -= dealt; o.hitFlash = 0.25; o.minHpR = Math.min(o.minHpR, Math.max(0, o.hp) / o.maxHp);
    if (by) { by.dmgDealt += dealt; by.bigHit = Math.max(by.bigHit, dealt); }
    if (kb) { o.vx += kb.x / o.mass; o.vz += kb.z / o.mass; o.vy += (kb.y || 0) / Math.sqrt(o.mass); if (o.vy > 0) o.airborne = true; if (o.use) this.leaveUse(o); }
    this.emit({ type: 'hit', x: o.x, y: o.y + 1, z: o.z, dmg: dealt, o: o.idx });
    if (o.hp <= 0) this.kill(o, by, cause);
    return dealt;
  }

  kill(o, by, cause) {
    if (!o.alive) return;
    o.alive = false; o.hp = 0; o.deathT = this.t; o.cause = cause;
    o.place = this.alive().length + 1;
    if (by) by.kos++;
    if (o.holding) { o.holding.heldBy = null; o.holding = null; }
    if (o.ally) { o.ally.ally = null; o.ally = null; }
    const txt = { melee: `💥 ${by?.name} knocked out ${o.name}!`, ambush: `🐍 ${by?.name} ambushed and KO'd ${o.name}!`, throw: `🎯 ${by?.name} sniped ${o.name} with a toy!`, zone: `🌀 ${o.name} got caught by the storm`, hunger: `🍂 ${o.name} ran out of snacks and fainted`, pendulum: `🔨 ${o.name} got flattened by a wrecking ball!`, ball: `⚫ ${o.name} got bowled over by a rolling ball!`, fall: `🪂 ${o.name} took one bounce too many`, stomp: `🦘 ${by?.name} trampoline-stomped ${o.name}!` }[cause] || `💀 ${o.name} is out`;
    this.emit({ type: 'ko', o: o.idx, f: o.idx, x: o.x, z: o.z, text: `${txt} (#${o.place})`, hl: true });
  }

  act(f, dt) {
    const P = f.plan; if (!P) return;
    P.t += dt;
    const W = this.world;
    f.blocking = false;
    switch (P.kind) {
      case 'zone': case 'explore': this.steer(f, P.goal, dt, P.kind === 'zone' ? 1.05 : 0.8); return;
      case 'forage': case 'heal': case 'energize': case 'grab':
        if (!P.goal || P.goal.heldBy || !W.pickups.includes(P.goal)) { f.plan = null; f.thinkT = 0; return; }
        if (this.steer(f, P.goal, dt) < f.radius + 0.7) this.take(f, P.goal);
        return;
      case 'rest': f.vx *= 0.85; f.vz *= 0.85; f.sta = Math.min(f.maxSta, f.sta + (14 + 14 * f.stats.stamina) * dt); f.hp = Math.min(f.maxHp, f.hp + (1 + f.regen) * dt * (f.hidden ? 1.5 : 0.6)); return;
      case 'hide': {
        const h = P.spot; if (!h) return;
        if (this.steer(f, h, dt) < h.r * 0.7) {
          if (!f.hidden) { f.hidden = true; f.hideSpot = h; this.emit({ type: 'hide', f: f.idx, text: `🫣 ${f.name} hid in the ${h.kind === 'tunnel' ? 'tunnel' : h.kind === 'tires' ? 'tire pile' : 'box'}` }); }
          f.vx *= 0.5; f.vz *= 0.5; f.hideT += dt; f.sta = Math.min(f.maxSta, f.sta + 8 * dt);
        }
        return;
      }
      case 'flee': { const o = P.foe; if (!o?.alive) { f.plan = null; return; } const dx = f.x - o.x, dz = f.z - o.z, d = Math.hypot(dx, dz) || 1; let g = { x: f.x + dx / d * 6, z: f.z + dz / d * 6 }; if (dist(g, this.zone) > this.zoneRadius()) g = { x: lerp(g.x, this.zone.x, 0.3), z: lerp(g.z, this.zone.z, 0.3) }; this.steer(f, g, dt, 1.1); return; }
      case 'fight': case 'betray': {
        const o = P.kind === 'betray' ? f.ally : P.foe;
        if (!o?.alive) { f.plan = null; return; }
        if (P.kind === 'betray' && f.ally) { this.emit({ type: 'betray', f: f.idx, text: `😈 ${f.name} betrayed ${o.name}!`, hl: true }); o.ally = null; f.ally = null; P.kind = 'fight'; P.foe = o; }
        this.melee(f, o, dt, 'melee'); return;
      }
      case 'ambush': {
        const o = P.foe; if (!o?.alive) { f.plan = null; return; }
        f.vx *= 0.5; f.vz *= 0.5;
        const d = dist(f, o);
        if (d < 3.5 + 4 * f.stats.cunning || P.t > 8) { P.kind = 'fight'; P.pounce = true; f.hidden = false; f.hideSpot = null; f.vy = 4 + 2 * f.stats.jump; f.airborne = true; f.ambushes++; this.emit({ type: 'ambush', f: f.idx, text: `🐍 ${f.name} burst out and ambushed ${o.name}!`, hl: true }); }
        return;
      }
      case 'throw': {
        const o = P.foe, k = f.holding; if (!o?.alive || !k) { f.plan = null; return; }
        k.heldBy = null; f.holding = null;
        const dx = o.x - f.x, dz = o.z - f.z, d = Math.hypot(dx, dz) || 1;
        const sp = 10 + 12 * f.stats.throwPower, err = (this.rng() - 0.5) * (1 - f.stats.accuracy);
        const c = Math.cos(err), s = Math.sin(err), ux = dx / d, uz = dz / d;
        Object.assign(k, { x: f.x, z: f.z, y: f.y + 1.5, vx: (ux * c - uz * s) * sp, vz: (ux * s + uz * c) * sp, vy: 2 + d * 0.3, thrown: { by: f, life: 2.5 } });
        f.throws++; f.plan = null; f.thinkT = 0.4;
        this.emit({ type: 'throw', f: f.idx });
        return;
      }
      case 'play': case 'climb': {
        const o = P.obj; if (!o) return;
        const tgt = o.type === 'slide' ? o.top : o.type === 'platform' ? o.cur : o;
        if (this.steer(f, tgt, dt) < (o.type === 'slide' ? 1.2 : o.r * 0.8)) this.startUse(f, o);
        return;
      }
      case 'smash': {
        const b = P.brk; if (!b || b.hp <= 0) { f.plan = null; return; }
        if (this.steer(f, b, dt) < b.r + f.radius + 0.5 && f.actT <= 0) {
          b.hp -= f.dmg * (1 + f.stats.strength); f.actT = 0.55; f.squash = 0.3; f.sta -= 3;
          this.emit({ type: 'brkHit', id: b.id, x: b.x, z: b.z });
          if (b.hp <= 0) this.breakIt(b, f);
        }
        return;
      }
      case 'ally': {
        const o = P.foe; if (!o?.alive) { f.plan = null; return; }
        if (this.steer(f, o, dt, 0.7) < 3) {
          const yes = o.ai.loyalty * 0.8 + (1 - o.ai.aggression) * 0.4 + (o.hp / o.maxHp < 0.5 ? 0.2 : 0) > 0.75;
          if (yes && !o.ally) { f.ally = o; o.ally = f; f.allyT = o.allyT = 40 + 30 * f.ai.loyalty; this.emit({ type: 'ally', f: f.idx, text: `🤝 ${f.name} and ${o.name} formed a truce`, hl: true }); }
          else this.emit({ type: 'think', f: f.idx, text: `🙅 ${o.name} refused ${f.name}'s truce` });
          f.plan = null; f.thinkT = 0.2;
        }
        return;
      }
    }
  }

  melee(f, o, dt, cause) {
    const reach = f.reach + f.radius + o.radius;
    this.steer(f, o, dt, f.plan?.pounce ? 1.3 : 1);
    if (dist(f, o) <= reach && Math.abs(o.y - f.y) < 1.6 && f.action !== 'windup' && f.actT <= 0 && f.sta > 6) { f.action = 'windup'; f.actT = f.windup; f.swingAt = o; }
  }

  resolveSwing(f) {
    const o = f.swingAt; f.action = 'recover'; f.actT = 0.3; f.sta -= 7;
    if (!o?.alive || dist(f, o) > f.reach + f.radius + o.radius + 0.5) return this.emit({ type: 'whiff', x: f.x, z: f.z });
    const dodge = o.stats.agility * 0.35 + (o.use ? -0.1 : 0);
    if (this.rng() > clamp(0.62 + f.stats.accuracy * 0.35 - dodge, 0.2, 0.95)) return this.emit({ type: 'whiff', x: o.x, z: o.z });
    const pounce = f.plan?.pounce; if (pounce) f.plan.pounce = false;
    const d = dist(f, o) || 1, kb = (3 + 10 * f.stats.knockback) * f.mass;
    // fighting back: the victim reconsiders right away (bravery decides fight vs flight)
    o.thinkT = Math.min(o.thinkT, 0.1);
    this.damage(o, f.dmg * (pounce ? 1.7 : 1), f, pounce ? 'ambush' : 'melee', { x: (o.x - f.x) / d * kb, z: (o.z - f.z) / d * kb, y: kb * 0.3 });
  }

  take(f, p) {
    const W = this.world;
    if (p.type === 'toy') { if (f.holding) return; p.heldBy = f; f.holding = p; f.plan = null; return; }
    W.pickups.splice(W.pickups.indexOf(p), 1);
    if (p.type === 'food') { f.hunger = Math.min(100, f.hunger + 45); f.eats++; this.say(f, `🍎 ${f.name} munched a snack`, 0.25); }
    else if (p.type === 'health') { f.hp = Math.min(f.maxHp, f.hp + 40 + f.maxHp * 0.2); this.say(f, `❤️ ${f.name} patched up`, 0.3); }
    else if (p.type === 'energy') { f.sta = f.maxSta; f.fun = Math.min(100, f.fun + 10); }
    this.emit({ type: 'pickup', f: f.idx, kind: p.type, x: p.x, z: p.z });
    f.plan = null; f.thinkT = 0.15;
  }

  breakIt(b, by) {
    b.hp = 0; by.smashes++;
    this.emit({ type: 'break', id: b.id, x: b.x, z: b.z, kind: b.kind, text: this.rng() < 0.5 ? `🔨 ${by.name} smashed a ${b.kind === 'board' ? 'chalkboard' : 'crate'} to bits` : null });
    const n = 1 + (this.rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) { const types = ['food', 'health', 'energy', 'toy']; this.world.pickups.push({ id: ++this.pickupSeq, type: types[Math.floor(this.rng() * 4)], x: b.x + (this.rng() - 0.5) * 2, z: b.z + (this.rng() - 0.5) * 2, y: 1, vy: 4, vx: 0, vz: 0, heldBy: null, thrown: null }); }
  }

  startUse(f, o) {
    if (f.use) return;
    const r = this.rng;
    const dur = { tramp: 3, slide: 0, merry: 4 + 6 * f.playful, swing: 4 + 4 * f.playful, seesaw: 4 + 5 * f.playful, platform: 6 + 6 * f.ai.curiosity, gym: 6 + 8 * f.ai.caution }[o.type] ?? 4;
    f.use = { obj: o, t: 0, dur, ang: Math.atan2(f.z - o.z, f.x - o.x), rr: Math.min(o.r * 0.8, Math.max(0.8, dist(f, o))) };
    f.plays++; f.rides++;
    f.plan = { kind: 'using', t: 0 };
    const verbs = { tramp: 'is bouncing on a trampoline', slide: 'zoomed down a tube slide', merry: 'hopped on the merry-go-round', swing: 'is swinging high', seesaw: 'is seesawing', platform: 'is riding a moving platform', gym: o.tower ? 'climbed the watchtower' : 'climbed the jungle gym' };
    if (r() < 0.5 || o.tower) this.emit({ type: 'use', f: f.idx, kind: o.type, text: `${f.name} ${verbs[o.type] || 'is playing'}` });
    if (o.type === 'slide') f.ride = { u: 0, len: dist(o.top, o.bottom) };
  }

  updateUse(f, dt) {
    const u = f.use, o = u.obj, S = f.stats;
    u.t += dt;
    const funGain = { tramp: 14, slide: 30, merry: 12, swing: 16, seesaw: 9, platform: 7, gym: 6 }[o.type] || 8;
    f.fun = Math.min(100, f.fun + funGain * dt * (0.6 + f.playful));
    f.vx = f.vz = 0;
    switch (o.type) {
      case 'slide': {
        const R = f.ride; R.u += dt * (10 + 6 * S.speed) / R.len; const t = Math.min(1, R.u);
        f.x = lerp(o.top.x, o.bottom.x, t); f.z = lerp(o.top.z, o.bottom.z, t); f.y = o.h * (1 - t) * (1 - t) + 0.2;
        f.face = Math.atan2(o.bottom.x - o.top.x, o.bottom.z - o.top.z);
        if (t >= 1) { const d = R.len || 1; f.vx = (o.bottom.x - o.top.x) / d * 11; f.vz = (o.bottom.z - o.top.z) / d * 11; f.y = 0.2; f.airborne = true; f.vy = 2; f.use = null; f.ride = null; f.plan = null; f.thinkT = 0.5; }
        return;
      }
      case 'tramp': {
        f.x = lerp(f.x, o.x, 0.2); f.z = lerp(f.z, o.z, 0.2);
        if (!f.airborne) { f.vy = f.jumpV * (1.1 + S.bounce * 0.6); f.airborne = true; f.squash = 0.35; this.emit({ type: 'bounce', id: o.id, f: f.idx }); f.stomp = true; }
        if (u.t > u.dur && !f.airborne) this.leaveUse(f);
        return;
      }
      case 'merry': {
        f.x = o.x + Math.cos(u.ang + o.ang) * u.rr; f.z = o.z + Math.sin(u.ang + o.ang) * u.rr; f.y = 0.35;
        f.face = o.ang + u.ang;
        // centrifugal fling: grip holds you on, light Dweebs fly further
        const pull = o.omega * o.omega * u.rr * 0.06 - S.grip * 0.55;
        if (this.rng() < Math.max(0, pull) * dt * 3) {
          const a = u.ang + o.ang, v = o.omega * u.rr * 3.2 / Math.sqrt(f.mass);
          this.leaveUse(f); f.plan = null;
          f.vx = -Math.sin(a) * v + Math.cos(a) * v * 0.4; f.vz = Math.cos(a) * v + Math.sin(a) * v * 0.4; f.vy = 5 / Math.sqrt(f.mass); f.airborne = true; f.flings++;
          this.emit({ type: 'fling', f: f.idx, text: `🎠 ${f.name} got flung off the merry-go-round!`, hl: true });
          return;
        }
        if (u.t > u.dur) this.leaveUse(f);
        return;
      }
      case 'swing': {
        const sw = Math.sin(this.t * 2.2 + o.phase) * (0.7 + 0.5 * S.jump);
        const ax = Math.cos(o.rot), az = Math.sin(o.rot);
        f.x = o.x + ax * sw * 2.2; f.z = o.z + az * sw * 2.2; f.y = 1 + Math.abs(sw) * 1.6;
        if (u.t > u.dur && Math.abs(sw) > 0.6) { const v = 7 + 6 * S.jump; this.leaveUse(f); f.plan = null; f.vx = ax * Math.sign(sw) * v; f.vz = az * Math.sign(sw) * v; f.vy = 6; f.airborne = true; f.flings++; this.emit({ type: 'fling', f: f.idx, text: `🌀 ${f.name} launched off the swings!`, hl: this.rng() < 0.4 }); }
        return;
      }
      case 'seesaw': {
        const ax = Math.cos(o.rot), az = Math.sin(o.rot), s = Math.sin(this.t * 2 + o.phase);
        f.x = o.x + ax * 1.9; f.z = o.z + az * 1.9; f.y = 0.6 + s * 0.8 * (1.4 - S.weight);
        if (u.t > u.dur) this.leaveUse(f);
        return;
      }
      case 'platform': {
        f.x = o.cur.x; f.z = o.cur.z; f.y = 1.3;
        if (u.t > u.dur) this.leaveUse(f);
        return;
      }
      case 'gym': {
        const climbRate = 0.5 + 1.5 * S.grip + 0.6 * S.agility - 0.4 * S.weight;
        f.x = lerp(f.x, o.x, 0.1); f.z = lerp(f.z, o.z, 0.1); f.y = Math.min(o.h, f.y + climbRate * dt * 2);
        f.sta = Math.min(f.maxSta, f.sta + 6 * dt);
        if (u.t > u.dur) this.leaveUse(f);
      }
    }
  }

  step(dt) {
    if (this.over) return;
    this.t += dt; this.events.length = 0;
    const W = this.world, H = WORLD.half;
    // world motion
    for (const p of W.props) {
      if (p.type === 'merry') { p.omega = 1.2 + Math.sin(this.t * 0.25 + p.x) * 0.8 + 0.4 * this.dweebs.filter(d => d.use?.obj === p).length; p.ang += p.omega * dt; }
      if (p.type === 'platform') { const u = (Math.sin(this.t * 0.45 + p.phase) + 1) / 2; p.cur.x = lerp(p.a.x, p.b.x, u); p.cur.z = lerp(p.a.z, p.b.z, u); }
    }
    for (const h of W.hazards) {
      if (h.kind === 'pendulum') { const s = Math.sin(this.t * h.speed + h.phase); h.bob.x = h.x + h.ax * s * h.len; h.bob.z = h.z + h.az * s * h.len; h.bob.y = 1 + (1 - Math.cos(s)) * 3; h.vel = Math.cos(this.t * h.speed + h.phase) * h.speed * h.len; }
      else { h.x += h.vx * dt; h.z += h.vz * dt; const L = h.lane; if (Math.abs(h.x - L.x) > L.hx) { h.vx *= -1; h.x = L.x + Math.sign(h.x - L.x) * L.hx; } if (Math.abs(h.z - L.z) > L.hz) { h.vz *= -1; h.z = L.z + Math.sign(h.z - L.z) * L.hz; } }
    }
    // zone
    this.zone.r = this.zoneRadius();
    // pickups respawn
    if (W.pickups.filter(p => !p.heldBy).length < 40 && this.rng() < dt * 0.6) this.spawnPickup();

    for (const f of this.dweebs) {
      if (!f.alive) continue;
      const S = f.stats;
      f.hitFlash = Math.max(0, f.hitFlash - dt); f.squash = Math.max(0, f.squash - dt);
      // needs
      f.hunger = Math.max(0, f.hunger - f.hungerRate * dt * (1 + Math.hypot(f.vx, f.vz) * 0.03));
      f.fun = Math.max(0, f.fun - f.funRate * dt);
      f.sta = clamp(f.sta + (3 + 5 * S.stamina) * dt - Math.hypot(f.vx, f.vz) * 0.28 * dt, 0, f.maxSta);
      if (f.hunger > 30) f.hp = Math.min(f.maxHp, f.hp + f.regen * 0.5 * dt);
      if (f.hunger <= 0) { this.damage(f, 2.2 * dt / f.armorMul, null, 'hunger'); if (!f.alive) continue; }
      if (f.allyT > 0) { f.allyT -= dt; if (f.allyT <= 0 && f.ally) { this.emit({ type: 'think', text: `💔 The truce between ${f.name} and ${f.ally.name} ended` }); f.ally.ally = null; f.ally.allyT = 0; f.ally = null; } }
      const zd = dist(f, this.zone);
      if (zd > this.zone.r && !f.dropping) { const zdmg = (3 + 9 * clamp((this.t - MATCH.zoneStart) / 150, 0, 1)) * dt; f.zoneHurt = true; f.hp -= zdmg; f.hitFlash = Math.max(f.hitFlash, 0.08); if (f.hp <= 0) { this.kill(f, null, 'zone'); continue; } } else f.zoneHurt = false;

      if (f.dropping) { // spawn drop from the sky
        f.vy -= 22 * dt; f.y += f.vy * dt;
        if (f.y <= 0) { f.y = 0; f.vy = 0; f.dropping = false; f.airborne = false; f.squash = 0.5; this.emit({ type: 'land', x: f.x, z: f.z, big: true, f: f.idx }); }
        continue;
      }
      if (f.use) { this.updateUse(f, dt); if (!f.use && f.plan?.kind === 'using') f.plan = null; }
      f.thinkT -= dt;
      if (f.thinkT <= 0 && f.action !== 'windup' && (!f.use || f.use.obj.type !== 'slide')) { f.thinkT = f.think * (1.4 + this.rng() * 0.6); this.decide(f); }
      f.actT -= dt;
      if (f.action === 'windup' && f.actT <= 0) this.resolveSwing(f);
      else if (f.action === 'recover' && f.actT <= 0) f.action = 'idle';
      if (!f.use) this.act(f, dt);
      if (f.use && f.use.obj.type !== 'tramp') { this.postBounds(f); continue; }

      // ground effects
      f.inSand = false; f.inPuddle = false;
      for (const z of W.zones) {
        if (f.y > 0.5) continue;
        if (z.kind === 'conveyor') { const lx = f.x - z.x, lz = f.z - z.z, along = lx * z.dx + lz * z.dz, across = Math.abs(lx * -z.dz + lz * z.dx); if (Math.abs(along) < z.len / 2 && across < z.w / 2) { const push = z.speed * dt * (1.6 - S.grip) / Math.sqrt(f.mass); f.x += z.dx * push; f.z += z.dz * push; if (!f.onConv) { f.onConv = true; if (this.rng() < 0.25) this.say(f, `🏭 ${f.name} is riding a conveyor belt`, 1); } } }
        else if (Math.hypot(f.x - z.x, f.z - z.z) < z.r) { if (z.kind === 'sand') f.inSand = true; else { f.inPuddle = true; f.sta = Math.min(f.maxSta, f.sta + 3 * dt); f.fun = Math.min(100, f.fun + 2 * dt); } }
      }
      // physics: friction stat = how fast you stop; puddles make everyone slide
      const fr = f.airborne ? 0.995 : 1 - (0.6 + 4 * S.friction * (f.inPuddle ? 0.25 : 1)) * dt;
      f.vx *= fr; f.vz *= fr;
      const sp = Math.hypot(f.vx, f.vz); f.dist += sp * dt;
      f.x += f.vx * dt; f.z += f.vz * dt;
      if (f.airborne || f.y > 0) {
        f.vy -= 18 * dt; f.y += f.vy * dt;
        if (f.y <= 0) {
          const impact = -f.vy; f.y = 0; f.airborne = false; f.squash = 0.25;
          if (f.stomp) { for (const o of this.dweebs) if (this.isFoe(f, o) && dist(f, o) < 2.2 + f.radius && o.y < 1) this.damage(o, f.dmg * 0.8 + 5 * f.mass, f, 'stomp', { x: 0, z: 0, y: 4 }); f.stomp = false; }
          if (impact > 14 && !f.use) this.damage(f, (impact - 14) * 1.2 * (1.2 - S.bounce), null, 'fall');
          if (impact > 5 && S.bounce > 0.6 && !f.use) { f.vy = impact * 0.35 * S.bounce; f.airborne = true; f.y = 0.01; } else f.vy = 0;
        }
      }
      if (!f.alive) continue;
      // hazards
      for (const h of W.hazards) {
        const p = h.kind === 'pendulum' ? h.bob : h, rr = (h.kind === 'pendulum' ? 1.3 : h.r) + f.radius;
        if (Math.hypot(f.x - p.x, f.z - p.z) < rr && f.y < (h.kind === 'pendulum' ? p.y + 1 : 2.5) && (f.hurtCd[h.id] || 0) < this.t) {
          f.hurtCd[h.id] = this.t + 1.2;
          const vx = h.kind === 'pendulum' ? h.ax * Math.sign(h.vel || 1) : h.vx, vz = h.kind === 'pendulum' ? h.az * Math.sign(h.vel || 1) : h.vz, vn = Math.hypot(vx, vz) || 1;
          const kb = h.kind === 'pendulum' ? 22 : 12;
          f.hazardHits++;
          this.damage(f, h.dmg, null, h.kind, { x: vx / vn * kb, z: vz / vn * kb, y: kb * 0.5 });
          if (f.alive) this.emit({ type: 'hazard', f: f.idx, text: h.kind === 'pendulum' ? `🔨 ${f.name} got walloped by a wrecking ball` : h.beach ? `🏐 ${f.name} got bonked by the giant beach ball` : `⚫ ${f.name} got run over by a rolling ball`, hl: f.mass < 1 && this.rng() < 0.3 });
        }
      }
      if (!f.alive) continue;
      // breakables are solid; fast heavy Dweebs crash through
      for (const b of W.breakables) {
        if (b.hp <= 0 || f.y > 1.5) continue;
        const d = Math.hypot(f.x - b.x, f.z - b.z), m = b.r + f.radius;
        if (d < m) { const nx = (f.x - b.x) / (d || 1), nz = (f.z - b.z) / (d || 1); f.x = b.x + nx * m; f.z = b.z + nz * m; if (sp * f.mass > 9) { b.hp -= sp * f.mass * 2; if (b.hp <= 0) this.breakIt(b, f); } }
      }
      this.postBounds(f);
      if (f.holding) { f.holding.x = f.x; f.holding.z = f.z; f.holding.y = f.y + 1.4 + f.radius; }
    }
    // body separation (mass-weighted)
    const al = this.dweebs.filter(f => f.alive && !f.dropping && !f.use);
    for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
      const a = al[i], b = al[j], d = dist(a, b), m = a.radius + b.radius;
      if (d < m && d > 0) { const p = (m - d), nx = (b.x - a.x) / d, nz = (b.z - a.z) / d, ra = b.mass / (a.mass + b.mass); a.x -= nx * p * ra; a.z -= nz * p * ra; b.x += nx * p * (1 - ra); b.z += nz * p * (1 - ra); }
    }
    // thrown toys
    for (const k of W.pickups) {
      if (!k.thrown && !(k.vy || k.y > 0) ) continue;
      if (k.heldBy) continue;
      k.x += k.vx * dt; k.z += k.vz * dt; k.vy -= 18 * dt; k.y += k.vy * dt;
      if (k.y <= 0) { k.y = 0; k.vy = 0; k.vx = 0; k.vz = 0; k.thrown = null; continue; }
      if (k.thrown) {
        const by = k.thrown.by;
        for (const o of this.dweebs) if (o !== by && this.isFoe(by, o) && Math.hypot(o.x - k.x, o.z - k.z) < o.radius + 0.6 && Math.abs(o.y + 0.7 - k.y) < 1.3) {
          const vn = Math.hypot(k.vx, k.vz) || 1;
          this.damage(o, 9 + 15 * by.stats.throwPower, by, 'throw', { x: k.vx / vn * 7, z: k.vz / vn * 7, y: 2 });
          k.vx *= -0.2; k.vz *= -0.2; k.thrown = null; break;
        }
      }
    }
    // end conditions: last Dweeb standing or time limit (zone guarantees one of these)
    const alive = this.alive();
    if (alive.length <= 1 || this.t >= this.timeLimit) this.finish();
  }

  postBounds(f) {
    const H = WORLD.half - f.radius;
    if (Math.abs(f.x) > H) { f.x = Math.sign(f.x) * H; f.vx *= -0.5; }
    if (Math.abs(f.z) > H) { f.z = Math.sign(f.z) * H; f.vz *= -0.5; }
  }

  survivalScore(f) {
    const life = f.alive ? this.t : f.deathT;
    return Math.round(life * 2 + f.kos * 40 + f.dmgDealt * 0.3 + f.eats * 5 + f.plays * 3 + (f.alive ? 60 + 80 * f.hp / f.maxHp : 0));
  }

  finish() {
    this.over = true;
    const alive = this.alive().sort((a, b) => this.survivalScore(b) - this.survivalScore(a));
    alive.forEach((f, i) => { f.place = i + 1; });
    for (const f of this.dweebs) f.score = this.survivalScore(f);
    this.winner = alive[0] || [...this.dweebs].sort((a, b) => b.deathT - a.deathT)[0];
    this.emit({ type: 'end', text: `🏆 ${this.winner.name} survived the Wilds!`, hl: true, f: this.winner.idx });
  }

  ranking() { return [...this.dweebs].sort((a, b) => a.place - b.place); }
}

/** Headless run for tests / balance sweeps. */
export function runWilds(entrants, seed = 1, dt = 1 / 20) {
  const s = new WildsSim(entrants, { seed });
  while (!s.over) s.step(dt);
  return s;
}
