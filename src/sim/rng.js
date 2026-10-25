// src/sim/rng.js — the sim's only source of randomness.
//
// Why not Math.random(): it is unseedable and unrepeatable, so "same seed + same inputs ⇒ same
// checksum" is impossible and QA's determinism test could never pass. Everything reachable from
// Sim.step() draws from here instead.
//
// Two hard rules, and they are why this file is so small:
//   • No Math.sin / Math.cos / Math.pow / Math.tan / Math.log anywhere. Rapier is cross-platform
//     deterministic, but the JS around it is not: transcendentals may differ in the last bit
//     between engines and CPUs and that bit compounds. Use the integer hashes and the
//     `_trig.js` tables where an angle is needed.
//   • No floating point in the state. The whole state is two 32-bit integers, so snapshot() is a
//     couple of numbers and a restore is exact.
//
// Algorithm: mulberry32. Small, fast, passes gjrand's basic suite, and — the part that matters
// here — its output is derived purely from 32-bit integer ops (imul, xor, shifts, add), all of
// which are exactly specified by ECMAScript. So the same seed gives the same doubles on every
// engine that implements the language at all.


/**
 * A seeded, snapshotable PRNG.
 */
export class Rng {
  /** @param {number} seed Any 32-bit integer; hashed so nearby seeds don't correlate. */
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.s = 0;
    this.draws = 0;
    this.reset();
  }

  /** Rewind to the initial state for this seed. */
  reset() {
    // scramble the seed so seed 1 and seed 2 don't produce visibly related streams
    this.s = (this.seed ^ 0x9e3779b9) >>> 0;
    this.draws = 0;
    for (let i = 0; i < 4; i++) this.u32();
    this.draws = 0;
    return this;
  }

  /** @returns {number} the next uniform uint32 */
  u32() {
    this.draws++;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** @returns {number} uniform in [0, 1) */
  next() {
    return this.u32() / 4294967296;
  }

  /** @returns {number} uniform integer in [0, n) — n must be a positive integer */
  int(n) {
    if (n <= 0) return 0;
    return this.u32() % n;
  }

  /** @returns {number} uniform in [lo, hi) */
  range(lo, hi) {
    return lo + this.next() * (hi - lo);
  }

  /** @returns {number} uniform in [-a, a) */
  spread(a) {
    return (this.next() * 2 - 1) * a;
  }

  /**
   * Weighted pick. `weights` is a non-empty array of non-negative numbers; the last entry is not
   * used, matching the live drop table's cumulative-threshold loop. Ties resolve to the lower
   * index, so the pick is a pure function of (state, weights).
   * @param {number[]} weights
   * @returns {number} index in [0, weights.length - 1], or -1 if every weight is 0
   */
  weighted(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    if (total <= 0) return -1;
    // A 24-bit draw, not a float: float compares can differ in the last bit across engines, and
    // the whole point of the checksum is that this decision is identical everywhere.
    const r = (this.u32() >>> 8) / 16777216 * total;
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (r < acc) return i;
    }
    return weights.length - 1;
  }

  /** @returns {boolean} true with probability p */
  chance(p) {
    return this.next() < p;
  }

  /**
   * A unit vector on the floor, without Math.sin/Math.cos. Uses the rejection-free
   * concentric-disc mapping (Shirley–Chiu): u1, u2 → disc point, then a cheap normalize via
   * Math.sqrt (IEEE-exact) rather than hypot on a trig result.
   * @returns {{x: number, z: number}}
   */
  floorDir() {
    const u1 = this.next();
    const u2 = this.next() * 2 - 1;
    const f = 2 * u1 - 1;
    const r = f * f + u2 * u2;
    const s = r === 0 || r >= 1 ? 0 : 2 - Math.sqrt(r);
    return { x: f * s, z: u2 * s };
  }

  /** @returns {RngState} */
  snapshot() {
    return { s: this.s, draws: this.draws };
  }

  /** @param {RngState} st */
  restore(st) {
    this.s = st.s | 0;
    this.draws = st.draws | 0;
    return this;
  }
}

/**
 * Named independent streams. Combat jitter and drop-table rolls must not share a stream: if they
 * did, one extra draw in the drop table would shift every combat roll and the checksum would
 * diverge for a reason no debugger could explain. Each stream is seeded from the master seed by
 * hashing the name in, so a stream's values don't move when a *different* stream is added.
 */
export class RngStreams {
  /** @param {number} seed */
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    /** @type {Map<string, Rng>} */ this.streams = new Map();
    this.order = [];
  }

  /**
   * @param {string} name
   * @returns {Rng}
   */
  stream(name) {
    let r = this.streams.get(name);
    if (r) return r;
    r = new Rng((this.seed ^ hashString(name)) >>> 0);
    this.streams.set(name, r);
    this.order.push(name);           // insertion order = snapshot order = stable
    return r;
  }

  /** @returns {object} */
  snapshot() {
    /** @type {Record<string, RngState>} */ const out = {};
    for (const name of this.order) out[name] = this.streams.get(name).snapshot();
    return { seed: this.seed, order: [...this.order], streams: out };
  }

  /** @param {ReturnType<RngStreams['snapshot']>} st */
  restore(st) {
    this.seed = st.seed >>> 0;
    // Rebuild in the SNAPSHOT's order, and clear the insertion list first: `stream()` pushes onto
    // `order`, so restoring without clearing would append a second copy of every name and the
    // snapshot would grow a duplicate entry per restore. A restore must be idempotent.
    this.streams = new Map();
    this.order = [];
    for (const name of st.order) this.stream(name).restore(st.streams[name]);
    return this;
  }
}

/** FNV-1a over a string, folded into 32 bits. Used to derive a stream seed from its name. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
