// src/sim/arena.js — the stage, as data and colliders. No three.js, no meshes.
//
// The sim needs to know exactly three things about the arena: where the floor is, where the
// hazards are, and what the drop table does. Everything else about Dweeb Stadium — the
// grandstands, the letter blocks, the crowd, the decals — belongs to the view and is not
// simulated at all.
//
// Every arena in src/game/Arenas.js has a mechanic profile here (arenaProfiles.js). The
// stadium plays like the sim always has; the other seven play their own game:
//   iceberg    — 0.16 traction, 1.08 slide (applied in SimDweeb.preStep)
//   volcano    — lava lagoon (first dip spits you back, second dip dunks) + crust collapse
//   pinball    — conveyor belts push grounded dweebs and items
//   moon       — 0.58 gravity (applied by Sim between preStep and physics)
//   gale       — telegraphed wind gusts shove everything sideways
//   megastadium— 1.4 bumper boost
//   stormspire — telegraphed lightning strikes
//   quicksand  — sticky centre drags grounded dweebs down
//   magnetcore — periodic pulls toward the centre
//
// All schedulers draw from the arena's own seeded 'drops' stream, so two runs with the same
// seed strike the same lightning at the same tick.

import { BALANCE } from '../game/Balance.js';
import { TICK_DT } from './contracts.js';
import { DROP_ITEMS, RARE } from './tables.js';
import { profileFor } from './arenaProfiles.js';

export const CORE_RADIUS = 11;
export const STAGE_RADIUS = 16;
export const SEGMENTS = 16;
export const WATER_LEVEL = -5;

/** Max live stage items, and how often the sky tries to add one. Mirrors the live values. */
const ITEM_CAP = 10;
const ITEM_INTERVAL = 6;      // seconds

const AR = BALANCE.arena;

/**
 * The sim's stage: static colliders, kinematic hazards, and the drop table's live bookkeeping.
 * A physics body, not a picture of one.
 */
export class SimArena {
  /**
   * @param {import('./physics.js').SimPhysics} physics
   * @param {import('./rng.js').Rng} rng The 'drops' stream.
   * @param {object} [opts] @param {string} [opts.arenaId] one of ARENA_IDS, default 'stadium'
   */
  constructor(physics, rng, opts = {}) {
    this.physics = physics;
    this.rng = rng;
    this.setArena(opts.arenaId ?? 'stadium');
    this.time = 0;
    this.suddenDeath = false;
    this.itemTimer = Math.round(ITEM_INTERVAL * 60);
    /** @type {Record<string, number>} last drop time per rare key, for the cooldown filter. */
    this.lastRareDrop = Object.create(null);
    /** @type {object[]} kinematic hazards the sim moves; the view reads their transforms. */
    this.hazards = [];
    this.spinAngle = 0;
    this.spinRate = 1.2;      // rad/s; matches the live turntable
    /** Telegraphed danger zones, rebuilt every tick; merged into SimState.hazards for bots. */
    this.warnZones = [];
    this._resetSchedulers();
    this.build();
  }

  /** Switch arenas without rebuilding the physics world (same geometry, new personality). */
  setArena(arenaId) {
    this.arenaId = arenaId;
    this.profile = profileFor(arenaId);
    this._resetSchedulers();
  }

