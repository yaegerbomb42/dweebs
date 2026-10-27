// SetPieces.js — the moving parts of the toy set: doors, trapdoors, levers, cranks, buttons,
// conveyors, ladders, ziplines, rope swings, drawbridges and prop spawners.
//
// Every piece is owned by a ToyStructure (`kit`) and uses its shared geometry/material caches.
// Pieces never remove the whole building; they only animate their own meshes, toggle their own
// colliders and (for spawners) reap the few dynamic bodies they created.

import * as THREE from 'three';
import { damp, springSquash, sampleTrack, ziplinePoint, ziplineSpeed } from './ToyKit.js';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// ─── Saloon doors / trapdoors ───

export class HingedDoor {
  constructor(kit, {
    x = 0, y = 0, z = 0, rotY = 0,
    width = 3.2, height = 2.2, thickness = 0.16,
    color = 0xb45309, accent = 0xffd23f,
    swing = 1, burstSpeed = 7.5, closeDelay = 2.4,
    onOpen = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z; this.rotY = rotY;
    this.width = width; this.height = height; this.thickness = thickness;
    this.swing = swing;
    this.burstSpeed = burstSpeed;
    this.closeDelay = closeDelay;
    this.onOpen = onOpen;

    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    kit.group.add(this.root);

    this.pivots = [];
    this.leaves = [];
    const leafW = width * 0.5;
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * width * 0.5, height * 0.5, 0);
      this.root.add(pivot);
      const leaf = kit._meshRBox(leafW - 0.06, height - 0.08, thickness, 0.035, color, {
        p: [-side * leafW * 0.5, 0, 0],
      }, {}, pivot);
      // Saloon door slats and a warm handle
      kit._meshBox(leafW * 0.82, 0.1, thickness + 0.02, accent, {
        p: [-side * leafW * 0.5, height * 0.22, 0],
      }, {}, pivot);
      kit._meshBox(leafW * 0.82, 0.1, thickness + 0.02, accent, {
        p: [-side * leafW * 0.5, -height * 0.22, 0],
      }, {}, pivot);
      kit._meshCyl(0.055, 0.055, 0.09, 8, accent, {
        p: [-side * leafW * 0.68, 0, thickness * 0.6], r: [Math.PI / 2, 0, 0],
      }, {}, pivot);
      this.pivots.push({ pivot, side, leaf });
      this.leaves.push(leaf);
    }

    // One solid collider across the doorway while shut.
    this.collider = kit.staticBox(x, y + height * 0.5, z, width * 0.5, height * 0.5, thickness * 0.7, 'wood', [0, rotY, 0]);
    this.open = false;
    this.angle = 0;
    this.targetAngle = 0;
    this.burst = 0;
    this.closeTimer = 0;
    this.center = kit.worldPoint(x, y + height * 0.5, z);
  }

  _dropCollider() {
    if (!this.collider) return;
    this.kit.physics?.removeBody?.(this.collider.id);
    const i = this.kit.colliders.indexOf(this.collider);
    if (i >= 0) this.kit.colliders.splice(i, 1);
    this.collider = null;
  }

  _restoreCollider() {
    if (this.collider) return;
    this.collider = this.kit.staticBox(
      this.x, this.y + this.height * 0.5, this.z,
      this.width * 0.5, this.height * 0.5, this.thickness * 0.7,
      'wood', [0, this.rotY, 0],
    );
  }

  openUp(burst = false) {
    if (!this.open) {
      this.open = true;
      this.burst = burst ? 0.55 : 0.22;
      this._dropCollider();
      this.kit._fx(burst ? 'doorThwack' : 'doorOpen', this.center);
      this.onOpen?.(this, burst);
    }
    this.closeTimer = 0;
  }

  closeUp() {
    if (!this.open) return;
    this.open = false;
    this.kit._fx('doorClose', this.center);
  }

  update(dt, ctx) {
    this.closeTimer += dt;
    let near = false;
    this.kit._dweebs(ctx, d => {
      const p = d.body.translation();
      const dx = p.x - this.center.x, dz = p.z - this.center.z;
      if (Math.hypot(dx, dz) > Math.max(1.7, this.width * 0.9)) return;
      if (Math.abs(p.y - this.center.y) > this.height * 0.85) return;
      near = true;
      this.closeTimer = 0;
      const v = d.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      if (speed > this.burstSpeed) this.openUp(true);
      else if (speed > 1.2) this.openUp(false);
    });

    const target = this.open ? 1 : 0;
    this.angle = damp(this.angle, target, this.burst > 0 ? 26 : 11, dt);
    this.burst = Math.max(0, this.burst - dt);
    for (const { pivot, side } of this.pivots) {
      pivot.rotation.y = side * this.swing * this.angle * Math.PI * 0.52;
    }
    if (this.open && !near && this.closeTimer > this.closeDelay && this.angle > 0.985) {
      this.closeUp();
    }
    if (!this.open && !this.collider && this.angle < 0.04) this._restoreCollider();
  }

  dispose() {
    this._dropCollider();
  }
}

