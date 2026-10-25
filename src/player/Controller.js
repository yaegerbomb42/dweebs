// Controller.js — Player input → Dweeb actions (camera-relative movement + shared combat actions)
//
//   WASD      move            Space   jump / double jump
//   LMB       punch (hold to charge a SMASH; swings a held hammer; throws a held item)
//   RMB / E   grab a Dweeb or item · throw it (hold to charge)
//   Shift     dive tackle on the ground · air-dodge in the air · tech a hard landing while tumbling
//   C         timed PARRY: a hit inside the window is reflected at the attacker
//   Air LMB   drop-kick · air S + LMB ground slam
//   F / MMB   cash in a full style meter: next charged smash/throw is a SUPER YEET
//   Q         drop held item
//   Mouse look up/down sets the throw arc (the aim guide shows exactly where it lands)

import * as THREE from 'three';
import { DEFAULT_LOFT } from '../combat/CombatSystem.js';

const _dir = new THREE.Vector2();

export class Controller {
  constructor(dweeb, cameraController, combat) {
    this.dweeb = dweeb;
    this.camera = cameraController;
    this.combat = combat;
    this.enabled = false;

    this.keys = {};
    this.throwCharging = false;
    this.throwCharge = 0;
    this.attackBuffer = 0;      // press that came in during cooldown/hitstun; fires as soon as possible
    this.attackHeld = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onContext = e => e.preventDefault();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContext);
  }

  get live() {
    return this.enabled && this.camera.isLocked && this.dweeb.active;
  }

  _onKeyDown(e) {
    this.keys[e.code] = true;
    if (!this.live || e.repeat) return;
    const d = this.dweeb;
    switch (e.code) {
      case 'Space':
        // Down + jump on a floating platform slips you through it instead of hopping.
        if (d.grounded && (this.keys.KeyS || this.keys.ArrowDown)) d.requestDropThrough();
        else d.requestJump();
        e.preventDefault();
        break;
      case 'KeyE':
        this._startGrabOrThrow();
        break;
      case 'KeyQ':
        this.combat.drop(d);
        break;
      case 'ShiftLeft':
      case 'ShiftRight': {
        const m = this._moveDir();
        if (d.grounded) this._faceCamera(true);
        this.combat.dodgeOrDive(d, m.x, m.y, !!this.keys.Space);
        break;
      }
      case 'KeyF':
        this.combat.armSuper(d);
        break;
      case 'KeyC':
        this.combat.startParry(d);
        break;
    }
  }

  _onKeyUp(e) {
    this.keys[e.code] = false;
    if (e.code === 'KeyE') this._releaseThrow();
  }

  _onMouseDown(e) {
    if (!this.live) return;
    if (e.button === 0) {
      const d = this.dweeb;
      // In the air with empty hands, LMB is an aerial: S+LMB slams straight down,
      // otherwise you commit to a drop-kick.
      if (!d.grounded && !d.held) {
        const down = this.keys.KeyS || this.keys.ArrowDown;
        this._faceCamera();
        if (down) this.combat.groundSlam(d);
        else this.combat.airKick(d);
        return;
      }
      this.attackHeld = true;
      if (!this.combat.startCharge(this.dweeb)) this.attackBuffer = 0.2;
    } else if (e.button === 2) {
      this._startGrabOrThrow();
    } else if (e.button === 1) {
      e.preventDefault();
      this.combat.armSuper(this.dweeb);
    }
  }

  _onMouseUp(e) {
    if (e.button === 0) {
      this.attackHeld = false;
      if (this.dweeb.isCharging) {
        this._faceCamera();
        this.combat.releaseAttack(this.dweeb);
      }
    } else if (e.button === 2) {
      this._releaseThrow();
    }
  }

  _startGrabOrThrow() {
    const d = this.dweeb;
    if (d.held) {
      // Holding something: charge a throw until the button is released
      this.throwCharging = true;
      this.throwCharge = 0;
    } else {
      // Pickups follow the camera; no more grabbing whatever happens to be closest behind you.
      this._faceCamera();
      this.combat.grab(d);
    }
  }

  _releaseThrow() {
    if (!this.throwCharging) return;
    this.throwCharging = false;
    if (!this.dweeb.held) return;
    this._faceCamera();
    this.combat.throwHeld(this.dweeb, this.throwCharge >= 0.2 ? this.throwCharge : 0);
    this.dweeb.charging = 0;
  }

  /** WASD → camera-relative unit direction on the floor (x, z packed into a Vector2). */
  _moveDir() {
    const forward = this.camera.getForward();
    const right = this.camera.getRight();
    let x = 0, z = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) { x += forward.x; z += forward.z; }
    if (this.keys.KeyS || this.keys.ArrowDown) { x -= forward.x; z -= forward.z; }
    if (this.keys.KeyA || this.keys.ArrowLeft) { x -= right.x; z -= right.z; }
    if (this.keys.KeyD || this.keys.ArrowRight) { x += right.x; z += right.z; }
    const len = Math.hypot(x, z);
    return len > 0 ? _dir.set(x / len, z / len) : _dir.set(0, 0);
  }

  /** Point the Dweeb where the camera looks (only if they're not steering elsewhere). */
  _faceCamera(onlyIfIdle = false) {
    const d = this.dweeb;
    if (onlyIfIdle && d.moveInput.lengthSq() > 0.01) return;
    const f = this.camera.getForward();
    d.yaw = Math.atan2(f.x, f.z);
  }

  update(dt) {
    const d = this.dweeb;
    d.moveInput.set(0, 0);
    if (!this.live) {
      if (d.isCharging) { d.isCharging = false; d.charging = 0; }
      this.throwCharging = false;
      d.fastFallInput = false;
      return;
    }

    d.jumpHeld = !!this.keys.Space;
    d.fastFallInput = !!(this.keys.KeyS || this.keys.ArrowDown);
    d.moveInput.copy(this._moveDir());

    // Buffered attack: a click during cooldown still lands (as a jab if the button's already up)
    if (this.attackBuffer > 0) {
      this.attackBuffer -= dt;
      if (this.combat.startCharge(d)) {
        this.attackBuffer = 0;
        if (!this.attackHeld) {
          this._faceCamera();
          this.combat.releaseAttack(d);
        }
      }
    }

    // Camera pitch → throw elevation: look up to lob far, down to spike.
    // `lookYaw` is the authoritative aim for attacks, grabs and focus rings; the body can still
    // face its movement direction while strafing.
    const look = this.camera.getForward();
    d.lookYaw = Math.atan2(look.x, look.z);
    d.aimLoft = THREE.MathUtils.clamp(DEFAULT_LOFT + (this.camera.pitch + 0.42) * 1.5, -0.35, 0.95);

    // While winding up, aim along the camera
    if (d.isCharging || this.throwCharging) {
      const f = this.camera.getForward();
      d.aimYaw = Math.atan2(f.x, f.z);
    } else {
      d.aimYaw = null;
    }

    if (this.throwCharging) {
      this.throwCharge = Math.min(1, this.throwCharge + dt / 0.75);
      d.charging = this.throwCharge;
      if (!d.held) this.throwCharging = false;
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('contextmenu', this._onContext);
  }
}
