// src/sim/combat.js — every way a dweeb can hurt another dweeb, headless.
//
// Hits are resolved geometrically (cones and spheres), never from raw physics contact forces, so
// damage is predictable and knockback follows the Smash-style percent curve in Balance.js. The
// numbers are the live CombatSystem's: the same tables, the same charge curve, the same weapon
// identities, re-expressed with no three.js and no Fx.
//
// Deliberately NOT here: the aim guide's predictThrow preview, the Fx callouts, and audio. The
// throw itself is simulated (a ballistic launch plus gravity); the preview is a view concern, and
// QA already pins predictThrow against real physics.

import { BALANCE } from '../game/Balance.js';
import { TICK_DT } from './contracts.js';
import { SEGMENTS as SEGMENTS_N } from './arena.js';
import { WEAPONS, itemDef } from './tables.js';

const A = BALANCE.attacks;
const THROW_SPEED = 18;         // base throw speed, scaled by charge and item heft
const GRAB_RANGE = 1.5;

/**
 * Apply a damage/launch package scaled by the attacker's power-ups and Super Yeet, in place.
 * The same helper the live CombatSystem uses.
 */
function scale(atk, atkDmg = 1, kb = 1) {
  atk.damage *= atkDmg;
  atk.base *= kb;
  atk.growth *= kb;
  return atk;
}

/** The sim's combat system. It holds no presentation references: everything it reports is an event. */
export class SimCombat {
  /**
   * @param {object} opts
   * @param {import('./physics.js').SimPhysics} opts.physics
   * @param {import('./arena.js').SimArena} opts.arena
   * @param {import('./rng.js').Rng} opts.rng The 'combat' stream, for aim wobble.
   * @param {string[]} opts.itemKeys Item keys in item-id order, so itemDef can be resolved.
   */
  constructor({ physics, arena, rng, itemKeys }) {
    this.physics = physics;
    this.arena = arena;
    this.rng = rng;
    this.itemKeys = itemKeys;
  }

  itemDefFor(itemId) {
    const key = this.itemKeys[itemId - 1] ?? this.itemKeys[0] ?? 'box';
    return { key, def: itemDef(key) };
  }

  /**
   * The attack table for a dweeb's current swing: a bare punch, a held melee weapon, or a dive.
   * @param {import('./dweeb.js').SimDweeb} d
   * @param {number} charge 0..1
   */
  attackTable(d, charge) {
    if (d.diveTimer > 0 && !d.grounded) return { atk: { ...A.dive }, range: 1.5, cone: 0.4, cd: 0.7, kind: 'dive' };
    if (d.held) {
      const { key, def } = this.itemDefFor(d.held);
      if (def.weapon && WEAPONS[key]) {
        const w = WEAPONS[key];
        return { atk: A[w.name] ? A[w.name](charge) : A.punch(charge), range: w.range, cone: w.cone, cd: w.cd, kind: w.name };
      }
    }
    return { atk: A.punch(charge), range: 1.6, cone: 0.5, cd: 0.28, kind: 'punch' };
  }

  /**
   * Resolve a swing. Cone test on the floor plane: within `range` and within `cone` radians of the
   * attacker's facing. `spiky` has a negative cone, which the live code reads as "hits everything
   * around"; that is handled explicitly here rather than by a sign trick.
   */
  resolveSwing(attacker, charge, dweebs, api) {
    const { atk, range, cone, cd, kind } = this.attackTable(attacker, charge);
    attacker.attackCooldown = cd;
    attacker.swing = 0.12;

    // Power-ups and Super Yeet multiply the swing. These are sim state, not view state.
    let atkDmg = attacker.megaT > 0 ? 1.35 : 1;
    let kb = attacker.megaT > 0 ? 1.2 : 1;
    if (attacker.superArmed) { kb *= 1.35; atkDmg *= 1.35; }
    scale(atk, atkDmg, kb);
    attacker.superArmed = false;

    const p = attacker.position;
    const fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
    let hit = false;

    for (const t of dweebs) {
      if (t === attacker || !t.active || t.invuln > 0) continue;
      const dx = t.position[0] - p[0], dz = t.position[2] - p[2];
      const dy = t.position[1] - p[1];
      const dist = Math.hypot(dx, dz);
      if (dist > range || Math.abs(dy) > 1.6) continue;
      if (!(dist < 0.6 || cone < 0 || (dx * fx + dz * fz) / dist > Math.cos(cone))) continue;
      const launch = t.applyHit({
        damage: atk.damage,
        base: atk.base * t.stats.armor,
        growth: atk.growth * t.stats.armor * t.stats.growthTaken,
        dirX: dx || fx, dirZ: dz || fz, lift: 0.35 + charge * 0.5,
        from: attacker, punch: kind === 'punch',
      }, api);
      hit = true;
      if (launch) api.noteLaunch?.(t, launch);
    }

    // A punch with a throwable in hand is a throw, not a jab.
    if (!hit && kind === 'punch' && attacker.held) {
      this.throwHeld(attacker, Math.max(0.2, charge), api);
      hit = true;
    }

    // A whiffed jab breaks the punch streak: the super-smash meter wants consecutive LANDED punches.
    if (!hit && kind === 'punch') attacker.punchStreak = 0;

    api.emit?.(hit ? 'attack' : 'whiff', { a: attacker.id, mag: charge, kind });
    return hit;
  }