export class Trapdoor {
  constructor(kit, {
    x = 0, y = 1, z = 0, rotY = 0,
    width = 2.2, depth = 2.2, thickness = 0.18,
    color = 0x8a5a2b, accent = 0xffd23f,
    onOpen = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z; this.rotY = rotY;
    this.width = width; this.depth = depth; this.thickness = thickness;
    this.onOpen = onOpen;
    this.open = false;
    this.angle = 0;
    this.closeTimer = 0;
    this.center = kit.worldPoint(x, y, z);

    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    kit.group.add(this.root);

    this.pivot = new THREE.Group();
    this.pivot.position.set(0, 0, -depth * 0.5);
    this.root.add(this.pivot);
    kit._meshRBox(width, thickness, depth, 0.03, color, { p: [0, 0, depth * 0.5] }, {}, this.pivot);
    for (let i = 0; i < 3; i++) {
      kit._meshBox(width * 0.94, thickness + 0.03, 0.09, i % 2 ? accent : 0x6b3f1d, {
        p: [0, 0.005, depth * (0.2 + i * 0.3)],
      }, {}, this.pivot);
    }
    kit._meshTorus(0.16, 0.035, 4, 10, accent, { p: [0, 0.15, depth * 0.72], r: [Math.PI / 2, 0, 0] }, {}, this.pivot);

    this.collider = kit.staticBox(x, y - thickness * 0.5, z, width * 0.5, thickness * 0.6, depth * 0.5, 'wood', [0, rotY, 0]);
  }

  _dropCollider() {
    if (!this.collider) return;
    this.kit.physics?.removeBody?.(this.collider.id);
    const i = this.kit.colliders.indexOf(this.collider);
    if (i >= 0) this.kit.colliders.splice(i, 1);
    this.collider = null;
  }

  _restoreCollider() {
    if (this.collider) return;
    this.collider = this.kit.staticBox(
      this.x, this.y - this.thickness * 0.5, this.z,
      this.width * 0.5, this.thickness * 0.6, this.depth * 0.5,
      'wood', [0, this.rotY, 0],
    );
  }

  openUp() {
    if (this.open) return;
    this.open = true;
    this._dropCollider();
    this.kit._fx('trapdoor', this.center);
    this.onOpen?.(this);
  }

  closeUp() {
    if (!this.open) return;
    this.open = false;
  }

  update(dt, ctx) {
    this.closeTimer += dt;
    let onTop = false;
    this.kit._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.abs(p.x - this.center.x) > this.width * 0.55) return;
      if (Math.abs(p.z - this.center.z) > this.depth * 0.55) return;
      if (p.y < this.y - 0.4 || p.y > this.y + 1.4) return;
      onTop = true;
      this.closeTimer = 0;
      const v = d.body.linvel();
      if (v.y < 0.5) this.openUp();
    });
    const target = this.open ? 1 : 0;
    this.angle = damp(this.angle, target, 12, dt);
    this.pivot.rotation.x = this.angle * Math.PI * 0.54;
    if (this.open && !onTop && this.closeTimer > 2.2 && this.angle > 0.95) this.closeUp();
    if (!this.open && !this.collider && this.angle < 0.03) this._restoreCollider();
  }

  dispose() {
    this._dropCollider();
  }
}

