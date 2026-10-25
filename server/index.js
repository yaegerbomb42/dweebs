// index.js — the DWEEBS authoritative game server (NET).
//
//   node server/index.js [--port 8787] [--lag 120] [--loss 2] [--jitter 20] [--codec bin|json]
//
// Rooms are 4-letter codes with up to 8 slots. Bots only take seats when the host
// asks for them (the `bots` lobby rule, default 0). The sim steps at 60 Hz and snapshots go out at 30 Hz as deltas against
// each client's last-acked baseline, with a full snapshot every second. Until SIM's
// src/sim lands, this runs src/net/mockSim.js; only that import changes when it arrives.

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION, SIM_HZ, SNAPSHOT_HZ, MAX_PLAYERS, RECONNECT_HOLD_MS, NET,
  makeRoomCode, isRoomCode, makeCodec, deltaEntities, FULL_SNAPSHOT_EVERY, ERR, Op,
} from '../src/net/protocol.js';
import { InputBuffer } from '../src/net/inputBuffer.js';
import { MockSim } from '../src/net/mockSim.js';
import { SimAdapter } from '../src/sim/simAdapter.js';
import { addNetSimulation, parseNetFlags } from '../src/net/lagSim.js';

const TICK_MS = 1000 / SIM_HZ;
const SNAP_EVERY = SIM_HZ / NET.snapshotHz;   // sim ticks per snapshot
const ITEM_EVERY = NET.itemSnapshotEvery;    // snapshots between item updates
const BOT_NAMES = ['FLOP', 'BONK', 'WOBBLE', 'SPLAT', 'NIB', 'TUMBLE', 'PLOP', 'GLOOP'];
const BOT_TYPES = ['cube', 'blob', 'spiky'];
const BOT_COLORS = ['#8ec7ff', '#ffb37a', '#9dff8e', '#ff8ec7'];

const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = Number(flag('port', process.env.PORT || 8787));
const CODEC = flag('codec', 'bin');                     // 'json' to eyeball frames
const NET_FLAGS = parseNetFlags({ lag: flag('lag', 0), loss: flag('loss', 0), jitter: flag('jitter', 0) });
const BOTS_DEFAULT = Number(flag('bots', 0));
// T3: `--sim real` runs the authoritative src/sim/Sim via SimAdapter; default stays
// MockSim so offline/dev boot never pays Rapier WASM cost unexpectedly.
const USE_REAL_SIM = flag('sim', process.env.DWEEBS_SIM || 'mock') === 'real';

// A single Node process steps EVERY room on one core, so the room count is a hard
// capacity limit, not a soft one. Measured on the Oracle VPS (4 Ampere cores,
// tools/perf-rooms.mjs): one real-sim room costs ~0.22 ms/tick, so `--max-rooms 24`
// is ~5.4 ms of a 16.67 ms frame — a third of a core, with room for snapshot
// encoding and WebSocket sends. Raise it only with a load test to back the number.
const MAX_ROOMS = Math.max(1, Number(flag('max-rooms', process.env.DWEEBS_MAX_ROOMS || 24)));
// How often the lobby/online screens are told the live totals. 2 s is fast enough to
// feel live and slow enough that it costs nothing (~120 bytes per client per second).
const ONLINE_EVERY_MS = 2000;

// T22: idle rooms with no humans cost a 60Hz sim — the main loop evicts them
// after ROOM_IDLE_MS via room.idleSince (see main loop below).
const ROOM_IDLE_MS = 5 * 60 * 1000;

// Default match rules. Kept here (not in the client) because the server owns the
// match: the room broadcasts them, the host may patch them, the sim is built from
// them, and a client that lies about them is simply ignored.
const DEFAULT_SETTINGS = Object.freeze({
  stocks: 3, time: 120, items: true,
  bots: [0, 1, 3, 7].includes(BOTS_DEFAULT) ? BOTS_DEFAULT : 0,
});
const SETTINGS_CHOICES = Object.freeze({
  stocks: [1, 3, 5],
  time: [60, 120, 300],
  bots: [0, 1, 3, 7],     // 7 = fill every empty seat
});


// ------------------------------------------------------------------ rooms ----

