// CameraController.js — Third-person camera with smooth follow, shake, and mouse orbit

import * as THREE from 'three';
import { loadSettings, onSettingsChange } from '../app/settings.js';

const BASE_SENSITIVITY = 0.003;

export class CameraController {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;

    // Orbit state
    this.yaw = 0;           // horizontal rotation (radians)
    this.pitch = -0.42;      // vertical rotation (radians)
    this.distance = 9;       // camera distance from target
    this.targetDistance = 9;

    // Camera Modes: 'explorer' (3rd person), 'observer' (follow citizen), 'god' (tactical builder view)
    this.mode = 'explorer';
    this.trackedEntity = null;
    this.targetPitch = -0.42;
    this.targetDistance = 9;

    // Zoom & FOV
    this.baseFov = 60;
    this.targetFov = 60;
    this.currentFov = 60;

    // Smooth follow
    this.target = new THREE.Vector3(0, 1.5, 0);
    this.currentTarget = new THREE.Vector3(0, 1.5, 0);
    this.currentPos = new THREE.Vector3();
    this.lookAhead = new THREE.Vector3();   // world offset the caller wants to see more of (e.g. aiming a throw)
    this._ahead = new THREE.Vector3();

    // Limits
    this.minPitch = -1.25;
    this.maxPitch = 0.1;
    this.minDistance = 5;
    this.maxDistance = 22;
    this.minCameraY = -3.5;  // never dip under the lagoon
    this.baseSensitivity = BASE_SENSITIVITY;
    this.sensitivity = BASE_SENSITIVITY;
    this.invertY = false;
    this.zoomSpeed = 1.5;

    // High-action framing (spectator safety): the colosseum spectator follows
    // the midpoint between two fighters, so an explosive smash can send the
    // follow target rocketing toward the blast lines. Chasing it all the way
    // up loses the launched fighter out of the top of the frame and whips the
    // camera through empty sky. Above highActionCeiling the follow height is
    // softly compressed and the camera pulls back, keeping the action framed.
    // Ground-level play (target.y well under the ceiling) is bit-identical.
    this.highActionCeiling = 14;
    this.highActionPullback = 8;   // max extra camera distance while engaged
    this.highActionAmount = 0;     // smoothed 0..1 engagement

    // Kill-cam lite: lean the view toward a KO for a beat, then snap back
    this.multiFraming = false;          // local multiplayer framing would own the camera: skip kill-cams
    this.kc = new THREE.Vector3();
    this.kcT = 0;
    this.kcDur = 0;
    this._idealPos = new THREE.Vector3();
    this._shakeOffset = new THREE.Vector3();

    // Shake
    this.shakeIntensity = 0;
    this.shakeDecay = 8;
    this.shakeScale = 1;              // player setting: off / subtle / full