// ─── Levers, cranks and pressure buttons ───

export class Lever {
  constructor(kit, {
    x = 0, y = 0, z = 0, rotY = 0, label = 'lever',
    value = 1, radius = 2.0,
    onToggle = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z; this.rotY = rotY;
    this.label = label;
    this.value = value;
    this.radius = radius;
    this.onToggle = onToggle;
    this.angle = value > 0 ? 0.5 : -0.5;
    this.center = kit.worldPoint(x, y + 0.7, z);

    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    kit.group.add(this.root);

    kit._meshRBox(0.78, 0.55, 0.5, 0.06, 0x64748b, { p: [0, 0.3, 0] }, {}, this.root);
    kit._meshCyl(0.3, 0.34, 0.12, 8, 0xffd23f, { p: [0, 0.58, 0] }, {}, this.root);
    this.pivot = new THREE.Group();
    this.pivot.position.set(0, 0.58, 0);
    this.root.add(this.pivot);
    kit._meshCyl(0.055, 0.07, 1.05, 8, 0x6b3f1d, { p: [0, 0.52, 0] }, {}, this.pivot);
    kit._meshSphere(0.18, 8, 0xff4d5e, { p: [0, 1.05, 0] }, {}, this.pivot);
    this.pivot.rotation.z = this.angle;
    kit.staticBox(x, y + 0.3, z, 0.4, 0.3, 0.28, 'metal', [0, rotY, 0]);
    this._cool = {};
  }

  toggle() {
    this.value *= -1;
    this.onToggle?.(this.value);
    this.kit._fx('lever', this.center);
    return this.value;
  }

  update(dt, ctx) {
    this.kit._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.hypot(p.x - this.center.x, p.z - this.center.z) > this.radius) return;
      if (Math.abs(p.y - this.center.y) > 1.5) return;
      const v = d.body.linvel();
      if (!this.kit._cool(d, `lever:${this.label}`, dt, 1.1)) return;
      if (Math.hypot(v.x, v.z) > 1.2 || d.jumpRequested) this.toggle();
    });
    this.angle = damp(this.angle, this.value > 0 ? 0.5 : -0.5, 10, dt);
    this.pivot.rotation.z = this.angle;
  }

  dispose() {}
}

export class CrankWheel {
  constructor(kit, {
    x = 0, y = 0, z = 0, rotY = 0, radius = 0.8, label = 'crank',
    onPower = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z; this.rotY = rotY;
    this.radius = radius;
    this.label = label;
    this.onPower = onPower;
    this.center = kit.worldPoint(x, y + 1.4, z);
    this.power = 0;
    this.spin = 0;

    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    kit.group.add(this.root);
    kit._meshRBox(0.5, 1.4, 0.4, 0.05, 0x6b3f1d, { p: [0, 0.7, -0.28] }, {}, this.root);
    this.wheel = new THREE.Group();
    this.wheel.position.set(0, 1.1, 0);
    this.root.add(this.wheel);
    kit._meshTorus(radius, 0.09, 6, 16, 0xffd23f, {}, {}, this.wheel);
    kit._meshCyl(0.12, 0.12, 0.22, 8, 0x64748b, { r: [Math.PI / 2, 0, 0] }, {}, this.wheel);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      kit._meshBox(0.08, radius * 1.9, 0.08, 0xff9a3c, {
        p: [0, 0, 0], r: [0, 0, a],
      }, {}, this.wheel);
    }
    kit.staticBox(x, y + 0.7, z - 0.25, 0.24, 0.7, 0.18, 'wood', [0, rotY, 0]);
  }

  update(dt, ctx) {
    let near = false;
    this.kit._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.hypot(p.x - this.center.x, p.z - this.center.z) < 2.1 && Math.abs(p.y - this.center.y) < 2) {
        near = true;
        if (this.kit._cool(d, `crank:${this.label}`, dt, 1.4)) this.kit._fx('crank', this.center);
      }
    });
    this.power = damp(this.power, near ? 1 : 0, 5, dt);
    this.spin += dt * (1.2 + this.power * 8);
    this.wheel.rotation.z = this.spin;
    this.onPower?.(this.power);
  }

  dispose() {}
}

