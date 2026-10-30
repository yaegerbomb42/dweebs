// CombatSystem.js — every way a Dweeb can hurt another Dweeb.
// Actions (punch, smash, grab, throw, dive) are shared by the player Controller and Bots.
// Hits are resolved geometrically (cones / spheres), never from raw physics contact forces,
// so damage is predictable and knockback follows Smash-style percent scaling.

import * as THREE from 'three';
import { CollisionGroups } from '../physics/PhysicsWorld.js';
import { BALANCE } from '../game/Balance.js';
import { RARE } from '../sim/tables.js';
import { BUMPER_RADIUS, TRAMPOLINE_RADIUS, TRAMPOLINE_TOP, TRAMPOLINE_VEL, TRAMPOLINE_ITEM_VEL, bumperBounce } from '../world/Arena.js';
import { getObjectDef } from '../world/ObjectRegistry.js';

const CHARGE_TIME = 0.75;
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _seg = new THREE.Vector3();
const ROCKET_SPEED = 21;
const G = 25;                 // PhysicsWorld GRAVITY
const ITEM_DAMP = 0.06;       // item linear damping
export const DEFAULT_LOFT = 0.2;  // throw elevation (rad) when nobody's aiming
// Timed grab catch: an incoming prop can be plucked out of the air before normal focus.
const CATCH = { radius: 2.2, nearRadius: 3.2, approach: 0.25, minSpeed: 0.01 };
const PREDICT_STEP = 1 / 45;
const A = BALANCE.attacks;
const WHOOPEE = BALANCE.whoopee;
/** Giant Swing: hold attack while carrying a Dweeb. Rates in rad/s. */
const GIANT_SWING = {
  startCharge: 0.3,   // charge level at which the wind-up becomes a swing
  minRate: 5, maxRate: 15,
  radius: 1.35,       // arm's length (world units, scaled by MEGA)
  hitRadius: 1.0,     // how close a bystander must be to the swung Dweeb to get clobbered
  escapeSlow: 0.55,   // fraction of the victim's wriggle clock that the blur takes back
  dizzyAfter: 3.2,    // seconds before you lose it
  flingBonus: 0.45,   // up to +45% throw damage/launch at full spin
};

/** Materials that catch fire from blasts. `time` = seconds of burn, `ash` = crumbles when done. */
const FLAMMABLE = {
  wood: { time: 6 },
  cardboard: { time: 3.5, ash: true },
  fabric: { time: 4, ash: true },
};
/** How many links a chain reaction may ripple through before it fizzles (perf + sanity). */
const CHAIN_MAX_DEPTH = 8;
const _CHAR = new THREE.Color(0x1d1712);
const _fire = new THREE.Vector3();
const SLIP = BALANCE.slip;
const SUPER = 1.35;           // Super Yeet: damage / base / growth multiplier

// Hoverboard rideable constants
const HOVER_MOUNT_HORIZ = 0.7;    // horizontal range to mount
const HOVER_MOUNT_VERT = 0.6;     // vertical range above board to mount
const HOVER_RIDE_OFFSET = 0.55;   // capsule half-height+radius (0.5) + board half-thickness, so feet rest on the deck

// Melee weapon identity (def.weapon). Exported so test/tables-parity.test.js can pin
// sim/tables.js WEAPONS against this — the two must stay in step (see T6).
export const WEAPONS = {
  // `cone` is the dot threshold between facing and target (higher = narrower). Spiky is the
  // deliberate exception: it hits everyone around you, so it reads as an area swing.
  hammer: { range: 2.5, cone: 0.3, cd: 0.5, table: A.hammer },    // 72° arc, committed swing
  anvil:  { range: 1.45, cone: 0.55, cd: 0.8, table: A.anvil },   // point-blank, enormous
  spiky:  { range: 2.1, cone: -0.25, cd: 0.38, table: A.spiky, multi: true }, // hits everyone around
  glove:  { range: 1.8, cone: 0.72, cd: 0.19, table: A.glove },   // 44° jab: percent first, launch later
};

// Style meter: gains, tiers, decay — re-exported from Balance.js (single source of truth).
export const STYLE = BALANCE.style;

/** Scale an attack table result (in place) — mega power, archetype, Super Yeet. */
function scaled(atk, dmg = 1, kb = 1) {
  atk.damage *= dmg;
  atk.base *= kb;
  atk.growth *= kb;
  return atk;
}

const _heldQ = new THREE.Quaternion(), _heldQ2 = new THREE.Quaternion(), _heldE = new THREE.Euler();
const _UP = new THREE.Vector3(0, 1, 0), _RIGHT = new THREE.Vector3(1, 0, 0);

export class CombatSystem {
  constructor(physicsWorld, arena, fx) {
    this.physics = physicsWorld;
    this.arena = arena;
    this.fx = fx;
    this.time = 0;
    this.dweebs = [];
    this.gooZones = [];
  }

  setDweebs(dweebs) {
    this.clearGooZones();
    this.dweebs = dweebs;
  }

  // ═══ Actions ═══

  /** Begin winding up an attack (hold). Tap-release gives a quick jab. */
  startCharge(d) {
    if (!d.canAct || d.attackCooldown > 0 || d.isCharging) return false;
    d.isCharging = true;
    d.charging = 0.001;
    return true;
  }

