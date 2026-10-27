// punchAnim.js — pure math for punch wind-up, strike snap, and recoil (Round 3).
//
// Zero dependencies: no three.js, no DOM, no non-deterministic RNG. Vectors are
// plain { x, y, z } / 2D { y, z } objects so this module stays headless-testable,
// and the three.js classes own the scratch objects on the hot path.
//
// This module decides *how the body and fist should read* during a punch:
//   • wind-up: the fist draws back along the raised arm, the body coils (yaw
//     twist) and squashes — all scaled by charge, so a tap jab is nearly flat
//     while a held smash escalates into an unmistakable telegraph;
//   • strike: a front-loaded snap curve (most travel happens in the first
//     quarter) with a small follow-through wave, then a springy recover;
//   • recoil: an underdamped spring that flinches the fist backward on a parry
//     or on punching a heavy object, and decays naturally to rest.
//
// The visual application (arm pivot rotations, fist offsets, scale composition,
// trail ghosts) lives in Dweeb.js / Fx.js — never here. Nothing here touches
// physics, hitboxes, damage, or timing: these are presentation values only.

/** Tuning for every curve (all overrideable per-call via `opts`). */
export const PUNCH_DEFAULTS = {
  armLen: 0.32,                    // arm pivot → fist length (mirrors DweebModel)
  minSy: 0.55,                     // lowest allowed Y scale before sideways bulging clamps
  windup: {
    pullMax: 0.34,                 // m, max retract along the raised arm at charge 1
    twistMax: 0.5,                 // rad, max body yaw coil at charge 1 (right shoulder back)
    squashMax: 0.16,               // extra Y compression at charge 1 (sy = 1 − squash)
    pullPow: 1.4,                  // >1: the draw builds late — the telegraph escalates
    twistPow: 1.8,
    squashPow: 1.5,
    cockBase: 0.55,                // rad, chamber pitch at charge 0 (arm cocked up-back)
    cockPerCharge: 0.95,           // rad extra chamber per unit charge
    armRz: 0.9,                    // rad, sideways spread while chambered (wide stance arm)
  },
  punch: {                         // uncharged tap jab
    minPull: 0.06,                 // m, tiny fixed draw so even a tap has a readable chamber
    extend: 0.5,                   // m, full extension past the rest reach on impact
    extensionRx: -1.35,            // rad, punch extension pitch (≈ −77°, fist at shoulder height)
    strikeDuration: 0.13,          // s
    recoverDuration: 0.18,         // s
    trailStrength: 0.3,            // max trail intensity (0..1)
  },
  smash: {                         // charged smash
    extend: 0.62,
    extensionRx: -1.5,             // rad, deeper sweep (−86° ≈ horizontal)
    strikeBase: 0.16,              // s at charge 0
    strikeCharge: 0.06,            // s extra per unit charge (heavier commits read longer)
    recoverBase: 0.2,
    recoverCharge: 0.08,
    trailStrength: 1,
  },
  strike: {
    snapPow: 0.52,                 // <1: front-loaded velocity — the snap is a shock
    overshootK: 0.12,              // amplitude of the follow-through wave (sin·(1−p))
    impactAt: 0.38,                // normalized progress of peak speed (FX hooks read this)
    uncoilPow: 1.2,                // twist/tension release exponent during extension
  },
  recoil: {
    stiffness: 70,
    damping: 11,                   // underdamped: one visible wobble, then settle
    maxDisp: 0.24,                 // m, clamp so recoil never launches the fist silly
    twistPerM: 1.0,                // rad of body flinch per metre of recoil displacement
    squashPerM: 0.4,               // extra Y compression per metre of recoil displacement
    parryImpulse: 1.1,             // m/s spring kick on a connected parry
    heavyFrom: 2.5,                // mass threshold (mirrors handRig HEAVY_MASS)
    heavyBase: 0.22,               // m/s recoil when punching a heavy object
    heavyPerMass: 0.07,            // m/s extra per unit mass above the threshold
    heavyChargeK: 0.2,             // m/s extra at full charge
    heavyMax: 1.0,
  },
  trail: { points: 8 },            // keyframes sampled along the strike sweep
};

/** Fresh zero pose object. Allocate once per Dweeb and pass to updatePunch as
 *  `out` every frame, so the hot path never allocates. */
export function makePunchPose() {
  return {
    phase: 'idle',
    mode: null,
    charge: 0,
    armRx: 0,
    armRz: 0,
    handRetract: 0,
    twist: 0,
    scale: { sy: 1, sxz: 1 },
    trail: { active: false, strength: 0 },
    head2d: { y: 0, z: 0 },
  };
}

