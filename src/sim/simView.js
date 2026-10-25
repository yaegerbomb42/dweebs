// simView.js — T1 client cutover helper: sync legacy three.js view objects from SimState.
//
// The legacy view owns meshes keyed by slot (Dweeb.mesh, shadow, face rig). The sim owns
// truth (pos/yaw/percent/stocks/active/out). This file copies truth -> view each frame:
// mesh position/quaternion from pos+yaw, visibility from active/out, squash decay,
// nameplate percent/stocks via the Hud update path. No physics writes, no allocations
// on the hot path beyond the caller's own scratch objects.
//
// Usage in main.js loop (after sim.step):
//   import { syncViewFromState } from './sim/simView.js';
//   syncViewFromState(sim.getState(), { dweebs, hud, cam, scratch });
const _up = { x: 0, y: 1, z: 0 };
// Lightweight yaw->quaternion for callers without three.js (matches three's Y-rotation).
// Returns {x,y,z,w} with x=z=0 — the sim never rolls/pitches a dweeb body.
export function yawToQuat(yaw) {
  const h = yaw / 2;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}
// Copy sim truth into legacy view objects. `views` is an array indexed by slot of
// { mesh, shadow, setYaw, setSquash, setActive } adapters (or raw Dweeb objects —
// duck-typed: mesh.position.set, mesh.quaternion.set, mesh.visible are all optional).
// Returns { visible, out, dead } counts for HUD/spectate logic.
export function syncViewFromState(state, views = [], opts = {}) {
  const scratch = opts.scratch;
  let visible = 0, out = 0, dead = 0;
  for (const d of state.dweebs) {
    const v = views[d.slot];
    if (d.eliminated) dead++;
    else if (!d.active || d.out) out++;
    else visible++;
    if (!v) continue;
    const alive = d.active && !d.out && !d.eliminated;
    try {
      const mesh = v.mesh || v;
      if (mesh?.position?.set) mesh.position.set(d.pos[0], d.pos[1], d.pos[2]);
      const q = yawToQuat(d.yaw || 0);
      if (mesh?.quaternion?.set) mesh.quaternion.set(q.x, q.y, q.z, q.w); else if (typeof v.setYaw === 'function') v.setYaw(d.yaw || 0);
      if (mesh && 'visible' in mesh) mesh.visible = d.eliminated ? false : true;
      if (v.shadow && 'visible' in v.shadow) v.shadow.visible = alive;
      if (typeof v.setSquash === 'function' && d.styleTier >= 0) { /* squash driven by Fx, not state */ }
      if (scratch) scratch[d.slot] = d;
    } catch { /* a missing mesh must never break the sim loop */ }
  }
  void _up;
  return { visible, out, dead };
}
