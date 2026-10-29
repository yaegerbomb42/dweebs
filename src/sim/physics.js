// src/sim/physics.js — the sim's Rapier world, and the snapshot that makes it resumable.
//
// This is the ONLY file in src/sim/ that imports Rapier, and that boundary is deliberate: the
// contract, the RNG, the checksum, the bots and the match rules are pure JS, so a test or a tool
// can import them without paying for a WASM download. NET's server and the browser client both go
// through this one file to get identical physics.
//
// ─── On `rapier3d-deterministic-compat` (evaluated; full write-up in WHY.md) ───
// Both `@dimforge/rapier3d-compat` and `@dimforge/rapier3d-deterministic-compat` are at 0.21.0,
// and Rapier's own docs state the WASM/TS/JS build "is fully cross-platform deterministic": same
// version, same initial conditions, same construction order, same number of steps ⇒ same results,
// including a byte-identical `world.takeSnapshot()`. The two packages differ in PACKAGING, not in
// determinism — `-compat` inlines the WASM as base64 so it loads with no bundler and no .wasm file
// on disk, which is exactly what a Node server wants. So there is nothing to buy by switching and
// we keep `-compat`, which is already a dependency. The real determinism risk is on OUR side of
// the boundary: Math.sin/Math.cos in gameplay code, which the same Rapier page explicitly flags
// as not cross-platform deterministic.

import RAPIER from '@dimforge/rapier3d-compat';
import { itemDef } from './tables.js';

export const GRAVITY = -25;          // heavier than Earth, for the snappy toy feel
export const DWEEB_MASS = 3;
export const RADIUS = 0.36;
export const HALF_HEIGHT = 0.14;
const ANGULAR_DAMPING = 1.5;          // capsule default, matching the live PhysicsWorld

let rapierReady = null;

