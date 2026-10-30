// Bot.js — utility AI for knockout brawls.
// Priorities each frame: recover to the stage > dodge hazards > use held stuff > grab items/power-ups > brawl.
// Bots try to hit rivals *outward* (from the centre side) and throw grabbed Dweebs toward the nearest edge.

import * as THREE from 'three';
import { CORE_RADIUS } from '../world/Arena.js';

// Who's worth chasing: spikies fly far (glass cannons), blobs are a slog until they're high
const TYPE_BIAS = { spiky: 1, cube: 0, blob: -1 };

export const DIFFICULTY = {
  easy:   { reaction: 0.75, aggression: 0.4, recover: 0.55, dodge: 0.1, hazard: 0.35, edgeCare: 0.5, smash: 0.2, aim: 0.4, range: 7, di: 0.3, tech: 0.05, airDodge: 0.4 },
  normal: { reaction: 0.4,  aggression: 0.7, recover: 0.9,  dodge: 0.35, hazard: 0.7,  edgeCare: 0.85, smash: 0.45, aim: 0.2, range: 10, di: 0.7, tech: 0.3, airDodge: 0.85 },
  hard:   { reaction: 0.18, aggression: 0.9, recover: 1.0,  dodge: 0.7, hazard: 0.95, edgeCare: 1.0, smash: 0.7, aim: 0.08, range: 13, di: 1.0, tech: 0.75, airDodge: 1.0 },
};

const _v = new THREE.Vector3();

/**
 * Play styles. Each bot rolls one, so a lobby is a cast, not four copies of the same AI.
 * Weights nudge existing decisions; nothing here is a separate brain.
 *   target: score bonuses   grab/smash: in-range move mix   itemLove: prop hunger
 *   juggle: chase airborne victims   parry: read charges   keepAway: preferred gap with props
 */
export const ROLES = {
  bruiser:    { label: 'BRUISER',    grab: 0.35, smash: 1.2, itemLove: 0.6, juggle: 0.5, parry: 0.5, keepAway: 0,   target: { hurt: 1.4, leader: 0 } },
  zoner:      { label: 'ZONER',      grab: 0.1,  smash: 0.8, itemLove: 1.6, juggle: 0.2, parry: 0.8, keepAway: 5,   target: { hurt: 0.8, leader: 0.5 } },
  scavenger:  { label: 'SCAVENGER',  grab: 0.2,  smash: 0.9, itemLove: 1.2, juggle: 0.3, parry: 0.6, keepAway: 0,   target: { hurt: 1, leader: 0 }, powerups: 14 },
  instigator: { label: 'INSTIGATOR', grab: 0.3,  smash: 1.0, itemLove: 0.8, juggle: 0.9, parry: 0.4, keepAway: 0,   target: { hurt: 0.6, leader: 3 } },
  showoff:    { label: 'SHOW-OFF',   grab: 0.2,  smash: 1.4, itemLove: 0.7, juggle: 1.0, parry: 1.0, keepAway: 0,   target: { hurt: 1, leader: 1 } },
};
const ROLE_KEYS = Object.keys(ROLES);

export class Bot {
  constructor(dweeb, arena, combat, difficulty = 'normal') {
    this.dweeb = dweeb;
    this.arena = arena;
    this.combat = combat;
    this.setDifficulty(difficulty);

    this.target = null;
    this.goal = null;          // { type: 'item'|'powerup', ref }
    this.thinkTimer = Math.random() * 0.5;
    this.actionTimer = 0.5 + Math.random();
    this.chargeHold = 0;
    this.holdTimer = 0;
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = 0;
    this.jumpCd = 0;
    this.recoverJumpCd = 0;

    // Personality
    this.grudge = 0.5 + Math.random();
    this.itemLove = 0.3 + Math.random() * 0.7;
    this.playerBias = 0.8 + Math.random() * 0.8;
    this.roleKey = ROLE_KEYS[Math.floor(Math.random() * ROLE_KEYS.length)];
    this.role = ROLES[this.roleKey];
    this.itemLove = Math.min(1, this.itemLove * this.role.itemLove);
    dweeb.botRole = this.roleKey;
    // Grudge memory: who has been hurting me lately (decays), so bots hold a vendetta for a while
    this.threat = new Map();
    this._lastPercent = dweeb.percent || 0;
    this.juggleCd = 0;
    this.parryCd = 0;
    this.adapt = 1;
  }