class Room {
  constructor(code, { isPublic = false } = {}) {
    this.code = code;
    this.codec = makeCodec(CODEC);
    // A room is either listed for quick play (`isPublic`) or reachable only by its
    // code (invite). Private rooms must never be matched into: a party that pressed
    // CREATE ROOM asked for their friends, not for strangers.
    this.isPublic = !!isPublic;
    this.settings = { ...DEFAULT_SETTINGS };
    // Set once the lobby's rules have been baked into the sim, so a settings change
    // in the lobby rebuilds the sim exactly once, at the moment it matters.
    this.simSettingsKey = JSON.stringify(DEFAULT_SETTINGS);
    // T3: real-sim rooms init async (Rapier WASM); Room queues steps until ready.
    // MockSim stays the default so existing harnesses are unaffected.
    this.useRealSim = USE_REAL_SIM;
    this.sim = new MockSim({ players: MAX_PLAYERS });
    this.simReady = Promise.resolve(this.sim);
    this.pendingInputs = [];
    this.tick = 0;
    this.phase = 'lobby';
    this.snapCount = 0;         // snapshot cadence, independent of the sim tick (lobby tick is 0)
    this.matchStarted = false;
    this.slots = new Map();     // slot -> slot record (see addClient / fillBots)
    this.lobby = [];            // human slots; bots are implied by the free ones
    for (let i = 0; i < MAX_PLAYERS; i++) this.slots.set(i, { slot: i, bot: true, ready: true, connected: true });
    // MockSim is ready synchronously; the real sim flips this on once Rapier is up.
    this.simPrepared = !this.useRealSim;
    this._buildSim();
  }

  /**
   * (Re)build the sim from the room's rules. Called once at room open and again if the
   * host changes the rules in the lobby, so `stocks`/`time`/`items` are real match
   * rules rather than decoration. The room keeps serving lobby snapshots from the old
   * sim while the new one spins up, so a rebuild never blanks the screen.
   */
  _buildSim() {
    this.simSeatsKey = this.seats().join(',');
    if (!this.useRealSim) { this.sim = new MockSim({ players: MAX_PLAYERS, seats: this.seats() }); return; }
    const seed = (Date.now() % 2147483647) || 1;
    this.simReady = SimAdapter.create({
      players: MAX_PLAYERS, seed, humans: this.humanSlots(), seats: this.seats(),
      config: { stocks: this.settings.stocks, roundTime: this.settings.time, items: this.settings.items },
    })
      .then(a => { this.sim = a; this.simPrepared = true; this._logKeyframe('room-open'); return a; })
      .catch(err => {
        console.error(`[room ${this.code}] real sim failed, falling back to mock:`, err?.message);
        this.useRealSim = false; this.sim = new MockSim({ players: MAX_PLAYERS, seats: this.seats() }); this.simPrepared = true; return this.sim;
      });
  }

  get humans() { return this.lobby.length; }
  humanSlots() { return this.lobby.map(p => p.slot); }
  /** The free slots the host asked bots to fill. No bots unless the rules say so. */
  botSlots() {
    const out = [];
    for (let slot = 0; slot < MAX_PLAYERS && out.length < this.settings.bots; slot++) {
      const s = this.slots.get(slot);
      if (s && s.bot && !s.reserved) out.push(slot);
    }
    return out;
  }
  /** Every seated slot, humans and requested bots, ascending. */
  seats() { return [...this.humanSlots(), ...this.botSlots()].sort((a, b) => a - b); }
  /** Players a client can still occupy: bot slots are takeable, human slots are not. */
  get freeSeats() { return MAX_PLAYERS - this.humans; }
  /** The first connected human runs the rules; hand-over is automatic when they leave. */
  get hostSlot() { const h = this.lobby.find(p => p.connected) || this.lobby[0]; return h ? h.slot : -1; }

