// WarfareFx.js — juice for Dweeb Warfare: explosion flashes, shockwaves, tumbling death pops,
// confetti shards, floating damage numbers and screen shake. View-only (may use Math.random).
import * as THREE from 'three';
import { noOutline } from '../render/Toon.js';
import { Particles } from '../render/Particles.js';
import { TEAM_COLORS } from './WarfareModels.js';

const GRAV = -20;
const shardGeo = new THREE.TetrahedronGeometry(0.16, 0);
const flashGeo = new THREE.IcosahedronGeometry(1, 0);
const waveGeo = new THREE.RingGeometry(0.8, 1, 20);
const puffGeo = new THREE.DodecahedronGeometry(0.3, 0);

export class WarfareFx {
  constructor(group, camera) {
    this.group = group;
    this.camera = camera;
    this.items = [];       // {obj, life, max, update(it, dt)}
    this.shake = 0;
    this.kick = 0;
    this.shardMats = {
      blue: new THREE.MeshBasicMaterial({ color: TEAM_COLORS.blue }),
      red: new THREE.MeshBasicMaterial({ color: TEAM_COLORS.red }),
      brass: new THREE.MeshBasicMaterial({ color: 0xd4a73a }),
      wood: new THREE.MeshBasicMaterial({ color: 0xb07a45 }),
      smoke: new THREE.MeshBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0.8 }),
    };
    this.layer = document.createElement('div');
    this.layer.className = 'wf-dmg-layer';
    document.body.appendChild(this.layer);
    this.nums = [];
    for (let i = 0; i < 56; i++) {
      const el = document.createElement('div');
      el.className = 'wf-dmg';
      this.layer.appendChild(el);
      this.nums.push({ el, life: 0, x: 0, y: 0, z: 0 });
    }
    this.numIdx = 0;
    this._v = new THREE.Vector3();
    // Pooled dust for artillery barrages (read-only use of render/Particles).
    this.particles = new Particles(group);
    // Crater decals left by artillery: capped, oldest recycled.
    this.craters = [];
    this.craterGeo = new THREE.CircleGeometry(1, 14);
  }

  addShake(a) { this.shake = Math.min(1.4, this.shake + a); if (a >= 0.5) this.kick = Math.min(1, this.kick + a * 0.6); }

  /** Tiny yellow flash at a rocket's tube when it fires. */
  muzzle(x, z) {
    const m = new THREE.Mesh(flashGeo, this.shardMats.spark || (this.shardMats.spark = new THREE.MeshBasicMaterial({ color: 0xfff3a0 })));
    m.position.set(x, 1.6, z);
    this._add(m, 0.08, (it) => m.scale.setScalar(0.25 + (1 - it.life / it.max) * 0.4));
  }

  _add(obj, max, update) {
    noOutline(obj);
    this.group.add(obj);
    this.items.push({ obj, life: max, max, update });
  }

  explosion(x, z, r, big = false) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95 });
    const flash = new THREE.Mesh(flashGeo, mat);
    flash.position.set(x, 0.6, z);
    this._add(flash, 0.32, (it) => {
      const p = 1 - it.life / it.max;
      flash.scale.setScalar(0.3 + r * 0.9 * p);
      mat.opacity = 0.95 * (1 - p);
      mat.color.setHex(p < 0.4 ? 0xfff3a0 : 0xff8a3c);
    });
    this.shockwave(x, z, r * 1.1, 0xffffff);
    const n = big ? 12 : 6;
    for (let i = 0; i < n; i++) this._shard(x, 0.6, z, Math.random() < 0.5 ? this.shardMats.brass : this.shardMats.wood, 7 + r * 1.5);
    for (let i = 0; i < (big ? 5 : 3); i++) this.puff(x + (Math.random() - 0.5) * r, z + (Math.random() - 0.5) * r);
    this.addShake(big ? 0.55 : 0.18);
  }

  /** Balloon decoy bursting: a rubbery shockwave, a puff and a burst of plastic shards. */
  balloonPop(x, z, team = 'blue') {
    this.shockwave(x, z, 4.2, TEAM_COLORS[team] || 0xffd23f);
    const mats = [this.shardMats[team] || this.shardMats.brass, this.shardMats.brass, this.shardMats.wood];
    for (let i = 0; i < 14; i++) this._shard(x, 1.2, z, mats[i % mats.length], 7);
    this.puff(x, z);
    this.addShake(0.2);
  }

  shockwave(x, z, r, color = 0xffffff) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(waveGeo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    this._add(ring, 0.4, (it) => {
      const p = 1 - it.life / it.max;
      ring.scale.setScalar(0.4 + r * p);
      mat.opacity = 0.8 * (1 - p);
    });
  }

  puff(x, z) {
    const m = new THREE.Mesh(puffGeo, this.shardMats.smoke.clone());
    m.position.set(x, 0.4, z);
    const vy = 1.5 + Math.random();
    this._add(m, 0.7, (it, dt) => {
      const p = 1 - it.life / it.max;
      m.position.y += vy * dt;
      m.scale.setScalar(0.8 + p * 2);
      m.material.opacity = 0.7 * (1 - p);
    });
  }

  /** Tan dust cloud kicked up by artillery and collapsing barricades (pooled particles). */
  dustCloud(x, z, r = 6) {
    this.particles.dust({ x, y: 0.5, z }, Math.max(4, Math.round(6 + r * 1.6)));
  }

  /** Magnet Crane sparks: a ring of electric arcs pulling toward the center. */
  magnetSparks(x, z, innerR, outerR) {
    const mat = new THREE.LineBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.9 });
    const segments = 16;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const startR = innerR + Math.random() * (outerR - innerR) * 0.3;
      const endR = innerR + (outerR - innerR) * (0.4 + Math.random() * 0.5);
      const points = [];
      const steps = 5;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const r = startR + (endR - startR) * t;
        const a = angle + (Math.random() - 0.5) * 0.3 * (1 - t);
        const y = 0.3 + t * 1.5 + Math.sin(t * Math.PI) * 0.8;
        points.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, mat.clone());
      line.position.set(x, 0, z);
      this._add(line, 0.6 + Math.random() * 0.3, (it) => {
        line.material.opacity = 0.9 * (it.life / it.max);
        line.scale.setScalar(it.life / it.max);
      });
    }
    // Central pulse
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    const pulseGeo = new THREE.RingGeometry(innerR * 0.5, innerR * 0.8, 20);
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.set(x, 0.08, z);
    this._add(pulse, 0.5, (it) => {
      const p = 1 - it.life / it.max;
      pulse.scale.setScalar(1 + p * 2);
      pulseMat.opacity = 0.7 * (1 - p);
    });
  }

  /** Scorched crater decal stamped where a shell lands. Oldest decals are recycled. */
  crater(x, z, r = 4) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3d2f23, transparent: true, opacity: 0.55, depthWrite: false });
    const m = new THREE.Mesh(this.craterGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(x, 0.02 + Math.random() * 0.008, z);
    const s = r * (0.28 + Math.random() * 0.12);
    m.scale.set(s, s * (0.75 + Math.random() * 0.3), 1);
    noOutline(m);
    this.group.add(m);
    this.craters.push(m);
    if (this.craters.length > 40) {
      const old = this.craters.shift();
      this.group.remove(old);
      old.material.dispose();
    }
  }

  _shard(x, y, z, mat, speed) {
    const s = new THREE.Mesh(shardGeo, mat);
    s.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2;
    const v = new THREE.Vector3(Math.cos(a) * speed * (0.4 + Math.random() * 0.6), 4 + Math.random() * speed * 0.7, Math.sin(a) * speed * (0.4 + Math.random() * 0.6));
    const spin = new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12);
    this._add(s, 0.9 + Math.random() * 0.4, (it, dt) => {
      v.y += GRAV * dt;
      s.position.addScaledVector(v, dt);
      if (s.position.y < 0.08) { s.position.y = 0.08; v.y *= -0.35; v.x *= 0.6; v.z *= 0.6; }
      s.rotation.x += spin.x * dt; s.rotation.y += spin.y * dt;
      s.scale.setScalar(Math.min(1, it.life * 2.5));
    });
  }

  /** Ragdoll tumble then pop into confetti: takes ownership of `root`. */
  deathPop(root, team, kx = 0, kz = 0, big = false) {
    const v = new THREE.Vector3(kx * 0.9 + (Math.random() - 0.5) * 3, (big ? 9 : 6) + Math.random() * 3, kz * 0.9 + (Math.random() - 0.5) * 3);
    const spin = new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 16);
    const s0 = root.scale.x;
    let popped = false;
    this.group.add(root);
    this.items.push({ obj: root, life: big ? 1.3 : 0.75, max: big ? 1.3 : 0.75, update: (it, dt) => {
      v.y += GRAV * dt;
      root.position.addScaledVector(v, dt);
      if (root.position.y < 0) { root.position.y = 0; v.y = Math.abs(v.y) * 0.4; v.x *= 0.7; v.z *= 0.7; }
      root.rotation.x += spin.x * dt; root.rotation.z += spin.z * dt; root.rotation.y += spin.y * dt;
      const p = it.life / it.max;
      root.scale.setScalar(s0 * (p < 0.2 ? p / 0.2 : 1) * (1 + (1 - p) * 0.25));
      if (!popped && p < 0.2) {
        popped = true;
        const n = big ? 26 : 9;
        for (let i = 0; i < n; i++) this._shard(root.position.x, root.position.y + 0.6, root.position.z, this.shardMats[team] || this.shardMats.brass, big ? 11 : 6);
        this.puff(root.position.x, root.position.z);
      }
    } });
  }

  /** Floating damage number / word at a world point. kind: 'crit' | 'weak' | 'heal' | 'word' | '' */
  number(x, y, z, text, kind = '') {
    const n = this.nums[this.numIdx];
    this.numIdx = (this.numIdx + 1) % this.nums.length;
    n.x = x + (Math.random() - 0.5) * 0.6; n.y = y; n.z = z + (Math.random() - 0.5) * 0.6;
    n.life = kind === 'word' ? 1.1 : 0.8;
    n.max = n.life;
    n.el.textContent = text;
    n.el.className = 'wf-dmg show ' + kind;
  }

  update(dt) {
    this.particles.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this.group.remove(it.obj);
        this.items.splice(i, 1);
        continue;
      }
      it.update(it, dt);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.kick = Math.max(0, this.kick - dt * 3);
    const w = window.innerWidth, h = window.innerHeight;
    for (const n of this.nums) {
      if (n.life <= 0) continue;
      n.life -= dt;
      if (n.life <= 0) { n.el.className = 'wf-dmg'; n.el.style.opacity = '0'; continue; }
      const p = 1 - n.life / n.max;
      this._v.set(n.x, n.y + p * 1.6, n.z).project(this.camera);
      if (this._v.z > 1) { n.el.style.opacity = '0'; continue; }
      const sx = (this._v.x * 0.5 + 0.5) * w, sy = (-this._v.y * 0.5 + 0.5) * h;
      const sc = p < 0.15 ? 0.6 + p / 0.15 * 0.6 : 1.2 - (p - 0.15) * 0.3;
      n.el.style.transform = `translate(${sx | 0}px, ${sy | 0}px) translate(-50%, -50%) scale(${sc.toFixed(2)})`;
      n.el.style.opacity = String(Math.min(1, (1 - p) * 2));
    }
  }

  clear() {
    for (const it of this.items) this.group.remove(it.obj);
    this.items.length = 0;
    for (const c of this.craters) { this.group.remove(c); c.material.dispose(); }
    this.craters.length = 0;
    for (const n of this.nums) { n.life = 0; n.el.className = 'wf-dmg'; n.el.style.opacity = '0'; }
    this.shake = 0;
  }

  dispose() {
    this.clear();
    this.layer.remove();
  }
}
