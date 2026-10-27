// ToyKit.js — shared building blocks for the Dweebs toy-set architecture.
//
// Every structure in ToyTown is assembled from a small set of faceted primitives. Geometry and
// toon materials are reference-counted across structures (six buildings, one copy of each plank
// profile), while static decoration is merged per material so each building costs a handful of
// draw calls instead of a hundred. Animated parts (sails, cogs, doors) stay separate so they can
// move; destructible blocks stay separate so they can disappear.
//
// The contract for every building:
//   • construct with (physicsWorld, scene, options)
//   • update(dt, { dweebs, fx, town })
//   • dispose() — atomically removes colliders, meshes, merged geometry and any owned textures.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMat } from '../render/Toon.js';

const UP = new THREE.Vector3(0, 1, 0);

// ─── Reference-counted shared resources ───

const geometryCache = new Map(); // key -> { geo, refs }
const materialCache = new Map(); // key -> { mat, refs }

function acquireGeometry(key, build) {
  let entry = geometryCache.get(key);
  if (!entry) {
    entry = { geo: build(), refs: 0 };
    geometryCache.set(key, entry);
  }
  entry.refs++;
  return entry.geo;
}

function releaseGeometry(key) {
  const entry = geometryCache.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.geo.dispose();
    geometryCache.delete(key);
  }
}

function acquireMaterial(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  let entry = materialCache.get(key);
  if (!entry) {
    const mat = toonMat({ color, flatShading: true, ...opts });
    // Faceted lighting from screen-space derivatives while keeping welded normals for the
    // outline shell (same trick as ObjectModels).
    mat.defines = { ...mat.defines, FLAT_SHADED: '' };
    entry = { mat, refs: 0 };
    materialCache.set(key, entry);
  }
  entry.refs++;
  return entry.mat;
}

function releaseMaterial(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  const entry = materialCache.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.mat.dispose();
    materialCache.delete(key);
  }
}

/** Diagnostics for the dev HUD / tests: how many distinct toy resources are live. */
export function toyResourceStats() {
  return { geometries: geometryCache.size, materials: materialCache.size };
}

// ─── Pure helpers (unit-tested, no THREE scene required) ───

export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Smooth exponential approach, frame-rate independent. */
export function damp(current, target, lambda, dt) {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

/** Comic impact score used by breakable walls. A Dweeb (mass 3) at 12 m/s scores 432. */
export function impactScore(speed, mass) {
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const m = Number.isFinite(mass) ? Math.max(0, mass) : 0;
  return s * s * m;
}

export function shouldShatter(score, threshold) {
  return score >= threshold;
}

/** Trampoline squash: positive when pressed down, springs back with a little overshoot. */
export function springSquash(squash, velocity, dt, stiffness = 190, damping = 11) {
  const v = velocity + (-stiffness * squash - damping * velocity) * dt;
  return { squash: squash + v * dt, velocity: v };
}

/** Smooth 0→1→0 accent curve used for canopy ripples and door bursts. */
export function pulse(t) {
  const x = clamp01(t);
  return Math.sin(x * Math.PI);
}

/** Rails along a polyline: positions + tangents sampled into `count` points with catenary sag. */
export function sampleTrack(points, count = 14, sag = 0) {
  const out = [];
  if (!points || points.length < 2) return out;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const f = t * (points.length - 1);
    const i0 = Math.min(points.length - 1, Math.floor(f));
    const i1 = Math.min(points.length - 1, i0 + 1);
    const k = f - i0;
    const p = new THREE.Vector3().lerpVectors(points[i0], points[i1], k);
    p.y -= Math.sin(t * Math.PI) * sag;
    out.push(p);
  }
  return out;
}

/** Nearest segment on a sampled polyline. Returns { index, t, point, tangent, distance }. */
export function nearestOnTrack(track, point) {
  let best = null;
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz || 1;
    let t = ((point.x - a.x) * abx + (point.y - a.y) * aby + (point.z - a.z) * abz) / len2;
    t = clamp01(t);
    const x = a.x + abx * t, y = a.y + aby * t, z = a.z + abz * t;
    const d = Math.hypot(point.x - x, point.y - y, point.z - z);
    if (!best || d < best.distance) {
      best = {
        index: i, t,
        point: new THREE.Vector3(x, y, z),
        tangent: new THREE.Vector3(abx, aby, abz).normalize(),
        distance: d,
      };
    }
  }
  return best;
}

