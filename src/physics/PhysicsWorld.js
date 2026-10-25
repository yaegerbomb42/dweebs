// PhysicsWorld.js — the game's physics layer on top of the Rapier solver.
//
// What this layer adds over raw Rapier:
//   • Stable stepping: each frame is split into equal sub-steps of ≤ 1/60 s (max 4), so fast
//     throws never tunnel and frame hitches never blow up the simulation.
//   • A collider registry (handle → { kind, material, ref, mass }) so any contact can be traced
//     back to a Dweeb, an item, a hazard or the stage.
//   • Impact detection from each body's change in velocity (Δv) across a sub-step, reported as
//     { a, b, speed, pos } — this drives material-aware impact sounds and breakage.
//   • Rolling telemetry (rollSpeed) for the rolling-noise loop in the audio engine.
//   • Game-mass: items specify mass directly (a Dweeb weighs 3), never derived from densities.

import RAPIER from '@dimforge/rapier3d-compat';
import { getMaterial } from './Materials.js';

export const CollisionGroups = {
  GROUND:  0x0001,
  PLAYER:  0x0002,
  OBJECT:  0x0004,
  DEBRIS:  0x0008,
  SENSOR:  0x0010,
  WALL:    0x0020,
  ALL:     0xFFFF,
};

export const DWEEB_MASS = 3;
const MAX_STEP = 1 / 60;
const MAX_SUBSTEPS = 4;
const GRAVITY = -25;        // heavier than Earth for a snappy toy feel
const MIN_IMPACT = 1.2;     // m/s of Δv before a contact counts as an impact

export class PhysicsWorld {
  constructor() {
    this.world = null;
    this.bodies = new Map();       // id -> { rigid, collider, type, props }
    this.colliderInfo = new Map(); // collider handle -> { kind, material, ref, mass, rigid, dynamic }
    this.impacts = [];             // impacts from the last step() call
    this.contactEvents = [];
    this.eventQueue = null;
    this.maxDebris = 120;
    this.debrisCount = 0;
    this.initialized = false;
    this._nextId = 1;
    this.rollSpeed = 0;
    this.gravityScale = 1;
    this.baseGravity = GRAVITY;
  }

  async init() {
    await RAPIER.init();
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World(new RAPIER.Vector3(0, this.baseGravity, 0));
    this.world.numSolverIterations = 8; // a couple more passes keeps piles and multi-body scrums calm
    this.eventQueue = new RAPIER.EventQueue(true);
    this.initialized = true;
  }

  /**
   * World gravity as a multiple of the standard 25 m/s². Arena character, not a physics tweak:
   * the Moonbase runs at 0.58 and props float with it. Idempotent, safe between matches.
   */
  setGravityScale(scale = 1) {
    if (!this.world) return;
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    if (Math.abs(s - this.gravityScale) < 1e-4) return;
    this.gravityScale = s;
    this.world.gravity = new this.RAPIER.Vector3(0, this.baseGravity * s, 0);
  }