  /**
   * Grab whatever is nearest: a dweeb first (a KO is worth more than a beach ball), otherwise a
   * loose item. The victim's escape timer is the counterplay — wriggle free on a clock.
   */
  grab(attacker, dweebs, items, api) {
    const p = attacker.position;
    let best = null, bestD = GRAB_RANGE;
    for (const t of dweebs) {
      if (t === attacker || !t.active || t.grabbedBy) continue;
      const d = Math.hypot(t.position[0] - p[0], t.position[2] - p[2]);
      if (d < bestD && Math.abs(t.position[1] - p[1]) < 1.4) { bestD = d; best = t; }
    }
    if (best) {
      best.grabbedBy = attacker.id;
      best.isCharging = false;
      best.charge = 0;
      best.escapeTimer = 1.2;
      attacker.heldKind = 'dweeb';
      attacker.held = best.id;
      api.emit?.('grab', { a: attacker.id, b: best.id, mag: bestD });
      return true;
    }
    for (const it of items) {
      if (!it.active || it.heldBy) continue;
      const d = Math.hypot(it.pos[0] - p[0], it.pos[2] - p[2]);
      if (d > bestD || Math.abs(it.pos[1] - p[1]) > 1.4) continue;
      bestD = d; best = it;
    }
    if (best) {
      best.heldBy = attacker.id;
      attacker.held = best.id;
      attacker.heldKind = 'item';
      api.emit?.('grab', { a: attacker.id, b: best.id, mag: bestD });
      return true;
    }
    return false;
  }

  /** Let go of whatever is held, dropping it in place. */
  drop(d, items, api) {
    if (!d.held) return;
    const id = d.held;
    if (d.heldKind === 'dweeb') {
      const victim = api.byId?.(id);
      if (victim) victim.grabbedBy = 0;
    } else {
      const it = items.find(i => i.id === id);
      if (it) it.heldBy = 0;
    }
    api.emit?.('drop', { a: d.id, b: id });
    d.held = 0;
    d.heldKind = '';
  }

  /**
   * Throw. Speed scales with charge and is tempered by heft, spin is ∝ 1/√mass, and a thrower
   * who is falling and aiming down gets a trickshot bonus — the same three modifiers the live
   * game applies, so a hammer still yeets further than a beach ball.
   */
  throwHeld(d, charge, api) {
    const c = Math.max(0, Math.min(1, charge));
    const yaw = d.input.aimYaw ?? d.yaw;
    const loft = d.input.aimLoft;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const wasHolding = d.held;

    if (d.heldKind === 'dweeb') {
      const victim = api.byId?.(wasHolding);
      d.held = 0;
      d.heldKind = '';
      if (!victim) return;
      victim.grabbedBy = 0;
      const atk = scale(A.dweebThrow(c));
      const speed = THROW_SPEED * c + 6;
      this.physics.setVel(victim.id, fx * speed, Math.sin(loft) * speed * 0.6, fz * speed);
      victim.lastHitBy = d.id;
      victim.lastHitAt = api.time;
      victim.applyHit({
        damage: atk.damage, base: atk.base, growth: atk.growth,
        dirX: fx, dirZ: fz, lift: 0.5 + c * 0.5, from: d,
      }, api);
      api.emit?.('throw', { a: d.id, b: victim.id, mag: c });
      return;
    }

    const it = api.itemById?.(wasHolding);
    d.held = 0;
    d.heldKind = '';
    if (!it) return;
    const { def } = this.itemDefFor(wasHolding);
    // Heft tempers the throw: speed × clamp(1.3 − 0.15·mass, 0.55, 1.3) — the live formula.
    const heft = Math.max(0.55, Math.min(1.3, 1.3 - 0.15 * def.mass));
    const speed = (THROW_SPEED * c + 6) * heft;
    it.heldBy = 0;
    it.thrown = 12;                   // ticks this item counts as a fresh throw
    it.thrower = d.id;
    this.physics.setVel(it.id, fx * speed, Math.sin(loft) * speed, fz * speed);
    const av = this.physics.angvel(it.id);
    const spin = 6 / Math.sqrt(def.mass);
    this.physics.setAngvel(it.id, av.x + spin * fz, av.y, av.z - spin * fx);
    it.aim = { x: fx, y: Math.sin(loft), z: fz };

    // A trickshot: thrown while falling and aimed downward. Big damage, big style.
    if (this.physics.vel(d.id).y < -2 && loft < 0.05) {
      it.trick = true;
      api.emit?.('trickShot', { a: it.id, b: d.id, mag: 1.4 });
    }
    api.emit?.('throw', { a: d.id, b: 0, mag: c, kind: it.key });
  }