export class PressureButton {
  constructor(kit, {
    x = 0, y = 0, z = 0, radius = 1.15, color = 0xffd23f, accent = 0xff4d5e,
    onPress = null, onRelease = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z;
    this.radius = radius;
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.pressed = false;
    this.depth = 0;
    this.center = kit.worldPoint(x, y, z);

    kit._batchCyl(radius * 1.18, radius * 1.28, 0.16, 10, 0x64748b, { p: [x, y + 0.08, z] });
    this.padBaseY = y + 0.15;
    this.pad = kit._meshCyl(radius, radius * 1.04, 0.2, 10, color, { p: [x, this.padBaseY, z] }, {}, kit.group);
    kit._meshTorus(radius * 0.55, 0.06, 4, 12, accent, {
      p: [0, 0.12, 0], r: [Math.PI / 2, 0, 0],
    }, {}, this.pad);
    kit.staticCylinder(x, y + 0.06, z, radius * 1.2, 0.08, 'stone');
  }

  update(dt, ctx) {
    let down = false;
    this.kit._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.hypot(p.x - this.center.x, p.z - this.center.z) > this.radius + 0.35) return;
      if (p.y < this.y - 0.5 || p.y > this.y + 1.3) return;
      down = true;
    });
    if (down !== this.pressed) {
      this.pressed = down;
      if (down) {
        this.onPress?.(this);
        this.kit._fx('button', this.center);
      } else {
        this.onRelease?.(this);
      }
    }
    this.depth = damp(this.depth, down ? 0.12 : 0, 18, dt);
    this.pad.position.y = this.padBaseY - this.depth;
  }

  dispose() {}
}

// ─── Motion surfaces ───

