// Dweeb.js — a toy-like brawler: physics capsule body + rigged cartoon mesh.
// Damage is a Smash-style percent: the higher it gets, the further hits launch you.

import * as THREE from 'three';
import { toonMat, noOutline } from '../render/Toon.js';
import { CollisionGroups } from '../physics/PhysicsWorld.js';
import { STAGE_RADIUS } from '../world/Arena.js';
import { BALANCE, statsFor } from '../game/Balance.js';
import { buildDweebModel, animateDweebFace } from './DweebModel.js';
import { makeLocomotionState, updateLean } from './locomotionJuice.js';

const RADIUS = 0.36;
const HALF_HEIGHT = 0.14;
export const DWEEB_HALF = RADIUS + HALF_HEIGHT;

const MV = BALANCE.move;
const KB = BALANCE.knockback;
const DI = BALANCE.di;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _zero3 = { x: 0, y: 0, z: 0 };

export class Dweeb {
  constructor(scene, physicsWorld, options = {}) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;

    this.isPlayer = !!options.isPlayer;
    this.name = options.name || 'Dweeb';
    this.type = options.type || 'cube';
    this.stats = statsFor(this.type);
    this.color = options.color ?? 0xffd23f;
    this.index = options.index || 0;

    // Match state
    this.percent = 0;
    this.stocks = options.stocks ?? 3;
    this.out = false;          // temporarily off-stage (waiting to respawn)
    this.eliminated = false;   // no stocks left
    this.respawnTimer = 0;
    this.kos = 0;
    this.falls = 0;
    this.damageDealt = 0;
    this.lastHitBy = null;
    this.lastHitTime = -99;

    // Combat state
    this.hitstun = 0;
    this.ragdolling = false;
    this.ragdollTimer = 0;
    this.invulnTimer = 0;
    this.attackCooldown = 0;
    this.attackAnim = 0;
    this.attackCharge = 0;
    this.charging = 0;          // 0..1 while winding up
    this.diveTimer = 0;
    this.diveCooldown = 0;
    this.proneTimer = 0;
    this.isCharging = false;
    this.held = null;           // { kind: 'object'|'dweeb', ref }
    this.grabbedBy = null;
    this.escapeTimer = 0;
    this.flashTimer = 0;
    this.diBudget = 0;          // Δv left to steer this launch with (directional influence)
    this.landLag = 0;
    // Recovery tools
    this.airDodgeTimer = 0;
    this.airDodgeCd = 0;
    this.specialFall = false;   // after an air-dodge: drift only until you land or catch a ledge
    // Timed parry / aerial attacks
    this.parryTimer = 0;        // active counter window
    this.parryCd = 0;
    this.freezeTimer = 0;       // frozen solid: no acting, no drifting
    this.magnetTimer = 0;       // gem magnet pull
    this.slamActive = false;    // ground slam waiting to land
    this.dropkickTimer = 0;
    this.dropkickHit = false;
    this.traction = 1;          // arena ground acceleration multiplier
    this.slide = 1;             // arena top-speed multiplier
    this.skidTimer = 0;         // dust/haptic cooldown while carving a hard turn
    this.techBuffer = 0;        // tech pressed just before impact
    this.techGrace = 0;         // …or just after
    this.missedTech = false;
    this.techChance = 0;        // bots: chance to tech a hard landing
    this.ledge = null;          // { x, y, z, t } while clinging to the stage lip
    this.ledgeCd = 0;
    // Arena physics: gravity multiplier comes from the stage (the Moonbase is 0.58),
    // fast-fall is a committed descent, and drop-through lets you leave a floating platform.
    this.gravityScale = 1;
    this.jumpScale = 1;         // low-gravity stages shorten the jump so height stays sane
    this.fastFallInput = false;
    this.fastFalling = false;
    this.fastFallGrace = 0;
    this.dropThroughRequested = 0;
    this.dropGrace = 0;
    this.rollTimer = 0;
    this.rollCd = 0;
    this.rollDirX = 0;
    this.rollDirZ = 0;
    this.shieldCharges = 0;
    this.sugarTimer = 0;

    // Style meter (see CombatSystem.addStyle)
    this.styleScore = 0;
    this.styleTimer = 0;
    this.styleTier = 0;
    this.stylePeak = 0;
    this.superReady = false;
    this.superArmed = false;    // next charged smash / throw gets the Super Yeet
    // Super-smash meter: consecutive landed punches (see CombatSystem._punchStreak)
    this.punchStreak = 0;
    this.punchStreakT = -99;
    this.trickshots = 0;

    // Water flail (one splash-jump out when barely under near the edge) + highlight-reel air time
    this.swimFlail = 0;
    this.splashJumpT = 0;
    this.flailUsed = false;
    this.airTime = 0;
    this.maxAir = 0;

    // Power-ups
    this.megaTimer = 0;
    this.zoomTimer = 0;
    this.bubble = false;

    // Movement
    this.moveInput = new THREE.Vector2();
    this.jumpRequested = false;
    this.jumpBuffer = 0;        // a jump pressed just before landing still happens
    this.jumpRising = false;    // true while rising from our own jump
    this.jumpHeld = undefined;  // player only: letting go while rising cuts the jump short
    this.jumpsLeft = 2;
    this.coyote = 0;
    this.grounded = false;
    this.wasGrounded = false;
    this.yaw = options.yaw || 0;
    this.aimYaw = null;
    this.velocity = new THREE.Vector3();
    this.landSquash = 0;
    this.footstepTimer = 0;
    this.groundY = 0;

    // Animation
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.blinkTimer = 1 + Math.random() * 3;
    this.flashMats = [];

    const spawn = options.position || { x: 0, y: 2, z: 0 };
    const result = physicsWorld.createCharacterBody(spawn.x, spawn.y, spawn.z, RADIUS, HALF_HEIGHT, this, this.stats.mass);
    this.physicsId = result.id;
    this.body = result.body;
    this.collider = result.collider;
    this.defaultGroups = this.collider.collisionGroups();
    this.collider.setMass(this.stats.mass);