  /**
   * A thrown item connecting with a dweeb, or an explosive going off. Called once per tick per
   * live item, so a heavy anvil genuinely hurts on contact and barrels are dangerous to stand
   * next to. Item damage is the live `thrown(w, sk)` table with w = heft and sk = speed/trick.
   */
  itemContacts(item, dweebs, api) {
    const { def } = this.itemDefFor(item.id);
    const v = this.physics.vel(item.id);
    const speed = Math.hypot(v.x, v.y, v.z);

    // Rockets keep thrusting while in flight. This is why the live aim guide and the live rocket
    // disagree by ~1 m over a 45 m throw (on the board, QA→SIM). In the sim the thrust is part
    // of the physics, so a predicted arc and a real flight are the same arc.
    if (item.key === 'toyRocket' && item.thrown > 0) {
      const dir = item.aim || { x: 0, y: 0, z: 1 };
      this.physics.setVel(item.id, dir.x * 21, dir.y * 21 + 0.5, dir.z * 21);
    }

    for (const d of dweebs) {
      if (!d.active || d.invuln > 0) continue;
      const p = d.position;
      if (Math.hypot(p[0] - item.pos[0], p[1] - item.pos[1], p[2] - item.pos[2]) > 0.95) continue;
      const atk = A.thrown(def.heft, item.trick ? 1.4 : Math.min(1.4, speed / 22));
      d.applyHit({
        damage: atk.damage, base: atk.base, growth: atk.growth,
        dirX: v.x, dirZ: v.z, lift: 0.3, from: item.thrower ? api.byId?.(item.thrower) : null,
      }, api);
      api.emit?.('impact', { a: item.id, b: d.id, mag: speed });
      if (def.explosive) this.explode(item, dweebs, api);
      else api.despawnItem?.(item, false);
      return;
    }

    // A lit explosive counts down from the moment it is thrown and goes off regardless.
    if (def.explosive && item.fuse > 0) {
      item.fuse -= TICK_DT;
      if (item.fuse <= 0) this.explode(item, dweebs, api);
    }
  }

  /** Radial damage, falling off linearly with distance from the blast centre. */
  explode(item, dweebs, api) {
    const { def } = this.itemDefFor(item.id);
    const r = def.blast || 5;
    api.emit?.('explosion', { x: item.pos[0], y: item.pos[1], z: item.pos[2], mag: r, kind: item.key });
    for (const d of dweebs) {
      if (!d.active) continue;
      const p = d.position;
      const dist = Math.hypot(p[0] - item.pos[0], p[1] - item.pos[1], p[2] - item.pos[2]);
      if (dist > r) continue;
      const k = 1 - dist / r;
      const atk = A.explosion(k);
      d.applyHit({
        damage: atk.damage, base: atk.base, growth: atk.growth,
        dirX: p[0] - item.pos[0], dirZ: p[2] - item.pos[2], lift: 0.6 + k,
        from: item.thrower ? api.byId?.(item.thrower) : null,
      }, api);
    }
    api.despawnItem?.(item, true);
  }

  /** A dive tackle in flight hits whatever it runs into. */
  diveContacts(dweebs, api) {
    for (const d of dweebs) {
      if (!d.active || d.diveTimer <= 0) continue;
      const p = d.position, v = d.velocity;
      for (const t of dweebs) {
        if (t === d || !t.active || t.invuln > 0) continue;
        if (Math.hypot(t.position[0] - p[0], t.position[2] - p[2]) > 1.4) continue;
        const atk = scale(A.dive);
        t.applyHit({ ...atk, dirX: v[0], dirZ: v[2], lift: 0.4, from: d }, api);
        d.diveTimer = 0;
        d.diveCooldown = 0.8;
        break;
      }
    }
  }

