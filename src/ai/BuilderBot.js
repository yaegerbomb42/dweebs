// BuilderBot.js — Autonomous AI Combat Controller for Build-A-Dweeb
//
// Translates a custom creature's Combat DNA traits:
//   - confidence: 0.0 (evasive kiter) to 1.0 (berserk rushdown)
//   - aimAccuracy: 0.0 (rapid-fire chaotic spam) to 1.0 (deadly calculated sniper)
//   - scavenge: 0.0 (fists only) to 1.0 (aggressive item hunter)
//   - agility: 0.0 (grounded tank) to 1.0 (hyper-mobile acrobat)
// into real-time physics movement, attack charges, throws, and edge recoveries.

import { CORE_RADIUS } from '../world/Arena.js';

export class BuilderBot {
  constructor(dweeb, arena, combat, dna = {}) {
    this.dweeb = dweeb;
    this.arena = arena;
    this.combat = combat;
    this.dna = {
      confidence: dna.confidence ?? 0.8,
      aimAccuracy: dna.aimAccuracy ?? 0.7,
      scavenge: dna.scavenge ?? 0.6,
      agility: dna.agility ?? 0.7,
    };

    // Apply DNA to Dweeb physical modifiers
    this.dweeb.aimError = (1 - this.dna.aimAccuracy) * 0.45;
    this.dweeb.techChance = 0.3 + this.dna.agility * 0.6;

    this.target = null;
    this.thinkTimer = Math.random() * 0.3;
    this.actionTimer = 0.3 + Math.random() * 0.4;
    this.chargeHold = 0;
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = 1.0;
    this.jumpCd = 0;
    this.recoverJumpCd = 0;
    this.rageMode = false;
  }

  update(dt, rivals = []) {
    const d = this.dweeb;
    d.moveInput.set(0, 0);
    if (!d.active || d.eliminated) return;

    // Splash-jump recovery if in lagoon
    if (d.swimFlail > 0) {
      if (Math.random() < dt * (4 + this.dna.agility * 8)) d.requestJump();
      return;
    }

    this.thinkTimer -= dt;
    this.actionTimer -= dt;
    this.jumpCd -= dt;
    this.recoverJumpCd -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafe = -this.strafe;
      this.strafeTimer = 0.8 + Math.random() * 1.5;
    }

    const pos = d.getPosition();

    // 1. Critical Priority: Recover to Stage if over the void
    const r = Math.hypot(pos.x, pos.z);
    if (r > CORE_RADIUS * 0.95 || pos.y < 0.2) {
      this._recover(pos);
      return;
    }

    // 2. Target Acquisition: Find nearest active opponent
    if (this.thinkTimer <= 0 || !this.target || !this.target.active || this.target.eliminated) {
      this.thinkTimer = 0.2 + (1 - this.dna.aimAccuracy) * 0.3;
      this._pickTarget(rivals, pos);
    }

    if (!this.target) return;
    const tPos = this.target.getPosition();
    const dist = Math.hypot(tPos.x - pos.x, tPos.z - pos.z);

    // 3. Held Item Behavior
    if (d.held) {
      this._useHeldItem(dist, pos, tPos);
      return;
    }

    // 4. Scavenging: If item love is high and a toy/bomb is nearby
    if (this.dna.scavenge > 0.4 && dist > 3.5 && this.arena?.items?.length) {
      const nearestItem = this._findNearbyItem(pos);
      if (nearestItem) {
        this._approach(pos, nearestItem.position, 1.0);
        if (Math.hypot(nearestItem.position.x - pos.x, nearestItem.position.z - pos.z) < 1.4) {
          this.combat.grab(d);
        }
        return;
      }
    }