/** Await Rapier's WASM exactly once per process, however many sims are created. */
export function initPhysics() {
  if (!rapierReady) rapierReady = RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

/** Collision groups, same bit layout as src/physics/PhysicsWorld.js. */
export const Groups = {
  GROUND: 0x0001, PLAYER: 0x0002, OBJECT: 0x0004, DEBRIS: 0x0008, SENSOR: 0x0010, ALL: 0xffff,
};
const groups = (member, filter) => (member << 16) | filter;

/**
 * A thin, fully-owned Rapier world. Bodies are addressed by the sim's own integer entity ids
 * rather than by Rapier handles, because handles are not stable across a restore and the network
 * needs ids that are.
 */
export class SimPhysics {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.numSolverIterations = 6;
    this.world.timestep = 1 / 60;
    /** @type {Map<number, {body: object, kind: string, id: number}>} entity id → body */
    this.bodies = new Map();
    /** @type {Map<number, number>} Rapier collider handle → entity id */
    this.byCollider = new Map();
    /** @type {Map<number, string>} entity id → kind, kept so a restore can rebuild the index. */
    this.kinds = new Map();
  }

  static async create() {
    await initPhysics();
    return new SimPhysics();
  }

  /** The island floor, as one fat fixed cylinder (see arena.js for why not 17 tiles). */
  fixedCylinder(x, y, z, radius, halfHeight) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius)
        .setFriction(0.7)
        .setRestitution(0.1)
        .setCollisionGroups(groups(Groups.GROUND, Groups.ALL)),
      body,
    );
    this.byCollider.set(col.handle, 0);
    return body;
  }

  /**
   * A dweeb capsule. Rotation is locked until a ragdoll unlocks it, exactly as the live
   * PhysicsWorld does it, so a launched dweeb tumbles and a walking one does not.
   */
  character(x, y, z, id) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0)
      .setAngularDamping(ANGULAR_DAMPING)
      .setCcdEnabled(true)
      .lockRotations());
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS)
        .setMass(DWEEB_MASS)
        .setFriction(0)                     // movement is velocity-driven; never stick to walls
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.1)
        .setCollisionGroups(groups(Groups.PLAYER, Groups.ALL)),
      body,
    );
    this.bodies.set(id, { body, kind: 'dweeb', id });
    this.kinds.set(id, 'dweeb');
    this.byCollider.set(col.handle, id);
    return body;
  }

  /** An item body, shaped from its table entry. */
  item(x, y, z, key, id) {
    const d = itemDef(key);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0.06)               // item linear damping, matching the live feel
      .setAngularDamping(0.1)
      .setCcdEnabled(true));
    let desc;
    switch (d.shape) {
      case 'ball':
      case 'sphere': desc = RAPIER.ColliderDesc.ball(d.r); break;
      case 'cylinder': desc = RAPIER.ColliderDesc.cylinder(d.hy, d.r); break;
      case 'cone': desc = RAPIER.ColliderDesc.cone(d.hy, d.r); break;
      default: desc = RAPIER.ColliderDesc.cuboid(d.hx, d.hy, d.hz);
    }
    const col = this.world.createCollider(desc
      .setMass(d.mass)
      .setFriction(0.6)
      .setRestitution(0.25)
      .setCollisionGroups(groups(Groups.OBJECT, Groups.ALL)), body);
    this.bodies.set(id, { body, kind: 'item', id, key });
    this.kinds.set(id, 'item');
    this.byCollider.set(col.handle, id);
    return body;
  }

  remove(id) {
    const e = this.bodies.get(id);
    if (!e) return;
    for (let i = 0; i < e.body.numColliders(); i++) this.byCollider.delete(e.body.collider(i).handle);
    this.world.removeRigidBody(e.body);
    this.bodies.delete(id);
    this.kinds.delete(id);
  }

  /** Advance exactly one fixed tick. The sim never calls this with anything but 1/60. */
  step() { this.world.step(); }

  body(id) { return this.bodies.get(id)?.body ?? null; }
  pos(id) { const b = this.body(id); return b ? b.translation() : { x: 0, y: 0, z: 0 }; }
  vel(id) { const b = this.body(id); return b ? b.linvel() : { x: 0, y: 0, z: 0 }; }
  angvel(id) { const b = this.body(id); return b ? b.angvel() : { x: 0, y: 0, z: 0 }; }
  setPos(id, x, y, z) { this.body(id)?.setTranslation({ x, y, z }, true); }
  setVel(id, x, y, z) { this.body(id)?.setLinvel({ x, y, z }, true); }
  setAngvel(id, x, y, z) { this.body(id)?.setAngvel({ x, y, z }, true); }
  setGravityScale(id, s) { this.body(id)?.setGravityScale(s, true); }
  lockRotations(id, on) { this.body(id)?.lockRotations(!!on, true); }

  /** Ray from a point along a direction; used by the aim preview and by bots. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(Groups.ALL, Groups.ALL));
    if (!hit) return null;
    return { distance: hit.timeOfImpact, id: this.byCollider.get(hit.collider.handle) ?? 0 };
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────────────

  /**
   * The whole world as raw bytes: `world.takeSnapshot()` verbatim — bodies, colliders, joints and
   * island data. This is the expensive part of a snapshot (~1–3 KB at 40 items) and the reason
   * NET sends state deltas at 20–30 Hz and reserves a full snapshot for join and hard desync.
   * @returns {Uint8Array}
   */
  takeSnapshot() { return this.world.takeSnapshot(); }

  /**
   * Replace the world with a restored one.
   *
   * The subtlety worth writing down: `World.restoreSnapshot` hands back a NEW World with NEW
   * handles, so the `bodies` / `byCollider` / `kinds` maps are all stale afterwards. They are
   * rebuilt by replaying an id list against Rapier's body order — which is `forEach` (slot)
   * order, NOT creation order and NOT map insertion order: a removed body leaves a slot that
   * the next created body reuses, so after any despawn the three orders disagree. The id list
   * must therefore be recorded in forEach order at snapshot time (see dynamicIdOrder); zipping
   * against any other order silently cross-links bodies to the wrong ids the moment an entity
   * id is recycled, and the sim then reads one item's body as another's.
   *
   * @param {Uint8Array} bytes from takeSnapshot()
   * @param {number[]} idOrder entity ids in forEach order (see dynamicIdOrder)
   */
  restoreSnapshot(bytes, idOrder) {
    this.world = RAPIER.World.restoreSnapshot(bytes);
    this.world.numSolverIterations = 6;
    this.world.timestep = 1 / 60;
    this.bodies = new Map();
    this.byCollider = new Map();
    // Iterate with `forEach`, NOT `bodies.get(i)`: `get` takes a rigid-body HANDLE, and
    // Rapier's 0.21 JS bindings return a Number, so `get(0)`/`get(1)` silently return the same
    // (or a zero) body. forEach is the only iteration that visits every body. Its order is
    // stable across a takeSnapshot/restoreSnapshot round-trip (verified empirically), which is
    // what makes the id re-link below possible — provided idOrder was recorded in this same
    // order (dynamicIdOrder), not in creation order.
    const dyn = [];
    this.world.bodies.forEach(b => { if (b.isDynamic()) dyn.push(b); });
    let k = 0;
    for (const id of idOrder) {
      if (k >= dyn.length) break;
      const body = dyn[k++];
      this.bodies.set(id, { body, kind: this.kinds.get(id) ?? 'item', id });
      for (let c = 0; c < body.numColliders(); c++) this.byCollider.set(body.collider(c).handle, id);
    }
  }

  /**
   * The ids of every dynamic body, in `world.bodies.forEach` visitation order.
   *
   * This is the ONLY order that survives a snapshot/restore round-trip (forEach walks the
   * body's slots, so it is stable even after removals and id recycling). Creation order and
   * map insertion order both diverge from it the moment an entity id is recycled — which
   * items do constantly — so they must not be used here.
   */
  dynamicIdOrder() {
    const byBody = new Map();
    for (const [id, e] of this.bodies) byBody.set(e.body, id);
    const out = [];
    this.world.bodies.forEach(b => {
      if (b.isDynamic()) out.push(byBody.get(b));
    });
    return out;
  }
}
