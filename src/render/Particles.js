// Particles.js — pooled instanced particles (dust, stars, splashes, confetti) and shockwave rings

import * as THREE from 'three';
import { noOutline } from './Toon.js';

const MAX = 700;
const RINGS = 16;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class Particles {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setColorAt(i, _c.set(0xffffff));
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
    }
    noOutline(this.mesh);
    scene.add(this.mesh);

    this.parts = [];
    for (let i = 0; i < MAX; i++) this.parts.push({ life: 0 });
    this.cursor = 0;
    this.budget = 1; // 0..1 multiplier for particle counts

    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RINGS; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false;
      noOutline(m);
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, size: 1 });
    }
    this.ringCursor = 0;
  }

  /** Scale particle spawn counts (0..1). Called by quality governor. */
  setBudget(f) {
    this.budget = Math.max(0, Math.min(1, f));
  }

  emit(pos, opts = {}) {
    const {
      count = 10, color = 0xffffff, colors = null, speed = 4, up = 2, size = 0.18,
      life = 0.7, gravity = -12, spread = 1, drag = 1.5, grow = -1,
    } = opts;
    const actualCount = Math.max(1, Math.round(count * this.budget));
    for (let n = 0; n < actualCount; n++) {
      const idx = this.cursor;
      const p = this.parts[idx];
      this.cursor = (this.cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.3) * spread;
      const sp = speed * (0.4 + Math.random() * 0.8);
      p.x = pos.x; p.y = pos.y; p.z = pos.z;
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp;
      p.vy = up * (0.5 + Math.random()) + el * sp;
      p.life = p.max = life * (0.6 + Math.random() * 0.8);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.gravity = gravity; p.drag = drag; p.grow = grow;
      p.rx = Math.random() * 6; p.ry = Math.random() * 6; p.spin = (Math.random() - 0.5) * 12;
      const col = colors ? colors[Math.floor(Math.random() * colors.length)] : color;
      this.mesh.setColorAt(idx, _c.set(col));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  ring(pos, { color = 0xffffff, size = 4, life = 0.4 } = {}) {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % RINGS;
    r.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    r.mesh.material.color.set(color);
    r.mesh.visible = true;
    r.life = r.max = life;
    r.size = size;
  }

  // Presets
  dust(pos, n = 6) { this.emit(pos, { count: n, color: 0xf3e6cf, speed: 2.2, up: 0.8, size: 0.22, life: 0.5, gravity: 1, grow: 1.2 }); }
  hit(pos, color = 0xffe066) {
    this.emit(pos, { count: 14, colors: [0xffffff, color, 0xffe066], speed: 7, up: 3, size: 0.16, life: 0.45, gravity: -6 });
    this.ring(pos, { color, size: 2.2, life: 0.25 });
  }
  bigHit(pos, color = 0xff5a5a) {
    this.emit(pos, { count: 28, colors: [0xffffff, color, 0xffd23f], speed: 12, up: 4, size: 0.22, life: 0.6, gravity: -8 });
    this.ring(pos, { color: 0xffffff, size: 4.5, life: 0.35 });
  }
  splash(pos) {
    this.emit(pos, { count: 40, colors: [0xffffff, 0x8ff5ff, 0x40d4ff], speed: 5, up: 9, size: 0.26, life: 1.1, gravity: -20, spread: 0.3 });
    this.ring({ x: pos.x, y: pos.y + 0.1, z: pos.z }, { color: 0xffffff, size: 5, life: 0.8 });
  }
  explosion(pos) {
    this.emit(pos, { count: 50, colors: [0xffd23f, 0xff8a2b, 0xff4d5e, 0xffffff], speed: 14, up: 5, size: 0.35, life: 0.8, gravity: -4 });
    this.emit(pos, { count: 16, color: 0x6b6070, speed: 3, up: 3, size: 0.6, life: 1.4, gravity: 2, grow: 1.5 });
    this.ring(pos, { color: 0xffd23f, size: 8, life: 0.45 });
  }
  confetti(pos, n = 60) {
    this.emit(pos, { count: n, colors: [0xff4d5e, 0xffd23f, 0x3fa9ff, 0x5ee06a, 0xb56cff, 0xff6fb5], speed: 8, up: 10, size: 0.2, life: 2.2, gravity: -9, drag: 1 });
  }
  sparkle(pos, color = 0xffffff) {
    this.emit(pos, { count: 18, colors: [0xffffff, color], speed: 3, up: 2, size: 0.14, life: 0.8, gravity: 1 });
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.spin * dt; p.ry += p.spin * dt;
      const t = p.life / p.max;
      const s = p.grow > 0 ? p.size * (1 + (1 - t) * p.grow) * Math.min(1, t * 3) : p.size * Math.min(1, t * 2.5);
      _p.set(p.x, p.y, p.z);
      _q.setFromEuler(_e.set(p.rx, p.ry, 0));
      _s.setScalar(s);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      const s = 0.3 + t * r.size;
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = (1 - t) * 0.85;
      if (r.life <= 0) r.mesh.visible = false;
    }
  }
}
