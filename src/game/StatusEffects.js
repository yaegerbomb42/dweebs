// StatusEffects.js — elemental statuses and the ground zones that hand them out.
//
// Five statuses that *combine*, so props become ingredients instead of one-shot throwables:
//   wet     — slicker footing, puts out fire, CONDUCTS static
//   burn    — damage over time, a panicked hop; on an oily Dweeb it erupts (INFERNO)
//   oily    — huge slide, terrible traction, flammable
//   sticky  — slow, short jumps, but rock-solid footing
//   chill   — sluggish; get chilled again while chilled and you freeze solid
//   static  — crackles; touching water (or being wet) SHOCKS you and arcs to other wet Dweebs
//
// Zones (puddles/clouds) come from breaking the new element props (ObjectRegistry `status`).
// Presentation goes through existing Particles/Decals/Hud; movement through three multipliers the
// Dweeb reads each step (statusMove / statusTraction / statusJump). Client-side only: the
// deterministic sim in src/sim is untouched.

export const STATUS = {
  wet:    { dur: 7,   color: 0x3fa9ff, label: 'SOAKED',  move: 1.0,  traction: 0.6, jump: 1.0 },
  burn:   { dur: 3.5, color: 0xff6a3c, label: 'ON FIRE', move: 1.15, traction: 1.0, jump: 1.0, dps: 4 },
  oily:   { dur: 6,   color: 0x3a2d1e, label: 'OILY',    move: 1.05, traction: 0.25, jump: 0.95 },
  sticky: { dur: 4,   color: 0xffb02e, label: 'STICKY',  move: 0.5,  traction: 1.6, jump: 0.55 },
  chill:  { dur: 4,   color: 0xbff4ff, label: 'CHILLY',  move: 0.65, traction: 0.8, jump: 0.8 },
  static: { dur: 5,   color: 0xfff35a, label: 'STATIC',  move: 1.1,  traction: 1.0, jump: 1.1 },
};

// What each element prop leaves behind when it breaks
export const ZONE_KINDS = {
  oil:    { status: 'oily',   r: 2.6, life: 14, decal: 'splat',  color: 0x2a2018, op: 0.8 },
  water:  { status: 'wet',    r: 2.4, life: 10, decal: 'splat',  color: 0x3fa9ff, op: 0.55 },
  honey:  { status: 'sticky', r: 2.2, life: 12, decal: 'splat',  color: 0xffb02e, op: 0.75 },
  frost:  { status: 'chill',  r: 3.0, life: 7,  decal: 'crack',  color: 0xbff4ff, op: 0.7, cloud: true },
  pepper: { status: 'burn',   r: 2.6, life: 5,  decal: 'scorch', color: 0x2a1a10, op: 0.6, cloud: true },
  spark:  { status: 'static', r: 3.2, life: 6,  decal: 'crack',  color: 0xfff35a, op: 0.5, cloud: true },
};

export class StatusSystem {
  constructor({ particles, decals, hud, audio = null }) {
    this.particles = particles; this.decals = decals; this.hud = hud; this.audio = audio;
    this.dweebs = [];
    this.zones = [];
    this._fxT = 0;
  }
  setDweebs(list) { this.dweebs = list || []; }
  clear() {
    this.zones.length = 0;
    for (const d of this.dweebs) if (d) { d.statuses = null; this._applyMods(d); }
  }

  /** Spill a zone (from a broken element prop). */
  addZone(kind, pos, by = null) {
    const Z = ZONE_KINDS[kind];
    if (!Z) return;
    this.zones.push({ kind, x: pos.x, y: pos.y, z: pos.z, r: Z.r, life: Z.life, max: Z.life, by });
    if (this.zones.length > 10) this.zones.shift();
    this.decals?.spawnOnGround?.(Z.decal, pos, Z.r * 2, Z.color, Z.op, Z.life);
    this.particles?.emit?.(pos, { count: 26, colors: [Z.color, 0xffffff], speed: 5, up: 3, size: 0.13, life: 0.7 });
    this.particles?.ring?.(pos, { color: Z.color, size: Z.r * 1.6, life: 0.5 });
    // Spilling into existing hazards: water on a fire zone steams it out, pepper on oil goes up.
    for (const o of this.zones) {
      if (o.kind === kind || Math.hypot(o.x - pos.x, o.z - pos.z) > o.r + Z.r * 0.6) continue;
      if ((kind === 'water' && o.kind === 'pepper') || (kind === 'pepper' && o.kind === 'water')) {
        o.life = Math.min(o.life, 0.3);
        this.particles?.emit?.(pos, { count: 30, colors: [0xffffff, 0xdfe8ef], speed: 3, up: 5, size: 0.2, life: 1.1 });
        this.hud?.popup?.('FSSSHH!', pos, 'small', 0xffffff);
      } else if ((kind === 'pepper' && o.kind === 'oil') || (kind === 'oil' && o.kind === 'pepper')) {
        o.kind = 'pepper'; o.life = o.max = 8; o.r *= 1.3;
        this.particles?.emit?.(pos, { count: 40, colors: [0xff6a3c, 0xffd23f, 0x2a1a10], speed: 8, up: 6, size: 0.2, life: 0.9 });
        this.hud?.popup?.('GREASE FIRE!', pos, 'big', 0xff6a3c);
      }
    }
  }

