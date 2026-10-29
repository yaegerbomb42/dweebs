// src/sim/bot.js — bots as pure input producers.
//
// ROLE CARD 1 item 4: `Bot.think(simState) → InputFrame`. That signature is the point: it lets a
// server fill empty slots with bots indistinguishable from humans at the protocol level. The live
// Bot.js cannot be reused as-is for three reasons, all of which this file is the answer to:
//
//   1. It mutates the Dweeb directly (`d.requestJump()`, `d.moveInput.set()`, `d.yaw = …`). A
//      server bot would be writing into state it is supposed to only observe.
//   2. It holds references to Arena and CombatSystem — both of which reach three.js.
//   3. It calls Math.random() ~20 times a second, which is a desync every time.
//
// So this is a rewrite in intent, not a port. The priorities are preserved exactly (recover to
// the stage > dodge hazards > dodge rivals > use what you hold > grab things > brawl), the
// DIFFICULTY table is unchanged, and behaviour is driven entirely by a read-only view of sim
// state plus a seeded Rng. If the Lead retunes the table, change it here in step.

import { NEUTRAL_INPUT, TICK_HZ } from './contracts.js';

/** Difficulty tuning. Same numbers and meanings as the live src/ai/Bot.js table. */
export const DIFFICULTY = {
  easy:   { reaction: 0.75, aggression: 0.4, recover: 0.55, dodge: 0.1, hazard: 0.35, edgeCare: 0.5, smash: 0.2, aim: 0.4, range: 7, di: 0.3, tech: 0.05, airDodge: 0.4 },
  normal: { reaction: 0.4, aggression: 0.7, recover: 0.9, dodge: 0.35, hazard: 0.7, edgeCare: 0.85, smash: 0.45, aim: 0.2, range: 10, di: 0.7, tech: 0.3, airDodge: 0.85 },
  hard:   { reaction: 0.18, aggression: 0.9, recover: 1.0, dodge: 0.7, hazard: 0.95, edgeCare: 1.0, smash: 0.7, aim: 0.08, range: 13, di: 1.0, tech: 0.75, airDodge: 1.0 },
};

// Who's worth chasing: spikies fly far (glass cannons), blobs are a slog until they're high.
const TYPE_BIAS = { spiky: 1, cube: 0, blob: -1 };

const yawTo = (dx, dz) => Math.atan2(dx, dz);
const secs = t => Math.max(1, Math.round(t * TICK_HZ));

/**
 * A bot brain. It owns no world state: everything it decides from is in the SimState handed to
 * `think`, and the only things it carries between ticks are its own timers, cooldowns and
 * personality numbers — all part of the sim snapshot, so a restored bot resumes exactly where it
 * was instead of re-rolling its luck.
 */
export class Bot {
  /**
   * @param {object} opts
   * @param {number} opts.slot
   * @param {string} [opts.difficulty]
   * @param {import('./rng.js').Rng} opts.rng Required — there is no Math.random() in this file.
   */
  constructor({ slot = 0, difficulty = 'normal', rng }) {
    this.slot = slot;
    this.level = difficulty;
    this.p = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.rng = rng;
    // Personalities drawn once from the seeded stream, so they survive a restore.
    this.grudge = 0.5 + rng.next();
    this.itemLove = 0.3 + rng.next() * 0.7;
    this.playerBias = 0.8 + rng.next() * 0.8;
    this.strafe = rng.chance(0.5) ? -1 : 1;
    this.strafeTimer = secs(rng.range(1, 3));
    this.target = -1;
    this.actionTimer = secs(rng.range(0, 0.5));
    this.jumpCd = 0;
    this.recoverJumpCd = 0;
    this.chargeTicks = 0;   // how long the current attack hold runs, in ticks
    this.holdTicks = 0;     // how long we have been carrying something
    this.wander = null;
    this.groundRadius = 16;      // set each tick from SimState; the sim owns the real stage shape
    this.pos = [0, 0, 0];   // scratch, so _steerTo does not need a parameter
  }

