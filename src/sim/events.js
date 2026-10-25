// src/sim/events.js — the sim's one-way output channel.
//
// This is where `Dweeb.onHit`, `Dweeb.onKO` and `Dweeb.onFlail` (and the rest of the live
// callbacks main.js wires into Fx/Hud/audio) stop being callbacks and start being data.
//
// The change is not cosmetic. Callbacks are the reason the current code cannot run on a server:
// main.js builds a CameraController, an AudioManager, an Fx with particles and a Hud, and the
// gameplay objects hold references to all of them. So the loop can only run where a DOM and a
// WebGL context exist. Events invert that — the sim pushes plain objects into a queue and does
// not know or care whether anything is listening. The view subscribes after the fact.
//
// The other consequence, which is a feature: because the sim never reads events back, the
// presentation layer can be arbitrarily slow, late, or missing entirely without changing the
// outcome of a single tick. A client that drops a packet loses a sound; it does not desync.

import { EVENT_TYPES, EV } from './contracts.js';

/** Fast membership test for the event vocabulary, so a typo fails loudly at the call site. */
const VALID = new Set(EVENT_TYPES);

/**
 * A per-tick event buffer. Reused between ticks: `push` writes into pre-allocated slots, and
 * `drain` hands out a plain array of the same event objects. No per-event allocation in the hot
 * path matters here because a busy tick emits tens of events, not thousands.
 */
export class EventQueue {
  constructor() {
    /** @type {object[]} */ this.buffer = [];
    this.count = 0;
    this.tick = 0;
    // A ring of a few thousand event records, recycled forever. See above: the whole point is
    // that Fx and audio can be a frame late and we still never allocate in step().
    this._pool = [];
  }

  _slot() {
    return this._pool.pop() || { tick: 0, type: '', a: 0, b: 0, x: 0, y: 0, z: 0, mag: 0, kind: '', tier: 0 };
  }

  /**
   * Emit an event. Unknown types throw in dev — the event list is a contract, and a silent
   * typo here becomes a view that quietly never reacts to a KO.
   *
   * @param {string} type One of EVENT_TYPES.
   * @param {object} [f] Fields: { a, b, x, y, z, mag, kind, tier }.
   */
  emit(type, f) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && !VALID.has(type)) {
      throw new Error(`SimEvent type "${type}" is not in the published event list (contracts.js EV)`);
    }
    const e = this._slot();
    e.tick = this.tick;
    e.type = type;
    e.a = f?.a ?? 0;
    e.b = f?.b ?? 0;
    e.x = f?.x ?? 0;
    e.y = f?.y ?? 0;
    e.z = f?.z ?? 0;
    e.mag = f?.mag ?? 0;
    e.kind = f?.kind ?? '';
    e.tier = f?.tier ?? 0;
    this.buffer.push(e);
    return e;
  }

  /**
   * Hand over everything emitted since the last call.
   * Returns frozen copies: the pool records are recycled immediately, so a caller that
   * keeps the array can never see its events mutated by a later tick (aliasing fix).
   * @param {number} tick the tick these events belong to
   * @returns {object[]} plain array of frozen event snapshots, safe for the caller to keep
   */
  drain(tick = this.tick) {
    const out = this.buffer.map(e => Object.freeze({ ...e }));
    for (let i = 0; i < this.buffer.length; i++) this._pool.push(this.buffer[i]);
    this.buffer = [];
    this.tick = tick;
    return out;
  }

  /** Drop everything without recycling — used by restore(), where old events are meaningless. */
  clear() {
    for (let i = 0; i < this.buffer.length; i++) this._pool.push(this.buffer[i]);
    this.buffer = [];
  }
}

/**
 * The view side of the split: a tiny subscription table. The view registers handlers by event
 * name (or '*' for everything) and dispatches a drained batch through it.
 *
 * This is the only file the view needs in order to be rewritten against a remote sim: it takes
 * event objects, not sim objects, so an identical Hud/Fx/audio layer works for offline play and
 * for a client that has never seen the real game state.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */ this.handlers = new Map();
  }

  /**
   * @param {string} type An EVENT_TYPES value, or '*' for all.
   * @param {(e: object) => void} fn
   * @returns {() => void} unsubscribe
   */
  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, list = []);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * Dispatch a batch. Handlers are called in subscription order; '*' handlers run last, so a
   * catch-all logger never runs before the specific listener that produced the log line.
   * A throwing handler is caught: a broken sound must not take down the frame that skipped it.
   * @param {object[]} events
   */
  dispatch(events) {
    const all = this.handlers.get('*');
    for (const e of events) {
      const list = this.handlers.get(e.type);
      if (list) for (const fn of list) this._safe(fn, e);
      if (all) for (const fn of all) this._safe(fn, e);
    }
  }

  _safe(fn, e) {
    try { fn(e); } catch (err) { console.error(`[sim/eventbus] handler for "${e.type}" threw`, err); }
  }
}

export { EV, EVENT_TYPES };
