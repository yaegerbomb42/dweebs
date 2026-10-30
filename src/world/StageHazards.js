// StageHazards.js — the offline half of the wave-2 stages. Arenas.js declares Storm Spire
// (`lightning`), Sinking Sands (`stickyCenter`) and Magnet Core (`magnetPulse`) and
// Balance.arena has their tuning, but until now only the online sim acted on them, so
// locally the three stages were a blank island. This director gives each one a look
// (built into the arena's theme group, so Arena._clearTheme disposes it) and its hazard.
//
// Arena owns one instance per stage switch; Arena.update() ticks it while hazardsActive.
// Callbacks back to main.js go through the arena: onLightningWarn/onLightning(x, z, hits),
// onMagnetWarn/onMagnet(active), onQuicksand(d) — FX and feed lines live there.

import * as THREE from 'three';
import { BALANCE } from '../game/Balance.js';
import { noOutline } from '../render/Toon.js';

const _v = new THREE.Vector3();

function basic(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
}

function flat(mesh, y) {
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  noOutline(mesh);
  return mesh;
}

/** A swirl texture for the quicksand pit (canvas, no asset). */
function swirlTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d9a441';
  g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  for (let arm = 0; arm < 4; arm++) {
    g.beginPath();
    for (let t = 0; t < 1; t += 0.01) {
      const a = arm * Math.PI / 2 + t * Math.PI * 3;
      const r = t * 124;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.strokeStyle = arm % 2 ? '#b9822b' : '#f0c56a';
    g.lineWidth = 14;
    g.lineCap = 'round';
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class StageHazards {
  /**
   * @param {import('./Arena.js').Arena} arena
   * @param {object} def  arena definition from Arenas.js
   * @param {THREE.Group} group  the arena's theme group (disposed by Arena._clearTheme)
   */
  constructor(arena, def, group) {
    this.arena = arena;
    this.def = def;
    this.group = group;
    this.time = 0;
    if (def.lightning) this._buildStorm();
    if (def.stickyCenter) this._buildSands();
    if (def.magnetPulse) this._buildMagnet();
    this.reset();
  }

  static wants(def) {
    return !!(def.lightning || def.stickyCenter || def.magnetPulse);
  }

  reset() {
    const A = BALANCE.arena;
    this.strikeTimer = A.lightningFirst;
    this.pending = null;             // { x, z, t } telegraphed strike
    this.magnetPhase = 'idle';       // idle → warn → active
    this.magnetTimer = A.magnetIdle;
    if (this.mark) this.mark.visible = false;
    for (const b of this.bolts ?? []) this.group.remove(b.mesh);
    this.bolts = [];
  }

  // ─── Storm Spire ───

  _buildStorm() {
    // A brooding cloud ring overhead and a copper lightning rod on the rim.
    const cloudMat = basic(0x4b3f8f, 0.55);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + (i % 3), 12, 10), cloudMat);
      puff.position.set(Math.cos(a) * 11, 17 + (i % 2) * 1.5, Math.sin(a) * 11);
      puff.scale.y = 0.45;
      noOutline(puff);
      this.group.add(puff);
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 9, 8), basic(0xc8834a));
    rod.position.set(0, 4.5, -15.5);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), basic(0xbfe9ff));
    tip.position.set(0, 9.1, -15.5);
    this.rodTip = tip;
    this.group.add(rod, tip);

    // The telegraph: a crackling ring where the sky has decided to land.
    const R = BALANCE.arena.lightningRadius;
    this.mark = new THREE.Group();
    this.markRing = flat(new THREE.Mesh(new THREE.RingGeometry(R - 0.25, R, 40), basic(0xbfe9ff, 0.9)), 0.06);
    this.markFill = flat(new THREE.Mesh(new THREE.CircleGeometry(R - 0.25, 32), basic(0x7c6cf0, 0.25)), 0.05);
    this.markBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 18, 6, 1, true), basic(0xbfe9ff, 0.25));
    this.markBeam.position.y = 9;
    noOutline(this.markBeam);
    this.mark.add(this.markRing, this.markFill, this.markBeam);
    this.mark.visible = false;
    this.group.add(this.mark);
  }

  _pickStrike() {
    const ds = (this.arena.dweebs ?? []).filter(d => d.active && !d.eliminated && !d.grabbedBy);
    for (let tries = 0; tries < 6; tries++) {
      let x, z;
      if (ds.length && Math.random() < 0.8) {
        const p = ds[Math.floor(Math.random() * ds.length)].getPosition();
        // Aim near someone, not on them: the warning is a chance to dodge, not a sentence.
        const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.4;
        x = p.x + Math.cos(a) * r; z = p.z + Math.sin(a) * r;
      } else {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 10;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      }
      if (this.arena.isOverGround(x, z, 0.5)) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  _bolt(x, z) {
    // A jagged chain of glowing struts from the clouds to the ground.
    const g = new THREE.Group();
    const mat = basic(0xf2fbff, 1);
    let px = x + (Math.random() - 0.5) * 3, py = 18, pz = z + (Math.random() - 0.5) * 3;
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const nx = i === steps ? x : x + (Math.random() - 0.5) * 2.2 * (1 - t);
      const nz = i === steps ? z : z + (Math.random() - 0.5) * 2.2 * (1 - t);
      const ny = 18 * (1 - t);
      const len = Math.hypot(nx - px, ny - py, nz - pz);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 5), mat);
      seg.position.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
      _v.set(nx - px, ny - py, nz - pz).normalize();
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
      noOutline(seg);
      g.add(seg);
      px = nx; py = ny; pz = nz;
    }
    const scorch = flat(new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), basic(0x2a2440, 0.55)), 0.04);
    scorch.position.x = x; scorch.position.z = z;
    g.add(scorch);
    this.group.add(g);
    this.bolts.push({ mesh: g, mat, scorch, life: 0.35, scorchLife: 2.5 });
  }

  _updateStorm(dt) {
    const A = BALANCE.arena;
    if (this.rodTip) this.rodTip.scale.setScalar(1 + Math.max(0, Math.sin(this.time * 9)) * (this.pending ? 0.6 : 0.1));
    if (!this.pending) {
      this.strikeTimer -= dt;
      if (this.strikeTimer <= A.lightningWarn) {
        const s = this._pickStrike();
        this.pending = { ...s, t: A.lightningWarn };
        this.mark.position.set(s.x, 0, s.z);
        this.mark.visible = true;
        this.arena.onLightningWarn?.(s.x, s.z);
      }
    } else {
      this.pending.t -= dt;
      const k = 1 - Math.max(0, this.pending.t) / A.lightningWarn;   // 0 → 1 as it charges
      const flick = Math.sin(this.time * (18 + k * 40)) > 0 ? 1 : 0.45;
      this.markRing.material.opacity = 0.5 + 0.5 * flick;
      this.markFill.material.opacity = 0.15 + k * 0.35;
      this.markBeam.material.opacity = 0.1 + k * 0.35 * flick;
      if (this.pending.t <= 0) this._strike();
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.scorchLife -= dt;
      b.mesh.children.forEach(c => { if (c !== b.scorch) c.visible = b.life > 0 && Math.random() > 0.15; });
      b.scorch.material.opacity = Math.max(0, Math.min(0.55, b.scorchLife * 0.3));
      if (b.scorchLife <= 0) {
        this.group.remove(b.mesh);
        b.mesh.traverse(o => o.geometry?.dispose());
        b.mat.dispose();
        b.scorch.material.dispose();
        this.bolts.splice(i, 1);
      }
    }
  }

  _strike() {
    const A = BALANCE.arena;
    const { x, z } = this.pending;
    this.pending = null;
    this.mark.visible = false;
    this.strikeTimer = A.lightningEvery + (Math.random() * 4 - 2);
    this._bolt(x, z);
    const hits = [];
    for (const d of this.arena.dweebs ?? []) {
      if (!d.active || d.grabbedBy) continue;
      const p = d.getPosition();
      const dx = p.x - x, dz = p.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > A.lightningRadius || p.y > 4) continue;
      const n = dist || 1;
      const launch = d.receiveHit({
        dir: { x: (dx / n) * 0.5, y: 0.85, z: (dz / n) * 0.5 },
        damage: A.lightningDamage, base: A.lightningLaunch * 0.6, growth: 10,
        attacker: null, time: this.arena.time,
      });
      d.hazardCd = Math.max(d.hazardCd || 0, 0.6);
      if (launch > 0) hits.push(d);
    }
    // Loose props get flung too — a strike next to the barrels is a show.
    for (const obj of this.arena.objects ?? []) {
      const p = obj.getPosition?.();
      if (!p || !obj.body || obj.isGrabbed || obj.body.isDynamic?.() === false) continue;
      const dx = p.x - x, dz = p.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > A.lightningRadius) continue;
      const v = obj.body.linvel();
      obj.body.setLinvel({ x: v.x + (dx / (dist || 1)) * 4, y: v.y + 7, z: v.z + (dz / (dist || 1)) * 4 }, true);
    }
    this.arena.onLightning?.(x, z, hits);
  }

  // ─── Sinking Sands ───

  _buildSands() {
    const R = BALANCE.arena.quicksandRadius;
    this.sandTex = swirlTexture();
    this.sand = flat(new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshBasicMaterial({ map: this.sandTex, transparent: true, opacity: 0.92, depthWrite: false })), 0.04);
    this.sandLip = flat(new THREE.Mesh(new THREE.RingGeometry(R, R + 0.35, 48), basic(0x8a5a1f, 0.85)), 0.045);
    this.group.add(this.sand, this.sandLip);
    this.sinking = new Set();
  }

  _updateSands(dt) {
    const A = BALANCE.arena;
    this.sand.rotation.z += dt * 0.6;
    const keep = Math.pow(A.quicksandDrag, dt * 60);
    for (const d of this.arena.dweebs ?? []) {
      if (!d.active || d.grabbedBy) { this.sinking.delete(d); continue; }
      const p = d.getPosition();
      const inside = Math.hypot(p.x, p.z) < A.quicksandRadius && d.grounded;
      if (!inside) { this.sinking.delete(d); continue; }
      const v = d.body.linvel();
      // The pit drags and gently swirls you toward its eye.
      const swirl = 1.2 * dt;
      d.body.setLinvel({ x: v.x * keep - p.z * swirl * 0.3 - p.x * swirl * 0.15, y: v.y, z: v.z * keep + p.x * swirl * 0.3 - p.z * swirl * 0.15 }, true);
      if (!this.sinking.has(d)) {
        this.sinking.add(d);
        this.arena.onQuicksand?.(d);
      }
    }
    for (const obj of this.arena.objects ?? []) {
      const p = obj.getPosition?.();
      if (!p || !obj.body || obj.isGrabbed || obj.body.isDynamic?.() === false || p.y > 1.2 || Math.hypot(p.x, p.z) > A.quicksandRadius) continue;
      const v = obj.body.linvel();
      obj.body.setLinvel({ x: v.x * keep, y: v.y, z: v.z * keep }, true);
    }
  }

  // ─── Magnet Core ───

  _buildMagnet() {
    // A huge horseshoe magnet hangs over the middle of the stage, poles down.
    const m = new THREE.Group();
    const red = basic(0xe14b8a), steel = basic(0xdfe6f0);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.7, 10, 24, Math.PI), red);
    arc.rotation.z = 0;
    arc.position.y = 1.6;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 1.4), red);
    legL.position.set(-2.2, 0.8, 0);
    const legR = legL.clone();
    legR.position.x = 2.2;
    const tipL = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.5, 1.42), steel);
    tipL.position.set(-2.2, -0.2, 0);
    const tipR = tipL.clone();
    tipR.position.x = 2.2;
    m.add(arc, legL, legR, tipL, tipR);
    m.traverse(o => o.isMesh && noOutline(o));
    m.position.set(0, 11, 0);
    this.magnet = m;
    this.magnetTips = [tipL, tipR];
    this.group.add(m);

    // Field lines on the floor that rush inward while the magnet is awake.
    this.fieldRings = [];
    for (let i = 0; i < 4; i++) {
      const r = flat(new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), basic(0xff8fc6, 0)), 0.05);
      this.fieldRings.push(r);
      this.group.add(r);
    }
  }

  _updateMagnet(dt) {
    const A = BALANCE.arena;
    this.magnetTimer -= dt;
    if (this.magnetPhase === 'idle' && this.magnetTimer <= 0) {
      this.magnetPhase = 'warn';
      this.magnetTimer = A.magnetWarn;
      this.arena.onMagnetWarn?.();
    } else if (this.magnetPhase === 'warn' && this.magnetTimer <= 0) {
      this.magnetPhase = 'active';
      this.magnetTimer = A.magnetActive;
      this.arena.onMagnet?.(true);
    } else if (this.magnetPhase === 'active' && this.magnetTimer <= 0) {
      this.magnetPhase = 'idle';
      this.magnetTimer = A.magnetIdle;
      this.arena.onMagnet?.(false);
    }

    const awake = this.magnetPhase !== 'idle';
    const active = this.magnetPhase === 'active';
    this.magnet.position.y = 11 + Math.sin(this.time * 1.3) * 0.3 - (active ? 0.8 : 0);
    this.magnet.rotation.y += dt * (active ? 2.4 : awake ? 1 : 0.15);
    const glow = active ? 1 : this.magnetPhase === 'warn' ? (Math.sin(this.time * 20) > 0 ? 1 : 0.3) : 0;
    for (const t of this.magnetTips) t.material.color.setHex(glow > 0.5 ? 0x8fe9ff : 0xdfe6f0);
    this.fieldRings.forEach((r, i) => {
      if (!awake) { r.material.opacity = 0; return; }
      const span = 14;
      const phase = ((this.time * (active ? 1.1 : 0.4) + i / this.fieldRings.length) % 1);
      const radius = span * (1 - phase) + 0.5;
      r.scale.set(radius, radius, 1);
      r.material.opacity = (active ? 0.55 : 0.25) * Math.sin(phase * Math.PI);
    });
    if (!active) return;

    for (const d of this.arena.dweebs ?? []) {
      if (!d.active || d.grabbedBy) continue;
      const p = d.getPosition();
      const r = Math.hypot(p.x, p.z);
      if (r < 0.8) continue;
      const k = (d.grounded ? 0.55 : 1) * A.magnetForce * dt;
      const v = d.body.linvel();
      d.body.setLinvel({ x: v.x - (p.x / r) * k, y: v.y, z: v.z - (p.z / r) * k }, true);
    }
    // Everything metal-ish (i.e. everything) slides in too: the middle becomes a junk pile.
    for (const obj of this.arena.objects ?? []) {
      const p = obj.getPosition?.();
      if (!p || !obj.body || obj.isGrabbed || obj.body.isDynamic?.() === false) continue;
      const r = Math.hypot(p.x, p.z);
      if (r < 1) continue;
      const v = obj.body.linvel();
      const k = A.magnetForce * 0.7 * dt;
      obj.body.setLinvel({ x: v.x - (p.x / r) * k, y: v.y, z: v.z - (p.z / r) * k }, true);
    }
  }

  /** Visual idle animation runs always; hazards only while `live`. */
  update(dt, live) {
    this.time += dt;
    if (this.def.lightning) {
      if (live) this._updateStorm(dt);
      else if (this.rodTip) this.rodTip.scale.setScalar(1);
    }
    if (this.def.stickyCenter) {
      if (live) this._updateSands(dt);
      else this.sand.rotation.z += dt * 0.2;
    }
    if (this.def.magnetPulse) {
      if (live) this._updateMagnet(dt);
      else if (this.magnet) this.magnet.rotation.y += dt * 0.15;
    }
  }

  dispose() {
    this.sandTex?.dispose();
    this.bolts = [];
  }
}