  /**
   * Produce this tick's input frame. Pure with respect to `state`: it reads the state, draws from
   * the seeded RNG, and returns a frame. It never writes to the state object.
   *
   * @param {import('./contracts.js').SimState} state
   * @returns {import('./contracts.js').InputFrame}
   */
  think(state) {
    const f = { ...NEUTRAL_INPUT, player: this.slot, tick: state.tick };
    const me = state.dweebs[this.slot];
    if (!me || !me.active) return f;

    const r = this.rng;
    const pos = this.pos = me.pos;
    const vel = me.vel;
    const radius = Math.hypot(pos[0], pos[2]) || 1;
    // The sim is the authority on where the floor is: the bot never assumes a radius of its own.
    this.groundRadius = state.groundRadius;
    const overGround = radius < state.groundRadius;

    // ── Priority 1: do not die. Off the island, go home. ──
    if (!overGround || pos[1] < -0.8) {
      this._steerTo(f, 0, 0, 1);
      // The flail's one splash-jump needs no jumps left — but it needs a deliberate press
      // inside the 0.6 s window, so take it on purpose instead of hoping the recover roll
      // below happens to fire. Not gated on canAct: the sim's flail branch honors the jump
      // edge even in hitstun, which is exactly when dweebs usually start flailing.
      // Difficulty still gates it: easy bots fumble the timing.
      if (me.flail && this.recoverJumpCd <= 0 && r.chance(this.p.recover)) {
        f.jump = true;
        this.recoverJumpCd = secs(0.35);
        return f;
      }      if (me.canAct && r.chance(this.p.recover)) {
        if (vel[1] < 1 && me.jumpsLeft > 0 && this.recoverJumpCd <= 0) {
          f.jump = true;
          this.recoverJumpCd = secs(0.35);
        } else if (me.jumpsLeft === 0 && vel[1] < 0 && this.recoverJumpCd <= 0 && r.chance(this.p.airDodge)) {
          f.dodge = true;                       // air-dodge back toward the stage
          this.recoverJumpCd = secs(0.35);
        }
      }
      return f;
    }

    // Tech the landing: tumbling over the stage and about to hit the floor — dodge at the
    // last moment, difficulty-gated like the live bot's techChance. Never off-stage: a tech
    // zeroes velocity, and off the island that means dropping straight into the lagoon.
    if (me.ragdoll && overGround && !me.grounded && vel[1] < -2) {
      const tti = pos[1] / Math.max(1, -vel[1]); // seconds to impact, roughly
      if (tti < 0.12 && r.chance(this.p.tech)) {
        f.dodge = true;
        return f;
      }
    }

    if (!me.canAct) return f;   // hitstun, grabbed or KO'd: no agency

    this._tickTimers();
    if (this.chargeTicks > 0) this.chargeTicks--;

    if (this._dodgeHazard(f, state)) return f;         // priority 2
    if (this._dodgeRival(f, state, pos)) return f;     // priority 3
    if (me.held) { this._useHeld(f, state, me, pos); return f; }   // priority 4
    if (this._goFetch(f, state, pos)) return f;        // priority 5
    this._brawl(f, state, me, pos);                    // priority 6
    return f;
  }

  _tickTimers() {
    this.actionTimer--;
    this.jumpCd--;
    this.recoverJumpCd--;
    this.strafeTimer--;
    if (this.strafeTimer <= 0) {
      this.strafe = -this.strafe;
      this.strafeTimer = secs(this.rng.range(1, 3));
    }
  }