  /** Host-only rule patch. Unknown keys and off-menu values are dropped, not trusted. */
  applySettings(fromPlayer, patch = {}) {
    if (!fromPlayer || fromPlayer.slot !== this.hostSlot || this.phase !== 'lobby') return false;
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'items') { if (typeof v === 'boolean' && v !== this.settings.items) { this.settings.items = v; changed = true; } continue; }
      if (!SETTINGS_CHOICES[k] || v === '' || v == null) continue;   // binary codec sends '' for "unchanged"
      const n = Number(v);
      if (SETTINGS_CHOICES[k].includes(n) && n !== this.settings[k]) { this.settings[k] = n; changed = true; }
    }
    if (changed) {
      // Rules only apply to a match that has not started; rebuild the sim so the next
      // READY starts the match the lobby is actually showing.
      const key = JSON.stringify(this.settings);
      if (key !== this.simSettingsKey) { this.simSettingsKey = key; this.simPrepared = false; this._buildSim(); }
    }
    return changed;
  }

  /**
   * The ready gate. The sim only steps in 'playing', so without this the room sat in
   * 'lobby' forever: every client saw a frozen snapshot, and netSmoke's cross-client
   * agreement check passed *because nothing ever moved*. That is a false positive, so
   * the gate and the "did anything actually move" assertion are a matched pair.
   *
   * Bots are always ready, so a room starts as soon as every connected human is ready
   * (and there is at least one human, so an empty room is never "playing").
   */
  allHumansReady() {
    return this.lobby.length > 0 && this.lobby.every(p => p.ready || !p.connected);
  }

  /** Give the room one tick's chance to leave the lobby. Idempotent. */
  maybeStart(now = Date.now()) {
    if (this.phase !== 'lobby' || !this.allHumansReady()) return false;
    // A settings change rebuilds the sim; wait for the new world instead of starting
    // the match on the old one. The next tick retries, so this is never a stall.
    if (!this.simPrepared) return false;
    // Seat exactly the humans and requested bots. If the lobby changed since the sim
    // was built, rebuild it with the right seats; the next tick retries.
    if (this.seats().join(',') !== this.simSeatsKey) { this.simPrepared = !this.useRealSim; this._buildSim(); return false; }
    this.phase = 'playing';
    this.matchStarted = true;
    this.startedAt = now;
    this.fillBots();                    // Room-side: name/type/color the requested bots
    this.sim.startMatch?.();
    this._logKeyframe('match-start');
    this.broadcast(this.roomState());
    return true;
  }

  fillBots() {
    for (const slot of this.botSlots()) {
      const s = this.slots.get(slot);
      s.ready = true; s.connected = true;
      s.name = BOT_NAMES[slot % BOT_NAMES.length];
      s.type = BOT_TYPES[slot % BOT_TYPES.length];
      s.color = BOT_COLORS[slot % BOT_COLORS.length];
    }
  }

  freeSlot() {
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const s = this.slots.get(slot);
      if (s && s.bot && !s.reserved) return slot;
    }
    return -1;
  }

  /** Reconnect path: a token reclaims the exact slot and dweeb. */
  slotForToken(token) {
    return token ? this.lobby.find(s => s.token === token) || null : null;
  }

  addClient(sock, { token, name, type, color }) {
    const held = this.slotForToken(token);
    if (held) { held.sock = sock; held.connected = true; held.droppedAt = 0; return held; }
    const i = this.freeSlot();
    if (i < 0) return null;
    const fresh = {
      slot: i, id: randomUUID(), token: randomUUID(), bot: false, connected: true, ready: false,
      name: String(name || 'dweeb').slice(0, 12) || 'dweeb',
      type: BOT_TYPES.includes(type) ? type : 'cube',
      color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : BOT_COLORS[i % BOT_COLORS.length],
      sock, buffer: new InputBuffer(), baseline: new Map(), droppedAt: 0,
    };
    this.slots.set(i, fresh);
    this.lobby.push(fresh);
    this._syncHumanCount();
    return fresh;
  }

  /** Tell the sim (when it tracks humans) how many seats are people, for bot flags. */
  _syncHumanCount() { this.sim?.setHumans?.(this.humanSlots()); }

  /**
   * A human who never sent a tick since the last sweep still counts as online: the
   * lobby shows them as connected anyway, and "N online" must agree with the lobby
   * list or it looks broken. Only the reconnect window removes a seat.
   */
  countOnline() { return this.lobby.filter(p => p.connected).length; }

  /** Disconnect: hold the slot (and the dweeb) for RECONNECT_HOLD_MS. */
  dropClient(player, now) {
    if (!player) return;
    player.connected = false;
    player.sock = null;
    player.droppedAt = now;
  }

  sweepDropped(now) {
    for (const p of [...this.lobby]) {
      if (p.connected || !p.droppedAt || now - p.droppedAt < RECONNECT_HOLD_MS) continue;
      this.lobby = this.lobby.filter(x => x !== p);
      this.slots.set(p.slot, {
        slot: p.slot, bot: true, ready: true, connected: true,
        name: BOT_NAMES[p.slot % BOT_NAMES.length],
        type: BOT_TYPES[p.slot % BOT_TYPES.length],
        color: BOT_COLORS[p.slot % BOT_COLORS.length],
      });
      this._syncHumanCount();
    }
  }

  roomState() {
    return {
      t: 'room', room: this.code, phase: this.phase, tick: this.tick,
      code: this.code, isPublic: !!this.isPublic, host: this.hostSlot,
      settings: { ...this.settings },
      // Only real seats go out: humans plus the bots the host asked for. Empty
      // seats are not players, so the lobby never shows made-up names.
      players: this.seats().map(i => this.slots.get(i)).map(s => ({
        slot: s.slot, bot: !!s.bot, connected: !!s.connected, ready: !!s.ready,
        name: s.name || '', type: s.type || 'cube', color: s.color || '#8ec7ff',
      })),
    };
  }

  broadcast(msg) {
    const data = this.codec.encode(msg);
    for (const p of this.lobby) if (p.sock && p.sock.readyState === 1) p.sock.send(data);
  }

  sendTo(p, msg) {
    if (p.sock && p.sock.readyState === 1) p.sock.send(this.codec.encode(msg));
  }

  /**
   * Quantize the sim state to the wire, in centimetres (1 cm resolution).
   *
   * `forSlot` is the receiving client's slot, and it is the whole bandwidth story: a
   * client only ever needs the velocity of its OWN dweeb, because everyone else is
   * interpolated between snapshots. So velocity rides only on your own entity, flagged
   * in bit 3 of `flags`. That is 6 bytes saved on 11 of 12 entities, every frame —
   * about 2 KB/s at 8 players, and it is what keeps the room inside its budget.
   *
   * Items go out every ITEM_EVERY snapshots (a rolling box interpolates fine), and
   * unchanged entities are dropped by the delta pass on top of that.
   */
  wireEntities(forSlot = -1) {
    const out = [];
    const withItems = this.tick % ITEM_EVERY === 0;
    for (const e of this.sim.list()) {
      const isDweeb = e.kind === 'dweeb';
      if (!isDweeb && !withItems) continue;
      // SimAdapter entities carry _cm:true (pre-quantized cm ints); MockSim are metre floats.
      const cm = e._cm ? v => v : v => Math.round(v * 100);
      const own = isDweeb && e.slot === forSlot;
      out.push({
        id: e.id,
        x: cm(e.x), y: cm(e.y), z: cm(e.z),
        q: e.q ?? (Math.round((e.yaw / (Math.PI * 2)) * 255) & 255),
        flags: e.flags ?? ((isDweeb ? 1 : 0) | (e.slot >= 0 ? 2 : 0) | (own ? 8 : 0)),
        state: e.state & 255,
        vx: own ? Math.round(e.vx * 100) : 0,
        vy: own ? Math.round(e.vy * 100) : 0,
        vz: own ? Math.round(e.vz * 100) : 0,
      });
    }
    return out;
  }

  /** T18: keyframe checksum log (round start/end, KOs hook in via stepSim event scan). */
  _logKeyframe(label) {
    try {
      if (typeof this.sim?.keyframe === 'function') console.log(`[room ${this.code}] ${this.sim.keyframe(label)}`);
      else console.log(`[room ${this.code}] keyframe ${label} tick=${this.sim.tick}`);
    } catch { /* logging never breaks the loop */ }
  }

  stepSim() {
    // Nothing steps until the ready gate opens: a lobby room must not burn a core
    // running bots against each other, and it must not have a match finishing before
    // the humans have even pressed READY. (This also makes idle lobbies nearly free,
    // which is what lets ~24 rooms share one VPS core.)
    if (this.phase !== 'playing') return;
    const inputs = new Map();
    for (const p of this.lobby) inputs.set(p.slot, p.buffer.consume(this.tick));
    this.sim.botInputs(inputs);            // bots fill the empty slots
    this.sim.step(inputs);
    this.tick = this.sim.tick;
    const evs = this.sim.drainEvents();
    if (evs.length) {
      // T18: keyframe the authoritative outcomes the brief requires (round start/end, KO).
      for (const e of evs) {
        if (e.kind === 'ko' || e.kind === 'round_end' || e.kind === 'round_start' || e.kind === 'match_end' || e.simType === 'roundEnd' || e.simType === 'matchEnd' || e.simType === 'ko' || e.simType === 'go')
          this._logKeyframe(`event:${e.simType || e.kind}`);
      }
      this.broadcast({
        t: 'event', tick: this.tick,
        events: evs.map(e => ({
          kind: e.kind, id: e.id,
          // SimAdapter wire events carry _cm:true (pre-quantized cm ints); MockSim are metre floats.
          x: e._cm ? e.x : Math.round(e.x * 100) || 0,
          y: e._cm ? e.y : Math.round(e.y * 100) || 0,
          z: e._cm ? e.z : Math.round(e.z * 100) || 0, a: 0,
        })),
      });
    }
  }

  /** Deltas per client against their own last-acked baseline; full every second. */
  broadcastSnapshot() {
    // The cadence counts SNAPSHOTS, not sim ticks. In the lobby the tick never advances
    // (the sim is not stepping), so `tick % FULL_SNAPSHOT_EVERY === 0` was true on every
    // frame — the whole room was one permanent full snapshot, at full bandwidth.
    this.snapCount++;
    const full = this.snapCount % (FULL_SNAPSHOT_EVERY / SNAP_EVERY) === 0;
    for (const p of this.lobby) {
      if (!p.sock || p.sock.readyState !== 1) continue;
      const all = this.wireEntities(p.slot);     // per-receiver: only you get your velocity
      const entities = full ? all : deltaEntities(p.baseline, all);
      for (const e of entities) p.baseline.set(e.id, e);
      p.sock.send(this.codec.encode({
        t: 'snapshot', tick: this.tick, ack: p.buffer.lastTick, full, serverTime: Date.now(), entities,
      }));
    }
  }
}

