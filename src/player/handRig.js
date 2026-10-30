// handRig.js — pure math for expressive hands & reach (Round 1).
//
// Zero dependencies: no three.js, no DOM, no non-deterministic RNG. Every vector is
// a plain { x, y, z } object so this module stays headless-testable, and the three.js
// classes own the scratch objects on the hot path.
//
// This module decides *where the hands want to be* (grip-point selection, one/two-hand
// decision, 2-bone-ish reach solve, spring follow, squash-on-accel). The visual hand
// meshes and the per-frame wiring live in DweebModel.js / Dweeb.js — never here.

/** Arm segment lengths (m) for the 2-bone-ish reach solve. */
export const ARM_LENGTHS = { upper: 0.16, forearm: 0.18 };

/** Mass at/above which a hold becomes two-handed (mirrors BALANCE.carry.heavyFrom). */
export const HEAVY_MASS = 2.5;

/**
 * Per-archetype hand shape metadata, consumed by DweebModel's geometry builder.
 * Every roster type gets an entry; `kind` selects the builder, the rest tune it:
 *   scale   — overall hand size relative to the stock hand
 *   squash  — how much the hand squashes when an arm accelerates
 *   extras  — per-kind detail count (spikes, fingers, pads, wobble)
 */
export const HAND_SHAPES = {
  cube:        { kind: 'mitt',      scale: 1.0,  squash: 0.3,  extras: 0 },
  blob:        { kind: 'gooeyDrop', scale: 0.95, squash: 0.55, extras: 0.8 },
  spiky:       { kind: 'knuckles',  scale: 1.0,  squash: 0.25, extras: 4 },
  bunny:       { kind: 'paw',       scale: 0.9,  squash: 0.45, extras: 0 },
  boxer:       { kind: 'glove',     scale: 1.25, squash: 0.25, extras: 0 },
  plunger:     { kind: 'suction',   scale: 1.15, squash: 0.35, extras: 0 },
  puddle:      { kind: 'blob',      scale: 0.85, squash: 0.6,  extras: 0.6 },
  peep:        { kind: 'mitt',      scale: 0.8,  squash: 0.35, extras: 0 },
  starry:      { kind: 'mitt',      scale: 0.9,  squash: 0.35, extras: 0 },
  ghosty:      { kind: 'blob',      scale: 0.9,  squash: 0.5,  extras: 0.4 },
  bean:        { kind: 'mitt',      scale: 0.95, squash: 0.35, extras: 0 },
  tadpole:     { kind: 'mitt',      scale: 0.85, squash: 0.4,  extras: 0 },
  chonk:       { kind: 'mitt',      scale: 1.1,  squash: 0.25, extras: 0 },
  boing:       { kind: 'mitt',      scale: 1.0,  squash: 0.3,  extras: 0 },
  stalky:      { kind: 'blob',      scale: 0.9,  squash: 0.5,  extras: 0.5 },
  tri_cloud:   { kind: 'blob',      scale: 0.8,  squash: 0.5,  extras: 0.5 },
  gumball:     { kind: 'mitt',      scale: 1.0,  squash: 0.3,  extras: 0 },
  bumpy:       { kind: 'mitt',      scale: 0.95, squash: 0.3,  extras: 0 },
  cyclops:     { kind: 'blob',      scale: 0.9,  squash: 0.45, extras: 0.4 },
  blink:       { kind: 'mitt',      scale: 0.9,  squash: 0.35, extras: 0 },
  floppy:      { kind: 'paw',       scale: 0.9,  squash: 0.45, extras: 0 },
  triclops:    { kind: 'mitt',      scale: 0.95, squash: 0.35, extras: 0 },
  rolling_eye: { kind: 'blob',      scale: 0.9,  squash: 0.45, extras: 0.4 },
  sherbet:     { kind: 'mitt',      scale: 0.9,  squash: 0.35, extras: 0 },
  antenna:     { kind: 'mitt',      scale: 0.85, squash: 0.35, extras: 0 },
  blockhead:   { kind: 'mitt',      scale: 1.0,  squash: 0.3,  extras: 0 },
};

export const DEFAULT_HAND_SHAPE = { kind: 'mitt', scale: 1, squash: 0.35, extras: 0 };

/** Shape metadata for a Dweeb archetype (falls back to the stock mitt). */
export function handShapeFor(type) {
  return HAND_SHAPES[type] ?? DEFAULT_HAND_SHAPE;
}

/**
 * One vs two-handed hold decision by object mass.
 * At/above the threshold the hold is two-handed (heavy lift); below it is one-handed
 * (light swing). The default threshold matches BALANCE.carry.heavyFrom.
 */