  /** Rubber band: ease off a player who is getting crushed, sharpen up against one who is winning. */
  _adapt(dweebs) {
    const pl = dweebs.find(o => o.isPlayer);
    if (!pl) { this.adapt = 1; return; }
    const d = this.dweeb;
    const lead = ((d.stocks ?? 0) - (pl.stocks ?? 0)) * 60 + ((pl.percent ?? 0) - (d.percent ?? 0));
    const target = THREE.MathUtils.clamp(1 - lead / 400, 0.7, 1.25);
    this.adapt += (target - this.adapt) * 0.1;
  }

  setDifficulty(level) {
    this.level = level;
    this.p = DIFFICULTY[level] || DIFFICULTY.normal;
    this.dweeb.aimError = this.p.aim; // throw wobble (radians) — CombatSystem solves the arc, this spoils it
    this.dweeb.techChance = this.p.tech;
  }

  update(dt, dweebs) {
    const d = this.dweeb;
    d.moveInput.set(0, 0);
    if (!d.active) return;
    // Flailing at the waterline: better bots find the splash-jump sooner
    if (d.swimFlail > 0) {
      if (Math.random() < dt * (2 + this.p.tech * 10)) d.requestJump();
      return;
    }

    this.thinkTimer -= dt;
    this.actionTimer -= dt;
    this.juggleCd -= dt;
    this.parryCd -= dt;
    // Threat memory: damage taken is charged to whoever hit us, and fades over ~8s
    if (d.percent > this._lastPercent + 0.5 && d.lastHitBy && d.lastHitBy !== d) {
      this.threat.set(d.lastHitBy, (this.threat.get(d.lastHitBy) || 0) + (d.percent - this._lastPercent));
    }
    this._lastPercent = d.percent;
    for (const [k, v] of this.threat) { const nv = v * Math.exp(-dt / 8); if (nv < 0.5 || !k.active) this.threat.delete(k); else this.threat.set(k, nv); }
    this.jumpCd -= dt;
    this.recoverJumpCd -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafe = -this.strafe;
      this.strafeTimer = 1 + Math.random() * 2;
    }

    const pos = d.getPosition();
    const vel = d.velocity;
    // Fast-fall onto a rival below, but never straight off the lip while recovering.
    const below = this.target?.active && this.target.getPosition().y < pos.y - 1.2;
    d.fastFallInput = !d.grounded && vel.y < 0 && below && this.arena.isOverGround(pos.x, pos.z, 0.6) &&
      Math.random() < this.p.aggression;

    // Held by someone: wriggle!
    if (d.grabbedBy) {
      if (Math.random() < dt * 6 * (0.5 + this.p.aggression)) d.escapeTimer -= 0.06;
      return;
    }

    // ── Hanging off the lip: climb after a beat ──
    if (d.ledge) {
      if (d.ledge.t > 0.15 + this.p.reaction * 0.6 * Math.random()) d.requestJump();
      return;
    }

    // ── Launched: DI toward the middle (decided once per hit) ──
    if (d.lastHitTime !== this.diHitTime) {
      this.diHitTime = d.lastHitTime;
      this.diOn = Math.random() < this.p.di;
    }
    if ((d.hitstun > 0 || d.ragdolling) && this.diOn) this._steerTo(0, 0, 1);