  /**
   * Bumpers, trampolines, jump pads, hammers, conveyors, crumbly tiles and rising lava —
   * applied as analytic tests rather than as contacts. Deterministic, and it does not depend
   * on contact-event ordering — which is the whole reason the sim does it this way rather
   * than the way the live game does it.
   */
  stageHazards(dweebs, arena, api) {
    const B = BALANCE.bounce, AB = BALANCE.arena;
    for (const d of dweebs) {
      if (!d.active) continue;
      const p = d.position;
      // Belt velocity is refreshed every tick: standing on a conveyor joins its drift to your
      // movement target (see preStep); stepping off zeroes it again.
      d.beltVX = 0;
      d.beltVZ = 0;

      // Crumbly rim tiles: over a gone tile the floor is gone. Toggle ground collision so the
      // dweeb genuinely falls through to the lagoon; restore it once back over solid floor.
      const pit = arena.isPit(p[0], p[2]) && p[1] < 1.2;
      if (pit && !d.pitfall) {
        d.pitfall = true;
        this.physics.setCollideGround(d.id, false);
      } else if (!pit && d.pitfall) {
        d.pitfall = false;
        this.physics.setCollideGround(d.id, true);
      }

      // Rising lava (Lava Foundry): outside the safe radius at floor level burns.
      if (arena.profile.lavaRising && d.lavaCd <= 0 && p[1] < 1.5 && p[1] > -2) {
        const r = Math.hypot(p[0], p[2]);
        const edge = arena.lavaEdge();
        if (r > edge) {
          const nx = r > 0.01 ? -p[0] / r : 0, nz = r > 0.01 ? -p[2] / r : 0;
          const launch = d.applyHit({
            damage: AB.lavaDamage, base: AB.lavaBase, growth: AB.lavaGrowth,
            dirX: nx, dirZ: nz, lift: 0.9, from: null,
          }, api);
          d.lavaCd = AB.lavaCooldown;
          api.emit?.('lava', { a: d.id, x: p[0], y: p[1], z: p[2], mag: launch });
        }
      }

      for (const h of arena.hazards) {
        const dx = p[0] - h.x, dz = p[2] - h.z;
        if (h.kind === 'bumper' || h.kind === 'trampoline' || h.kind === 'jumppad') {
          if (Math.hypot(dx, dz) > h.r + 0.4) continue;
          const v = this.physics.vel(d.id);
          if (h.kind === 'bumper') {
            const dist = Math.hypot(dx, dz);
            const nx = dist > 0.01 ? dx / dist : 1, nz = dist > 0.01 ? dz / dist : 0;
            const along = v.x * nx + v.z * nz;
            const out = Math.max(B.bumperMinSpeed, -along * B.bumperGain);
            this.physics.setVel(d.id,
              v.x + nx * (out - along + B.bumperPush),
              Math.max(v.y, B.bumperUp),
              v.z + nz * (out - along + B.bumperPush));
            api.emit?.('bumper', { a: d.id, x: h.x, y: 0.25, z: h.z, mag: out });
          } else if (v.y < 1) {
            const vel = h.kind === 'jumppad' ? AB.jumpPadVel : B.trampolineVel;
            this.physics.setVel(d.id, v.x, vel, v.z);
            api.emit?.(h.kind === 'jumppad' ? 'jumppad' : 'trampoline',
              { a: d.id, x: h.x, y: 0.25, z: h.z, mag: vel });
          }
        } else if (h.kind === 'hammer') {
          if (d.hazardCd > 0 || p[1] > 2.4) continue;
          const head = arena.hammerHead(h);
          const hx = p[0] - head.x, hz = p[2] - head.z;
          if (Math.hypot(hx, hz) > h.headR + 0.45) continue;
          // Tangential shove along the swing direction, plus lift.
          const s = Math.sign(h.speed) || 1;
          const rx = head.x - h.x, rz = head.z - h.z;
          const rl = Math.hypot(rx, rz) || 1;
          const launch = d.applyHit({
            damage: AB.hammerDamage, base: AB.hammerBase, growth: AB.hammerGrowth,
            dirX: (-rz / rl) * s, dirZ: (rx / rl) * s, lift: 0.55, from: null,
          }, api);
          d.hazardCd = 0.9;
          api.emit?.('hazard', { a: d.id, kind: 'hammer', x: head.x, y: 1, z: head.z, mag: launch });
        } else if (h.kind === 'conveyor') {
          if (!d.grounded || d.grabbedBy) continue;
          if (Math.abs(dx) > h.hx || Math.abs(dz) > h.hz) continue;
          if (p[1] > 1.6 || p[1] < -1.2) continue;
          // The belt joins the dweeb's movement target (see preStep): a flat velocity add
          // would be braked away before the next physics step ever integrated it.
          d.beltVX = h.dx * h.speed;
          d.beltVZ = h.dz * h.speed;
        }
      }
    }

    // Crumble transitions are pure functions of time, so warn/fall edges are computed from
    // (time, time - dt) without storing per-tile state.
    if (arena.profile.crumbly) {
      const t = arena.time, dt = TICK_DT;
      for (let i = 0; i < SEGMENTS_N; i++) {
        const now = arena.tileStateAt(i, t), prev = arena.tileStateAt(i, t - dt);
        if (now === prev) continue;
        if (now === 'shaking') api.emit?.('segmentWarn', { b: i });
        else if (now === 'gone') api.emit?.('segmentFall', { b: i });
      }
    }
  }
}