/** Point along a catenary-ish zipline from a to b at progress t (0..1). */
export function ziplinePoint(a, b, t, sag = 0.6) {
  const k = clamp01(t);
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * sag,
    z: a.z + (b.z - a.z) * k,
  };
}

/** Speed of a rider sliding down a straight wire with gravity; caps at terminal speed. */
export function ziplineSpeed(gravity, drop, dist, t, terminal = 13) {
  if (dist <= 0) return 0;
  const slope = Math.max(0, drop) / dist;
  return Math.min(terminal, 2.4 + (gravity * slope * Math.max(0, t)) * 1.4);
}

/** Direction from a yaw (Three's -Z forward convention). */
export function yawVec(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

// ─── Static batch ───

class StaticBatch {
  constructor(owner) {
    this.owner = owner;
    this.buckets = new Map();
    this.parts = 0;
  }

  add(key, factory, color, opts, matrix) {
    const src = this.owner._geo(key, factory);
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.tangent) g.deleteAttribute('tangent');
    if (g.attributes.color) g.deleteAttribute('color');
    g.applyMatrix4(matrix);
    const mk = `${color}|${JSON.stringify(opts)}`;
    let bucket = this.buckets.get(mk);
    if (!bucket) {
      bucket = { color, opts, geos: [] };
      this.buckets.set(mk, bucket);
    }
    bucket.geos.push(g);
    this.parts++;
    return this;
  }

  build() {
    for (const { color, opts, geos } of this.buckets.values()) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.owner._mat(color, opts));
      mesh.castShadow = !opts.transparent;
      mesh.receiveShadow = true;
      mesh.name = 'toy-batch';
      this.owner.group.add(mesh);
      this.owner._ownGeom(merged);
    }
    this.buckets.clear();
    return this.parts;
  }
}

// ─── Base structure ───

let structureSeq = 0;

export class ToyStructure {
  constructor(physicsWorld, scene, options = {}) {
    this.physics = physicsWorld;
    this.scene = scene;
    this.fx = options.fx || null;
    this.groundAt = options.groundAt || null;
    this.id = options.id || `toy_${++structureSeq}`;
    this.name = options.name || 'Toy Structure';
    this.position = new THREE.Vector3(options.x || 0, options.y || 0, options.z || 0);
    this.rotationY = options.rotationY || 0;
    this.group = new THREE.Group();
    this.group.name = this.id;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.rotationY;
    scene?.add(this.group);

    this.colliders = [];
    this.kinematics = [];
    this._bodies = [];
    this._geoRefs = new Map();
    this._matRefs = new Map();
    this._ownedGeos = new Set();
    this._debugLines = [];
    this._debugSpecs = [];
    this._debugOn = false;
    this._batch = new StaticBatch(this);
    this._time = 0;
    this._disposed = false;
    this._localYaw = new THREE.Quaternion().setFromAxisAngle(UP, this.rotationY);
  }

  // ── resource helpers ──

  _geo(key, factory) {
    if (!this._geoRefs.has(key)) this._geoRefs.set(key, acquireGeometry(key, factory));
    return this._geoRefs.get(key);
  }

  _mat(color, opts = {}) {
    const key = `${color}|${JSON.stringify(opts)}`;
    if (!this._matRefs.has(key)) this._matRefs.set(key, acquireMaterial(color, opts));
    return this._matRefs.get(key);
  }

  _ownGeom(geo) {
    this._ownedGeos.add(geo);
    return geo;
  }

