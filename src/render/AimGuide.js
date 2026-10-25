// AimGuide.js — the throw preview: a flowing dotted arc (inked like everything else) and a landing reticle.
// The arc comes from CombatSystem.predictThrow, which uses the same launch maths as the real throw.
// Locked on a rival → the reticle jumps to their lead position, turns red and its brackets clamp in.

import * as THREE from 'three';
import { noOutline } from './Toon.js';

const MAX_DOTS = 70;
const SPACING = 0.05;         // seconds of flight between dots
const FLOW = 2.4;             // dots per second drifting along the arc
const LOCK_COLOR = new THREE.Color(0xff3d6e);
const WHITE = new THREE.Color(0xfff8ee);
const FOCUS_ITEM = 0xffd23f;
const FOCUS_RIVAL = 0xff3d6e;
const INK = 0x1b1030;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

export class AimGuide {
  constructor(scene, waterLevel) {
    this.waterLevel = waterLevel;
    this.points = [];
    this.phase = 0;
    this.pulse = 0;
    this.alpha = 0;
    this.lockT = 0;
    this.lastTarget = null;
    this.onLock = null;

    // Dots: coloured fill + slightly larger back-face ink shell (hand-made outline; instancing skips OutlineEffect)
    const geo = new THREE.SphereGeometry(1, 10, 8);
    this.dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
    this.inkMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, depthWrite: false, side: THREE.BackSide });
    this.dots = new THREE.InstancedMesh(geo, this.dotMat, MAX_DOTS);
    this.ink = new THREE.InstancedMesh(geo, this.inkMat, MAX_DOTS);
    for (const m of [this.ink, this.dots]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.renderOrder = m === this.dots ? 4 : 3; // ink shell first, fill on top
      noOutline(m);
      scene.add(m);
    }
    this.dots.setColorAt(0, WHITE);

    // Reticle: inked ring, inner dot, four lock brackets, optional blast-radius ring
    this.reticle = new THREE.Group();
    const flat = (g, color, opacity = 1, parent = this.reticle) => {
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -4,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 3;
      noOutline(mesh);
      parent.add(mesh);
      return mesh;
    };
    this.ringInk = flat(new THREE.RingGeometry(0.36, 0.7, 40), INK);
    this.ring = flat(new THREE.RingGeometry(0.43, 0.62, 40), 0xffffff);
    this.dot = flat(new THREE.CircleGeometry(0.14, 20), 0xffffff);
    this.blast = flat(new THREE.RingGeometry(0.94, 1, 64), 0xff8a3c, 0.55);
    this.brackets = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(0.34, 0.2); shape.lineTo(0.34, -0.2); shape.closePath();
    const bGeo = new THREE.ShapeGeometry(shape);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i * Math.PI) / 2;
      const b = flat(bGeo, LOCK_COLOR.getHex());
      this.reticle.remove(b);
      b.position.x = 0.95;
      arm.add(b);
      this.brackets.add(arm);
    }
    this.reticle.add(this.brackets);
    this.reticle.visible = false;
    scene.add(this.reticle);

    // Focus ring: the one rival/prop that E will grab, or the rival your next swing will hit.
    this.focusGroup = new THREE.Group();
    this.focusRing = flat(new THREE.RingGeometry(0.44, 0.56, 36), FOCUS_ITEM, 0.95, this.focusGroup);
    this.focusDot = flat(new THREE.CircleGeometry(0.1, 18), 0xffffff, 0.9, this.focusGroup);
    this.focusGroup.visible = false;
    this.focusPulse = 0;
    this.focusTarget = null;
    scene.add(this.focusGroup);

    // Attack preview: a soft ground wedge showing reach and arc while charging.
    this.attackGroup = new THREE.Group();
    this.attackTilt = new THREE.Group();
    this.attackTilt.rotation.x = -Math.PI / 2;
    this.attackGroup.add(this.attackTilt);
    this.attackGroup.visible = false;
    this.attackKey = '';
    this.attackArcMat = new THREE.MeshBasicMaterial({
      color: 0xfff3c4, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
      toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3,
    });
    this.attackEdgeMat = new THREE.LineBasicMaterial({
      color: 0xfff3c4, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false,
    });
    this.attackMesh = null;
    this.attackEdge = null;
    scene.add(this.attackGroup);

    this.hide();
  }

  hide() {
    this.dots.count = 0;
    this.ink.count = 0;
    this.reticle.visible = false;
    this.alpha = 0;
    this.lastTarget = null;
  }

  /** Show which object/rival is selected by the aim ray. */
  setFocus(target, kind = 'dweeb', dt = 0) {
    if (!target) { this.focusGroup.visible = false; this.focusTarget = null; return; }
    this.focusTarget = target;
    this.focusPulse += dt;
    const pos = target.getPosition();
    let y = pos.y;
    if (kind === 'dweeb') {
      const gy = target.groundY;
      y = gy != null && gy > -50 ? gy + 0.03 : pos.y - 0.5;
    }
    this.focusGroup.position.set(pos.x, y + 0.04, pos.z);
    const beat = 1 + Math.sin(this.focusPulse * 10) * 0.06;
    this.focusGroup.scale.setScalar((kind === 'dweeb' ? 1.05 : 0.86) * beat);
    this.focusGroup.visible = true;
    this.focusRing.material.color.setHex(kind === 'dweeb' ? FOCUS_RIVAL : FOCUS_ITEM);
    this.focusRing.material.opacity = 0.75 + Math.sin(this.focusPulse * 10) * 0.15;
  }

  hideFocus() {
    this.focusGroup.visible = false;
    this.focusTarget = null;
  }

  /**
   * Show the live swing footprint.
   * @param profile {range, cone, multi}
   * @param pos     player foot position
   * @param yaw     facing direction
   * @param charge  0..1
   */
  setAttack(profile, pos, yaw, charge = 0) {
    if (!profile) { this.attackGroup.visible = false; return; }
    const half = profile.cone <= 0 ? Math.PI : Math.acos(THREE.MathUtils.clamp(profile.cone, -1, 1));
    const key = half.toFixed(4);
    if (key !== this.attackKey) {
      this.attackKey = key;
      const geo = this._sectorGeometry(half);
      const edge = this._sectorOutline(half);
      if (!this.attackMesh) {
        this.attackMesh = new THREE.Mesh(geo, this.attackArcMat);
        this.attackEdge = new THREE.Line(edge, this.attackEdgeMat);
        for (const m of [this.attackMesh, this.attackEdge]) {
          m.renderOrder = 2;
          noOutline(m);
          this.attackTilt.add(m);
        }
      } else {
        this.attackMesh.geometry.dispose();
        this.attackMesh.geometry = geo;
        this.attackEdge.geometry.dispose();
        this.attackEdge.geometry = edge;
      }
    }
    this.attackGroup.visible = true;
    this.attackGroup.position.set(pos.x, pos.y + 0.04, pos.z);
    this.attackGroup.rotation.y = yaw - Math.PI / 2;
    this.attackGroup.scale.setScalar(profile.range);
    this.attackArcMat.opacity = 0.055 + charge * 0.09;
    this.attackEdgeMat.opacity = 0.24 + charge * 0.32;
  }

  hideAttack() {
    this.attackGroup.visible = false;
  }

  _sectorGeometry(half) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.absarc(0, 0, 1, -half, half, false);
    shape.lineTo(0, 0);
    return new THREE.ShapeGeometry(shape, 36);
  }

  _sectorOutline(half) {
    const pts = [new THREE.Vector2(0, 0)];
    const steps = 36;
    for (let i = 0; i <= steps; i++) {
      const a = -half + (half * 2 * i / steps);
      pts.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
    }
    pts.push(new THREE.Vector2(0, 0));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  /**
   * @param pred      result of CombatSystem.predictThrow (points in this.points)
   * @param charge    0..1 raw charge (0 while only holding)
   * @param color     thrower colour
   * @param target    locked rival (or null)
   * @param blast     explosion radius for explosives (0 otherwise)
   */
  update(dt, pred, { charge = 0, color = 0xffffff, target = null, blast = 0 }) {
    const charging = charge > 0;
    this.alpha += ((charging ? 1 : 0.5) - this.alpha) * Math.min(1, dt * 12);
    this.phase = (this.phase + dt * FLOW) % 1;
    this.pulse += dt;

    if (target !== this.lastTarget) {
      if (target) { this.lockT = 0; this.onLock?.(target); }
      this.lastTarget = target;
    }
    this.lockT += dt;

    // Dot colour: white → thrower colour as the charge builds; red when locked
    _c.copy(WHITE).lerp(_c2.set(color), 0.25 + charge * 0.75);
    if (target) _c.copy(LOCK_COLOR);
    this.dotMat.opacity = this.alpha;
    this.inkMat.opacity = this.alpha * 0.9;

    const pts = this.points;
    const total = (pred.n - 1) * (1 / 45);
    let n = 0;
    for (let tau = 0.06 + this.phase * SPACING; tau < total && n < MAX_DOTS; tau += SPACING) {
      const k = tau * 45;
      const i = Math.min(pred.n - 2, Math.floor(k));
      _p.lerpVectors(pts[i], pts[i + 1], k - i);
      if (_p.y < this.waterLevel) break;
      // Grow in from the hand, shrink toward the end so the arc reads as depth
      const u = tau / Math.max(total, 0.001);
      const r = 0.075 * (1 + charge * 0.35) * Math.min(1, (tau - 0.06) / 0.1 + 0.3) * (1.1 - u * 0.35);
      _m.compose(_p, _q, _s.setScalar(r));
      this.dots.setMatrixAt(n, _m);
      this.dots.setColorAt(n, _c);
      _m.compose(_p, _q, _s.setScalar(r * 1.45));
      this.ink.setMatrixAt(n, _m);
      n++;
    }
    this.dots.count = n;
    this.ink.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.ink.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    // Reticle: at the landing point, or on the locked rival's feet
    const land = pred.land ? pred.end : null;
    const lockPos = target ? target.getPosition() : null;
    if (!land && !lockPos) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    if (lockPos) {
      const gy = target.groundY > -50 ? target.groundY : lockPos.y - 0.5;
      this.reticle.position.set(lockPos.x, gy + 0.03, lockPos.z);
    } else {
      this.reticle.position.set(land.x, land.y + 0.03, land.z);
    }
    const beat = 1 + Math.sin(this.pulse * (target ? 14 : 6)) * (target ? 0.08 : 0.05);
    const size = (target ? 1.25 : 1) * (1 + charge * 0.25) * beat;
    this.ring.scale.setScalar(size);
    this.ringInk.scale.setScalar(size);
    this.dot.scale.setScalar(size);
    this.ring.material.color.copy(target ? LOCK_COLOR : _c2.set(color));
    this.dot.material.color.copy(target ? LOCK_COLOR : WHITE);
    for (const m of [this.ring.material, this.ringInk.material, this.dot.material]) m.opacity = this.alpha;

    // Lock brackets: slam in from wide, then spin slowly
    this.brackets.visible = !!target;
    if (target) {
      const k = Math.min(1, this.lockT / 0.14);
      this.brackets.scale.setScalar(size * (1.9 - 0.9 * (1 - (1 - k) ** 3)));
      this.brackets.rotation.y = this.pulse * 1.6;
    }
    this.blast.visible = blast > 0;
    if (blast > 0) {
      this.blast.scale.setScalar(blast);
      this.blast.material.opacity = this.alpha * (0.35 + 0.2 * Math.sin(this.pulse * 8));
    }
  }
}
