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
    this.lastKnownTargetPos = null;
    this.itemHuntTimer = 0;
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

    // 2. Scavenge Override: Item hunters prioritize gear over fighting
    if (this.dna.scavenge > 0.55 && !d.held && this.itemHuntTimer <= 0 && this.arena?.items?.length) {
      this.itemHuntTimer = 1.2 - this.dna.scavenge * 0.8;
      const nearestItem = this._findNearbyItem(pos);
      if (nearestItem) {
        const itemDist = Math.hypot(nearestItem.position.x - pos.x, nearestItem.position.z - pos.z);
        const itemPriority = this.dna.scavenge > 0.75 || itemDist < 5;
        if (itemPriority) {
          this._approach(pos, nearestItem.position, 1.0);
          if (itemDist < 1.4) {
            this.combat.grab(d);
          }
          return;
        }
      }
    }

    // 3. Target Acquisition: Find nearest active opponent
    if (this.thinkTimer <= 0 || !this.target || !this.target.active || this.target.eliminated) {
      this.thinkTimer = 0.2 + (1 - this.dna.aimAccuracy) * 0.3;
      this._pickTarget(rivals, pos);
    }

    if (!this.target) {
      // No target: patrol or hunt items
      if (this.dna.scavenge > 0.4 && this.arena?.items?.length) {
        const item = this._findNearbyItem(pos);
        if (item) {
          this._approach(pos, item.position, 0.7);
          if (Math.hypot(item.position.x - pos.x, item.position.z - pos.z) < 1.4) this.combat.grab(d);
          return;
        }
      }
      // Patrol slowly
      d.moveInput.set(Math.sin(Date.now() * 0.001) * 0.5, Math.cos(Date.now() * 0.001) * 0.5);
      return;
    }
    const tPos = this.target.getPosition();
    this.lastKnownTargetPos = tPos;
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

    // 5. Scavenging mid-fight: if item love is high and a toy/bomb is nearby
    if (this.dna.scavenge > 0.4 && dist > 3.5 && this.arena?.items?.length) {
      const nearestItem = this._findNearbyItem(pos);
      if (nearestItem) {
        const itemDist = Math.hypot(nearestItem.position.x - pos.x, nearestItem.position.z - pos.z);
        if (itemDist < dist * 0.8 && itemDist < 10) {
          this._approach(pos, nearestItem.position, 1.0);
          if (itemDist < 1.4) {
            this.combat.grab(d);
          }
          return;
        }
      }
    }

    // 6. Combat Movement & Attack — DNA-driven archetypes
    this._brawl(dt, pos, tPos, dist);
  }

  _pickTarget(rivals, myPos) {
    let best = null;
    let bestDist = Infinity;
    for (const r of rivals) {
      if (r === this.dweeb || !r.active || r.eliminated) continue;
      const rp = r.getPosition();
      const dist = Math.hypot(rp.x - myPos.x, rp.z - myPos.z);
      // Low confidence avoids the closest, most dangerous target
      const weight = this.dna.confidence < 0.4 ? dist * 0.7 + Math.random() * 3 : dist;
      if (weight < bestDist) {
        bestDist = weight;
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
    const agi = this.dna.agility;

    // ── ARCHETYPE MOVEMENT ──
    if (conf > 0.65) {
      // RUSHDOWN: Relentless forward charge into punching distance
      this._approach(myPos, tPos, 1.0);
      // Aggressive jump-ins when close
      if (this.jumpCd <= 0 && dist < 3.5 && Math.random() < agi * 0.5) {
        d.requestJump();
        this.jumpCd = 1.0 - agi * 0.5;
      }
    } else if (conf < 0.4) {
      // KITER / COWARDLY: Keep distance, circle, avoid melee
      if (dist < 5.0) {
        // Back pedal hard
        const dx = myPos.x - tPos.x;
        const dz = myPos.z - tPos.z;
        const len = Math.hypot(dx, dz) || 1;
        d.moveInput.set((dx / len) * 1.0, (dz / len) * 1.0);
        // Jump away to create space
        if (this.jumpCd <= 0 && dist < 3.0 && Math.random() < agi * 0.4) {
          d.requestJump();
          this.jumpCd = 1.2 - agi * 0.3;
        }
      } else {
        // Circle strafe at safe range
        const dx = tPos.x - myPos.x;
        const dz = tPos.z - myPos.z;
        const len = Math.hypot(dx, dz) || 1;
        d.moveInput.set(-dz / len * this.strafe * 0.8, dx / len * this.strafe * 0.8);
      }
    } else {
      // BALANCED BRAWLER: moderate approach
      this._approach(myPos, tPos, 0.85);
    }

    // ── ARCHETYPE ATTACK ──
    if (dist < 2.8) {
      if (aim > 0.65) {
        // CALCULATED SNIPER: Charge up a heavy, devastating smash
        if (d.charging <= 0 && this.actionTimer <= 0) {
          this.combat.startCharge(d);
          this.chargeHold = 0.5 + aim * 0.5;
          this.actionTimer = 1.0;
        } else if (d.charging > 0) {
          this.chargeHold -= dt;
          if (this.chargeHold <= 0) {
            this.combat.releaseAttack(d);
          }
        }
      } else if (conf > 0.65) {
        // RUSHDOWN FLURRY: Rapid-fire jabs and smashes, no hesitation
        if (this.actionTimer <= 0) {
          if (this.combat.startCharge(d)) this.combat.releaseAttack(d);
          this.actionTimer = 0.12 + Math.random() * 0.12;
        }
      } else {
        // BALANCED: Standard attack timing
        if (this.actionTimer <= 0) {
          if (this.combat.startCharge(d)) this.combat.releaseAttack(d);
          this.actionTimer = 0.35 + Math.random() * 0.25;
        }
      }
    } else if (dist < 5.0 && conf > 0.75 && aim < 0.5) {
      // Rushdown with low accuracy: charge from mid-range to close gap
      if (d.charging <= 0 && this.actionTimer <= 0) {
        this.combat.startCharge(d);
        this.chargeHold = 0.3;
        this.actionTimer = 0.6;
      } else if (d.charging > 0) {
        this.chargeHold -= dt;
        if (this.chargeHold <= 0) this.combat.releaseAttack(d);
      }
    }
  }
}
