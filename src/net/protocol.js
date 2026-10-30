// protocol.js — DWEEBS wire protocol, shared verbatim by the client (src/net/NetClient.js)
/* global TextEncoder, TextDecoder */
// and the authoritative server (server/index.js). Transport: one WebSocket.
//
// Timings: the sim steps at SIM_HZ (60); snapshots go out at SNAPSHOT_HZ (30), so each
// snapshot frame covers two sim ticks of state.
//
// Every message is {t: <type>, ...} in JSON. Binary messages are [opcode u8][payload];
// both codecs decode to the same JS object, so the server can flip codecs per room.

// Every tunable netcode number lives in the NET block of src/game/Balance.js, which
// NET owns and the Lead does not touch. This file re-exports them so the wire code and
// the UI agree by construction rather than by copy-paste.
import { NET } from '../game/Balance.js';
export { NET };

export const PROTOCOL_VERSION = 1;
export const SIM_HZ = NET.simHz;
export const SNAPSHOT_HZ = NET.snapshotHz;
export const TICK_MS = 1000 / SIM_HZ;
export const MAX_PLAYERS = NET.maxPlayers;
export const INPUT_REDUNDANCY = NET.inputRedundancy;  // each packet repeats the last N ticks
export const RECONNECT_HOLD_MS = NET.reconnectHoldMs;
export const ROOM_CODE_LEN = NET.roomCodeLen;
export const ROOM_ALPHABET = NET.roomAlphabet;       // no I/L/O, so codes survive being read aloud
export const FULL_SNAPSHOT_EVERY = NET.fullSnapshotEvery;

/** Binary opcodes, kept in sync with the JSON `t` names. */
export const Op = Object.freeze({
  HELLO: 1, JOIN: 2, INPUT: 3, ACK: 4, PING: 5, PONG: 6, READY: 7, LEAVE: 8,
  SETTINGS: 9, QUICK: 10, SPECTATE: 11, REMATCH: 12,
  WELCOME: 16, ROOM: 17, SNAPSHOT: 18, EVENT: 19, ERROR: 20, ROOM_FULL: 21, ONLINE: 22, SERVER_FULL: 23,
});
export const OpName = Object.freeze(Object.fromEntries(
  Object.entries(Op).map(([k, v]) => [v, k.toLowerCase()])));
export const Msg = Object.freeze(Object.fromEntries(
  Object.entries(Op).map(([k, v]) => [k.toLowerCase(), v])));

/**
 * A decoded welcome slot, normalized. The binary wire cannot hold -1, so the
 * pre-handshake greeting (you: -1) arrives as 2^32-1. Anything outside the real
 * slot range means "no slot" — callers must never treat 4294967295 as a seat.
 */
export const normSlot = you => (Number.isInteger(you) && you >= 0 && you < MAX_PLAYERS ? you : -1);

/** Event kinds. AUTHORITATIVE_EVENTS drive the Hud/Announcer; the rest are cosmetic Fx. */
export const EventKind = Object.freeze({
  HIT: 'hit', KO: 'ko', STOCK: 'stock', ROUND_END: 'round_end', ROUND_START: 'round_start',
  SPAWN: 'spawn', SPLASH: 'splash', THROW: 'throw', MATCH_END: 'match_end',
});
export const AUTHORITATIVE_EVENTS = Object.freeze(new Set(
  [EventKind.KO, EventKind.STOCK, EventKind.ROUND_END, EventKind.ROUND_START, EventKind.MATCH_END]));

/** Bit order of the flag byte in the binary input encoder. */
export const INPUT_BITS = Object.freeze(['jump', 'attack', 'grab', 'dodge', 'special', 'down']);
// Canonical input lives in contracts.js: {moveX, moveZ, ..., superYeet, drop}.
// The wire keeps legacy field aliases (moveY=special/down) for compat; sanitizeInput
// normalizes them via makeInput, and EMPTY_INPUT stays frozen as the neutral fill.
export const EMPTY_INPUT = Object.freeze({
  moveX: 0, moveY: 0, moveZ: 0, jump: false, attack: false, grab: false, dodge: false,
  special: false, down: false, superYeet: false, drop: false, aimYaw: null, aimLoft: 0.15, charge: null,
});

