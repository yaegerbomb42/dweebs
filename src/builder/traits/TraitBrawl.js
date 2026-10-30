// TraitBrawl.js — deterministic autonomous brawl in the Toy Playroom.
// Pure simulation (no three.js): the renderer in TraitBrawlMode.js just reads state.
// Traits → normalised stats (TraitBalance) → physical numbers + utility-AI weights.

import { normalizeBuild } from './TraitBalance.js';
import { TRAIT_BY_ID } from './TraitCatalog.js';

export function rng32(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ─── Playroom layout (shared with the renderer) ─────────────────────────────
export const ARENA = { hx: 20, hz: 14 };
export function playroomLayout() {
  return {
    // Tube slides: Dweebs climb in at `top` (back ledge) and shoot out at `bottom`.
    slides: [
      { id: 's0', color: 0x2f6fe0, top: { x: -16, z: -12 }, bottom: { x: -9, z: -2 } },
      { id: 's1', color: 0xe03a3a, top: { x: -10, z: -12.5 }, bottom: { x: -3, z: -4 } },
      { id: 's2', color: 0x2f6fe0, top: { x: 0, z: -12.5 }, bottom: { x: 4, z: -5 } },
      { id: 's3', color: 0xf28a1e, top: { x: 6, z: -12.5 }, bottom: { x: 9, z: -4 } },
      { id: 's4', color: 0xf28a1e, top: { x: -19, z: 6 }, bottom: { x: -12, z: 11 } },
    ],
    // Rails along the tiered ledges: fast lanes between two ends.
    rails: [
      { id: 'r0', a: { x: -19, z: -7 }, b: { x: 2, z: -9 } },
      { id: 'r1', a: { x: -6, z: -10 }, b: { x: 14, z: -10 } },
    ],
    trampolines: [
      { id: 't0', x: -6, z: 4, r: 1.6, color: 0x1fb5a8 },
      { id: 't1', x: 3, z: 2, r: 1.6, color: 0xe03a3a },
      { id: 't2', x: 0, z: 8, r: 1.8, color: 0x3b55d9 },
    ],
    // Chalkboards: cover with HP; smash into rubble.
    boards: [
      { id: 'b0', x: 13, z: -3, rot: -0.5, w: 4, hp: 120 },
      { id: 'b1', x: 16, z: 5, rot: -0.9, w: 4.5, hp: 120 },
      { id: 'b2', x: -14, z: 1, rot: 0.6, w: 3.5, hp: 100 },
    ],
    blocks: Array.from({ length: 14 }, (_, i) => ({ id: 'k' + i })),
  };
}

// ─── Fighter construction ───────────────────────────────────────────────────
export function makeFighter({ name, traits = [], core = {}, color = '#ffd23f', team = 0, shape = 'cube', ai = false }, idx) {
  const b = normalizeBuild(traits, core);
  const s = b.stats;
  const tags = new Set(b.traits.flatMap(id => TRAIT_BY_ID.get(id)?.tags || []));
  return {
    idx, name, color, team, shape, isAi: ai, traits: b.traits, stats: s, tags, power: b.power,
    // physical numbers
    maxHp: Math.round(70 + 110 * s.health + 30 * s.size), hp: 0,
    moveSpeed: 2.6 + 6.2 * s.speed, accel: 6 + 14 * s.agility,
    radius: 0.45 + 0.5 * s.size, mass: 0.6 + 1.6 * s.weight,
    dmg: 5 + 13 * s.strength, reach: 0.9 + 1.4 * s.reach,
    armorMul: 1 - 0.55 * s.armor, regen: 2.2 * s.regen, maxSta: 60 + 80 * s.stamina,
    windup: 0.42 - 0.26 * s.reaction, think: 0.5 - 0.32 * s.reaction,
    jumpV: 5 + 7 * s.jump + 4 * s.bounce, grip: s.grip, slip: 1 - 0.85 * s.friction,
    // AI weights (utility multipliers)
    ai: {
      aggression: s.aggression, caution: s.caution, cunning: s.cunning, bravery: s.bravery,
      focus: s.focus, curiosity: s.curiosity, loyalty: s.loyalty, showoff: s.showoff,
    },
    // runtime
    x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, face: 0, sta: 0,
    action: 'idle', actT: 0, thinkT: 0, target: null, holding: null, blocking: false,
    ride: null, alive: true, kos: 0, minHpR: 1, throws: 0, rides: 0, stomps: 0, smashes: 0, hideT: 0, dmgDealt: 0, airborne: false, squash: 0, hitFlash: 0, decisions: {},
  };
}

// ─── Simulation ─────────────────────────────────────────────────────────────
export class TraitBrawl {
  constructor(teams, { seed = 1, timeLimit = 120 } = {}) {
    this.rng = rng32(seed);
    this.layout = playroomLayout();
    this.t = 0; this.timeLimit = timeLimit; this.over = false; this.winner = null;
    this.events = []; this.feed = [];
    this.fighters = [];
    teams.forEach((members, team) => members.forEach(m => this.fighters.push(makeFighter({ ...m, team }, this.fighters.length))));
    const r = this.rng;
    for (const f of this.fighters) {
      f.hp = f.maxHp; f.sta = f.maxSta;
      f.x = (f.team === 0 ? -1 : 1) * (8 + r() * 6); f.z = 3 + r() * 9 - (f.idx % 3) * 2;
      f.thinkT = r() * f.think;
    }
    for (const bd of this.layout.boards) { bd.maxHp = bd.hp; bd.broken = false; }
    for (const k of this.layout.blocks) {
      k.x = (r() - 0.5) * 30; k.z = -3 + r() * 15; k.y = 0; k.vx = 0; k.vz = 0; k.vy = 0; k.heldBy = null; k.color = [0xffd23f, 0x2f6fe0, 0xe03a3a, 0x5ee06a, 0xb25ee0, 0xf28a1e][Math.floor(r() * 6)];
    }
    this.fuzz = Array.from({ length: 3 }, (_, i) => ({ id: i, x: (r() - 0.5) * 24, z: r() * 10 - 2, vx: 0, vz: 0, bite: 0, hp: 40, y: 0, vy: 0 }));
    this.projectiles = [];
  }

  emit(e) { this.events.push(e); if (e.text) { this.feed.unshift({ t: this.t, text: e.text }); this.feed.length = Math.min(this.feed.length, 8); } }
  enemiesOf(f) { return this.fighters.filter(o => o.alive && o.team !== f.team); }
  alliesOf(f) { return this.fighters.filter(o => o.alive && o.team === f.team && o !== f); }

  // Point on the far side of a board from a threat (= hiding spot).
  coverSpot(bd, threat) {
    const dx = bd.x - threat.x, dz = bd.z - threat.z, d = Math.hypot(dx, dz) || 1;
    return { x: bd.x + (dx / d) * 1.6, z: bd.z + (dz / d) * 1.6 };
  }
  // Is a standing board between a and b?
  covered(a, b) {
    for (const bd of this.layout.boards) {
      if (bd.broken) continue;
      const ax = b.x - a.x, az = b.z - a.z, L2 = ax * ax + az * az || 1;
      const t = clamp(((bd.x - a.x) * ax + (bd.z - a.z) * az) / L2, 0, 1);
      const px = a.x + ax * t, pz = a.z + az * t;
      if (t > 0.15 && t < 0.92 && Math.hypot(px - bd.x, pz - bd.z) < bd.w * 0.45) return bd;
    }
    return null;
  }

  // Utility AI: score every option from trait weights × situation, pick the best.
  decide(f) {
    const foes = this.enemiesOf(f);
    if (!foes.length) return;
    const r = this.rng, A = f.ai, L = this.layout;
    const hpR = f.hp / f.maxHp, staR = f.sta / f.maxSta;
    // target choice: focus prefers the weakest, others the nearest
    let tgt = foes[0], best = -1e9;
    for (const o of foes) {
      const sc = -dist(f, o) * (1 - A.focus * 0.6) + (1 - o.hp / o.maxHp) * 12 * A.focus + (o === f.target ? 3 : 0);
      if (sc > best) { best = sc; tgt = o; }
    }
    f.target = tgt;
    const d = dist(f, tgt);
    const threats = foes.filter(o => dist(f, o) < 4).length;
    const tgtBusy = this.fighters.some(o => o.alive && o.team === f.team && o !== f && o.target === tgt && dist(o, tgt) < 3);
    const noise = () => (r() - 0.5) * 0.35 * (1.2 - A.focus);
    const nearest = (arr, fn = () => true) => arr.filter(fn).reduce((m, p) => (!m || dist(f, p) < dist(f, m) ? p : m), null);
    const board = nearest(L.boards, b => !b.broken);
    const block = f.holding ? null : nearest(L.blocks, k => !k.heldBy && k.y < 0.3);
    const tramp = nearest(L.trampolines);
    const slide = nearest(L.slides.map(s => ({ ...s.top, s })));
    const rail = nearest(L.rails.flatMap(rl => [{ ...rl.a, rl, end: 'a' }, { ...rl.b, rl, end: 'b' }]));
    const tg = f.tags;
    const opts = {
      attack: 0.4 + A.aggression * 1.1 + A.bravery * 0.4 + hpR * 0.3 - (d > 8 ? 0.3 : 0) + (tg.has('berserk') ? 0.5 : 0),
      defend: (threats > 0 ? 0.3 : -0.5) + A.caution * 0.9 + (tgt.action === 'windup' && d < 3 ? 0.7 : 0) - A.aggression * 0.4,
      flee: (1 - hpR) * (0.4 + A.caution * 1.3) - A.bravery * 0.8 + (threats > 1 ? 0.3 : 0) + (tg.has('coward') ? 0.4 : 0),
      hide: board ? (1 - hpR) * 0.7 + A.caution * 0.8 + A.cunning * 0.3 - A.aggression * 0.6 + (tg.has('coward-ish') ? 0.4 : 0) : -9,
      flank: tgtBusy ? 0.3 + A.cunning * 1.1 : -1,
      grab: block && dist(f, block) < 9 ? A.curiosity * 0.7 + f.stats.throwPower * 0.6 + (tg.has('grabber') ? 0.5 : 0) + (d > 5 ? 0.2 : -0.2) : -9,
      throw: f.holding ? 0.6 + f.stats.throwPower + (d > 3 && d < 14 ? 0.4 : -0.6) + (tg.has('ranged') ? 0.4 : 0) : -9,
      bounce: tramp ? (f.stats.bounce + f.stats.jump) * 0.6 + (tg.has('tramper') ? 0.6 : 0) + A.showoff * 0.3 + (dist(tramp, tgt) < 5 ? 0.3 : -0.2) : -9,
      slide: slide && d > 6 && dist(f, slide) < 9 ? (f.stats.speed + f.stats.agility) * 0.6 + A.curiosity * 0.5 + (tg.has('slider') ? 0.7 : 0) - 0.1 : -9,
      rail: rail && d > 6 && dist(f, rail) < 9 ? (f.stats.agility + f.stats.grip) * 0.55 + A.curiosity * 0.4 + (tg.has('railer') ? 0.7 : 0) - 0.15 : -9,
      smash: board && dist(board, tgt) < 3.5 && this.covered(f, tgt) ? 0.7 + f.stats.strength * 0.8 + A.aggression * 0.5 + (tg.has('smasher') ? 0.6 : 0) : -9,
      regroup: this.alliesOf(f).length ? A.loyalty * 0.8 + (1 - hpR) * 0.3 - 0.3 : -9,
      taunt: A.showoff * 0.8 + (threats === 0 && d > 6 ? 0.2 : -0.6),
      rest: staR < 0.25 ? 0.9 - A.aggression * 0.3 : -9,
    };
    let pick = 'attack', pv = -1e9;
    for (const [k, v] of Object.entries(opts)) { const s = v + noise(); if (s > pv) { pv = s; pick = k; } }
    f.decisions[pick] = (f.decisions[pick] || 0) + 1;
    f.plan = { kind: pick, tgt, board, block, tramp, slide, rail };
    if (pick !== f.lastPick && r() < 0.25) {
      const say = { hide: 'ducks behind a chalkboard', flee: 'bails!', slide: 'dives into a slide', rail: 'grinds a rail', bounce: 'heads for a trampoline', smash: 'goes to smash the chalkboard', flank: 'circles to flank', taunt: 'shows off', grab: 'grabs a toy block' }[pick];
      if (say) this.emit({ type: 'think', f: f.idx, text: `${f.name} ${say}` });
    }
    f.lastPick = pick;
  }

  moveToward(f, p, dt, mul = 1) {
    const dx = p.x - f.x, dz = p.z - f.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    const sp = f.moveSpeed * mul * (f.sta > 5 ? 1 : 0.55) * (f.airborne ? 0.6 : 1);
    const tx = (dx / d) * sp, tz = (dz / d) * sp;
    const k = Math.min(1, f.accel * dt * (f.airborne ? 0.3 : 1) * (0.4 + 0.6 * (1 - f.slip * 0.6)));
    f.vx += (tx - f.vx) * k; f.vz += (tz - f.vz) * k;
    f.face = Math.atan2(dx, dz);
    return d;
  }

  hit(f, o, dmg, kb, kind) {
    if (!o.alive) return;
    let mult = o.armorMul;
    if (o.blocking) mult *= 0.3 + 0.2 * (1 - o.grip);
    const cover = kind === 'throw' ? this.covered(f, o) : null;
    if (cover) { cover.hp -= dmg; this.maybeBreak(cover, f); return; }
    const dealt = Math.max(1, Math.round(dmg * mult));
    o.hp -= dealt; f.dmgDealt += dealt; o.hitFlash = 0.25; o.minHpR = Math.min(o.minHpR, Math.max(0, o.hp) / o.maxHp);
    if (kind === 'stomp') f.stomps++;
    const dx = o.x - f.x, dz = o.z - f.z, d = Math.hypot(dx, dz) || 1;
    const push = (kb * (o.blocking ? 0.4 : 1)) / o.mass;
    o.vx += (dx / d) * push; o.vz += (dz / d) * push; o.vy += push * 0.35; o.airborne = o.vy > 0 || o.airborne;
    this.emit({ type: 'hit', x: o.x, z: o.z, y: o.y + 0.8, dmg: dealt, f: f.idx, o: o.idx, blocked: o.blocking });
    if (o.hp <= 0) {
      o.alive = false; o.hp = 0; f.kos++;
      if (o.holding) { o.holding.heldBy = null; o.holding = null; }
      this.emit({ type: 'ko', f: f.idx, o: o.idx, x: o.x, z: o.z, text: `💥 ${f.name} KO'd ${o.name}${kind === 'stomp' ? ' with a trampoline stomp!' : kind === 'throw' ? ' with a toy block!' : '!'}` });
    }
  }

  maybeBreak(bd, by) {
    if (bd.hp > 0 || bd.broken) return;
    bd.broken = true;
    this.emit({ type: 'break', board: bd.id, x: bd.x, z: bd.z, text: `🧱 ${by ? by.name : 'Something'} smashed a chalkboard into rubble!` });
  }

  act(f, dt) {
    const P = f.plan; if (!P) return;
    const tgt = P.tgt; f.blocking = false;
    const reachD = f.reach + f.radius + tgt.radius;
    switch (P.kind) {
      case 'attack': case 'flank': {
        let goal = tgt;
        if (P.kind === 'flank') { const a = tgt.face + Math.PI; goal = { x: tgt.x + Math.sin(a) * 1.4, z: tgt.z + Math.cos(a) * 1.4 }; }
        const d = this.moveToward(f, goal, dt, P.kind === 'flank' ? 1.1 : 1);
        if (dist(f, tgt) <= reachD && f.action !== 'windup' && f.actT <= 0 && f.sta > 8) { f.action = 'windup'; f.actT = f.windup; }
        return d;
      }
      case 'defend': f.blocking = true; f.vx *= 0.8; f.vz *= 0.8; f.face = Math.atan2(tgt.x - f.x, tgt.z - f.z); return;
      case 'flee': { const dx = f.x - tgt.x, dz = f.z - tgt.z, d = Math.hypot(dx, dz) || 1; this.moveToward(f, { x: f.x + dx / d * 4, z: f.z + dz / d * 4 }, dt, 1.05); return; }
      case 'hide': if (P.board && !P.board.broken) { const s = this.coverSpot(P.board, tgt); if (this.moveToward(f, s, dt) < 0.4) { f.hideT += dt; f.blocking = f.ai.caution > 0.55; f.vx *= 0.7; f.vz *= 0.7; } } return;
      case 'grab': if (P.block && !P.block.heldBy) { if (this.moveToward(f, P.block, dt) < f.radius + 0.6) { P.block.heldBy = f; f.holding = P.block; this.emit({ type: 'grab', f: f.idx }); f.plan = null; } } return;
      case 'throw': if (f.holding) {
        const k = f.holding; k.heldBy = null; f.holding = null;
        const dx = tgt.x - f.x, dz = tgt.z - f.z, d = Math.hypot(dx, dz) || 1;
        const sp = 9 + 12 * f.stats.throwPower; const err = (this.rng() - 0.5) * (1 - f.stats.accuracy) * 0.8;
        const c = Math.cos(err), s = Math.sin(err), ux = dx / d, uz = dz / d;
        k.x = f.x; k.z = f.z; k.y = 1.2; k.vx = (ux * c - uz * s) * sp; k.vz = (ux * s + uz * c) * sp; k.vy = 2 + d * 0.25;
        this.projectiles.push({ k, owner: f, life: 2.5 }); f.throws++;
        this.emit({ type: 'throw', f: f.idx });
        f.plan = null; f.thinkT = 0.3;
      } return;
      case 'bounce': if (P.tramp && !f.airborne) { if (this.moveToward(f, P.tramp, dt) < P.tramp.r * 0.6) { f.vy = f.jumpV * 1.5; f.airborne = true; f.stomp = true; f.squash = 0.4; this.emit({ type: 'bounce', f: f.idx, x: f.x, z: f.z, tramp: P.tramp.id }); f.plan = { ...P, kind: 'attack' }; } } return;
      case 'slide': if (P.slide) { if (this.moveToward(f, P.slide, dt) < 0.8) { f.ride = { kind: 'slide', s: P.slide.s, u: 0, len: dist(P.slide.s.top, P.slide.s.bottom) }; this.emit({ type: 'slide', f: f.idx }); f.rides++; f.plan = null; } } return;
      case 'rail': if (P.rail) { if (this.moveToward(f, P.rail, dt) < 0.8) { f.ride = { kind: 'rail', rl: P.rail.rl, from: P.rail.end, u: 0, len: dist(P.rail.rl.a, P.rail.rl.b) }; this.emit({ type: 'rail', f: f.idx }); f.rides++; f.plan = null; } } return;
      case 'smash': if (P.board && !P.board.broken) { if (this.moveToward(f, P.board, dt) < 2.1 + f.radius && f.actT <= 0) { P.board.hp -= f.dmg * 1.3; f.actT = 0.5; f.smashes++; f.squash = 0.3; this.emit({ type: 'boardHit', board: P.board.id, x: P.board.x, z: P.board.z }); this.maybeBreak(P.board, f); } } return;
      case 'regroup': { const al = this.alliesOf(f); if (al.length) { const cx = al.reduce((a, o) => a + o.x, 0) / al.length, cz = al.reduce((a, o) => a + o.z, 0) / al.length; this.moveToward(f, { x: cx, z: cz }, dt, 0.8); } return; }
      case 'taunt': f.vx *= 0.85; f.vz *= 0.85; f.sta = Math.min(f.maxSta, f.sta + 10 * dt); f.squash = Math.max(f.squash, 0.15 * Math.abs(Math.sin(this.t * 12))); return;
      case 'rest': f.vx *= 0.8; f.vz *= 0.8; f.sta = Math.min(f.maxSta, f.sta + 25 * dt); return;
    }
  }

  step(dt) {
    if (this.over) return;
    this.t += dt; this.events.length = 0;
    const H = ARENA;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      f.hitFlash = Math.max(0, f.hitFlash - dt); f.squash = Math.max(0, f.squash - dt);
      f.hp = Math.min(f.maxHp, f.hp + f.regen * dt);
      f.sta = Math.min(f.maxSta, f.sta + (4 + 6 * f.stats.stamina) * dt - Math.hypot(f.vx, f.vz) * 0.25 * dt);
      if (f.ride) { // slide / rail transport: fast, invulnerable-ish repositioning
        const R = f.ride; R.u += dt * (R.kind === 'slide' ? 14 : 10 + 6 * f.stats.agility) / R.len;
        const a = R.kind === 'slide' ? R.s.top : (R.from === 'a' ? R.rl.a : R.rl.b);
        const b = R.kind === 'slide' ? R.s.bottom : (R.from === 'a' ? R.rl.b : R.rl.a);
        const u = Math.min(1, R.u);
        f.x = a.x + (b.x - a.x) * u; f.z = a.z + (b.z - a.z) * u;
        f.y = R.kind === 'slide' ? 4.2 * (1 - u) * (1 - u) + 0.1 : 2.2;
        f.face = Math.atan2(b.x - a.x, b.z - a.z);
        if (u >= 1) { const sp = R.kind === 'slide' ? 9 : 4; const d = Math.hypot(b.x - a.x, b.z - a.z) || 1; f.vx = (b.x - a.x) / d * sp; f.vz = (b.z - a.z) / d * sp; f.ride = null; f.y = R.kind === 'rail' ? 2.2 : 0; f.vy = R.kind === 'rail' ? 1 : 0; f.airborne = f.y > 0; }
        continue;
      }
      f.thinkT -= dt;
      if (f.thinkT <= 0 && f.action !== 'windup') { f.thinkT = f.think * (0.8 + this.rng() * 0.4); this.decide(f); }
      f.actT -= dt;
      if (f.action === 'windup' && f.actT <= 0) {
        f.action = 'recover'; f.actT = 0.3; f.sta -= 8;
        const o = f.target;
        if (o && o.alive && !o.ride && dist(f, o) <= f.reach + f.radius + o.radius + 0.4 && Math.abs(o.y - f.y) < 1.5) {
          const dodge = o.stats.agility * 0.35 + (o.blocking ? 0 : 0.05);
          if (this.rng() < clamp(0.6 + f.stats.accuracy * 0.4 - dodge, 0.2, 0.95)) this.hit(f, o, f.dmg, 3 + 9 * f.stats.knockback, 'melee');
          else this.emit({ type: 'whiff', x: o.x, z: o.z });
        }
      } else if (f.action === 'recover' && f.actT <= 0) f.action = 'idle';
      this.act(f, dt);
      // physics
      const fr = f.airborne ? 0.995 : 1 - (0.5 + 4 * f.stats.friction) * dt;
      f.vx *= fr; f.vz *= fr;
      f.x += f.vx * dt; f.z += f.vz * dt;
      if (f.airborne || f.y > 0) {
        f.vy -= 18 * dt; f.y += f.vy * dt;
        if (f.y <= 0) {
          f.y = 0; f.airborne = false; f.squash = 0.25;
          if (f.stomp) { // trampoline stomp: splash damage on landing
            for (const o of this.enemiesOf(f)) if (dist(f, o) < 2.2 + f.radius) this.hit(f, o, f.dmg * 0.9 + 6 * f.mass, 6, 'stomp');
            this.emit({ type: 'land', x: f.x, z: f.z, big: true });
          }
          f.stomp = false;
          if (Math.abs(f.vy) > 4 && f.stats.bounce > 0.6) { f.vy = -f.vy * 0.4 * f.stats.bounce; f.airborne = true; f.y = 0.01; } else f.vy = 0;
        }
      }
      // trampolines launch anyone landing/walking on them
      for (const tp of this.layout.trampolines) if (!f.airborne && Math.hypot(f.x - tp.x, f.z - tp.z) < tp.r * 0.8 && f.plan?.kind !== 'bounce' && this.rng() < 0.04) { f.vy = 6 + 4 * f.stats.bounce; f.airborne = true; f.squash = 0.3; this.emit({ type: 'bounce', f: f.idx, x: tp.x, z: tp.z, tramp: tp.id }); }
      // walls & boards collide
      if (Math.abs(f.x) > H.hx - f.radius) { f.x = Math.sign(f.x) * (H.hx - f.radius); f.vx *= -0.4 * (0.5 + f.stats.bounce); }
      if (Math.abs(f.z) > H.hz - f.radius) { f.z = Math.sign(f.z) * (H.hz - f.radius); f.vz *= -0.4 * (0.5 + f.stats.bounce); }
      for (const bd of this.layout.boards) {
        if (bd.broken) continue;
        const d = Math.hypot(f.x - bd.x, f.z - bd.z);
        if (d < 1.1 + f.radius && f.y < 1) { const nx = (f.x - bd.x) / (d || 1), nz = (f.z - bd.z) / (d || 1); f.x = bd.x + nx * (1.1 + f.radius); f.z = bd.z + nz * (1.1 + f.radius); const sp = Math.hypot(f.vx, f.vz); if (sp > 7) { bd.hp -= sp * f.mass * 1.5; this.maybeBreak(bd, f); } }
      }
      if (f.holding) { f.holding.x = f.x; f.holding.z = f.z; f.holding.y = f.y + 1.6 + f.radius; }
    }
    // body separation
    const al = this.fighters.filter(f => f.alive && !f.ride);
    for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
      const a = al[i], b = al[j], d = dist(a, b), m = a.radius + b.radius;
      if (d < m && d > 0) { const p = (m - d) / 2, nx = (b.x - a.x) / d, nz = (b.z - a.z) / d; const ra = b.mass / (a.mass + b.mass); a.x -= nx * p * 2 * ra; a.z -= nz * p * 2 * ra; b.x += nx * p * 2 * (1 - ra); b.z += nz * p * 2 * (1 - ra); }
    }
    // thrown blocks
    for (const pr of this.projectiles) {
      const k = pr.k; pr.life -= dt;
      k.x += k.vx * dt; k.z += k.vz * dt; k.vy -= 18 * dt; k.y += k.vy * dt;
      if (k.y < 0) { k.y = 0; k.vy = 0; k.vx *= 0.3; k.vz *= 0.3; pr.life = 0; }
      for (const o of this.enemiesOf(pr.owner)) if (pr.life > 0 && Math.hypot(o.x - k.x, o.z - k.z) < o.radius + 0.5 && Math.abs(o.y + 0.6 - k.y) < 1.2) { this.hit(pr.owner, o, 8 + 14 * pr.owner.stats.throwPower, 7, 'throw'); pr.life = 0; k.vx *= -0.2; k.vz *= -0.2; }
      for (const bd of this.layout.boards) if (pr.life > 0 && !bd.broken && Math.hypot(bd.x - k.x, bd.z - k.z) < bd.w * 0.45 && k.y < 3) { bd.hp -= 25; pr.life = 0; k.vx *= -0.3; k.vz *= -0.3; this.emit({ type: 'boardHit', board: bd.id, x: bd.x, z: bd.z }); this.maybeBreak(bd, pr.owner); }
      k.x = clamp(k.x, -H.hx + 0.3, H.hx - 0.3); k.z = clamp(k.z, -H.hz + 0.3, H.hz - 0.3);
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
    // fuzzball critters: neutral spiky hazards, ignore fuzzball-friends
    for (const z of this.fuzz) {
      if (z.hp <= 0) continue;
      const prey = this.fighters.filter(f => f.alive && !f.ride && !f.tags.has('fuzzfriend')).reduce((m, f) => (!m || dist(z, f) < dist(z, m) ? f : m), null);
      z.bite -= dt;
      if (prey) {
        const dx = prey.x - z.x, dz = prey.z - z.z, d = Math.hypot(dx, dz) || 1;
        z.vx += (dx / d * 3.2 - z.vx) * dt * 2; z.vz += (dz / d * 3.2 - z.vz) * dt * 2;
        if (d < prey.radius + 0.6 && z.bite <= 0 && prey.y < 0.8) { z.bite = 1.6; prey.hp -= 4; prey.hitFlash = 0.2; z.vy = 4; this.emit({ type: 'bite', x: prey.x, z: prey.z }); if (prey.hp <= 0) { prey.alive = false; prey.hp = 0; this.emit({ type: 'ko', o: prey.idx, x: prey.x, z: prey.z, text: `🦔 A fuzzball took out ${prey.name}!` }); } }
      }
      z.x = clamp(z.x + z.vx * dt, -H.hx + 0.5, H.hx - 0.5); z.z = clamp(z.z + z.vz * dt, -H.hz + 0.5, H.hz - 0.5);
      z.vy -= 18 * dt; z.y = Math.max(0, z.y + z.vy * dt); if (z.y === 0) z.vy = Math.abs(z.vy) > 1 ? 0 : 2.5; // hoppy
    }
    // win check
    const teamsAlive = new Set(this.fighters.filter(f => f.alive).map(f => f.team));
    if (teamsAlive.size <= 1 || this.t >= this.timeLimit) {
      this.over = true;
      if (teamsAlive.size === 1) this.winner = [...teamsAlive][0];
      else if (teamsAlive.size === 0) this.winner = 'draw';
      else {
        const score = tm => this.fighters.filter(f => f.team === tm).reduce((a, f) => a + f.hp / f.maxHp, 0);
        const s0 = score(0), s1 = score(1); this.winner = s0 === s1 ? 'draw' : (s0 > s1 ? 0 : 1);
      }
      this.emit({ type: 'end', text: this.winner === 'draw' ? '🤝 Draw!' : `🏆 ${this.winner === 0 ? 'Your squad' : 'Rival squad'} wins!` });
    }
  }
}

/** Headless run (tests / quick sims). */
export function runBrawl(teams, seed = 1, dt = 1 / 30) {
  const b = new TraitBrawl(teams, { seed });
  while (!b.over) b.step(dt);
  return b;
}