export class ConveyorZone {
  constructor(kit, {
    x = 0, y = 0, z = 0, hw = 2, hd = 1, dirX = 1, dirZ = 0,
    speed = 5, label = 'conveyor',
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z;
    this.hw = hw; this.hd = hd;
    this.baseDir = { x: dirX, z: dirZ };
    this.dir = 1;
    this.speed = speed;
    this.label = label;
  }

  setDirection(dir) {
    this.dir = dir < 0 ? -1 : 1;
  }

  update(dt, ctx) {
    if (this.dir === 0) return;
    const d = this.dir;
    const inv = _q.copy(this.kit._localYaw).invert();
    this.kit._dweebs(ctx, dweeb => {
      const p = dweeb.body.translation();
      const lp = _p.set(p.x, p.y, p.z).sub(this.kit.position).applyQuaternion(inv);
      if (Math.abs(lp.x - this.x) > this.hw || Math.abs(lp.z - this.z) > this.hd) return;
      if (Math.abs(lp.y - this.y) > 0.7) return;
      const v = dweeb.body.linvel();
      const wx = (this.baseDir.x * Math.cos(this.kit.rotationY) + this.baseDir.z * Math.sin(this.kit.rotationY)) * d;
      const wz = (-this.baseDir.x * Math.sin(this.kit.rotationY) + this.baseDir.z * Math.cos(this.kit.rotationY)) * d;
      dweeb.body.setLinvel({ x: v.x + wx * this.speed * dt * 5, y: v.y, z: v.z + wz * this.speed * dt * 5 }, true);
      // A tiny positional nudge makes belts read even against velocity-driven Dweeb movement.
      dweeb.body.setTranslation({ x: p.x + wx * this.speed * dt * 0.55, y: p.y, z: p.z + wz * this.speed * dt * 0.55 }, true);
    });
  }

  dispose() {}
}

export class BounceSurface {
  constructor(kit, {
    x = 0, y = 0, z = 0, radius = 2.5,
    boost = 18, color = 0xff6fb5, label = 'bounce',
    visual = null, squashY = 0.16,
    onBounce = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z;
    this.radius = radius;
    this.boost = boost;
    this.color = color;
    this.label = label;
    this.visual = visual;
    this.squashY = squashY;
    this.onBounce = onBounce;
    this.center = kit.worldPoint(x, y, z);
    this.squash = 0;
    this.squashV = 0;
  }

  kick(power = 1) {
    this.squashV -= 3.6 * power;
  }

  update(dt, ctx) {
    const st = springSquash(this.squash, this.squashV, dt, 170, 11);
    this.squash = st.squash;
    this.squashV = st.velocity;
    const sq = Math.max(-0.28, Math.min(0.3, this.squash));
    if (this.visual) {
      this.visual.scale.set(1 + sq * 0.45, 1 - sq * this.squashY / 0.3 * 0.3, 1 + sq * 0.45);
    }

    this.kit._dweebs(ctx, d => {
      const p = d.body.translation();
      const dist = Math.hypot(p.x - this.center.x, p.z - this.center.z);
      if (dist > this.radius) return;
      const dy = p.y - this.center.y;
      if (dy < -0.9 || dy > 1.7) return;
      const v = d.body.linvel();
      if (v.y > 3.2) return;
      if (!this.kit._cool(d, `bounce:${this.label}`, dt, 0.32)) return;
      d.body.setLinvel({ x: v.x * 0.92, y: this.boost, z: v.z * 0.92 }, true);
      this.kick(1);
      this.kit._fx('bounce', { x: this.center.x, y: this.center.y + 0.2, z: this.center.z }, this.color);
      if (d.onBounce) d.onBounce();
      this.onBounce?.(d, this);
    });
  }

  dispose() {}
}

export class LadderZone {
  constructor(kit, {
    x = 0, y = 0, z = 0, rotY = 0,
    width = 1.2, height = 6, depth = 0.7,
    climbSpeed = 3.4, jumpBoost = 5.5,
    onGrab = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z;
    this.width = width; this.height = height; this.depth = depth;
    this.climbSpeed = climbSpeed;
    this.jumpBoost = jumpBoost;
    this.onGrab = onGrab;
    this.center = kit.worldPoint(x, y + height * 0.5, z);
    this.rotY = rotY;
  }

  update(dt, ctx) {
    const inv = _q.copy(this.kit._localYaw).invert();
    this.kit._dweebs(ctx, d => {
      const p = d.body.translation();
      const lp = _p.set(p.x, p.y, p.z).sub(this.kit.position).applyQuaternion(inv);
      if (Math.abs(lp.x - this.x) > this.width * 0.5) return;
      if (Math.abs(lp.z - this.z) > this.depth * 0.5) return;
      if (lp.y < this.y - 0.5 || lp.y > this.y + this.height + 0.4) return;
      const intent = (d.moveInput?.lengthSq?.() || 0) > 0.01 || d.jumpRequested;
      if (!intent) return;
      const boost = d.jumpRequested ? this.jumpBoost : this.climbSpeed;
      const ny = Math.min(this.y + this.height, p.y + boost * dt);
      d.body.setTranslation({ x: p.x, y: ny, z: p.z }, true);
      const v = d.body.linvel();
      d.body.setLinvel({ x: v.x, y: Math.max(v.y, 0.4), z: v.z }, true);
      if (this.kit._cool(d, 'ladder', dt, 0.7)) {
        this.kit._fx('ladder', this.center);
        this.onGrab?.(d);
      }
    });
  }

  dispose() {}
}

export class RopeSwing {
  constructor(kit, {
    x = 0, y = 6, z = 0,
    length = 2.4, radius = 1.8,
    color = 0xd4a86a, onSwing = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z;
    this.length = length;
    this.radius = radius;
    this.onSwing = onSwing;
    this.center = kit.worldPoint(x, y - length, z);

    this.pivot = new THREE.Group();
    this.pivot.position.set(x, y, z);
    kit.group.add(this.pivot);
    kit._meshCyl(0.035, 0.045, length, 5, color, { p: [0, -length * 0.5, 0] }, {}, this.pivot);
    kit._meshTorus(0.22, 0.055, 4, 10, 0xff9a3c, {
      p: [0, -length, 0], r: [Math.PI / 2, 0, 0],
    }, {}, this.pivot);
    this.theta = 0;
    this.omega = 0;
  }

  update(dt, ctx) {
    this.omega += (-this.theta * 4.2 - this.omega * 0.7) * dt;
    this.theta += this.omega * dt;
    this.pivot.rotation.z = this.theta;

    const bob = new THREE.Vector3(
      this.center.x + Math.sin(this.theta) * this.length,
      this.center.y + (1 - Math.cos(this.theta)) * this.length,
      this.center.z,
    );
    this.kit._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.hypot(p.x - bob.x, p.z - bob.z) > this.radius || Math.abs(p.y - bob.y) > 1.2) return;
      if (!this.kit._cool(d, 'ropeSwing', dt, 1.2)) return;
      const tangent = Math.cos(this.theta) * this.length;
      d.body.setLinvel({
        x: Math.cos(this.theta) * 5.5 + tangent * 0.2,
        y: 4.2,
        z: Math.sin(this.theta) * 1.2,
      }, true);
      this.omega += 1.6;
      this.kit._fx('ropeSwing', bob);
      this.onSwing?.(d);
    });
  }

