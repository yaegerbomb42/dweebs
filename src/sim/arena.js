// src/sim/arena.js — the stage, as data and colliders. No three.js, no meshes.
//
// The sim needs to know exactly three things about the arena: where the floor is, where the
// hazards are, and what the drop table does. Everything else about Dweeb Stadium — the
// grandstands, the letter blocks, the crowd, the decals — belongs to the view and is not
// simulated at all.
//
// The layout constants here are copied from src/world/Arena.js (Lead-owned, may be restyled
// freely). The drop table is a deliberate restatement rather than an import, because Arena.js
// pulls in three.js and cannot load in Node; QA asked for exactly this on the board, and both
// copies must stay in step.
//
// ─── Hazard determinism ───
// Every hazard here is a pure function of (arena.time, seeded initial values). The initial
// values are drawn once at build() from the 'hazards' RNG stream — a stream nothing else draws
// from, so adding hazards never shifts the drop table or combat rolls. Because motion is a
// function of time, a snapshot only needs `time` to resume a hazard exactly; no per-hazard
// mutable state is snapshotted. The sim applies hazards analytically (a radius test, a velocity
// nudge) rather than as colliders, so results never depend on contact-event ordering.

import { BALANCE } from '../game/Balance.js';
import { DROP_ITEMS, RARE } from './tables.js';

export const CORE_RADIUS = 11;
export const STAGE_RADIUS = 16;
export const SEGMENTS = 16;
export const WATER_LEVEL = -5;

/** Max live stage items, and how often the sky tries to add one. Mirrors the live values. */
const ITEM_CAP = 10;
const ITEM_INTERVAL = 6;      // seconds
/** Pre-spawn warning: the drop is picked and telegraphed this many ticks before it lands. */
export const TELEGRAPH_TICKS = Math.round(BALANCE.arena.telegraphTime * 60);

/**
 * Which hazards the sim models per stage id. Unknown ids fall back to the stadium profile, so
 * the sim never crashes on a stage the view added first — it just plays it plain.
 */
export const ARENA_PROFILES = {
  stadium:     { floorFriction: 0.7,  hammers: 0, conveyors: 0, jumpPads: 0, crumbly: false, lavaRising: false, bumpers: 4, trampolines: 2, spinner: true },
  colosseum:   { floorFriction: 0.7,  hammers: 2, conveyors: 2, jumpPads: 2, crumbly: false, lavaRising: false, bumpers: 4, trampolines: 0, spinner: false },
  icepeak:     { floorFriction: 0.08, hammers: 0, conveyors: 0, jumpPads: 1, crumbly: true,  lavaRising: false, bumpers: 2, trampolines: 0, spinner: false },
  lavafoundry: { floorFriction: 0.7,  hammers: 1, conveyors: 0, jumpPads: 1, crumbly: false, lavaRising: true,  bumpers: 2, trampolines: 0, spinner: false },
};

export function arenaProfile(id) {
  return ARENA_PROFILES[id] ?? ARENA_PROFILES.stadium;
}

/**
 * The sim's stage: static colliders, kinematic hazards, and the drop table's live bookkeeping.
 * A physics body, not a picture of one.
 */
export class SimArena {
  /**
   * @param {import('./physics.js').SimPhysics} physics
   * @param {import('./rng.js').RngStreams|import('./rng.js').Rng} rngStreams The sim RNG streams
   *   (an Rng is also accepted and used for both the drops and the hazards).
   * @param {string} [arenaId] Stage id; unknown ids play as the stadium.
   */
  constructor(physics, rngStreams, arenaId = 'stadium') {
    this.physics = physics;
    const isStreams = !!rngStreams && typeof rngStreams.stream === 'function';
    this.rng = isStreams ? rngStreams.stream('drops') : rngStreams;
    this.hazardRng = isStreams ? rngStreams.stream('hazards') : rngStreams;
    this.arenaId = arenaId;
    this.profile = arenaProfile(arenaId);
    this.time = 0;
    this.suddenDeath = false;
    this.itemTimer = Math.round(ITEM_INTERVAL * 60);
    /** Pre-picked drop waiting out its telegraph, or null. { key, x, z, rare } */
    this.pendingDrop = null;
    /** @type {Record<string, number>} last drop time per rare key, for the cooldown filter. */
    this.lastRareDrop = Object.create(null);
    /** @type {object[]} kinematic hazards the sim moves; the view reads their transforms. */
    this.hazards = [];
    this.spinAngle = 0;
    this.spinRate = 1.2;      // rad/s; matches the live turntable
    /** Crumble schedule: crumbleTimes[i] is when rim tile i falls, Infinity if it never does. */
    this.crumbleTimes = new Array(SEGMENTS).fill(Infinity);
    this.build();
  }