export const ERR = Object.freeze({
  BAD_VERSION: 'bad_version', ROOM_FULL: 'room_full', ROOM_NOT_FOUND: 'room_not_found',
  BAD_INPUT: 'bad_input', RATE_LIMIT: 'rate_limit', SLOT_EXPIRED: 'slot_expired',
  NOT_IN_ROOM: 'not_in_room', MALFORMED: 'malformed', SERVER_FULL: 'server_full', NOT_HOST: 'not_host',
  ALREADY_IN_ROOM: 'already_in_room',
});

/** Room codes: 4 letters from a 24-letter alphabet = 331,776 combinations. */
export const makeRoomCode = (rand = Math.random) => {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length)];
  return s;
};
export const isRoomCode = s => typeof s === 'string' && s.length === ROOM_CODE_LEN
  && [...s].every(c => ROOM_ALPHABET.includes(c.toUpperCase()));

/**
 * Quick play: the single message, not a conversation. The client sends who they are
 * and the server answers `welcome` + `room` into the best public room it has —
 * exactly like a normal join, minus the player typing a code.
 */
export const QUICK_ROOM = 'AUTO';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Input arrives from a stranger: clamp every field, never trust it.
 * Returns BOTH canonical (moveZ/superYeet/drop) and legacy (moveY/special/down)
 * aliases so old sim reads, old wire decoders, and new canonical readers all agree. */
export function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_INPUT };
  const n = k => (Number.isFinite(Number(raw[k])) ? Number(raw[k]) : 0);
  const b = k => raw[k] === true || raw[k] === 1;
  const moveX = clamp(n('moveX'), -1, 1);
  const moveZ = clamp(Number.isFinite(Number(raw.moveZ)) ? Number(raw.moveZ) : n('moveY'), -1, 1);
  const superYeet = b('superYeet') || b('special');
  const drop = b('drop') || b('down');
  return {
    moveX, moveY: moveZ, moveZ,
    jump: b('jump'), attack: b('attack'), grab: b('grab'),
    dodge: b('dodge'), special: superYeet, down: drop, superYeet, drop,
    // 0 means "not sent" on the binary wire (every frame carries the bytes). Keeping it
    // as null lets the sim face the dweeb's own way and integrate charge itself; a
    // literal 0 aimed every online swing at world +Z and pinned every smash to a jab.
    aimYaw: n('aimYaw') ? clamp(n('aimYaw'), -Math.PI, Math.PI) : null,
    aimLoft: clamp(Number.isFinite(Number(raw.aimLoft)) && raw.aimLoft !== null ? Number(raw.aimLoft) : 0.15, 0, 1),
    charge: n('charge') > 0 ? clamp(n('charge'), 0, 1) : null,
  };
}

const inputBits = f => INPUT_BITS.reduce((m, b, i) => (f[b] ? m | (1 << i) : m), 0);
const bitsToInput = (m, out) => { for (const [i, b] of INPUT_BITS.entries()) out[b] = !!(m & (1 << i)); return out; };


// ----------------------------------------------------------------- codec ----

class Writer {
  constructor(cap = 256) { this.b = new Uint8Array(cap); this.v = new DataView(this.b.buffer); this.o = 0; }
  _need(n) {
    if (this.o + n <= this.b.length) return;
    const next = new Uint8Array(Math.max(this.b.length * 2, this.o + n));
    next.set(this.b); this.b = next; this.v = new DataView(next.buffer);
  }
  u8(x) { this._need(1); this.v.setUint8(this.o, x & 255); this.o += 1; return this; }
  u16(x) { this._need(2); this.v.setUint16(this.o, x & 65535); this.o += 2; return this; }
  i16(x) { this._need(2); this.v.setInt16(this.o, clamp(x | 0, -32768, 32767)); this.o += 2; return this; }
  u32(x) { this._need(4); this.v.setUint32(this.o, x >>> 0); this.o += 4; return this; }
  f32(x) { this._need(4); this.v.setFloat32(this.o, x); this.o += 4; return this; }
  str(s) {
    const b = new TextEncoder().encode(String(s ?? '').slice(0, 63));
    return this.u8(b.length).raw(b);
  }
  raw(b) { this._need(b.length); this.b.set(b, this.o); this.o += b.length; return this; }
  done() { return this.b.subarray(0, this.o); }
}

