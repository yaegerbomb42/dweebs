// src/sim/checksum.js — desync detection.
//
// A desync is invisible until two clients visibly disagree, by which point it is minutes old and
// nearly impossible to attribute. So every tick can be reduced to one short hash, and the hash is
// logged at keyframes on both ends: the first tick where the strings differ is the first moment
// the two simulations were provably not the same simulation.
//
// Three deliberate design choices, all of which exist to make that first-differing-tick useful:
//
//  1. COARSE QUANTIZATION. Positions are rounded to 1 cm, velocities to 0.01 m/s, percent to 0.1.
//     A checksum that reacted to float noise in the 15th digit would fire constantly and mean
//     nothing. Rounding to 1 cm means a real divergence (a body in a different place, a stock
//     that did not happen) trips it, and a re-summoned float does not.
//
//  2. STRUCTURE, NOT LENGTH. Instead of hashing a concatenated string, each field is folded into
//     the hash separately with its own tag. A field that goes missing changes the hash, and so
//     does a field appearing in the wrong slot — which a naive `join()` would not catch.
//
//  3. INCLUDES THE CLOCK. Tick, time, stocks, percent, phase and the RNG state all go in. Most
//     desyncs in practice are a rules desync (a stock not consumed, a phase that ran long) and
//     not a positional one, so the checksum has to see rules state, not just bodies.

import { TICK_HZ } from './contracts.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A streaming FNV-1a over the exact integer bytes of the fields we care about. */
export class Hasher {
  constructor() { this.h = FNV_OFFSET; }

  /** @param {number} v an integer, already quantized */
  int(v) {
    // Coerce to a signed 32-bit int so the same field always hashes the same way, then mix
    // through Math.imul — the one multiply ECMAScript defines exactly.
    let x = v | 0;
    this.h = Math.imul(this.h ^ (x & 0xff), FNV_PRIME);
    this.h = Math.imul(this.h ^ ((x >>> 8) & 0xff), FNV_PRIME);
    this.h = Math.imul(this.h ^ ((x >>> 16) & 0xff), FNV_PRIME);
    this.h = Math.imul(this.h ^ ((x >>> 24) & 0xff), FNV_PRIME);
    return this;
  }

  /** Quantize a float to `scale` decimals and hash it. Non-finite values get a loud sentinel. */
  num(v, scale = 100) {
    if (!Number.isFinite(v)) return this.int(0x7fffffff);
    return this.int(Math.round(v * scale));
  }

  /** Tag a field so its position in the struct is part of the hash. */
  tag(name) {
    let h = this.h;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), FNV_PRIME);
    this.h = h;
    return this;
  }

  /** @returns {string} 8 lowercase hex chars */
  hex() {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

/**
 * Hash a whole sim state into one short string.
 *
 * @param {import('./contracts.js').SimState} state
 * @param {object} [extra] optional extra state that must participate: { rng, tick, time,
 *        phase, round, roundWins, timer, blastSide, ids, itemCount }
 * @returns {string}
 */
export function checksumOf(state, extra = {}) {
  const h = new Hasher();
  h.tag('tick').int(extra.tick ?? state.tick ?? 0);
  h.tag('time').num(extra.time ?? 0, TICK_HZ);
  h.tag('phase').int(phaseCode(extra.phase ?? state.phase));

  for (const d of state.dweebs) {
    h.tag('d').int(d.id).int(d.slot);
    for (let i = 0; i < 3; i++) h.num(d.pos[i], 100);   // 1 cm
    for (let i = 0; i < 3; i++) h.num(d.vel[i], 100);   // 0.01 m/s
    h.num(d.yaw, 100);
    h.num(d.percent, 10);
    h.int(d.stocks);
    h.int(d.active ? 1 : 0).int(d.out ? 1 : 0).int(d.eliminated ? 1 : 0).int(d.grounded ? 1 : 0);
    h.int(d.held).int(d.heldBy);
    h.num(d.style, 1);
  }

  for (const it of state.items) {
    h.tag('i').int(it.id).int(it.kind);
    for (let i = 0; i < 3; i++) h.num(it.pos[i], 100);
    h.int(it.heldBy).int(it.active ? 1 : 0);
  }

  h.tag('match').int(extra.round ?? state.round ?? 0);
  if (extra.roundWins) for (const w of extra.roundWins) h.int(w);
  h.num(extra.timer ?? state.timer ?? 0, TICK_HZ);
  h.int(extra.blastSide ? Math.round(extra.blastSide * 100) : 0);
  // The RNG state belongs in the hash: a sim that has drifted by one draw will differ here long
  // before its bodies visibly diverge, which makes it the cheapest early-warning field there is.
  if (extra.rng) h.int(extra.rng.s).int(extra.rng.draws);
  return h.hex();
}

/** Stable numeric code for a phase string, so the hash has a tag rather than a string. */
function phaseCode(phase) {
  switch (phase) {
    case 'menu': return 0;
    case 'countdown': return 1;
    case 'playing': return 2;
    case 'roundEnd': return 3;
    case 'results': return 4;
    default: return 9;
  }
}

/** Same hash, but kept stable across a session so two runs can be compared tick by tick. */
export { checksumOf as checksum };
