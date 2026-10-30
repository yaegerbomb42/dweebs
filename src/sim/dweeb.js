// src/sim/dweeb.js — the dweeb state machine and movement, with no mesh anywhere in sight.
//
// This is the sim half of the old src/player/Dweeb.js. Every number is still read from
// src/game/Balance.js, so the feel is whatever the Lead last tuned; this file contains no gameplay
// constants of its own. The visual half (chamfered yellow cube, noodle limbs, googly pupils,
// squash) stays with the Lead and gets moved verbatim, not rewritten — see the SIM→LEAD request
// on the board.
//
// What changed relative to the live class, and why each change was necessary:
//   • Input arrives as an InputFrame per tick instead of mutating `moveInput` / `jumpRequested`
//     from a Controller or a Bot. Edges are detected here, so a client that reconnects mid-charge
//     does not get a phantom swing.
//   • `onHit` / `onKO` / `onFlail` / `onLand` / `onLedge` / `onTech` are gone: they became sim
//     events (events.js) so nothing in the sim holds a reference to Fx, Hud or audio.
//   • Math.random() is gone. Everything random is a field on the sim's RNG.

import { BALANCE, statsFor } from '../game/Balance.js';
import { STAGE_RADIUS } from './arena.js';
import { TICK_DT } from './contracts.js';

const MV = BALANCE.move;
const KB = BALANCE.knockback;
const DI = BALANCE.di;
const W = BALANCE.water;
const AIR = BALANCE.airDodge;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Linear approach, so acceleration never overshoots a target speed. */
function approach(v, target, delta) {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return v;
}

/**
 * One dweeb in the simulation: a Rapier capsule plus the state machine that drives it.
 * No three.js, no DOM, no audio, no randomness.
 */
export class SimDweeb {
  /**
   * @param {object} opts
   * @param {import('./physics.js').SimPhysics} opts.physics
   * @param {number} opts.id     Entity id, from the sim's IdAllocator.
   * @param {number} opts.slot   Player slot.
   * @param {string} [opts.type] 'cube' | 'blob' | 'spiky'.
   * @param {boolean} [opts.isBot]
   */
  constructor({ physics, id, slot, type = 'cube', name = 'Dweeb', isBot = false, color = 0xffd23f }) {
    this.physics = physics;
    this.id = id;
    this.slot = slot;
    this.name = name;
    this.type = type;
    this.stats = statsFor(type);
    this.isBot = isBot;
    this.color = color;

    // Match state
    this.percent = 0;
    this.stocks = 3;
    this.out = false;
    this.eliminated = false;
    this.respawnTimer = 0;
    this.kos = 0;
    this.falls = 0;
    this.lastHitBy = 0;
    this.lastHitAt = -99;
    this.active = true;

    // Combat / movement state
    this.hitstun = 0;
    this.ragdolling = false;
    this.ragdollTimer = 0;   // counts down while tumbling; stand up when it lapses (live parity)
    this.techBuffer = 0;     // dodge pressed while tumbling: techs a landing within the window
    this.invuln = 0;
    this.attackCooldown = 0;
    this.isCharging = false;
    this.charge = 0;
    this.attackBuffer = 0;      // a press during cooldown/hitstun still lands once we can act
    this.throwCharging = false; // a grab-button press that began while already holding something
    this.throwCharge = 0;
    this.swing = 0;             // remaining swing window, in seconds
    this.diveTimer = 0;
    this.diveCooldown = 0;
    this.held = 0;
    this.heldKind = '';         // 'item' | 'dweeb'
    this.grabbedBy = 0;
    this.escapeTimer = 0;
    this.diBudget = 0;
    this.landLagT = 0;
    this.airDodgeT = 0;
    this.airDodgeCd = 0;
    this.specialFall = false;
    this.jumpsLeft = 2;
    this.grounded = false;
    this.groundY = 0;
    this.yaw = 0;
    this.jumpHeld = false;
    this.swimFlail = 0;
    this.flailUsed = false;
    this.megaT = 0;
    this.zoomT = 0;
    this.bubbleT = 0;
    this.style = 0;
    this.styleTier = 0;
    this.styleTimer = 0;
    this.stylePeak = 0;       // highest style this match: the showman award
    this.superArmed = false;
    // Super-smash meter: consecutive landed punches build it faster (mirrors the live
    // CombatSystem's streak; see BALANCE.style.streakWindow).
    this.punchStreak = 0;
    this.punchStreakT = -99;
    // Stage-hazard cooldowns, in seconds.
    this.hazardCd = 0;
    this.lavaCd = 0;          // volcano: grace after a lava spit before a dip dunks
    // pitfall: over a crumbled rim tile — ground collision is off until we're back over floor.
    this.pitfall = false;
    // conveyor belt drift, refreshed by stageHazards every tick (0 when off every belt).
    this.beltVX = 0;
    this.beltVZ = 0;
    this.team = 0;            // team battle: index into config.teams
    this.hillScore = 0;       // king of the hill: points this round
    this.lavaDips = 0;        // consecutive lava spits: the third dip in a row dunks
    this._gravOverride = null; // set by preStep paths that need a non-arena gravity this tick

    // Previous tick's input, for edge detection.
    this.prev = { jump: false, attack: false, grab: false, dodge: false, superYeet: false, drop: false };
    this.input = { moveX: 0, moveZ: 0, aimYaw: null, aimLoft: 0.2, charge: null };

    this._pos = [0, 0, 0];
    this._vel = [0, 0, 0];

    this.body = physics.character(0, 3, 0, id);
  }