// ------------------------------------------------------------- connections ----

/** Every live socket, joined or not: the `online` broadcast must reach the Play
 * Online screen BEFORE the player joins anything, or the count is a chicken-and-egg. */
const clients = new Set();

/** Rooms are keyed by their 4-letter code; the code is always the one asked for. */
const rooms = new Map();
const createRoom = (code, { isPublic = false } = {}) => {
  let c = code;
  while (rooms.has(c)) c = makeRoomCode();      // a collision re-rolls, so a stale
  const r = new Room(c, { isPublic });          // link never joins the wrong room
  rooms.set(c, r);
  return r;
};

/**
 * Pick a public room for a PLAY NOW player: the fullest lobby-phase room with a free
 * seat first (fewer half-empty rooms), then a live match a newcomer can drop into.
 * Returns null when the fleet is full, so the player sees "servers are full" instead
 * of silently joining a room that will never start.
 */
const findQuickRoom = () => {
  const publicRooms = [...rooms.values()].filter(r => r.isPublic && r.freeSeats > 0);
  publicRooms.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === 'lobby' ? -1 : 1;
    return b.humans - a.humans;
  });
  for (const r of publicRooms) return r;
  if (rooms.size >= MAX_ROOMS) return null;
  return createRoom(makeRoomCode(), { isPublic: true });
};

