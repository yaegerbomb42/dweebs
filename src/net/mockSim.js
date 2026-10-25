// mockSim.js — NET's stand-in for src/sim until SIM's contracts.js lands.
// Boxes (and one box per dweeb) run around a stage under a tiny deterministic
// integrator. It implements the same surface the real sim will: step(inputs),
// snapshot(), restore(), entity ids, and an event queue. Swapping in src/sim
// means changing one import in server/index.js.

import { EMPTY_INPUT, MAX_PLAYERS } from './protocol.js';

const STAGE = 18;          // half-extent, metres
const TYPES = ['cube', 'blob', 'spiky'];
const COLORS = ['#8ec7ff', '#ffb37a', '#9dff8e', '#ff8ec7', '#ffe27a', '#8ed7ff', '#c4a0ff', '#a0ffd0'];

export class MockSim {
  constructor({ players = 8, seed = 1, seats = null } = {}) {
    this.tick = 0;
    this.rngState = seed >>> 0 || 1;
    this.players = Math.min(players, MAX_PLAYERS);
    this.events = [];
    /** id -> {id, kind, x,y,z, vx,vy,vz, yaw, state, flags, slot} */
    this.entities = new Map();
    for (let slot = 0; slot < this.players; slot++) if (!seats || seats.includes(slot)) this.spawnPlayer(slot);
    for (let i = 0; i < 4; i++) this.spawnBox(this.nextId());
  }

  nextId() { let m = 0; for (const id of this.entities.keys()) m = Math.max(m, id); return m + 1; }
  rand() { // xorshift32, so a match replays identically
    let x = this.rngState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState >>> 0) / 4294967296;
  }

  spawnPlayer(slot) {
    const a = (slot / this.players) * Math.PI * 2;
    this.entities.set(slot + 1, {
      id: slot + 1, kind: 'dweeb', slot,
      x: Math.cos(a) * 6, y: 1 + (slot % 3), z: Math.sin(a) * 6,
      vx: 0, vy: 0, vz: 0, yaw: a, state: 0, flags: 0,
      type: TYPES[slot % TYPES.length], color: COLORS[slot % COLORS.length],
    });
  }

  spawnBox(id) {
    this.entities.set(id, {
      id, kind: 'item', slot: -1,
      x: (this.rand() - 0.5) * STAGE, y: 2 + this.rand() * 4, z: (this.rand() - 0.5) * STAGE,
      vx: (this.rand() - 0.5) * 3, vy: 0, vz: (this.rand() - 0.5) * 3,
      yaw: this.rand() * 6.28, state: 0, flags: 0,
    });
  }

  /** @param {Map<number, object>} inputsBySlot */
  step(inputsBySlot) {
    this.tick++;
    for (const e of this.entities.values()) {
      if (e.kind === 'dweeb') {
        const inp = inputsBySlot.get(e.slot) || EMPTY_INPUT;
        const speed = 7 * (e.slot % 3 === 0 ? 1 : 0.9);
        e.vx = inp.moveX * speed;
        e.vz = inp.moveY * speed;
        if (inp.jump && e.y <= 1.001) e.vy = 6;
        e.vy -= 18 * (1 / 60);
        e.x += e.vx / 60; e.y += e.vy / 60; e.z += e.vz / 60;
        e.yaw = Math.atan2(inp.moveX, inp.moveY);
        e.state = inp.attack ? 1 : inp.grab ? 2 : 0;
        // Stage edge: clamp, don't mirror. Mirroring teleports the dweeb across the
        // arena, which is a fine arcade trick but reads as a netcode teleport.
        const r = Math.hypot(e.x, e.z);
        if (r > STAGE) { e.x = (e.x / r) * STAGE; e.z = (e.z / r) * STAGE; }
        // A floor, so mock dweebs walk around instead of falling out of the world.
        if (e.y < 0.5) { e.y = 0.5; e.vy = 0; }
        if (e.y < -5) { e.y = 3; this.events.push({ kind: 'ko', id: e.id, x: 0, y: 0, z: 0, a: 0 }); }
      } else {
        e.vy -= 9 * (1 / 60);
        e.x += e.vx / 60; e.y += e.vy / 60; e.z += e.vz / 60;
        if (e.y < 0.5) { e.y = 0.5; e.vy = Math.abs(e.vy) * 0.4; e.vx *= 0.9; e.vz *= 0.9; }
        if (e.x > STAGE) e.vx = -Math.abs(e.vx); if (e.x < -STAGE) e.vx = Math.abs(e.vx);
        if (e.z > STAGE) e.vz = -Math.abs(e.vz); if (e.z < -STAGE) e.vz = Math.abs(e.vz);
      }
    }
    return this.events;
  }

  drainEvents() { const e = this.events; this.events = []; return e; }

  /** The sim interface NetClient expects: look an entity up by wire id. */
  entityById(id) { return this.entities.get(id) || null; }

  /** All entities as an array (this.entities is the Map itself). */
  list() { return [...this.entities.values()]; }

  /** Bot inputs for the empty slots, so a room is never idle. */
  botInputs(inputsBySlot) {
    for (const [slot] of this.entities) {
      if (slot > this.players) continue;
      const e = this.entities.get(slot);
      if (!e || e.kind !== 'dweeb' || inputsBySlot.has(slot)) continue;
      const t = this.tick * 0.02 + slot;
      inputsBySlot.set(slot, {
        ...EMPTY_INPUT,
        moveX: Math.sin(t * 1.3), moveY: Math.cos(t * 0.9),
        jump: Math.sin(t * 2.1) > 0.97,
        attack: Math.sin(t * 3.3) > 0.995,
      });
    }
  }

  snapshot() {
    return {
      tick: this.tick, rng: this.rngState,
      entities: this.list().map(e => ({ ...e })),
    };
  }

  restore(s) {
    this.tick = s.tick; this.rngState = s.rng;
    this.entities = new Map(s.entities.map(e => [e.id, { ...e }]));
  }
}
