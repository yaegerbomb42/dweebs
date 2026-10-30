// InteractiveObject.js — Runtime representation of a physics object in the world
// Bridges the gap between the data-driven ObjectRegistry and the live physics/render state

import * as THREE from 'three';
import { getObjectDef } from './ObjectRegistry.js';
import { getMaterial } from '../physics/Materials.js';
import { createModel, TV_FACES } from './ObjectModels.js';

// How much each material squashes on impact (rubber jiggles, stone barely flinches)
const SOFTNESS = {
  rubber: 0.9, fabric: 0.8, fruit: 0.6, cardboard: 0.55, plastic: 0.45, toy: 0.5,
  wood: 0.25, ceramic: 0.15, glass: 0.12, metal: 0.15, stone: 0.08,
};
const _qi = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _g = new THREE.Vector3();
const _acc = new THREE.Vector3();

export class InteractiveObject {
  constructor(key, physicsWorld, scene, position, id = null) {
    this.key = key;
    this.def = getObjectDef(key);
    if (!this.def) throw new Error(`Unknown object: ${key}`);

    this.mat = getMaterial(this.def.material);
    this.id = id;
    this.isGrabbed = false;
    this.grabber = null;
    this.broken = false;
    this.hp = this.def.breakForce || 99999;
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.thrownBy = null;      // Dweeb who threw it (for hit credit)
    this.thrownTime = 0;       // seconds remaining where it counts as a projectile
    this.hitList = new Set();  // Dweebs already hit by this throw
    this.isWeapon = !!this.def.weapon;
    this.lastVel = new THREE.Vector3();
    this.sq = 0; this.sqV = 0; this.squashAxis = 1;
    this.popS = 0; this.popV = 0;
    this.face = 'happy'; this.faceTimer = 0;
    this.trail = null;

    // Create visual mesh
    this.mesh = this._createMesh();
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.userData.interactiveObject = this;
    scene.add(this.mesh);

    // Create physics body
    const result = physicsWorld.createDynamicBody(
      position.x, position.y, position.z,
      this.def.shape, this.def.dims,
      {
        material: this.def.material,
        mass: this.def.mass,
        id: this.id,
        ref: this,
      }
    );
    this.physicsId = result.id;
    this.body = result.body;
    this.collider = result.collider;

    // Store reference back
    if (this.id === null) this.id = this.physicsId;
  }

  _createMesh() {
    const root = new THREE.Group();
    root.name = this.def.name;
    // visual: squash/stretch + pop layer between the physics transform and the model
    this.visual = new THREE.Group();
    root.add(this.visual);
    const model = createModel(this.key, this.def);
    this.visual.add(model);

    this.eyes = [];
    this.flickers = [];
    this.screen = null;
    model.traverse(o => {
      const pu = o.userData.pupil;
      if (pu) {
        this.eyes.push({
          mesh: o, r: pu.r, max: pu.r * 0.42,
          c: new THREE.Vector3(...pu.c), n: new THREE.Vector3(...pu.n),
          u: new THREE.Vector3(...pu.u), v: new THREE.Vector3(...pu.v),
          px: 0, py: -pu.r * 0.3, vx: 0, vy: 0,
        });
      }
      if (o.userData.flicker) this.flickers.push(o);
      if (o.userData.flame) this.flame = o;
      if (o.userData.screen) {
        o.material = o.material.clone(); // per-instance face
        this.screen = o;
      }
    });
    return root;
  }

  // ─── Feel ───

  /** Physics contact: squash along the direction of travel, rattle the eyes, react. */
  onImpact(speed) {
    if (!this.visual) return;
    const soft = SOFTNESS[this.def.material] ?? 0.3;
    _qi.copy(this.mesh.quaternion).invert();
    _d.copy(this.lastVel).applyQuaternion(_qi);
    const ax = Math.abs(_d.x), ay = Math.abs(_d.y), az = Math.abs(_d.z);
    if (speed > 3) this.squashAxis = ax > ay && ax > az ? 0 : ay > az ? 1 : 2;
    this.sqV += Math.min(speed, 30) * soft * 0.35;
    for (const e of this.eyes) {
      e.vx += (Math.random() - 0.5) * speed * 0.03;
      e.vy += (Math.random() - 0.5) * speed * 0.03;
    }
    if (this.screen && speed > 6) this._setFace('hurt', 1.1);
  }

  /** Uniform scale overshoot (grab, throw). */
  pop(amount = 0.2) {
    this.popV += amount * 18;
  }

  _setFace(mood, time) {
    if (this.face !== mood) {
      this.face = mood;
      const t = TV_FACES[mood]();
      this.screen.material.map = t;
      this.screen.material.emissiveMap = t;
    }
    this.faceTimer = time;
  }