/** Fresh per-Dweeb state. Create once in the constructor, pass in every frame. */
export function makePunchState() {
  return {
    phase: 'idle',                 // 'idle' | 'windup' | 'strike' | 'recover'
    t: 0,                          // seconds in the current phase
    lock: { charge: 0, mode: null }, // charge snapshot + 'punch'|'smash' locked at release
    recoil: { disp: 0, vel: 0 },   // m, m/s along the arm (positive = fist pulled in)
  };
}

/** Clamp helper (kept tiny, no import). */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Negate but keep the signed zero a clean +0 (so Object.is equality holds). */
function neg(v) {
  return v === 0 ? 0 : -v;
}

/** smoothstep in [0,1]. */
function smoothstep(p) {
  return p * p * (3 - 2 * p);
}

/**
 * Wind-up amounts from a charge value. `pull` is the draw-back along the raised
 * arm (m, ≥ punch.minPull), `twist` the body yaw coil (rad), `squash` the extra
 * Y compression (such that sy = 1 − squash). All monotonic increasing in charge.
 */
function windupAmounts(c, P) {
  const W = P.windup;
  const pull = P.punch.minPull + (W.pullMax - P.punch.minPull) * Math.pow(c, W.pullPow);
  const twist = W.twistMax * Math.pow(c, W.twistPow);
  const squash = W.squashMax * Math.pow(c, W.squashPow);
  return { pull, twist, squash };
}

/**
 * The strike snap profile: fraction of the full arm sweep travelled at
 * normalized progress `p`. Front-loaded (p^snapPow with snapPow < 1 gives an
 * initial velocity spike) plus a small follow-through wave that returns exactly
 * to 1 at p = 1.
 */
function strikeS(p, P) {
  const S = P.strike;
  return Math.pow(p, S.snapPow) + S.overshootK * Math.sin(Math.PI * p) * (1 - p);
}

/** Strike duration (s) for the locked mode/charge. */
function strikeDurationFor(lock, P) {
  if (lock.mode === 'smash') return P.smash.strikeBase + P.smash.strikeCharge * lock.charge;
  return P.punch.strikeDuration;
}

/** Recover duration (s) for the locked mode/charge. */
function recoverDurationFor(lock, P) {
  if (lock.mode === 'smash') return P.smash.recoverBase + P.smash.recoverCharge * lock.charge;
  return P.punch.recoverDuration;
}

/** Extension pitch (rad) for the locked mode. */
function extensionRxFor(lock, P) {
  return lock.mode === 'smash' ? P.smash.extensionRx : P.punch.extensionRx;
}

/** Arm pitch angle (rad) at strike progress `p` for the locked mode/charge. */
function armAngleFor(lock, p, P) {
  const cock = P.windup.cockBase + P.windup.cockPerCharge * lock.charge;
  const ext = extensionRxFor(lock, P);
  return cock + (ext - cock) * strikeS(p, P);
}

/** Retract along the arm (m) at strike progress `p` (positive = chambered). */
function retractFor(lock, p, P) {
  const pull = P.punch.minPull + (P.windup.pullMax - P.punch.minPull) * Math.pow(lock.charge, P.windup.pullPow);
  return pull * (1 - strikeS(p, P));
}

/** Volume-preserving scale from an additive Y ratio off 1 (sy·sxz² ≈ 1). */
function scaleFromSy(sy, P, out) {
  const syClamped = Math.max(P.minSy, sy);
  const sxz = 1 / Math.sqrt(syClamped);
  out.scale.sy = syClamped;
  out.scale.sxz = sxz;
  return out;
}

/**
 * Begin the wind-up (call when an attack charge starts). Idempotent from
 * 'windup'; also allowed from 'idle'/'recover'/'strike' so rapid re-taps chain.
 */
export function beginWindup(state) {
  state.phase = 'windup';
  state.t = 0;
  return state;
}

/**
 * Release the strike. Locks the charge snapshot and the mode; `kind` is the
 * combat's `atk.kind` ('punch' | 'smash') — when omitted, the mode is derived
 * from charge (≥ 0.2 → 'smash'), matching CombatSystem's threshold. Allowed
 * from any phase (a bot or buffered attack may skip the wind-up entirely).
 */
export function releaseStrike(state, charge = 0, kind = null) {
  const mode = kind === 'punch' || kind === 'smash' ? kind : (charge >= 0.2 ? 'smash' : 'punch');
  state.lock.charge = clamp(charge, 0, 1);
  state.lock.mode = mode;
  state.phase = 'strike';
  state.t = 0;
  return state;
}