  build() {
    const P = this.profile;
    // A single fat cylinder stands in for the island. The live arena is a core disc plus 16
    // crumbling ring tiles; the sim only needs "solid within STAGE_RADIUS", and one collider
    // instead of 17 keeps the Rapier world small enough to snapshot cheaply. Crumbly tiles are
    // modelled by toggling a dweeb's ground collision (see SimCombat.stageHazards), not by
    // removing colliders.
    this.physics.fixedCylinder(0, -1, 0, STAGE_RADIUS, 1, P.floorFriction);

    // Bumpers, trampolines and the turntable. These are not colliders in the sim: the sim
    // detects a dweeb inside the radius and applies the bounce itself, which is deterministic
    // and never depends on the ordering of contact-force events.
    for (let i = 0; i < P.bumpers; i++) {
      const a = Math.PI / 8 + i * Math.PI / 2;
      this.hazards.push({ kind: 'bumper', x: Math.cos(a) * 8.2, z: Math.sin(a) * 8.2, r: 0.7, tint: i });
    }
    for (let i = 0; i < P.trampolines; i++) {
      const a = i === 0 ? Math.PI * 3 / 8 : -Math.PI * 3 / 8;
      this.hazards.push({ kind: 'trampoline', x: Math.cos(a) * 8.2, z: Math.sin(a) * 8.2, r: 1.05 });
    }
    for (let i = 0; i < P.jumpPads; i++) {
      const d = this.hazardRng.floorDir();
      const r = 5 + this.hazardRng.next() * 4;
      this.hazards.push({ kind: 'jumppad', x: d.x * r, z: d.z * r, r: 1.15 });
    }
    for (let i = 0; i < P.hammers; i++) {
      const d = this.hazardRng.floorDir();
      const pr = 2 + this.hazardRng.next() * 3;
      this.hazards.push({
        kind: 'hammer',
        x: d.x * pr, z: d.z * pr,
        armR: BALANCE.arena.hammerArmR,
        headR: BALANCE.arena.hammerHeadR,
        phase0: this.hazardRng.next() * Math.PI * 2,
        speed: BALANCE.arena.hammerSpeed * (this.hazardRng.int(2) === 0 ? 1 : -1),
      });
    }
    // Two opposing conveyor belts, mirroring the live Pinball Factory layout: fixed lanes at
    // z = ∓4.2 pushing opposite x directions. Deterministic and non-overlapping by construction.
    for (let i = 0; i < P.conveyors; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.hazards.push({
        kind: 'conveyor',
        x: 0, z: side * 4.2,
        hx: 6.4, hz: 1.25,
        dx: -side, dz: 0,
        speed: BALANCE.arena.conveyorSpeed,
      });
    }
    if (P.spinner) {
      this.spinner = { kind: 'spinner', x: 0, z: 0, half: 5.5, dangerR: 2.0, angle: 0 };
      this.hazards.push(this.spinner);
    }
    if (P.crumbly) {
      // Crumble order is a seeded shuffle; the schedule is then a pure function of time.
      const order = [...Array(SEGMENTS).keys()];
      for (let i = order.length - 1; i > 0; i--) {
        const j = this.hazardRng.int(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const A = BALANCE.arena;
      for (let k = 0; k < Math.min(A.crumbleMax, SEGMENTS); k++) {
        this.crumbleTimes[order[k]] = A.crumbleFirst + k * A.crumbleEvery;
      }
    }
  }

  /**
   * Advance the kinematic stage. Returns 'telegraph' on the tick a sky drop is picked and
   * warned, 'drop' TELEGRAPH_TICKS later when it lands, null otherwise.
   */
  step(bias = null) {
    this.time += 1 / 60;
    this.spinAngle = (this.spinAngle + this.spinRate / 60) % (Math.PI * 2);
    if (this.spinner) this.spinner.angle = this.spinAngle;
    if (--this.itemTimer === TELEGRAPH_TICKS) return 'telegraph';
    if (this.itemTimer <= 0) {
      this.itemTimer = Math.round(ITEM_INTERVAL * 60);
      return 'drop';
    }
    return null;
  }

  /** True when (x, z) is over solid floor. The single source of truth for "am I over stage". */
  isOverGround(x, z, margin = 0) {
    return Math.hypot(x, z) < STAGE_RADIUS - margin;
  }

  /** Rim tile index for an angle, 0..SEGMENTS-1. Tiles are the crumble unit on icepeak. */
  tileIndex(x, z) {
    let a = Math.atan2(z, x);
    if (a < 0) a += Math.PI * 2;
    return Math.min(SEGMENTS - 1, Math.floor(a / (Math.PI * 2) * SEGMENTS));
  }

  /** Tile state at time t: 'intact' | 'shaking' (telegraphed) | 'gone'. Pure in (i, t). */
  tileStateAt(i, t) {
    const ct = this.crumbleTimes[i];
    if (!Number.isFinite(ct)) return 'intact';
    if (t >= ct) return 'gone';
    if (t >= ct - BALANCE.arena.crumbleWarn) return 'shaking';
    return 'intact';
  }

  /** Tile state at the current time. */
  tileState(i) {
    return this.tileStateAt(i, this.time);
  }

  /** True when (x, z) is over a crumbled rim tile — the floor is gone there. */
  isPit(x, z) {
    if (!this.profile.crumbly) return false;
    const r = Math.hypot(x, z);
    if (r < CORE_RADIUS || r >= STAGE_RADIUS) return false;
    return this.tileState(this.tileIndex(x, z)) === 'gone';
  }

  /** Current hammer-head position: a pure function of time. The view reads this to render it. */
  hammerHead(h) {
    const a = h.phase0 + h.speed * this.time;
    return { x: h.x + Math.cos(a) * h.armR, z: h.z + Math.sin(a) * h.armR };
  }

  /** Rising lava edge (Lava Foundry): the radius of the safe zone. Infinity anywhere else. */
  lavaEdge() {
    if (!this.profile.lavaRising) return Infinity;
    const A = BALANCE.arena;
    if (this.time < A.lavaEdgeGrace) return STAGE_RADIUS;
    return Math.max(A.lavaEdgeMin, STAGE_RADIUS - A.lavaEdgeRise * (this.time - A.lavaEdgeGrace));
  }

  /** Current radius of solid ground — shrinks in sudden death, and under rising lava. */
  edgeRadius() {
    const sd = this.suddenDeath ? STAGE_RADIUS * BALANCE.match.sdBlastScale : STAGE_RADIUS;
    return Math.min(sd, this.lavaEdge());
  }

  /** Sudden death: the ring starts crumbling. Idempotent. */
  startSuddenDeath() {
    this.suddenDeath = true;
  }

  // ─── Drop table ───────────────────────────────────────────────────────────────

  /**
   * Pick the next sky drop ahead of time and choose where it lands, so the view can telegraph
   * it. Returns null when the item cap is reached (checked by the caller) or the table is dry.
   */
  planDrop(bias = null, liveCounts = null) {
    const key = this.pickDropItem(bias, liveCounts);
    if (!key) return null;
    const p = this.randomGroundPoint(8.5);
    this.pendingDrop = { key, x: p.x, z: p.z, rare: !!RARE[key] };
    return this.pendingDrop;
  }

  /**
   * Weighted pick with the live game's rare caps and cooldowns, faithful to
   * Arena.pickDropItem — including the two filters QA found easy to get wrong:
   *   • a rare key is gated by cooldown AS WELL AS cap, so testing the cap in isolation
   *     measures the wrong filter; and
   *   • a handout stamps `lastRareDrop`, so "this key must appear" is a flaky assertion. The
   *     natural table rate is the thing to assert.
   * @param {object|null} [bias] Per-key weight multiplier (sudden-death explosives bias).
   * @param {Map<string, number>|null} [liveCounts] Live count per key, for the caps.
   * @returns {string|null} an item key, or null if every weight is 0
   */
  pickDropItem(bias = null, liveCounts = null) {
    const weights = new Array(DROP_ITEMS.length).fill(0);
    for (let i = 0; i < DROP_ITEMS.length; i++) {
      const it = DROP_ITEMS[i];
      const rare = RARE[it.key];
      if (rare) {
        const live = liveCounts ? (liveCounts.get(it.key) || 0) : 0;
        if (live >= rare.max) continue;
        if (this.time - (this.lastRareDrop[it.key] ?? -1e9) < rare.cd) continue;
      }
      const w = it.w * (bias?.[it.key] ?? 1);
      if (w <= 0) continue;
      weights[i] = w;
    }
    const idx = this.rng.weighted(weights);
    if (idx < 0) return null;
    const key = DROP_ITEMS[idx].key;
    if (RARE[key]) this.lastRareDrop[key] = this.time;
    return key;
  }

  /**
   * A point over solid ground, from the seeded stream. The live Arena.randomGroundPoint retries
   * up to 20 times, and so does this, so wander targets and item drops land where they used to.
   */
  randomGroundPoint(maxR) {
    for (let i = 0; i < 20; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * maxR;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.isOverGround(x, z, 0.5)) return { x, z };
    }
    return { x: 0, z: 2 };
  }

  /**
   * A respawn/drop point separated from `avoid` (other dweebs, this tick's earlier respawns) by
   * at least `minDist`. Simultaneous respawns used to teleport capsules into each other; the
   * solver answered with explosive depenetration — dweebs clipping through the floor or
   * launching sideways. Deterministic: every candidate comes from the seeded stream, and the
   * fallback keeps the best candidate seen rather than looping forever.
   */
  separatedGroundPoint(maxR, avoid = [], minDist = BALANCE.arena.respawnMinGap) {
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 10; i++) {
      const p = this.randomGroundPoint(maxR);
      let m = Infinity;
      for (const a of avoid) m = Math.min(m, Math.hypot(p.x - a.x, p.z - a.z));
      if (m >= minDist) return p;
      if (m > bestScore) { bestScore = m; best = p; }
    }
    return best ?? { x: 0, z: 2 };
  }

  get itemCap() { return ITEM_CAP; }
}