  /** Release the attack: punch / hammer smash / throw depending on what's in hand. */
  releaseAttack(d) {
    if (!d.isCharging) return;
    const charge = d.charging >= 0.2 ? d.charging : 0;
    d.isCharging = false;
    d.charging = 0;
    if (!d.canAct) return;
    if (d.stuckTimer > 0) d.mashGoo?.(0.4);

    // Shooter weapon (melonCannon): lob an exploding melon instead of swinging
    if (d.held?.kind === 'object' && d.held.ref?.def?.isShooter) {
      this._fireShooter(d, charge);
      return;
    }

    if (d.held && !(d.held.kind === 'object' && d.held.ref.isWeapon)) {
      if (d.held.kind === 'object' && d.held.ref.def.gadget) {
        this.useGadget(d, charge);
        return;
      }
      this.throwHeld(d, charge);
      return;
    }
    const profile = this.attackProfile(d);
    // The player picks a direction with the camera. Only bots get a facing snap.
    if (d.isPlayer) {
      if (Number.isFinite(d.lookYaw)) d.yaw = d.lookYaw;
    } else this._autoAim(d, profile.range);
    const { weapon, wdef } = profile;
    const p = d.powerScale;
    const yeet = charge > 0 && this._useSuper(d);
    const mul = yeet ? SUPER : 1;
    // Boxer: the third landed punch in a streak becomes a short anvil-weight uppercut.
    const uppercut = !weapon && this._uppercutReady(d);
    const atk = uppercut
      ? scaled(A.anvil(charge), p * mul * 0.8, p * mul * 0.9)
      : weapon
        ? scaled(wdef.table(charge), p * mul, p * mul)
        : scaled(A.punch(charge), p * mul * d.stats.hitDmg, p * mul);
    atk.range = profile.range;
    atk.cone = profile.cone;
    atk.multi = profile.multi;
    atk.kind = uppercut || weapon ? 'smash' : charge ? 'smash' : 'punch';
    atk.uppercut = uppercut;

    d.attackAnim = 0.22;
    d.attackCooldown = weapon ? wdef.cd + charge * 0.2 : 0.3 + charge * 0.25;
    if (d.sugarTimer > 0) d.attackCooldown *= BALANCE.powerups.sugar.cooldown;
    d.swingT = weapon ? 0.3 : 0;

    // Little lunge
    const f = d.forward;
    const v = d.body.linvel();
    const lunge = d.grounded ? 3 + charge * 4 : 1.5;
    d.body.setLinvel({ x: v.x + f.x * lunge, y: v.y, z: v.z + f.z * lunge }, true);

    const pos = d.getPosition();
    let hitAny = false;

    // Pick the target nearest your aim ray, not merely the nearest body. Basic punches and
    // weapons are single-target so a swing reads as a choice; the spiky ball is the AoE exception.
    const bodies = [];
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy === d) continue;
      const tp = t.getPosition();
      const dx = tp.x - pos.x, dz = tp.z - pos.z, dy = tp.y - pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist > atk.range || Math.abs(dy) > 1.6) continue;
      const dot = dist > 0.001 ? (dx * f.x + dz * f.z) / dist : 1;
      if (dot < atk.cone && dist > 0.6) continue;
      // Geometry blocks punches: the drop wall and floating platforms are cover, not decoration.
      if (this._losBlocked(pos, tp, d.collider, dist)) continue;
      bodies.push({ t, dist, dot, dx, dz });
    }
    bodies.sort((a, b) => this._meleeScore(a) - this._meleeScore(b));
    const hitBodies = atk.multi ? bodies : bodies.slice(0, 1);

    for (const { t, dx, dz } of hitBodies) {
      _dir.set(dx, 0, dz);
      _dir.normalize();
      const launchDir = atk.uppercut
        ? _tmp.set(f.x * 0.55 + _dir.x * 0.2, 0.95 + charge * 0.1, f.z * 0.55 + _dir.z * 0.2)
        : _tmp.set(f.x * 0.75 + _dir.x * 0.25, 0.45 + charge * 0.15, f.z * 0.75 + _dir.z * 0.25);
      const launch = t.receiveHit({ dir: launchDir, damage: atk.damage, base: atk.base, growth: atk.growth, attacker: d, time: this.time });
      if (launch > 0) {
        hitAny = true;
        this.status?.onHit(t, d, d.held?.kind === 'object' ? d.held.ref : null);
        this.fx.hit(t, d, launch, atk.kind);
        if (yeet) this.fx.superYeet(t, d);
        // Super-smash meter: consecutive landed punches bank bonus style; a weapon swing is
        // not a punch and breaks the streak.
        let bonus = 0, label = null;
        if (!weapon) {
          bonus = this._punchStreak(d);
          if (d.signature?.id === 'uppercut') d.signaturePunchCount = (d.signaturePunchCount || 0) + 1;
          if (d.punchStreak >= 3) label = `x${d.punchStreak} COMBO`;
        } else {
          d.punchStreak = 0;
          d.signaturePunchCount = 0;
        }
        this.addStyle(d, 4 + launch * 0.5 + (charge > 0.8 ? 4 : 0) + bonus, label);
        if (atk.uppercut) {
          this.fx._toyWord?.('UPPERCUT!', t.getPosition(), d.color, 'big');
          this.fx.cam?.shake?.(0.22);
          this.addStyle(d, 5, 'UPPERCUT');
        }
      }
    }

    // Punching objects is also aimed: the object closest to your reticle gets the hit.
    const objects = [];
    for (const { obj } of this.arena.getObjectsNear(pos, atk.range)) {
      if (obj === d.held?.ref) continue;
      const op = obj.getPosition();
      const dx = op.x - pos.x, dz = op.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > atk.range) continue;
      const dot = dist > 0.001 ? (dx * f.x + dz * f.z) / dist : 1;
      if (dot < atk.cone && dist > 0.7) continue;
      objects.push({ obj, dist, dot });
    }
    objects.sort((a, b) => this._meleeScore(a) - this._meleeScore(b));
    const hitObjects = atk.multi ? objects : objects.slice(0, 1);
    for (const { obj } of hitObjects) {
      // Impulse ∝ √mass: a beach ball rockets away, a couch barely scoots
      const m = Math.sqrt(obj.body.mass());
      const imp = (5 + charge * 8) * p;
      this.physics.applyImpulse(obj.body, { x: f.x * imp * m, y: imp * 0.5 * m, z: f.z * imp * m });
      this.physics.applyTorqueImpulse(obj.body, { x: f.z * m * 0.6, y: (Math.random() - 0.5) * m * 0.4, z: -f.x * m * 0.6 });
      obj.thrownBy = d;
      obj.thrownTime = 0.8;
      obj.hitList.clear();
      obj.hitList.add(d);
      hitAny = true;
      if (obj.def.explosive) this.lightFuse(obj, d, charge > 0.5 ? 0.45 : 0.9);
      else if (!this.damageObject(obj, 1000 + charge * 3000, d, { dir: { x: d.forward.x, y: 0, z: d.forward.z }, speed: 6 + charge * 10 })) this.fx.bonk(obj.getPosition(), obj);
    }
    if (!hitAny) {
      this.fx.whiff(d, weapon);
      // A whiffed jab breaks the streak: the super-smash meter wants consecutive LANDED punches.
      if (!weapon) {
        d.punchStreak = 0;
        d.signaturePunchCount = 0;
      }
    }
  }

  /** Fire a shooter weapon (melonCannon): lob an exploding melon with a cooldown and live cap. */
  _fireShooter(d, charge) {
    const SHOOTER_CD = 0.55;
    const MAX_LIVE_MELONS = 6;

    // Cooldown check
    if (d._shooterCd > 0) {
      return;
    }

    // Cap live melons
    let liveMelons = 0;
    for (const obj of this.arena.objects) {
      if (!obj.isDebris && !obj.broken && obj.key === 'explodingMelon') liveMelons++;
    }
    if (liveMelons >= MAX_LIVE_MELONS) {
      this.fx.hud.popup('RELOADING', d.getPosition(), 'small', 0xff6a3c);
      return;
    }

    // Set cooldown
    d._shooterCd = SHOOTER_CD;

    // Muzzle point: ~1.2m in front at chest height (yaw from dweeb's forward)
    const pos = d.getPosition();
    const f = d.forward;
    const muzzle = {
      x: pos.x + f.x * 1.2,
      y: pos.y + 0.8, // chest height
      z: pos.z + f.z * 1.2,
    };

    // Spawn the exploding melon
    const melon = this.arena.spawnItem('explodingMelon', muzzle);
    if (!melon) return;

    // Release from kinematic (like throwHeld does)
    this._releaseObject(melon);

    // Velocity: forward*(14 + charge*10) with upward y 6 + charge*4
    const horizSpeed = 14 + charge * 10;
    const upSpeed = 6 + charge * 4;
    const vel = {
      x: f.x * horizSpeed,
      y: upSpeed,
      z: f.z * horizSpeed,
    };
    melon.body.setLinvel(vel, true);

    // Set up exactly like a freshly thrown object (copy throwHeld)
    melon.thrownBy = d;
    melon.thrownTime = 2.2;
    melon.lastSpeed = Math.hypot(vel.x, vel.y, vel.z);
    melon.throwOrigin = { ...muzzle };
    melon.prevPos = null;
    melon.bounces = 0;
    melon.skips = 0;
    melon.banked = false;
    melon.jumpShot = !d.grounded;
    melon.superYeet = false;
    melon.hitList.clear();
    melon.hitList.add(d);

    // Small recoil impulse backwards
    const recoil = 2.5;
    const v = d.body.linvel();
    d.body.setLinvel({ x: v.x - f.x * recoil, y: v.y, z: v.z - f.z * recoil }, true);

    // FX: muzzle burst
    this.fx.particles.emit(muzzle, {
      count: 12,
      colors: [0x5ee06a, 0xffd23f, 0xffffff],
      speed: 5,
      up: 3,
      size: 0.12,
      life: 0.35,
      gravity: 0,
    });
    this.fx.particles.ring(muzzle, { color: 0x5ee06a, size: 2.5, life: 0.25 });

    // Popup 'THOOM!'
    this.fx.hud.popup('THOOM!', muzzle, 'small', 0x5ee06a);

    // Launch/whoosh sound
    this.fx.audio.playWhoosh(this.fx._pan(muzzle), 0.7);

    // Attack animation/cooldown for the shooter
    d.attackAnim = 0.22;
    d.attackCooldown = SHOOTER_CD;
    d.swingT = 0.3;
  }

  // ═══ New moves: parry, slam, drop-kick, gadgets ═══

  /** C: open the counter window. */
  startParry(d) {
    return d.startParry();
  }

  /** Air + S + LMB: dive feet-first. The landing is the attack. */
  groundSlam(d) {
    if (!d.canAct || d.grounded || d.held || d.attackCooldown > 0) return false;
    const A = BALANCE.air;
    d.slamActive = true;
    d.isCharging = false;
    d.charging = 0;
    const v = d.body.linvel();
    d.body.setLinvel({ x: v.x * 0.2, y: -A.slamSpeed, z: v.z * 0.2 }, true);
    d.attackCooldown = 0.6;
    d.attackAnim = 0.22;
    this.fx.slamStart?.(d);
    return true;
  }

  /** Air + LMB: a committed flying kick that bounces you off the victim. */
  airKick(d) {
    if (!d.canAct || d.grounded || d.held || d.attackCooldown > 0) return false;
    const A = BALANCE.air;
    const f = d.forward;
    d.dropkickTimer = A.dropkickTime;
    d.dropkickHit = false;
    d.dropkickDir = { x: f.x, z: f.z };
    const v = d.body.linvel();
    d.body.setLinvel({ x: f.x * A.dropkickSpeed, y: Math.max(v.y, -2), z: f.z * A.dropkickSpeed }, true);
    d.attackCooldown = 0.55;
    d.yaw = Math.atan2(f.x, f.z);
    this.fx.dropkick?.(d);
    if (d.isPlayer) this.fx.cam?.kickFov?.(8);
    return true;
  }

  /** LMB with a gadget in hand: freeze ray cone or a magnet yank. Reusable, with a cooldown. */
  useGadget(d, charge = 0) {
    const obj = d.held?.kind === 'object' ? d.held.ref : null;
    const kind = obj?.def?.gadget;
    if (!kind || d.attackCooldown > 0) return false;
    const G = BALANCE.gadgets[kind];
    const pos = d.getPosition();
    const f = d.forward;
    d.attackAnim = 0.22;
    d.attackCooldown = G.cooldown * (d.sugarTimer > 0 ? BALANCE.powerups.sugar.cooldown : 1);
    d.swingT = 0.3;

    if (kind === 'freezeRay') {
      const range = G.range * (0.85 + charge * 0.3);
      const cosCone = Math.cos(G.cone);
      let hit = false;
      for (const t of this.dweebs) {
        if (t === d || !t.active || t.grabbedBy) continue;
        const tp = t.getPosition();
        const dx = tp.x - pos.x, dz = tp.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > range || dist < 0.01) continue;
        if ((dx * f.x + dz * f.z) / dist < cosCone) continue;
        const launch = t.receiveHit({
          dir: { x: dx / dist, y: 0.2, z: dz / dist },
          damage: 1, base: 1.2, growth: 0, attacker: d, time: this.time,
          freeze: G.freeze, noParry: true,
        });
        if (launch > 0 || t.freezeTimer > 0) {
          hit = true;
          this.fx.freezeBeam?.(pos, tp, t);
          this.addStyle(d, G.style, 'FREEZE RAY');
        }
      }
      this.fx.gadget?.(d, 'freezeRay', hit);
      return true;
    }

    if (kind === 'extinguisher') {
      if (obj.charges == null) obj.charges = G.charges;
      const posAboveHead = { x: pos.x, y: pos.y + 1.7, z: pos.z };
      if (obj.charges <= 0) {
        this.fx.hud?.popup('PFFT...', pos, 'small', 0xd8d8d8);
        return true;
      }
      obj.charges--;

      // Recoil: blast backwards along the facing axis, with extra lift for rocket-jump recovery.
      const v = d.body.linvel();
      let rx = v.x - f.x * G.recoil, rz = v.z - f.z * G.recoil;
      const hSpeed = Math.hypot(rx, rz);
      if (hSpeed > G.maxSpeed) {
        const s = G.maxSpeed / hSpeed;
        rx *= s;
        rz *= s;
      }
      d.body.setLinvel({ x: rx, y: v.y + (d.grounded ? G.lift : G.airLift), z: rz }, true);

      // Foam cone: rivals in front get shoved away.
      const range = G.range * (0.85 + charge * 0.3);
      const cosCone = Math.cos(G.cone);
      let hit = false;
      for (const t of this.dweebs) {
        if (t === d || !t.active || t.grabbedBy) continue;
        const tp = t.getPosition();
        const dx = tp.x - pos.x, dz = tp.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > range || dist < 0.01) continue;
        if ((dx * f.x + dz * f.z) / dist < cosCone) continue;
        const launch = t.receiveHit({
          dir: { x: dx / dist, y: 0.2, z: dz / dist },
          damage: 2, base: 3, growth: 0.2, attacker: d, time: this.time,
          noParry: true,
        });
        if (launch > 0) {
          hit = true;
          this.addStyle(d, G.style, 'EXTINGUISHER');
        }
      }

      // Loose props near the nozzle get a light forward puff.
      const nozzle = { x: pos.x + f.x * 0.55, y: pos.y + 0.2, z: pos.z + f.z * 0.55 };
      const propRange = G.range * 0.55;
      for (const { obj: o, dist } of this.arena.getObjectsNear(nozzle, propRange)) {
        if (o === obj) continue;
        const falloff = 1 - dist / propRange;
        const m = Math.sqrt(o.body.mass());
        const imp = (2 + 3 * falloff) * m;
        this.physics.applyImpulse(o.body, { x: f.x * imp, y: imp * 0.25, z: f.z * imp });
      }

      this.fx.gadget?.(d, 'extinguisher', hit);
      this.fx.hud?.popup('WHOOSH!', posAboveHead, 'small', 0xffffff);
      return true;
    }

    if (kind === 'magnet') {
      const range = G.range * (0.85 + charge * 0.3);
      let pulled = 0;
      for (const t of this.dweebs) {
        if (t === d || !t.active || t.grabbedBy) continue;
        const tp = t.getPosition();
        const dx = pos.x - tp.x, dz = pos.z - tp.z;
        const dist = Math.hypot(dx, dz);
        if (dist > range || dist < 0.01) continue;
        const v = t.body.linvel();
        const k = 1 - dist / range;
        t.body.setLinvel({ x: v.x + (dx / dist) * G.pull * (0.4 + k), y: v.y + 2.2 * k, z: v.z + (dz / dist) * G.pull * (0.4 + k) }, true);
        this.fx.magnetPull?.(pos, tp);
        pulled++;
      }
      for (const { obj: o } of this.arena.getObjectsNear(pos, range)) {
        if (o === obj) continue;
        const op = o.getPosition();
        const dx = pos.x - op.x, dy = pos.y + 0.4 - op.y, dz = pos.z - op.z;
        const m = Math.sqrt(o.body.mass()) * 1.5;
        this.physics.applyImpulse(o.body, { x: dx * m * 0.5, y: dy * m * 0.5, z: dz * m * 0.5 });
        pulled++;
      }
      this.fx.gadget?.(d, 'magnet', pulled > 0);
      if (pulled) this.addStyle(d, G.style, 'MAGNET');
      return true;
    }

    if (kind === 'leafBlower') {
      // A gust, not a punch: no damage, just a lot of shoving. Charging widens and strengthens it.
      const power = 1 + charge * 0.6;
      const range = G.range * (0.9 + charge * 0.3);
      const cosCone = Math.cos(G.cone);
      let blown = 0;
      for (const t of this.dweebs) {
        if (t === d || !t.active || t.grabbedBy) continue;
        const tp = t.getPosition();
        const dx = tp.x - pos.x, dz = tp.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > range || dist < 0.01 || Math.abs(tp.y - pos.y) > 2.5) continue;
        if ((dx * f.x + dz * f.z) / dist < cosCone) continue;
        const k = (1 - dist / range) * 0.7 + 0.3;
        const v = t.body.linvel();
        t.body.setLinvel({
          x: v.x + f.x * G.push * k * power,
          y: Math.max(v.y, G.lift * k * power),
          z: v.z + f.z * G.push * k * power,
        }, true);
        t.lastHitBy = d; t.lastHitTime = this.time;   // a gust off the edge still credits the KO
        blown++;
      }
      for (const { obj: o } of this.arena.getObjectsNear(pos, range)) {
        if (o === obj || o.isGrabbed || !o.body) continue;
        const op = o.getPosition();
        const dx = op.x - pos.x, dz = op.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.01 || (dx * f.x + dz * f.z) / dist < cosCone) continue;
        const m = o.body.mass();
        const k = 1 - dist / range;
        this.physics.applyImpulse(o.body, { x: f.x * G.propPush * m * k * power, y: 1.2 * m * k, z: f.z * G.propPush * m * k * power });
        blown++;
      }
      // Recoil: the blower shoves its owner backwards; airborne, it also props you up a bit.
      const v = d.body.linvel();
      d.body.setLinvel({
        x: v.x - f.x * G.recoil,
        y: d.grounded ? v.y : Math.max(v.y, G.hover),
        z: v.z - f.z * G.recoil,
      }, true);
      this.fx.leafBlow?.(d, f, range, blown);
      if (blown) this.addStyle(d, G.style, 'GUST');
      return true;
    }

    if (kind === 'grappleGlove') {
      const range = G.range * (0.85 + charge * 0.3);
      const pos = d.getPosition();
      const f = d.forward;
      // Raycast from hand position (slightly in front and above)
      const origin = { x: pos.x + f.x * 1.0, y: pos.y + 1.1, z: pos.z + f.z * 1.0 }; // clear of the held glove
      // Aim slightly upward so the hook can catch ledges and walls above, not just the floor at your feet
      // Try a few pitches (up first, then level, then down) so the hook catches ledges, walls or the floor ahead
      let hit = null;
      for (const up of [0.34, 0.08, -0.3]) {
        const n = Math.hypot(1, up);
        hit = this.physics.raycast(origin, { x: f.x / n, y: up / n, z: f.z / n }, range, d.collider);
        if (hit && hit.distance > 2.2) break;
        hit = null;
      }
      if (!hit) {
        this.fx.gadget?.(d, 'grappleGlove', false);
        this.fx.whiff?.(d, 'grappleGlove');
        return false;
      }
      const anchor = hit.point;
      // Determine if hit is fixed geometry (stage/walls) or a dynamic target (dweeb/prop)
      const body = hit.collider?.parent?.();
      const hitDweeb = this.dweebs.some(t => t !== d && t.collider === hit.collider);
      const ref = hitDweeb ? null : (this.arena.objects || []).find(o => o.collider === hit.collider || (body && o.body === body));
      const hitObj = !!ref;
      const isFixed = !hitDweeb && !hitObj && (!body || body.isFixed());
      if (!hitDweeb && !hitObj && !isFixed) { this.fx.whiff?.(d, 'grappleGlove'); return false; }
      d.grapple = {
        anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
        isFixed,
        hitDweeb,
        hitObj: hitObj ? ref : null,
        timer: 0,
        maxTime: G.maxTime,
        detachDist: G.detachDist,
        spring: G.spring,
        maxSpeed: G.maxSpeed,
        yankSpeed: G.yankSpeed,
        yankUp: G.yankUp,
        hitstun: G.hitstun,
        holder: d,
      };
      // Visual: add cable line
      if (this.fx && this.fx.addGrappleCable) this.fx.addGrappleCable(d, anchor);
      // Audio: throw/zip sound
      if (this.fx && this.fx.audio?.playThrow) this.fx.audio.playThrow();
      else if (this.fx && this.fx.audio?.playWhoosh) this.fx.audio.playWhoosh();
      this.fx.gadget?.(d, 'grappleGlove', true);
      d.attackCooldown = G.cooldown * (d.sugarTimer > 0 ? BALANCE.powerups.sugar.cooldown : 1);
      d.attackAnim = 0.22;
      d.swingT = 0.3;
      this.addStyle(d, G.style, 'GRAPPLE');
      return true;
    }
    return false;
  }

  /** True when solid geometry (stage, walls, platforms) sits between two Dweebs. */
  _losBlocked(from, to, exclude, dist) {
    const dx = to.x - from.x, dy = to.y - (from.y + 0.35), dz = to.z - from.z;
    const d = dist ?? Math.hypot(dx, dy, dz);
    if (d < 0.3) return false;
    const groups = this.physics.makeGroups(CollisionGroups.ALL, CollisionGroups.GROUND | CollisionGroups.WALL);
    const hit = this.physics.raycast(
      { x: from.x, y: from.y + 0.35, z: from.z },
      { x: dx / d, y: dy / d, z: dz / d },
      d - 0.4, exclude, groups
    );
    return !!hit;
  }

  /** A ground-slam landing: radial shockwave, heavier than a dive. */
  _resolveSlam(d) {
    if (!d.slamActive) return;
    d.slamActive = false;
    const A = BALANCE.air;
    const pos = d.getPosition();
    const p = d.powerScale;
    let hit = false;
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy) continue;
      const tp = t.getPosition();
      const dx = tp.x - pos.x, dz = tp.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > A.slamRadius || tp.y < pos.y - A.slamDepth || tp.y > pos.y + 2) continue;
      const falloff = 1 - (dist / A.slamRadius) * 0.5;
      _dir.set(dx, 0.65, dz);
      if (_dir.lengthSq() < 1e-4) _dir.set(0, 1, 0);
      const atk = scaled({ ...A.slam }, p * falloff, p * falloff);
      const launch = t.receiveHit({ dir: _dir.normalize(), ...atk, attacker: d, time: this.time });
      if (launch > 0) {
        hit = true;
        this.fx.hit(t, d, launch, 'slam');
        this.addStyle(d, 5 + launch * 0.5 + dist * 0.4);
      }
    }
    // Debris and loose props get thrown out of the crater
    for (const { obj } of this.arena.getObjectsNear(pos, A.slamRadius)) {
      const op = obj.getPosition();
      _dir.set(op.x - pos.x, 0.8, op.z - pos.z).normalize();
      const m = Math.sqrt(obj.body.mass());
      this.physics.applyImpulse(obj.body, { x: _dir.x * 6 * m, y: 4 * m, z: _dir.z * 6 * m });
    }
    this.fx.slam?.(pos, d.color, hit, d.isPlayer);
    d.landSquash = 0.45;
  }

  /** Boing: a spring-loaded pogo landing — free height plus a toy "BOING!". */
  _signaturePogo(d, fall = 0) {
    if (!d?.active || d.signature?.id !== 'pogo') return;
    const pos = d.getPosition();
    this.fx.bounce?.({ x: pos.x, y: pos.y - 0.45, z: pos.z }, d.color);
    this.fx._toyWord?.('BOING!', pos, d.color, 'small');
    this.fx.cam?.shake?.(d.isPlayer ? 0.12 : 0.05);
    this.addStyle(d, 1 + Math.min(3, Math.max(0, fall) * 0.06));
  }

  /** Chonk: a hard landing sends a small radial shove (slam maths, turned down). */
  _signatureQuake(d, fall = 0) {
    if (!d?.active || d.signature?.id !== 'quake') return;
    const sig = d.signature;
    const A = BALANCE.air;
    const pos = d.getPosition();
    const p = d.powerScale;
    const radius = sig.radius ?? 2.8;
    const power = Math.min(1, Math.max(0, fall) / 20);
    let hit = false;

    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy) continue;
      const tp = t.getPosition();
      const dx = tp.x - pos.x, dz = tp.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius || tp.y < pos.y - A.slamDepth || tp.y > pos.y + 2) continue;
      const falloff = 1 - (dist / radius) * 0.5;
      _dir.set(dx, 0.55, dz);
      if (_dir.lengthSq() < 1e-4) _dir.set(0, 1, 0);
      const atk = scaled({ ...BALANCE.attacks.slam }, p * falloff * 0.4, p * falloff * 0.7);
      const launch = t.receiveHit({ dir: _dir.normalize(), ...atk, attacker: d, time: this.time });
      if (launch > 0) {
        hit = true;
        this.fx.hit(t, d, launch, 'slam');
        this.addStyle(d, 3 + launch * 0.3);
      }
    }
    for (const { obj } of this.arena.getObjectsNear(pos, radius)) {
      if (!obj?.body) continue;
      const op = obj.getPosition();
      _dir.set(op.x - pos.x, 0.6, op.z - pos.z);
      if (_dir.lengthSq() < 1e-4) _dir.set(0, 1, 0);
      _dir.normalize();
      const m = Math.sqrt(obj.body.mass());
      this.physics.applyImpulse(obj.body, { x: _dir.x * 4 * m, y: 2.5 * m, z: _dir.z * 4 * m });
    }

    this.fx.slam?.(pos, d.color, false, d.isPlayer);
    this.fx._toyWord?.('CHONK!', pos, d.color, 'big');
    this.fx.cam?.shake?.(d.isPlayer ? 0.22 + power * 0.2 : 0.08 + power * 0.1);
    this.addStyle(d, 2 + power * 3, hit ? 'CHONK QUAKE' : null);
    d.landSquash = Math.max(d.landSquash || 0, 0.42);
  }

  /** While a drop-kick is live, sweep a short arc in front of the kicker. */
  _checkDropkick(d) {
    if (d.dropkickTimer <= 0 || d.dropkickHit) return;
    const A = BALANCE.air;
    const pos = d.getPosition();
    const f = d.dropkickDir || d.forward;
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy) continue;
      const tp = t.getPosition();
      const dx = tp.x - pos.x, dz = tp.z - pos.z;
      if (Math.hypot(dx, dz) > A.dropkickRange + 0.5 || Math.abs(tp.y - pos.y) > 1.1) continue;
      if ((dx * f.x + dz * f.z) < 0 && Math.hypot(dx, dz) > 0.5) continue;
      _tmp.set(f.x, 0.45, f.z);
      const atk = scaled({ ...BALANCE.attacks.dropkick }, d.powerScale, d.powerScale);
      const launch = t.receiveHit({ dir: _tmp, ...atk, attacker: d, time: this.time });
      d.dropkickHit = true;
      this.fx.dropkickHit?.(d, t, launch);
      if (launch > 0) this.addStyle(d, 5 + launch * 0.45);
      // Kick off the victim: a little hop backward keeps you airborne for recovery
      d.body.setLinvel({ x: -f.x * A.dropkickBounce, y: 5.2, z: -f.z * A.dropkickBounce }, true);
      d.dropkickTimer = 0;
      return;
    }
  }

  /** Power-up gem: freeze everyone around you. */
  freezeBurst(d) {
    const P = BALANCE.powerups.freeze;
    const pos = d.getPosition();
    let n = 0;
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy) continue;
      const tp = t.getPosition();
      if (Math.hypot(tp.x - pos.x, tp.y - pos.y, tp.z - pos.z) > P.radius) continue;
      t.receiveHit({
        dir: { x: (tp.x - pos.x) * 0.1, y: 0.2, z: (tp.z - pos.z) * 0.1 },
        damage: 0, base: 0, growth: 0, attacker: d, time: this.time,
        freeze: P.duration, noParry: true,
      });
      n++;
    }
    this.fx.freezeBurst?.(d, P.radius, n);
    if (n) this.addStyle(d, 10, 'DEEP FREEZE');
  }

  /** Magnet gem / gadget pull, applied continuously while the gem timer runs. */
  _magnetPull(d, dt) {
    const P = BALANCE.powerups.magnet;
    const pos = d.getPosition();
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy) continue;
      const tp = t.getPosition();
      const dx = pos.x - tp.x, dy = pos.y + 0.3 - tp.y, dz = pos.z - tp.z;
      const dist = Math.hypot(dx, dz);
      if (dist > P.radius || dist < 0.02) continue;
      const k = 1 - dist / P.radius;
      const v = t.body.linvel();
      t.body.setLinvel({
        x: v.x + (dx / dist) * P.force * k * dt,
        y: v.y + (dy > 0 ? P.up : -P.up) * k * dt,
        z: v.z + (dz / dist) * P.force * k * dt,
      }, true);
    }
    for (const { obj } of this.arena.getObjectsNear(pos, P.radius)) {
      const op = obj.getPosition();
      const m = Math.sqrt(obj.body.mass()) * P.force * 0.05 * dt;
      this.physics.applyImpulse(obj.body, { x: (pos.x - op.x) * m, y: (pos.y + 0.4 - op.y) * m, z: (pos.z - op.z) * m });
    }
  }

  /** Grapple glove: spring toward fixed anchor, or yank dynamic target. */
  _updateGrapple(d, dt) {
    const g = d.grapple;
    if (!g || !g.holder || !g.holder.active) {
      this._detachGrapple(d);
      return;
    }
    const holder = g.holder;
    const pos = holder.getPosition();
    g.timer += dt;
    const anchor = g.anchor;
    const dx = anchor.x - pos.x, dy = anchor.y - pos.y, dz = anchor.z - pos.z;
    const dist = Math.hypot(dx, dy, dz);
    // Detach conditions
    if (g.timer >= g.maxTime || dist <= g.detachDist || holder.jumpRequested || holder.hitstun > 0 || holder.ragdolling || !holder.active) {
      this._detachGrapple(d);
      return;
    }
    // Update cable visual
    if (this.fx && this.fx.updateGrappleCable) this.fx.updateGrappleCable(d, anchor);
    if (g.isFixed) {
      // Spring toward anchor
      const dirLen = dist || 1;
      const dirX = dx / dirLen, dirY = dy / dirLen, dirZ = dz / dirLen;
      const v = holder.body.linvel();
      const towardX = dirX * g.spring * dt;
      const towardY = dirY * g.spring * dt;
      const towardZ = dirZ * g.spring * dt;
      // Cap the added velocity toward anchor
      const curToward = v.x * dirX + v.y * dirY + v.z * dirZ;
      const addSpeed = Math.min(g.maxSpeed - curToward, Math.hypot(towardX, towardY, towardZ));
      if (addSpeed > 0) {
        const addX = dirX * addSpeed, addY = dirY * addSpeed, addZ = dirZ * addSpeed;
        holder.body.setLinvel({ x: v.x + addX, y: v.y + addY, z: v.z + addZ }, true);
      }
      // Never plummet while reeling in
      const nv = holder.body.linvel();
      if (nv.y < -5) holder.body.setLinvel({ x: nv.x, y: -5, z: nv.z }, true);
    } else {
      // Yank dynamic target (dweeb or prop) toward holder - use stored reference
      if (g.hitDweeb) {
        // Find the dweeb that was hit (could have moved)
        for (const t of this.dweebs) {
          if (t === holder || !t.active) continue;
          const tp = t.getPosition();
          const tdx = tp.x - anchor.x, tdy = tp.y - anchor.y, tdz = tp.z - anchor.z;
          if (Math.hypot(tdx, tdy, tdz) < 1.5) {
            // Yank dweeb toward holder
            const hpos = holder.getPosition();
            const tpos = t.getPosition();
            const tdx2 = hpos.x - tpos.x, tdy2 = hpos.y - tpos.y, tdz2 = hpos.z - tpos.z;
            const tdist = Math.hypot(tdx2, tdy2, tdz2) || 1;
            if (t.invulnTimer > 0 || t.bubble) break;
            t.body.setLinvel({ x: (tdx2 / tdist) * g.yankSpeed, y: g.yankUp, z: (tdz2 / tdist) * g.yankSpeed }, true);
            t.hitstun = Math.max(t.hitstun || 0, g.hitstun);
            t.lastHitBy = holder; t.lastHitTime = this.time;
            this.fx.hud?.popup?.('YOINK!', tpos, 'small', 0xffd23f);
            break;
          }
        }
      } else if (g.hitObj && g.hitObj.body) {
        // Yank object toward holder
        const m = Math.sqrt(g.hitObj.body.mass()) * 2;
        const hpos = holder.getPosition();
        const opos = g.hitObj.getPosition();
        const odx = hpos.x - opos.x, ody = hpos.y + 0.5 - opos.y, odz = hpos.z - opos.z;
        const odist = Math.hypot(odx, ody, odz) || 1;
        this.physics.applyImpulse(g.hitObj.body, { x: (odx / odist) * m * 12, y: (ody / odist) * m * 12, z: (odz / odist) * m * 12 });
      }
      this._detachGrapple(d);
    }
  }

  _detachGrapple(d) {
    if (d.grapple) {
      if (this.fx && this.fx.removeGrappleCable) this.fx.removeGrappleCable(d);
      d.grapple = null;
    }
  }

  // ═══ Existing actions ═══

  /** Grab the nearest thing in front, or throw what you're holding. */
  grabOrThrow(d, charge = 0) {
    if (d.held) return this.throwHeld(d, charge);
    return this.grab(d);
  }

  grab(d) {
    if (!d.canAct || d.held || d.attackCooldown > 0.1) return false;
    // Grab exactly what the focus ring is showing. No vacuuming props from behind you.
    const focus = this.focusTarget(d);
    if (!focus) {
      // Nothing to grab, but a thrown prop just missed the catch window: let the player know.
      const near = this._nearMissCatch(d);
      if (near) this._denyCatch(d, near);
      return false;
    }
    if (focus.kind === 'catch') return this._catchProjectile(d, focus.ref);
    if (focus.kind === 'dweeb') {
      const best = focus.ref;
      if (best.bubble) { // bubbles are slippery!
        best.bubble = false;
        this.fx.bubblePop(best);
        return false;
      }
      d.held = { kind: 'dweeb', ref: best };
      best.setGrabbed(d);
      d.attackCooldown = 0.25;
      // Air grab refreshes one air jump: a risky catch becomes a recovery route.
      if (!d.grounded) d.jumpsLeft = Math.max(d.jumpsLeft, 1);
      this.fx.grab(d, best);
      return true;
    }
    this._holdObject(d, focus.ref);
    this.fx.grab(d, null);
    return true;
  }

  /** A thrown prop flying toward `d`, close enough to pluck out of the air. */
  _catchTarget(d) {
    if (!d || d.held || !this.arena?.objects) return null;
    const pos = d.getPosition();
    let best = null, bestScore = Infinity;
    for (const obj of this.arena.objects) {
      if (!obj || obj.broken || obj.isDebris || obj.isGrabbed || !obj.body) continue;
      if (!obj.def?.grabbable || obj.def?.throwable === false || !(obj.thrownTime > 0)) continue;
      // Fused explosives are hot potato material, not a catch: let them pop normally.
      if (obj.def.explosive && obj.fuse > 0) continue;
      const op = obj.getPosition();
      const dx = pos.x - op.x, dy = pos.y - op.y, dz = pos.z - op.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > CATCH.radius || dist < 1e-3) continue;
      const v = obj.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < CATCH.minSpeed) continue;
      // Only catch props actually heading at us, not ones sailing past.
      const dot = (v.x * dx + v.y * dy + v.z * dz) / (speed * dist);
      if (dot < CATCH.approach) continue;
      const score = dist + (1 - dot) * 0.7;
      if (score < bestScore) { bestScore = score; best = { kind: 'catch', ref: obj, dist, dot }; }
    }
    return best;
  }

  /** Nearest in-flight prop for a failed grab (the "DENIED!" near-miss feedback). */
  _nearMissCatch(d) {
    if (!d || !this.arena?.objects) return null;
    const pos = d.getPosition();
    let best = null, bestDist = CATCH.nearRadius;
    for (const obj of this.arena.objects) {
      if (!obj || obj.broken || obj.isDebris || obj.isGrabbed || !obj.body) continue;
      if (!obj.def?.grabbable || obj.def?.throwable === false || !(obj.thrownTime > 0)) continue;
      if (obj.def.explosive && obj.fuse > 0) continue;
      const op = obj.getPosition();
      const dist = Math.hypot(op.x - pos.x, op.y - pos.y, op.z - pos.z);
      if (dist < bestDist) { bestDist = dist; best = obj; }
    }
    return best;
  }

  _catchProjectile(d, obj) {
    if (!d || !obj || !obj.body) return false;
    if (!obj.hitList) obj.hitList = new Set();
    // Mark ourselves immune to this throw before it becomes kinematic in our hands.
    obj.hitList.add(d);
    this._holdObject(d, obj);
    d.catchWindow = 0.55;
    d.catchFlash = 0.3;
    this.addStyle(d, 5, 'CAUGHT!');
    this.fx.catchProp?.(d, obj);
    return true;
  }

  _denyCatch(d, obj) {
    if (!d) return;
    d.catchFlash = 0.12;
    this.fx.catchDenied?.(d, obj);
  }

  _holdObject(d, obj) {
    // If grabbing a hoverboard with a rider, dismount them first
    if (obj.def?.rideable && obj.rider) {
      this._dismount(obj.rider, obj);
    }
    d.held = { kind: 'object', ref: obj };
    d.carryHeldT = 0;
    obj.grab(d);
    // Heft: heavy props take a beat to settle and slow your walk; featherweights are instant
    const C = BALANCE.carry, mass = obj.def.mass ?? 1;
    const over = mass - C.heavyFrom;
    d.grabSettle = over >= 0 ? Math.min(C.settleMax, C.settleBase + over * C.settlePerMass) : 0;
    d.carryMul = over > 0 ? Math.max(C.slowMin, 1 - over * C.slowPerMass) : 1;
    d.pendingThrow = null;
    if (d.grabSettle > 0) { d.attackCooldown = Math.max(d.attackCooldown, d.grabSettle); d.landSquash = 0.25 + d.grabSettle; }
    else if (mass < C.lightBelow) d.attackCooldown = Math.min(d.attackCooldown, C.lightCooldown);
    if (obj.fuse > 0) obj.fuseBy = d; // hot potato: the last one to touch it owns the boom
    obj.thrownBy = null;
    obj.thrownTime = 0;
    obj.body.setBodyType(this.physics.RAPIER.RigidBodyType.KinematicPositionBased, true);
    obj.collider.setCollisionGroups(this.physics.makeGroups(CollisionGroups.OBJECT, CollisionGroups.ALL & ~CollisionGroups.PLAYER));
  }

  _releaseObject(obj) {
    obj.release();
    obj.body.setBodyType(this.physics.RAPIER.RigidBodyType.Dynamic, true);
    obj.collider.setCollisionGroups(this.physics.makeGroups(CollisionGroups.OBJECT, CollisionGroups.ALL));
  }

  throwHeld(d, charge = 0) {
    if (!d.held) return false;
    // Still hefting something heavy into your arms: the throw goes out the moment it settles
    if (d.grabSettle > 0 && d.held.kind === 'object') { d.pendingThrow = charge; return true; }
    d.pendingThrow = null;
    if (d.held.kind === 'dweeb') {
      if (d.isPlayer && Number.isFinite(d.lookYaw)) d.yaw = d.lookYaw;
      else this._autoAim(d, 12);
    }
    const f = d.forward;
    const held = d.held;
    d.held = null;
    d.attackAnim = 0.22;
    d.attackCooldown = 0.35;
    const pos = d.getPosition();
    const p = d.powerScale;
    const yeet = charge > 0 && this._useSuper(d);

    if (held.kind === 'dweeb') {
      const t = held.ref;
      t.setGrabbed(null);
      // Letting go mid Giant Swing: the spin pays out as extra fling
      const gs = d.giantSwing;
      d.giantSwing = null;
      const swingK = gs ? Math.min(1, gs.spin / GIANT_SWING.maxRate) : 0;
      t.body.setTranslation({ x: pos.x + f.x * 0.9, y: pos.y + 0.9, z: pos.z + f.z * 0.9 }, true);
      _tmp.set(f.x, 0.55 - swingK * 0.15, f.z);
      const sm = 1 + swingK * GIANT_SWING.flingBonus;
      if (swingK > 0.3) this.fx._toyWord?.(swingK > 0.8 ? 'HAMMER THROW!' : 'SPIN FLING!', pos, 0xffd23f, swingK > 0.8 ? 'big' : 'small');
      const atk = scaled(A.dweebThrow(charge), p * (yeet ? SUPER : 1) * sm, p * (yeet ? SUPER : 1) * sm);
      if (t.team != null && t.team === d.team) {
        // Team Battle: chucking a teammate is a free, damage-less TEAM LAUNCH across the stage.
        const s = 11 + charge * 6;
        t.body.setLinvel({ x: f.x * s, y: 8 + charge * 3, z: f.z * s }, true);
        t.invulnTimer = Math.max(t.invulnTimer, 0.5);
        this.fx.teamLaunch?.(t, d);
        this.fx.throw(d);
        return true;
      }
      const launch = t.receiveHit({ dir: _tmp, ...atk, attacker: d, time: this.time });
      t.invulnTimer = 0;
      if (launch > 0) {
        this.fx.hit(t, d, launch, 'throw');
        if (yeet) this.fx.superYeet(t, d);
        this.addStyle(d, 6 + launch * 0.4);
        // The flying Dweeb is now a short-lived bowling projectile (see _updateThrownDweebs)
        const bowling = BALANCE.dweebThrow?.bowling;
        if (bowling) {
          t.thrownBy = d;
          t.thrownTimer = bowling.life;
          t.bowlingHits = new Set([d, t]);
        }
      }
      this.fx.throw(d);
      return true;
    }

    const obj = held.ref;
    // If throwing a hoverboard with a rider, dismount them first
    if (obj.def?.rideable && obj.rider) {
      this._dismount(obj.rider, obj);
    }
    // Player aim comes from the camera (+ gentle assist); bots solve the arc with a difficulty-based wobble
    const aim = d.isPlayer ? this.assistAim(d, obj, charge, d.yaw, d.aimLoft ?? DEFAULT_LOFT) : this._botAim(d, obj, charge);
    d.yaw = aim.yaw;
    const L = this.launch(d, obj, charge, aim.yaw, aim.loft);
    this._releaseObject(obj);
    // Light things fly fast and spin wildly; heavy things are slow lobs that hit like trucks
    const mass = obj.def.mass ?? 1;
    const spin = 10 / Math.sqrt(Math.max(mass, 0.5));
    const fw = d.forward;
    obj.body.setTranslation(L.origin, true);
    // A load mid-swing whips out a little harder in the direction it was already going.
    const sw = held.sway;
    obj.body.setLinvel(sw ? { x: L.vel.x + sw.vx * 0.6, y: L.vel.y, z: L.vel.z + sw.vz * 0.6 } : L.vel, true);
    obj.body.setAngvel({ x: fw.z * spin, y: (Math.random() - 0.5) * spin * 0.7, z: -fw.x * spin }, true);
    obj.thrownBy = d;
    obj.thrownTime = obj.def.roll ? 3 : 2.2;
    obj.boomT = 0; obj.boomReturning = false;
    if (obj.def.boomerang) obj.thrownTime = obj.def.boomerang.maxTime + 0.4;
    obj.lastSpeed = L.speed;
    obj.throwOrigin = { ...L.origin };
    obj.prevPos = null;
    obj.bounces = 0;
    obj.skips = 0;
    obj.banked = false;
    obj.jumpShot = !d.grounded;
    obj.superYeet = yeet;
    obj.hitList.clear();
    obj.hitList.add(d);
    this.fx.throw(d, mass);
    if (mass >= BALANCE.carry.heavyThrowFrom) this.fx.heavyThrow?.(d, obj, mass);
    if (L.dir) {
      // Toy rocket: ignites and flies dead straight until it hits something or burns out
      obj.rocket = { dir: L.dir, fuel: L.fuel };
      obj.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      obj.thrownTime = 3;
      this.fx.rocketLaunch(obj);
    }
    return true;
  }

  drop(d) {
    if (!d.held) return;
    const held = d.held;
    d.held = null;
    d.giantSwing = null;
    if (held.kind === 'dweeb') {
      held.ref.setGrabbed(null);
      held.ref.invulnTimer = 0.3;
    } else {
      // Set it down, don't fling it: place the prop just ahead at hand height and let its swing carry.
      const obj = held.ref, p = d.getPosition(), f = d.forward, sw = held.sway;
      this._releaseObject(obj);
      if (d.active && !d.ragdolling && d.hitstun <= 0) {
        const hy = obj.def.dims?.hy ?? obj.def.dims?.radius ?? obj.def.dims?.halfHeight ?? 0.3;
        obj.body.setTranslation({ x: p.x + f.x * (0.9 + hy), y: p.y + 0.2 + hy, z: p.z + f.z * (0.9 + hy) }, true);
        obj.body.setLinvel({ x: (sw?.vx ?? 0) * 0.5, y: 0.3, z: (sw?.vz ?? 0) * 0.5 }, true);
        obj.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        // Knocked out of your hands: it keeps whatever swing it had.
        obj.body.setLinvel({ x: (sw?.vx ?? 0) * 1.5, y: 1.5, z: (sw?.vz ?? 0) * 1.5 }, true);
      }
    }
  }

  /** Grounded dive tackle. (In the air, Shift is an air-dodge instead.) */
  dive(d) {
    if (!d.canAct || d.diveCooldown > 0 || d.held || !(d.grounded || d.coyote > 0)) return false;
    const f = d.forward;
    const speed = d.zoomTimer > 0 ? 17 : 13;
    d.body.setLinvel({ x: f.x * speed, y: 4, z: f.z * speed }, true);
    d.diveTimer = 0.45;
    d.diveCooldown = 1.1 * d.stats.diveCd;
    d.diveHit = false;
    this.fx.dive(d);
    return true;
  }

  /** Air-dodge: a short directional burst with i-frames, then special fall (drift only) until you land or grab a ledge. */
  airDodge(d, dx = 0, dz = 0, up = false) {
    if (!d.canAct || d.grounded || d.airDodgeCd > 0 || d.specialFall) return false;
    const AD = BALANCE.airDodge;
    const h = Math.hypot(dx, dz);
    if (h > 0.1) _tmp.set(dx / h, up ? 0.8 : 0.35, dz / h);
    else _tmp.set(0, 1, 0);
    _tmp.normalize().multiplyScalar(AD.speed);
    d.body.setLinvel({ x: _tmp.x, y: _tmp.y, z: _tmp.z }, true);
    const sig = d.signature;
    const freePhase = sig?.id === 'phase' && !d.ghostDodgeUsed;
    d.airDodgeTimer = AD.duration;
    d.airDodgeCd = freePhase ? 0 : AD.cooldown;
    d.invulnTimer = Math.max(d.invulnTimer, AD.invuln + (freePhase ? (sig.invuln ?? 0.1) : 0));
    d.isCharging = false;
    d.charging = 0;
    if (h > 0.1) d.yaw = Math.atan2(dx, dz);
    if (freePhase) {
      d.ghostDodgeUsed = true;
      this.fx._toyWord?.('PHASE!', d.getPosition(), d.color, 'small');
      this.fx.cam?.shake?.(0.1);
      this.addStyle(d, 2, 'PHASE DODGE');
    }
    this.fx.airDodge(d);
    return true;
  }

  /** Shift: dive on the ground, air-dodge in the air, tech while tumbling. */
  dodgeOrDive(d, dx, dz, up) {
    if (d.ragdolling || d.hitstun > 0) { d.requestTech(); return false; }
    if (d.grounded || d.coyote > 0) return this.dive(d);
    return this.airDodge(d, dx, dz, up);
  }

  // ═══ Style meter ═══

  /** Score style for `d`; optional label feeds the kill feed ("STYLE x3 · BANK SHOT"). */
  addStyle(d, pts, label = null) {
    if (!d || !d.active) return;
    d.styleScore = Math.min(STYLE.max, d.styleScore + pts);
    d.styleTimer = STYLE.hold;
    d.styleCombo = (d.styleCombo || 0) + 1;
    d.stylePeak = Math.max(d.stylePeak, d.styleScore);
    this._styleTier(d);
    if (label) this.fx.styleFeed?.(d, label);
  }

  _styleTier(d) {
    let tier = 0;
    for (let i = STYLE.tiers.length - 1; i >= 0; i--) if (d.styleScore >= STYLE.tiers[i]) { tier = i; break; }
    if (tier > d.styleTier) this.fx.styleTier?.(d, tier);
    d.styleTier = tier;
    const ready = d.styleScore >= STYLE.max;
    if (ready && !d.superReady) this.fx.superReady?.(d);
    d.superReady = ready;
  }

  /**
   * Super-smash meter: a punch landed within streakWindow of the last one continues the
   * streak, and every level past the first banks streakBonus style. At full meter the
   * dweeb's next charged smash / throw is the Super Yeet (see armSuper) — the ultimate.
   * @returns {number} bonus style banked for this punch
   */
  _punchStreak(d) {
    const S = STYLE;
    if (this.time - (d.punchStreakT ?? -99) <= S.streakWindow) {
      d.punchStreak = Math.min(S.streakCap, (d.punchStreak || 0) + 1);
    } else {
      d.punchStreak = 1;
      d.signaturePunchCount = 0;
    }
    d.punchStreakT = this.time;
    return S.streakBonus * (d.punchStreak - 1);
  }

  /** Boxer: true when this swing would be the third consecutive landed punch. */
  _uppercutReady(d) {
    const sig = d.signature;
    if (!sig || sig.id !== 'uppercut') return false;
    const every = Math.max(2, sig.every || 3);
    const active = this.time - (d.punchStreakT ?? -99) <= STYLE.streakWindow;
    const count = active ? (d.signaturePunchCount || 0) : 0;
    return (count + 1) % every === 0;
  }

  /** F / middle mouse: cash the full meter in — the next charged smash or throw is a Super Yeet. */
  armSuper(d) {
    if (!d.active || !d.superReady || d.superArmed) return false;
    d.superArmed = true;
    d.styleScore = 0;
    d.styleTier = 0;
    d.superReady = false;
    this.fx.superArm?.(d);
    return true;
  }

  _useSuper(d) {
    if (!d.superArmed) return false;
    d.superArmed = false;
    return true;
  }

  _updateStyle(d, dt) {
    if (d.styleTimer > 0) d.styleTimer -= dt;
    else if (d.styleScore > 0 && !d.superReady) {
      d.styleScore = Math.max(0, d.styleScore - STYLE.drain * dt);
      d.styleCombo = 0;
      let tier = 0;
      for (let i = STYLE.tiers.length - 1; i >= 0; i--) if (d.styleScore >= STYLE.tiers[i]) { tier = i; break; }
      d.styleTier = tier;
    }
    // Bots cash in as soon as they can
    if (!d.isPlayer && d.superReady) this.armSuper(d);
  }

  // ═══ Ledges ═══

  /** Falling past the stage lip close enough → cling to it. */
  _checkLedge(d) {
    if (d.ledge || d.ledgeCd > 0 || d.grounded || d.held?.kind === 'dweeb' || d.grabbedBy) return;
    if (d.hitstun > 0 || d.ragdolling || d.diveTimer > 0 || d.airDodgeTimer > 0) return;
    const v = d.velocity;
    if (v.y > 0.5) return;
    const p = d.getPosition();
    const L = BALANCE.ledge;
    if (p.y > 0.2 || p.y < -L.height) return;
    const r = Math.hypot(p.x, p.z);
    const edge = this.arena.edgeRadius(p.x, p.z);
    if (r < edge - 0.1 || r > edge + L.reach) return;
    if (this.arena.isOverGround(p.x, p.z)) return;
    // Cling just outside the lip, head level with the floor
    const k = (edge + 0.38) / (r || 1);
    d.catchLedge(p.x * k, -0.45, p.z * k);
    this.fx.ledge?.(d);
  }

  // ═══ Explosive fuses ═══

  /** Punched explosives don't pop instantly — they hiss for a beat (credit to whoever lit it). */
  lightFuse(obj, by, t = 0.8) {
    if (obj.fuse > 0 || obj.broken) return;
    obj.fuse = t;
    obj.fuseBy = by;
    obj.thrownBy = by;
    (this.fuses ??= []).push(obj);
    this.fx.fuse?.(obj);
  }

  _updateFuses(dt) {
    if (!this.fuses?.length) return;
    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const obj = this.fuses[i];
      if (obj.broken || !obj.body) { this.fuses.splice(i, 1); continue; }
      obj.fuse -= dt;
      obj.flash = (obj.flash || 0) + dt;
      // Long fuses (hot potato) sputter sparks, faster as they burn down
      if (obj.flash > (obj.fuse < 2 ? 0.08 : 0.2)) { obj.flash = 0; this.fx.fuseSpark?.(obj, obj.fuse); }
      if (obj.fuse <= 0) {
        this.fuses.splice(i, 1);
        this.explode(obj.getPosition(), obj.fuseBy ?? obj.thrownBy, obj);
      }
    }
  }

  // ═══ Throw aim ═══

  /** Where a throw leaves the hand and how fast. Shared by throwHeld and the aim guide, so the arc never lies. */
  launch(d, obj, charge, yaw, loft) {
    const pos = d.getPosition();
    const heft = THREE.MathUtils.clamp(1.3 - 0.15 * (obj.def.mass ?? 1), 0.55, 1.3);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const origin = { x: pos.x + fx, y: pos.y + 0.9, z: pos.z + fz };
    if (obj.def.rocket) {
      const el = THREE.MathUtils.clamp((loft - DEFAULT_LOFT) * 0.8 - 0.06, -0.4, 0.7); // neutral aim ≈ level at head height
      const dir = new THREE.Vector3(fx * Math.cos(el), Math.sin(el), fz * Math.cos(el));
      return { origin, speed: ROCKET_SPEED, lift: 0, dir, fuel: 1.2 + charge * 0.5, vel: dir.clone().multiplyScalar(ROCKET_SPEED) };
    }
    const speed = (15 + charge * 13) * heft * (d.megaTimer > 0 ? 1.25 : 1);
    // Momentum carry: a throw from a sprint starts faster than a throw from standing still.
    // predictThrow runs through this same function, so the previewed arc stays honest.
    const cvx = (d.velocity?.x ?? 0) * 0.45, cvz = (d.velocity?.z ?? 0) * 0.45;
    if (obj.def.roll) {
      // Bowled: released at ankle height, skimming flat along the floor
      origin.y = pos.y - 0.2;
      loft = THREE.MathUtils.clamp(loft - DEFAULT_LOFT, -0.1, 0.12);
      const h = speed * Math.cos(loft);
      return { origin, speed, lift: 0, vel: new THREE.Vector3(fx * h + cvx, speed * Math.sin(loft), fz * h + cvz) };
    }
    const lift = (1.3 - heft) * 4; // heavy things get lobbed
    const h = speed * Math.cos(loft);
    return { origin, speed, lift, vel: new THREE.Vector3(fx * h + cvx, speed * Math.sin(loft) + lift, fz * h + cvz) };
  }

  /**
   * Fly a throw forward in time and report where it lands (raycast against the world) and which rival it
   * will pass closest to, using their current velocity as a lead. `points` (optional) receives the path.
   */
  predictThrow(d, obj, charge, yaw, loft, points = null) {
    const L = this.launch(d, obj, charge, yaw, loft);
    const p = _p.set(L.origin.x, L.origin.y, L.origin.z);
    const v = _pv.copy(L.vel);
    const damp = Math.exp(-ITEM_DAMP * PREDICT_STEP);
    const groups = this.physics.makeGroups(CollisionGroups.ALL, CollisionGroups.ALL & ~CollisionGroups.PLAYER);
    let fuel = L.fuel ?? 0, t = 0, n = 0, land = null, target = null, targetTime = 0, best = Infinity, banks = 0;

    const foes = [];
    for (const o of this.dweebs) {
      if (o === d || !o.active || o.grabbedBy) continue;
      foes.push({ o, p: o.getPosition(), v: o.velocity });
    }

    while (t < 2.6 && p.y > -6) {
      if (points) (points[n] ??= new THREE.Vector3()).copy(p);
      n++;
      if (fuel > 0) fuel -= PREDICT_STEP;
      else { v.y -= G * PREDICT_STEP; v.multiplyScalar(damp); }
      _seg.copy(v).multiplyScalar(PREDICT_STEP);
      const len = _seg.length();
      const hit = this.physics.raycast(p, _seg.divideScalar(len), len, obj.collider, groups);
      if (hit) {
        p.set(hit.point.x, hit.point.y, hit.point.z);
        t += PREDICT_STEP * (hit.distance / len);
        // Bumpers and trampolines bank the shot — show where it goes next
        const b = banks < 2 && fuel <= 0 && this.arena.bumperByHandle(hit.collider.handle);
        const tr = banks < 2 && fuel <= 0 && !b && v.y <= 1 && this.arena.trampolineByHandle(hit.collider.handle);
        if (b) {
          const nv = bumperBounce(v, p.x - b.x, p.z - b.z);
          v.set(nv.x, nv.y, nv.z);
          p.addScaledVector(_seg, -0.05);
          banks++;
        } else if (tr) {
          v.y = TRAMPOLINE_ITEM_VEL;
          v.x *= BALANCE.bounce.trampolineKeepH;
          v.z *= BALANCE.bounce.trampolineKeepH;
          p.y += 0.05;
          banks++;
        } else land = hit;
      } else {
        p.addScaledVector(_seg, len);
        t += PREDICT_STEP;
      }
      // Closest pass to each rival's lead position (horizontal lead, capped so dashes don't fool it)
      for (const f of foes) {
        const lead = Math.min(1, 4 / (Math.hypot(f.v.x, f.v.z) * t || 1));
        const dx = p.x - (f.p.x + f.v.x * t * lead), dz = p.z - (f.p.z + f.v.z * t * lead), dy = p.y - f.p.y;
        const dist = Math.hypot(dx, dy, dz);
        const reach = Math.hypot(f.p.x - L.origin.x, f.p.z - L.origin.z);
        const tol = Math.min(2, 1.1 + reach * 0.035);
        if (dist < tol && dist / tol < best) { best = dist / tol; target = f.o; targetTime = t; }
      }
      if (land) break;
    }
    if (points) {
      (points[n] ??= new THREE.Vector3()).copy(p);
      n++;
    }
    return { n, land, end: p.clone(), time: t, target, targetTime, banks, launch: L };
  }

  /**
   * Aim assist that rewards aiming: only kicks in when your arc already passes near a rival,
   * then re-solves yaw/loft so it connects with their lead position.
   */
  assistAim(d, obj, charge, yaw, loft) {
    const pr = this.predictThrow(d, obj, charge, yaw, loft);
    if (!pr.target) return { yaw, loft, target: null };
    const s = this._solveAim(d, obj, charge, pr.target, pr.targetTime, loft);
    if (!s || Math.abs(angleDiff(s.yaw, yaw)) > 0.35 || Math.abs(s.loft - loft) > 0.35) return { yaw, loft, target: null };
    return { ...s, target: pr.target };
  }

  /** Yaw + loft that hit `t` where it'll be (iterates flight time ↔ lead). Picks the arc closest to `prefLoft`. */
  _solveAim(d, obj, charge, t, time, prefLoft) {
    const pos = d.getPosition();
    const tp = t.getPosition(), tv = t.velocity;
    let yaw = d.yaw, loft = prefLoft, T = time;
    for (let iter = 0; iter < 3; iter++) {
      const lead = Math.min(1, 4 / (Math.hypot(tv.x, tv.z) * T || 1));
      const gx = tp.x + tv.x * T * lead, gz = tp.z + tv.z * T * lead, gy = tp.y + 0.1;
      yaw = Math.atan2(gx - pos.x, gz - pos.z);
      const L = this.launch(d, obj, charge, yaw, loft);
      const X = Math.hypot(gx - L.origin.x, gz - L.origin.z), H = gy - L.origin.y;
      if (L.dir) {
        loft = THREE.MathUtils.clamp((Math.atan2(H, X) + 0.06) / 0.8 + DEFAULT_LOFT, -0.3, 1.0);
        T = Math.hypot(X, H) / ROCKET_SPEED;
        continue;
      }
      // Scan elevations: height reached at distance X, keep the crossing nearest the preferred loft
      let found = null, prev = null;
      for (let l = -0.6; l <= 1.25; l += 0.01) {
        const vh = L.speed * Math.cos(l);
        const tt = X / vh;
        const y = (L.speed * Math.sin(l) + L.lift) * tt - 0.5 * G * tt * tt - H;
        if (prev && Math.sign(y) !== Math.sign(prev.y)) {
          const cross = prev.l + (l - prev.l) * (prev.y / (prev.y - y));
          if (!found || Math.abs(cross - prefLoft) < Math.abs(found.l - prefLoft)) found = { l: cross, t: tt };
        }
        prev = { l, y };
      }
      if (!found) return null;
      loft = found.l;
      T = found.t;
    }
    return { yaw, loft };
  }

  /** Bots: face the best target and solve the arc, then wobble it by their aim skill. */
  _botAim(d, obj, charge) {
    const t = this._autoAim(d, 22);
    const err = d.aimError ?? 0.15;
    let yaw = d.yaw, loft = DEFAULT_LOFT;
    if (t) {
      const tp = t.getPosition(), pos = d.getPosition();
      const s = this._solveAim(d, obj, charge, t, Math.hypot(tp.x - pos.x, tp.z - pos.z) / 16, DEFAULT_LOFT);
      if (s) ({ yaw, loft } = s);
    }
    return { yaw: yaw + (Math.random() - 0.5) * err, loft: loft + (Math.random() - 0.5) * err * 0.8 };
  }

  /** Current attack footprint, shared by the swing, HUD and the charge preview. */
  attackProfile(d) {
    const weapon = d.held?.kind === 'object' && d.held.ref.isWeapon;
    const wdef = weapon ? WEAPONS[d.held.ref.def.weapon] ?? WEAPONS.hammer : null;
    const range = (weapon ? wdef.range : 1.55) * (d.megaTimer > 0 ? 1.3 : 1);
    return {
      weapon, wdef, range,
      cone: weapon ? wdef.cone : 0.6,
      multi: !!wdef?.multi,
    };
  }

  /** Where the player is aiming: camera yaw for a human, body yaw for bots. */
  aimYawOf(d) {
    return Number.isFinite(d.lookYaw) ? d.lookYaw : d.yaw;
  }

  /** Nearest aligned target outside grab range, used to preview a swing. */
  attackTarget(d) {
    const profile = this.attackProfile(d);
    const pos = d.getPosition();
    const yaw = this.aimYawOf(d);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bestScore = Infinity;
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy === d || t.invulnTimer > 0) continue;
      const tp = t.getPosition();
      const dx = tp.x - pos.x, dz = tp.z - pos.z, dy = tp.y - pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist > profile.range || Math.abs(dy) > 1.6) continue;
      const dot = dist > 0.001 ? (dx * fx + dz * fz) / dist : 1;
      if (dot < profile.cone && dist > 0.6) continue;
      if (this._losBlocked(pos, tp, d.collider, dist)) continue;
      const score = dist + (1 - dot) * 1.2;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  /**
   * The single thing E will grab: a rival or grabbable prop near your aim ray.
   * The ring, the prompt and the actual pickup all use this one answer.
   */
  focusTarget(d) {
    if (!d.canAct || d.held) return null;
    // A catchable projectile outranks any normal grab: the prompt reads CATCH! instead of PICK UP.
    const catchable = this._catchTarget(d);
    if (catchable) return catchable;
    const pos = d.getPosition();
    const yaw = this.aimYawOf(d);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bestScore = Infinity;

    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy || t.held?.ref === d || t.invulnTimer > 0) continue;
      const tp = t.getPosition();
      const dx = tp.x - pos.x, dz = tp.z - pos.z, dy = tp.y - pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.65 || Math.abs(dy) > 1.2) continue;
      const dot = dist > 0.001 ? (dx * fx + dz * fz) / dist : 1;
      if (dist > 0.7 && dot < 0.15) continue;
      const score = dist + (1 - dot) * 1.4 + 0.15;
      if (score < bestScore) { bestScore = score; best = { kind: 'dweeb', ref: t, dist, dot }; }
    }

    for (const { obj } of this.arena.getObjectsNear(pos, 2.4)) {
      if (!obj.def.grabbable || obj.isGrabbed || obj === d.held?.ref) continue;
      // Fused explosives pop normally; in-flight props belong to the catch path above.
      if (obj.def.explosive && obj.fuse > 0) continue;
      if (obj.thrownTime > 0) {
        const v = obj.body?.linvel?.();
        if (v && Math.hypot(v.x, v.y, v.z) > 3) continue;
      }
      const op = obj.getPosition();
      const dx = op.x - pos.x, dz = op.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.4) continue;
      const dot = dist > 0.001 ? (dx * fx + dz * fz) / dist : 1;
      if (dist > 0.9 && dot < 0.15) continue;
      const score = dist + (1 - dot) * 1.35;
      if (score < bestScore) { bestScore = score; best = { kind: 'object', ref: obj, dist, dot }; }
    }
    return best;
  }

  _meleeScore(c) {
    return c.dist + (1 - c.dot) * 1.2;
  }

  /** Nudge facing toward the nearest foe roughly in front. */
  _autoAim(d, range) {
    const pos = d.getPosition();
    const f = d.forward;
    let best = null, bestDot = Math.cos(THREE.MathUtils.degToRad(40));
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy === d) continue;
      const tp = t.getPosition();
      const dx = tp.x - pos.x, dz = tp.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range || dist < 0.01) continue;
      const dot = (dx * f.x + dz * f.z) / dist;
      if (dot > bestDot) { bestDot = dot; best = { dx, dz, t }; }
    }
    if (best) d.yaw = Math.atan2(best.dx, best.dz);
    d.aimYaw = null;
    return best?.t ?? null;
  }

  // ═══ World effects ═══

  explode(pos, attacker, source = null) {
    const slime = !!source?.def?.slimeBomb;
    this.onExplode?.(pos, attacker, source);
    if (source) {
      source.broken = true;
      this.arena.removeObject(source);
    }
    for (const t of this.dweebs) {
      if (!t.active) continue;
      const tp = t.getPosition();
      _dir.set(tp.x - pos.x, tp.y - pos.y, tp.z - pos.z);
      const dist = _dir.length();
      if (dist > 5) continue;
      const k = 1 - dist / 5 * 0.6;
      _dir.normalize();
      _dir.y = Math.max(_dir.y, 0.5);
      const launch = t.receiveHit({ dir: _dir, ...A.explosion(slime ? k * 0.3 : k), attacker, time: this.time }); // slime: a wet pop, the goo is the threat
      if (launch > 0) {
        this.fx.hit(t, attacker, launch, 'boom');
        // Blasts light oily Dweebs (INFERNO) and dry out wet ones a little
        if (t.statuses?.oily > 0) this.status?.apply(t, 'burn', attacker);
        if (attacker && attacker !== t) this.addStyle(attacker, 8 + launch * 0.4);
      }
    }
    this._chainReact(pos, attacker, source);
    for (const { obj } of this.arena.getObjectsNear(pos, 5)) {
      if (!obj.body) continue;
      const op = obj.getPosition();
      _dir.set(op.x - pos.x, 0, op.z - pos.z).normalize();
      const m = Math.sqrt(obj.body.mass()) * 2;
      this.physics.applyImpulse(obj.body, { x: _dir.x * 10 * m, y: 8 * m, z: _dir.z * 10 * m });
      this.physics.applyTorqueImpulse(obj.body, { x: (Math.random() - 0.5) * m, y: (Math.random() - 0.5) * m, z: (Math.random() - 0.5) * m });
    }
    this.fx.explosion(pos);
    if (slime) this._spawnGooZones(pos, source);
  }

  // ═══ Chain reactions & fire ═══

  /**
   * A blast lights every explosive in reach on a short, distance-scaled fuse (so a barrel cluster
   * ripples outward instead of popping at once) and sets nearby wood / cardboard / fabric burning.
   * Chain kills credit whoever lit the first one.
   */
  _chainReact(pos, attacker, source) {
    const depth = (source?.chainDepth ?? 0) + 1;
    const reach = (source?.def?.explosionRadius ?? 5) * 1.3;
    let lit = 0;
    for (const { obj, dist } of this.arena.getObjectsNear(pos, reach)) {
      if (!obj || obj === source || obj.broken || !obj.body || obj.isDebris) continue;
      const d = dist ?? 0;
      if (obj.def.explosive && !(obj.fuse > 0) && depth <= CHAIN_MAX_DEPTH) {
        obj.chainDepth = depth;
        this.lightFuse(obj, attacker, 0.14 + d * 0.05);
        lit++;
      } else if (FLAMMABLE[obj.def.material] && !(obj.burning > 0) && d < 5) {
        this.ignite(obj, attacker);
      }
    }
    // Chain bookkeeping: a combo window that grows as each linked blast goes off
    const c = this.chain;
    if (source?.chainDepth && c && c.by === attacker && this.time - c.t < 2.5) {
      c.n++; c.t = this.time;
      if (c.n >= 2) {
        const big = c.n >= 4;
        this.fx._toyWord?.(`CHAIN x${c.n}!`, { x: pos.x, y: pos.y + 1.6, z: pos.z }, big ? 0xff3b3b : 0xff9a1f, big ? 'big' : 'small');
        if (attacker) this.addStyle(attacker, 6 * c.n, c.n >= 4 ? 'CHAIN REACTION' : 'CHAIN');
        this.fx.cam?.shake?.(0.25 + c.n * 0.05);
      }
    } else if (lit > 0 || !source?.chainDepth) {
      this.chain = { by: attacker, n: 1, t: this.time };
    }
  }

  /** Set a flammable prop burning: it chars, smokes, spreads to neighbours and cooks fuses. */
  ignite(obj, by = null) {
    if (!obj?.body || obj.broken || obj.burning > 0) return;
    const fl = FLAMMABLE[obj.def.material];
    if (!fl) return;
    obj.burning = fl.time * (0.8 + Math.random() * 0.4);
    obj.burnTotal = obj.burning;
    obj.burnBy = by;
    obj.burnTick = 0;
    if (!obj._charMats && obj.mesh) {
      obj._charMats = [];
      obj.mesh.traverse(m => {
        if (!m.isMesh || !m.material || Array.isArray(m.material) || !m.material.color) return;
        m.material = m.material.clone();
        obj._charMats.push({ mat: m.material, base: m.material.color.clone() });
      });
    }
    (this.burning ??= []).push(obj);
    const p = obj.getPosition();
    this.fx._toyWord?.('FWOOSH!', { x: p.x, y: p.y + 0.8, z: p.z }, 0xff7a1a);
  }

  _updateBurning(dt) {
    if (!this.burning?.length) return;
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const obj = this.burning[i];
      if (obj.broken || !obj.body) { this.burning.splice(i, 1); continue; }
      obj.burning -= dt;
      obj.burnTick += dt;
      const p = obj.getPosition();
      const char = 1 - Math.max(0, obj.burning) / (obj.burnTotal || 1);
      if (obj._charMats) for (const c of obj._charMats) c.mat.color.copy(c.base).lerp(_CHAR, Math.min(0.85, char));
      // Splashing into water puts it out
      if (p.y < -1.2) { obj.burning = 0; this.burning.splice(i, 1); continue; }
      if (obj.burnTick > 0.12) {
        obj.burnTick = 0;
        const ps = this.fx.particles;
        if (ps?.emit) {
          _fire.set(p.x, p.y + 0.35, p.z);
          ps.emit(_fire, { count: 2, colors: [0xffd23f, 0xff6a1f, 0xff3b1f], speed: 1.2, up: 3, size: 0.13, life: 0.45 });
          if (Math.random() < 0.35) ps.emit(_fire, { count: 1, colors: [0x3a3a3a, 0x555555], speed: 0.6, up: 2.2, size: 0.22, life: 0.9 });
        }
        // Spread: neighbours catch, explosives cook off
        for (const { obj: o, dist } of this.arena.getObjectsNear(p, 1.6)) {
          if (o === obj || o.broken || !o.body || o.isDebris) continue;
          if (o.def.explosive && !(o.fuse > 0) && (dist ?? 0) < 1.3) { o.chainDepth = 1; this.lightFuse(o, obj.burnBy, 0.9); }
          else if (FLAMMABLE[o.def.material] && !(o.burning > 0) && Math.random() < 0.12) this.ignite(o, obj.burnBy);
        }
        // Hot foot: Dweebs touching a burning prop hop off it
        for (const t of this.dweebs) {
          if (!t.active || t.hazardCd > 0 || t.held === obj) continue;
          const tp = t.getPosition();
          if (Math.hypot(tp.x - p.x, tp.z - p.z) > 1.0 || Math.abs(tp.y - p.y) > 1.4) continue;
          t.hazardCd = 0.9;
          _dir.set(tp.x - p.x, 0, tp.z - p.z);
          if (_dir.lengthSq() < 1e-4) _dir.set(1, 0, 0);
          _dir.normalize(); _dir.y = 1.2;
          const launch = t.receiveHit({ dir: _dir, ...A.explosion(0.18), attacker: obj.burnBy, time: this.time });
          if (launch > 0) this.fx._toyWord?.('HOT FOOT!', { x: tp.x, y: tp.y + 1.4, z: tp.z }, 0xff7a1a);
        }
      }
      // Holding a burning prop is a hot potato: after a beat you yelp and let go
      const g = obj.isGrabbed ? this.dweebs.find(t => t.held === obj) : null;
      if (g) {
        obj.heldHot = (obj.heldHot || 0) + dt;
        if (obj.heldHot > 1.4) { obj.heldHot = 0; this.drop(g); this.fx._toyWord?.('OW OW OW!', g.getPosition(), 0xff7a1a); }
      }
      if (obj.burning <= 0) {
        this.burning.splice(i, 1);
        // Cardboard and fabric burn to ash; wood stays as a charred husk
        if (FLAMMABLE[obj.def.material].ash) {
          const h = obj.isGrabbed ? this.dweebs.find(t => t.held === obj) : null;
          if (h) this.drop(h);
          this.breakObject(obj, null);
        }
      }
    }
  }

  breakObject(obj, by = null, hit = null) {
    const pos = obj.getPosition();
    const slime = !!obj.def.slimeBomb;
    if (obj.def.status) this.status?.addZone(obj.def.status, pos, by ?? obj.thrownBy ?? null);
    if (by) this.addStyle(by, 5);
    const color = obj.def.color ?? 0xc4a06a;
    const mass = obj.def.mass ?? 1;
    const dims = obj.def.dims || {};
    const bulk = Math.max(dims.hx ?? 0, dims.hy ?? 0, dims.hz ?? 0, dims.radius ?? 0, dims.halfHeight ?? 0, 0.3);
    const vel = obj.body?.linvel?.() ?? { x: 0, y: 0, z: 0 };
    const speed = hit?.speed ?? Math.hypot(vel.x, vel.y, vel.z);
    let dir = hit?.dir;
    if (!dir) { const l = Math.hypot(vel.x, vel.z) || 1; dir = { x: vel.x / l, y: 0, z: vel.z / l }; }
    const count = Math.round(Math.min(16, Math.max(6, 5 + mass * 2.5 + bulk * 4)));
    obj.broken = true;
    this.arena.removeObject(obj);
    this.arena.spawnDebris(pos, color, count, obj.def.material, obj.def.breakColors,
      { vel, dir, power: Math.min(18, speed), size: Math.min(1.8, Math.max(0.8, bulk / 0.35)) });
    // Shockwave: heavy smashes kick nearby loose props.
    const shove = Math.min(6, mass * 0.8 + speed * 0.15);
    if (shove > 1.2) {
      for (const o of this.arena.objects) {
        if (o === obj || o.isDebris || o.broken || o.isGrabbed || !o.body) continue;
        const op = o.getPosition(), dx = op.x - pos.x, dz = op.z - pos.z, dd = Math.hypot(dx, dz);
        if (dd > 2.8 || dd < 1e-3) continue;
        const k = shove * (1 - dd / 2.8) * Math.min(1, (o.def?.mass ?? 1));
        this.physics.applyImpulse(o.body, { x: dx / dd * k, y: k * 0.5, z: dz / dd * k });
      }
    }
    this.fx.break(pos, obj);
    if (slime) this._spawnGooZones(pos, obj);

    // Piñata Loot Burst: spill candies if this object has spill metadata
    if (obj.def?.spill) {
      const { key, count = 6 } = obj.def.spill;
      const candyDef = getObjectDef(key);
      if (candyDef) {
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
          const radius = 0.4 + Math.random() * 0.3;
          const x = pos.x + Math.cos(angle) * radius;
          const z = pos.z + Math.sin(angle) * radius;
          const y = pos.y + 0.5 + Math.random() * 0.5;
          const candy = this.arena.spawnItem(key, { x, y, z });
          if (candy && candy.body) {
            const speed = 4 + Math.random() * 3;
            candy.body.setLinvel({
              x: Math.cos(angle) * speed * 0.7,
              y: 3 + Math.random() * 4,
              z: Math.sin(angle) * speed * 0.7,
            }, true);
            candy.body.setAngvel({
              x: (Math.random() - 0.5) * 8,
              y: (Math.random() - 0.5) * 8,
              z: (Math.random() - 0.5) * 8,
            }, true);
            candy.candyLife = 12; // uneaten candy melts away
            candy.candyGrace = 0.5; // can't be eaten mid-burst
          }
        }
        if (Math.random() < 0.15) {
          this.arena.spawnPowerUp(null);
        }
        // Juicy feedback
        this.fx._toyWord?.('SWEET!', pos, 0xffd23f, 'big');
        this.fx.cam?.shake?.(0.25);
        this.arena.excite?.(0.3);
      }
    }
  }

  // ═══ Sticky slime goo ═══

  /** Raycast down to find the floor for a goo splat. Returns null over the void. */
  _gooGroundPoint(pos) {
    if (!pos || !this.physics) return null;
    try {
      const hit = this.physics.raycast(
        { x: pos.x, y: pos.y + 0.5, z: pos.z },
        { x: 0, y: -1, z: 0 },
        60,
        null,
      );
      if (hit?.point) return { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    } catch { /* no physics world / temporary body — fall through */ }
    const arena = this.arena;
    if (arena?.isOverGround?.(pos.x, pos.z, 0.2)) return { x: pos.x, y: 0, z: pos.z };
    return null;
  }

  /** A slime bomb bursts into 1–3 sticky ground zones (deterministic spread from its id). */
  _spawnGooZones(pos, source = null) {
    if (!pos || !this.arena?.scene) return;
    const def = source?.def || {};
    const baseR = Number(def.gooRadius) || 2.1;
    const baseLife = Number(def.gooLife) || 6;
    const seed = Math.abs(source?.physicsId ?? Math.floor((pos.x * 131 + pos.z * 71) * 100)) | 0;
    const count = 1 + (seed % 3);
    const spread = baseR * 0.55;
    const ground = this._gooGroundPoint(pos);
    for (let i = 0; i < count; i++) {
      let x = pos.x, z = pos.z;
      if (i > 0) {
        const a = seed * 0.73 + i * 2.1;
        const r = spread * (0.55 + ((seed >> (i * 2)) % 5) / 8);
        x += Math.cos(a) * r;
        z += Math.sin(a) * r;
      }
      const g = i === 0 ? ground : this._gooGroundPoint({ x, y: pos.y + 1, z });
      if (!g) continue;
      const radius = i === 0 ? baseR : baseR * (0.55 + ((seed >> (i + 2)) % 4) * 0.1);
      const zone = {
        x: g.x, y: g.y, z: g.z,
        radius, life: baseLife, maxLife: baseLife, age: 0,
        group: null, bubbles: [], opacities: [],
      };
      this._createGooZone(zone);
      this.gooZones.push(zone);
    }
  }

  /** Build the glossy splat, rim and bubbling blobs for one goo zone. */
  _createGooZone(zone) {
    const scene = this.arena?.scene;
    if (!scene || !zone) return;
    try {
      const group = new THREE.Group();
      group.position.set(zone.x, zone.y, zone.z);

      const puddleMat = new THREE.MeshStandardMaterial({
        color: 0x5ee06a, emissive: 0x1d6b2d, emissiveIntensity: 0.35,
        roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.86, depthWrite: false,
      });
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(zone.radius, 30), puddleMat);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.y = 0.035;
      puddle.renderOrder = 2;
      group.add(puddle);

      const rimMat = new THREE.MeshBasicMaterial({ color: 0x9dffb0, transparent: true, opacity: 0.45, depthWrite: false });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(zone.radius * 0.92, 0.045, 6, 28), rimMat);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.05;
      rim.renderOrder = 2;
      group.add(rim);

      const bubbleMat = new THREE.MeshStandardMaterial({
        color: 0x9dffb0, emissive: 0x2fa34f, emissiveIntensity: 0.25,
        roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.72, depthWrite: false,
      });
      const bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
      const n = 4 + (Math.abs(Math.floor(zone.x * 37 + zone.z * 19)) % 4);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + zone.x;
        const rr = zone.radius * (0.15 + ((i * 37) % 60) / 130);
        const b = new THREE.Mesh(bubbleGeo, bubbleMat);
        b.position.set(Math.cos(a) * rr, 0.06, Math.sin(a) * rr);
        const base = zone.radius * (0.05 + ((i * 13) % 5) / 50);
        b.scale.set(base, base * 0.55, base);
        b.renderOrder = 3;
        group.add(b);
        zone.bubbles.push({ mesh: b, base, phase: i * 1.7 });
      }

      zone.opacities = [
        { mat: puddleMat, base: 0.86 },
        { mat: rimMat, base: 0.45 },
        { mat: bubbleMat, base: 0.72 },
      ];
      zone.group = group;
      zone.puddle = puddle;
      zone.rim = rim;
      scene.add(group);
    } catch { /* visuals are optional: never let a bad mesh crash the frame */ }
  }

  _disposeGooZone(zone) {
    if (!zone) return;
    if (zone.group && this.arena?.scene) {
      this.arena.scene.remove(zone.group);
      const geos = new Set(), mats = new Set();
      zone.group.traverse(o => {
        if (o.geometry) geos.add(o.geometry);
        if (o.material) mats.add(o.material);
      });
      for (const g of geos) g.dispose?.();
      for (const m of mats) m.dispose?.();
    }
    zone.group = null;
    zone.bubbles = [];
    zone.opacities = [];
  }

  clearGooZones() {
    for (const z of this.gooZones || []) this._disposeGooZone(z);
    this.gooZones = [];
  }

  /** Per-frame goo: age puddles, pin Dweebs, drag and gently pull nearby props. */
  _updateGoo(dt) {
    if (dt <= 0) return;
    const zones = (this.gooZones ||= []);

    for (const d of this.dweebs) {
      if (!d) continue;
      if (d.gooImmune > 0) d.gooImmune = Math.max(0, d.gooImmune - dt);
      if (d.stuckTimer > 0) {
        d.stuckTimer = Math.max(0, d.stuckTimer - dt);
        if (d.stuckTimer <= 0) {
          d.stuckMash = 0;
          d.gooImmune = Math.max(d.gooImmune || 0, 1.1);
        }
      }
    }

    if (!zones.length) return;
    for (let i = zones.length - 1; i >= 0; i--) {
      const zone = zones[i];
      if (!zone) { zones.splice(i, 1); continue; }
      zone.life -= dt;
      zone.age += dt;

      if (zone.group) {
        const fade = zone.life < 0.7 ? Math.max(0, zone.life / 0.7) : 1;
        for (const o of zone.opacities) o.mat.opacity = o.base * fade;
        if (zone.puddle) zone.puddle.scale.setScalar(1 + Math.sin(zone.age * 2.4) * 0.03);
        for (const b of zone.bubbles) {
          const s = b.base * (1 + Math.sin(zone.age * 4 + b.phase) * 0.18);
          b.mesh.scale.set(s, s * 0.55, s);
        }
      }

      if (zone.life <= 0) {
        this._disposeGooZone(zone);
        zones.splice(i, 1);
        continue;
      }

      // Props in the puddle get dragged down and pulled toward the centre.
      if (this.arena?.getObjectsNear) {
        for (const { obj } of this.arena.getObjectsNear(zone, zone.radius + 0.35)) {
          if (!obj?.body || obj.broken) continue;
          const op = obj.getPosition?.();
          if (!op || op.y - zone.y > 1.8 || op.y - zone.y < -1.5) continue;
          const dx = zone.x - op.x, dz = zone.z - op.z;
          const dist = Math.hypot(dx, dz) || 1;
          const k = Math.exp(-5 * dt);
          const pull = 1.4 * dt * Math.min(1, dist / (zone.radius || 1));
          try {
            const v = obj.body.linvel();
            obj.body.setLinvel({ x: v.x * k + (dx / dist) * pull, y: v.y * k, z: v.z * k + (dz / dist) * pull }, true);
            const av = obj.body.angvel?.();
            if (av) {
              const ak = Math.exp(-4 * dt);
              obj.body.setAngvel({ x: av.x * ak, y: av.y * ak, z: av.z * ak }, true);
            }
          } catch { /* body may have been removed this frame */ }
        }
      }

      for (const d of this.dweebs) {
        if (!d?.active || d.grabbedBy || !d.body) continue;
        const p = d.getPosition();
        if (Math.hypot(p.x - zone.x, p.z - zone.z) > zone.radius) continue;
        if (p.y - zone.y > 2 || p.y - zone.y < -1.6) continue;

        if (d.stuckTimer <= 0 && (d.gooImmune || 0) <= 0) {
          d.stuckTimer = 2.6;
          d.stuckMash = 0;
          d.landSquash = Math.max(d.landSquash || 0, 0.3);
        }

        if (d.stuckTimer > 0) {
          try {
            const v = d.body.linvel();
            const k = Math.exp(-8 * dt);
            d.body.setLinvel({ x: v.x * k, y: v.y * Math.exp(-2 * dt), z: v.z * k }, true);
            const av = d.body.angvel?.();
            if (av) {
              const ak = Math.exp(-10 * dt);
              d.body.setAngvel({ x: av.x * ak, y: av.y * ak, z: av.z * ak }, true);
            }
          } catch { /* body can be disabled during respawn */ }
        }
      }
    }
  }

  /** Spilled piñata candy: walk over it to eat it (small heal + a short sugar buzz). */
  _updateCandy(dt) {
    const objs = this.arena?.objects;
    if (!objs) return;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.candyLife === undefined || o.broken || o.isGrabbed) continue;
      o.candyLife -= dt;
      o.candyGrace -= dt;
      if (o.candyLife <= 0) { this.arena.removeObject(o); continue; }
      if (o.candyGrace > 0) continue;
      const p = o.getPosition();
      for (const d of this.dweebs) {
        if (!d.active || d.grabbedBy) continue;
        const q = d.getPosition();
        const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
        if (dx * dx + dz * dz > 0.81 || Math.abs(dy) > 1.4) continue;
        d.percent = Math.max(0, d.percent - 2);
        d.sugarTimer = Math.max(d.sugarTimer || 0, 1.5);
        this.fx._toyWord?.('YUM!', p, 0xff4d5e, 'small');
        this.arena.removeObject(o);
        break;
      }
    }
  }

  /** Damage a breakable: shatter it, or chip a few flakes off so you can see it's going. */
  damageObject(obj, force, by = null, hit = null) {
    if (obj.applyDamage(force)) { this.breakObject(obj, by, hit); return true; }
    if (obj.def.breakable && !obj.broken && force > 300) {
      const pos = obj.getPosition();
      const chips = obj.wear > 0.6 ? 2 : 1;
      this.arena.spawnDebris(pos, obj.def.color ?? 0xc4a06a, chips, obj.def.material, obj.def.breakColors,
        { vel: { x: 0, y: 0, z: 0 }, dir: hit?.dir, power: 3, size: 0.45 });
    }
    return false;
  }

  // ═══ Per-frame ═══

  update(dt, time) {
    this.time = time;
    this._updateCandy(dt);

    for (const d of this.dweebs) {
      if (!d.active) {
        if (d.held) this.drop(d);
        d.isCharging = false;
        continue;
      }
      d.hazardCd = Math.max(0, (d.hazardCd || 0) - dt);
      d.slipCd = Math.max(0, (d.slipCd || 0) - dt);
      if (d.swingT > 0) d.swingT -= dt;
      // Shooter weapon cooldown
      if (d._shooterCd > 0) d._shooterCd = Math.max(0, d._shooterCd - dt);

      // Signature passives queue a one-shot world event from Dweeb.postStep.
      if (d.signatureEvent) {
        const ev = d.signatureEvent;
        d.signatureEvent = null;
        if (ev.kind === 'pogo') this._signaturePogo(d, ev.fall);
        else if (ev.kind === 'quake') this._signatureQuake(d, ev.fall);
      }

      if (d.isCharging) {
        if (!d.canAct) { d.isCharging = false; d.charging = 0; }
        else d.charging = Math.min(1, d.charging + dt / CHARGE_TIME);
      }

      // Lose your grip when smacked
      if (d.held && (d.hitstun > 0 || d.ragdolling)) this.drop(d);
      if (d.held) this._updateHeld(d, dt);
      if (d.grabSettle > 0) {
        d.grabSettle -= dt;
        if (d.grabSettle <= 0 && d.pendingThrow != null && d.held) this.throwHeld(d, d.pendingThrow);
      }

      if (d.diveTimer > 0 && !d.diveHit) this._checkDive(d);
      if (d.slamActive && d.grounded) this._resolveSlam(d);
      if (d.dropkickTimer > 0) this._checkDropkick(d);
      if (d.magnetTimer > 0) this._magnetPull(d, dt);
      if (d.grapple) this._updateGrapple(d, dt);
      this._checkLedge(d);
      this._updateStyle(d, dt);
    }

    this._updateGoo(dt);
    this._updateFuses(dt);
    this._updateBurning(dt);
    this._updateProjectiles(dt);
    this._updateJackInBoxes(dt);
    this._updateWhoopee(dt);
    this._updateThrownDweebs(dt);
    this._updateBananaPeels();
    this._updateHazards();
    this._updateBouncers(dt);
    this._updatePickups();
    this._updateRideables(dt);
  }

  /**
   * Carry sway: a spring-damped offset between where the hands are and where the held thing
   * actually is. Accelerating drags the load behind you, stopping swings it forward, and heavy
   * props lag and wobble far more than featherweights. Purely kinematic (no joints), so it is
   * cheap and stays put through hitstop; the swing is fed back into throws and drops.
   */
  _swayStep(d, held, dt, mass) {
    const sw = held.sway || (held.sway = { x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, pvx: 0, pvz: 0, pvy: 0, init: false });
    const v = d.body.linvel();
    if (!sw.init) { sw.pvx = v.x; sw.pvz = v.z; sw.pvy = v.y; sw.init = true; }
    const h = Math.max(1e-3, Math.min(dt, 1 / 30));
    // Carrier acceleration pushes the load the opposite way (inertia), scaled by heft.
    const ax = (v.x - sw.pvx) / h, az = (v.z - sw.pvz) / h, ay = (v.y - sw.pvy) / h;
    sw.pvx = v.x; sw.pvz = v.z; sw.pvy = v.y;
    const heft = Math.min(2.2, 0.35 + mass * 0.28);
    const k = 90 / heft, c = 2 * Math.sqrt(k) * 0.32; // underdamped: a couple of visible swings
    sw.vx += (-ax * 0.018 * heft - k * sw.x - c * sw.vx) * h;
    sw.vz += (-az * 0.018 * heft - k * sw.z - c * sw.vz) * h;
    sw.vy += (-ay * 0.012 * heft - k * 1.6 * sw.y - c * sw.vy) * h;
    sw.x += sw.vx * h; sw.z += sw.vz * h; sw.y += sw.vy * h;
    const lim = 0.25 + heft * 0.2;
    const r = Math.hypot(sw.x, sw.z);
    if (r > lim) { sw.x *= lim / r; sw.z *= lim / r; sw.vx *= 0.5; sw.vz *= 0.5; }
    sw.y = Math.max(-0.35, Math.min(0.3, sw.y));
    return sw;
  }

  /** Jack-in-the-Box pop: check for wound-up boxes and trigger their pop shockwave. */
  _updateJackInBoxes(dt) {
    for (const obj of [...this.arena.objects]) {
      if (obj.isDebris || obj.broken || obj.key !== 'jackInBox') continue;
      if (!obj.jackPop || obj.jackHandled) continue;
      obj.jackHandled = true; // pop once

      const pos = obj.getPosition();
      const jack = obj.def.jack || { radius: 2.5, launch: 18, damage: 8 };
      const radius = jack.radius;
      const launch = jack.launch;
      const damage = jack.damage;

      // If held, the pop rockets the holder straight up instead (funniest outcome)
      if (obj.isGrabbed && obj.grabber) {
        const holder = obj.grabber;
        if (holder.held?.ref === obj) holder.held = null;
        obj.release?.();
        if (holder.active) {
          const hp = holder.getPosition();
          holder.receiveHit({ dir: new THREE.Vector3(0, 1, 0), damage, base: launch, growth: 0, attacker: obj.thrownBy, time: this.time });
          this.fx.hit(holder, obj.thrownBy, launch, 'boom');
          this.fx.hud?.popup('POW!', hp, 'big', 0xffd23f);
        }
        this.arena.spawnDebris(pos, obj.def.color ?? 0xd4a86a, 8, obj.def.material, obj.def.breakColors);
        this.arena.removeObject(obj);
        continue;
      }

      // Shockwave: find Dweebs in radius and launch them upward
      let hitAny = false;
      for (const d of this.dweebs) {
        if (!d.active || d.grabbedBy) continue;
        const dp = d.getPosition();
        const dx = dp.x - pos.x, dy = dp.y - pos.y, dz = dp.z - pos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > radius) continue;

        // Upward-biased direction
        const dir = new THREE.Vector3(dx, radius * 0.5, dz);
        if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
        dir.normalize();

        const atk = { damage, base: launch, growth: 0 };
        const l = d.receiveHit({ dir, ...atk, attacker: obj.thrownBy, time: this.time });
        if (l > 0) {
          hitAny = true;
          this.fx.hit(d, obj.thrownBy, l, 'boom');
          this.fx.hud?.popup('BOING!', { x: dp.x, y: dp.y + 0.8, z: dp.z }, 'big', 0xffd23f);
          if (obj.thrownBy && obj.thrownBy !== d) this.addStyle(obj.thrownBy, 6 + l * 0.4);
        }
      }

      // Debris and loose props get thrown out
      for (const { obj: o } of this.arena.getObjectsNear(pos, radius)) {
        if (o === obj || o.isGrabbed || o.broken) continue;
        const op = o.getPosition();
        const dir = new THREE.Vector3(op.x - pos.x, 0.8, op.z - pos.z).normalize();
        const m = Math.sqrt(o.body.mass());
        this.physics.applyImpulse(o.body, { x: dir.x * 8 * m, y: 6 * m, z: dir.z * 8 * m });
      }

      // FX and cleanup
      this.fx.explosion(pos); // reuse explosion FX for the pop
      this.fx.hud?.popup('POW!', { x: pos.x, y: pos.y + 0.6, z: pos.z }, 'big', 0xffd23f);
      this.arena.spawnDebris(pos, obj.def.color ?? 0xd4a86a, 10, obj.def.material, obj.def.breakColors);
      this.arena.removeObject(obj);
    }
  }

  _updateBouncers(dt) {
    const mats = [];
    for (const obj of this.arena.objects) {
      if (!obj.def?.bouncy || obj.isGrabbed || obj.broken || !obj.body) continue;
      const rot = obj.body.rotation();
      _rq.set(rot.x, rot.y, rot.z, rot.w);
      const up = _p.set(0, 1, 0).applyQuaternion(_rq);
      const p = obj.getPosition();
      mats.push({
        obj, x: p.x, z: p.z, top: p.y + (obj.def.dims.halfHeight ?? 0.12),
        radius: obj.def.dims.radius ?? 0.7, upright: up.y >= Math.cos(35 * Math.PI / 180),
      });
    }

    for (const d of this.dweebs) {
      if (d.bounceCd > 0) d.bounceCd = Math.max(0, d.bounceCd - dt);
      const p = d.getPosition();

      let over = false;
      for (const m of mats) {
        if (Math.hypot(p.x - m.x, p.z - m.z) < m.radius * 0.95) { over = true; break; }
      }
      if (d.grounded && !over) d.trampChain = 0;
      if (!d.active || d.grabbedBy) continue;

      for (const m of mats) {
        if (!m.upright) continue;
        if (Math.hypot(p.x - m.x, p.z - m.z) >= m.radius * 0.95) continue;
        if (p.y < m.top + 0.2 || p.y > m.top + 1.0) continue;
        const v = d.body.linvel();
        if (v.y > 0.5 || d.bounceCd > 0) continue;

        d.trampChain = (d.trampChain || 0) + 1;
        const chain = d.trampChain;
        const boost = d.jumpBuffer > 0 ? 1.25 : 1;
        d.body.setLinvel({ x: v.x, y: m.obj.def.bouncy.vel * boost, z: v.z }, true);
        d.bounceCd = m.obj.def.bouncy.cd;
        d.landSquash = -0.4;
        const text = chain >= 5 ? 'SUPER BOING!!' : chain >= 2 ? 'BOING BOING!' : 'BOING!';
        this.fx.hud?.popup?.(text, { x: p.x, y: p.y + 1, z: p.z }, chain > 1 ? 'big' : 'small', 0x3fa9ff);
        m.obj.pop?.(0.5);
        if (typeof this.addStyle === 'function') this.addStyle(d, 2 + chain, 'TRAMPOLINE');
        break;
      }
    }

    for (const m of mats) {
      if (!m.upright) continue;
      for (const obj of this.arena.objects) {
        if (obj === m.obj || obj.isDebris || obj.isGrabbed || obj.broken || !obj.body) continue;
        const p = obj.getPosition();
        if (Math.hypot(p.x - m.x, p.z - m.z) >= m.radius * 0.95) continue;
        if (p.y < m.top + 0.2 || p.y > m.top + 1.0) continue;
        const v = obj.body.linvel();
        if (v.y > 0) continue;
        obj.body.setLinvel({ x: v.x, y: m.obj.def.bouncy.propVel, z: v.z }, true);
        m.obj.pop?.(0.35);
      }
    }
  }

  _updateHeld(d, dt) {
    const pos = d.getPosition();
    const f = d.forward;
    const held = d.held;
    const s = d.megaTimer > 0 ? 1.5 : 1;

    if (held.kind === 'dweeb') {
      const t = held.ref;
      if (!t.active) { d.held = null; t.setGrabbed(null); d.giantSwing = null; return; }
      if (this._giantSwing(d, t, dt, pos, s)) return;
      t.body.setTranslation({ x: pos.x, y: pos.y + 1.15 * s, z: pos.z }, true);
      const sw = this._swayStep(d, held, dt, 3);
      // Struggling victims kick the spring: the less time left to escape, the harder they thrash.
      const thrash = Math.max(0, 1 - t.escapeTimer / 1.5);
      sw.vx += (Math.random() - 0.5) * (0.6 + thrash * 3) * dt * 10;
      sw.vz += (Math.random() - 0.5) * (0.6 + thrash * 3) * dt * 10;
      t.body.setTranslation({ x: pos.x + sw.x, y: pos.y + 1.15 * s + sw.y, z: pos.z + sw.z }, true);
      t.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      t.yaw = d.yaw + Math.PI / 2;
      const mash = Math.max(0, t.escapeMash || 0);
      const mashedOut = mash > 0;
      t.escapeTimer -= dt * (1 + mash * 0.4); // full mash (5) = 3x faster escape
      t.escapeMash = Math.max(0, mash - dt * (t.escapeMashDecay || 2.5));
      if (mash > 0) {
        t.mashWordCd = (t.mashWordCd || 0) - dt;
        if (t.mashWordCd <= 0) {
          t.mashWordCd = 0.22;
          this.fx?._toyWord?.('MASH!', t.getPosition(), t.color ?? 0xffd23f, 'small');
          if (t.isPlayer || d.isPlayer) this.fx?.cam?.shake?.(0.04 + Math.min(0.06, mash * 0.012));
        }
      }
      // The held Dweeb is also a shield: a point out front soaks incoming throws.
      const S = BALANCE.humanShield;
      const sp = t.shieldPoint ?? (t.shieldPoint = { x: 0, y: 0, z: 0 });
      sp.x = pos.x + f.x * S.reach;
      sp.y = pos.y + S.height;
      sp.z = pos.z + f.z * S.reach;
      t.yaw = d.yaw + Math.PI / 2 + sw.x * 0.6 - sw.z * 0.6;
      t.carrySwayX = sw.x; t.carrySwayZ = sw.z;
      if (t.escapeTimer <= 0) {
        // Wriggled free! Out the way they were swinging.
        this.drop(d);
        t.body.setLinvel({ x: -f.x * 5 + sw.vx * 2, y: 7, z: -f.z * 5 + sw.vz * 2 }, true);
        d.hitstun = 0.35;
        this.fx.escape(t);
        if (mashedOut) {
          this.addStyle(t, 10, 'MASH-OUT');
          this.fx?._toyWord?.('MASH-OUT!', t.getPosition(), 0x5ee06a, 'big');
          if (t.isPlayer || d.isPlayer) this.fx?.cam?.shake?.(0.25);
        }
      }
      return;
    }

    const obj = held.ref;
    if (!obj.body || obj.broken) { d.held = null; return; }

    // Pogo stick: auto-bounce off the floor, steer a little in the air, and stomp rivals below.
    const pogo = obj.def.pogo;
    if (pogo) {
      d.pogoCd = Math.max(0, (d.pogoCd ?? 0) - dt);
      d.pogoStompCd = Math.max(0, (d.pogoStompCd ?? 0) - dt);
      const lv = d.body.linvel();
      if (d.grounded && d.pogoCd <= 0 && d.hitstun <= 0 && !d.ragdolling) {
        d.body.setLinvel({ x: lv.x, y: BALANCE.move.jumpVel * pogo.bounceVel, z: lv.z }, true);
        d.pogoCd = pogo.minInterval;
        d.pogoCount = (d.pogoCount ?? 0) + 1;
        if (d.pogoCount % 3 === 0) {
          const pp = d.getPosition();
          this.fx.popup('BOING!', { x: pp.x, y: pp.y + 1.2, z: pp.z }, 'small', 0xff8a1f);
        }
        obj.pop?.(0.4);
      } else if (!d.grounded && lv.y < 0) {
        d.body.setLinvel({
          x: lv.x + d.moveInput.x * pogo.airSteer * dt,
          y: lv.y,
          z: lv.z + d.moveInput.y * pogo.airSteer * dt,
        }, true);
        if (d.pogoStompCd <= 0) {
          const pos = d.getPosition();
          for (const t of this.dweebs) {
            if (t === d || !t.active || t.grabbedBy) continue;
            const tp = t.getPosition();
            const gap = pos.y - tp.y;
            const away = Math.hypot(tp.x - pos.x, tp.z - pos.z);
            if (away > 0.8 || gap < 0.6 || gap > 1.6) continue;
            const dir = new THREE.Vector3(tp.x - pos.x, -0.3, tp.z - pos.z).normalize();
            t.receiveHit({ dir, damage: 6, base: 6, growth: 0.4, attacker: d, time: this.time });
            d.pogoStompCd = 0.5;
            const sv = d.body.linvel();
            d.body.setLinvel({ x: sv.x, y: BALANCE.move.jumpVel * pogo.bounceVel, z: sv.z }, true); // bounce off their head
            this.fx.popup('POGO STOMP!', { x: tp.x, y: tp.y + 1.2, z: tp.z }, 'small', 0xff8a1f);
            break;
          }
        }
      }
    }

    const mass = obj.def.mass ?? 1;
    const sw = this._swayStep(d, held, dt, obj.isWeapon ? Math.min(mass, 1.2) : mass);
    let x, y, z;
    const q = _heldQ.setFromAxisAngle(_UP, d.yaw);
    if (obj.isWeapon) {
      // Hammer held out front, head up; swings down on attack
      const swing = d.swingT > 0 ? Math.sin((1 - d.swingT / 0.3) * Math.PI) : 0;
      const raise = d.isCharging ? -0.8 * d.charging : 0;
      const pitch = 0.2 + swing * 1.5 + raise;
      const reach = 0.75 + swing * 0.5;
      x = pos.x + f.x * reach + sw.x * 0.5;
      z = pos.z + f.z * reach + sw.z * 0.5;
      y = pos.y + 0.7 - swing * 0.5 + sw.y * 0.5;
      q.multiply(_heldQ2.setFromAxisAngle(_RIGHT, pitch));
    } else {
      // Heavy loads sag lower and tremble once you've held them a while.
      d.carryHeldT = (d.carryHeldT || 0) + dt;
      const heavy = mass >= (BALANCE.carry.heavyFrom ?? 2.5);
      const sag = heavy ? Math.min(0.18, d.carryHeldT * 0.03) : 0;
      const shake = heavy ? Math.sin(this.time * 47) * 0.012 * Math.min(1, d.carryHeldT * 0.25) : 0;
      x = pos.x + f.x * 0.15 + sw.x;
      z = pos.z + f.z * 0.15 + sw.z;
      const hy = obj.def.dims.hy ?? obj.def.dims.radius ?? obj.def.dims.halfHeight ?? 0.3;
      y = pos.y + 0.75 * s + hy + 0.05 + sw.y - sag + shake;
      // Tilt the load toward its swing so it reads as hanging off the hands, not glued on.
      _heldE.set(sw.z * 1.4 + shake * 3, 0, -sw.x * 1.4);
      q.premultiply(_heldQ2.setFromEuler(_heldE));
    }
    const floaty = obj.def.floaty;
    if (floaty) {
      y += Math.sin(this.time * 3.2) * 0.04;
      if (!d.grounded) {
        const v = d.body.linvel();
        let vy = v.y + G * floaty.gravityCancel * dt;
        if (vy < -floaty.maxFall) vy = -floaty.maxFall;
        d.body.setLinvel({ x: v.x, y: vy, z: v.z }, true);
      }
    }
    obj.body.setNextKinematicTranslation({ x, y, z });
    obj.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  // ═══ Giant Swing ═══

  /**
   * Hold attack while carrying a Dweeb and you start whirling them around by the ankles: the spin
   * ramps up with charge, the swung Dweeb bonks anyone in the circle, and letting go flings them
   * with bonus power. Spin too long and you get dizzy and lose your grip.
   * Returns true while it owns the held Dweeb's transform this frame.
   */
  _giantSwing(d, t, dt, pos, s) {
    const G = GIANT_SWING;
    const winding = d.isCharging || d.throwCharging;
    if (!winding || d.charging < G.startCharge || d.ledge) {
      if (!winding) d.giantSwing = null;
      return false;
    }
    let g = d.giantSwing;
    if (!g) {
      g = d.giantSwing = { angle: d.yaw, start: d.yaw, spin: 0, time: 0, wind: 1, laps: 0, lastLap: 0, called: false };
      this.fx._toyWord?.('GIANT SWING!', { x: pos.x, y: pos.y + 2.2, z: pos.z }, 0xffd23f);
    }
    g.time += dt;
    // Spin rate ramps with charge: a lazy twirl into a blur
    const rate = G.minRate + (G.maxRate - G.minRate) * Math.min(1, (d.charging - G.startCharge) / (1 - G.startCharge));
    g.spin = rate;
    g.angle += rate * dt;
    g.laps = Math.floor((g.angle - g.start) / (Math.PI * 2));
    d.yaw = g.angle;
    const r = G.radius * s;
    const ca = Math.sin(g.angle), sa = Math.cos(g.angle);
    // The swung Dweeb is out at arm's length and lifts as the spin speeds up (centrifugal)
    const lift = 0.55 + Math.min(0.6, rate * 0.05);
    const hx = pos.x + ca * r, hz = pos.z + sa * r;
    t.body.setTranslation({ x: hx, y: pos.y + lift * s, z: hz }, true);
    t.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    t.yaw = g.angle + Math.PI;
    // Hard to wriggle out of a blur, but not impossible
    t.escapeTimer += dt * G.escapeSlow;
    if (g.laps > g.lastLap) {
      g.lastLap = g.laps;
      this.fx.cam?.shake?.(0.08 + rate * 0.01);
      if (g.laps === 3 && !g.called) { g.called = true; this.fx._toyWord?.('WHEEEE!', { x: hx, y: pos.y + 1.8, z: hz }, 0x7dd3fc); }
    }
    // Bonk anyone the swung Dweeb sweeps through
    const tvx = Math.cos(g.angle), tvz = -Math.sin(g.angle);   // tangent of the swing
    for (const o of this.dweebs) {
      if (o === d || o === t || !o.active || o.grabbedBy) continue;
      if ((o.swingHitCd || 0) > this.time) continue;
      const op = o.getPosition();
      if (Math.hypot(op.x - hx, op.z - hz) > G.hitRadius || Math.abs(op.y - pos.y) > 1.6) continue;
      o.swingHitCd = this.time + 0.6;
      _tmp.set(tvx * 0.7 + ca * 0.7, 0.5, tvz * 0.7 + sa * 0.7).normalize();
      const k = Math.min(1, rate / G.maxRate);
      const atk = scaled(A.dweebThrow(0.25 + k * 0.5), d.powerScale * 0.75, d.powerScale * 0.75);
      const launch = o.receiveHit({ dir: _tmp, ...atk, attacker: d, time: this.time });
      if (launch > 0) {
        this.fx.hit(o, d, launch, 'throw');
        this.fx._toyWord?.('CLOBBERED!', op, 0xff6fb5);
        this.addStyle(d, 6 + launch * 0.4, 'GIANT SWING');
      }
      // The swung Dweeb feels it too
      t.percent = (t.percent || 0) + 2;
    }
    // Too long in the spin cycle: you get dizzy and let go in whatever direction you're facing
    if (g.time > G.dizzyAfter) {
      d.isCharging = false;
      d.throwCharging = false;
      d.charging = 0;
      const launchYaw = g.angle + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1) * 0.3;
      d.yaw = launchYaw;
      d.giantSwing = { ...g, release: true };
      this.throwHeld(d, 1);
      d.giantSwing = null;
      d.hitstun = Math.max(d.hitstun || 0, 0.7);
      this.fx._toyWord?.('TOO DIZZY!', pos, 0xb794f4);
      return true;
    }
    return true;
  }

  _checkDive(d) {
    const pos = d.getPosition();
    const f = d.forward;
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy) continue;
      const tp = t.getPosition();
      const dx = tp.x - pos.x, dz = tp.z - pos.z;
      if (Math.hypot(dx, dz) > 1.2 || Math.abs(tp.y - pos.y) > 1) continue;
      _tmp.set(f.x, 0.5, f.z);
      const launch = t.receiveHit({ dir: _tmp, ...scaled({ ...A.dive }, d.powerScale * d.stats.diveDmg), attacker: d, time: this.time });
      if (launch > 0) {
        this.fx.hit(t, d, launch, 'dive');
        this.addStyle(d, 4 + launch * 0.4);
      }
      d.diveHit = true;
      const v = d.body.linvel();
      d.body.setLinvel({ x: v.x * 0.2, y: 3, z: v.z * 0.2 }, true);
      return;
    }
  }

  /** Whoopee Cushions: armed cushions fire when a Dweeb steps/lands on them or a thrown prop smacks them. */
  _updateWhoopee(dt) {
    for (const obj of this.arena.objects) {
      if (!obj.def?.whoopee || obj.isDebris || obj.broken || !obj.body || !obj.mesh) continue;
      if (obj.thrownBy) obj.whoopeeOwner = obj.thrownBy;
      // Re-inflate: flat → puffed over the last 0.6 s of the refill
      if (obj.whoopeeT > 0) {
        obj.whoopeeT -= dt;
        const k = Math.min(1, Math.max(0, 1 - obj.whoopeeT / 0.6));
        obj.mesh.scale.set(1 + (1 - k) * 0.18, 0.28 + k * 0.72, 1 + (1 - k) * 0.18);
        if (obj.whoopeeT <= 0) { obj.mesh.scale.set(1, 1, 1); obj.pop(0.3); }
        continue;
      }
      if (obj.isGrabbed) continue;
      const pp = obj.getPosition();
      let trigger = null;
      for (const d of this.dweebs) {
        if (!d.active || d.grabbedBy || d.held || d.ledge || d.freezeTimer > 0) continue;
        const dp = d.getPosition();
        const dy = dp.y - pp.y;
        if (dy < -0.2 || dy > 0.95) continue;
        if (Math.hypot(pp.x - dp.x, pp.z - dp.z) > WHOOPEE.radius) continue;
        const vy = d.body.linvel().y;
        if (!d.grounded && vy > -1) continue; // jumping over it doesn't count; landing on it does
        trigger = d;
        break;
      }
      let smackedBy = null;
      if (!trigger) {
        for (const o of this.arena.objects) {
          if (o === obj || !o.thrownBy || !o.body || o.isDebris || o.broken) continue;
          const op = o.getPosition();
          if (Math.abs(op.y - pp.y) > 0.8 || Math.hypot(op.x - pp.x, op.z - pp.z) > WHOOPEE.radius + 0.25) continue;
          const v = o.body.linvel();
          if (Math.hypot(v.x, v.y, v.z) < WHOOPEE.thrownSpeed) continue;
          smackedBy = o.thrownBy;
          break;
        }
        if (!smackedBy) continue;
      }
      this._fireWhoopee(obj, pp, trigger, smackedBy || obj.whoopeeOwner || null);
    }
  }

  _fireWhoopee(obj, pp, sitter, culprit) {
    obj.whoopeeT = WHOOPEE.refill;
    obj.mesh.scale.set(1.25, 0.28, 1.25);
    obj.body.applyImpulse({ x: 0, y: 0.6, z: 0 }, true);
    if (sitter) {
      const v = sitter.body.linvel();
      sitter.body.setLinvel({ x: v.x * 0.5, y: WHOOPEE.up, z: v.z * 0.5 }, true);
      sitter.hitstun = Math.max(sitter.hitstun, 0.2);
      sitter.charging = 0; sitter.isCharging = false; sitter.diveTimer = 0; sitter.slamActive = false;
      sitter.flipSpin = Math.max(sitter.flipSpin || 0, 0.6);
      if (culprit && culprit !== sitter) { sitter.lastHitBy = culprit; sitter.lastHitTime = this.time; }
    }
    for (const d of this.dweebs) {
      if (d === sitter || !d.active || d.grabbedBy || d.held || d.ledge || d.freezeTimer > 0 || d.invulnTimer > 0) continue;
      const dp = d.getPosition();
      const dx = dp.x - pp.x, dz = dp.z - pp.z;
      const dist = Math.hypot(dx, dz);
      if (dist > WHOOPEE.gasRadius || Math.abs(dp.y - pp.y) > 2) continue;
      const f = 1 - dist / WHOOPEE.gasRadius;
      const nx = dist > 0.01 ? dx / dist : 1, nz = dist > 0.01 ? dz / dist : 0;
      const v = d.body.linvel();
      d.body.setLinvel({ x: v.x + nx * WHOOPEE.gasPush * f, y: Math.max(v.y, 2.5 * f), z: v.z + nz * WHOOPEE.gasPush * f }, true);
      d.hitstun = Math.max(d.hitstun, WHOOPEE.gasStun * f);
      d.isCharging = false; d.charging = 0;
      if (culprit && culprit !== d) { d.lastHitBy = culprit; d.lastHitTime = this.time; }
    }
    if (culprit && culprit !== sitter && sitter) this.addStyle?.(culprit, 8, 'PRANKED');
    this.fx.whoopee?.(pp, sitter);
  }

  /** Boomerang props curve out, then home back to the thrower; a clean catch re-grabs and pays style. */
  _updateBoomerang(obj, dt) {
    const B = obj.def.boomerang, owner = obj.thrownBy;
    obj.boomT = (obj.boomT || 0) + dt;
    obj.body.setAngvel({ x: 0, y: 22, z: 0 }, true); // flat helicopter spin
    if (!owner?.active || obj.boomT > B.maxTime) { obj.boomT = 0; obj.thrownTime = Math.min(obj.thrownTime, 0.3); return false; }
    const v = obj.body.linvel();
    if (obj.boomT < B.delay) {
      // Outbound: a gentle sideways curve and hang-time
      const sp = Math.hypot(v.x, v.z) || 1;
      obj.body.setLinvel({ x: v.x - (v.z / sp) * 6 * dt, y: v.y + 9.81 * 0.85 * dt, z: v.z + (v.x / sp) * 6 * dt }, true);
      return false;
    }
    // Return leg: steer toward the owner's hands; reset the hit list once so it can tag on the way back
    if (!obj.boomReturning) { obj.boomReturning = true; obj.hitList.clear(); obj.hitList.add(owner); }
    const op = obj.getPosition(), pp = owner.getPosition();
    const dx = pp.x - op.x, dy = pp.y + 0.6 - op.y, dz = pp.z - op.z, dist = Math.hypot(dx, dy, dz) || 1;
    const k = Math.min(1, dt * 5);
    obj.body.setLinvel({
      x: v.x + (dx / dist * B.returnSpeed - v.x) * k,
      y: v.y + (dy / dist * B.returnSpeed - v.y) * k + 9.81 * dt,
      z: v.z + (dz / dist * B.returnSpeed - v.z) * k,
    }, true);
    if (Math.hypot(dx, dz) < B.catchRadius && Math.abs(dy) < 2.6) {
      obj.boomT = 0; obj.boomReturning = false;
      if (!owner.held && !owner.grabbedBy && owner.hitstun <= 0) {
        this._holdObject(owner, obj);
        this.addStyle(owner, 12, 'CATCH!');
        this.fx.hud?.popup?.('CATCH!', pp, 'small', 0x3fa9ff);
        this.fx.grab?.(owner, obj);
        return true;
      }
      obj.thrownTime = Math.min(obj.thrownTime, 0.2); // hands full: it bonks down at their feet
    }
    return false;
  }

  _updateBananaPeels() {
    for (const obj of this.arena.objects) {
      if (!obj.def?.slip || obj.isDebris || obj.isGrabbed || obj.broken || !obj.body) continue;
      const pp = obj.getPosition();
      for (const d of this.dweebs) {
        if (!d.active || !d.grounded || d.grabbedBy || d.held || d.ledge) continue;
        if ((d.slipCd || 0) > 0 || d.hitstun > 0 || d.ragdolling || d.freezeTimer > 0 || d.invulnTimer > 0) continue;
        const dp = d.getPosition();
        if (Math.abs(pp.y - dp.y) > 0.65) continue;
        const dx = pp.x - dp.x, dz = pp.z - dp.z;
        const dist = Math.hypot(dx, dz);
        if (dist > SLIP.radius) continue;

        const f = d.forward;
        const v = d.body.linvel();
        const side = (f.x * dz - f.z * dx) >= 0 ? 1 : -1;
        d.hitstun = Math.max(d.hitstun, SLIP.stun);
        d.slipCd = SLIP.cooldown;
        d.charging = 0;
        d.isCharging = false;
        d.attackAnim = 0;
        d.diveTimer = 0;
        d.slamActive = false;
        d.flipSpin = Math.max(d.flipSpin || 0, 0.9);
        d.body.setLinvel({
          x: v.x * 0.4 + f.x * SLIP.forward,
          y: Math.max(v.y, 1.5) + SLIP.up,
          z: v.z * 0.4 + f.z * SLIP.forward,
        }, true);
        d.body.setAngvel({ x: side * SLIP.spin, y: side * 2, z: side * SLIP.spin * 0.5 }, true);
        obj.pop(0.25);
        this.fx.slip(d);
      }
    }
  }

  _updateProjectiles(dt) {
    for (const obj of [...this.arena.objects]) {
      if (obj.isDebris || !obj.thrownBy || obj.thrownTime <= 0 || !obj.body) continue;
      obj.thrownTime -= dt;
      if (obj.def.boomerang && this._updateBoomerang(obj, dt)) continue;
      const v = obj.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const op = obj.getPosition();

      // Explosive barrels go off when they slam into anything
      if (obj.def.explosive && obj.lastSpeed > 8 && speed < obj.lastSpeed * 0.45) {
        this.explode(op, obj.thrownBy, obj);
        continue;
      }
      obj.lastSpeed = speed;
      if (obj.rocket?.fuel > 0) this._thrust(obj, dt);
      const prev = obj.prevPos ?? op;
      obj.prevPos = op;
      if (speed < 5) continue;

      // Swept test (last frame → now) so fast long-range throws can't tunnel past someone
      const r = (obj.def.dims.radius ?? Math.max(obj.def.dims.hx ?? 0.3, obj.def.dims.hz ?? 0.3)) + 0.5;
      for (const t of this.dweebs) {
        if (!t.active || obj.hitList.has(t) || t.grabbedBy) continue;
        // A held Dweeb soaks the throw before it reaches the holder.
        if (this._humanShieldBlock(t, obj, prev, op, v)) {
          if (obj.broken) break;
          continue;
        }
        if (segDist(prev, op, t.getPosition()) > r) continue;
        obj.hitList.add(t);
        const by = obj.thrownBy;
        const trick = this._trickshot(obj, t, op);
        if (trick.tags.length) {
          this.fx.trickshot(t, by, trick.tags, trick.dist);
          t.trickHitBy = by;
          t.trickHitTime = this.time;
          if (by !== t) this.addStyle(by, 12 * trick.tags.length, trick.tags.join(' · '));
        }
        if (obj.def.explosive) { this.explode(op, by, obj); break; }
        const w = obj.def.damage * (0.75 + Math.min(1, obj.body.mass() / 4) * 0.5);
        const yeet = obj.superYeet ? SUPER : 1;
        const sk = Math.min(1.4, speed / 18) * trick.bonus;
        _dir.set(v.x, 0, v.z).normalize();
        _dir.y = 0.45;
        const launch = t.receiveHit({ dir: _dir, ...scaled(A.thrown(w, sk), yeet, yeet), attacker: by, time: this.time });
        if (launch > 0) {
          this.status?.onHit(t, by, obj);
          this.fx.hit(t, by, launch, 'throw');
          // Rare drops land their own hit-effects: a thrown anvil should not read like a cake.
          // (Explosive rares go through explode() instead — the blast is their effect.)
          if (!obj.def.explosive && RARE[obj.key]) this.fx.rareHit?.(op, obj.key, launch);
          if (obj.superYeet) this.fx.superYeet(t, by);
          if (by !== t) this.addStyle(by, 5 + launch * 0.4);
        }
        if (obj.def.sticky && by !== t) {
          const tp = t.getPosition();
          t.gumTimer = obj.def.sticky.time;
          t.gumDef = obj.def.sticky;
          this.fx.hud?.popup('GUMMED!', { x: tp.x, y: tp.y + 1.2, z: tp.z }, 'big', 0xff7ac8);
          if (this.addStyle && by) this.addStyle(by, 6, 'GUMMED');
          this.arena.removeObject(obj);
          break;
        }
        obj.superYeet = false;
        // Bowling balls plough on through; everything else rebounds off the victim
        const keep = obj.def.multiHit ? 0.7 : -0.25;
        obj.body.setLinvel({ x: v.x * keep, y: Math.abs(v.y) * 0.3 + (obj.def.roll ? 0.5 : 3), z: v.z * keep }, true);
        if (this.damageObject(obj, 2500, by, { dir: { x: v.x, y: 0, z: v.z }, speed: Math.hypot(v.x, v.z) })) break;
      }
    }
  }

  /** Thrown Dweebs bowl through nearby rivals for a short window after a throw. */
  _updateThrownDweebs(dt) {
    const B = BALANCE.dweebThrow?.bowling;
    if (!B || !this.dweebs?.length) return;
    for (const d of this.dweebs) {
      if (!d || !d.active || !(d.thrownTimer > 0) || !d.thrownBy) continue;
      d.thrownTimer -= dt;
      // Landing, a timeout, or being grabbed ends the projectile state.
      // (grounded is ignored for the first beat: the flag can still be stale from the throw frame)
      if ((d.grounded && d.thrownTimer < B.life - 0.15) || d.grabbedBy || d.thrownTimer <= 0) {
        this._stopBowling(d);
        continue;
      }
      const p = d.getPosition();
      const by = d.thrownBy;
      for (const t of this.dweebs) {
        if (!t || t === d || !t.active || t.grabbedBy || t === by) continue;
        // No friendly fire: neither the thrower's team nor the flying Dweeb's team.
        if (this._sameTeam(by, t) || this._sameTeam(d, t)) continue;
        if (d.bowlingHits?.has(t)) continue;
        const tp = t.getPosition();
        if (Math.hypot(tp.x - p.x, tp.y - p.y, tp.z - p.z) > B.radius) continue;
        (d.bowlingHits ??= new Set()).add(t);
        _dir.set(tp.x - p.x, 0.35, tp.z - p.z);
        if (_dir.lengthSq() < 1e-4) _dir.set(0, 1, 0);
        const atk = A.thrown(B.damage, 1);
        const launch = t.receiveHit({ dir: _dir.normalize(), ...atk, attacker: by, time: this.time });
        if (launch <= 0) continue;
        const hits = Math.max(1, d.bowlingHits.size - 2);
        if (typeof this.fx.bowlingHit === 'function') this.fx.bowlingHit(t, by, launch, hits);
        else this.fx.hit(t, by, launch, 'throw');
        if (by && by !== t) this.addStyle(by, 8 + launch * 0.4, hits >= 2 ? 'DOUBLE STRIKE' : 'STRIKE');
      }
    }
  }

  /** Cancel a thrown Dweeb's projectile state and forget its hit list. */
  _stopBowling(d) {
    d.thrownBy = null;
    d.thrownTimer = 0;
    if (d.bowlingHits) d.bowlingHits.clear();
  }

  /** Teams are optional; only matching non-null team tags count as friendly. */
  _sameTeam(a, b) {
    return !!(a && b && a.team != null && b.team != null && a.team === b.team);
  }

  /** A held Dweeb intercepts an incoming thrown prop: redirect ~60% of the hit to the shield. */
  _humanShieldBlock(holder, obj, prev, op, v) {
    const shield = holder.held?.kind === 'dweeb' ? holder.held.ref : null;
    const S = BALANCE.humanShield;
    if (!shield || !shield.active || !shield.shieldPoint) return false;
    if (obj.def?.explosive || obj.thrownBy === shield) return false;
    const dims = obj.def?.dims ?? {};
    const pr = dims.radius ?? Math.max(dims.hx ?? 0.3, dims.hz ?? 0.3);
    if (segDist(prev, op, shield.shieldPoint) > pr + S.pad) return false;

    obj.hitList.add(holder);
    const by = obj.thrownBy;
    const speed = Math.hypot(v.x, v.y, v.z);
    const w = (obj.def?.damage ?? 1) * (0.75 + Math.min(1, obj.body.mass() / 4) * 0.5);
    const yeet = obj.superYeet ? SUPER : 1;
    const sk = Math.min(1.4, speed / 18);
    _dir.set(v.x, 0, v.z);
    if (_dir.lengthSq() < 1e-4) _dir.set(holder.forward.x, 0, holder.forward.z);
    _dir.normalize();
    _dir.y = 0.45;
    const atk = scaled(A.thrown(w, sk), yeet * S.damageScale, yeet * S.damageScale);
    const launch = shield.receiveHit({ dir: _dir, ...atk, attacker: by, time: this.time });
    shield.escapeTimer = Math.max(0, shield.escapeTimer || 0) + S.escapeBonus;
    this.fx.humanShield?.(holder, shield, launch);
    this.addStyle(holder, S.style, 'BLOCKED!');
    if (!shield.active || shield.out || shield.eliminated) this.drop(holder);
    obj.superYeet = false;
    const keep = obj.def.multiHit ? 0.7 : -0.25;
    obj.body.setLinvel({ x: v.x * keep, y: Math.abs(v.y) * 0.3 + (obj.def.roll ? 0.5 : 3), z: v.z * keep }, true);
    if (obj.applyDamage(2500)) this.breakObject(obj, by);
    return true;
  }

  /** Style points for a thrown hit: distance, bank shots, ricochets, air shots. Each adds knockback. */
  _trickshot(obj, t, op) {
    const tags = [];
    const o = obj.throwOrigin;
    const dist = o ? Math.hypot(op.x - o.x, op.z - o.z) : 0;
    if (dist >= 18) tags.push('SNIPED');
    else if (dist >= 11) tags.push('LONG SHOT');
    if (obj.banked) tags.push('BANK SHOT');
    else if (obj.bounces > 0) tags.push('RICOCHET');
    else if (obj.skips > 0 && dist >= 6) tags.push('SKIP SHOT');
    const tp = t.getPosition();
    if (!t.grounded && tp.y - t.groundY > 1.4) tags.push('AIR SHOT');
    if (obj.jumpShot && dist >= 7) tags.push('JUMP SHOT');
    return { tags, dist, bonus: 1 + 0.2 * Math.min(3, tags.length) };
  }

  _thrust(obj, dt) {
    const r = obj.rocket;
    r.fuel -= dt;
    obj.body.setLinvel({ x: r.dir.x * ROCKET_SPEED, y: r.dir.y * ROCKET_SPEED, z: r.dir.z * ROCKET_SPEED }, true);
    obj.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    _rq.setFromUnitVectors(_up, r.dir);
    obj.body.setRotation({ x: _rq.x, y: _rq.y, z: _rq.z, w: _rq.w }, true);
    obj.lastSpeed = ROCKET_SPEED;
    this.fx.rocketSmoke(obj.getPosition(), r.dir);
  }

  _updateHazards() {
    const arena = this.arena;
    // Trampolines: land on the bed → boing up high (keeps your double jump for steering)
    for (const d of this.dweebs) {
      if (!d.active || d.grabbedBy) continue;
      const p = d.getPosition();
      const v = d.body.linvel();
      for (const t of arena.trampolines) {
        if (v.y > 2 || p.y > TRAMPOLINE_TOP + 1.1 || p.y < TRAMPOLINE_TOP) continue;
        if (Math.hypot(p.x - t.x, p.z - t.z) > TRAMPOLINE_RADIUS) continue;
        const boost = d.jumpRequested || v.y < -8 ? 1.12 : 1; // timing a jump (or diving in) bounces higher
        const kh = BALANCE.bounce.trampolineKeepH;
        d.body.setLinvel({ x: v.x * kh, y: TRAMPOLINE_VEL * boost, z: v.z * kh }, true);
        d.jumpsLeft = 1;
        d.landSquash = -0.4;
        arena.bounceTrampoline(t);
        this.fx.bounce({ x: t.x, y: TRAMPOLINE_TOP, z: t.z }, t.color);
      }
    }

    for (const d of this.dweebs) {
      if (!d.active || d.hazardCd > 0 || d.grabbedBy) continue;
      const p = d.getPosition();
      const feet = p.y - 0.5;

      for (const s of arena.spinners) {
        const c = Math.cos(s.angle), sn = Math.sin(s.angle);
        const lx = p.x * c - p.z * sn;
        const lz = p.x * sn + p.z * c;
        if (Math.abs(lx) < s.half && Math.abs(lz) < 0.65 && feet < s.y + 0.3 && feet > -0.5) {
          const sign = Math.sign(s.speed) || 1;
          _dir.set(p.z * sign, 0, -p.x * sign).normalize();
          _tmp.set(p.x, 0, p.z).normalize().multiplyScalar(0.4);
          _dir.add(_tmp).setY(0.6);
          const launch = d.receiveHit({ dir: _dir, ...A.spinner, attacker: null, time: this.time });
          if (launch > 0) this.fx.hit(d, null, launch, 'hazard');
          d.hazardCd = 0.8;
        }
      }

      for (const pend of arena.pendulums) {
        const dist = Math.hypot(p.x - pend.pos.x, p.y - pend.pos.y, p.z - pend.pos.z);
        if (dist > 1.45 || pend.vel.length() < 3) continue;
        _dir.copy(pend.vel).setY(0).normalize();
        _dir.y = 0.5;
        const launch = d.receiveHit({ dir: _dir, ...A.pendulum, attacker: null, time: this.time });
        if (launch > 0) this.fx.hit(d, null, launch, 'hazard');
        d.hazardCd = 0.8;
      }

      // Pinball bumpers: no damage, just a big shove (the last attacker keeps KO credit)
      for (const b of arena.bumpers) {
        const dx = p.x - b.x, dz = p.z - b.z;
        const dist = Math.hypot(dx, dz);
        if (dist > BUMPER_RADIUS + 0.5 || p.y > 1.8) continue;
        const v = d.body.linvel();
        const B = BALANCE.bounce;
        const boost = this.arena.bumperBoost || 1;
        const push = (B.bumperPush + Math.min(B.bumperPushMax, Math.hypot(v.x, v.z) * B.bumperPushGain)) * boost;
        d.body.setLinvel({ x: (dx / (dist || 1)) * push, y: B.bumperUp * Math.min(1.35, boost), z: (dz / (dist || 1)) * push }, true);
        d.hitstun = Math.max(d.hitstun, 0.3);
        d.hazardCd = 0.35;
        // Bouncing a victim off a bumper is style for whoever launched them
        if (d.lastHitBy && d.lastHitBy !== d && this.time - d.lastHitTime < 2) this.addStyle(d.lastHitBy, 10, 'BUMPER BANK');
        arena.hitBumper(b);
        this.fx.bumper({ x: b.x, y: 1, z: b.z }, b.color, true);
        break;
      }
    }
  }

  _updatePickups() {
    for (const pu of [...this.arena.powerups]) {
      if (!pu.landed && pu.group.position.y > 3) continue;
      const pp = pu.group.position;
      for (const d of this.dweebs) {
        if (!d.active) continue;
        const p = d.getPosition();
        if (Math.hypot(p.x - pp.x, p.y - pp.y, p.z - pp.z) < 1.3) {
          if (pu.kind === 'freeze') this.freezeBurst(d);
          else if (pu.kind === 'magnet') {
            d.applyPowerUp('magnet');
            this.fx.magnet?.(d);
          } else if (pu.kind === 'swap') {
            this._doSwap(d);
          } else d.applyPowerUp(pu.kind);
          this.fx.pickup(d, pu);
          this.arena.removePowerUp(pu);
          break;
        }
      }
    }
  }

  /** Update all rideable objects (hoverboards): mount, dismount, and riding physics. */
  _updateRideables(dt) {
    if (!this.dweebs?.length) return;
    // A board that despawned, broke or got grabbed out from under its rider releases them
    for (const d of this.dweebs) {
      const b = d.riding;
      if (b && (b.isGrabbed || b.broken || !b.body || !this.arena.objects.includes(b))) {
        d.riding = null; d.hoverRiding = false; d.hoverAirT = 0;
        if (b.rider === d) b.rider = null;
      }
    }

    for (const obj of this.arena.objects) {
      // Only process rideable objects that are not grabbed
      if (!obj.def?.rideable || obj.isGrabbed || !obj.body) continue;

      const board = obj;
      const bp = board.getPosition();

      // --- Dismount if rider is invalid ---
      if (board.rider) {
        const r = board.rider;
        if (!r.active || r.riding !== board || r.hitstun > 0 || r.ragdolling || r.grabbedBy) {
          this._dismount(r, board);
        }
      }

      // --- Try to mount ---
      if (!board.rider) {
        for (const d of this.dweebs) {
          // Ignore bots in first pass
          if (!d.isPlayer) continue;
          if (!d.active || d.riding || d.grabbedBy || d.held?.kind === 'dweeb' || d.isCharging) continue;
          // Must be grounded to mount
          if (!d.grounded && d.coyote <= 0) continue;

          const dp = d.getPosition();
          const dx = Math.abs(dp.x - bp.x);
          const dz = Math.abs(dp.z - bp.z);
          const horizDist = Math.hypot(dx, dz);
          const vertDist = dp.y - bp.y;

          // Check if Dweeb is above and near the board
          if (horizDist <= HOVER_MOUNT_HORIZ && vertDist >= 0.3 && vertDist <= HOVER_MOUNT_VERT) {
            this._mount(d, board);
            break; // one rider per board
          }
        }
      }

      // --- Riding physics ---
      if (board.rider) {
        const r = board.rider;
        if (!r.active) { this._dismount(r, board); continue; }

        // The rider's own movement drives (see Dweeb.preStep: hoverRiding = faster, slidey);
        // the board just glides along underneath their feet.
        const rp = r.getPosition();
        const v = r.body.linvel();
        if (r.grounded) board.body.setTranslation({ x: rp.x, y: rp.y - HOVER_RIDE_OFFSET, z: rp.z }, true);
        board.body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
        board.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

        // Jumping (or getting launched) pops the rider off after a short airborne beat
        r.hoverAirT = r.grounded ? 0 : (r.hoverAirT || 0) + dt;
        if (r.hoverAirT > 0.25) {
          this._dismount(r, board);
          continue;
        }

      }
    }
  }

  _mount(d, board) {
    d.riding = board;
    board.rider = d;
    // Dweeb.preStep reads this: faster top speed, slidey accel
    d.hoverRiding = true;
    d.hoverAirT = 0;
    this.fx.hoverMount?.(d, board);
  }

  _dismount(d, board) {
    if (d.riding !== board) return;
    d.riding = null;
    board.rider = null;
    d.hoverRiding = false;
    d.hoverAirT = 0;
    // Pop visual feedback
    this.fx.hoverDismount?.(d, board);
  }

  /** SWAP powerup: find nearest active non-eliminated non-grabbed rival within 18m; swap positions (+0.3y) and velocities; give both invulnTimer = max(current, 0.7); fx + audio. If no rival, give 3s sugar-like speed boost. */
  _doSwap(d) {
    const pos = d.getPosition();
    let best = null, bestDist = 18;
    for (const t of this.dweebs) {
      if (t === d || !t.active || t.grabbedBy) continue;
      const tp = t.getPosition();
      const dist = Math.hypot(tp.x - pos.x, tp.y - pos.y, tp.z - pos.z);
      if (dist < bestDist) { bestDist = dist; best = t; }
    }
    const swapColor = 0xb07cff;
    if (best) {
      const tp = best.getPosition();
      const dpos = { x: pos.x, y: pos.y + 0.3, z: pos.z };
      const tpos = { x: tp.x, y: tp.y + 0.3, z: tp.z };
      const dvel = d.body.linvel();
      const tvel = best.body.linvel();
      d.body.setTranslation(tpos, true);
      best.body.setTranslation(dpos, true);
      d.body.setLinvel(tvel, true);
      best.body.setLinvel(dvel, true);
      d.invulnTimer = Math.max(d.invulnTimer, 0.7);
      best.invulnTimer = Math.max(best.invulnTimer, 0.7);
      this.fx.particles.confetti(pos, 24);
      this.fx.particles.confetti(tp, 24);
      this.fx.particles.ring(pos, { color: swapColor, size: 3, life: 0.4 });
      this.fx.particles.ring(tp, { color: swapColor, size: 3, life: 0.4 });
      this.fx.hud.popup('SWAP!', pos, 'big', swapColor);
      this.fx.hud.popup('SWAP!', tp, 'big', swapColor);
      this.fx.audio.playWhoosh(this.fx._pan(pos), 0.7);
      this.fx.audio.playWhoosh(this.fx._pan(tp), 0.7);
    } else {
      // No rival: sugar-like speed boost for 3s
      if (BALANCE.powerups.sugar) {
        d.sugarTimer = Math.max(d.sugarTimer, 3);
      }
      this.fx.particles.confetti(pos, 16);
      this.fx.particles.ring(pos, { color: swapColor, size: 2.5, life: 0.3 });
      this.fx.hud.popup('SWAP!', pos, 'big', swapColor);
      this.fx.audio.playWhoosh(this.fx._pan(pos), 0.7);
    }
  }
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Distance from point p to segment a→b. */
function segDist(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  const k = l2 > 1e-8 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2)) : 0;
  return Math.hypot(a.x + abx * k - p.x, a.y + aby * k - p.y, a.z + abz * k - p.z);
}
