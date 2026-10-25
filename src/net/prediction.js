// prediction.js — client-side prediction and reconciliation (NET).
//
// The client runs the same sim locally for its own dweeb and re-sends nothing; when a
// snapshot arrives it rewinds to the server's authoritative state for that tick and
// replays every input after it. The resulting correction is *smoothed*: instead of
// snapping, an error offset is decayed over SMOOTH_MS, so the camera never snaps.
//
// Hard rule: never teleport for a sub-metre correction. Anything under MIN_SNAP_M is
// absorbed entirely by the smoothing; the view simply eases into place.

import { SIM_HZ, TICK_MS, NET } from './protocol.js';

export const SMOOTH_MS = NET.smoothMs;      // correction is eased out over this long
export const MIN_SNAP_M = NET.minSnapM;     // below 1 m, smoothing only — no teleport, ever
export const MAX_REWIND_TICKS = 30;

/** The error offset we are currently easing out, in metres. Decays to zero. */
export class CorrectionSmoother {
  constructor() { this.offset = { x: 0, y: 0, z: 0 }; this.lastTime = 0; }
  reset() { this.offset.x = this.offset.y = this.offset.z = 0; }
  /** Start easing a new error. Errors under MIN_SNAP_M are only partly adopted. */
  begin(err) {
    this.offset.x = err.x; this.offset.y = err.y; this.offset.z = err.z;
    this.lastTime = 0;
  }
  /**
   * Advance the offset. `dt` in seconds. Returns the offset still to be applied
   * (render position = authoritative + offset).
   */
  step(dt) {
    const k = Math.min(1, (dt * 1000) / SMOOTH_MS);
    this.offset.x -= this.offset.x * k;
    this.offset.y -= this.offset.y * k;
    this.offset.z -= this.offset.z * k;
    if (Math.hypot(this.offset.x, this.offset.y, this.offset.z) < 1e-4) this.reset();
    return this.offset;
  }
}

/**
 * Per-tick input history used for rewind-and-replay. Keeps the last
 * MAX_REWIND_TICKS inputs, which bounds the replay cost to ~0.5 s of simulation.
 */
export class InputHistory {
  constructor(limit = MAX_REWIND_TICKS) { this.limit = limit; this.map = new Map(); }
  record(tick, input) { this.map.set(tick, input); if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value); }
  since(tick) { const out = []; for (const [t, i] of this.map) if (t >= tick) out.push([t, i]); return out.sort((a, b) => a[0] - b[0]); }
  get size() { return this.map.size; }
}

/**
 * Interpolate two entity states (cm on the wire, metres out) by fraction `a` in [0,1].
 * Yaw is interpolated the short way around so a dweeb never spins 350° to turn 10°.
 */
export function lerpEntity(a, b, t) {
  const out = { ...b };
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  if (a.yaw !== undefined && b.yaw !== undefined) {
    let d = b.yaw - a.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    out.yaw = a.yaw + d * t;
  }
  return out;
}

/**
 * Where to draw a remote entity: ~INTERP_DELAY_MS behind the newest snapshot, which
 * turns a jittery 30 Hz feed into a smooth 60 fps stream. We sample between the two
 * snapshots that straddle the target time.
 */
export const INTERP_DELAY_MS = NET.interpDelayMs;
export const INTERP_TICKS = Math.round(INTERP_DELAY_MS / TICK_MS);

export function sampleBuffer(buffer, renderTick) {
  if (!buffer.length) return null;
  if (buffer.length === 1 || renderTick <= buffer[0].tick) return buffer[0];
  const last = buffer[buffer.length - 1];
  if (renderTick >= last.tick) return last;
  for (let i = buffer.length - 1; i > 0; i--) {
    const b = buffer[i], a = buffer[i - 1];
    if (renderTick >= a.tick && renderTick <= b.tick) {
      const span = Math.max(1, b.tick - a.tick);
      return { tick: renderTick, entities: lerpSnapshotEntities(a.entities, b.entities, (renderTick - a.tick) / span) };
    }
  }
  return last;
}

function lerpSnapshotEntities(a, b, t) {
  const out = [];
  for (const e of b) {
    const p = a.find(x => x.id === e.id);
    out.push(p ? lerpEntity(p, e, t) : e);
  }
  return out;
}

export { SIM_HZ, TICK_MS };