export function decideOneOrTwoHanded(mass, threshold = HEAVY_MASS) {
  return mass >= threshold ? 'two' : 'one';
}

/**
 * Volume-preserving squash-on-accel: arm acceleration compresses the hand along Y
 * and bulges it sideways. Reads exactly like the toy squish on a sudden grab/swing.
 * Returns { sy, sxz } with sy · sxz² ≈ 1.
 */
export function squashOnAccel(vel, prevVel, dt, opts = {}) {
  const k = opts.k ?? 0.018;
  const maxSquash = opts.maxSquash ?? 0.45;
  const ax = vel.x - prevVel.x;
  const ay = vel.y - prevVel.y;
  const az = vel.z - prevVel.z;
  const accel = Math.hypot(ax, ay, az) / Math.max(dt, 1e-4);
  const sq = Math.min(maxSquash, accel * k);
  const sy = 1 - sq;
  return { sy, sxz: 1 / Math.sqrt(Math.max(0.4, sy)) };
}

/**
 * Derived grip points from an object def — used when the def carries no explicit
 * `gripPoints` data (the data-driven route the plan adds to ObjectRegistry).
 *
 * Points are in object-local space (model centered on the physics body, +Z is the
 * front/contact face). Heavy holds get two wide points low on the front face; light
 * holds get a single centered point.
 */
export function defaultGripPoints(def) {
  if (!def) return { oneHand: [{ x: 0, y: -0.1, z: 0.3 }], twoHand: [] };
  const d = def.dims ?? {};
  const vs = def.visualScale ?? [1, 1, 1];
  const shape = def.shape ?? 'box';
  const radius = d.radius ?? 0.3;
  let ex, ey, ez;
  if (shape === 'sphere') {
    ex = radius * vs[0]; ey = radius * vs[1]; ez = radius * vs[2];
  } else if (shape === 'capsule') {
    ex = radius * vs[0];
    ey = (d.halfHeight ?? 0.2) + radius * vs[1];
    ez = radius * vs[2];
  } else if (shape === 'cylinder') {
    ex = radius * vs[0];
    ey = (d.halfHeight ?? 0.25) * vs[1];
    ez = radius * vs[2];
  } else {
    ex = (d.hx ?? 0.3) * vs[0];
    ey = (d.hy ?? 0.3) * vs[1];
    ez = (d.hz ?? 0.3) * vs[2];
  }
  // Reach a little way onto the object so the hand visually lands on its surface.
  const front = Math.max(ez, ex * 0.35, 0.15);
  const heavy = decideOneOrTwoHanded(def.mass ?? 1) === 'two';
  if (heavy) {
    return {
      oneHand: [{ x: 0, y: -ey * 0.35, z: front }],
      twoHand: [
        { x: -ex * 0.55, y: -ey * 0.25, z: front },
        { x: ex * 0.55, y: -ey * 0.25, z: front },
      ],
    };
  }
  return {
    oneHand: [{ x: 0, y: -ey * 0.2, z: front }],
    twoHand: [],
  };
}

/**
 * Hand-authored grip points for objects whose model orientation needs bespoke data
 * (hammer handle, glove cuff, anvil waist, ray trigger…). Sample data intended to be
 * promoted into ObjectRegistry as `def.gripPoints` (identical schema); it lives here
 * so the module is self-contained and testable until that wiring lands.
 */
export const GRIP_OVERRIDES = {
  giantHammer: {
    oneHand: [{ x: 0, y: -0.2, z: -0.45 }],
    twoHand: [
      { x: -0.06, y: -0.24, z: -0.5 },
      { x: 0.06, y: -0.24, z: -0.5 },
    ],
  },
  boxingGlove: { oneHand: [{ x: 0, y: 0, z: -0.25 }], twoHand: [] },
  freezeRay: { oneHand: [{ x: 0, y: -0.08, z: 0.05 }], twoHand: [] },
  anvil: {
    oneHand: [{ x: 0, y: -0.02, z: 0 }],
    twoHand: [
      { x: -0.12, y: -0.02, z: 0 },
      { x: 0.12, y: -0.02, z: 0 },
    ],
  },
  melonCannon: { oneHand: [{ x: 0, y: -0.1, z: -0.35 }], twoHand: [] },
  magnet: { oneHand: [{ x: 0, y: -0.24, z: 0 }], twoHand: [] },
  extinguisher: { oneHand: [{ x: 0, y: -0.16, z: 0.02 }], twoHand: [] },
};

/**
 * Resolve the grip points that will actually be used for a held object.
 * Precedence: explicit `def.gripPoints` → `GRIP_OVERRIDES[key]` → derivation.
 * The returned `points` array is already matched to the one/two-hand mode: one point
 * for a one-handed hold, two points for a two-handed hold (both hands, in order).
 */