  get canAct() {
    return this.active && !this.out && this.hitstun <= 0 && !this.ragdolling && !this.grabbedBy;
  }

  /**
   * Project the physics body into plain arrays. Called once per tick, after the physics step.
   *
   * Grounded is a short downward raycast rather than a contact event, and that choice is
   * load-bearing: contact events arrive on the step AFTER the contact, which costs a tick of
   * coyote time and makes jumps feel sticky. The ray costs one query and is exact.
   */
  sync() {
    const p = this.physics.pos(this.id), v = this.physics.vel(this.id);
    this._pos[0] = p.x; this._pos[1] = p.y; this._pos[2] = p.z;
    this._vel[0] = v.x; this._vel[1] = v.y; this._vel[2] = v.z;
    const wasGrounded = this.grounded;
    // Exclude our own capsule: with solid=true a ray from the body center otherwise hits
    // itself at distance 0 and every dweeb reads grounded while falling.
    const hit = this.physics.raycast(p.x, p.y, p.z, 0, -1, 0, 0.62, this.pitfall, this.physics.colliderOf(this.id));
    this.grounded = !!hit && v.y <= 0.01;
    if (this.grounded) {
      this.groundY = p.y - 0.62;
      // Landing refills both jumps and cancels a special fall — the same two effects the live
      // Dweeb gets from its landing branch.
      if (!wasGrounded) { this.jumpsLeft = 2; this.specialFall = false; }
    }
    return this;
  }

  get position() { return this._pos; }
  get velocity() { return this._vel; }

