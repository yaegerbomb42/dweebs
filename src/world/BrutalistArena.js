// BrutalistArena.js — a brutalist concrete foundry brawl stage.
//
// Standalone builder (not a subclass of Arena): constructs multi-level brutalist
// architecture — main deck, elevated walkways, upper platform, concrete stairs,
// pillars, hazard-striped edges, zone markings, and industrial props — with
// matching Rapier static colliders.
//
// Integration: Arena.setArena('brutalist') lazily builds this at an offset
// (far from the stadium so colliders never overlap) and delegates spawn points.
// The class also works standalone for tests (offset 0,0,0).

import * as THREE from 'three';
import { toonMat, noOutline } from '../render/Toon.js';

/** World offset used by Arena.js so brutalist colliders never touch the stadium. */
export const BRUTALIST_OFFSET = new THREE.Vector3(0, 0, 200);

// ─── Procedural textures (guarded for node/test environments) ───

let _hazardTex = null;
/** Diagonal yellow/black hazard stripes. Null in node (no document). */
export function hazardTexture() {
  if (_hazardTex) return _hazardTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8b62a';
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = '#161616';
  for (let i = -32; i < 160; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 32); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 32, 0); ctx.lineTo(i + 16, 32);
    ctx.closePath(); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _hazardTex = tex;
  return tex;
}

const _zoneTexCache = {};
/** Floor marking with a zone label ("ZONE 04"). Null in node. */
export function zoneTexture(label) {
  if (_zoneTexCache[label]) return _zoneTexCache[label];
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 52);
  ctx.fillRect(48, 92, 160, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _zoneTexCache[label] = tex;
  return tex;
}

export class BrutalistArena {
  /**
   * @param {THREE.Scene} scene
   * @param {PhysicsWorld} physicsWorld — must be init()ed (RAPIER ready)
   * @param {THREE.Vector3} offset — added to every position (keeps clear of stadium)
   */
  constructor(scene, physicsWorld, offset = new THREE.Vector3(0, 0, 0)) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.offset = offset.clone();
    this.group = null;
    this.bodyIds = [];
    this.platforms = [];   // { x, y, z, hw, hd, top } — walkable surfaces (world coords)
    this.walls = [];        // { x, y, z, hw, hh, hd } — solid obstacles (world coords)
    this.spawnPoints = [
      { x: -6, y: 1.2, z: -6 },
      { x: 6, y: 1.2, z: -6 },
      { x: -6, y: 1.2, z: 6 },
      { x: 6, y: 1.2, z: 6 },
    ].map(p => ({ x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z }));
    this.built = false;
    this._nextId = 0;