  /** Advance the simulation by dt seconds using equal sub-steps. */
  step(dt) {
    if (!this.initialized || dt <= 0) return;
    dt = Math.min(dt, MAX_STEP * MAX_SUBSTEPS);
    const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6));
    this.world.timestep = dt / n;
    this.impacts = [];
    this.contactEvents = [];
    for (let i = 0; i < n; i++) {
      this._recordVelocities();
      this.world.step(this.eventQueue);
      this._processEvents();
    }
    this._measureRolling();
  }

  _recordVelocities() {
    for (const info of this.colliderInfo.values()) {
      if (!info.dynamic) continue;
      const v = info.rigid.linvel();
      info.pv.x = v.x; info.pv.y = v.y; info.pv.z = v.z;
    }
  }

  _dv(info) {
    if (!info?.dynamic || !info.rigid.isDynamic()) return 0;
    const v = info.rigid.linvel();
    return Math.hypot(v.x - info.pv.x, v.y - info.pv.y, v.z - info.pv.z);
  }

  _processEvents() {
    this.eventQueue.drainContactForceEvents(event => {
      const h1 = event.collider1(), h2 = event.collider2();
      const force = event.totalForceMagnitude();
      this.contactEvents.push({ handle1: h1, handle2: h2, totalForce: force });
      const a = this.colliderInfo.get(h1), b = this.colliderInfo.get(h2);
      if (!a || !b) return;
      const speed = Math.max(this._dv(a), this._dv(b));
      if (speed < MIN_IMPACT) return;
      // One impact per pair per frame (the hardest sub-step wins)
      const existing = this.impacts.find(i => (i.a === a && i.b === b) || (i.a === b && i.b === a));
      if (existing) { existing.speed = Math.max(existing.speed, speed); return; }
      const src = a.dynamic ? a : b;
      const p = src.rigid.translation();
      this.impacts.push({ a, b, speed, force, pos: { x: p.x, y: p.y, z: p.z } });
    });
  }

  /** Sum of speeds of round things rolling along a surface (drives the rolling-noise loop). */
  _measureRolling() {
    let roll = 0;
    for (const info of this.colliderInfo.values()) {
      if (!info.round || !info.rigid.isDynamic() || info.rigid.isSleeping()) continue;
      const v = info.rigid.linvel();
      if (Math.abs(v.y) > 1.2) continue;
      const w = info.rigid.angvel();
      const spin = Math.hypot(w.x, w.y, w.z) * info.radius;
      const along = Math.hypot(v.x, v.z);
      if (spin < along * 0.5) continue; // sliding or flying, not rolling
      roll += along * Math.min(1.5, 0.4 + info.mass / 3);
    }
    this.rollSpeed = roll;
  }

  getImpacts() {
    return this.impacts;
  }

  getContactEvents() {
    return this.contactEvents;
  }

  register(collider, info) {
    const entry = { ...info, rigid: collider.parent(), pv: { x: 0, y: 0, z: 0 } };
    this.colliderInfo.set(collider.handle, entry);
    return entry;
  }

  infoFor(collider) {
    return this.colliderInfo.get(collider.handle);
  }

  // ─── Static geometry ───

  _fixed(x, y, z, desc, mat, prefix, group = CollisionGroups.GROUND) {
    const material = getMaterial(mat);
    const body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const collider = this.world.createCollider(desc
      .setFriction(material.friction)
      .setRestitution(material.restitution)
      .setCollisionGroups(this._makeGroups(group, CollisionGroups.ALL)), body);
    const id = `${prefix}_${this._nextId++}`;
    this.bodies.set(id, { rigid: body, collider, type: 'static', material: mat });
    this.register(collider, { kind: 'stage', material: mat });
    return { id, body, collider };
  }

  createStaticBox(x, y, z, hw, hh, hd, mat = 'toy') {
    return this._fixed(x, y, z, this.RAPIER.ColliderDesc.cuboid(hw, hh, hd), mat, 'static', CollisionGroups.WALL);
  }

  /** Fixed body with a convex-hull collider (points in body-local space) */
  createFixedHull(x, y, z, points, mat = 'toy') {
    return this._fixed(x, y, z, this.RAPIER.ColliderDesc.convexHull(points), mat, 'hull');
  }

  createFixedCylinder(x, y, z, radius, halfHeight, mat = 'toy') {
    return this._fixed(x, y, z, this.RAPIER.ColliderDesc.cylinder(halfHeight, radius), mat, 'cyl');
  }

  /** Kinematic hazard (spinner bar, wrecking cube) */
  createKinematicShape(x, y, z, shape, dims, restitution = 0.4, mat = 'wood') {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const desc = shape === 'sphere' ? R.ColliderDesc.ball(dims.radius)
      : shape === 'cylinder' ? R.ColliderDesc.cylinder(dims.halfHeight, dims.radius)
        : R.ColliderDesc.cuboid(dims.hx, dims.hy, dims.hz);
    desc.setFriction(0.6).setRestitution(restitution)
      .setCollisionGroups(this._makeGroups(CollisionGroups.WALL, CollisionGroups.ALL));
    const collider = this.world.createCollider(desc, body);
    const id = `kin_${this._nextId++}`;
    this.bodies.set(id, { rigid: body, collider, type: 'kinematic' });
    this.register(collider, { kind: 'hazard', material: mat });
    return { id, body, collider };
  }

  // ─── Dynamic bodies ───

  /**
   * Create a throwable item. `props.mass` is game-mass (a Dweeb weighs 3).
   * Items get CCD, material friction/bounce, rounded edges and light air drag.
   */
  createDynamicBody(x, y, z, shape, dims, props = {}) {
    const R = this.RAPIER;
    const material = getMaterial(props.material || 'wood');
    const isDebris = !!props.isDebris;
    const round = shape === 'sphere' || shape === 'cylinder' || shape === 'capsule';
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      // Round props keep their spin and roll; boxy props shed energy as they tumble.
      .setLinearDamping(isDebris ? 0.5 : 0.06)
      .setAngularDamping(isDebris ? 1 : round ? 0.12 : 0.28)
      .setCcdEnabled(!isDebris));

    let desc;
    let radius = 0.3;
    switch (shape) {
      case 'sphere':
        desc = R.ColliderDesc.ball(dims.radius);
        radius = dims.radius;
        break;
      case 'capsule':
        desc = R.ColliderDesc.capsule(dims.halfHeight, dims.radius);
        radius = dims.radius;
        break;
      case 'cylinder': {
        // Round-edged cylinders roll and tumble far more nicely than sharp ones
        const b = Math.min(0.03, dims.radius * 0.3, dims.halfHeight * 0.3);
        desc = R.ColliderDesc.roundCylinder(dims.halfHeight - b, dims.radius - b, b);
        radius = dims.radius;
        break;
      }
      default: {
        const b = Math.min(0.03, dims.hx * 0.3, dims.hy * 0.3, dims.hz * 0.3);
        desc = R.ColliderDesc.roundCuboid(dims.hx - b, dims.hy - b, dims.hz - b, b);
      }
    }
    const mass = props.mass ?? 1;
    desc.setMass(mass)
      .setFriction(material.friction)
      .setRestitution(material.restitution);
    if (isDebris) {
      desc.setCollisionGroups(this._makeGroups(CollisionGroups.DEBRIS, CollisionGroups.GROUND | CollisionGroups.WALL | CollisionGroups.OBJECT));
    } else {
      desc.setCollisionGroups(this._makeGroups(props.group || CollisionGroups.OBJECT, props.mask || CollisionGroups.ALL))
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(1);
    }
    const collider = this.world.createCollider(desc, body);

    const id = props.id || `dyn_${this._nextId++}`;
    this.bodies.set(id, { rigid: body, collider, type: 'dynamic', material: material.name, props });
    if (!isDebris) {
      this.register(collider, {
        kind: 'object', material: material.name, ref: props.ref || null, dynamic: true, mass,
        round: shape === 'sphere' || shape === 'cylinder' || shape === 'capsule', radius,
      });
    }
    return { id, body, collider };
  }

  /** Dynamic capsule for a Dweeb (rotation locked until ragdolled, velocity-driven movement) */
  createCharacterBody(x, y, z, radius = 0.4, halfHeight = 0.35, ref = null, mass = DWEEB_MASS) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0)
      .setAngularDamping(1.5)
      .setCcdEnabled(true)
      .lockRotations());
    const collider = this.world.createCollider(R.ColliderDesc.capsule(halfHeight, radius)
      .setMass(mass)
      .setFriction(0)                 // movement is velocity-driven; never stick to walls
      .setFrictionCombineRule(R.CoefficientCombineRule.Min)
      .setRestitution(0.14)           // a hint of toy bounce on shoulder-first collisions
      .setCollisionGroups(this._makeGroups(CollisionGroups.PLAYER, CollisionGroups.ALL))
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(1), body);
    const id = `char_${this._nextId++}`;
    this.bodies.set(id, { rigid: body, collider, type: 'character' });
    this.register(collider, { kind: 'dweeb', material: 'toy', ref, dynamic: true, mass });
    return { id, body, collider };
  }

  removeBody(id) {
    const entry = this.bodies.get(id);
    if (!entry) return;
    if (entry.collider) this.colliderInfo.delete(entry.collider.handle);
    this.world.removeRigidBody(entry.rigid);
    this.bodies.delete(id);
  }

  applyImpulse(body, impulse) {
    body.applyImpulse(new this.RAPIER.Vector3(impulse.x, impulse.y, impulse.z), true);
  }

  applyTorqueImpulse(body, torque) {
    body.applyTorqueImpulse(new this.RAPIER.Vector3(torque.x, torque.y, torque.z), true);
  }

  /** Raycast against solid geometry (debris and sensors are ignored) */
  raycast(origin, dir, maxDist = 100, excludeCollider = null, filterGroups = undefined) {
    const R = this.RAPIER;
    const ray = new R.Ray(new R.Vector3(origin.x, origin.y, origin.z), new R.Vector3(dir.x, dir.y, dir.z));
    const hit = this.world.castRay(ray, maxDist, true, undefined, filterGroups, excludeCollider ?? undefined, undefined,
      c => !c.isSensor() && !((c.collisionGroups() >>> 16) & CollisionGroups.DEBRIS));
    if (!hit) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    return { point: { x: point.x, y: point.y, z: point.z }, distance: hit.timeOfImpact, collider: hit.collider };
  }

  /** Create collision group membership/filter pair */
  _makeGroups(membership, filter) {
    return (membership << 16) | filter;
  }

  makeGroups(membership, filter) {
    return this._makeGroups(membership, filter);
  }

  getPosition(body) {
    const t = body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  getRotation(body) {
    const r = body.rotation();
    return { x: r.x, y: r.y, z: r.z, w: r.w };
  }

  addDebris() {
    this.debrisCount++;
    return this.debrisCount <= this.maxDebris;
  }

  removeDebris() {
    this.debrisCount = Math.max(0, this.debrisCount - 1);
  }
}