  dispose() {}
}

export class Zipline {
  constructor(kit, {
    a = { x: 0, y: 6, z: 0 }, b = { x: 8, y: 0.4, z: 4 },
    sag = 0.5, speed = 13, onRelease = null,
  } = {}) {
    this.kit = kit;
    this.aLocal = new THREE.Vector3(a.x, a.y, a.z);
    this.bLocal = new THREE.Vector3(b.x, b.y, b.z);
    this.a = kit.worldPoint(a.x, a.y, a.z);
    this.b = kit.worldPoint(b.x, b.y, b.z);
    this.sag = sag;
    this.terminal = speed;
    this.onRelease = onRelease;
    this.dist = this.a.distanceTo(this.b);
    this.drop = Math.max(0, this.a.y - this.b.y);
    this.riders = new Set();

    // Cable as a chain of thin box beams (batched).
    const pts = sampleTrack([this.aLocal, this.bLocal], 14, sag);
    for (let i = 0; i < pts.length - 1; i++) {
      this.kit._batchBeam(pts[i].toArray(), pts[i + 1].toArray(), 0.045, 0.045, 0x334155);
    }
    // Anchor posts at each end.
    this.kit._batchCyl(0.14, 0.18, 1.4, 6, 0x6b3f1d, { p: [a.x, a.y + 0.5, a.z] });
    this.kit._batchCyl(0.12, 0.16, 1.0, 6, 0x6b3f1d, { p: [b.x, b.y + 0.35, b.z] });

    this.trolley = new THREE.Group();
    kit.group.add(this.trolley);
    kit._meshTorus(0.18, 0.045, 4, 8, 0xffd23f, { r: [Math.PI / 2, 0, 0] }, {}, this.trolley);
    kit._meshCyl(0.035, 0.035, 0.55, 6, 0xff4d5e, { p: [0, -0.3, 0] }, {}, this.trolley);
    this._placeTrolley(0);
  }

  _placeTrolley(t) {
    const p = ziplinePoint(this.aLocal, this.bLocal, t, this.sag);
    this.trolley.position.set(p.x, p.y, p.z);
  }

  attach(d) {
    if (d.zipRide) return false;
    d.zipRide = {
      t: 0,
      speed: 2.8,
      handle: this,
      pos: { x: this.a.x, y: this.a.y - 0.5, z: this.a.z },
      vel: { x: 0, y: 0, z: 0 },
    };
    d.body.setTranslation(d.zipRide.pos, true);
    d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    d.body.setGravityScale(0, true);
    this.riders.add(d);
    this.kit._fx('zipStart', this.a);
    return true;
  }

  release(d, full = true) {
    if (!d.zipRide) return;
    const dir = this.b.clone().sub(this.a).normalize();
    d.zipRide = null;
    this.riders.delete(d);
    d.body.setGravityScale(1, true);
    d.body.setLinvel({
      x: dir.x * (full ? 7.5 : 2.5),
      y: full ? 4.2 : 0.5,
      z: dir.z * (full ? 7.5 : 2.5),
    }, true);
    this.kit._fx('zipEnd', this.b);
    this.onRelease?.(d, this);
  }

  update(dt, ctx) {
    // Boarding: jump near the top handle.
    this.kit._dweebs(ctx, d => {
      if (d.zipRide) return;
      const p = d.body.translation();
      if (this.a.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) > 2.1) return;
      if (!this.kit._cool(d, 'zipline', dt, 2.4)) return;
      this.attach(d);
    });

