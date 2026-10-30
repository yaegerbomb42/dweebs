// Reactions.js — bystander body language. Every Dweeb near something dramatic notices it:
// heads/eyes snap to the event, they flinch, gasp, cheer a big launch, or edge away from a hissing
// fuse. Pure presentation layered on DweebModel's face + Dweeb's body springs; it never changes
// physics, so it is safe in every mode (arena, escape, adventure citizens, mimic, builder bots).

export const REACT = {
  //          radius  duration  priority  hop    (hop = visual stretch, not physics)
  gasp:    { r: 9,   t: 1.1,    p: 3,     hop: 0.35 },
  flinch:  { r: 4,   t: 0.55,   p: 4,     hop: 0.25 },
  cheer:   { r: 14,  t: 1.6,    p: 2,     hop: 0.45 },
  dread:   { r: 6,   t: 0.9,    p: 1,     hop: 0 },
  wince:   { r: 7,   t: 0.7,    p: 2,     hop: 0.1 },
};

export class Reactions {
  constructor() { this.dweebs = []; }
  setDweebs(list) { this.dweebs = list || []; }

  /**
   * Make Dweebs near `pos` react. `exclude` (Dweeb or array) are the participants — they already
   * have their own animation. `cheerFor` makes the attacker's teammates (or the attacker) cheer
   * instead of gasp.
   */
  emit(kind, pos, { exclude = null, cheerFor = null, intensity = 1 } = {}) {
    const def = REACT[kind];
    if (!def || !pos) return;
    const ex = Array.isArray(exclude) ? exclude : exclude ? [exclude] : [];
    const r = def.r * (0.6 + 0.4 * Math.min(2, intensity));
    for (const d of this.dweebs) {
      if (!d || !d.active || !d.mesh || ex.includes(d) || d.ragdolling || d.grabbedBy) continue;
      // Read the rendered position, not the rigid body: lists can briefly hold Dweebs whose
      // bodies were just freed (mode switches), and the mesh is what the player sees anyway.
      const p = d.mesh.position;
      const dx = pos.x - p.x, dz = pos.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > r) continue;
      let k = kind;
      if (cheerFor && (d === cheerFor || (d.team && d.team === cheerFor.team))) k = 'cheer';
      const kd = REACT[k];
      if (d.reactT > 0 && REACT[d.reactKind]?.p > kd.p) continue; // keep the stronger reaction
      // Stagger reaction onset by distance so a crowd ripples instead of twitching in sync.
      d.reactDelay = dist * 0.03 + Math.random() * 0.06;
      d.reactKind = k;
      d.reactT = kd.t;
      d.reactPos = { x: pos.x, y: pos.y, z: pos.z };
      d.reactHop = kd.hop * (1 - dist / (r + 1));
      d._reactFired = false;
    }
  }

  /** Per-frame: fire delayed reactions (hop + body jolt), age them out. */
  update(dt) {
    for (const d of this.dweebs) {
      if (!d || !d.mesh || !(d.reactT > 0)) continue;
      if (d.reactDelay > 0) { d.reactDelay -= dt; continue; }
      if (!d._reactFired) {
        d._reactFired = true;
        if (d.grounded && d.reactHop > 0) d.landSquash = Math.min(d.landSquash || 0, -d.reactHop);
        // Recoil away from the event in the Dweeb's own frame.
        const p = d.mesh.position, rp = d.reactPos;
        const dx = p.x - rp.x, dz = p.z - rp.z, l = Math.hypot(dx, dz) || 1;
        const sy = Math.sin(d.yaw), cy = Math.cos(d.yaw);
        const away = d.reactKind === 'cheer' ? 0 : 1;
        d.jolt?.(d.reactKind === 'cheer' ? 0.6 : 0.9, -((dx / l) * sy + (dz / l) * cy) * away, ((dx / l) * cy - (dz / l) * sy) * away);
      }
      d.reactT -= dt;
    }
  }
}
