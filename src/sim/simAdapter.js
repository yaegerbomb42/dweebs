// simAdapter.js — T1/T2: run the REAL src/sim/Sim behind the MockSim-shaped surface
// the server and NetClient already speak: step(inputsBySlot)->events, drainEvents(),
// entityById(id), list(), entities Map, botInputs(), snapshot(), restore(), checksum().
//
// Why an adapter instead of rewriting the callers: Room and NetClient were built and
// measured against MockSim wire-shaped entities ({id,x,y,z cm,q,flags,state,vx..}).
// The real Sim speaks SimState ({dweebs[],items[]} metres + float yaw). This file
// is the single translation point, so netcode stays untouched while physics underneath
// becomes authoritative. Entity mapping: dweeb slot s -> wire id s+1 (as MockSim),
// sim item id -> wire id 1000+itemId. Positions m->cm, yaw rad -> u8.
import { Sim } from './Sim.js';
import { EMPTY_INPUT, sanitizeInput } from '../net/protocol.js';
const ITEM_WIRE_BASE = 1000;
const TYPES = ['cube', 'blob', 'spiky'];
const COLORS = ['#8ec7ff', '#ffb37a', '#9dff8e', '#ff8ec7', '#ffe27a', '#8ed7ff', '#c4a0ff', '#a0ffd0'];
const yawToQ = yaw => ((Math.round((((yaw % 6.283185307179586) + 6.283185307179586) % 6.283185307179586) / 6.283185307179586 * 255) % 256 + 256) % 256);
const mToCm = v => Math.round(v * 100);
export function simEventToWire(e) {
  const kind = e.type === 'stockLost' || e.type === 'eliminated' ? 'ko'
    : e.type === 'splash' ? 'splash' : e.type === 'hit' || e.type === 'launch' ? 'hit'
    : e.type === 'attack' ? 'throw' : e.type === 'spawn' ? 'spawn' : e.type;
  return { kind, id: e.a ?? 0, x: mToCm(e.x || 0), y: mToCm(e.y || 0), z: mToCm(e.z || 0), a: e.b ?? 0, tick: e.tick ?? 0, simType: e.type, _cm: true };
}
export function dweebToWire(d, humans = 8) {
  const human = humans instanceof Set ? humans.has(d.slot) : d.slot < humans;
  return { id: d.slot + 1, kind: 'dweeb', slot: d.slot,
    x: mToCm(d.pos[0]), y: mToCm(d.pos[1]), z: mToCm(d.pos[2]),
    vx: mToCm(d.vel[0]), vy: mToCm(d.vel[1]), vz: mToCm(d.vel[2]),
    yaw: d.yaw ?? 0, q: yawToQ(d.yaw ?? 0),
    state: d.eliminated ? 3 : d.out ? 2 : 0, flags: d.isBot || !human ? 4 : 0,
    type: d.type, color: typeof d.color === 'number' ? '#' + d.color.toString(16).padStart(6, '0') : d.color, _cm: true };
}
export function itemToWire(it) {
  const sp2 = it.vel[0] ** 2 + it.vel[1] ** 2 + it.vel[2] ** 2;
  return { id: ITEM_WIRE_BASE + it.id, kind: 'item', slot: -1,
    x: mToCm(it.pos[0]), y: mToCm(it.pos[1]), z: mToCm(it.pos[2]),
    vx: mToCm(it.vel[0]), vy: mToCm(it.vel[1]), vz: mToCm(it.vel[2]),
    yaw: 0, q: 0, state: it.active ? 0 : 1, flags: (it.heldBy > 0 || sp2 > 64) ? 8 : 0,
    itemId: it.id, itemKey: it.key, heldBy: it.heldBy, _cm: true };
}
export class SimAdapter {
  constructor() { this.tick = 0; this.players = 8; this.humans = 0; this.humanSlots = new Set(); this.seats = []; this.entities = new Map(); this.events = []; this.sim = null; }
  // `humans` is a count (slots 0..n-1) or an array of human slots; `seats` lists the
  // slots to seat (default: all of them). Unseated slots have no dweeb at all.
  static async create({ players = 8, seed = 1, humans = 0, seats = null, config = {} } = {}) {
    const a = new SimAdapter();
    a.players = Math.min(players, 8);
    a.seats = (seats || [...Array(a.players).keys()]).filter(s => s >= 0 && s < a.players);
    a._setHumanSlots(humans);
    // Lobby rules arrive here: stocks / roundTime / items become the match's config,
    // which is why the server rebuilds the adapter when the host changes them.
    const { stocks, roundTime, items, ...rest } = config || {};
    const sim = new Sim({
      seed, botDifficulty: 'normal', ...rest,
      ...(stocks !== undefined ? { stocks } : {}),
      ...(roundTime !== undefined ? { roundTime } : {}),
      ...(items !== undefined ? { items } : {}),
    });
    await sim.init();
    for (const slot of a.seats) {
      sim.addSeat({ slot, name: 'P' + slot, type: TYPES[slot % TYPES.length], color: COLORS[slot % COLORS.length], isBot: !a.humanSlots.has(slot) });
    }
    sim.startMatch(); a.sim = sim; a._syncWire(); return a;
  }
  /** Keep the adapter honest about which seats are people (bot flags + bot inputs). */
  _setHumanSlots(h) {
    const slots = Array.isArray(h) ? h : [...Array(Math.max(0, Math.min(this.players, Number(h) || 0))).keys()];
    this.humanSlots = new Set(slots);
    this.humans = this.humanSlots.size;
  }
  setHumans(h) {
    this._setHumanSlots(h);
    if (this.sim) {
      for (const d of this.sim.getState().dweebs) {
        if (typeof d.isBot === 'boolean') d.isBot = !this.humanSlots.has(d.slot);
      }
      this._syncWire();
    }
  }
  _syncWire() {
    const st = this.sim.getState(); this.tick = this.sim.tick; this.entities.clear();
    for (const d of st.dweebs) this.entities.set(d.slot + 1, dweebToWire(d, this.humanSlots));
    for (const it of st.items) this.entities.set(ITEM_WIRE_BASE + it.id, itemToWire(it));
  }
  step(inputsBySlot) {
    const clean = new Map();
    if (inputsBySlot) for (const [slot, f] of inputsBySlot) clean.set(slot, sanitizeInput(f));
    const evs = this.sim.step(clean); this._syncWire();
    const wire = evs.map(simEventToWire); this.events.push(...wire); return wire;
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
  entityById(id) { return this.entities.get(id) || null; }
  list() { return [...this.entities.values()]; }
  botInputs(inputsBySlot) {
    for (const slot of this.seats) {
      if (!this.humanSlots.has(slot) && !inputsBySlot.has(slot)) inputsBySlot.set(slot, { ...EMPTY_INPUT });
    }
  }
  snapshot() { return { kind: 'sim-adapter', tick: this.tick, snap: this.sim.snapshot() }; }
  restore(s) { if (s?.kind === 'sim-adapter') this.sim.restore(s.snap); this._syncWire(); }
  checksum() { return this.sim.checksum(); }
  keyframe(label = '') {
    const m = this.sim.match;
    return 'keyframe ' + label + ' tick=' + this.sim.tick + ' phase=' + m.phase + ' round=' + m.round + ' checksum=' + this.checksum();
  }
}