/**
 * Hard interrupt (hitstun, ragdoll, grab, ledge, roll, freeze, KO…): drop back
 * to idle immediately. The recoil spring is kept so a mid-punch interruption
 * still shows the flinch.
 */
export function interruptPunch(state) {
  state.phase = 'idle';
  state.t = 0;
  state.lock.mode = null;
  return state;
}

/** Recoil impulse strength (m/s) for a connected parry. */
export function parryRecoilStrength(opts = {}) {
  const R = { ...PUNCH_DEFAULTS.recoil, ...opts.recoil };
  return R.parryImpulse;
}

/**
 * Recoil impulse strength (m/s) for punching a heavy object, scaled by its mass
 * above the heavy threshold and by the charge behind the punch.
 */
export function heavyRecoilStrength(mass, charge = 0, opts = {}) {
  const R = { ...PUNCH_DEFAULTS.recoil, ...opts.recoil };
  const over = Math.max(0, (mass ?? 0) - R.heavyFrom);
  return clamp(R.heavyBase + over * R.heavyPerMass + charge * R.heavyChargeK, R.heavyBase, R.heavyMax);
}

/**
 * Kick the recoil spring (add velocity along the flinch direction). `strength`
 * is an impulse in m/s — use parryRecoilStrength()/heavyRecoilStrength().
 */
export function applyRecoilImpulse(state, strength = 1) {
  state.recoil.vel += strength;
  return state;
}

/**
 * Advance the state machine by `dt` and write the current pose into `out`
 * (reused by the caller — no allocation). `driverCharge` is the live charge
 * (e.g. `d.charging`) used while winding up, so the pose ramps with the hold.
 *
 * Returns `out` (or a fresh pose object when `out` is null).
 */
export function updatePunch(state, dt, driverCharge = 0, opts = {}, out = null) {
  const P = { ...PUNCH_DEFAULTS, ...opts };
  const d = clamp(dt || 0, 0, 0.1);

  // Recoil spring (semi-implicit Euler), integrated every frame regardless of
  // phase so a flinch also decays while idle.
  if (d > 0) {
    const R = P.recoil;
    state.recoil.vel += (-R.stiffness * state.recoil.disp - R.damping * state.recoil.vel) * d;
    state.recoil.disp += state.recoil.vel * d;
    const maxDisp = R.maxDisp;
    if (state.recoil.disp > maxDisp) {
      state.recoil.disp = maxDisp;
      state.recoil.vel = Math.min(0, state.recoil.vel);
    } else if (state.recoil.disp < -maxDisp) {
      state.recoil.disp = -maxDisp;
      state.recoil.vel = Math.max(0, state.recoil.vel);
    }
  }

  if (state.phase === 'strike') {
    state.t += d;
    if (state.t >= strikeDurationFor(state.lock, P)) {
      state.phase = 'recover';
      state.t = 0;
    }
  } else if (state.phase === 'recover') {
    state.t += d;
    if (state.t >= recoverDurationFor(state.lock, P)) {
      state.phase = 'idle';
      state.t = 0;
      state.lock.mode = null;
    }
  }

  return punchPose(state, driverCharge, P, out);
}

/**
 * Compute the current pose from the state. Normally called via updatePunch;
 * exported so tests (and a harness that wants a pose without advancing) can
 * sample it directly.
 *
 * Pose fields (all numbers; `scale` and `trail` are objects):
 *   phase        'idle' | 'windup' | 'strike' | 'recover'
 *   mode         'punch' | 'smash' | null
 *   charge       0..1 (live while winding, locked after release)
 *   armRx        rad — desired pitch for the punching arm pivot (0 = use the
 *                locomotion/held pose; the wiring only overrides when phase ≠ idle)
 *   armRz        rad — sideways spread for the punching arm pivot
 *   handRetract  m — extra distance of the fist along the arm from its rest
 *                position (positive = chambered deeper; negative = press-through).
 *                Apply as `fistMesh.position.y = -(armLen + handRetract)`.
 *   twist        rad — body yaw coil. Negative = right shoulder back (the load
 *                for a right punch); wire `rig.rotation.y = twist`.
 *   scale        { sy, sxz } — volume-preserving punch envelope (sy·sxz² ≈ 1).
 *                Compose multiplicatively with the locomotion scale.
 *   trail        { active, strength } — strength 0..1 for pooled trail spawns.
 *   head2d      { y, z } — fist position in the sagittal plane (up = +y,
 *                forward = +z), for trail geometry that must not depend on the
 *                three.js transform stack.
 */