/**
 * Live totals, one source of truth for both the `online` WS broadcast and /status.
 * `humans` is dweebs with a person behind them, right now — the number the Play
 * Online screen prints. `who` names them (no accounts exist, so this is the lobby
 * list already broadcast to every player anyway).
 */
const STARTED_AT = Date.now();
const PERF_WINDOW_MS = 5000;
const perf = { windowStart: Date.now(), busyMs: 0, steps: 0, snapBytes: 0 };
let lastOnline = null;

const onlineState = () => {
  let humans = 0, matches = 0, openRooms = 0;
  const who = [];
  for (const r of rooms.values()) {
    humans += r.countOnline();
    if (r.phase === 'playing') matches++; else openRooms++;
    if (who.length < MAX_PLAYERS) for (const p of r.lobby) if (p.connected && who.length < MAX_PLAYERS) who.push(p.name);
  }
  return {
    t: 'online', humans, rooms: rooms.size, matches, openRooms,
    seatsPerRoom: MAX_PLAYERS, maxRooms: MAX_ROOMS,
    who: who.sort((a, b) => String(a).localeCompare(String(b))),
  };
};

// Keep the last snapshot for /status, cheaply: building it costs one object per 2 s.
setInterval(() => {
  lastOnline = onlineState();
  const payload = onlineCodec.encode(lastOnline);
  for (const s of clients) {
    if (s.readyState === 1) {
      try { s.send(payload); } catch { /* a closing socket is not a server error */ }
    }
  }
}, ONLINE_EVERY_MS);