  /** Give a Dweeb a status. Returns the reaction that fired, if any. */
  apply(d, kind, by = null, dur = null) {
    if (!d || !d.active || !STATUS[kind]) return null;
    const s = d.statuses || (d.statuses = {});
    const fresh = !(s[kind] > 0);
    const reaction = this._combine(d, kind, by);
    if (reaction === 'consumed') return reaction;
    s[kind] = Math.max(s[kind] || 0, dur ?? STATUS[kind].dur);
    if (by && by !== d) d.statusBy = by;
    if (fresh && d.isPlayer) this.hud?.popup?.(STATUS[kind].label, d.getPosition(), 'small', STATUS[kind].color);
    this._applyMods(d);
    return reaction;
  }

  _combine(d, kind, by) {
    const s = d.statuses || {};
    const pos = d.getPosition();
    // Water puts fire out
    if (kind === 'wet' && s.burn > 0) {
      s.burn = 0;
      this.particles?.emit?.(pos, { count: 18, colors: [0xffffff, 0xdfe8ef], speed: 2, up: 4, size: 0.18, life: 0.9 });
      this.hud?.popup?.('PHEW', pos, 'small', 0xffffff);
    }
    if (kind === 'burn' && s.wet > 0) { s.wet = Math.max(0, s.wet - 3); return 'consumed'; }
    // Oil + fire = INFERNO
    if ((kind === 'burn' && s.oily > 0) || (kind === 'oily' && s.burn > 0)) {
      s.oily = 0;
      s.burn = 6;
      this._pop(d, by, { up: 13, out: 5, dmg: 14 }, 'INFERNO!', 0xff6a3c);
      this.particles?.emit?.(pos, { count: 50, colors: [0xff6a3c, 0xffd23f, 0x2a1a10], speed: 9, up: 8, size: 0.22, life: 1 });
      return 'inferno';
    }
    // Static + water = SHOCK, arcs to every wet Dweeb nearby
    if ((kind === 'static' && s.wet > 0) || (kind === 'wet' && s.static > 0)) {
      s.static = 0;
      this._shock(d, by, 0);
      return 'shock';
    }
    // Chill on chill = frozen solid
    if (kind === 'chill' && s.chill > 1.2) {
      s.chill = 0;
      d.receiveHit?.({ dir: { x: 0, y: 0.2, z: 0 }, damage: 4, base: 0, growth: 0, attacker: by, time: this.combat?.time ?? 0, freeze: 1.6, noParry: true });
      this.particles?.emit?.(pos, { count: 30, colors: [0xbff4ff, 0xffffff], speed: 4, up: 3, size: 0.14, life: 0.8 });
      this.hud?.popup?.('FROZEN SOLID!', pos, 'big', 0xbff4ff);
      return 'consumed';
    }
    // Burning thaws chill, chill smothers flame
    if (kind === 'burn' && s.chill > 0) { s.chill = 0; }
    if (kind === 'chill' && s.burn > 0) { s.burn = 0; return 'consumed'; }
    return null;
  }

  _shock(d, by, depth) {
    const pos = d.getPosition();
    this._pop(d, by, { up: 9, out: 2, dmg: 12 }, depth ? 'ZAP!' : 'SHOCKED!', 0xfff35a);
    this.particles?.emit?.(pos, { count: 30, colors: [0xfff35a, 0xffffff, 0x8fe9ff], speed: 7, up: 4, size: 0.1, life: 0.4 });
    this.particles?.ring?.(pos, { color: 0xfff35a, size: 3.5, life: 0.3 });
    d._shockedAt = performance.now();
    if (depth > 4) return;
    for (const o of this.dweebs) {
      if (!o || o === d || !o.active || !(o.statuses?.wet > 0)) continue;
      if (o._shockedAt && performance.now() - o._shockedAt < 600) continue;
      const op = o.getPosition();
      if (Math.hypot(op.x - pos.x, op.y - pos.y, op.z - pos.z) > 4.5) continue;
      this._arc(pos, op);
      o.statuses.wet = 0;
      this._shock(o, by, depth + 1);
    }
  }