  /**
   * Apply one tick of input. Called before the physics step.
   *
   * A missing or malformed field falls back to neutral rather than throwing: one client sending
   * garbage must not take the server down, and the contract says malformed frames are clamped and
   * ignored, not fatal.
   *
   * @param {import('./contracts.js').InputFrame} f
   * @param {object} api sim-supplied callbacks: { emit, onJump, onLand, onSplashJump, onGrab,
   *        onReleaseAttack, onReleaseThrow, onDrop, onTech }
   */
  preStep(f, api) {
    this._gravOverride = null; // Sim applies arena gravity after preStep unless we overrode it
    this._arenaGrav = api?.arena?.profile?.gravity ?? 1;
    if (this.grounded) this.lavaDips = 0; // back on stage: the lava forgives
    this.input.moveX = clamp(num(f?.moveX), -1, 1);
    this.input.moveZ = clamp(num(f?.moveZ), -1, 1);
    this.input.aimYaw = Number.isFinite(f?.aimYaw) ? f.aimYaw : null;
    this.input.aimLoft = clamp(num(f?.aimLoft, 0.2), -0.35, 0.95);
    this.input.charge = Number.isFinite(f?.charge) ? clamp(f.charge, 0, 1) : null;
    this.jumpHeld = !!f?.jump;

    if (!this.active) return;
    const p = this.physics.pos(this.id);
    const v = this.physics.vel(this.id);
    let vx = v.x, vy = v.y, vz = v.z;

    // Rising / falling edges. A dropped frame is neutral, so "was false, is true" IS the edge.
    const jumpUp = !!f?.jump && !this.prev.jump;
    const attackUp = !!f?.attack && !this.prev.attack;
    const attackDown = !f?.attack && this.prev.attack;
    const grabUp = !!f?.grab && !this.prev.grab;
    const grabDown = !f?.grab && this.prev.grab;
    const dodgeUp = !!f?.dodge && !this.prev.dodge;
    const superUp = !!f?.superYeet && !this.prev.superYeet;
    const dropUp = !!f?.drop && !this.prev.drop;

    // Every timer, advanced by exactly one tick. Nothing here uses a frame delta.
    this.hitstun = Math.max(0, this.hitstun - TICK_DT);
    this.invuln = Math.max(0, this.invuln - TICK_DT);
    this.attackCooldown = Math.max(0, this.attackCooldown - TICK_DT);
    this.attackBuffer = Math.max(0, this.attackBuffer - TICK_DT);
    this.diveCooldown = Math.max(0, this.diveCooldown - TICK_DT);
    this.airDodgeCd = Math.max(0, this.airDodgeCd - TICK_DT);
    this.escapeTimer = Math.max(0, this.escapeTimer - TICK_DT);
    this.landLagT = Math.max(0, this.landLagT - TICK_DT);
    this.swing = Math.max(0, this.swing - TICK_DT);
    this.diveTimer = Math.max(0, this.diveTimer - TICK_DT);
    this.lavaCd = Math.max(0, this.lavaCd - TICK_DT);
    this.megaT = Math.max(0, this.megaT - TICK_DT);
    this.zoomT = Math.max(0, this.zoomT - TICK_DT);
    this.bubbleT = Math.max(0, this.bubbleT - TICK_DT);
    this.hazardCd = Math.max(0, this.hazardCd - TICK_DT);
    this.lavaCd = Math.max(0, this.lavaCd - TICK_DT);
    if (this.styleTimer > 0) {
      this.styleTimer -= TICK_DT;
      if (this.styleTimer <= 0) this.style = 0;
    }

    // The flail clock is not agency: it runs even while grabbed (the live postStep has no
    // grabbedBy gate either). A frozen flail would make the match rules skip this dweeb's
    // splash-KO check forever — an immortal dweeb falling out of the world, still "active".
    if (this.grabbedBy && this.swimFlail > 0) {
      this.swimFlail -= TICK_DT;
      if (this.swimFlail <= 0) this._gravOverride = this._arenaGrav;
    }

    // Ragdoll clock (live postStep parity): without this a tumbled dweeb that lands never
    // stands back up — canAct stays false forever and the bot idles on the floor. A buffered
    // dodge techs the landing instead, via the existing recover().
    this.techBuffer = Math.max(0, this.techBuffer - TICK_DT);
    if (this.ragdolling) {
      this.ragdollTimer -= TICK_DT;
      if (this.techBuffer > 0 && this.grounded) {
        this.techBuffer = 0;
        this.recover(api);
      } else if (this.ragdollTimer <= 0 &&
          (this.grounded || this.ragdollTimer < -KB.ragdollAirMax)) {
        this._standUp();
      }
    }

    // Held by someone: no agency at all, and no timers past this point run against us.
    if (this.grabbedBy) { this._write(vx, vy, vz); return; }

    // ── One-shot intents ──
    if (dodgeUp && this.canAct) {
      if (this.grounded) this.diveTimer = 0.35;
      else if (this.airDodgeCd <= 0) {
        this.airDodgeT = AIR.duration;
        this.airDodgeCd = AIR.cooldown;
        this.invuln = Math.max(this.invuln, AIR.invuln);
        this.specialFall = true;
      }
    }
    // Tumble tech: a dodge pressed while ragdolling buffers a tech for the landing window
    // (the InputFrame contract promises "tech a hard landing while tumbling").
    else if (dodgeUp && this.ragdolling) this.techBuffer = BALANCE.tech.buffer;
    if (superUp && this.style >= 100) this.superArmed = true;
    if (dropUp && this.held) api.onDrop?.(this);
    // A press is buffered for 0.2 s, so clicking a hair early (still in cooldown or hitstun)
    // is not silently eaten, and a button held through the cooldown starts charging on time.
    if (attackUp) this.attackBuffer = 0.2;
    if ((this.attackBuffer > 0 || (f?.attack && this.prev.attack))
        && this.canAct && this.attackCooldown <= 0 && !this.isCharging) {
      this.attackBuffer = 0;
      this.isCharging = true;
      this.charge = 0.001;
      api.emit?.('charge', { a: this.id, mag: this.charge });
    }
    if (this.isCharging) {
      // Either the client already integrated the charge (mouse hold) or the sim integrates it.
      this.charge = this.input.charge ?? Math.min(1, this.charge + TICK_DT / 0.75);
      // Released (this tick, or already up when a buffered tap fired): swing. Under 0.2 is a jab.
      if (!f?.attack) {
        api.onReleaseAttack?.(this, this.charge >= 0.2 ? this.charge : 0);
        this.isCharging = false;
        this.charge = 0;
      }
    }
    // Grab: press to grab. A press that starts while already holding charges a throw,
    // released to throw — so letting go of the grab press never yeets what you just picked up.
    if (grabUp && this.canAct && !this.held) api.onGrab?.(this);
    else if (grabUp && this.held) { this.throwCharging = true; this.throwCharge = 0; }
    if (this.throwCharging) {
      if (!this.held) this.throwCharging = false;
      else {
        this.throwCharge = this.input.charge ?? Math.min(1, this.throwCharge + TICK_DT / 0.75);
        if (grabDown) {
          this.throwCharging = false;
          api.onReleaseThrow?.(this, this.throwCharge >= 0.2 ? this.throwCharge : 0);
          this.throwCharge = 0;
        }
      }
    }

    // ── Air-dodge glide: ignore most gravity, then special-fall ──
    if (this.airDodgeT > 0) {
      this.airDodgeT -= TICK_DT;
      this._gravOverride = 0.15;
      const k = Math.exp(-5 * TICK_DT);
      this._write(vx * k, vy * k, vz * k);
      this._remember(f);
      return;
    }
    this._gravOverride = this._arenaGrav;

    // ── Water flail: hang at the waterline; one jump buys a big splash-jump back toward stage ──
    if (this.swimFlail > 0) {
      this.swimFlail -= TICK_DT;
      this._gravOverride = 0;
      if (jumpUp) {
        const r = Math.hypot(p.x, p.z) || 1;
        this.swimFlail = 0;
        this._gravOverride = this._arenaGrav;
        // Inward speed is timed so the capsule reaches the lip only once it has risen above the
        // tiles; without that it bonks the rim and the comeback dies, which is why the live code
        // divides by flailClearTime here.
        const push = Math.min(W.flailPush, Math.max(0, r - STAGE_RADIUS - 0.5) / W.flailClearTime);
        this.physics.setVel(this.id, (-p.x / r) * push, W.flailJumpVel, (-p.z / r) * push);
        this.jumpsLeft = 1;
        api.onSplashJump?.(this);
      } else {
        this._write(vx * 0.9, 0.6, vz * 0.9);
      }
      this._remember(f);
      return;
    }

    // ── Launched: directional influence, then bleed ──
    if (this.hitstun > 0 || this.ragdolling) {
      if (this.diBudget > 0) {
        const rate = DI.rate * (this.ragdolling ? DI.ragdollScale : 1) * TICK_DT;
        const want = Math.hypot(this.input.moveX, this.input.moveZ);
        if (want > 0.01) {
          // Budgeted in m/s so DI can nudge a launch but never reverse a smash.
          const give = Math.min(rate, this.diBudget);
          vx += (this.input.moveX / want) * give;
          vz += (this.input.moveZ / want) * give;
          this.diBudget -= give;
        } else if (this.jumpHeld) {
          const give = Math.min(rate * DI.vertical, this.diBudget);
          vy += give;
          this.diBudget -= give;
        }
      }
      const drag = Math.exp(-KB.launchDrag * TICK_DT);
      this._write(vx * drag, vy, vz * drag);
      this._remember(f);
      return;
    }

    if (this.canAct) {
      let speed = MV.speed * this.stats.move;
      if (this.zoomT > 0) speed *= 1.5;
      if (this.megaT > 0) speed *= 0.9;
      if (this.heldKind === 'dweeb') speed *= 0.72;
      else if (this.held) speed *= 0.7;
      if (this.isCharging) speed *= 0.35;
      if (this.landLagT > 0) speed *= 0.4;
      // A dive tackle is committed: you go where you were facing, fast.
      if (this.diveTimer > 0) {
        speed = MV.speed * 1.5;
      }

      // Arena movement modifiers: the iceberg is slick, the moon is floaty. The profile
      // lives on the arena; api may be a bare stub in unit tests, so default to stadium.
      const prof = api?.arena?.profile;
      speed *= (prof?.slide ?? 1);
      // Conveyor drift (beltVX/beltVZ, refreshed by stageHazards) and stage pushes (wind,
      // magnet) fold into the movement target: shifting what "standing still" means composes
      // with input instead of fighting the ground approach, which would zero a post-hoc
      // push every tick.
      let tx = this.input.moveX * speed + this.beltVX, tz = this.input.moveZ * speed + this.beltVZ;
      const push = api?.arena?.stagePush?.(p.x, p.z, this.grounded);
      if (push) { tx += push.x; tz += push.z; }
      const traction = this.grounded ? (prof?.traction ?? 1) : 1;
      const accel = (this.grounded ? MV.groundAccel * traction : MV.airAccel * this.stats.airAccel) * TICK_DT;
      const soft = this.specialFall && !this.grounded ? accel * 0.6 : accel;
      vx = approach(vx, tx, soft);
      vz = approach(vz, tz, soft);

      if (jumpUp && this.jumpsLeft > 0) {
        vy = (this.jumpsLeft === 2 ? MV.jumpVel : MV.doubleJumpVel) * this.stats.jump;
        this.jumpsLeft--;
        this.specialFall = false;
        api.onJump?.(this, this.jumpsLeft === 1);
      }
      // Variable jump height: releasing while still rising cuts the rise (short hop ≈ 0.85 m).
      if (!this.jumpHeld && vy > 0) vy = Math.min(vy, MV.shortHopVel * this.stats.jump);
    }

    this._write(vx, vy, vz);
    this._remember(f);
  }

