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
//
// Gamepad (standard mapping; Xbox names, PS equivalents work the same):
//   L-stick move · R-stick camera (pitch = throw arc) · A jump · X / RT punch (hold = SMASH)
//   B grab / throw (hold = charge) · RB dive / air-dodge · LB parry · Y super · LT drop
//   L3 fast-fall · D-pad emotes 1–4 · Start pause. A pad works without pointer lock.

import * as THREE from 'three';
import { DEFAULT_LOFT } from '../combat/CombatSystem.js';
import { findGamepad, stickVector, lookVector, BUTTONS } from '../app/gamepad.js';
import { loadSettings, onSettingsChange, DEFAULT_BINDINGS } from '../app/settings.js';

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

    // Key bindings (action → array of KeyboardEvent.code)
    this.bindings = { ...DEFAULT_BINDINGS };

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

    // Live settings sync
    this._settingsOff = onSettingsChange(s => this._applySettings(s));
    this._applySettings(loadSettings());
  }

  _applySettings(s) {
    if (s.bindings) this.bindings = { ...DEFAULT_BINDINGS, ...s.bindings };
  }

  /** Check if a key code matches any binding for the given action. */
  _isBound(action, code) {
    return this.bindings[action]?.includes(code) ?? false;
  }

  /** Check if any key for an action is currently held. */
  _isHeld(action) {
    return this.bindings[action]?.some(code => this.keys[code]) ?? false;
  }

  get live() {
    return this.enabled && (this.camera.isLocked || this.padActive) && this.dweeb.active;
  }

  /**
   * Poll the first connected gamepad and drive the exact same actions as keyboard/mouse.
   * Edge-detected so holds (charge smash, charge throw) behave like the mouse buttons.
   */
  /** While paused only Start is read (so the pad can unpause); nothing else moves. */
  pollPadWhilePaused() {
    const pad = typeof navigator !== 'undefined' ? findGamepad(navigator) : null;
    const prev = this._padPrev || (this._padPrev = []);
    const on = !!pad?.buttons?.[BUTTONS.START]?.pressed;
    if (on && !prev[BUTTONS.START]) this.onPausePressed?.();
    prev[BUTTONS.START] = on;
  }

  _pollPad(dt) {
    const pad = typeof navigator !== 'undefined' ? findGamepad(navigator) : null;
    const prev = this._padPrev || (this._padPrev = []);
    if (!pad) { this.padMove = null; this.padActive = false; prev.length = 0; return; }
    const b = pad.buttons || [];
    const down = i => !!(b[i]?.pressed || (b[i]?.value ?? 0) > 0.5);
    const pressed = i => down(i) && !prev[i];
    const released = i => !down(i) && prev[i];
    const mv = stickVector(pad), lk = lookVector(pad);
    const any = Math.hypot(mv.x, mv.y) > 0 || Math.hypot(lk.x, lk.y) > 0 || b.some(x => x?.pressed);
    if (any) this.padActive = true;
    if (!this.padActive) return;

    // Start toggles pause regardless of live state
    if (pressed(BUTTONS.START)) this.onPausePressed?.();

    if (this.enabled && this.dweeb.active) {
      // Camera: right stick, a touch of acceleration curve for fine aim
      const cam = this.camera, rate = 2.8 * (this.padSensitivity ?? 1);
      cam.yaw -= Math.sign(lk.x) * lk.x * lk.x * rate * dt;
      cam.pitch -= Math.sign(lk.y) * lk.y * lk.y * rate * 0.7 * dt;
      cam.pitch = Math.max(cam.minPitch, Math.min(cam.maxPitch, cam.pitch));

      // Movement: camera-relative left stick (analog magnitude kept)
      const f = cam.getForward(), r = cam.getRight();
      const x = r.x * mv.x - f.x * mv.y, z = r.z * mv.x - f.z * mv.y;
      const m = Math.min(1, Math.hypot(mv.x, mv.y)), l = Math.hypot(x, z);
      this.padMove = l > 1e-4 ? { x: x / l * m, z: z / l * m } : null;
      this.padJump = down(BUTTONS.A);
      this.padFastFall = down(BUTTONS.L3) || mv.y > 0.85;
    }

    if (this.live) {
      const d = this.dweeb;
      if (pressed(BUTTONS.A)) {
        if (d.grounded && mv.y > 0.6) d.requestDropThrough(); else d.requestJump();
      }
      // Punch / smash on X or RT
      const atk = BUTTONS.X, rt = BUTTONS.RT;
      if (pressed(atk) || pressed(rt)) this._onMouseDown({ button: 0, preventDefault() {} });
      if ((released(atk) && !down(rt)) || (released(rt) && !down(atk))) this._onMouseUp({ button: 0 });
      if (pressed(BUTTONS.B)) this._startGrabOrThrow();
      if (released(BUTTONS.B)) this._releaseThrow();
      if (pressed(BUTTONS.RB)) {
        const md = this._moveDir();
        if (d.grounded) this._faceCamera(true);
        this.combat.dodgeOrDive(d, md.x, md.y, down(BUTTONS.A));
      }
      if (pressed(BUTTONS.LB)) this.combat.startParry(d);
      if (pressed(BUTTONS.Y)) this.combat.armSuper(d);
      if (pressed(BUTTONS.LT)) this.combat.drop(d);
      // D-pad → emote keys (game/Emotes.js listens for Digit1–4 when present)
      const em = [[BUTTONS.DPAD_UP, 'Digit1'], [BUTTONS.DPAD_RIGHT, 'Digit2'], [BUTTONS.DPAD_DOWN, 'Digit3'], [BUTTONS.DPAD_LEFT, 'Digit4']];
      for (const [i, code] of em) if (pressed(i)) window.dispatchEvent(new window.KeyboardEvent("keydown", { code }));
    }
    for (let i = 0; i < b.length; i++) prev[i] = down(i);
  }

  _onKeyDown(e) {
    this.keys[e.code] = true;
    if (e.isTrusted) this.padActive = false;
    if (!this.live || e.repeat) return;
    const d = this.dweeb;
    if (this._isBound('jump', e.code)) {
      // Down + jump on a floating platform slips you through it instead of hopping.
      if (d.grounded && this._isHeld('back')) d.requestDropThrough();
      else d.requestJump();
      e.preventDefault();
    } else if (this._isBound('grab', e.code)) {
      this._startGrabOrThrow();
    } else if (this._isBound('drop', e.code)) {
      this.combat.drop(d);
    } else if (this._isBound('dodge', e.code)) {
      const m = this._moveDir();
      if (d.grounded) this._faceCamera(true);
      this.combat.dodgeOrDive(d, m.x, m.y, this._isHeld('jump'));
    } else if (this._isBound('style', e.code)) {
      this.combat.armSuper(d);
    } else if (this._isBound('parry', e.code)) {
      this.combat.startParry(d);
    }
  }

  _onKeyUp(e) {
    this.keys[e.code] = false;
    if (this._isBound('grab', e.code)) this._releaseThrow();
  }

  _onMouseDown(e) {
    if (!this.live) return;
    if (e.button === 0) {
      const d = this.dweeb;
      // In the air with empty hands, LMB is an aerial: S+LMB slams straight down,
      // otherwise you commit to a drop-kick.
      if (!d.grounded && !d.held) {
        const down = this._isHeld('back');
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
    if (this._isHeld('forward')) { x += forward.x; z += forward.z; }
    if (this._isHeld('back')) { x -= forward.x; z -= forward.z; }
    if (this._isHeld('left')) { x -= right.x; z -= right.z; }
    if (this._isHeld('right')) { x += right.x; z += right.z; }
    const len = Math.hypot(x, z);
    if (len === 0 && this.padMove) return _dir.set(this.padMove.x, this.padMove.z);
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
    this._pollPad(dt);
    if (!this.live) {
      if (d.isCharging) { d.isCharging = false; d.charging = 0; }
      this.throwCharging = false;
      d.fastFallInput = false;
      return;
    }

    d.jumpHeld = !!this.keys.Space || !!this.padJump;
    d.fastFallInput = !!(this.keys.KeyS || this.keys.ArrowDown) || !!this.padFastFall;
    d.jumpHeld = this._isHeld('jump');
    d.fastFallInput = this._isHeld('back');
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
    if (this._settingsOff) this._settingsOff();
  }
}