class Reader {
  constructor(buf) {
    this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.o = 0; this.txt = new TextDecoder();
  }
  u8() { const x = this.v.getUint8(this.o); this.o += 1; return x; }
  u16() { const x = this.v.getUint16(this.o); this.o += 2; return x; }
  i16() { const x = this.v.getInt16(this.o); this.o += 2; return x; }
  u32() { const x = this.v.getUint32(this.o); this.o += 4; return x; }
  f32() { const x = this.v.getFloat32(this.o); this.o += 4; return x; }
  str() {
    const n = this.u8(), o = this.v.byteOffset + this.o;
    const s = this.txt.decode(new Uint8Array(this.v.buffer.slice(o, o + n)));
    this.o += n; return s;
  }
  get left() { return this.v.byteLength - this.o; }
}

const INPUT_BYTES = 9;
const writeInput = (w, f) => w
  .i16(clamp(f.moveX, -1, 1) * 32767)
  .i16(clamp(f.moveY, -1, 1) * 32767)
  .i16(clamp(f.aimYaw, -Math.PI, Math.PI) * 9270)  // pi * 9270 ~= 29127
  .u8(clamp(f.aimLoft, 0, 1) * 255)
  .u8(clamp(f.charge, 0, 1) * 255)
  .u8(inputBits(f));

const readInput = r => {
  const moveX = r.i16() / 32767, moveY = r.i16() / 32767, aimYaw = r.i16() / 9270;
  const aimLoft = r.u8() / 255, charge = r.u8() / 255;
  return bitsToInput(r.u8(), { moveX, moveY, aimYaw, aimLoft, charge });
};


/** Binary encoders, one per opcode. `m` is the canonical message object. */
const ENC = {
  // The codec rides at the END of hello so old decoders (which stop after
  // `protocol`) keep working: extra trailing bytes are simply never read.
  [Op.HELLO]: (w, m) => { w.str(m.client).u32(m.clientTime).u16(m.protocol).str(m.codec || ''); },
  [Op.JOIN]: (w, m) => { w.str(m.room).u8(m.create ? 1 : 0).str(m.token).str(m.name).str(m.type).str(m.color); },
  [Op.SETTINGS]: (w, m) => {
    w.str(String(m.stocks ?? '')).str(String(m.time ?? ''))
      .str(typeof m.items === 'boolean' ? (m.items ? 'on' : 'off') : String(m.items ?? ''))
      .str(String(m.bots ?? ''));
  },
  [Op.QUICK]: (w, m) => { w.str(m.token).str(m.name).str(m.type).str(m.color); },
  [Op.INPUT]: (w, m) => {
    w.u32(m.tick).u32(m.ack);
    for (const f of m.frames) writeInput(w, f);
  },
  [Op.READY]: (w, m) => { w.u8(m.ready ? 1 : 0); },
  [Op.LEAVE]: () => {},
  [Op.SPECTATE]: (w, m) => { w.str(m.room).str(m.token).str(m.name).str(m.type).str(m.color); },
  [Op.REMATCH]: (w, m) => { w.u8(m.want ? 1 : 0); },
  [Op.PING]: (w, m) => { w.u32(m.id).f32(m.clientTime); },
  [Op.PONG]: (w, m) => { w.u32(m.id).f32(m.clientTime).f32(m.serverTime); },
  [Op.WELCOME]: (w, m) => { w.u16(m.protocol).u32(m.you).u32(m.tick).str(m.token).str(m.room).u8(m.rtt || 0).u8(m.spectating ? 1 : 0); },
  [Op.ROOM]: (w, m) => {
    w.str(m.room).str(String(m.phase ?? 'lobby')).u32(m.tick).u8(m.players.length);
    for (const p of m.players) {
      w.u32(p.slot).u8(p.bot ? 1 : 0).u8(p.connected ? 1 : 0).u8(p.ready ? 1 : 0)
        .str(p.name).str(p.type).str(p.color);
    }
    // Lobby extras the lobby screen needs. JSON shape is the same object; the binary
    // shape gained a tail, which older decoders simply never read (see DEC).
    // NOTE: host is slot+1 so that "no host" is encodable: 0 means none, slot s rides as s+1.
    w.str(m.code || m.room || '').u8(m.isPublic ? 1 : 0).u8((typeof m.host === 'number' && m.host >= 0 ? m.host : 7) + 1)
      .u8(Number(m.settings?.stocks) || 3).u16(Number(m.settings?.time) || 120).u8(m.settings?.items === false ? 0 : 1)
      .u8(Number(m.settings?.bots) || 0)
      // Rematch votes ride at the very tail: want = connected humans voting yes,
      // need = connected humans total. Old decoders stop at `bots` and never read this.
      .u8(Number(m.rematch?.want) || 0).u8(Number(m.rematch?.need) || 0)
      // Spectator count: same tail, same story for old decoders.
      .u16(Number(m.spectators) || 0);
  },
  [Op.SNAPSHOT]: (w, m) => {
    w.u32(m.tick).u32(m.ack).u8(m.full ? 1 : 0).u32(m.serverTime).u16(m.entities.length);
    for (const e of m.entities) {
      // id is u16: entity ids are small (slot + 1, then items), and 2 bytes saved on
      // every entity on every frame is 2 bytes × 12 entities × 30 Hz = 720 B/s.
      w.u16(e.id).i16(e.x).i16(e.y).i16(e.z).u8(e.q).u8(e.flags).u8(e.state);
      // Velocity only when the server flagged it (bit 3): it is only sent for the
      // receiving client's own dweeb, so the reader must know before it reads.
      if (e.flags & 8) w.i16(e.vx).i16(e.vy).i16(e.vz);
    }
  },
  [Op.EVENT]: (w, m) => {
    w.u32(m.tick).u16(m.events.length);
    for (const ev of m.events) { w.str(ev.kind).u8(ev.id).i16(ev.x).i16(ev.y).i16(ev.z).u8(ev.a); }
  },
  [Op.ERROR]: (w, m) => { w.str(m.code).str(m.message); },
  [Op.ROOM_FULL]: (w, m) => { w.str(m.room); },
  [Op.ONLINE]: (w, m) => {
    w.u16(m.humans).u16(m.rooms).u16(m.matches).u16(m.openRooms).u8(m.seatsPerRoom).u8(m.maxRooms);
    const who = Array.isArray(m.who) ? m.who.slice(0, 32) : [];
    w.u8(who.length);
    for (const n of who) w.str(n);
    // Spectator count rides at the tail; old decoders never read it.
    w.u16(m.spectators || 0);
  },
  [Op.SERVER_FULL]: (w, m) => { w.u16(m.humans).u16(m.maxRooms); },
};