  _write(vx, vy, vz) { this.physics.setVel(this.id, vx, vy, vz); }

  _remember(f) {
    this.prev.jump = !!f?.jump;
    this.prev.attack = !!f?.attack;
    this.prev.grab = !!f?.grab;
    this.prev.dodge = !!f?.dodge;
    this.prev.superYeet = !!f?.superYeet;
    this.prev.drop = !!f?.drop;
  }

  /**
   * Take a hit. This is the single place damage, launch, hitstun, ragdoll, DI budget and the
   * style meter are applied, so a punch, a thrown anvil, an explosion and a spinner all produce
   * the same knockback curve. The curve itself lives in Balance.js and is not restated here.
   *
   * @param {object} hit { damage, base, growth, kbScale, dirX, dirZ, lift, from, silent }
   * @returns {number} launch speed in m/s (0 if a bubble ate it)
   */
  applyHit(hit, api) {
    const percent = this.percent;
    const launch = (hit.base + hit.growth * (percent / 100)) * (hit.kbScale ?? 1);
    const len = Math.hypot(hit.dirX || 0, hit.dirZ || 0) || 1;
    const dx = (hit.dirX || 0) / len, dz = (hit.dirZ || 0) / len;
    const lift = hit.lift ?? KB.minUp;

    this.percent = Math.round((percent + (hit.damage || 0)) * 10) / 10;
    if (hit.from) {
      this.lastHitBy = hit.from.id;
      this.lastHitAt = api?.time ?? -99;
      hit.from.damageDealt = (hit.from.damageDealt || 0) + (hit.damage || 0);
    }

    // BUBBLE: the hit is eaten but the damage still counts — a reprieve, not a shield.
    if (this.bubbleT > 0) {
      if (!hit.silent) api?.emit?.('hit', { a: this.id, b: hit.from?.id ?? 0, mag: hit.damage, tier: 0 });
      return 0;
    }

    this.hitstun = KB.hitstunBase + KB.hitstunPerLaunch * launch;
    this.ragdolling = launch >= KB.ragdollAt;
    if (this.ragdolling) this.hitstun += KB.ragdollAirMax;
    // The tumble lasts about as long as the hitstun, like the live startRagdoll(hitstun + 0.2).
    // A bigger follow-up hit extends it (max), it never shortens it.
    if (this.ragdolling) this.ragdollTimer = Math.max(this.ragdollTimer, this.hitstun + 0.2);
    this.isCharging = false;
    this.charge = 0;
    this.diBudget = DI.strength * MV.speed;
    this.specialFall = false;

    const v = this.physics.vel(this.id);
    this.physics.setVel(this.id,
      v.x * 0.2 + dx * launch,
      Math.max(v.y * 0.2, lift) + launch * 0.35,
      v.z * 0.2 + dz * launch);
    this.physics.lockRotations(this.id, !this.ragdolling);

    if (!hit.silent) {
      api?.emit?.('hit', { a: this.id, b: hit.from?.id ?? 0, mag: hit.damage, tier: Math.round(launch) });
    }
    if (this.ragdolling) api?.emit?.('launch', { a: this.id, b: hit.from?.id ?? 0, mag: launch });
    if (hit.from) {
      addStyle(hit.from, api, 5 + launch * 0.5);
      // Super-smash meter: consecutive landed punches bank bonus style; anything else — a
      // weapon swing, a throw, a whiffed jab — breaks the attacker's streak.
      if (hit.punch) streakPunch(hit.from, api);
      else hit.from.punchStreak = 0;
    }
    // Taking a hit breaks your own streak.
    this.punchStreak = 0;
    return launch;
  }