/** The duty cycle inside the current 5 s window: the capacity answer, measured. */
const perfState = () => {
  const now = Date.now();
  const span = Math.max(1, now - perf.windowStart);
  return {
    tickBusyPct: Math.round(perf.busyMs / span * 1000) / 10,   // % of one core in the tick loop
    tickSteps: perf.steps,
    snapKbps: Math.round(perf.snapBytes / span * 100000) / 100, // ~snapshot bytes/second/1k
    windowS: Math.round(span / 100) / 10,
  };
};
const rotatePerf = () => { perf.windowStart = Date.now(); perf.busyMs = 0; perf.steps = 0; perf.snapBytes = 0; };
setInterval(rotatePerf, PERF_WINDOW_MS);

/**
 * Rate limiting: a sliding window per connection, per message kind. Input is
 * budgeted for 60 Hz with headroom; control messages get a much smaller budget,
 * because a client sends a handful of those per second and a flood of them is a bug
 * or an attack, never normal play.
 */
const RATE = {
  windowMs: 1000, input: NET.rateInputPerSec, other: NET.rateOtherPerSec, benchMs: NET.rateBenchMs,
};

/** One shared encoder for the `online` broadcast: it is the same object for everyone. */
const onlineCodec = makeCodec(CODEC);

/**
 * HTTP on the same port as the WebSocket: /status (public JSON for the Play Online
 * screen, the docker healthcheck, and capacity watching) and /healthz (200, plain).
 * Keeping them on one process means the count can never disagree with the rooms.
 */