  _arc(a, b) {
    // A dotted spark line between two Dweebs
    const n = 7;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      this.particles?.emit?.({ x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 0.3, y: a.y + (b.y - a.y) * t + 0.3 + (Math.random() - 0.5) * 0.3, z: a.z + (b.z - a.z) * t },
        { count: 2, colors: [0xfff35a, 0xffffff], speed: 0.5, up: 0.2, size: 0.09, life: 0.25 });
    }
  }

  _pop(d, by, { up, out, dmg }, word, color) {
    const pos = d.getPosition();
    const a = Math.random() * Math.PI * 2;
    d.receiveHit?.({ dir: { x: Math.cos(a) * out / 10, y: 1, z: Math.sin(a) * out / 10 }, damage: dmg, base: up, growth: 0.04, attacker: by ?? d.statusBy ?? null, time: this.combat?.time ?? 0, noParry: true });
    this.hud?.popup?.(word, pos, 'big', color);
  }

  _applyMods(d) {
    let m = 1, t = 1, j = 1;
    const s = d.statuses;
    if (s) for (const k in s) if (s[k] > 0) { m *= STATUS[k].move; t *= STATUS[k].traction; j *= STATUS[k].jump; }
    d.statusMove = m; d.statusTraction = t; d.statusJump = j;
  }

  update(dt) {
    this._fxT -= dt;
    const fxTick = this._fxT <= 0;
    if (fxTick) this._fxT = 0.09;
    // Zones hand out their status to anyone standing in them
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      if (z.life <= 0) { this.zones.splice(i, 1); continue; }
      const Z = ZONE_KINDS[z.kind];
      if (fxTick && Z.cloud) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * z.r;
        this.particles?.emit?.({ x: z.x + Math.cos(a) * r, y: z.y + 0.2, z: z.z + Math.sin(a) * r },
          { count: 2, colors: [Z.color, 0xffffff], speed: 0.6, up: 1.5, size: 0.16, life: 0.8 });
      }
      for (const d of this.dweebs) {
        if (!d || !d.active || d.grabbedBy) continue;
        const p = d.getPosition();
        if (Math.hypot(p.x - z.x, p.z - z.z) > z.r || Math.abs(p.y - z.y) > (Z.cloud ? 2.5 : 1.2)) continue;
        if (!Z.cloud && !d.grounded) continue;
        // Refresh lightly while standing in it; first touch applies (and can combine).
        if (!(d.statuses?.[Z.status] > 0)) this.apply(d, Z.status, z.by);
        else d.statuses[Z.status] = Math.max(d.statuses[Z.status], 1.2);
      }
    }
    for (const d of this.dweebs) {
      const s = d?.statuses;
      if (!s) continue;
      let any = false;
      for (const k in s) {
        if (!(s[k] > 0)) continue;
        s[k] -= dt;
        any = true;
        if (k === 'burn' && d.active) {
          d.percent = Math.min(999, d.percent + STATUS.burn.dps * dt);
          // Panic hop
          if (d.grounded && Math.random() < dt * 1.2) d.requestJump?.();
          // Standing in water (or a wet zone) puts it out — handled by apply('wet')
        }
        if (fxTick && d.active) {
          const p = d.getPosition(), c = STATUS[k].color;
          if (k === 'burn') this.particles?.emit?.({ x: p.x, y: p.y + 0.4, z: p.z }, { count: 3, colors: [0xff6a3c, 0xffd23f], speed: 1, up: 3, size: 0.13, life: 0.45 });
          else if (k === 'wet') { if (Math.random() < 0.5) this.particles?.emit?.({ x: p.x, y: p.y + 0.2, z: p.z }, { count: 1, colors: [c], speed: 0.4, up: -1, size: 0.07, life: 0.4 }); }
          else if (k === 'static') { if (Math.random() < 0.6) this.particles?.emit?.({ x: p.x + (Math.random() - 0.5) * 0.8, y: p.y + 0.5, z: p.z + (Math.random() - 0.5) * 0.8 }, { count: 1, colors: [c, 0xffffff], speed: 2, up: 0.5, size: 0.06, life: 0.15 }); }
          else if (Math.random() < 0.3) this.particles?.emit?.({ x: p.x, y: p.y, z: p.z }, { count: 1, colors: [c], speed: 0.3, up: 0.2, size: 0.1, life: 0.5 });
        }
      }
      // Status tint on the Dweeb's body (blend into the existing emissive hit flash)
      d.statusTint = any ? this._tint(s) : null;
      if (!d.active) { d.statuses = null; d.statusTint = null; }
      this._applyMods(d);
    }
  }

  _tint(s) {
    let best = null, bt = 0;
    for (const k in s) if (s[k] > bt) { bt = s[k]; best = k; }
    return best ? STATUS[best].color : null;
  }

  /** Touching a statused thing passes it on: hits from a statused attacker can spread fire/static. */
  onHit(victim, attacker, obj = null) {
    if (obj?.def?.statusOnHit) this.apply(victim, obj.def.statusOnHit, attacker);
    const s = attacker?.statuses;
    if (s?.burn > 0 && Math.random() < 0.5) this.apply(victim, 'burn', attacker, 2);
    if (s?.static > 0) this.apply(victim, 'static', attacker, 3);
  }
}