  /** Zero out a launch and stand back up. Used by a tech. */
  recover(api) {
    this.ragdolling = false;
    this.ragdollTimer = 0;
    this.techBuffer = 0;
    this.hitstun = 0;
    this.diBudget = 0;
    this.specialFall = false;
    this.invuln = Math.max(this.invuln, BALANCE.tech.invuln);
    const v = this.physics.vel(this.id);
    this.physics.setVel(this.id, v.x * 0.15, 0, v.z * 0.15);
    this.physics.lockRotations(this.id, true);
    api?.emit?.('land', { a: this.id, kind: 'tech', mag: 0 });
  }

  /**
   * The ragdoll clock ran out: stop tumbling and stand. No invuln, no tech credit — the
   * live recoverFromRagdoll, minus the visuals. (The live adds a short knockdown when the
   * tech was missed; the sim has no prone state, so it just stands.)
   */
  _standUp() {
    this.ragdolling = false;
    this.ragdollTimer = 0;
    this.physics.setAngvel(this.id, 0, 0, 0);
    this.physics.lockRotations(this.id, true);
  }

  /** Put a dweeb back on stage with fresh stocks, at a spawn point the arena chose. */
  respawn(pos) {
    this.out = false;
    this.active = true;
    this.percent = 0;
    this.hitstun = 0;
    this.ragdolling = false;
    this.ragdollTimer = 0;
    this.techBuffer = 0;
    this.diBudget = 0;
    this.isCharging = false;
    this.charge = 0;
    this.held = 0;
    this.heldKind = '';
    this.grabbedBy = 0;
    this.swimFlail = 0;
    this.flailUsed = false;
    this.lavaDips = 0;
    this.jumpsLeft = 2;
    this.specialFall = false;
    this.invuln = 0.75;
    this.style = 0;
    this.styleTimer = 0;
    this.superArmed = false;
    this.physics.lockRotations(this.id, true);
    // Gravity reset rides _gravOverride: Sim applies it per-tick (d._gravOverride ?? grav),
    // so the respawn gravity survives the next physics step.
    this._gravOverride = 1;
    this.physics.setCollideGround(this.id, true);
    this.pitfall = false;
    this.beltVX = 0;
    this.beltVZ = 0;
    this.punchStreak = 0;
    this.punchStreakT = -99;
    this.hazardCd = 0;
    this.lavaCd = 0;
    this.physics.setPos(this.id, pos.x, pos.y, pos.z);
    this.physics.setVel(this.id, 0, 0, 0);
    this.sync();
  }