  /** Sync visual mesh with physics body; animate squash, eyes, sparks and faces. */
  update(dt = 1 / 60) {
    if (this.broken || !this.body) return;
    const pos = this.physicsWorld.getPosition(this.body);
    const rot = this.physicsWorld.getRotation(this.body);
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    if (dt <= 0) return;

    const v = this.body.linvel();
    _acc.set(v.x - this.lastVel.x, v.y - this.lastVel.y, v.z - this.lastVel.z).divideScalar(dt);
    if (this.isGrabbed) _acc.set(0, 0, 0); // kinematic teleports would read as huge accelerations
    this.lastVel.set(v.x, v.y, v.z);

    // Jelly squash (axis) + pop (uniform): damped springs
    this.sqV += (-320 * this.sq - 11 * this.sqV) * dt;
    this.sq = THREE.MathUtils.clamp(this.sq + this.sqV * dt, -0.3, 0.42);
    this.popV += (-260 * this.popS - 12 * this.popV) * dt;
    this.popS += this.popV * dt;
    if (Math.abs(this.sq) + Math.abs(this.sqV) + Math.abs(this.popS) + Math.abs(this.popV) > 1e-4) {
      const a = 1 - this.sq, o = 1 / Math.sqrt(a), p = 1 + this.popS;
      this.visual.scale.set(
        (this.squashAxis === 0 ? a : o) * p,
        (this.squashAxis === 1 ? a : o) * p,
        (this.squashAxis === 2 ? a : o) * p,
      );
    } else {
      this.sq = this.sqV = this.popS = this.popV = 0;
      this.visual.scale.set(1, 1, 1);
    }

    // Googly eyes: pupils are free masses feeling gravity minus the body's acceleration
    if (this.eyes.length) {
      _qi.copy(this.mesh.quaternion).invert();
      _g.set(0, -9.8, 0).addScaledVector(_acc.clampLength(0, 120), -0.6).applyQuaternion(_qi);
      const nervous = this.def.explosive && (this.isGrabbed || this.thrownBy) ? 0.25 : 0;
      const damp = Math.exp(-5 * dt);
      for (const e of this.eyes) {
        e.vx = (e.vx + _g.dot(e.u) * dt * 0.35) * damp + (nervous ? (Math.random() - 0.5) * nervous * dt * 10 : 0);
        e.vy = (e.vy + _g.dot(e.v) * dt * 0.35) * damp + (nervous ? (Math.random() - 0.5) * nervous * dt * 10 : 0);
        e.px += e.vx * dt * 10;
        e.py += e.vy * dt * 10;
        const len = Math.hypot(e.px, e.py);
        if (len > e.max) {
          const nx = e.px / len, ny = e.py / len;
          e.px = nx * e.max; e.py = ny * e.max;
          const vn = e.vx * nx + e.vy * ny;
          if (vn > 0) { e.vx -= vn * nx * 1.5; e.vy -= vn * ny * 1.5; } // bounce off the rim
        }
        e.mesh.position.copy(e.c).addScaledVector(e.n, e.r * 0.52).addScaledVector(e.u, e.px).addScaledVector(e.v, e.py);
      }
    }

    for (const f of this.flickers) f.scale.setScalar((this.thrownBy || this.isGrabbed ? 1.5 : 0.8) + Math.random() * 0.6);
    if (this.flame) {
      this.flame.visible = this.rocket?.fuel > 0;
      if (this.flame.visible) this.flame.scale.set(1, 0.7 + Math.random() * 0.7, 1);
    }

    if (this.screen) {
      if (this.faceTimer > 0) {
        this.faceTimer -= dt;
        if (this.faceTimer <= 0) {
          if (this.face === 'hurt') this._setFace('dizzy', 0.9);
          else this._setFace('happy', 0);
        }
      } else if (this.isGrabbed && this.face !== 'dizzy') this._setFace('dizzy', 0.5);
    }
  }

  /** Get world position */
  getPosition() {
    if (!this.body) return { x: 0, y: 0, z: 0 };
    return this.physicsWorld.getPosition(this.body);
  }

  /** Apply damage and potentially break */
  applyDamage(force) {
    if (this.broken || !this.def.breakable) return false;
    this.hp -= force;
    // Visible wear: a hit that doesn't break it still makes it flinch, harder the closer it is to going.
    const max = this.def.breakForce || 99999;
    this.wear = Math.min(1, 1 - Math.max(0, this.hp) / max);
    this.popV += 2 + this.wear * 6;
    if (this.hp <= 0) {
      this.broken = true;
      return true;
    }
    return false;
  }

  /** Mark as grabbed */
  grab(grabberId) {
    this.isGrabbed = true;
    this.grabber = grabberId;
    this.pop(0.28);
  }

  /** Release from grab */
  release() {
    this.isGrabbed = false;
    this.grabber = null;
    this.pop(0.18);
  }

  /** Clean up */
  destroy() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      // Geometry and materials are shared model templates; only the TV face material is per-instance
      this.screen?.material.dispose();
    }
    if (this.physicsId && this.physicsWorld) {
      this.physicsWorld.removeBody(this.physicsId);
    }
    this.body = null;
    this.mesh = null;
  }
}