    // Pointer lock
    this.isLocked = false;
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);

    canvas.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    // Live settings sync
    this._settingsOff = onSettingsChange(s => this._applySettings(s));
    this._applySettings(loadSettings());
  }

  _applySettings(s) {
    if (typeof s.sensitivity === 'number') {
      this.baseSensitivity = BASE_SENSITIVITY * Math.max(0.1, Math.min(3, s.sensitivity));
      this.sensitivity = this.baseSensitivity;
    }
    if (typeof s.invertY === 'boolean') {
      this.invertY = s.invertY;
    }
  }

  lock() {
    this.canvas.requestPointerLock();
  }

  unlock() {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  _onPointerLockChange() {
    if (document.pointerLockElement === this.canvas) {
      this.isLocked = true;
      document.addEventListener('mousemove', this._onMouseMove);
    } else {
      this.isLocked = false;
      document.removeEventListener('mousemove', this._onMouseMove);
    }
  }

  _onMouseMove(e) {
    if (!this.isLocked) return;
    this.yaw -= e.movementX * this.sensitivity;
    const pitchDelta = e.movementY * this.sensitivity;
    this.pitch -= this.invertY ? -pitchDelta : pitchDelta;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
  }

  _onWheel(e) {
    this.targetDistance += e.deltaY * 0.01 * this.zoomSpeed;
    this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.targetDistance));
  }

  /** Switch between 'explorer', 'observer', and 'god' / 'builder' camera views */
  setMode(mode, trackedEntity = null) {
    this.mode = mode;
    this.trackedEntity = trackedEntity;

    if (mode === 'god') {
      this.targetPitch = -1.05;
      this.targetDistance = 28;
      this.minDistance = 12;
      this.maxDistance = 55;
      this.minPitch = -1.45;
      this.maxPitch = -0.55;
    } else if (mode === 'observer') {
      this.targetPitch = -0.38;
      this.targetDistance = 7.5;
      this.minDistance = 4;
      this.maxDistance = 18;
      this.minPitch = -1.1;
      this.maxPitch = 0.05;
    } else if (mode === 'first_person') {
      this.targetPitch = 0.0;
      this.targetDistance = 0.05;
      this.minDistance = 0.0;
      this.maxDistance = 0.1;
      this.minPitch = -1.45;
      this.maxPitch = 1.45;
    } else {
      // explorer (default)
      this.targetPitch = -0.42;
      this.targetDistance = 9;
      this.minDistance = 5;
      this.maxDistance = 22;
      this.minPitch = -1.25;
      this.maxPitch = 0.1;
    }
  }

  panGodView(dx, dz, dt = 1) {
    if (this.mode !== 'god') return;
    const forward = this.getForward();
    const right = this.getRight();
    const speed = this.distance * 1.2 * dt;
    this.target.addScaledVector(forward, -dz * speed);
    this.target.addScaledVector(right, dx * speed);
  }

  /** Set the position to follow */
  setTarget(x, y, z) {
    this.target.set(x, Math.max(y, -2) + 1.2, z);
  }

  /** Put the camera straight on a point (no smoothing), e.g. at match start */
  snapTo(x, y, z) {
    this.setTarget(x, y, z);
    this.currentTarget.copy(this.target);
    this.currentPos.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance,
      this.target.y - Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance
    );
  }

  /** Add camera shake (scaled by the player's motion-comfort setting). */
  shake(intensity) {
    if (this.shakeScale <= 0) return;
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity * this.shakeScale);
  }

  setShakeScale(scale) {
    this.shakeScale = Math.max(0, scale);
    if (this.shakeScale === 0) this.shakeIntensity = 0;
  }

  /** Ease toward a KO point (victim → blast direction) for `dur` seconds. */
  killCam(pos, dur = 0.75) {
    if (this.multiFraming) return;
    this.kc.set(pos.x, Math.max(pos.y, this.minCameraY + 1), pos.z);
    this.kcT = dur;
    this.kcDur = dur;
  }

  /** Dynamic FOV impulse on high velocity dives or throws */
  kickFov(amount = 12) {
    this.targetFov = Math.min(85, this.baseFov + amount);
  }

  /** Punch zoom on dramatic impacts */
  punchZoom(amount = 1.2) {
    this.distance = Math.max(this.minDistance, this.distance - amount);
  }

  /** Get the forward direction (on XZ plane) based on camera yaw */
  getForward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  /** Get the right direction based on camera yaw */
  getRight() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }

  /** Get camera look direction (3D, including pitch) */
  getLookDirection() {
    const dir = new THREE.Vector3();
    dir.x = -Math.sin(this.yaw) * Math.cos(this.pitch);
    dir.y = Math.sin(this.pitch);
    dir.z = -Math.cos(this.yaw) * Math.cos(this.pitch);
    return dir.normalize();
  }

  update(dt) {
    // Smooth distance
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 6);

    // Smooth mode pitch when not manually orbiting
    if (!this.isLocked && this.targetPitch !== undefined) {
      this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 4);
    }

    // Dynamic FOV recover
    this.targetFov += (this.baseFov - this.targetFov) * Math.min(1, dt * 8);
    this.currentFov += (this.targetFov - this.currentFov) * Math.min(1, dt * 12);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    // Smooth target follow: tight across the floor, softer vertically so jumps don't bob the view
    this._ahead.lerp(this.lookAhead, 1 - Math.exp(-5 * dt));
    const kx = 1 - Math.exp(-14 * dt), ky = 1 - Math.exp(-7 * dt);
    this.currentTarget.x += (this.target.x + this._ahead.x - this.currentTarget.x) * kx;
    this.currentTarget.z += (this.target.z + this._ahead.z - this.currentTarget.z) * kx;
    // High-action framing: compress extreme target heights (explosive smash
    // launches) instead of chasing fighters into the sky. Skipped for
    // first_person — that camera must stay glued to the player's head.
    let followY = this.target.y + this._ahead.y;
    if (this.mode !== 'first_person') {
      const over = Math.max(0, this.target.y - this.highActionCeiling);
      const engageTarget = over > 0.05 ? 1 : 0;
      this.highActionAmount += (engageTarget - this.highActionAmount) * Math.min(1, dt * 3);
      const ha = this.highActionAmount;
      if (ha > 0.001) {
        // Follow the ceiling plus a quarter of the excess — the camera holds a
        // sane altitude while still rising with the action. Smoothed by ha so
        // engaging/disengaging never pops.
        followY = this.target.y - over * ha * 0.75 + this._ahead.y;
      }
    } else {
      this.highActionAmount = 0;
    }
    this.currentTarget.y += (followY - this.currentTarget.y) * ky;

    // Kill-cam: ease in fast, hold, then drop the weight to 0 so the follow snaps back
    if (this.kcT > 0) {
      this.kcT -= dt;
      const u = 1 - this.kcT / this.kcDur;
      const w = this.kcT > 0 ? 0.55 * Math.min(1, u / 0.25) : 0;
      this.currentTarget.lerp(this.kc, w * Math.min(1, dt * 10));
    }

    if (this.mode === 'first_person') {
      this.camera.position.copy(this.currentTarget);
      const look = this.currentTarget.clone().add(this.getLookDirection());
      this.camera.lookAt(look);
      return;
    }

    // Calculate camera position from spherical coordinates.
    // While high-action framing is engaged, pull back proportionally to the
    // target's excess height so the launched fighter stays in frame instead
    // of clipping out the top of the view.
    const haPull = this.highActionAmount * Math.min(this.highActionPullback,
      Math.max(0, this.target.y - this.highActionCeiling) * 0.5);
    const effDistance = this.distance + haPull;
    const idealPos = this._idealPos;
    idealPos.x = this.currentTarget.x + Math.sin(this.yaw) * Math.cos(this.pitch) * effDistance;
    idealPos.y = this.currentTarget.y - Math.sin(this.pitch) * effDistance;
    idealPos.z = this.currentTarget.z + Math.cos(this.yaw) * Math.cos(this.pitch) * effDistance;

    idealPos.y = Math.max(idealPos.y, this.minCameraY);

    // Smooth camera position
    this.currentPos.lerp(idealPos, 1 - Math.exp(-20 * dt));

    // Apply shake
    const shakeOffset = this._shakeOffset.set(0, 0, 0);
    if (this.shakeIntensity > 0.01) {
      shakeOffset.set(
        (Math.random() - 0.5) * this.shakeIntensity,
        (Math.random() - 0.5) * this.shakeIntensity,
        (Math.random() - 0.5) * this.shakeIntensity
      );
      this.shakeIntensity *= Math.exp(-this.shakeDecay * dt);
    } else {
      this.shakeIntensity = 0;
    }

    this.camera.position.copy(this.currentPos).add(shakeOffset);
    this.camera.lookAt(this.currentTarget);
  }

  destroy() {
    if (this._settingsOff) this._settingsOff();
    this.canvas.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    if (this.isLocked) {
      document.removeEventListener('mousemove', this._onMouseMove);
    }
  }
}