  /** A dweeb between rounds: kept in the world, parked, waiting. */
  park(pos) {
    this.active = false;
    this.out = false;
    this.percent = 0;
    this.hitstun = 0;
    this.ragdolling = false;
    this.ragdollTimer = 0;
    this.techBuffer = 0;
    this.held = 0;
    this.heldKind = '';
    this.grabbedBy = 0;
    this.swimFlail = 0;
    this.flailUsed = false;
    this.isCharging = false;
    this.charge = 0;
    this.physics.setCollideGround(this.id, true);
    this.pitfall = false;
    this.beltVX = 0;
    this.beltVZ = 0;
    this.punchStreak = 0;
    this.punchStreakT = -99;
    this.hazardCd = 0;
    this.lavaCd = 0;
    this.physics.setPos(this.id, pos.x, pos.y, pos.z);
    this.physics.setVel(this.id, 0, 0, 0);
    this.sync();
  }

  /** The read-only projection for the view, the wire and the checksum. */
  toState(isLocal = false) {
    return {
      id: this.id, slot: this.slot, name: this.name, type: this.type, color: this.color,
      pos: [this._pos[0], this._pos[1], this._pos[2]],
      vel: [this._vel[0], this._vel[1], this._vel[2]],
      yaw: this.yaw, percent: this.percent, stocks: this.stocks,
      active: this.active, out: this.out, eliminated: this.eliminated,
      grounded: this.grounded, holding: this.held > 0, held: this.held, heldBy: this.grabbedBy,
      style: this.style, styleTier: this.styleTier, isBot: this.isBot, isLocal,
      team: this.team, hillScore: this.hillScore,
      // Read by bots; not required by the wire contract.
      canAct: this.canAct, jumpsLeft: this.jumpsLeft, isCharging: this.isCharging,
      charge: this.charge, mega: this.megaT > 0, bubble: this.bubbleT > 0,
      flail: this.swimFlail > 0, ragdoll: this.ragdolling,
      lastHitBy: this.lastHitBy, botTarget: this.botTarget || 0,
    };
  }