    // Shared materials (created lazily in build)
    this._mats = null;
    // Shared geometries
    this._geos = null;
  }

  // ─── Materials & shared resources ───

  _initResources() {
    if (this._mats) return;
    const hz = hazardTexture();
    this._mats = {
      concrete: toonMat({ color: 0x9aa0a3 }),          // light concrete
      concreteDark: toonMat({ color: 0x6e7376 }),      // dark concrete (walls)
      concreteMid: toonMat({ color: 0x84898d }),       // mid concrete (walkways)
      rust: toonMat({ color: 0x8a5a35, flatShading: true }), // rusted steel
      steelDark: toonMat({ color: 0x3d4145 }),         // dark steel
      hazard: hz
        ? toonMat({ map: hz })
        : toonMat({ color: 0xe8b62a }),                // fallback in node
      crate: toonMat({ color: 0xa8763e }),             // wooden crates
      accent: toonMat({ color: 0xc94f2e }),            // safety-orange accents
    };
    this._geos = {
      box: new THREE.BoxGeometry(1, 1, 1),            // unit box, scaled per mesh
    };
  }

  // ─── Low-level builders ───

  /** World-space position from local coords. */
  _w(x, y, z) {
    return new THREE.Vector3(x + this.offset.x, y + this.offset.y, z + this.offset.z);
  }

  /**
   * Add a solid concrete box: visual mesh + Rapier static cuboid collider.
   * (x, y, z) = center, (w, h, d) = full extents. Returns the mesh.
   */
  _solidBox(x, y, z, w, h, d, mat, { collider = true, shadow = true } = {}) {
    const p = this._w(x, y, z);
    const mesh = new THREE.Mesh(this._geos.box, mat);
    mesh.scale.set(w, h, d);
    mesh.position.copy(p);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collider) {
      const r = this.physicsWorld.createStaticBox(p.x, p.y, p.z, w / 2, h / 2, d / 2, 'stone');
      this.bodyIds.push(r.id);
    }
    return mesh;
  }

  /**
   * Register a walkable platform: visual box + collider + platforms[] entry.
   * (x, z) = center, top = walking surface height, (w, d) = extents, thick = slab depth.
   */
  _platform(x, top, z, w, d, mat, thick = 2) {
    const mesh = this._solidBox(x, top - thick / 2, z, w, thick, d, mat);
    const p = this._w(x, top, z);
    this.platforms.push({ x: p.x, y: top + this.offset.y, z: p.z, hw: w / 2, hd: d / 2, top: p.y });
    return mesh;
  }

  /**
   * Hazard-striped lip along a platform edge. Visual only (thin, on top of edge).
   * Horizontal strip: (x, z) center, w = length along X, d = width along Z.
   */
  _hazardStrip(x, y, z, w, d) {
    const p = this._w(x, y, z);
    const mesh = new THREE.Mesh(this._geos.box, this._mats.hazard);
    mesh.scale.set(w, 0.12, d);
    mesh.position.copy(p);
    mesh.receiveShadow = true;
    noOutline(mesh);
    // Tile the stripe texture along the length
    if (mesh.material.map) {
      mesh.material = mesh.material.clone();
      mesh.material.map = mesh.material.map.clone();
      mesh.material.map.repeat.set(Math.max(1, Math.round(w / 2)), 1);
      mesh.material.map.needsUpdate = true;
    }
    this.group.add(mesh);
    return mesh;
  }

  /** Zone floor marking ("ZONE 04"). Visual only. */
  _zoneMarking(x, y, z, label, size = 6) {
    const tex = zoneTexture(label);
    const p = this._w(x, y, z);
    const mat = tex
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      : toonMat({ color: 0xffffff, transparent: true, opacity: 0.25 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size / 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, p.y + 0.02, p.z);
    noOutline(mesh);
    this.group.add(mesh);
    return mesh;
  }

  /**
   * A flight of concrete stairs (visual steps) with a single smooth ramp collider.
   * From (x1, y1, z1) to (x2, y2, z2). Steps run along the dominant horizontal axis.
   */
  _stairs(x1, y1, z1, x2, y2, z2, width, mat) {
    const dx = x2 - x1, dz = z2 - z1, dy = y2 - y1;
    const run = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.round(Math.abs(dy) / 0.4));
    const alongX = Math.abs(dx) >= Math.abs(dz);
    // Visual stepped boxes (no per-step colliders — one smooth ramp below)
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const cx = x1 + dx * (t0 + t1) / 2;
      const cz = z1 + dz * (t0 + t1) / 2;
      const topY = y1 + dy * t1;
      const w = alongX ? run / steps + 0.12 : width;
      const d = alongX ? width : run / steps + 0.12;
      this._solidBox(cx, topY - 0.25, cz, w, 0.5, d, mat, { collider: false });
    }
    // Single smooth ramp collider (rotated cuboid) so dweebs glide up
    const len = Math.hypot(run, dy);
    const ang = Math.atan2(dy, run); // pitch about the horizontal perpendicular axis
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, mz = (z1 + z2) / 2;
    const yaw = Math.atan2(dx, dz); // rotate ramp to face travel direction
    this._rampCollider(mx, my, mz, len / 2, 0.25, width / 2, yaw, ang);
  }

  /** Rotated static cuboid collider (for ramps). Visual is built separately. */
  _rampCollider(x, y, z, hx, hy, hz, yaw, pitch) {
    const R = this.physicsWorld.RAPIER;
    const p = this._w(x, y, z);
    // Quaternion: yaw about Y, then pitch about local X (ramp slope)
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, yaw, 0))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, 0, 0)));
    const body = this.physicsWorld.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    );
    const collider = this.physicsWorld.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9).setRestitution(0.02),
      body
    );
    const id = `brut_ramp_${this._nextId++}`;
    this.physicsWorld.bodies.set(id, { rigid: body, collider, type: 'static', material: 'stone' });
    this.bodyIds.push(id);
    return { id, body, collider };
  }

  // ─── Layout ───

  build() {
    if (this.built) return;
    this._initResources();
    this.group = new THREE.Group();
    this.group.name = 'BrutalistArena';
    this.scene.add(this.group);
    const M = this._mats;

    // ── Main deck: 24×24m slab, top at y=0 ──
    this._platform(0, 0, 0, 24, 24, M.concrete, 2);
    // Hazard-striped lip around the main deck edge
    const e = 12, lip = 0.6;
    this._hazardStrip(0, 0.06, -e + lip / 2, 24, lip);
    this._hazardStrip(0, 0.06, e - lip / 2, 24, lip);
    this._hazardStrip(-e + lip / 2, 0.06, 0, lip, 24 - lip * 2);
    this._hazardStrip(e - lip / 2, 0.06, 0, lip, 24 - lip * 2);
    this._zoneMarking(0, 0, 0, 'ZONE 04', 7);

    // ── North walkway: 24×5m, top at y=4, z=-14.5 ──
    this._platform(0, 4, -14.5, 24, 5, M.concreteMid, 1.5);
    this._hazardStrip(0, 4.06, -16.9, 24, 0.5);
    this._zoneMarking(-8, 4, -14.5, 'ZONE 01', 4);
    // Support pillars under north walkway
    this._solidBox(-10, 1, -14.5, 1.6, 6, 1.6, M.concreteDark);
    this._solidBox(10, 1, -14.5, 1.6, 6, 1.6, M.concreteDark);

    // ── South walkway: 24×5m, top at y=4, z=+14.5 ──
    this._platform(0, 4, 14.5, 24, 5, M.concreteMid, 1.5);
    this._hazardStrip(0, 4.06, 16.9, 24, 0.5);
    this._zoneMarking(8, 4, 14.5, 'ZONE 02', 4);
    this._solidBox(-10, 1, 14.5, 1.6, 6, 1.6, M.concreteDark);
    this._solidBox(10, 1, 14.5, 1.6, 6, 1.6, M.concreteDark);

    // ── Upper platform: 8×8m, top at y=8, above north walkway ──
    this._platform(0, 8, -14.5, 8, 8, M.concrete, 1.5);
    this._hazardStrip(0, 8.06, -18.2, 8, 0.5);
    this._hazardStrip(0, 8.06, -10.8, 8, 0.5);
    this._zoneMarking(0, 8, -14.5, 'ZONE 03', 3.5);
    // Corner support columns for the upper platform
    this._solidBox(-3.2, 5.5, -17.7, 1.2, 5, 1.2, M.concreteDark);
    this._solidBox(3.2, 5.5, -17.7, 1.2, 5, 1.2, M.concreteDark);

    // ── Stairs ──
    // West: main deck (y=0) → north walkway (y=4)
    this._stairs(-10, 0, -4, -10, 4, -12, 3, M.concreteMid);
    // East: main deck (y=0) → south walkway (y=4)
    this._stairs(10, 0, 4, 10, 4, 12, 3, M.concreteMid);
    // North: north walkway (y=4) → upper platform (y=8)
    this._stairs(-12, 4, -14.5, -4, 8, -14.5, 2.6, M.concreteMid);

    // ── Cover: corner pillars on the main deck ──
    const pillarH = 6;
    for (const [px, pz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      this._solidBox(px, pillarH / 2, pz, 2, pillarH, 2, M.concreteDark);
      // Pillar cap
      this._solidBox(px, pillarH + 0.3, pz, 2.6, 0.6, 2.6, M.concrete);
    }

    // ── Low blast walls (partial cover, still KO-able over the top) ──
    this._solidBox(-5, 1, -11, 8, 2, 1, M.concreteDark);
    this._solidBox(5, 1, 11, 8, 2, 1, M.concreteDark);

    // ── Industrial props ──
    // Crates (static, can hide behind)
    this._solidBox(-7, 0.6, 7, 1.2, 1.2, 1.2, M.crate);
    this._solidBox(-5.6, 0.6, 7.4, 1.2, 1.2, 1.2, M.crate);
    this._solidBox(-6.3, 1.8, 7.2, 1.2, 1.2, 1.2, M.crate); // stacked
    this._solidBox(7, 0.6, -6, 1.2, 1.2, 1.2, M.crate);
    this._solidBox(4, 4.6, -16, 1.2, 1.2, 1.2, M.crate); // on north walkway
    // Concrete barriers on walkway outer edges
    for (const bx of [-8, -4, 0, 4, 8]) {
      this._solidBox(bx, 4.5, -16.9, 2, 1, 0.5, M.concrete);
      this._solidBox(bx, 4.5, 16.9, 2, 1, 0.5, M.concrete);
    }
    // Rusted pipes along the main deck west edge (visual + low collider)
    this._pipeRun(-11.5, 0.5, -8, -11.5, 0.5, 8);
    // Overhead rust truss spanning the pit (visual only, high up)
    this._truss(0, 11, 0, 26, 0);
    this._truss(0, 11, -14.5, 26, 0);

    this.built = true;
  }

  /** Horizontal rusted pipe run between two points (visual + thin collider). */
  _pipeRun(x1, y1, z1, x2, y2, z2) {
    const a = this._w(x1, y1, z1), b = this._w(x2, y2, z2);
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(0.35, 0.35, len, 10);
    const mesh = new THREE.Mesh(geo, this._mats.rust);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = true;
    this.group.add(mesh);
    // Pipe support brackets
    for (const t of [0.15, 0.5, 0.85]) {
      const p = a.clone().lerp(b, t);
      const br = new THREE.Mesh(this._geos.box, this._mats.steelDark);
      br.scale.set(0.3, p.y, 0.3);
      br.position.set(p.x, p.y / 2, p.z);
      this.group.add(br);
    }
  }

  /** Overhead truss beam (visual only — flies above the fight). */
  _truss(x, y, z, length, rotY) {
    const g = new THREE.Group();
    const p = this._w(x, y, z);
    g.position.copy(p);
    g.rotation.y = rotY;
    const M = this._mats;
    // Top and bottom chords
    for (const cy of [-0.8, 0.8]) {
      const chord = new THREE.Mesh(this._geos.box, M.rust);
      chord.scale.set(length, 0.35, 0.35);
      chord.position.y = cy;
      chord.castShadow = true;
      g.add(chord);
    }
    // Diagonal lattice
    const n = Math.floor(length / 2);
    for (let i = 0; i < n; i++) {
      const lx = -length / 2 + (i + 0.5) * (length / n);
      const diag = new THREE.Mesh(this._geos.box, M.rust);
      diag.scale.set(0.25, 2.1, 0.25);
      diag.position.set(lx, 0, 0);
      diag.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.6;
      g.add(diag);
    }
    // Support columns down to the deck (visual)
    for (const sx of [-length / 2 + 1, length / 2 - 1]) {
      const col = new THREE.Mesh(this._geos.box, M.concreteDark);
      col.scale.set(1, y, 1);
      col.position.set(sx, -y / 2, 0);
      g.add(col);
    }
    noOutline(g);
    this.group.add(g);
  }

  // ─── Lifecycle ───

  setVisible(v) {
    if (this.group) this.group.visible = v;
  }

  dispose() {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse(o => {
        if (o.geometry && o.geometry !== this._geos?.box) o.geometry.dispose?.();
        // Materials are shared — do not dispose here (they're cached per arena).
      });
      this.group = null;
    }
    for (const id of this.bodyIds) this.physicsWorld.removeBody(id);
    this.bodyIds = [];
    this.platforms = [];
    this.built = false;
  }

  /** Spawn point i of total (spread across the main deck). */
  getSpawnPoint(index, total = 4) {
    // Use the fixed 4-point layout; wrap for larger totals.
    const p = this.spawnPoints[index % this.spawnPoints.length];
    return { x: p.x, y: p.y, z: p.z };
  }
}