const DEC = {
  [Op.HELLO]: r => ({ client: r.str(), clientTime: r.u32(), protocol: r.u16(), codec: r.left > 0 ? r.str() : '' }),
  [Op.JOIN]: r => ({ room: r.str(), create: !!r.u8(), token: r.str(), name: r.str(), type: r.str(), color: r.str() }),
  [Op.SETTINGS]: r => ({ stocks: r.str(), time: r.str(), items: r.str(), bots: r.left > 0 ? r.str() : '' }),
  [Op.QUICK]: r => ({ token: r.str(), name: r.str(), type: r.str(), color: r.str() }),
  [Op.INPUT]: r => {
    const tick = r.u32(), ack = r.u32(), frames = [];
    while (r.left >= INPUT_BYTES && frames.length < INPUT_REDUNDANCY) frames.push(readInput(r));
    return { tick, ack, frames };
  },
  [Op.READY]: r => ({ ready: !!r.u8() }),
  [Op.LEAVE]: () => ({}),
  [Op.SPECTATE]: r => ({ room: r.str(), token: r.str(), name: r.str(), type: r.str(), color: r.str() }),
  [Op.REMATCH]: r => ({ want: !!r.u8() }),
  [Op.PING]: r => ({ id: r.u32(), clientTime: r.f32() }),
  [Op.PONG]: r => ({ id: r.u32(), clientTime: r.f32(), serverTime: r.f32() }),
  [Op.WELCOME]: r => ({ protocol: r.u16(), you: r.u32(), tick: r.u32(), token: r.str(), room: r.str(), rtt: r.u8(), spectating: r.left >= 1 ? !!r.u8() : false }),
  [Op.ROOM]: r => {
    const room = r.str(), phase = r.str(), tick = r.u32(), n = r.u8(), players = [];
    for (let i = 0; i < n; i++) {
      players.push({
        slot: r.u32(), bot: !!r.u8(), connected: !!r.u8(), ready: !!r.u8(),
        name: r.str(), type: r.str(), color: r.str(),
      });
    }
    // The tail is optional on the wire: a decoder reading an older frame that ends
    // at the players gets the same defaults the JSON path produces.
    let code = room, isPublic = false, host = -1, settings, rematch, spectators = 0;
    if (r.left >= 2) {
      code = r.str(); isPublic = !!r.u8();
      // host rides as slot+1: 0 means no host, so subtract back (see ENC).
      if (r.left >= 1) host = r.u8() - 1;
      if (r.left >= 4) {
        settings = { stocks: r.u8() || 3, time: r.u16() || 120, items: r.u8() !== 0 };
        settings.bots = r.left >= 1 ? r.u8() : 0;
      }
      // Rematch votes at the very tail; absent on older frames.
      if (r.left >= 2) rematch = { want: r.u8(), need: r.u8() };
      // Spectator count after that; absent on older frames.
      if (r.left >= 2) spectators = r.u16();
    }
    return { room, phase, tick, players, code, isPublic, host, settings, rematch, spectators };
  },
  [Op.SNAPSHOT]: r => {
    const tick = r.u32(), ack = r.u32(), full = !!r.u8(), serverTime = r.u32();
    const n = r.u16(), entities = [];
    for (let i = 0; i < n; i++) {
      const id = r.u16(), x = r.i16(), y = r.i16(), z = r.i16(), q = r.u8(), flags = r.u8(), state = r.u8();
      // Velocity rides only on the receiving client's own dweeb (flag bit 3).
      const hasV = !!(flags & 8);
      entities.push({
        id, x, y, z, q, flags, state,
        vx: hasV ? r.i16() : 0, vy: hasV ? r.i16() : 0, vz: hasV ? r.i16() : 0,
      });
    }
    return { tick, ack, full, serverTime, entities };
  },
  [Op.EVENT]: r => {
    const tick = r.u32(), n = r.u16(), events = [];
    for (let i = 0; i < n; i++) {
      events.push({ kind: r.str(), id: r.u8(), x: r.i16(), y: r.i16(), z: r.i16(), a: r.u8() });
    }
    return { tick, events };
  },
  [Op.ERROR]: r => ({ code: r.str(), message: r.str() }),
  [Op.ROOM_FULL]: r => ({ room: r.str() }),
  [Op.ONLINE]: r => {
    const humans = r.u16(), rooms = r.u16(), matches = r.u16(), openRooms = r.u16();
    const seatsPerRoom = r.u8(), maxRooms = r.u8(), n = r.u8(), who = [];
    for (let i = 0; i < n; i++) who.push(r.str());
    return { humans, rooms, matches, openRooms, seatsPerRoom, maxRooms, who, spectators: r.left >= 2 ? r.u16() : 0 };
  },
  [Op.SERVER_FULL]: r => ({ humans: r.u16(), maxRooms: r.u16() }),
};