  _steerTo(f, x, z, speed = 1) {
    const p = this.pos;
    const dx = x - p[0], dz = z - p[2];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.2) return;
    f.moveX = (dx / len) * speed;
    f.moveZ = (dz / len) * speed;
  }

  /** Hop away from a spinner sweep, or sidestep a pendulum about to land on us. */
  _dodgeHazard(f, state) {
    if (!this.rng.chance(this.p.hazard)) return false;
    for (const h of state.hazards || []) {
      const dx = this.pos[0] - h.x, dz = this.pos[2] - h.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > (h.dangerR || 3.2) ** 2) continue;
      if (h.kind === 'pendulum') { this._steerTo(f, h.x + dx, h.z + dz, 1); return true; }
      if (this.jumpCd <= 0) { f.jump = true; this.jumpCd = secs(0.6); return true; }
    }
    return false;
  }

  /** Sidestep a rival who is winding up at us. */
  _dodgeRival(f, state, pos) {
    for (const o of state.dweebs) {
      if (o.slot === this.slot || !o.active || !o.isCharging || o.charge < 0.3) continue;
      const dx = pos[0] - o.pos[0], dz = pos[2] - o.pos[2];
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      if (dist > 2.6) continue;
      // Only dodges attacks pointed at us: dot(away, their facing) > 0.5.
      const fx = Math.sin(o.yaw), fz = Math.cos(o.yaw);
      if ((dx * fx + dz * fz) / dist < 0.5) continue;
      if (this.rng.chance(this.p.dodge * 0.15)) {
        // Perpendicular, toward the middle of the stage.
        const px = -fz, pz = fx;
        const side = (px * -pos[0] + pz * -pos[2]) > 0 ? 1 : -1;
        f.moveX = px * side;
        f.moveZ = pz * side;
        if (this.rng.chance(0.3) && this.jumpCd <= 0) { f.jump = true; this.jumpCd = secs(0.6); }
        return true;
      }
    }
    return false;
  }

  _pickTarget(state) {
    const pos = this.pos;
    let best = -1, bestScore = -Infinity;
    for (const o of state.dweebs) {
      if (o.slot === this.slot || !o.active) continue;
      const dx = o.pos[0] - pos[0], dz = o.pos[2] - pos[2];
      let score = -Math.sqrt(dx * dx + dz * dz);
      score += o.percent * 0.03 * this.p.aggression;
      score += (TYPE_BIAS[o.type] || 0) * (o.type === 'blob' && o.percent > 90 ? -1 : 1);
      if (o.slot === this._lastHitBy) score += 3 * this.grudge;
      if (!o.isBot) score += this.playerBias;
      if (Math.hypot(o.pos[0], o.pos[2]) > state.stageRadius - 3) score += 2;  // finish them at the lip
      if (o.slot === this.target) score += 1.5;                                // stickiness
      if (o.mega) score -= 3;
      // Spread out: penalise a target another bot already picked, so it stays a free-for-all.
      for (const x of state.dweebs) if (x.slot !== this.slot && x.botTarget === o.slot) score -= 2.5;
      if (score > bestScore) { bestScore = score; best = o.slot; }
    }
    this.target = best;
    return best;
  }

  _goFetch(f, state, pos) {
    if (this.actionTimer > 0) return false;
    let best = -1, bestScore = Infinity;
    for (const it of state.items) {
      if (!it.active || it.heldBy || !it.grabbable) continue;
      const dx = it.pos[0] - pos[0], dz = it.pos[2] - pos[2];
      const d = Math.sqrt(dx * dx + dz * dz);
      const score = it.weapon ? d - 6 : d;   // bots really want the hammers
      if (score < bestScore) { bestScore = score; best = it.id; }
    }
    if (best < 0 || bestScore > 9 || !this.rng.chance(this.itemLove * 0.5)) return false;
    const it = state.items.find(i => i.id === best);
    if (!it) return false;
    this._steerTo(f, it.pos[0], it.pos[2], 1);
    if (bestScore < 1.6) { f.aimYaw = yawTo(it.pos[0] - pos[0], it.pos[2] - pos[2]); f.grab = true; }
    this._edgeGuard(f, pos);
    return true;
  }

  _brawl(f, state, me, pos) {
    if (this.target < 0 || !state.dweebs[this.target]?.active) this._pickTarget(state);
    const t = state.dweebs[this.target];
    if (!t) { this._wander(f, state, pos); return; }
    const dx = t.pos[0] - pos[0], dz = t.pos[2] - pos[2];
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const yaw = yawTo(dx, dz);
    const r = this.rng;
    me.botTarget = this.target;

    if (dist > 1.35) {
      this._steerTo(f, t.pos[0], t.pos[2], dist > 3 ? 1 : 0.6);
      // Dive-tackle from mid range.
      if (dist > 2.6 && dist < 4.5 && this.actionTimer <= 0 && r.chance(0.02 * this.p.aggression)) {
        f.aimYaw = yaw;
        f.dodge = true;
        this.actionTimer = secs(1.2);
      }
      // Hop up to a target on a platform, or to reach one above us.
      const climb = t.pos[1] - pos[1] > 1.5;
      if (climb && this.jumpCd <= 0 && (me.grounded || (me.vel[1] < 1 && me.jumpsLeft > 0))) {
        f.jump = true;
        this.jumpCd = secs(0.5);
      }
    } else {
      // In range: circle a little, then attack.
      f.moveX = (-dz / dist) * 0.35 * this.strafe;
      f.moveZ = (dx / dist) * 0.35 * this.strafe;
      if (this.actionTimer <= 0) {
        f.aimYaw = yaw;
        const roll = r.next();
        const smashChance = this.p.smash * (t.percent > 60 ? 1.4 : 0.6);
        if (roll < 0.2 && !t.bubble) {
          f.grab = true;                                   // grab; the throw comes next tick
          this.chargeTicks = secs(0.25);
        } else if (roll < 0.2 + smashChance * 0.6) {
          f.attack = true;                                 // hold to charge, released below
          this.chargeTicks = secs(r.range(0.25, 0.75));
        } else {
          f.attack = true;                                 // jab: one tick, released next tick
          this.chargeTicks = 1;
        }
        this.actionTimer = secs(r.range(0.25, 0.75) / (0.5 + this.p.aggression));
      }
      // Release a held charge. The sim turns a falling `attack` edge into the release, so the
      // bot only has to stop holding — it never calls the combat system.
      if (this.chargeTicks === 0 && me.isCharging) f.attack = false;
    }
    this._edgeGuard(f, pos);
  }

  _useHeld(f, state, me, pos) {
    this.holdTicks++;
    const t = state.dweebs[this.target];
    if (!t || !t.active) {
      this._wander(f, state, pos);
      if (this.holdTicks > secs(6)) f.drop = true;   // carrying junk too long: put it down
      return;
    }
    const dx = t.pos[0] - pos[0], dz = t.pos[2] - pos[2];
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const r = this.rng;
    const item = state.items.find(i => i.id === me.held);
    const weapon = item?.weapon;

    if (weapon) {
      const reach = weapon === 'anvil' ? 1.1 : 2.0;
      if (dist > reach) this._steerTo(f, t.pos[0], t.pos[2], 1);
      else if (this.actionTimer <= 0) {
        f.aimYaw = yawTo(dx, dz);
        f.attack = true;
        this.chargeTicks = r.chance(this.p.smash) ? secs(0.5) : 3;
        this.actionTimer = secs(0.5);
      }
    } else {
      // Throwable: close to throw range, back off if hugging them, then lob.
      const range = this.p.range;
      if (dist > range - 1) this._steerTo(f, t.pos[0], t.pos[2], 1);
      else if (dist < 2) this._steerTo(f, pos[0] - dx, pos[2] - dz, 0.7);
      if (dist < range && this.actionTimer <= 0) {
        f.aimYaw = yawTo(dx, dz);
        f.grab = true;                      // release = throw
        f.charge = Math.min(1, dist / 12 + r.next() * 0.3);
        this.actionTimer = secs(0.8);
      }
    }
    this._edgeGuard(f, pos);
  }

  _wander(f, state, pos) {
    if (!this.wander || Math.hypot(this.wander[0] - pos[0], this.wander[1] - pos[2]) < 1) {
      const dir = r_dir(this.rng);
      const m = this.rng.range(0, Math.max(0, state.stageRadius - 3));
      this.wander = [dir.x * m, dir.z * m];
    }
    this._steerTo(f, this.wander[0], this.wander[1], 0.6);
    this._edgeGuard(f, pos);
  }

  /** Never walk off the lip unless we meant to: strip the outward component of the movement. */
  _edgeGuard(f, pos) {
    if (!this.rng.chance(this.p.edgeCare)) return;
    if (f.moveX === 0 && f.moveZ === 0) return;
    const speed = Math.hypot(f.moveX, f.moveZ) || 1;
    const ahead = 1.3 + speed * 0.15;
    if (pos[1] > 2) return;                                   // on a platform: no guard
    if (Math.hypot(pos[0] + f.moveX * ahead, pos[2] + f.moveZ * ahead) < this._groundAt(f)) return;
    const r = Math.hypot(pos[0], pos[2]) || 1;
    const ox = pos[0] / r, oz = pos[2] / r;
    const out = (f.moveX * ox + f.moveZ * oz) / speed;
    if (out > 0) { f.moveX -= ox * out * speed * 1.6; f.moveZ -= oz * out * speed * 1.6; }
  }

  _groundAt() { return this.groundRadius; }

  /**
   * Persist the brain's own state. Part of the sim snapshot, so a bot survives a restore with
   * the same target, the same cooldowns and the same personality.
   */
  snapshot() {
    return {
      slot: this.slot, level: this.level, target: this.target, grudge: this.grudge,
      itemLove: this.itemLove, playerBias: this.playerBias, strafe: this.strafe,
      strafeTimer: this.strafeTimer, actionTimer: this.actionTimer, jumpCd: this.jumpCd,
      recoverJumpCd: this.recoverJumpCd, chargeTicks: this.chargeTicks, holdTicks: this.holdTicks,
      wander: this.wander,
    };
  }

  /** @param {ReturnType<Bot['snapshot']>} s */
  restore(s) { Object.assign(this, s); return this; }
}

const r_dir = rng => rng.floorDir();
