// locomotionJuice.js — pure math for locomotion juice (Round 2).
//
// Zero dependencies: no three.js, no DOM, no non-deterministic RNG. Vectors are
// plain { x, y, z } objects so this module stays headless-testable, and the three.js
// classes own the scratch objects on the hot path.
//
// This module decides *how the body should read* while moving: banking into turns
// (lean), squash/stretch envelopes for jumps and landings, and skid-dust reversal
// detection with hysteresis. The visual application (mesh transforms, particle
// spawns) lives in Dweeb.js / Fx.js — never here. Nothing here touches physics,
// hitboxes, or sim state: these are presentation values only.

/** Default tuning for every curve (all overrideable per-call via `opts`). */
export const LOCOMOTION_DEFAULTS = {
  lean: { speedRef: 6, minSpeed: 1.2, rate: 12, maxLean: 0.5 },
  anticipation: { duration: 0.16, peak: 0.24, squashPhase: 0.45 },
  stretch: { maxStretch: 0.18, refSpeed: 15 },
  landing: { maxSquash: 0.5, k: 0.03, massRef: 3 },
  reversal: { engageDot: -0.3, releaseDot: 0.15, minSpeed: 4.2, cooldown: 0.22, eventMinSpeed: 6 },
};

/** Fresh per-Dweeb state. Create once in the constructor, pass in every frame. */
export function makeLocomotionState() {
  return {
    lean: 0,                                  // smoothed bank angle (rad), + = left
    jumpAnticipate: { t: -1 },                // envelope timer; < 0 = inactive
    reversal: { mode: 'idle', cooldown: 0 },  // 'idle' | 'skidding'
  };
}

/**
 * Update the body-bank lean toward the target implied by steering input.
 *
 * The lean points *into* the turn: its sign comes from the cross product of the
 * travel and input directions — positive = turning left, negative = right, which
 * matches the Dweeb's sin/cos yaw convention — scaled by how fast the body is
 * moving relative to `speedRef` (so walking barely banks and sprinting carves),
 * clamped to ±maxLean, then exponentially smoothed so a direction snap reads as a
 * weighty lean instead of a jitter.
 *
 * @param state   from makeLocomotionState()
 * @param vel     world velocity {x,y,z}
 * @param input   horizontal input {x,z} (or {x,y} if handed a THREE.Vector2)
 * @param dt      frame time (s)
 * @param opts    { speedRef, minSpeed, rate, maxLean }
 * @returns       smoothed bank angle in radians (−maxLean…+maxLean). Positive =
 *                leaning left (top toward the character's left), i.e. into a
 *                left turn. Wire as `rig.rotation.z = lean`.
 */
export function updateLean(state, vel, input, dt, opts = {}) {
  const L = { ...LOCOMOTION_DEFAULTS.lean, ...opts };
  const vx = vel.x, vz = vel.z;
  const hSpeed = Math.hypot(vx, vz);
  const ix = input.x, iz = input.z ?? input.y;
  const inputMag = Math.hypot(ix, iz);
  let target = 0;
  if (hSpeed >= L.minSpeed && inputMag > 1e-4) {
    const ux = vx / hSpeed, uz = vz / hSpeed;
    const inx = ix / inputMag, inz = iz / inputMag;
    // cross(fwd, in).y = fwd.z·in.x − fwd.x·in.z; + = steering toward the body's
    // left (facing +Z, left = −X). Positive local Z-rotation tips the top toward −X
    // (the character's left), so leaning into a left turn is positive. Negate the
    // cross so the result *is* the lean: + = leaning left / into a left turn.
    const turn = uz * inx - ux * inz;
    const speedF = Math.min(1, hSpeed / L.speedRef);
    target = -turn * speedF * L.maxLean;
  }
  state.lean += (target - state.lean) * (1 - Math.exp(-L.rate * dt));
  return state.lean;
}

/**
 * Start the pre-jump squash envelope. Call the frame a jump fires (grounded or
 * coyote); the takeoff read then becomes a quick dip, a recover, and the upward
 * stretch handled by aerialStretch — instead of a bare stretch.
 */
export function beginJumpAnticipation(state, opts = {}) {
  state.jumpAnticipate.t = 0;
}

/**
 * Advance the anticipation envelope and return its current squash contribution
 * (≥ 0; add it to the body's Y scale). A smoothstep bump up to `peak` at
 * `squashPhase` through the envelope, then back to 0 — the crouch-start read
 * right before launching. Returns 0 when inactive or finished.
 *
 * @param state from makeLocomotionState()
 * @param dt    frame time (s)
 * @param opts  { duration, peak, squashPhase }
 */
export function updateJumpAnticipation(state, dt, opts = {}) {
  const A = { ...LOCOMOTION_DEFAULTS.anticipation, ...opts };
  const env = state.jumpAnticipate;
  if (env.t < 0) return 0;
  env.t += dt;
  if (env.t >= A.duration) { env.t = -1; return 0; }
  const p = env.t / A.duration;
  const raw = p < A.squashPhase ? p / A.squashPhase : 1 - (p - A.squashPhase) / (1 - A.squashPhase);
  const s = raw * raw * (3 - 2 * raw); // smoothstep
  return A.peak * s;
}