    // 5. Combat Movement & Attack
    this._brawl(dt, pos, tPos, dist);
  }

  _pickTarget(rivals, myPos) {
    let best = null;
    let bestDist = Infinity;
    for (const r of rivals) {
      if (r === this.dweeb || !r.active || r.eliminated) continue;
      const rp = r.getPosition();
      const d = Math.hypot(rp.x - myPos.x, rp.z - myPos.z);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    this.target = best;
  }

  _recover(pos) {
    const d = this.dweeb;
    // Aim strictly toward stage center (0, 0)
    const len = Math.hypot(pos.x, pos.z) || 1;
    d.moveInput.set(-pos.x / len, -pos.z / len);
    if (this.recoverJumpCd <= 0 && pos.y < 2.5) {
      d.requestJump();
      this.recoverJumpCd = 0.45 - this.dna.agility * 0.15;
    }
  }

  _findNearbyItem(myPos) {
    if (!this.arena || !this.arena.items) return null;
    let closest = null;
    let minDist = 14 * this.dna.scavenge;
    for (const it of this.arena.items) {
      if (!it || it.held || !it.mesh) continue;
      const d = Math.hypot(it.mesh.position.x - myPos.x, it.mesh.position.z - myPos.z);
      if (d < minDist) {
        minDist = d;
        closest = { item: it, position: it.mesh.position };
      }
    }
    return closest;
  }

  _approach(fromPos, toPos, speedMul = 1.0) {
    const dx = toPos.x - fromPos.x;
    const dz = toPos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.dweeb.moveInput.set((dx / len) * speedMul, (dz / len) * speedMul);
  }

  _useHeldItem(dist, myPos, tPos) {
    const d = this.dweeb;
    // Aim at target
    const dx = tPos.x - myPos.x;
    const dz = tPos.z - myPos.z;
    d.yaw = Math.atan2(dx, dz);

    // High accuracy waits until aligned and in ideal throw range
    const idealDist = this.dna.aimAccuracy > 0.6 ? 6 : 4;
    if (dist <= idealDist || this.actionTimer <= 0) {
      this.actionTimer = 0.4;
      this.combat.throwHeld(d, Math.min(1, dist / 12 + Math.random() * 0.3));
    } else {
      // Approach to range
      this._approach(myPos, tPos, 0.85);
    }
  }

  _brawl(dt, myPos, tPos, dist) {
    const d = this.dweeb;
    const conf = this.dna.confidence;
    const aim = this.dna.aimAccuracy;

    // High confidence rushdown vs low confidence kiting
    if (conf > 0.65) {
      // Berserk rushdown: advance right into punching distance
      this._approach(myPos, tPos, 1.0);
      if (this.jumpCd <= 0 && dist < 3.2 && Math.random() < this.dna.agility * 0.4) {
        d.requestJump();
        this.jumpCd = 1.0 - this.dna.agility * 0.4;
      }
    } else if (conf < 0.4) {
      // Kiting / Counter-striker: keep a safe buffer, circle around
      if (dist < 4.0) {
        // Back pedal!
        const dx = myPos.x - tPos.x;
        const dz = myPos.z - tPos.z;
        const len = Math.hypot(dx, dz) || 1;
        d.moveInput.set((dx / len) * 0.9, (dz / len) * 0.9);
      } else {
        // Circle strafe
        const dx = tPos.x - myPos.x;
        const dz = tPos.z - myPos.z;
        const len = Math.hypot(dx, dz) || 1;
        d.moveInput.set(-dz / len * this.strafe, dx / len * this.strafe);
      }
    } else {
      // Balanced brawler
      this._approach(myPos, tPos, 0.85);
    }

    // Attack Logic
    if (dist < 2.8) {
      if (aim > 0.6) {
        // Calculated Precision: Charge up a heavy smash!
        if (d.charging <= 0 && this.actionTimer <= 0) {
          this.combat.startCharge(d);
          this.chargeHold = 0.35 + (aim * 0.4);
          this.actionTimer = 0.8;
        } else if (d.charging > 0) {
          this.chargeHold -= dt;
          if (this.chargeHold <= 0) {
            this.combat.releaseAttack(d);
          }
        }
      } else {
        // Rapid-Fire Chaos: Instant jabs, smashes, and dropkicks!
        if (this.actionTimer <= 0) {
          if (this.combat.startCharge(d)) this.combat.releaseAttack(d);
          this.actionTimer = 0.18 + Math.random() * 0.22;
        }
      }
    }
  }
}