    for (const d of this.riders) {
      const ride = d.zipRide;
      if (!ride || !d.body) { this.riders.delete(d); continue; }
      ride.speed = ziplineSpeed(25, this.drop, this.dist, ride.t, this.terminal);
      ride.t += (ride.speed * dt) / Math.max(0.001, this.dist);
      if (ride.t >= 1) {
        this.release(d, true);
        continue;
      }
      const p = ziplinePoint(this.a, this.b, ride.t, this.sag);
      const p2 = ziplinePoint(this.a, this.b, Math.min(1, ride.t + 0.02), this.sag);
      const tx = p2.x - p.x, ty = p2.y - p.y, tz = p2.z - p.z;
      const inv = 1 / Math.max(0.001, Math.hypot(tx, ty, tz));
      ride.pos = { x: p.x, y: p.y - 0.55, z: p.z };
      ride.vel = { x: tx * inv * ride.speed, y: ty * inv * ride.speed, z: tz * inv * ride.speed };
      d.body.setTranslation(ride.pos, true);
      d.body.setLinvel(ride.vel, true);
      this._placeTrolley(ride.t);
    }
    if (this.riders.size === 0) this._placeTrolley(0);
  }

  dispose() {
    for (const d of this.riders) {
      if (d.body) {
        d.zipRide = null;
        d.body.setGravityScale(1, true);
      }
    }
    this.riders.clear();
  }
}

// ─── Hinged bridges and rising gates ───

export class Drawbridge {
  constructor(kit, {
    x = 0, y = 0.2, z = 0, rotY = 0,
    length = 4.2, width = 3.6, thickness = 0.28,
    color = 0x8a5a2b, accent = 0x334155,
    raised = false, onToggle = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z; this.rotY = rotY;
    this.length = length; this.width = width; this.thickness = thickness;
    this.raised = raised;
    this.onToggle = onToggle;
    this.angle = raised ? -Math.PI / 2 : 0;
    this.center = kit.worldPoint(x, y, z);

    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    kit.group.add(this.root);

    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    kit._meshRBox(width, thickness, length, 0.04, color, { p: [0, 0, length * 0.5] }, {}, this.pivot);
    for (let i = 0; i < 5; i++) {
      kit._meshBox(width * 0.92, thickness + 0.04, 0.11, i % 2 ? accent : 0xd4a86a, {
        p: [0, 0.01, length * (0.12 + i * 0.19)],
      }, {}, this.pivot);
    }
    for (const side of [-1, 1]) {
      kit._meshCyl(0.035, 0.035, length * 0.9, 4, 0x64748b, {
        p: [side * width * 0.34, 0.7, length * 0.55], r: [Math.PI / 2, 0, 0],
      }, {}, this.root);
    }
    this.pivot.rotation.x = this.angle;

    this.kin = kit.kinematicBox(x, y, z, width * 0.5, thickness * 0.5, length * 0.5, {
      x: 0, y: 0, z: length * 0.5,
    }, 'wood');
    this._syncBody();
  }

  _syncBody() {
    _e.set(this.angle, 0, 0);
    _q.setFromEuler(_e);
    const worldQ = this.kit.worldQuat(_q);
    this.kin.body.setNextKinematicRotation({ x: worldQ.x, y: worldQ.y, z: worldQ.z, w: worldQ.w });
  }

  setRaised(value) {
    this.raised = !!value;
    this.onToggle?.(this.raised);
    this.kit._fx('drawbridge', this.center);
  }

  toggle() {
    this.setRaised(!this.raised);
  }

  update(dt) {
    this.angle = damp(this.angle, this.raised ? -Math.PI / 2 : 0, 6.5, dt);
    this.pivot.rotation.x = this.angle;
    this._syncBody();
  }

  dispose() {}
}

export class RisingGate {
  constructor(kit, {
    x = 0, y = 2, z = 0, rotY = 0,
    width = 3.6, height = 3.2, thickness = 0.25,
    color = 0x334155, accent = 0x3ee6d0,
    openOffset = 3.4, onOpen = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z; this.rotY = rotY;
    this.height = height;
    this.openOffset = openOffset;
    this.open = false;
    this.offset = 0;
    this.onOpen = onOpen;
    this.center = kit.worldPoint(x, y, z);

    this.mesh = kit._meshRBox(width, height, thickness, 0.04, color, { p: [x, y, z], r: [0, rotY, 0] });
    // Rune bands so the secret gate reads at a glance.
    kit._meshBox(width * 0.8, 0.12, thickness + 0.03, accent, { p: [x, y + 0.8, z], r: [0, rotY, 0] });
    kit._meshBox(width * 0.8, 0.12, thickness + 0.03, accent, { p: [x, y - 0.8, z], r: [0, rotY, 0] });
    this.kin = kit.kinematicBox(x, y, z, width * 0.5, height * 0.5, thickness * 0.5, null, 'stone');
  }

  setOpen(value) {
    if (this.open === !!value) return;
    this.open = !!value;
    if (this.open) {
      this.kit._fx('gate', this.center);
      this.onOpen?.(this);
    }
  }

  toggle() { this.setOpen(!this.open); }

  update(dt) {
    this.offset = damp(this.offset, this.open ? this.openOffset : 0, 5, dt);
    const p = this.kit.worldPoint(this.x, this.y + this.offset, this.z);
    this.mesh.position.set(this.x, this.y + this.offset, this.z);
    this.kin.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
  }

  dispose() {}
}

// ─── Prop spawner (overhead crate, plush ball launcher) ───

export class PropSpawner {
  constructor(kit, {
    x = 0, y = 6, z = 0,
    kind = 'crate', color = 0xff6fb5,
    launch = { x: 0, y: 2, z: 4 },
    interval = 0.7,
    onFire = null,
  } = {}) {
    this.kit = kit;
    this.x = x; this.y = y; this.z = z;
    this.kind = kind;
    this.color = color;
    this.launch = launch;
    this.interval = interval;
    this.onFire = onFire;
    this.live = [];
    this.cooldown = 0;
    this.origin = kit.worldPoint(x, y, z);
  }

