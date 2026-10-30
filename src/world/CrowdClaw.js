import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';

/**
 * Crowd Claw: a giant arcade claw lowered from the stadium rafters every ~30s.
 * A pulsing target ring telegraphs where it will drop. Anyone standing in the ring
 * when it lands gets scooped up, hauled into the air, swung around and dropped
 * (sometimes over the edge). If it closes on nothing, it hauls up a wrapped prize
 * and lets it fall: the gift pops into a normal weighted drop item. No new item keys,
 * no sim changes. Events go out through onEvent(kind, data) so main can do fx/audio.
 */
const STATE = { IDLE: 0, TELEGRAPH: 1, DESCEND: 2, CLOSE: 3, LIFT: 4, SWING: 5, RELEASE: 6, ASCEND: 7 };
const HIGH = 16, CARRY = 7.5;

export class CrowdClaw {
  constructor(arena) {
    this.arena = arena;
    this.group = new THREE.Group();
    arena.scene.add(this.group);
    this._build();
    this.onEvent = null;
    this.reset();
  }

  _build() {
    const metal = toonMat({ color: 0xffd23f }), dark = toonMat({ color: 0x1b1030 }), red = toonMat({ color: 0xff384b });
    this.claw = new THREE.Group();
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 40, 6), dark);
    cable.position.y = 20.6;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.9, 12), metal);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), red); cap.position.y = 0.55;
    this.claw.add(cable, hub, cap);
    this.prongs = [];
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / 3) * Math.PI * 2;
      const arm = new THREE.Group(); arm.position.set(0, -0.35, 0.7);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.22), metal); upper.position.y = -0.6;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), metal); tip.position.set(0, -1.3, -0.25); tip.rotation.x = 0.7;
      arm.add(upper, tip); pivot.add(arm); this.claw.add(pivot);
      this.prongs.push(arm);
    }
    this.group.add(this.claw);
    // Telegraph ring
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.55, 32), new THREE.MeshBasicMaterial({ color: 0xff384b, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring);
    // Prize box
    this.gift = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), toonMat({ color: 0x5ee06a }));
    const rib1 = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.18), red), rib2 = rib1.clone(); rib2.rotation.y = Math.PI / 2;
    this.gift.add(box, rib1, rib2);
    this.gift.position.y = -1.4;
    this.claw.add(this.gift);
  }

  reset() {
    this.state = STATE.IDLE;
    this.timer = 18 + Math.random() * 10;
    this.held = null;
    this.hasGift = false;
    this.claw.position.set(0, 40, 0);
    this.ring.visible = false;
    this.gift.visible = false;
    this._setGrip(0);
  }

  _setGrip(g) { for (const a of this.prongs) a.rotation.x = 0.55 - g * 0.9; }

  _groundAt(x, z) {
    const hit = this.arena.physicsWorld.raycast({ x, y: 30, z }, { x: 0, y: -1, z: 0 }, 60);
    return hit ? hit.point.y : null;
  }

  _pickSpot() {
    const ds = (this.arena.dweebs || []).filter(d => d.active && !d.grabbedBy);
    // Usually hunt someone (with lead/jitter), sometimes a random spot for a prize
    if (ds.length && Math.random() < 0.7) {
      const t = ds[Math.floor(Math.random() * ds.length)], p = t.getPosition();
      return { x: p.x + (Math.random() - 0.5) * 2, z: p.z + (Math.random() - 0.5) * 2 };
    }
    const a = Math.random() * Math.PI * 2, r = Math.random() * 9;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  update(dt) {
    this.timer -= dt;
    const c = this.claw.position;
    switch (this.state) {
      case STATE.IDLE:
        if (this.timer <= 0) {
          const s = this._pickSpot(), g = this._groundAt(s.x, s.z);
          if (g == null) { this.timer = 2; break; }
          this.spot = { x: s.x, y: g, z: s.z };
          this.ring.position.set(s.x, g + 0.06, s.z);
          this.ring.visible = true;
          c.set(s.x, g + HIGH, s.z);
          this.state = STATE.TELEGRAPH; this.timer = 2.2;
          this.onEvent?.('warn', this.spot);
        }
        break;
      case STATE.TELEGRAPH: {
        const k = 1 - this.timer / 2.2;
        this.ring.material.opacity = 0.45 + Math.abs(Math.sin(k * 18)) * 0.5;
        this.ring.scale.setScalar(1.25 - k * 0.25);
        c.y = this.spot.y + HIGH - k * 3; // creeps down into view
        if (this.timer <= 0) { this.state = STATE.DESCEND; this.timer = 0.55; }
        break;
      }
      case STATE.DESCEND: {
        const k = 1 - Math.max(0, this.timer) / 0.55;
        c.y = THREE.MathUtils.lerp(this.spot.y + HIGH - 3, this.spot.y + 2.2, k * k);
        if (this.timer <= 0) {
          this.ring.visible = false;
          // Grab the closest dweeb inside the ring
          let best = null, bd = 1.7;
          for (const d of this.arena.dweebs || []) {
            if (!d.active || d.grabbedBy || d.invulnTimer > 0) continue;
            const p = d.getPosition(), dist = Math.hypot(p.x - this.spot.x, p.z - this.spot.z);
            if (dist < bd && Math.abs(p.y - this.spot.y) < 3) { bd = dist; best = d; }
          }
          this.held = best;
          this.hasGift = !best;
          this.gift.visible = this.hasGift;
          this.onEvent?.(best ? 'grab' : 'miss', { d: best, pos: { ...this.spot } });
          this.state = STATE.CLOSE; this.timer = 0.3;
        }
        break;
      }
      case STATE.CLOSE:
        this._setGrip(1 - Math.max(0, this.timer) / 0.3);
        if (this.timer <= 0) { this.state = STATE.LIFT; this.timer = 1.0; }
        break;
      case STATE.LIFT: {
        const k = 1 - Math.max(0, this.timer) / 1.0;
        c.y = THREE.MathUtils.lerp(this.spot.y + 2.2, this.spot.y + CARRY, k);
        if (this.timer <= 0) {
          // Carry toward a drop point: mostly back over the stage, sometimes out past the rim
          const a = Math.random() * Math.PI * 2, r = Math.random() < 0.3 ? 17 + Math.random() * 3 : Math.random() * 10;
          this.from = { x: c.x, z: c.z }; this.to = { x: Math.cos(a) * r, z: Math.sin(a) * r };
          this.state = STATE.SWING; this.timer = 1.6;
        }
        break;
      }
      case STATE.SWING: {
        const k = 1 - Math.max(0, this.timer) / 1.6, e = k * k * (3 - 2 * k);
        c.x = THREE.MathUtils.lerp(this.from.x, this.to.x, e);
        c.z = THREE.MathUtils.lerp(this.from.z, this.to.z, e);
        this.claw.rotation.z = Math.sin(k * Math.PI * 3) * 0.12;
        if (this.timer <= 0) { this.state = STATE.RELEASE; this.timer = 0.35; this._release(); }
        break;
      }
      case STATE.RELEASE:
        this._setGrip(Math.max(0, this.timer) / 0.35);
        if (this.timer <= 0) { this.state = STATE.ASCEND; this.timer = 1.2; }
        break;
      case STATE.ASCEND:
        c.y += dt * 18;
        this.claw.rotation.z *= 0.9;
        if (this.timer <= 0) { this.state = STATE.IDLE; this.timer = 24 + Math.random() * 12; c.y = 40; }
        break;
    }
    // Carried dweeb rides in the prongs, helpless
    if (this.held) {
      const d = this.held;
      if (!d.active) { this.held = null; }
      else {
        d.body.setTranslation({ x: c.x, y: c.y - 1.7, z: c.z }, true);
        d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        d.hitstun = Math.max(d.hitstun || 0, 0.15);
      }
    }
  }

  _release() {
    const c = this.claw.position;
    if (this.held) {
      const d = this.held; this.held = null;
      d.body.setLinvel({ x: (this.to.x - this.from.x) * 0.6, y: -2, z: (this.to.z - this.from.z) * 0.6 }, true);
      d.hitstun = Math.max(d.hitstun || 0, 0.4);
      this.onEvent?.('drop', { d, pos: { x: c.x, y: c.y, z: c.z } });
    } else if (this.hasGift) {
      this.hasGift = false; this.gift.visible = false;
      // Prizes always land on the stage
      const r = Math.hypot(c.x, c.z); if (r > 10) { c.x *= 10 / r; c.z *= 10 / r; }
      const key = this.arena.pickDropItem(this.arena.time || 0);
      if (key) this.arena.spawnItem(key, { x: c.x, y: c.y - 1.6, z: c.z });
      this.onEvent?.('prize', { key, pos: { x: c.x, y: c.y, z: c.z } });
    }
  }

  dispose() {
    if (this.held) this.held = null;
    this.group.parent?.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