/**
 * The encoder interface both sides use. `codec` is 'json' (readable, easy to eyeball in
 * devtools) or 'bin' (DataView, several times smaller). encode() returns a string for
 * JSON and a Uint8Array for binary; decode() accepts either.
 */
export function makeCodec(codec = 'json') {
  if (codec === 'bin') {
    return {
      name: 'bin',
      encode: m => {
        const op = Msg[m.t], enc = ENC[op];
        if (!enc) throw new Error(`no binary encoder for ${m.t}`);
        const w = new Writer();
        w.u8(op);
        enc(w, m);
        return w.done();
      },
      decode: data => {
        const bytes = typeof data === 'string' ? new Uint8Array(0)
          : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        if (!bytes || !bytes.length) throw new Error('empty frame');
        const r = new Reader(bytes), op = r.u8(), dec = DEC[op];
        if (!dec) throw new Error(`unknown opcode ${op}`);
        return { t: OpName[op], ...dec(r) };
      },
    };
  }
  return {
    name: 'json',
    encode: m => JSON.stringify(m),
    decode: data => (typeof data === 'string' ? JSON.parse(data)
      : JSON.parse(new TextDecoder().decode(data))),
  };
}

// -------------------------------------------------------------- snapshots ----

/**
 * Snapshot deltas: only entities whose quantized state changed since the client's
 * last-acked baseline are sent. FULL_SNAPSHOT_EVERY (1 s) resends everything, which
 * recovers a client that dropped frames and covers late joiners.
 */
export function deltaEntities(prev, next) {
  const out = [];
  for (const e of next) {
    const p = prev && prev.get(e.id);
    if (p && p.x === e.x && p.y === e.y && p.z === e.z && p.q === e.q && p.state === e.state
      && p.flags === e.flags && p.vx === e.vx && p.vy === e.vy && p.vz === e.vz) continue;
    out.push(e);
  }
  return out;
}