export function selectGripPoints(def, mass, opts = {}) {
  const threshold = opts.threshold ?? HEAVY_MASS;
  const mode = decideOneOrTwoHanded(mass, threshold);
  if (!def) return { mode, points: [{ x: 0, y: -0.1, z: 0.3 }] };
  const key = opts.key ?? def.key;
  const base = def.gripPoints ?? GRIP_OVERRIDES[key] ?? defaultGripPoints(def);
  let list;
  if (mode === 'two') {
    if (base.twoHand.length) {
      list = base.twoHand;
    } else if (base.oneHand.length) {
      // No authored two-hand grip: mirror the lone point so the hands sit on
      // opposite sides of the object.
      const p = base.oneHand[0];
      list = [p, { x: -p.x, y: p.y, z: p.z }];
    } else {
      list = [];
    }
  } else {
    list = base.oneHand;
  }
  return { mode, points: list };
}

/**
 * 2-bone-ish reach solve. Places the hand at `target` (clamped to arm length) and
 * pops an elbow midway along the chain, bowed sideways by `side` (±1) with a droop,
 * so reaching reads as a bent arm instead of a rigid stick.
 *
 * @param shoulder {x,y,z} world-space shoulder origin
 * @param target {x,y,z} desired hand position (world)
 * @param opts { upper, forearm, maxArmLen, side, bend, droop }
 * @returns { elbow, hand, clamped } — `hand` is the endpoint the hand mesh should
 *   occupy; `clamped` is true when the target exceeded max arm length (and was
 *   shortened); `elbow` is decorative (joint visual).
 */
export function solveReach(shoulder, target, opts = {}, out = null) {
  const upper = opts.upper ?? ARM_LENGTHS.upper;
  const forearm = opts.forearm ?? ARM_LENGTHS.forearm;
  const maxLen = opts.maxArmLen ?? upper + forearm;
  const side = opts.side ?? 1;
  const bend = opts.bend ?? 0.4;
  const droop = opts.droop ?? 0.05;

  let dx = target.x - shoulder.x;
  let dy = target.y - shoulder.y;
  let dz = target.z - shoulder.z;
  let len = Math.hypot(dx, dy, dz);
  let clamped = false;
  if (len < 1e-4) {
    dx = 0; dy = -0.1; dz = 1; len = 1; // degenerate: reach forward-down
  }
  if (len > maxLen) {
    const k = maxLen / len;
    dx *= k; dy *= k; dz *= k;
    len = maxLen;
    clamped = true;
  }
  const ux = dx / len, uy = dy / len, uz = dz / len;

  // A perpendicular to the reach direction that stays mostly horizontal, so the elbow
  // bows outward rather than twisting vertically: cross(u, up) = (-uz, 0, ux).
  // If the reach is near-vertical, fall back to the X axis.
  const cx = -uz, cy = 0, cz = ux;
  const cl = Math.hypot(cx, cy, cz);
  let px, py, pz;
  if (cl < 1e-4) { px = 1; py = 0; pz = 0; }
  else { px = cx / cl; py = cy / cl; pz = cz / cl; }

  const mid = 0.5;
  const elbow = {
    x: shoulder.x + ux * upper * mid + px * upper * bend * side,
    y: shoulder.y + uy * upper * mid + py * upper * bend * side - droop,
    z: shoulder.z + uz * upper * mid + pz * upper * bend * side,
  };
  const hand = {
    x: shoulder.x + ux * len,
    y: shoulder.y + uy * len,
    z: shoulder.z + uz * len,
  };
  if (out) {
    out.elbow = elbow;
    out.hand = hand;
    out.clamped = clamped;
    return out;
  }
  return { elbow, hand, clamped };
}

/**
 * Damped spring integrator (semi-implicit Euler) for the hands' follow lag.
 * `state` is { current: {x,y,z}, vel: {x,y,z} } and is mutated in place and returned,
 * so the hot loop reuses one state object per hand without allocating.
 */
export function springStep(state, target, dt, opts = {}) {
  const stiffness = opts.stiffness ?? 60;
  const damping = opts.damping ?? 12;
  const c = state.current, v = state.vel;
  const ax = -stiffness * (c.x - target.x) - damping * v.x;
  const ay = -stiffness * (c.y - target.y) - damping * v.y;
  const az = -stiffness * (c.z - target.z) - damping * v.z;
  v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
  c.x += v.x * dt; c.y += v.y * dt; c.z += v.z * dt;
  return state;
}

/** Fresh spring state for one hand (identity rest pose at (x, y, z)). */
export function makeSpringState(x = 0, y = 0, z = 0) {
  return { current: { x, y, z }, vel: { x: 0, y: 0, z: 0 } };
}