  /** Every field a restore needs that is not already in the physics world. */
  snapshot() {
    return {
      id: this.id, slot: this.slot, name: this.name, type: this.type, color: this.color,
      percent: this.percent, stocks: this.stocks, out: this.out, eliminated: this.eliminated,
      active: this.active, respawnTimer: this.respawnTimer, kos: this.kos, falls: this.falls,
      lastHitBy: this.lastHitBy, lastHitAt: this.lastHitAt, damageDealt: this.damageDealt || 0,
      hitstun: this.hitstun, ragdolling: this.ragdolling, invuln: this.invuln,
      ragdollTimer: this.ragdollTimer, techBuffer: this.techBuffer,
      attackCooldown: this.attackCooldown, isCharging: this.isCharging, charge: this.charge,
      attackBuffer: this.attackBuffer, throwCharging: this.throwCharging, throwCharge: this.throwCharge,
      swing: this.swing, diveTimer: this.diveTimer, diveCooldown: this.diveCooldown,
      held: this.held, heldKind: this.heldKind, grabbedBy: this.grabbedBy,
      escapeTimer: this.escapeTimer, diBudget: this.diBudget, landLagT: this.landLagT,
      airDodgeT: this.airDodgeT, airDodgeCd: this.airDodgeCd, specialFall: this.specialFall,
      jumpsLeft: this.jumpsLeft, grounded: this.grounded, groundY: this.groundY, yaw: this.yaw,
      swimFlail: this.swimFlail, flailUsed: this.flailUsed,
      megaT: this.megaT, zoomT: this.zoomT, bubbleT: this.bubbleT,
      style: this.style, styleTier: this.styleTier, styleTimer: this.styleTimer,
      stylePeak: this.stylePeak, team: this.team, hillScore: this.hillScore, lavaCd: this.lavaCd,
      lavaDips: this.lavaDips,
      superArmed: this.superArmed, prev: { ...this.prev },
      punchStreak: this.punchStreak, punchStreakT: this.punchStreakT,
      hazardCd: this.hazardCd, pitfall: this.pitfall,
      beltVX: this.beltVX, beltVZ: this.beltVZ,
    };
  }