    // ── Recovery: get back over solid ground ──
    const overGround = this.arena.isOverGround(pos.x, pos.z, 0.2);
    if (!overGround || pos.y < -0.8) {
      d.fastFallInput = false;
      this._steerTo(0, 0, 1);
      if (d.canAct && Math.random() < this.p.recover) {
        const r = Math.hypot(pos.x, pos.z);
        const edge = this.arena.edgeRadius(pos.x, pos.z);
        if (vel.y < 1 && this.recoverJumpCd <= 0 && d.jumpsLeft > 0 && !d.specialFall) {
          d.requestJump();
          this.recoverJumpCd = 0.35;
        } else if (d.jumpsLeft === 0 && vel.y < 0 && r - edge < 5 && pos.y > -2 && this.recoverJumpCd <= 0 &&
                   Math.random() < this.p.airDodge) {
          // Air-dodge back toward the stage (upward if we're low)
          this.combat.airDodge(d, -pos.x / (r || 1), -pos.z / (r || 1), pos.y < 0);
          this.recoverJumpCd = 0.35;
        }
      }
      if (d.isCharging) this.combat.releaseAttack(d);
      return;
    }

    if (!d.canAct) return;

    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.p.reaction * (0.6 + Math.random() * 0.8);
      this._think(dweebs, pos);
    }

    // ── Hazards ──
    if (this._avoidHazards(pos)) return;

    // ── Dodge a charging rival ──
    if (this._dodge(dweebs, pos)) return;

    // ── Holding something ──
    if (d.held) {
      this._useHeld(dt, pos);
      return;
    }

    // ── Go for an item or power-up ──
    if (this.goal) {
      const gp = this.goal.type === 'powerup' ? this.goal.ref.group.position : this.goal.ref.body && this.goal.ref.getPosition();
      if (!gp || (this.goal.type === 'item' && (this.goal.ref.isGrabbed || this.goal.ref.broken)) ||
          (this.goal.type === 'powerup' && !this.arena.powerups.includes(this.goal.ref))) {
        this.goal = null;
      } else {
        this._steerTo(gp.x, gp.z, 1);
        const dist = Math.hypot(gp.x - pos.x, gp.z - pos.z);
        if (this.goal.type === 'item' && dist < 1.6) {
          d.yaw = Math.atan2(gp.x - pos.x, gp.z - pos.z);
          this.combat.grab(d);
          this.goal = null;
        }
        this._edgeGuard(pos);
        return;
      }
    }

    // ── Brawl ──
    const t = this.target;
    if (!t || !t.active) {
      this._wander(pos);
      return;
    }
    this._brawl(dt, pos, t);
  }

  _think(dweebs, pos) {
    const d = this.dweeb;
    // Pick a target
    let best = null, bestScore = -Infinity;
    for (const o of dweebs) {
      if (o === d || !o.active) continue;
      const op = o.getPosition();
      const dist = Math.hypot(op.x - pos.x, op.z - pos.z);
      let score = -dist;
      score += o.percent * 0.03 * this.p.aggression;
      if (o === d.lastHitBy) score += 3 * this.grudge;
      score += Math.min(4, (this.threat.get(o) || 0) * 0.08) * this.grudge;
      score += o.percent * 0.015 * (this.role.target.hurt - 1);
      if (this.role.target.leader) score += ((o.kos ?? 0) * 0.8 + (o.stocks ?? 0) * 0.4) * this.role.target.leader;
      if (o.isPlayer) score += this.playerBias;
      score += (TYPE_BIAS[o.type] || 0) * (o.type === 'blob' && o.percent > 90 ? -1 : 1);
      // Spread out: fewer dogpiles, more free-for-all chaos
      for (const x of dweebs) if (x !== d && x.botTarget === o) score -= 2.5;
      if (Math.hypot(op.x, op.z) > this.arena.edgeRadius(op.x, op.z) - 3) score += 2;
      if (o === this.target) score += 1.5; // stickiness
      if (o.megaTimer > 0) score -= 3;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    this.target = best;
    d.botTarget = best;
    this._adapt(dweebs);

    // Power-ups and items nearby?
    if (!d.held && !this.goal) {
      for (const pu of this.arena.powerups) {
        const pp = pu.group.position;
        if (Math.hypot(pp.x - pos.x, pp.z - pos.z) < (this.role.powerups ?? 9) && this.arena.isOverGround(pp.x, pp.z, 0.8)) {
          this.goal = { type: 'powerup', ref: pu };
          return;
        }
      }
      if (Math.random() < this.itemLove * 0.5) {
        const near = this.arena.getObjectsNear(pos, 6).filter(({ obj }) => obj.def.grabbable && !obj.isGrabbed && !obj.thrownTime);
        const pick = near.find(n => n.obj.isWeapon) || near[0];
        if (pick) {
          const op = pick.obj.getPosition();
          if (this.arena.isOverGround(op.x, op.z, 0.8)) this.goal = { type: 'item', ref: pick.obj };
        }
      }
    }
  }

  _brawl(dt, pos, t) {
    const d = this.dweeb;
    const tp = t.getPosition();
    const dx = tp.x - pos.x, dz = tp.z - pos.z;
    const dist = Math.hypot(dx, dz);

    // Approach from the centre side so hits send them outward
    const tr = Math.hypot(tp.x, tp.z) || 1;
    const ax = tp.x - (tp.x / tr) * 1.1;
    const az = tp.z - (tp.z / tr) * 1.1;

    if (d.isCharging) {
      d.yaw = Math.atan2(dx, dz);
      this.chargeHold -= dt;
      if (this.chargeHold <= 0 || dist > 2.4) this.combat.releaseAttack(d);
      else if (dist > 1.2) this._steerTo(tp.x, tp.z, 0.6);
      return;
    }

    // Juggle: they're up in the air above us after a hit — chase under them, hop and dropkick
    if (!t.grounded && (t.hitstun > 0 || t.ragdolling) && dist < 4 && tp.y - pos.y > 0.6 && tp.y - pos.y < 4 &&
        this.juggleCd <= 0 && Math.random() < this.role.juggle * this.p.aggression * this.adapt) {
      this._steerTo(tp.x + t.velocity.x * 0.3, tp.z + t.velocity.z * 0.3, 1);
      if (d.grounded && this.jumpCd <= 0) { d.requestJump(); this.jumpCd = 0.35; }
      else if (!d.grounded && Math.abs(tp.y - pos.y) < 1.2 && dist < 2.2) {
        d.yaw = Math.atan2(dx, dz);
        if (this.combat.airKick(d)) this.juggleCd = 1.6;
      }
      return;
    }

    if (dist > 1.35) {
      if (dist > 3) this._steerTo(ax, az, 1);
      else this._steerTo(tp.x, tp.z, 1);
      // Occasionally dive-tackle from mid range
      if (dist > 2.6 && dist < 4.5 && this.actionTimer <= 0 && Math.random() < 0.02 * this.p.aggression * 60 * dt) {
        d.yaw = Math.atan2(dx, dz);
        if (this._safeToLunge(pos, dx / dist, dz / dist, 5)) this.combat.dive(d);
        this.actionTimer = 1.2;
      }
      // Hop over the spinner / onto platforms when the target is up high
      if (tp.y - pos.y > 1.5 && d.grounded && this.jumpCd <= 0) {
        d.requestJump();
        this.jumpCd = 0.5;
      } else if (tp.y - pos.y > 1.5 && !d.grounded && d.velocity.y < 1 && d.jumpsLeft > 0 && this.jumpCd <= 0) {
        d.requestJump();
        this.jumpCd = 0.5;
      }
    } else {
      // In range: circle a little and attack
      const px = -dz / (dist || 1), pz = dx / (dist || 1);
      d.moveInput.set(px * 0.35 * this.strafe, pz * 0.35 * this.strafe);
      if (this.actionTimer <= 0 && d.attackCooldown <= 0) {
        d.yaw = Math.atan2(dx, dz);
        const roll = Math.random();
        const smashChance = this.p.smash * this.role.smash * (t.percent > 60 ? 1.4 : 0.6);
        const grabChance = this.role.grab * (Math.hypot(tp.x, tp.z) > this.arena.edgeRadius(tp.x, tp.z) - 4 ? 1.6 : 1);
        if (roll < grabChance && !t.bubble) {
          this.combat.grab(d);
          this.holdTimer = 0.25 + Math.random() * 0.4;
        } else if (roll < grabChance + smashChance * 0.6) {
          if (this.combat.startCharge(d)) this.chargeHold = 0.25 + Math.random() * 0.5;
        } else {
          if (this.combat.startCharge(d)) this.combat.releaseAttack(d);
        }
        this.actionTimer = (0.25 + Math.random() * 0.5) / ((0.5 + this.p.aggression) * this.adapt);
      }
    }
    this._edgeGuard(pos);
  }

  _useHeld(dt, pos) {
    const d = this.dweeb;
    const held = d.held;
    this.holdTimer -= dt;

    if (held.kind === 'dweeb') {
      // Walk them toward the nearest edge a bit, then chuck them off
      const r = Math.hypot(pos.x, pos.z) || 1;
      const ox = pos.x / r, oz = pos.z / r;
      d.yaw = Math.atan2(ox, oz);
      d.aimYaw = d.yaw;
      if (r < this.arena.edgeRadius(pos.x, pos.z) - 4) this._steerTo(pos.x + ox * 3, pos.z + oz * 3, 0.8);
      if (this.holdTimer <= 0) {
        d.aimYaw = null;
        this.combat.throwHeld(d, Math.min(1, 0.4 + Math.random() * 0.6 * this.p.aggression));
      }
      return;
    }

    const t = this.target;
    if (!t || !t.active) {
      this._wander(pos);
      if (this.holdTimer < -6) this.combat.drop(d);
      return;
    }
    const tp = t.getPosition();
    const dx = tp.x - pos.x, dz = tp.z - pos.z;
    const dist = Math.hypot(dx, dz);

    if (held.ref.isWeapon) {
      if (d.isCharging) {
        d.yaw = Math.atan2(dx, dz);
        this.chargeHold -= dt;
        if (this.chargeHold <= 0 || dist > (held.ref.def.weapon === 'anvil' ? 1.6 : 2.8)) this.combat.releaseAttack(d);
        return;
      }
      const reach = held.ref.def.weapon === 'anvil' ? 1.1 : 2.0;
      if (dist > reach) this._steerTo(tp.x, tp.z, 1);
      else if (this.actionTimer <= 0 && d.attackCooldown <= 0) {
        d.yaw = Math.atan2(dx, dz);
        if (this.combat.startCharge(d)) this.chargeHold = Math.random() < this.p.smash ? 0.5 : 0.05;
        this.actionTimer = 0.5;
      }
      this._edgeGuard(pos);
      return;
    }

    // Throwable: get within range, face them, lob it (CombatSystem solves the arc)
    const range = this.p.range;
    const gap = Math.max(2, this.role.keepAway);
    if (dist > range - 1) this._steerTo(tp.x, tp.z, 1);
    else if (dist < gap) this._steerTo(pos.x - dx, pos.z - dz, 0.7);
    if (dist < range && this.actionTimer <= 0) {
      d.yaw = Math.atan2(dx, dz);
      this.combat.throwHeld(d, Math.min(1, dist / 12 + Math.random() * 0.3));
      this.actionTimer = 0.8;
    }
    this._edgeGuard(pos);
  }

  _avoidHazards(pos) {
    const d = this.dweeb;
    if (!d.grounded || Math.random() > this.p.hazard) return false;

    for (const s of this.arena.spinners) {
      const c = Math.cos(s.angle), sn = Math.sin(s.angle);
      const lx = pos.x * c - pos.z * sn;
      const lz = pos.x * sn + pos.z * c;
      // Hop when the sweeping bar is about to reach us
      if (Math.abs(lx) < s.half + 0.3 && Math.abs(lz) < 1.1 && this.jumpCd <= 0) {
        d.requestJump();
        this.jumpCd = 0.6;
        return false;
      }
    }
    for (const pend of this.arena.pendulums) {
      const dx = pos.x - pend.pos.x, dz = pos.z - pend.pos.z;
      if (Math.hypot(dx, dz) < 3.2 && pend.pos.y < 3) {
        d.moveInput.set(Math.sign(dx || 1), 0);
        return true;
      }
    }
    // Bumpers fling you outward: slide around them rather than into them
    for (const b of this.arena.bumpers) {
      const dx = pos.x - b.x, dz = pos.z - b.z;
      const v = d.velocity;
      if (Math.hypot(dx, dz) < 1.8 && v.x * dx + v.z * dz < 0) {
        const side = Math.sign(v.z * dx - v.x * dz) || 1;
        d.moveInput.set(-dz * side, dx * side).normalize();
        return true;
      }
    }
    return false;
  }

  _dodge(dweebs, pos) {
    const d = this.dweeb;
    for (const o of dweebs) {
      if (o === d || !o.active || !o.isCharging || o.charging < 0.3) continue;
      const op = o.getPosition();
      const dx = pos.x - op.x, dz = pos.z - op.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.6) continue;
      const f = o.forward;
      if ((dx * f.x + dz * f.z) / dist < 0.5) continue;
      // Read the wind-up: parry a charged swing that's about to land (better bots, cheeky roles)
      if (dist < 1.9 && o.charging > 0.55 && this.parryCd <= 0 && Math.random() < this.p.dodge * this.role.parry * 0.25) {
        this.parryCd = 1.5;
        d.yaw = Math.atan2(-dx, -dz);
        if (this.combat.startParry(d)) return true;
      }
      if (Math.random() < this.p.dodge * 0.15) {
        // Sidestep toward the centre
        const px = -f.z, pz = f.x;
        const side = (px * -pos.x + pz * -pos.z) > 0 ? 1 : -1;
        d.moveInput.set(px * side, pz * side);
        if (Math.random() < 0.3 && this.jumpCd <= 0) { d.requestJump(); this.jumpCd = 0.6; }
        return true;
      }
    }
    return false;
  }

  _wander(pos) {
    if (!this.wanderPoint || Math.hypot(this.wanderPoint.x - pos.x, this.wanderPoint.z - pos.z) < 1) {
      this.wanderPoint = this.arena.randomGroundPoint(CORE_RADIUS - 3);
    }
    this._steerTo(this.wanderPoint.x, this.wanderPoint.z, 0.6);
    this._edgeGuard(pos);
  }

  _steerTo(x, z, speed) {
    const d = this.dweeb;
    const pos = d.getPosition();
    _v.set(x - pos.x, 0, z - pos.z);
    const len = _v.length();
    if (len < 0.2) return;
    _v.divideScalar(len);
    d.moveInput.set(_v.x * speed, _v.z * speed);
  }

  /** Stop walking off the edge unless we mean to. */
  _edgeGuard(pos) {
    const d = this.dweeb;
    if (Math.random() > this.p.edgeCare) return;
    const mx = d.moveInput.x, mz = d.moveInput.y;
    if (mx === 0 && mz === 0) return;
    const ahead = 1.3 + Math.hypot(d.velocity.x, d.velocity.z) * 0.15;
    const fx = pos.x + mx * ahead, fz = pos.z + mz * ahead;
    const onPlatform = pos.y > 2;
    if (onPlatform || this.arena.isOverGround(fx, fz, 0.3)) return;
    // Remove the outward component of movement
    const r = Math.hypot(pos.x, pos.z) || 1;
    const ox = pos.x / r, oz = pos.z / r;
    const out = mx * ox + mz * oz;
    if (out > 0) d.moveInput.set(mx - ox * out * 1.6, mz - oz * out * 1.6);
  }

  _safeToLunge(pos, dx, dz, dist) {
    return this.arena.isOverGround(pos.x + dx * dist, pos.z + dz * dist, 0.5);
  }
}