  fire() {
    if (this.cooldown > 0) return null;
    this.cooldown = this.interval;
    const isBall = this.kind === 'ball' || this.kind === 'plush';
    const dims = isBall
      ? { radius: 0.42 }
      : { hx: 0.42, hy: 0.42, hz: 0.42 };
    const mesh = isBall
      ? this.kit._meshSphere(0.42, 10, this.color, { p: [this.x, this.y, this.z] })
      : this.kit._meshRBox(0.84, 0.84, 0.84, 0.08, this.color, { p: [this.x, this.y, this.z] });
    // Dynamic props live in world space, not in the structure's local group.
    this.kit.group.remove(mesh);
    this.kit.scene?.add(mesh);
    const o = this.origin;
    mesh.position.set(o.x, o.y, o.z);
    const result = this.kit.physics.createDynamicBody(o.x, o.y, o.z, isBall ? 'sphere' : 'box', dims, {
      material: isBall ? 'rubber' : 'wood',
      mass: isBall ? 1.2 : 2.4,
      id: `toyprop_${this.kit.id}_${this.live.length}_${Math.floor(performance.now?.() || 0)}`,
      ref: null,
    });
    const impulse = {
      x: this.launch.x + (Math.random() - 0.5) * 0.8,
      y: this.launch.y,
      z: this.launch.z + (Math.random() - 0.5) * 0.8,
    };
    this.kit.physics.applyImpulse(result.body, impulse);
    this.live.push({ mesh, body: result.body, id: result.id, life: 8 });
    this.kit._fx('propLaunch', o, this.color);
    this.onFire?.(result);
    return result;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.body) {
        const t = p.body.translation();
        p.mesh.position.set(t.x, t.y, t.z);
        const r = p.body.rotation();
        p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
      if (p.life <= 0 || !p.body || p.body.translation().y < -12) {
        this.kit.physics.removeBody(p.id);
        this.kit.scene?.remove(p.mesh);
        this.live.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const p of this.live) {
      this.kit.physics?.removeBody?.(p.id);
      this.kit.scene?.remove(p.mesh);
    }
    this.live.length = 0;
  }
}