  _worldMatrix(t = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(t.r || [0, 0, 0])));
    if (t.q) q.copy(t.q);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(...(t.p || [0, 0, 0])),
      q,
      new THREE.Vector3(...(t.s || [1, 1, 1])),
    );
  }

  _batchBox(w, h, d, color, t = {}, opts = {}) {
    const key = `box:${w}:${h}:${d}`;
    this._batch.add(key, () => new THREE.BoxGeometry(w, h, d), color, opts, this._worldMatrix(t));
  }

  _batchRBox(w, h, d, r, color, t = {}, opts = {}) {
    const rr = Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002);
    const key = `rbox:${w}:${h}:${d}:${rr}`;
    this._batch.add(key, () => new RoundedBoxGeometry(w, h, d, 1, rr), color, opts, this._worldMatrix(t));
  }

  _batchCyl(rt, rb, h, seg, color, t = {}, opts = {}) {
    const key = `cyl:${rt}:${rb}:${h}:${seg}`;
    this._batch.add(key, () => new THREE.CylinderGeometry(rt, rb, h, seg), color, opts, this._worldMatrix(t));
  }

  _batchCone(r, h, seg, color, t = {}, opts = {}) {
    const key = `cone:${r}:${h}:${seg}`;
    this._batch.add(key, () => new THREE.ConeGeometry(r, h, seg), color, opts, this._worldMatrix(t));
  }

  _batchSphere(r, seg, color, t = {}, opts = {}) {
    const key = `sphere:${r}:${seg}`;
    this._batch.add(key, () => new THREE.SphereGeometry(r, seg, Math.max(3, Math.floor(seg * 0.7))), color, opts, this._worldMatrix(t));
  }

  _batchTorus(R, r, rs, ts, color, t = {}, opts = {}) {
    const key = `torus:${R}:${r}:${rs}:${ts}`;
    this._batch.add(key, () => new THREE.TorusGeometry(R, r, rs, ts), color, opts, this._worldMatrix(t));
  }

  _meshBox(w, h, d, color, t = {}, opts = {}, parent = this.group) {
    const geo = this._geo(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
    return this._directMesh(geo, color, opts, t, parent);
  }

  _meshRBox(w, h, d, r, color, t = {}, opts = {}, parent = this.group) {
    const rr = Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002);
    const geo = this._geo(`rbox:${w}:${h}:${d}:${rr}`, () => new RoundedBoxGeometry(w, h, d, 1, rr));
    return this._directMesh(geo, color, opts, t, parent);
  }

  _meshCyl(rt, rb, h, seg, color, t = {}, opts = {}, parent = this.group) {
    const geo = this._geo(`cyl:${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
    return this._directMesh(geo, color, opts, t, parent);
  }

  _meshCone(r, h, seg, color, t = {}, opts = {}, parent = this.group) {
    const geo = this._geo(`cone:${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));
    return this._directMesh(geo, color, opts, t, parent);
  }

  _meshSphere(r, seg, color, t = {}, opts = {}, parent = this.group) {
    const geo = this._geo(`sphere:${r}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(3, Math.floor(seg * 0.7))));
    return this._directMesh(geo, color, opts, t, parent);
  }

  _meshTorus(R, r, rs, ts, color, t = {}, opts = {}, parent = this.group) {
    const geo = this._geo(`torus:${R}:${r}:${rs}:${ts}`, () => new THREE.TorusGeometry(R, r, rs, ts));
    return this._directMesh(geo, color, opts, t, parent);
  }

  _directMesh(geo, color, opts, t = {}, parent = this.group) {
    const mesh = new THREE.Mesh(geo, this._mat(color, opts));
    mesh.position.set(...(t.p || [0, 0, 0]));
    if (t.q) mesh.quaternion.copy(t.q);
    else mesh.rotation.set(...(t.r || [0, 0, 0]));
    mesh.scale.set(...(t.s || [1, 1, 1]));
    mesh.castShadow = !opts.transparent;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** A box beam between two local points (rails, braces, zipline cable supports). */
  _batchBeam(a, b, width, depth, color, opts = {}) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = dir.length() || 0.001;
    const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    const key = `beam:${width}:${depth}:${len.toFixed(3)}`;
    const matrix = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    this._batch.add(key, () => new THREE.BoxGeometry(width, len, depth), color, opts, matrix);
  }

  /** Convert a local point to world space (structure translation + yaw). */
  worldPoint(x, y, z) {
    return new THREE.Vector3(x, y, z).applyQuaternion(this._localYaw).add(this.position);
  }

  /** Terrain height in local space at a local x/z (0 when no sampler was supplied). */
  groundLocal(x, z) {
    if (!this.groundAt) return 0;
    const p = this.worldPoint(x, 0, z);
    return this.groundAt(p.x, p.z) - this.position.y;
  }

  /** Convert a local quaternion to world space. */
  worldQuat(qLocal) {
    return qLocal.clone().premultiply(this._localYaw);
  }

  /** Per-Dweeb cooldown bookkeeping (shared across this structure's gadgets). */
  _cool(dweeb, key, dt, seconds) {
    if (!dweeb._toyCd) dweeb._toyCd = {};
    const left = dweeb._toyCd[key] || 0;
    if (left > 0) {
      dweeb._toyCd[key] = left - dt;
      return false;
    }
    dweeb._toyCd[key] = seconds;
    return true;
  }

  /** Iterate living Dweebs with a physics body. */
  _dweebs(ctx, fn) {
    const list = ctx?.dweebs || [];
    for (const d of list) {
      if (!d || !d.body || d.eliminated) continue;
      if (d.active === false) continue;
      fn(d);
    }
  }

  /** Fire a comic effect through Fx when the live game wires one up. */
  _fx(method, ...args) {
    this.fx?.[method]?.(...args);
  }

  // ── colliders ──

  /**
   * Static box collider from local coordinates. `r` is an optional local Euler rotation.
   * Returns the Rapier registration and records a debug hull.
   */
  staticBox(x, y, z, hw, hh, hd, mat = 'wood', r = null, quat = null) {
    const p = this.worldPoint(x, y, z);
    const qLocal = quat
      ? quat.clone()
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r || [0, 0, 0])));
    const q = this.worldQuat(qLocal);
    const rotated = Math.abs(this.rotationY) > 1e-4 || !!r || !!quat;
    const c = rotated
      ? this.physics.createStaticBoxRotated(p.x, p.y, p.z, hw, hh, hd, q, mat)
      : this.physics.createStaticBox(p.x, p.y, p.z, hw, hh, hd, mat);
    this.colliders.push(c);
    this._debugHull(p, hw, hh, hd, q);
    return c;
  }

  staticCylinder(x, y, z, radius, halfHeight, mat = 'wood') {
    const p = this.worldPoint(x, y, z);
    const c = this.physics.createFixedCylinder(p.x, p.y, p.z, radius, halfHeight, mat);
    this.colliders.push(c);
    this._debugHull(p, radius, halfHeight, radius, this.worldQuat(new THREE.Quaternion()), true);
    return c;
  }

  staticCone(x, y, z, radius, halfHeight, mat = 'stone') {
    const p = this.worldPoint(x, y, z);
    const c = this.physics.createFixedCone
      ? this.physics.createFixedCone(p.x, p.y, p.z, radius, halfHeight, mat)
      : this.physics.createFixedCylinder(p.x, p.y, p.z, radius, halfHeight, mat);
    this.colliders.push(c);
    this._debugHull(p, radius, halfHeight, radius, this.worldQuat(new THREE.Quaternion()), true);
    return c;
  }

  /** Kinematic platform with a collider offset from its pivot (clock hands, drawbridge). */
  kinematicBox(x, y, z, hx, hy, hz, offset = null, mat = 'wood') {
    const p = this.worldPoint(x, y, z);
    const c = this.physics.createKinematicBox
      ? this.physics.createKinematicBox(p.x, p.y, p.z, hx, hy, hz, mat, offset)
      : this.physics.createKinematicShape(p.x, p.y, p.z, 'box', { hx, hy, hz }, 0.2, mat);
    const entry = {
      ...c,
      pivot: p,
      offset: offset || { x: 0, y: 0, z: 0 },
      hx, hy, hz,
      quat: this.worldQuat(new THREE.Quaternion()),
    };
    this.kinematics.push(entry);
    this._bodies.push(c.id);
    const off = offset || { x: 0, y: 0, z: 0 };
    const cLocal = new THREE.Vector3(off.x, off.y, off.z).applyQuaternion(this._localYaw);
    const cp = p.clone().add(cLocal);
    this._debugHull(cp, hx, hy, hz, this.worldQuat(new THREE.Quaternion()));
    return entry;
  }

  _debugHull(p, hw, hh, hd, q, round = false) {
    this._debugSpecs.push({ p: p.clone(), hw, hh, hd, q: q.clone(), round });
    if (this._debugOn) this._drawDebugSpec(this._debugSpecs[this._debugSpecs.length - 1]);
  }

  _drawDebugSpec(spec) {
    const geo = spec.round
      ? new THREE.CylinderGeometry(spec.hw, spec.hw, spec.hh * 2, 10, 1, true)
      : new THREE.BoxGeometry(spec.hw * 2, spec.hh * 2, spec.hd * 2);
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x40ffb0, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    geo.dispose();
    wire.position.copy(spec.p);
    wire.quaternion.copy(spec.q);
    wire.renderOrder = 999;
    this.group.add(wire);
    this._debugLines.push(wire);
  }

  setDebugWireframes(on) {
    this._debugOn = !!on;
    for (const line of this._debugLines) {
      this.group.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    this._debugLines.length = 0;
    if (!this._debugOn) return;
    for (const spec of this._debugSpecs) this._drawDebugSpec(spec);
  }

  // ── lifecycle ──

  /** Create the collider for a destructible block and remember its handle mapping. */
  trackColliderRef(collider, ref) {
    const info = this.physics?.colliderInfo?.get?.(collider.handle);
    if (info) info.ref = ref;
    return collider;
  }

  update(dt) {
    this._time += dt;
  }

  flush() {
    this._batch.build();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.scene) this.scene.remove(this.group);
    for (const id of this._bodies) this.physics?.removeBody?.(id);
    for (const c of this.colliders) {
      if (c?.id) this.physics?.removeBody?.(c.id);
    }
    this._bodies.length = 0;
    this.colliders.length = 0;
    this.kinematics.length = 0;
    for (const line of this._debugLines) {
      line.geometry.dispose();
      line.material.dispose();
    }
    this._debugLines.length = 0;
    for (const geo of this._ownedGeos) geo.dispose();
    this._ownedGeos.clear();
    for (const [key] of this._geoRefs) releaseGeometry(key);
    for (const [key] of this._matRefs) {
      const split = key.lastIndexOf('|');
      releaseMaterial(key.slice(0, split), JSON.parse(key.slice(split + 1)));
    }
    this._geoRefs.clear();
    this._matRefs.clear();
    this.group.clear();
  }
}

// ─── Utility meshes shared by the set pieces ───

/** A striped canopy: one vertex-coloured cone so it stays a single draw call. */
export function makeStripedCone(radius, height, segments, colors, { apexOffset = 0 } = {}) {
  const geo = new THREE.ConeGeometry(radius, height, segments, 1, false);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const a = Math.atan2(cz, cx);
    const idx = Math.floor(((a + Math.PI) / (Math.PI * 2)) * segments) % colors.length;
    c.setHex(colors[(idx + colors.length) % colors.length]);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.translate(0, apexOffset, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Low-poly cog: a hub plus trapezoid teeth, returned as a Group. */
export function makeCog(kit, radius, thickness, teeth, color, accent) {
  const g = new THREE.Group();
  kit._meshCyl(radius * 0.82, radius * 0.82, thickness, 12, color, { p: [0, 0, 0] }, {}, g);
  kit._meshCyl(radius * 0.24, radius * 0.24, thickness * 1.35, 8, accent, {}, {}, g);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    kit._meshBox(radius * 0.32, thickness * 0.92, radius * 0.3, accent, {
      p: [Math.cos(a) * radius * 0.92, 0, Math.sin(a) * radius * 0.92],
      r: [0, -a, 0],
    }, {}, g);
  }
  return g;
}