/**
 * Aerial stretch amount (≥ 0) from vertical speed: ramps to `maxStretch` at
 * `refSpeed` of |vy|, clamped. Symmetric — rising and falling both stretch, so a
 * toss and a drop read the same way (the landing squash overlaps the fall later).
 */
export function aerialStretch(vy, opts = {}) {
  const S = { ...LOCOMOTION_DEFAULTS.stretch, ...opts };
  return Math.min(S.maxStretch, Math.abs(vy) * (S.maxStretch / S.refSpeed));
}

/**
 * Landing squash amount (0…maxSquash) from impact speed, scaled by body mass
 * (heavier bodies sit deeper). Mirrors the Dweeb's historic inline formula so the
 * wiring can route through here without changing behaviour.
 */
export function landingSquash(fallSpeed, mass = 3, opts = {}) {
  const P = { ...LOCOMOTION_DEFAULTS.landing, ...opts };
  return Math.min(P.maxSquash, fallSpeed * P.k * (mass / P.massRef));
}

/**
 * Compose the body-scale envelope: scale Y by (1 − squash + stretch) and preserve
 * volume by scaling X/Z by 1/√(sy). `amounts` gives the non-negative contributions
 * (anticipation squash, landing squash, aerial stretch) — the same curve the
 * Dweeb's rig applies, but pure and testable here.
 *
 * @param amounts { anticipating, landing, stretch }  (all ≥ 0)
 * @param opts    { minSy } lowest allowed Y scale before sideways bulging clamps
 * @param out     optional reusable { sy, sxz }; when passed it is mutated and
 *                returned instead of allocating.
 * @returns       { sy, sxz } with sy · sxz² ≈ 1 (volume preserved).
 */
export function squashStretch(amounts, opts = {}, out = null) {
  const minSy = opts.minSy ?? 0.35;
  const sy = Math.max(minSy, 1 - (amounts.anticipating ?? 0) - (amounts.landing ?? 0) + (amounts.stretch ?? 0));
  const sxz = 1 / Math.sqrt(sy);
  if (out) { out.sy = sy; out.sxz = sxz; return out; }
  return { sy, sxz };
}

/**
 * Detect a hard movement reversal (fast direction change) with hysteresis, so a
 * single committed skid reads once instead of flickering at the trigger edge.
 *
 * State machine (state.reversal.mode):
 *   idle      → 'start' when hSpeed ≥ minSpeed and dot ≤ engageDot (cooldown clear)
 *   skidding  → 'skid' repeats every cooldown while still hard-reversed
 *               (dot ≤ engageDot, hSpeed ≥ minSpeed) — the continuous dust spray
 *             → 'end' when dot ≥ releaseDot (the reversal genuinely resolved) or
 *               hSpeed drops below minSpeed (stopped grinding)
 *
 * `dot` is the cosine-like alignment of travel vs input (−1 = full reversal), e.g.
 * the Dweeb's `facing` value. The threshold asymmetry (engage < release) is the
 * hysteresis: once skidding, tiny oscillations around the edge don't flap the
 * effect on and off.
 *
 * @param state  from makeLocomotionState()
 * @param hSpeed horizontal speed (m/s)
 * @param dot    alignment (−1..1)
 * @param opts   { engageDot, releaseDot, minSpeed, cooldown, eventMinSpeed }
 * @param out    optional reusable { event, intensity }; when passed it is mutated
 *               and returned instead of allocating.
 * @returns      { event, intensity } — event: 'start' | 'skid' | 'end' | null;
 *               intensity 0..1 scales with hSpeed (for dust count / haptics).
 */
export function detectReversal(state, hSpeed, dot, dt, opts = {}, out = null) {
  const R = { ...LOCOMOTION_DEFAULTS.reversal, ...opts };
  const r = state.reversal;
  r.cooldown = Math.max(0, r.cooldown - dt);
  let event = null;
  if (r.mode === 'idle') {
    if (hSpeed >= R.minSpeed && dot <= R.engageDot && r.cooldown <= 0) {
      r.mode = 'skidding';
      r.cooldown = R.cooldown; // prime the hold so the start doesn't re-fire
      event = 'start';
    }
  } else {
    if (hSpeed < R.minSpeed || dot >= R.releaseDot) {
      r.mode = 'idle';
      r.cooldown = R.cooldown;
      event = 'end';
    } else if (r.cooldown <= 0) {
      r.cooldown = R.cooldown;
      event = 'skid';
    }
  }
  const intensity = Math.min(1, Math.max(0, hSpeed / R.eventMinSpeed));
  if (out) { out.event = event; out.intensity = intensity; return out; }
  return { event, intensity };
}
