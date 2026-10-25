// inputBuffer.js — per-player input queue with a jitter allowance (NET).
//
// The client stamps each input with the tick it belongs to and repeats the last
// INPUT_REDUNDANCY frames, so a single dropped packet costs nothing. The server
// consumes one input per tick; it may run up to JITTER_TICKS ahead of the newest
// input it has, after which it repeats the last known input so a lag spike is a
// brief slowdown rather than a stall, and never a teleport.

import { EMPTY_INPUT, INPUT_REDUNDANCY, sanitizeInput, NET } from './protocol.js';

export const JITTER_TICKS = NET.inputJitterTicks;    // 200 ms of runway before repeating
export const LOOKAHEAD_TICKS = NET.inputLookaheadTicks;   // 133 ms: the client's clock may lead

export class InputBuffer {
  constructor() {
    /** @type {Map<number, object>} tick -> sanitized input */
    this.pending = new Map();
    this.last = { ...EMPTY_INPUT };    // last consumed input, repeated on starvation
    this.lastTick = -1;
    this.starvedTicks = 0;             // > 0 means the client is behind the server
  }

  /**
   * Accept a redundant input packet. Older frames are dropped, newer ones applied.
   * @param {{tick:number, frames:object[]}} msg
   * @returns {boolean} false if the packet was unusable
   */
  push(msg) {
    if (!msg || !Number.isFinite(msg.tick) || !Array.isArray(msg.frames) || !msg.frames.length) return false;
    // frames[0] is the oldest of the last 3; tick labels the newest
    const newest = msg.tick;
    for (let i = msg.frames.length - 1; i >= 0; i--) {
      const t = newest - i;
      if (t <= this.lastTick) continue;         // already consumed — pure redundancy
      if (this.pending.has(t)) continue;
      this.pending.set(t, sanitizeInput(msg.frames[i]));
    }
    return true;
  }

  /**
   * Take the input to use for `tick`.
   *
   * We deliberately do NOT require an exact tick match, and we allow a small amount of
   * lookahead. The client stamps inputs with its own tick, and that clock runs ahead of
   * the server's by about half the RTT (that is the whole point of client-side
   * prediction). An exact-match buffer would therefore always starve, and the dweeb
   * would walk in slow motion. Instead we take the newest input within
   * LOOKAHEAD_TICKS — the jitter allowance — and if nothing is ready at all, a genuine
   * stall, we repeat the last input, which reads as a brief slowdown and never as a
   * teleport.
   */
  consume(tick) {
    const limit = tick + LOOKAHEAD_TICKS;
    let newest = -1;
    let input = null;
    for (const [t, i] of this.pending) {
      if (t <= limit && t > newest) { newest = t; input = i; }
    }
    if (input) {
      this.last = input;
      this.lastTick = newest;
      for (const t of this.pending.keys()) if (t <= newest) this.pending.delete(t);
      this.starvedTicks = 0;
      return this.last;
    }
    this.starvedTicks++;
    return this.last;
  }

  /** True when the client is so far behind that the server should notice. */
  get starving() { return this.starvedTicks > JITTER_TICKS; }
  get size() { return this.pending.size; }
}

export { INPUT_REDUNDANCY };