const httpServer = createServer((req, res) => {
  const path = String(req.url || '').split('?')[0];
  if (path === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (path === '/status') {
    const online = lastOnline || onlineState();
    const body = JSON.stringify({
      ok: true, service: 'dweebs', protocol: PROTOCOL_VERSION,
      uptimeS: Math.floor((Date.now() - STARTED_AT) / 1000),
      ...online,
      sim: USE_REAL_SIM ? 'real' : 'mock', codec: CODEC,
      perf: perfState(), rssMb: Math.round(process.memoryUsage().rss / 1048576),
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body); return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('dweebs');
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });

wss.on('connection', (sock) => {
  sock.binaryType = 'arraybuffer';
  clients.add(sock);
  const state = { room: null, player: null, codec: makeCodec(CODEC), window: { in: [], other: [] }, benchUntil: 0, rtt: 0 };

  // `addNetSimulation` replaces sock.send; incoming frames are gated in handle().
  if (NET_FLAGS.lag || NET_FLAGS.loss || NET_FLAGS.jitter) addNetSimulation(sock, NET_FLAGS);

  const send = m => { if (sock.readyState === 1) sock.send(state.codec.encode(m)); };
  const fail = (code, message) => send({ t: 'error', code, message });

  sock.on('message', data => handle(data));
  sock.on('close', () => {
    clients.delete(sock);
    if (state.room && state.player) {
      state.room.dropClient(state.player, Date.now());
      state.room.broadcast(state.room.roomState());
    }
  });
  sock.on('error', () => { clients.delete(sock); });

  // The Play Online screen shows the live number the moment the socket opens, so it
  // never flashes a stale count or waits a full broadcast window on first paint.
  send({ t: 'welcome', protocol: PROTOCOL_VERSION, you: -1, tick: 0, token: '', room: '', rtt: state.rtt });
  send(onlineState());

  // Sliding window per kind; too many frames benches the connection for a beat.
  function rateOk(isInput) {
    const now = Date.now();
    if (now < state.benchUntil) return false;
    const key = isInput ? 'in' : 'other';
    state.window[key] = state.window[key].filter(t => now - t < RATE.windowMs);
    if (state.window[key].length >= (isInput ? RATE.input : RATE.other)) {
      state.benchUntil = now + RATE.benchMs;
      return false;
    }
    state.window[key].push(now);
    return true;
  }

  function handle(data) {
    // ws delivers a Buffer or an ArrayBuffer depending on binaryType; normalize to
    // bytes so the opcode check and the codec see the same thing either way.
    const bytes = typeof data === 'string' ? data
      : data instanceof ArrayBuffer ? new Uint8Array(data)
        : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);
    const isInput = typeof bytes !== 'string' && bytes.length > 0 && bytes[0] === Op.INPUT;
    if (!rateOk(isInput)) return fail(ERR.RATE_LIMIT, 'slow down');
    let m;
    try { m = state.codec.decode(bytes); } catch { return fail(ERR.MALFORMED, 'bad frame'); }
    if (!m || !m.t) return fail(ERR.MALFORMED, 'no type');

    switch (m.t) {
      case 'hello': {
        // Version gate. The reply is a room message with an empty room, NOT a
        // welcome — welcome means "you are in a room and here is your slot", and
        // sending one here would let a client think it had joined before it had.
        if (m.protocol !== PROTOCOL_VERSION) return fail(ERR.BAD_VERSION, `server speaks v${PROTOCOL_VERSION}`);
        state.rtt = Math.min(255, Math.max(0, Date.now() - m.clientTime));
        return send({ t: 'room', room: '', phase: 'hello', tick: 0, players: [] });
      }
      case 'ping':
        return send({ t: 'pong', id: m.id, clientTime: m.clientTime, serverTime: Date.now() });
      case 'join': {
        if (state.player) return fail(ERR.NOT_IN_ROOM, 'already in a room');
        const code = String(m.room || '').toUpperCase();
        if (!isRoomCode(code)) return fail(ERR.ROOM_NOT_FOUND, 'bad code');
        const room = rooms.get(code) || (m.create ? createRoom(code) : null);
        if (!room) return fail(ERR.ROOM_NOT_FOUND, 'no such room');
        const player = room.addClient(sock, m);
        if (!player) return send({ t: 'room_full', room: code });
        state.room = room; state.player = player;
        send({
          t: 'welcome', protocol: PROTOCOL_VERSION, you: player.slot, tick: room.tick,
          token: player.token, room: room.code, rtt: state.rtt,
        });
        room.broadcast(room.roomState());
        room.broadcastSnapshot();
        return;
      }
      case 'quick': {
        // PLAY NOW: the server picks the room, never the player. Answered with a
        // normal welcome + room state, so the client's path after this is identical
        // to a join-by-code — one UI path, two doors in.
        if (state.player) return fail(ERR.NOT_IN_ROOM, 'already in a room');
        const room = findQuickRoom();
        if (!room) {
          const s = onlineState();
          return send({ t: 'server_full', humans: s.humans, maxRooms: MAX_ROOMS });
        }
        const player = room.addClient(sock, m);
        if (!player) return send({ t: 'room_full', room: room.code });
        state.room = room; state.player = player;
        send({
          t: 'welcome', protocol: PROTOCOL_VERSION, you: player.slot, tick: room.tick,
          token: player.token, room: room.code, rtt: state.rtt,
        });
        room.broadcast(room.roomState());
        room.broadcastSnapshot();
        return;
      }
      case 'settings': {
        // The host's lobby rules. Non-hosts get a polite no, the client greys the
        // controls out anyway — this is the trustworthy half of that handshake.
        if (!state.player || !state.room) return fail(ERR.NOT_IN_ROOM, 'join first');
        // The binary codec flattens the patch to strings ('off' for items); decode
        // both shapes here so the room logic only ever sees typed values.
        const patch = { ...m };
        if (typeof patch.items === 'string') patch.items = patch.items === 'on' || patch.items === 'true';
        if (!state.room.applySettings(state.player, patch)) return fail(ERR.NOT_HOST, 'only the host changes the rules');
        state.room.broadcast(state.room.roomState());
        state.room.broadcastSnapshot();
        return;
      }
      case 'ready': {
        if (!state.player) return fail(ERR.NOT_IN_ROOM, 'join first');
        state.player.ready = !!m.ready;
        state.room.broadcast(state.room.roomState());
        // Every connected human ready => the match starts and the sim begins stepping.
        state.room.maybeStart();
        return;
      }
      case 'input': {
        if (!state.player) return fail(ERR.NOT_IN_ROOM, 'join first');
        if (!state.player.buffer.push(m)) return fail(ERR.BAD_INPUT, 'bad input frame');
        return;
      }
      case 'leave': {
        if (state.room && state.player) {
          state.room.dropClient(state.player, Date.now());
          state.room.broadcast(state.room.roomState());
        }
        state.room = null; state.player = null;
        return;
      }
      default:
        return fail(ERR.MALFORMED, `unknown type ${m.t}`);
    }
  }
});

// -------------------------------------------------------------- main loops ----

let last = process.hrtime.bigint();
let acc = 0, sinceSnap = 0;

setInterval(() => {
  const tickStart = process.hrtime.bigint();
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e6;
  last = now;
  // Cap catch-up at 5 ticks: a slow server must not spiral into a death loop.
  let steps = 0;
  while (acc >= TICK_MS && steps < 5) {
    acc -= TICK_MS; steps++;
    const nowMs = Date.now();
    for (const [code, room] of rooms) {   // rooms is a Map of code -> Room (entries, not values)
      room.sweepDropped(nowMs);
      // T22: evict rooms with zero humans that have idled past ROOM_IDLE_MS.
      if (room.lobby.length === 0) {
        room.idleSince ??= nowMs;
        if (nowMs - room.idleSince > ROOM_IDLE_MS) { rooms.delete(code); continue; }
      } else room.idleSince = 0;
      // A throw in one room must never kill the server tick loop (that is exactly how
      // the ready gate bug hid: an uncaught TypeError in an interval callback stops it).
      try {
        room.maybeStart(nowMs);    // ready gate: lobby -> playing (and then it steps)
        room.stepSim();
      } catch (err) {
        console.error(`[room ${code}] tick failed:`, err?.stack || err);
      }
    }
  }
  sinceSnap += steps;
  if (sinceSnap >= SNAP_EVERY) {
    sinceSnap = 0;
    for (const room of rooms.values()) {
      room.broadcastSnapshot();
      perf.snapBytes += room.humans * 256;   // rough: one delta snapshot ≈ 256 B
    }
  }
  // The capacity number /status reports: this interval's share of one core.
  perf.busyMs += Number(process.hrtime.bigint() - tickStart) / 1e6;
  perf.steps += 1;
}, 2);

process.on('SIGINT', () => { console.log('\nbye'); process.exit(0); });

httpServer.listen(PORT, () => {
  console.log(`DWEEBS server on ws://localhost:${PORT}  codec=${CODEC}  rooms auto-create on join(create)`);
  console.log(`  sim ${SIM_HZ} Hz · snapshots ${SNAPSHOT_HZ} Hz · ${MAX_PLAYERS} slots · max-rooms ${MAX_ROOMS} · reconnect hold ${RECONNECT_HOLD_MS / 1000}s` +
    (NET_FLAGS.lag || NET_FLAGS.loss ? `  netSim lag=${NET_FLAGS.lag}ms loss=${NET_FLAGS.loss}% jitter=${NET_FLAGS.jitter}ms` : ''));
});

export { Room, wss, rooms, httpServer, onlineState, findQuickRoom, MAX_ROOMS };
