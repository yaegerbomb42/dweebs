// Juice.js — throw trails, comic impact stars and fading ground decals (splats, scorches, cracks).
// All pooled: nothing is allocated per frame.

import * as THREE from 'three';
import { noOutline } from './Toon.js';
import { burstTexture, decalTexture } from './Stickers.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _side = new THREE.Vector3();

// ─── Throw trails: tapered camera-facing ribbons in the thrower's colour ───

const TRAIL_POINTS = 16;
const TRAILS = 10;

export class Trails {
  constructor(scene, camera) {
    this.camera = camera;
    const index = [];
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.pool = [];
    for (let i = 0; i < TRAILS; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(TRAIL_POINTS * 2 * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setIndex(index);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide,
      }));
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 2;
      noOutline(mesh);
      scene.add(mesh);
      this.pool.push({ mesh, geo, pos, pts: Array.from({ length: TRAIL_POINTS }, () => new THREE.Vector3()), n: 0, obj: null, width: 0.2 });
    }
  }

  update(dt, objects) {
    // Attach to newly thrown objects
    for (const o of objects) {
      if (o.isDebris || o.trail || !o.thrownBy || o.thrownTime <= 0 || !o.body) continue;
      const v = o.body.linvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z < 64) continue;
      const t = this.pool.find(p => !p.obj && p.n === 0);
      if (!t) break;
      t.obj = o;
      o.trail = t;
      t.n = 0;
      t.width = THREE.MathUtils.clamp(Math.max(...o.def.visualScale) * 0.32, 0.1, 0.38);
      t.mesh.material.color.set(o.thrownBy.color ?? 0xffffff);
      t.mesh.visible = true;
    }

    const cam = this.camera.position;
    for (const t of this.pool) {
      if (!t.obj && t.n === 0) continue;
      const o = t.obj;
      let alive = false;
      if (o && o.body && !o.broken && o.thrownBy && o.thrownTime > 0 && !o.isGrabbed) {
        const v = o.body.linvel();
        alive = v.x * v.x + v.y * v.y + v.z * v.z > 16;
      }
      if (alive) {
        // Shift history and push the head
        const last = t.pts.pop();
        const p = o.body.translation();
        last.set(p.x, p.y, p.z);
        t.pts.unshift(last);
        t.n = Math.min(TRAIL_POINTS, t.n + 1);
      } else {
        if (o) { o.trail = null; t.obj = null; }
        t.n = Math.max(0, t.n - 2);
        if (t.n < 2) { t.n = 0; t.mesh.visible = false; continue; }
      }
      if (t.n < 2) continue;

      for (let i = 0; i < t.n; i++) {
        const p = t.pts[i];
        _a.copy(t.pts[Math.max(0, i - 1)]).sub(t.pts[Math.min(t.n - 1, i + 1)]);
        _b.copy(cam).sub(p);
        _side.crossVectors(_a, _b);
        const len = _side.length();
        const w = t.width * (1 - i / (t.n - 1)) ** 1.3;
        if (len > 1e-6) _side.multiplyScalar(w / len); else _side.set(0, w, 0);
        t.pos[i * 6] = p.x + _side.x; t.pos[i * 6 + 1] = p.y + _side.y; t.pos[i * 6 + 2] = p.z + _side.z;
        t.pos[i * 6 + 3] = p.x - _side.x; t.pos[i * 6 + 4] = p.y - _side.y; t.pos[i * 6 + 5] = p.z - _side.z;
      }
      t.geo.attributes.position.needsUpdate = true;
      t.geo.setDrawRange(0, (t.n - 1) * 6);
    }
  }

  clear() {
    for (const t of this.pool) {
      if (t.obj) t.obj.trail = null;
      t.obj = null; t.n = 0; t.mesh.visible = false;
    }
  }
}

// ─── Comic impact stars ───

const BURSTS = 14;

export class Bursts {
  constructor(scene) {
    this.pool = [];
    const map = burstTexture();
    for (let i = 0; i < BURSTS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      s.visible = false;
      s.renderOrder = 20;
      noOutline(s);
      scene.add(s);
      this.pool.push({ s, life: 0, max: 0.24, size: 1 });
    }
    this.cursor = 0;
  }

  spawn(pos, size = 1, color = 0xffffff) {
    const b = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % BURSTS;
    b.s.position.set(pos.x, pos.y, pos.z);
    b.s.material.color.set(color);
    b.s.material.rotation = Math.random() * Math.PI;
    b.s.visible = true;
    b.life = b.max = 0.2 + size * 0.04;
    b.size = size;
  }

  update(dt) {
    for (const b of this.pool) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.s.visible = false; continue; }
      const t = 1 - b.life / b.max;
      const k = t < 0.25 ? (t / 0.25) * 1.25 : 1.25 - (t - 0.25) * 0.4;
      b.s.scale.setScalar(b.size * k);
      b.s.material.opacity = t > 0.55 ? (1 - t) / 0.45 : 1;
      b.s.material.rotation += dt * 1.5;
    }
  }

  clear() { for (const b of this.pool) { b.life = 0; b.s.visible = false; } }
}

// ─── Ground decals ───

const DECALS = 36;

export class Decals {
  constructor(scene, physics, arena) {
    this.physics = physics;
    this.arena = arena;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.pool = [];
    for (let i = 0; i < DECALS; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      m.visible = false;
      m.renderOrder = 1;
      noOutline(m);
      scene.add(m);
      this.pool.push({ m, life: 0, max: 1, size: 1, opacity: 1 });
    }
    this.cursor = 0;
  }

  /** Raycast down onto the stage; returns false when there is no ground (e.g. over water). */
  spawnOnGround(kind, pos, size = 1.5, color = 0xffffff, opacity = 0.85, life = 9) {
    // Step through props/dweebs until we reach the stage
    let y = pos.y + 0.3, hit = null, skip = null;
    for (let i = 0; i < 4; i++) {
      hit = this.physics.raycast({ x: pos.x, y, z: pos.z }, { x: 0, y: -1, z: 0 }, 4, skip);
      if (!hit) return false;
      if (this.physics.infoFor(hit.collider)?.kind === 'stage') break;
      if (skip) y = hit.point.y - 0.02; // a second blocker: step past it
      skip = hit.collider;
      hit = null;
    }
    if (!hit) return false;
    const d = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % DECALS;
    const mat = d.m.material;
    mat.map = decalTexture(kind);
    mat.color.set(color);
    mat.needsUpdate = true;
    d.m.position.set(hit.point.x, hit.point.y + 0.012 + this.cursor * 0.0004, hit.point.z);
    d.m.rotation.y = Math.random() * Math.PI * 2;
    d.m.visible = true;
    d.life = d.max = life;
    d.size = size;
    d.opacity = opacity;
    return true;
  }

  update(dt) {
    for (const d of this.pool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      // Ground fell away (sudden death)? fade fast
      if (d.life > 0.4 && d.m.position.y < 1 && !this.arena.isOverGround(d.m.position.x, d.m.position.z)) d.life = 0.4;
      if (d.life <= 0) { d.m.visible = false; continue; }
      const age = d.max - d.life;
      const s = d.size * Math.min(1, 0.4 + age * 8);
      d.m.scale.set(s, 1, s);
      d.m.material.opacity = d.opacity * Math.min(1, d.life / 1.5);
    }
  }

  clear() { for (const d of this.pool) { d.life = 0; d.m.visible = false; } }
}
