// CombatTelemetry.js — Live combat telemetry for Build-A-Dweeb colosseum bouts.
//
// Pure event-sourced stats: every number (DPS, evasion rate, recovery jumps,
// kinetic impact force, end-of-match recap graph) is computed from recorded
// combat events — nothing is fabricated. The game feeds it from real combat
// callbacks (hits, KOs, techs/dodges, recovery jumps, impact forces); the HUD
// renders live DPS / impact gauges and the end-of-match recap graph.

export class CombatTelemetry {
  constructor() {
    this.events = [];
    this.fighters = new Map(); // id -> aggregate record
    this.startTime = null;
    this.endTime = null;
  }

  _fighter(id, name) {
    let f = this.fighters.get(id);
    if (!f) {
      f = {
        id, name: name || id,
        damageDealt: 0, damageTaken: 0,
        evasions: 0, hitsTaken: 0,
        recoveryJumps: 0,
        peakImpact: 0, totalImpact: 0, impacts: 0,
        kos: 0, deaths: 0,
        damageEvents: [], // { time, damage } dealt — rolling DPS source
      };
      this.fighters.set(id, f);
    } else if (name && f.name === id) {
      f.name = name;
    }
    return f;
  }

  _stamp(time) {
    if (this.startTime === null || time < this.startTime) this.startTime = time;
    if (this.endTime === null || time > this.endTime) this.endTime = time;
  }

  /** A real damage event: attacker dealt `damage` to target at `time`. */
  recordDamage({ attackerId, attackerName, targetId, targetName, damage, time = 0, kind = 'hit' }) {
    if (!(damage > 0)) return;
    this._stamp(time);
    const a = this._fighter(attackerId, attackerName);
    const t = this._fighter(targetId, targetName);
    a.damageDealt += damage;
    a.damageEvents.push({ time, damage });
    t.damageTaken += damage;
    t.hitsTaken += 1;
    this.events.push({ type: 'damage', attackerId, targetId, damage, time, kind });
  }

  /** A real evasion: dodge, tech, or near-miss that avoided damage. */
  recordEvasion({ dweebId, name, time = 0 }) {
    this._stamp(time);
    this._fighter(dweebId, name).evasions += 1;
    this.events.push({ type: 'evasion', dweebId, time });
  }

  /** A recovery jump: an air jump / edge recovery while off-stage. */
  recordRecoveryJump({ dweebId, name, time = 0 }) {
    this._stamp(time);
    this._fighter(dweebId, name).recoveryJumps += 1;
    this.events.push({ type: 'recovery', dweebId, time });
  }

  /** Kinetic impact force from a real physics impact (handleImpacts path). */
  recordImpact({ dweebId, name, force, time = 0 }) {
    if (!(force > 0)) return;
    this._stamp(time);
    const f = this._fighter(dweebId, name);
    f.peakImpact = Math.max(f.peakImpact, force);
    f.totalImpact += force;
    f.impacts += 1;
    this.events.push({ type: 'impact', dweebId, force, time });
  }

  recordKO({ dweebId, name, byId, time = 0 }) {
    this._stamp(time);
    const v = this._fighter(dweebId, name);
    v.deaths += 1;
    if (byId && byId !== dweebId) this._fighter(byId).kos += 1;
    this.events.push({ type: 'ko', dweebId, byId, time });
  }

  /** Damage per second dealt by a fighter over the trailing window. */
  dps(id, windowSec = 5, now = null) {
    const f = this.fighters.get(id);
    if (!f || windowSec <= 0) return 0;
    const t = now ?? this.endTime ?? 0;
    let sum = 0;
    for (const e of f.damageEvents) {
      if (e.time > t - windowSec && e.time <= t) sum += e.damage;
    }
    return sum / windowSec;
  }

  /** Peak rolling DPS across the whole recording (windowSec buckets). */
  peakDps(id, windowSec = 5) {
    const f = this.fighters.get(id);
    if (!f || !f.damageEvents.length) return 0;
    let peak = 0;
    for (const e of f.damageEvents) {
      peak = Math.max(peak, this.dps(id, windowSec, e.time));
    }
    return peak;
  }

  totalDamage(id) {
    return this.fighters.get(id)?.damageDealt ?? 0;
  }

  /** Evasions / (evasions + hits taken) — 0 when no defensive events recorded. */
  evasionRate(id) {
    const f = this.fighters.get(id);
    if (!f) return 0;
    const denom = f.evasions + f.hitsTaken;
    return denom > 0 ? f.evasions / denom : 0;
  }

  recoveryJumps(id) {
    return this.fighters.get(id)?.recoveryJumps ?? 0;
  }

  peakImpact(id) {
    return this.fighters.get(id)?.peakImpact ?? 0;
  }

  fighterIds() {
    return [...this.fighters.keys()];
  }

  /**
   * End-of-match recap: per-fighter aggregates plus a damage-over-time
   * timeline (bucketSec buckets) suitable for drawing the recap graph.
   */
  recap(bucketSec = 2) {
    const ids = this.fighterIds();
    const duration = (this.endTime ?? 0) - (this.startTime ?? 0);
    const bucketCount = Math.max(1, Math.ceil(duration / bucketSec));
    const timeline = [];
    for (let b = 0; b < bucketCount; b++) {
      const t0 = (this.startTime ?? 0) + b * bucketSec;
      const entry = { t: t0, total: 0, per: {} };
      for (const id of ids) entry.per[id] = 0;
      timeline.push(entry);
    }
    for (const f of this.fighters.values()) {
      for (const e of f.damageEvents) {
        const b = Math.min(bucketCount - 1, Math.floor((e.time - (this.startTime ?? 0)) / bucketSec));
        if (b >= 0) {
          timeline[b].per[f.id] += e.damage;
          timeline[b].total += e.damage;
        }
      }
    }
    const fighters = ids.map(id => {
      const f = this.fighters.get(id);
      return {
        id: f.id, name: f.name,
        damageDealt: f.damageDealt,
        damageTaken: f.damageTaken,
        dps: this.dps(id),
        peakDps: this.peakDps(id),
        evasionRate: this.evasionRate(id),
        recoveryJumps: f.recoveryJumps,
        peakImpact: f.peakImpact,
        kos: f.kos,
        deaths: f.deaths,
      };
    }).sort((a, b) => b.damageDealt - a.damageDealt);
    return { fighters, timeline, duration, bucketSec };
  }

  toJSON() {
    return {
      events: this.events,
      startTime: this.startTime,
      endTime: this.endTime,
      names: Object.fromEntries([...this.fighters.entries()].map(([id, f]) => [id, f.name])),
    };
  }

  static fromJSON(data = {}) {
    const t = new CombatTelemetry();
    const names = data.names || {};
    for (const e of data.events || []) {
      if (e.type === 'damage') {
        t.recordDamage({
          attackerId: e.attackerId, attackerName: names[e.attackerId],
          targetId: e.targetId, targetName: names[e.targetId],
          damage: e.damage, time: e.time, kind: e.kind,
        });
      } else if (e.type === 'evasion') {
        t.recordEvasion({ dweebId: e.dweebId, name: names[e.dweebId], time: e.time });
      } else if (e.type === 'recovery') {
        t.recordRecoveryJump({ dweebId: e.dweebId, name: names[e.dweebId], time: e.time });
      } else if (e.type === 'impact') {
        t.recordImpact({ dweebId: e.dweebId, name: names[e.dweebId], force: e.force, time: e.time });
      } else if (e.type === 'ko') {
        t.recordKO({ dweebId: e.dweebId, name: names[e.dweebId], byId: e.byId, time: e.time });
      }
    }
    return t;
  }
}