  _resetSchedulers() {
    this.wind = { phase: 'idle', timer: Math.round(AR.windFirst * 60), dirX: 1, dirZ: 0 };
    this.lightning = { timer: AR.lightningFirst + this.rng.range(0, 2), warnT: 0, x: 0, z: 0 };
    this.magnet = { phase: 'idle', timer: Math.round(AR.magnetIdle * 60) };
    this.crustFalls = 0;
    this.crustTimer = Math.round(AR.crustFirst * 60);
    this.warnZones = [];
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

  /**
   * Advance the kinematic stage. Returns 'drop' on the tick the sky should drop something.
   * Scheduler state is tick-quantized (integer timers) so snapshots stay exact.
   */
  step(api) {
    this.time += TICK_DT;
    this.spinAngle = (this.spinAngle + this.spinRate / 60) % (Math.PI * 2);
    this.spinner.angle = this.spinAngle;
    this.warnZones = [];
    let drop = null;
    if (--this.itemTimer <= 0) {
      this.itemTimer = Math.round(ITEM_INTERVAL * 60);
      drop = 'drop';
    }
    this._stepWind(api);
    this._stepLightning(api);
    this._stepMagnet(api);
    this._stepCrust(api);
    return drop;
  }

  // ─── Wind (Sky Turbine Rooftop) ─────────────────────────────────────────────

  _stepWind(api) {
    if (!this.profile.wind) return;
    const w = this.wind;
    if (w.phase === 'idle') {
      if (--w.timer <= 0) {
        const a = this.rng.next() * Math.PI * 2;
        w.dirX = Math.cos(a); w.dirZ = Math.sin(a);
        w.phase = 'warn';
        w.timer = Math.round(AR.windWarn * 60);
        api?.emit?.('windGust', { kind: 'warn', mag: a });
      }
    } else if (w.phase === 'warn') {
      if (--w.timer <= 0) {
        w.phase = 'blow';
        w.timer = Math.round(AR.windDuration * 60);
        api?.emit?.('windGust', { kind: 'blow', mag: Math.atan2(w.dirX, w.dirZ) });
      }
    } else if (--w.timer <= 0) {
      w.phase = 'idle';
      w.timer = Math.round(AR.windEvery * 60);
    }
  }

  // ─── Lightning (Storm Spire) ────────────────────────────────────────────────

  _stepLightning(api) {
    if (!this.profile.lightning) return;
    const l = this.lightning;
    if (l.warnT > 0) {
      this.warnZones.push({ kind: 'lightning', x: l.x, z: l.z, dangerR: AR.lightningRadius + 0.6 });
      return; // the strike itself is resolved in applyStageForces, after physics
    }
    l.timer -= TICK_DT;
    if (l.timer <= 0) {
      const p = this.randomGroundPoint(11);
      l.x = p.x; l.z = p.z;
      l.warnT = AR.lightningWarn;
      api?.emit?.('lightning', { kind: 'warn', x: p.x, y: 0, z: p.z });
      this.warnZones.push({ kind: 'lightning', x: p.x, z: p.z, dangerR: AR.lightningRadius + 0.6 });
    }
  }

  // ─── Magnet pulse (Magnet Core) ─────────────────────────────────────────────

  _stepMagnet(api) {
    if (!this.profile.magnetPulse) return;
    const m = this.magnet;
    if (m.phase === 'idle') {
      if (--m.timer <= 0) {
        m.phase = 'warn';
        m.timer = Math.round(AR.magnetWarn * 60);
        api?.emit?.('magnetPulse', { kind: 'warn' });
      }
    } else if (m.phase === 'warn') {
      if (--m.timer <= 0) {
        m.phase = 'active';
        m.timer = Math.round(AR.magnetActive * 60);
        api?.emit?.('magnetPulse', { kind: 'active' });
      }
    } else if (--m.timer <= 0) {
      m.phase = 'idle';
      m.timer = Math.round(AR.magnetIdle * 60);
    }
  }

  // ─── Crust collapse (Crumbly Donut Volcano) ──────────────────────────────────

  _stepCrust(api) {
    if (!this.profile.crust || this.crustFalls >= AR.crustMax) return;
    if (--this.crustTimer <= 0) {
      this.crustTimer = Math.round(AR.crustEvery * 60);
      this.crustFalls++;
      api?.emit?.('segmentWarn', { b: this.crustFalls });
      api?.emit?.('segmentFall', { b: this.crustFalls });
    }
  }

  /**
   * Stage push as a target-velocity offset, for SimDweeb.preStep. Belts carry, wind shoves,
   * the magnet drags: they compose with the dweeb's own input by shifting what "standing
   * still" means, instead of fighting the ground friction after the fact. Returns null when
   * the arena is calm.
   * @returns {{x: number, z: number}|null}
   */
  stagePush(x, z, grounded) {
    const p = this.profile;
    let px = 0, pz = 0, any = false;
    if (p.conveyors && grounded) {
      const belt = this._beltAt(x, z);
      if (belt) { px += belt.dir * AR.conveyorPush; any = true; }
    }
    if (p.wind && this.wind.phase === 'blow') {
      px += this.wind.dirX * AR.windForce * 0.7;
      pz += this.wind.dirZ * AR.windForce * 0.7;
      any = true;
    }
    if (p.magnetPulse && this.magnet.phase === 'active') {
      const dist = Math.hypot(x, z) || 1;
      const pull = AR.magnetForce * 0.45;
      px += (-x / dist) * pull;
      pz += (-z / dist) * pull;
      any = true;
    }
    return any ? { x: px, z: pz } : null;
  }

  /**
   * Stage forces that are not colliders: quicksand drag on dweebs, and wind / magnet /
   * conveyor / quicksand pushes on items (items have no preStep, so forces land directly).
   * Lightning strikes resolve here too, after physics. Called by Sim after arena.step.
   */
  applyStageForces(dweebs, items, api) {
    const p = this.profile;

    // Lightning strikes resolve here (after physics), one tick after the warn expires.
    if (p.lightning) {
      const l = this.lightning;
      if (l.warnT > 0) {
        l.warnT -= TICK_DT;
        if (l.warnT <= 0) {
          l.timer = AR.lightningEvery + this.rng.range(-2, 2);
          this._strikeLightning(l.x, l.z, dweebs, items, api);
        }
      }
    }

    const w = this.wind;
    const blowing = p.wind && w.phase === 'blow';
    const magnetOn = p.magnetPulse && this.magnet.phase === 'active';
    const sticky = p.stickyCenter;
    const belts = p.conveyors;

    // Quicksand drag on dweebs: a velocity bleed, not a push.
    if (sticky) {
      for (const d of dweebs) {
        if (!d.active || !d.grounded || d.grabbedBy) continue;
        const pos = d.position;
        if (Math.hypot(pos[0], pos[2]) >= AR.quicksandRadius) continue;
        const v = this.physics.vel(d.id);
        this.physics.setVel(d.id, v.x * AR.quicksandDrag, v.y, v.z * AR.quicksandDrag);
      }
    }

    if (!blowing && !magnetOn && !sticky && !belts) return;

    for (const it of items) {
      if (!it.active || it.heldBy) continue;
      const v = this.physics.vel(it.id);
      let vx = v.x, vy = v.y, vz = v.z;
      if (blowing) {
        vx += w.dirX * AR.windItemForce * TICK_DT;
        vz += w.dirZ * AR.windItemForce * TICK_DT;
      }
      if (magnetOn) {
        const dx = -it.pos[0], dz = -it.pos[2];
        const dist = Math.hypot(dx, dz) || 1;
        const pull = Math.min(AR.magnetForce * 1.5 * TICK_DT, dist * 4);
        vx += (dx / dist) * pull;
        vz += (dz / dist) * pull;
      }
      if (belts) {
        const belt = this._beltAt(it.pos[0], it.pos[2]);
        if (belt) vx += Math.sign(belt.dir * AR.conveyorPush - vx) *
          Math.min(Math.abs(belt.dir * AR.conveyorPush - vx), AR.conveyorPush * TICK_DT * 8);
      }
      if (sticky && Math.hypot(it.pos[0], it.pos[2]) < AR.quicksandRadius && it.pos[1] < 1) {
        vx *= AR.quicksandDrag;
        vz *= AR.quicksandDrag;
      }
      this.physics.setVel(it.id, vx, vy, vz);
    }
  }

  /** Two belts across the factory floor: +x at z≈+4.4, −x at z≈−4.4. */
  _beltAt(x, z) {
    if (Math.abs(x) > 10) return null;
    if (Math.abs(z - 4.4) < AR.conveyorWidth) return { dir: 1 };
    if (Math.abs(z + 4.4) < AR.conveyorWidth) return { dir: -1 };
    return null;
  }

  _strikeLightning(x, z, dweebs, items, api) {
    api.emit('lightning', { kind: 'strike', x, y: 0, z, mag: AR.lightningRadius });
    for (const d of dweebs) {
      if (!d.active || d.invuln > 0) continue;
      const pos = d.position;
      const dx = pos[0] - x, dz = pos[2] - z;
      if (Math.hypot(dx, dz) > AR.lightningRadius) continue;
      const len = Math.hypot(dx, dz) || 1;
      d.percent = Math.round((d.percent + AR.lightningDamage) * 10) / 10;
      this.physics.setVel(d.id, (dx / len) * 6, AR.lightningLaunch, (dz / len) * 6);
      d.lastHitBy = 0;
      d.lastHitAt = api.time;
      api.emit('hit', { a: d.id, b: 0, mag: AR.lightningDamage, tier: 2 });
    }
    for (const it of items) {
      if (!it.active || it.heldBy) continue;
      if (Math.hypot(it.pos[0] - x, it.pos[2] - z) > AR.lightningRadius) continue;
      const v = this.physics.vel(it.id);
      this.physics.setVel(it.id, v.x, Math.max(v.y, 10), v.z);
    }
  }

  /**
   * Volcano lava: the first dip spits you back out (damage + launch), the second dip — while
   * the lava cooldown is still running — dunks you for real. Returns true when the dweeb was
   * spat back (no KO), false when the splash counts.
   */
  lavaDip(d, api) {
    // The third consecutive dip dunks no matter what: you can kiss the lava twice,
    // but nobody swims in it. (The counter resets on solid ground / respawn.)
    if (d.lavaCd > 0 || d.lavaDips >= 2) return false;
    d.lavaCd = AR.lavaCooldown;
    d.lavaDips++;
    d.swimFlail = 0;
    d.flailUsed = false;
    const pos = d.position;
    const r = Math.hypot(pos[0], pos[2]) || 1;
    // The spit-back scales with percent like a real hit: at low percent it is a comic
    // bounce back onto the stage; at high percent the lava itself launches you out.
    // No `from`: the lava gets no KO credit — but a rival's recent touch still does,
    // through the normal lastHitBy window, so edge-guarding into the lagoon pays.
    const launch = d.applyHit({
      damage: AR.lavaDamage, base: 4, growth: 6,
      dirX: pos[0] / r, dirZ: pos[2] / r, lift: AR.lavaLaunch, from: null,
    }, api);
    api.emit('lavaHit', { a: d.id, mag: Math.round(launch * 10) / 10, x: pos[0], y: pos[1], z: pos[2] });
    return true;
  }

  /** True when (x, z) is over solid floor. The single source of truth for "am I over stage". */
  isOverGround(x, z, margin = 0) {
    return Math.hypot(x, z) < this.edgeRadius() - margin;
  }

  /**
   * Current radius of solid ground — shrinks in sudden death, and on the volcano the crust
   * keeps falling in (up to crustMax segments, 12% of the radius each).
   */
  edgeRadius() {
    let r = STAGE_RADIUS;
    if (this.suddenDeath) r *= BALANCE.match.sdBlastScale;
    if (this.crustFalls > 0) r *= 1 - 0.12 * this.crustFalls;
    return r;
  }

  /** Sudden death: the ring starts crumbling. Idempotent. */
  startSuddenDeath() {
    this.suddenDeath = true;
  }

  /** Fresh round: schedulers, timers and crust reset; the arena identity stays. */
  resetRound() {
    this.time = 0;
    this.suddenDeath = false;
    this.itemTimer = Math.round(ITEM_INTERVAL * 60);
    this.lastRareDrop = Object.create(null);
    this._resetSchedulers();
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

  snapshot() {
    return {
      arenaId: this.arenaId,
      time: this.time, itemTimer: this.itemTimer,
      suddenDeath: this.suddenDeath, lastRareDrop: { ...this.lastRareDrop },
      spinAngle: this.spinAngle,
      wind: { ...this.wind },
      lightning: { ...this.lightning },
      magnet: { ...this.magnet },
      crustFalls: this.crustFalls, crustTimer: this.crustTimer,
      // warnZones are derived from lightning.warnT, but the checksum reads getState()
      // between ticks — carry them so a snapshot checksums identically before resuming.
      warnZones: this.warnZones.map(z => ({ ...z })),
    };
  }

  /** @param {ReturnType<SimArena['snapshot']>} s */
  restore(s) {
    this.setArena(s.arenaId ?? 'stadium');
    Object.assign(this, {
      time: s.time, itemTimer: s.itemTimer, suddenDeath: s.suddenDeath,
      spinAngle: s.spinAngle, crustFalls: s.crustFalls ?? 0, crustTimer: s.crustTimer ?? 0,
    });
    this.lastRareDrop = { ...(s.lastRareDrop ?? {}) };
    if (s.wind) this.wind = { ...s.wind };
    if (s.lightning) this.lightning = { ...s.lightning };
    if (s.magnet) this.magnet = { ...s.magnet };
    this.warnZones = (s.warnZones ?? []).map(z => ({ ...z }));
    return this;
  }
}