export function punchPose(state, driverCharge = 0, opts = {}, out = null) {
  const P = { ...PUNCH_DEFAULTS, ...opts };
  const pose = out ?? makePunchPose();
  pose.phase = state.phase;
  pose.mode = state.lock.mode;

  const recoilDisp = state.recoil.disp;
  const R = P.recoil;

  if (state.phase === 'windup') {
    const c = clamp(driverCharge, 0, 1);
    const { pull, twist, squash } = windupAmounts(c, P);
    pose.charge = c;
    pose.armRx = P.windup.cockBase + P.windup.cockPerCharge * c;
    pose.armRz = P.windup.armRz;
    pose.handRetract = pull + recoilDisp;
    pose.twist = neg(twist + recoilDisp * R.twistPerM);
    scaleFromSy(1 - squash - recoilDisp * R.squashPerM, P, pose);
    pose.trail.active = false;
    pose.trail.strength = 0;
  } else if (state.phase === 'strike') {
    const lock = state.lock;
    const dur = strikeDurationFor(lock, P);
    const p = dur > 0 ? clamp(state.t / dur, 0, 1) : 1;
    const s = strikeS(p, P);
    const { pull, twist, squash } = windupAmounts(lock.charge, P);
    pose.charge = lock.charge;
    pose.armRx = armAngleFor(lock, p, P);
    pose.armRz = 0.1;
    pose.handRetract = pull * (1 - s) + recoilDisp;
    pose.twist = neg(twist * Math.pow(1 - p, P.strike.uncoilPow) + recoilDisp * R.twistPerM);
    scaleFromSy(1 - squash * (1 - 1.6 * s) - recoilDisp * R.squashPerM, P, pose);
    const maxTrail = lock.mode === 'smash' ? P.smash.trailStrength : P.punch.trailStrength;
    pose.trail.active = true;
    pose.trail.strength = clamp(maxTrail * (0.25 + 0.75 * s), 0, 1);
  } else if (state.phase === 'recover') {
    const lock = state.lock;
    const dur = recoverDurationFor(lock, P);
    const u = dur > 0 ? clamp(state.t / dur, 0, 1) : 1;
    const ext = extensionRxFor(lock, P);
    pose.charge = lock.charge;
    pose.armRx = ext + (0.12 - ext) * smoothstep(u);
    pose.armRz = 0.1 + 0.3 * (1 - u);
    pose.handRetract = -0.02 * Math.sin(Math.PI * u) + recoilDisp;
    pose.twist = neg(recoilDisp * R.twistPerM);
    scaleFromSy(1 - 0.04 * Math.sin(Math.PI * u) * (1 - u) - recoilDisp * R.squashPerM, P, pose);
    const maxTrail = lock.mode === 'smash' ? P.smash.trailStrength : P.punch.trailStrength;
    pose.trail.active = true;
    pose.trail.strength = clamp(maxTrail * (1 - u), 0, 1);
  } else {
    pose.charge = 0;
    pose.armRx = 0;
    pose.armRz = 0;
    pose.handRetract = recoilDisp;
    pose.twist = neg(recoilDisp * R.twistPerM);
    scaleFromSy(1 - recoilDisp * R.squashPerM, P, pose);
    pose.trail.active = false;
    pose.trail.strength = 0;
  }

  // Current fist position in the sagittal plane (pivot at origin, arm length
  // from the default, along the arm axis).
  const len = P.armLen + pose.handRetract;
  pose.head2d.y = -Math.cos(pose.armRx) * len;
  pose.head2d.z = -Math.sin(pose.armRx) * len;

  return pose;
}

/**
 * Sample `P.trail.points` keyframes of the fist's path through the strike sweep
 * in sagittal-plane coordinates ({ y, z }, up = +y, forward = +z). The wiring
 * maps these into world space with the body's facing and shoulder offset to
 * draw a pooled trail ribbon or ghost fists. `out.points` is a caller-provided
 * reusable array of { y, z } objects; `out.count` receives the fill count.
 */
export function trailPath(state, opts = {}, out = null) {
  const P = { ...PUNCH_DEFAULTS, ...opts };
  const n = Math.max(2, P.trail.points);
  const lock = state.lock.mode ? state.lock : { charge: 0, mode: 'punch' };
  const pts = out ? out.points : Array.from({ length: n }, () => ({ y: 0, z: 0 }));
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const a = armAngleFor(lock, p, P);
    const len = P.armLen + retractFor(lock, p, P);
    pts[i].y = -Math.cos(a) * len;
    pts[i].z = -Math.sin(a) * len;
  }
  if (out) {
    out.count = n;
    return out;
  }
  return { points: pts, count: n };
}