  /** @param {ReturnType<SimDweeb['snapshot']>} s */
  restore(s) {
    Object.assign(this, s);
    this.prev = { ...s.prev };
    this._pos = [0, 0, 0];
    this._vel = [0, 0, 0];
    this.sync();
    this.physics.lockRotations(this.id, !this.ragdolling);
    return this;
  }
}

/** Coerce anything to a finite number: a NaN from a bad packet must never enter the sim. */
function num(v, dflt = 0) { return Number.isFinite(v) ? v : dflt; }

/** Style meter: hits build it, a tier-up emits an event, and it drains after `hold` seconds. */
function addStyle(d, api, amount) {
  const STYLE = BALANCE.style;
  d.style = Math.min(STYLE.max, d.style + amount);
  d.stylePeak = Math.max(d.stylePeak || 0, d.style);
  d.styleTimer = STYLE.hold;
  const tier = d.style >= STYLE.tiers[3] ? 3
    : d.style >= STYLE.tiers[2] ? 2
      : d.style >= STYLE.tiers[1] ? 1 : 0;
  if (tier > d.styleTier) {
    d.styleTier = tier;
    api?.emit?.('styleUp', { a: d.id, tier });
  }
}

/**
 * Super-smash meter: a punch landed within streakWindow of the previous one continues the
 * streak, and every level past the first banks streakBonus style. The clock is api.time
 * (tick / 60), so the streak is a pure function of the event order — deterministic.
 */
function streakPunch(d, api) {
  const S = BALANCE.style;
  const now = api?.time ?? -99;
  d.punchStreak = now - d.punchStreakT <= S.streakWindow
    ? Math.min(S.streakCap, d.punchStreak + 1)
    : 1;
  d.punchStreakT = now;
  if (d.punchStreak > 1) addStyle(d, api, S.streakBonus * (d.punchStreak - 1));
}

export { addStyle };
