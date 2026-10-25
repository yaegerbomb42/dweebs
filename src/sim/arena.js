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

import { BALANCE } from '../game/Balance.js';
import { DROP_ITEMS, RARE } from './tables.js';

export const CORE_RADIUS = 11;
export const STAGE_RADIUS = 16;
export const SEGMENTS = 16;
export const WATER_LEVEL = -5;

/** Max live stage items, and how often the sky tries to add one. Mirrors the live values. */
const ITEM_CAP = 10;
const ITEM_INTERVAL = 6;      // seconds

/**
 * The sim's stage: static colliders, kinematic hazards, and the drop table's live bookkeeping.
 * A physics body, not a picture of one.
 */
export class SimArena {
  /**
   * @param {import('./physics.js').SimPhysics} physics
   * @param {import('./rng.js').Rng} rng The 'drops' stream.
   */
  constructor(physics, rng) {
    this.physics = physics;
    this.rng = rng;
    this.time = 0;
    this.suddenDeath = false;
    this.itemTimer = Math.round(ITEM_INTERVAL * 60);
    /** @type {Record<string, number>} last drop time per rare key, for the cooldown filter. */
    this.lastRareDrop = Object.create(null);
    /** @type {object[]} kinematic hazards the sim moves; the view reads their transforms. */
    this.hazards = [];
    this.spinAngle = 0;
    this.spinRate = 1.2;      // rad/s; matches the live turntable
    this.build();
  }

  build() {
    // A single fat cylinder stands in for the island. The live arena is a core disc plus 16
    // crumbling ring tiles; the sim only needs "solid within STAGE_RADIUS", and one collider
    // instead of 17 keeps the Rapier world small enough to snapshot cheaply.
    this.physics.fixedCylinder(0, -1, 0, STAGE_RADIUS, 1);

    // Bumpers, trampolines and the turntable. These are not colliders in the sim: the sim
    // detects a dweeb inside the radius and applies the bounce itself, which is deterministic
    // and never depends on the ordering of contact-force events.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 8 + i * Math.PI / 2;
      this.hazards.push({ kind: 'bumper', x: Math.cos(a) * 8.2, z: Math.sin(a) * 8.2, r: 0.7, tint: i });
    }
    for (const a of [Math.PI * 3 / 8, -Math.PI * 3 / 8]) {
      this.hazards.push({ kind: 'trampoline', x: Math.cos(a) * 8.2, z: Math.sin(a) * 8.2, r: 1.05 });
    }
    this.spinner = { kind: 'spinner', x: 0, z: 0, half: 5.5, dangerR: 2.0, angle: 0 };
    this.hazards.push(this.spinner);
  }

  /** Advance the kinematic stage. Returns 'drop' on the tick the sky should drop something. */
  step() {
    this.time += 1 / 60;
    this.spinAngle = (this.spinAngle + this.spinRate / 60) % (Math.PI * 2);
    this.spinner.angle = this.spinAngle;
    if (--this.itemTimer <= 0) {
      this.itemTimer = Math.round(ITEM_INTERVAL * 60);
      return 'drop';
    }
    return null;
  }

  /** True when (x, z) is over solid floor. The single source of truth for "am I over stage". */
  isOverGround(x, z, margin = 0) {
    return Math.hypot(x, z) < STAGE_RADIUS - margin;
  }

  /** Current radius of solid ground — shrinks in sudden death. */
  edgeRadius() {
    return this.suddenDeath ? STAGE_RADIUS * BALANCE.match.sdBlastScale : STAGE_RADIUS;
  }

  /** Sudden death: the ring starts crumbling. Idempotent. */
  startSuddenDeath() {
    this.suddenDeath = true;
  }

  // ─── Drop table ───────────────────────────────────────────────────────────────

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

  get itemCap() { return ITEM_CAP; }
}