    this.mesh = new THREE.Group();
    this.rig = new THREE.Group();
    this.rig.position.y = -DWEEB_HALF;
    this.mesh.add(this.rig);
    this._build();
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);
    this.mesh.userData.dweeb = this;
    scene.add(this.mesh);

    this._buildShadow();
    this._buildBubble();
    this._buildStatusShells();
  }

  // ─── Mesh construction ───

  _build() {
    buildDweebModel(this, darken);

    if (this.isPlayer) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.62, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      noOutline(ring);
      this.rig.add(ring);
      this.playerRing = ring;
    }
  }

  _buildShadow() {
    const tex = blobShadowTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    noOutline(this.shadow);
    this.scene.add(this.shadow);
  }

  _buildBubble() {
    this.bubbleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.bubbleMesh.visible = false;
    noOutline(this.bubbleMesh);
    this.mesh.add(this.bubbleMesh);
  }

  _buildStatusShells() {
    this.freezeMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.72, 1),
      new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.45, depthWrite: false, flatShading: true })
    );
    this.freezeMesh.visible = false;
    noOutline(this.freezeMesh);
    this.mesh.add(this.freezeMesh);

    this.parryMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.055, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    this.parryMesh.rotation.x = Math.PI / 2;
    this.parryMesh.position.y = 0.35;
    this.parryMesh.visible = false;
    noOutline(this.parryMesh);
    this.mesh.add(this.parryMesh);

    // SHIELD gem: a gold shell that eats one hit
    this.shieldMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.74, 2),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.3, depthWrite: false, wireframe: true })
    );
    this.shieldMesh.visible = false;
    noOutline(this.shieldMesh);
    this.mesh.add(this.shieldMesh);
  }

  /** A hard landing with a direction held becomes a roll: momentum kept, recovery spent moving. */
  startRoll(dx, dz) {
    const R = BALANCE.roll;
    const len = Math.hypot(dx, dz) || 1;
    this.rollDirX = dx / len;
    this.rollDirZ = dz / len;
    this.rollVelX = this.rollDirX * R.speed;
    this.rollVelZ = this.rollDirZ * R.speed;
    this.rollTimer = R.time;
    this.rollCd = R.cooldown;
    this.landLag = 0;
    this.landSquash = 0.4;
    this.yaw = Math.atan2(this.rollDirX, this.rollDirZ);
    this.grounded && this.body.setLinvel({ x: this.rollVelX, y: 0, z: this.rollVelZ }, true);
  }

  cancelRoll() {
    this.rollTimer = 0;
  }

  // ─── Queries ───

  getPosition() {
    return this.physicsWorld.getPosition(this.body);
  }

  get active() {
    return !this.out && !this.eliminated;
  }

  get canAct() {
    return this.active && this.hitstun <= 0 && !this.ragdolling && !this.grabbedBy && this.proneTimer <= 0 && this.diveTimer <= 0 &&
      this.landLag <= 0 && this.airDodgeTimer <= 0 && !this.ledge && this.freezeTimer <= 0 && this.rollTimer <= 0;
  }

  /** Gravity scale for this body: the arena's multiplier times a local one. */
  _grav(mult = 1) {
    return this.gravityScale * mult;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get powerScale() {
    return this.megaTimer > 0 ? 1.35 : 1;
  }

  // ─── Actions ───

  /** C: a short counter window. A hit that lands inside it is reflected at the attacker. */
  startParry() {
    if (!this.canAct || this.parryCd > 0 || this.held) return false;
    const P = BALANCE.parry;
    this.parryTimer = P.window;
    this.parryCd = P.cooldown;
    this.charging = 0;
    this.isCharging = false;
    this.flashTimer = 0.06;
    this.onParryStart?.(this);
    return true;
  }

  requestJump() {
    this.jumpRequested = true;
    this.jumpBuffer = 0.14;
    if (this.ragdolling || this.hitstun > 0) this.requestTech();
  }

  /** Down + jump on a floating platform: a short buffered drop-through instead of a jump. */
  requestDropThrough() {
    this.dropThroughRequested = 0.14;
    this.jumpBuffer = 0.14; // no platform underfoot? the buffered jump still fires
  }

  /** Jump/dodge pressed while tumbling: tech the next hard landing (or the one that just happened). */
  requestTech() {
    if (this.techGrace > 0) this._tech();
    else this.techBuffer = BALANCE.tech.buffer;
  }

  _tech() {
    this.techBuffer = 0;
    this.techGrace = 0;
    this.missedTech = false;
    if (this.ragdolling) this.recoverFromRagdoll();
    this.hitstun = 0;
    this.proneTimer = 0;
    this.diBudget = 0;
    this.invulnTimer = Math.max(this.invulnTimer, BALANCE.tech.invuln);
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x * 0.15, y: 0, z: v.z * 0.15 }, true);
    this.onTech?.(this);
  }

  /** Grab the stage lip at (x, y, z). */
  catchLedge(x, y, z) {
    this.ledge = { x, y, z, t: 0 };
    this.specialFall = false;
    this.jumpsLeft = 1;
    this.jumpRequested = false;
    this.jumpBuffer = 0;
    this.charging = 0;
    this.invulnTimer = Math.max(this.invulnTimer, 0.3);
    this.yaw = Math.atan2(-x, -z);
    this.onLedge?.(this);
  }

  releaseLedge(climb) {
    if (!this.ledge) return;
    const { x, z } = this.ledge;
    const r = Math.hypot(x, z) || 1;
    this.ledge = null;
    this.ledgeCd = BALANCE.ledge.regrab;
    this.body.setGravityScale(this._grav(1), true);
    if (climb) {
      const L = BALANCE.ledge;
      this.body.setLinvel({ x: (-x / r) * 4, y: L.jumpVel * this.stats.jump, z: (-z / r) * 4 }, true);
      this.jumpRising = true;
      this.landSquash = -0.35;
      this.onJump?.(this, false);
    }
  }


  // ─── Per-frame: before physics step ───

  preStep(dt) {
    if (!this.active) return;

    const vel = this.body.linvel();
    let vx = vel.x, vy = vel.y, vz = vel.z;

    if (this.grabbedBy) return;

    // Riding a toy zipline: the cable owns position and velocity until release.
    if (this.zipRide) {
      this.body.setGravityScale(0, true);
      if (this.zipRide.pos) this.body.setTranslation(this.zipRide.pos, true);
      if (this.zipRide.vel) this.body.setLinvel(this.zipRide.vel, true);
      this.jumpRequested = false;
      this.jumpBuffer = 0;
      return;
    }

    // Frozen solid: held exactly where you were. Gravity comes back when it thaws.
    if (this.freezeTimer > 0) {
      this.body.setGravityScale(0, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.jumpRequested = false;
      this.jumpBuffer = 0;
      return;
    }

    // Clinging to the lip: pinned, jump to climb, push away (or run out of grip) to drop
    if (this.ledge) {
      const lg = this.ledge;
      lg.t += dt;
      this.body.setGravityScale(0, true);
      this.body.setTranslation({ x: lg.x, y: lg.y, z: lg.z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      const r = Math.hypot(lg.x, lg.z) || 1;
      const away = (this.moveInput.x * lg.x + this.moveInput.y * lg.z) / r;
      if (this.jumpRequested || this.jumpBuffer > 0) this.releaseLedge(true);
      else if (away > 0.6 || lg.t > BALANCE.ledge.maxHang) this.releaseLedge(false);
      this.jumpRequested = false;
      this.jumpBuffer = 0;
      return;
    }

    // Flailing at the waterline: bob in place; jump = one splash-jump back toward the stage
    // Committed landing roll: no steering, momentum carries you low and fast.
    if (this.rollTimer > 0) {
      this.rollTimer = Math.max(0, this.rollTimer - dt);
      const k = Math.exp(-2.4 * dt);
      this.rollVelX *= k;
      this.rollVelZ *= k;
      this.body.setGravityScale(this._grav(1), true);
      this.body.setLinvel({ x: this.rollVelX, y: this.grounded ? Math.min(vy, 0) : vy, z: this.rollVelZ }, true);
      this.jumpRequested = false;
      this.jumpBuffer = 0;
      this.dropThroughRequested = 0;
      return;
    }

    if (this.swimFlail > 0) {
      const W = BALANCE.water;
      this.body.setGravityScale(0, true);
      if (this.jumpRequested || this.jumpBuffer > 0) {
        const p = this.getPosition(), r = Math.hypot(p.x, p.z) || 1;
        this.swimFlail = 0;
        this.body.setGravityScale(this._grav(1), true);
        // Inward speed timed so the capsule reaches the lip only once it's risen above the tiles (else it bonks the rim)
        const push = Math.min(W.flailPush, Math.max(0, r - STAGE_RADIUS - 0.5) / W.flailClearTime);
        this.body.setLinvel({ x: (-p.x / r) * push, y: W.flailJumpVel, z: (-p.z / r) * push }, true);
        this.jumpsLeft = 1;
        this.splashJumpT = W.flailCarryTime;
        this.jumpRising = false; // full height even on a tap (no short-hop cut)
        this.landSquash = -0.45;
        this.onFlailJump?.(this);
      } else {
        this.body.setLinvel({ x: vx * 0.9, y: 0.6, z: vz * 0.9 }, true);
      }
      this.jumpRequested = false;
      this.jumpBuffer = 0;
      return;
    }

    if (this.airDodgeTimer > 0) {
      // Dodge burst: glide, ignoring most gravity, then special fall
      const k = Math.exp(-5 * dt);
      this.body.setGravityScale(0.15, true);
      this.body.setLinvel({ x: vx * k, y: vy * k, z: vz * k }, true);
      this.jumpRequested = false;
      return;
    }

    if (this.canAct) {
      // Down + jump on a floating platform: drop through it instead of jumping.
      if (this.dropThroughRequested > 0 && this.grounded) {
        this.dropThroughRequested = 0;
        if (this.onDropThrough?.(this) !== false) {
          this.jumpBuffer = 0;
          this.jumpRequested = false;
          this.fastFallGrace = 0;
          this.body.setLinvel({ x: vx, y: -3, z: vz }, true);
        }
      }

      let speed = MV.speed * this.stats.move * (this.grounded ? this.slide : 1);
      if (this.zoomTimer > 0) speed *= 1.5;
      if (this.sugarTimer > 0) speed *= BALANCE.powerups.sugar.speed;
      if (this.megaTimer > 0) speed *= 0.9;
      if (this.held?.kind === 'dweeb') speed *= 0.72;
      else if (this.held) speed *= (this.carryMul ?? 1) * (this.grabSettle > 0 ? 0.5 : 1);
      if (this.charging > 0) speed *= 0.35;

      const tx = this.moveInput.x * speed;
      const tz = this.moveInput.y * speed;
      const inputMag = this.moveInput.length();
      const hSpeed = Math.hypot(vx, vz);
      const facing = inputMag > 0.1 ? (this.moveInput.x * vx + this.moveInput.y * vz) / Math.max(0.001, hSpeed) : 0;
      const braking = inputMag < 0.1 || facing < 0;
      // Accel and brake are separate: quick to get going, even quicker to stop. On ice the
      // arena's low traction scales both, so you commit to a slide.
      const rate = this.grounded
        ? (braking ? MV.groundBrake : MV.groundAccel) * this.traction
        : (braking ? MV.airBrake : MV.airAccel) * this.stats.airAccel;
      let accel = rate * dt;
      if (this.grounded && hSpeed > MV.skidSpeed && facing < -0.3 && this.skidTimer <= 0) {
        this.skidTimer = 0.22;
        this.onSkid?.(this, hSpeed);
      }
      if (this.specialFall && !this.grounded) accel *= 0.6;
      if (this.splashJumpT > 0 && !tx && !tz) {
        // Splash-jump carry: no-input air braking would kill the inward drift and drop you back in the lagoon.
        // Once above the lip, top the inward speed up so a hands-off splash-jump lands on the tiles.
        this.splashJumpT -= dt;
        const W = BALANCE.water;
        if (W.flailCarryTime - this.splashJumpT > W.flailClearTime) {
          const p = this.body.translation(), r = Math.hypot(p.x, p.z) || 1;
          const inward = -(vx * p.x + vz * p.z) / r;
          if (r > STAGE_RADIUS - 1 && inward < W.flailCarry) {
            vx -= (p.x / r) * (W.flailCarry - inward);
            vz -= (p.z / r) * (W.flailCarry - inward);
          }
        }
      } else {
        this.splashJumpT = 0;
        vx = approach(vx, tx, accel);
        vz = approach(vz, tz, accel);
      }

      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
        vy = MV.jumpVel * this.stats.jump * this.jumpScale;
        this.jumpsLeft = 1;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.jumpRising = true;
        this.landSquash = -0.35;
        this.onJump?.(this, false);
      } else if (this.jumpRequested && this.jumpsLeft > 0 && !this.grounded && !this.specialFall) {
        vy = MV.doubleJumpVel * this.stats.jump * this.jumpScale;
        this.jumpsLeft = 0;
        this.jumpBuffer = 0;
        this.jumpRising = true;
        this.flipSpin = 1;
        this.onJump?.(this, true);
      }
      // Variable height: let go early and the rise is cut (only our own jumps, never launches)
      if (this.jumpRising && vy <= 0) this.jumpRising = false;
      if (this.jumpRising && this.jumpHeld === false && vy > MV.shortHopVel) {
        vy = MV.shortHopVel;
        this.jumpRising = false;
      }
    } else if (this.grounded && (this.hitstun > 0 || this.proneTimer > 0 || this.landLag > 0) && !this.ragdolling) {
      const k = Math.exp(-(this.landLag > 0 ? 10 : 4) * dt);
      vx *= k;
      vz *= k;
    } else if (!this.grounded && (this.hitstun > 0 || this.ragdolling)) {
      if (this.hitstun > 0) {
        // Launch drag: big hits still fly far, but small ones settle instead of drifting off-stage
        const k = Math.exp(-KB.launchDrag * dt);
        vx *= k;
        vz *= k;
      }
      // Directional influence: a limited Δv budget toward the stick — nudges, never reverses a smash
      if (this.diBudget > 0 && this.moveInput.lengthSq() > 0.01) {
        const s = this.ragdolling ? DI.ragdollScale : 1;
        const step = Math.min(this.diBudget, DI.rate * dt);
        this.diBudget -= step;
        vx += this.moveInput.x * step * s;
        vz += this.moveInput.y * step * s;
        if (this.jumpHeld) vy += step * s * DI.vertical;
      }
    }
    // Fast-fall: hold down while descending to commit to the floor. It lands harder,
    // so the roll/tech timing on the way down becomes a read rather than a wait.
    this.fastFallGrace = Math.max(0, this.fastFallGrace - dt);
    const canFastFall = !this.grounded && !this.ragdolling && !this.ledge && vy < 2 &&
      this.fastFallGrace <= 0 && !this.specialFall && this.airDodgeTimer <= 0 && this.swimFlail <= 0;
    if (this.fastFallInput && canFastFall) {
      if (!this.fastFalling) {
        this.fastFalling = true;
        this.onFastFall?.(this);
      }
    } else this.fastFalling = false;

    this.jumpRequested = false;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (!this.canAct) this.jumpRising = false;

    // Footsteps: cadence follows actual ground speed, so walking, sprinting and ice-sliding all read differently.
    const strideSpeed = Math.hypot(vx, vz);
    if (this.grounded && !this.ragdolling && strideSpeed > 2.2) {
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = Math.max(0.18, 0.48 - strideSpeed * 0.028);
        this.onStep?.(this, strideSpeed);
      }
    } else {
      this.footstepTimer = Math.max(0, this.footstepTimer - dt);
    }

    const fallMult = this.fastFalling ? MV.fastFallGravity : 1;
    this.body.setGravityScale(this._grav(vy < 0 && !this.ragdolling ? MV.fallGravity * fallMult : 1), true);
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }

  // ─── Per-frame: after physics step ───

  postStep(dt, time) {
    if (this.eliminated) return;
    if (this.out) {
      this.respawnTimer -= dt;
      return;
    }

    const pos = this.getPosition();
    const lv = this.body.linvel();
    this.velocity.set(lv.x, lv.y, lv.z);

    // Timers
    this.hitstun = Math.max(0, this.hitstun - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.diveCooldown = Math.max(0, this.diveCooldown - dt);
    this.proneTimer = Math.max(0, this.proneTimer - dt);
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.megaTimer = Math.max(0, this.megaTimer - dt);
    this.zoomTimer = Math.max(0, this.zoomTimer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.landLag = Math.max(0, this.landLag - dt);
    this.airDodgeCd = Math.max(0, this.airDodgeCd - dt);
    this.techBuffer = Math.max(0, this.techBuffer - dt);
    this.techGrace = Math.max(0, this.techGrace - dt);
    this.ledgeCd = Math.max(0, this.ledgeCd - dt);
    this.parryTimer = Math.max(0, this.parryTimer - dt);
    this.parryCd = Math.max(0, this.parryCd - dt);
    this.dropkickTimer = Math.max(0, this.dropkickTimer - dt);
    this.skidTimer = Math.max(0, this.skidTimer - dt);
    if (this.magnetTimer > 0) this.magnetTimer = Math.max(0, this.magnetTimer - dt);
    this.sugarTimer = Math.max(0, this.sugarTimer - dt);
    this.rollCd = Math.max(0, this.rollCd - dt);
    this.dropGrace = Math.max(0, this.dropGrace - dt);
    this.dropThroughRequested = Math.max(0, this.dropThroughRequested - dt);
    if (this.freezeTimer > 0) {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      if (this.freezeTimer <= 0) {
        this.body.setGravityScale(this._grav(1), true);
        this.onThaw?.(this);
      }
    }
    if (this.swimFlail > 0) {
      this.swimFlail -= dt;
      if (this.swimFlail <= 0) this.body.setGravityScale(this._grav(1), true); // missed it: sink (Match takes the stock)
    }
    if (this.airDodgeTimer > 0) {
      this.airDodgeTimer -= dt;
      if (this.airDodgeTimer <= 0) { this.specialFall = true; this.jumpsLeft = 0; }
    }
    if (this.diveTimer > 0) {
      this.diveTimer -= dt;
      if (this.diveTimer <= 0) this.proneTimer = this.grounded ? 0.3 : 0.05;
    }

    // Ground check (excluding our own capsule). A fresh drop-through ignores the floor for a beat.
    this.wasGrounded = this.grounded;
    const hit = this.physicsWorld.raycast(pos, { x: 0, y: -1, z: 0 }, 40, this.collider);
    this.groundY = hit ? hit.point.y : -100;
    this.grounded = this.dropGrace <= 0 && !!hit && hit.distance < DWEEB_HALF + 0.08 && this.velocity.y < 4;
    if (this.wasGrounded && !this.grounded) this.fastFallGrace = MV.fastFallDelay;
    if (this.grounded || this.ledge) this.airTime = 0;
    else if ((this.airTime += dt) > this.maxAir) this.maxAir = this.airTime;
    if (this.grounded) {
      this.jumpsLeft = 2;
      this.splashJumpT = 0;
      this.coyote = 0.1;
      this.specialFall = false;
      this.flailUsed = false;
      if (this.dropkickTimer > 0) this.dropkickTimer = 0; // landing ends a drop-kick
      if (!this.wasGrounded && this.velocity.y < -3) {
        const fall = -this.velocity.y;
        this.landSquash = Math.min(0.5, fall * 0.03 * (this.stats.mass / 3));
        if (fall > 6) this.jolt(Math.min(1.5, fall / 14), 0.6, 0);
        const tumbling = this.ragdolling || this.hitstun > 0;
        if (tumbling && fall > 6) {
          // Hard slam while tumbling: tech it (pressed just before) or eat a longer knockdown
          if (this.techBuffer > 0 || (!this.isPlayer && Math.random() < this.techChance)) this._tech();
          else { this.techGrace = BALANCE.tech.buffer; this.missedTech = true; }
        } else if (!tumbling && fall >= BALANCE.roll.minFallSpeed && this.rollCd <= 0 && this.moveInput.lengthSq() > 0.04) {
          // Drop in with a direction held and you roll out of it instead of eating the recovery.
          this.startRoll(this.moveInput.x, this.moveInput.y);
          this.onRoll?.(this);
        } else if (!tumbling && fall >= BALANCE.landLag.minSpeed) {
          const LL = BALANCE.landLag;
          // Heavier bodies take a touch longer to gather themselves, balancing their launch armor.
          this.landLag = (LL.min + (LL.max - LL.min) * Math.min(1, (fall - LL.minSpeed) / 10)) *
            (0.85 + this.stats.mass * 0.05);
        }
        this.onLand?.(this, fall);
      }
    }

    // Ragdoll: physics owns rotation while tumbling
    if (this.ragdolling) {
      this.ragdollTimer -= dt;
      if (this.ragdollTimer <= 0 && (this.grounded || this.ragdollTimer < -KB.ragdollAirMax)) {
        const knocked = this.grounded && this.missedTech;
        this.recoverFromRagdoll();
        if (knocked) this.proneTimer = Math.max(this.proneTimer, BALANCE.tech.missProne);
      }
    }

    // Facing
    if (!this.ragdolling) {
      let target = this.yaw;
      if (this.aimYaw !== null) target = this.aimYaw;
      else if (this.canAct && this.moveInput.lengthSq() > 0.01) target = Math.atan2(this.moveInput.x, this.moveInput.y);
      this.yaw = lerpAngle(this.yaw, target, 1 - Math.exp(-14 * dt));
    }

    this._animate(dt, time, pos);
  }

  /**
   * Body language springs: the blob's top lags behind its feet. Speeding up tips it back, braking
   * pitches it forward, turning banks it into the curve, and the same world acceleration (in the
   * Dweeb's own frame) drives ears/stalks/antennae so they flop and settle instead of ticking on a
   * metronome. Presentation only: nothing here touches physics or hitboxes.
   */
  _bodySprings(dt) {
    const I = this.inertia || (this.inertia = { px: 0, pv: 0, rz: 0, rv: 0, lvx: 0, lvz: 0, lvy: 0, ax: 0, az: 0, ay: 0, loco: makeLocomotionState() });
    const h = Math.max(1e-3, Math.min(dt, 1 / 30));
    const v = this.velocity;
    let ax = (v.x - I.lvx) / h, az = (v.z - I.lvz) / h, ay = (v.y - I.lvy) / h;
    I.lvx = v.x; I.lvz = v.z; I.lvy = v.y;
    // Ignore teleports / respawns / grabs
    if (this.ragdolling || this.grabbedBy || Math.hypot(ax, az) > 400) { ax = az = ay = 0; }
    const sm = 1 - Math.exp(-18 * h);
    I.ax += (ax - I.ax) * sm; I.az += (az - I.az) * sm; I.ay += (ay - I.ay) * sm;
    // World accel → local (forward = +z rotated by yaw, matching sin/cos yaw convention)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const fwdA = I.ax * sy + I.az * cy;
    const sideA = I.ax * cy - I.az * sy;
    const heavy = (this.stats?.mass ?? 3) / 3;
    // Pitch spring (rad): accelerating forward tips the top back (negative x = lean back)
    const k = 120 / heavy, c = 9;
    const pTarget = this.grounded ? THREE.MathUtils.clamp(-fwdA * 0.006, -0.32, 0.32) : 0;
    I.pv += (k * (pTarget - I.px) - c * I.pv) * h;
    I.px += I.pv * h;
    // Bank: into turns (locomotion lean), plus a little sideways sway from lateral jolts
    const lean = this.grounded && !this.ragdolling ? updateLean(I.loco, v, this.moveInput, h) : updateLean(I.loco, _zero3, _zero3, h);
    const rTarget = lean * 0.55 + THREE.MathUtils.clamp(sideA * 0.003, -0.15, 0.15);
    I.rv += (k * (rTarget - I.rz) - c * I.rv) * h;
    I.rz += I.rv * h;
    if (!this.ragdolling) this.bodyGroup.rotation.z = I.rz;
    // Appendages read local accel; the face code integrates their springs.
    this.appendageDrive = { fwd: fwdA, side: sideA, up: I.ay };
  }

  /** Kick every spring (body + appendages) — landings, hits, getting grabbed. */
  jolt(strength = 1, fwd = 0, side = 0) {
    const I = this.inertia; if (!I) return;
    I.pv += fwd * 6 * strength;
    I.rv += side * 6 * strength;
    if (this.wiggleItems) for (const w of this.wiggleItems) w.v = (w.v || 0) + (Math.random() - 0.5) * 18 * strength;
  }

  _animate(dt, time, pos) {
    this.mesh.position.set(pos.x, pos.y, pos.z);

    if (this.ragdolling) {
      const r = this.body.rotation();
      this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    } else {
      _q.setFromAxisAngle(_up, this.yaw);
      // Getting up after a tumble: roll back upright over a beat instead of snapping.
      const rate = this.getUpT > 0 ? 7 : 25;
      if (this.getUpT > 0) this.getUpT -= dt;
      this.mesh.quaternion.slerp(_q, 1 - Math.exp(-rate * dt));
    }
    this._bodySprings(dt);

    // Double-jump flip
    if (this.flipSpin > 0) {
      this.flipSpin = Math.max(0, this.flipSpin - dt * 3.2);
      this.bodyGroup.rotation.x = (1 - this.flipSpin) * Math.PI * 2 + this.inertia.px;
    } else {
      this.bodyGroup.rotation.x = this.inertia.px;
    }

    // Squash & stretch
    this.landSquash *= Math.exp(-10 * dt);
    const speedH = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.grounded && speedH > 0.8;
    this.wobblePhase += dt * (moving ? 14 : 3.5);
    let sy = 1 + Math.sin(this.wobblePhase * (moving ? 1 : 0.8)) * (moving ? 0.05 : 0.03);
    if (!this.grounded && !this.ragdolling) sy += Math.min(0.18, Math.abs(this.velocity.y) * 0.012);
    sy -= this.landSquash;
    if (this.charging > 0) sy -= this.charging * 0.12;
    const sxz = 1 / Math.sqrt(Math.max(0.4, sy));
    const mega = this.megaTimer > 0 ? 1.55 : 1;
    this._scale = THREE.MathUtils.lerp(this._scale || 1, mega, 1 - Math.exp(-6 * dt));
    this.rig.scale.set(sxz * this._scale, sy * this._scale, sxz * this._scale);
    this.rig.position.y = -DWEEB_HALF + (this._scale - 1) * 0.1;

    // Charge shake
    if (this.charging > 0) {
      this.rig.position.x = (Math.random() - 0.5) * 0.05 * this.charging;
    } else {
      this.rig.position.x = 0;
    }

    // Limbs
    const walk = moving ? Math.sin(this.wobblePhase) : 0;
    for (const leg of this.legs) {
      leg.pivot.rotation.x = this.grounded ? walk * 0.8 * leg.side : 0.5;
    }
    for (const arm of this.arms) {
      let rx = moving ? -walk * 0.9 * arm.side : Math.sin(this.wobblePhase * 0.7) * 0.1;
      let rz = arm.side * (0.5 + (this.grounded ? 0 : 0.9));
      if (this.held) {
        const mass = this.held.ref?.def?.mass ?? (this.held.kind === 'dweeb' ? 3.0 : 1.5);
        const isHeavy = mass >= 2.5;
        // Two-handed forward grasp; heavy items make arms tremble and pull inward
        const tremble = isHeavy ? (Math.random() - 0.5) * 0.08 : 0;
        rx = isHeavy ? (-2.2 + tremble) : -2.6;
        rz = arm.side * (isHeavy ? 0.15 : 0.25) + tremble;
        // Tilt the body backwards slightly when heaving a heavy mass
        this.rig.rotation.x = isHeavy ? -0.15 : -0.05;
      } else {
        this.rig.rotation.x = 0;
      }
      if (this.charging > 0 && arm.side === 1) {
        rx = 0.6 + this.charging * 0.9;
        rz = 0.9;
      }
      if (this.attackAnim > 0 && arm.side === 1) {
        const t = this.attackAnim / 0.22;
        rx = -Math.PI / 2 * Math.min(1, t * 2);
        rz = 0.1;
      }
      if (this.diveTimer > 0) {
        rx = -Math.PI * 0.9;
        rz = arm.side * 0.2;
      }
      if (this.ragdolling || this.hitstun > 0) {
        rx = Math.sin(this.wobblePhase * 3 + arm.side) * 1.4;
        rz = arm.side * 1.6;
      }
      arm.pivot.rotation.x = THREE.MathUtils.lerp(arm.pivot.rotation.x, rx, 1 - Math.exp(-22 * dt));
      arm.pivot.rotation.z = THREE.MathUtils.lerp(arm.pivot.rotation.z, rz, 1 - Math.exp(-22 * dt));
    }

    animateDweebFace(this, dt, time);

    // Hit flash (white) and invulnerability blink
    const frozen = this.freezeTimer > 0;
    const flash = frozen ? 0 : this.flashTimer > 0 ? 0.9 : (this.megaTimer > 0 ? 0.15 + Math.sin(time * 10) * 0.1 : 0);
    for (const m of this.flashMats) {
      if (frozen) m.emissive.setRGB(0.22, 0.5, 0.78);
      else m.emissive.setRGB(flash, flash, flash * (this.megaTimer > 0 && this.flashTimer <= 0 ? 0.4 : 1));
    }
    this.mesh.visible = this.invulnTimer > 0 && !frozen ? Math.sin(time * 30) > -0.3 : true;

    // Bubble shield / freeze block / parry ring
    this.bubbleMesh.visible = this.bubble;
    if (this.bubble) this.bubbleMesh.scale.setScalar(1 + Math.sin(time * 6) * 0.04);
    this.freezeMesh.visible = frozen;
    if (frozen) {
      this.freezeMesh.rotation.y += dt * 0.6;
      this.freezeMesh.scale.setScalar(1 + Math.sin(time * 8) * 0.03);
    }
    this.parryMesh.visible = this.parryTimer > 0;
    if (this.parryTimer > 0) {
      this.parryMesh.rotation.z += dt * 9;
      this.parryMesh.scale.setScalar(1 + Math.sin(time * 22) * 0.08);
    }
    this.shieldMesh.visible = this.shieldCharges > 0;
    if (this.shieldMesh.visible) {
      this.shieldMesh.rotation.y += dt * 1.6;
      this.shieldMesh.rotation.x += dt * 0.9;
      this.shieldMesh.scale.setScalar(1 + Math.sin(time * 7) * 0.05);
    }

    // Landing roll: one full forward tumble of the body rig while the physics carries you.
    if (this.rollTimer > 0 && !this.held) {
      const t = 1 - this.rollTimer / BALANCE.roll.time;
      this.rig.rotation.x = -t * Math.PI * 2;
    } else if (!this.held) {
      this.rig.rotation.x = 0;
    }

    // Player ring pulse
    if (this.playerRing) {
      this.playerRing.material.opacity = 0.6 + Math.sin(time * 5) * 0.3;
      this.playerRing.visible = this.grounded;
    }

    // Blob shadow
    const h = pos.y - DWEEB_HALF - this.groundY;
    this.shadow.visible = this.groundY > -50 && h < 12;
    if (this.shadow.visible) {
      const s = (0.95 * this._scale) / (1 + Math.max(0, h) * 0.18);
      this.shadow.position.set(pos.x, this.groundY + 0.03, pos.z);
      this.shadow.scale.set(s, s, s);
      this.shadow.material.opacity = 0.5 / (1 + Math.max(0, h) * 0.25);
    }
  }

  // ─── Combat ───

  /**
   * Apply a hit. Returns the launch speed (0 if ignored).
   * base/growth follow Smash-style scaling: launch = base + growth * percent/100.
   */
  receiveHit({ dir, damage, base, growth, attacker = null, time = 0, freeze = 0, noParry = false }) {
    if (!this.active || this.invulnTimer > 0) return 0;

    // Timed parry: no damage, and the attacker eats a recoil hit instead.
    if (!noParry && this.parryTimer > 0) return this._counter(dir, attacker, time);

    if (this.bubble) {
      this.bubble = false;
      this.invulnTimer = 0.4;
      this.body.setLinvel({ x: dir.x * 5, y: 4, z: dir.z * 5 }, true);
      this.onBubblePop?.(this);
      return 0.01;
    }

    // SHIELD gem: one hit lands at a fraction of its damage and barely moves you.
    let shieldDmg = 1, shieldLaunch = 1;
    if (this.shieldCharges > 0 && damage > 0) {
      const S = BALANCE.powerups.shield;
      shieldDmg = S.damage;
      shieldLaunch = S.launch;
      this.shieldCharges = 0;
      this.onShieldBreak?.(this);
    }

    const dmgArmor = this.megaTimer > 0 ? 0.6 : 1;
    const armor = dmgArmor * this.stats.armor;
    this.percent = Math.min(999, this.percent + damage * dmgArmor * shieldDmg);
    // Taking a hit breaks your punch streak (super-smash meter wants consecutive landed punches).
    this.punchStreak = 0;
    const launch = (base + growth * this.stats.growthTaken * (this.percent / 100)) * armor * shieldLaunch;

    // Body reels from the blow: local-frame kick so the wobble points away from the hit.
    { const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw); this.jolt(Math.min(2, 0.4 + launch * 0.06), -(dir.x * sy + dir.z * cy), dir.x * cy - dir.z * sy); }
    this.rollTimer = 0;
    if (this.ledge) this.releaseLedge(false);
    this.airDodgeTimer = 0;
    this.specialFall = false;
    this.landLag = 0;
    _v.set(dir.x, Math.max(dir.y, KB.minUp), dir.z).normalize().multiplyScalar(launch);
    this.body.setLinvel({ x: _v.x, y: _v.y, z: _v.z }, true);

    this.hitstun = KB.hitstunBase + launch * KB.hitstunPerLaunch;
    this.diBudget = DI.strength * MV.speed;
    this.missedTech = false;
    this.flashTimer = 0.1;
    this.charging = 0;
    this.diveTimer = 0;
    this.slamActive = false;
    this.dropkickTimer = 0;
    this.skidTimer = 0;
    this.aimYaw = null;
    if (freeze > 0) {
      this.freezeTimer = Math.max(this.freezeTimer, freeze);
      this.hitstun = 0;
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setGravityScale(0, true);
      this.onFrozen?.(this);
    }
    if (attacker && attacker !== this) {
      this.lastHitBy = attacker;
      this.lastHitTime = time;
      attacker.damageDealt += damage * dmgArmor;
    }
    if (launch > KB.ragdollAt) this.startRagdoll(this.hitstun + 0.2, launch);
    this.onHit?.(this, launch);
    return launch;
  }

  /** A parry that connected: brief i-frames and a recoil launch for the attacker. */
  _counter(dir, attacker, time) {
    const P = BALANCE.parry;
    this.parryTimer = 0;
    this.invulnTimer = Math.max(this.invulnTimer, P.invuln);
    this.flashTimer = 0.12;
    this.charging = 0;
    this.isCharging = false;
    this.slamActive = false;
    this.dropkickTimer = 0;
    this.skidTimer = 0;
    if (attacker && attacker !== this && attacker.active && attacker.invulnTimer <= 0) {
      const ap = attacker.getPosition(), p = this.getPosition();
      _v.set(ap.x - p.x, 0.55, ap.z - p.z);
      if (_v.lengthSq() < 1e-4) _v.set(dir.x, 0.55, dir.z);
      attacker.receiveHit({
        dir: _v.normalize(), damage: 1, base: P.recoil, growth: 0,
        attacker: this, time, noParry: true,
      });
      attacker.hitstun = Math.max(attacker.hitstun, P.stun);
    }
    this.onParry?.(this, attacker);
    return 0.01;
  }

  startRagdoll(duration = 1.2, spin = 8) {
    if (!this.ragdolling) {
      this.ragdolling = true;
      this.body.lockRotations(false, true);
      this.body.setLinearDamping(0.15);
      this.body.setAngularDamping(KB.ragdollAngDamp); // readable tumble, not a blender
      this.collider.setFriction(0.7); // tumble and skid instead of skating
    }
    this.ragdollTimer = Math.max(this.ragdollTimer, duration);
    const s = Math.min(spin, KB.ragdollSpinMax);
    this.body.setAngvel({ x: (Math.random() - 0.5) * s, y: (Math.random() - 0.5) * s, z: (Math.random() - 0.5) * s }, true);
  }

  recoverFromRagdoll() {
    this.ragdolling = false;
    this.ragdollTimer = 0;
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.lockRotations(true, true);
    this.body.setLinearDamping(0);
    this.body.setAngularDamping(1.5);
    this.collider.setFriction(0);
    this.landSquash = 0.3;
    this.getUpT = 0.35;
    this.jolt(1.2, 0.5, 0);
  }

  setGrabbed(holder) {
    this.grabbedBy = holder;
    if (holder) {
      this.escapeTimer = (1.4 + this.percent * 0.008) * this.stats.escape;
      this.charging = 0;
      this.body.setGravityScale(0, true);
      this.collider.setCollisionGroups(this.physicsWorld.makeGroups(CollisionGroups.OBJECT, CollisionGroups.ALL & ~CollisionGroups.PLAYER));
    } else {
      this.body.setGravityScale(this._grav(1), true);
      this.collider.setCollisionGroups(this.defaultGroups);
    }
  }

  applyPowerUp(kind) {
    if (kind === 'mega') this.megaTimer = 10;
    else if (kind === 'zoom') this.zoomTimer = 10;
    else if (kind === 'bubble') this.bubble = true;
    else if (kind === 'magnet') this.magnetTimer = BALANCE.powerups.magnet.duration;
    else if (kind === 'sugar') this.sugarTimer = BALANCE.powerups.sugar.duration;
    else if (kind === 'shield') this.shieldCharges = BALANCE.powerups.shield.charges;
  }

  /** Knocked off the stage: hide and wait to respawn. */
  knockOut(respawnDelay) {
    this.out = true;
    this.respawnTimer = respawnDelay;
    this.held = null;
    this.charging = 0;
    this.megaTimer = 0;
    this.zoomTimer = 0;
    this.bubble = false;
    this.ledge = null;
    this.airDodgeTimer = 0;
    this.specialFall = false;
    this.landLag = 0;
    this.swimFlail = 0;
    this.airTime = 0;
    this.parryTimer = 0;
    this.freezeTimer = 0;
    this.magnetTimer = 0;
    this.slamActive = false;
    this.dropkickTimer = 0;
    this.skidTimer = 0;
    this.rollTimer = 0;
    this.fastFalling = false;
    this.shieldCharges = 0;
    this.sugarTimer = 0;
    this.body.setGravityScale(this._grav(1), true);
    this.resetStyle();
    if (this.ragdolling) this.recoverFromRagdoll();
    this.body.setEnabled(false);
    this.mesh.visible = false;
    this.shadow.visible = false;
  }

  /** Barely under the waterline near the edge: a brief flail with one splash-jump out. */
  startFlail(time) {
    if (this.ragdolling) this.recoverFromRagdoll();
    this.swimFlail = time;
    this.flailUsed = true;
    this.hitstun = 0;
    this.airDodgeTimer = 0;
    this.specialFall = false;
    this.techBuffer = 0;
    this.techGrace = 0;
  }

  resetStyle() {
    this.styleScore = 0;
    this.styleTimer = 0;
    this.styleTier = 0;
    this.superReady = false;
    this.superArmed = false;
    this.punchStreak = 0;
    this.punchStreakT = -99;
  }

  eliminate() {
    this.knockOut(0);
    this.eliminated = true;
  }

  respawn(pos, invuln = 2.5) {
    this.out = false;
    this.flailUsed = false;
    this.eliminated = false;
    this.percent = 0;
    this.hitstun = 0;
    this.proneTimer = 0;
    this.diveTimer = 0;
    this.parryTimer = 0;
    this.parryCd = 0;
    this.freezeTimer = 0;
    this.magnetTimer = 0;
    this.slamActive = false;
    this.dropkickTimer = 0;
    this.skidTimer = 0;
    this.rollTimer = 0;
    this.fastFalling = false;
    this.dropGrace = 0;
    this.shieldCharges = 0;
    this.sugarTimer = 0;
    this.lastHitBy = null;
    this.grabbedBy = null;
    this.punchStreak = 0;
    this.punchStreakT = -99;
    this.body.setEnabled(true);
    this.collider.setCollisionGroups(this.defaultGroups);
    if (this.ragdolling) this.recoverFromRagdoll();
    this.body.setTranslation(pos, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setGravityScale(this._grav(1), true);
    this.invulnTimer = invuln;
    this.mesh.visible = true;
    this.mesh.position.set(pos.x, pos.y, pos.z);
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.shadow);
    this.mesh.traverse(child => {
      child.geometry?.dispose();
      if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => m.dispose());
    });
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    this.physicsWorld.removeBody(this.physicsId);
  }
}

// ─── helpers ───

function approach(v, target, step) {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function darken(color, factor) {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

let _shadowTex = null;
function blobShadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, 'rgba(30,10,50,1)');
  g.addColorStop(0.6, 'rgba(30,10,50,0.7)');
  g.addColorStop(1, 'rgba(30,10,50,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}
