// MockNetClient.js — stand-in for NET's src/net/NetClient.js until NET merges.
//
// It implements the UI interface published in COORDINATION.md
// (Contracts → APP→NET) exactly, so the real NetClient is a drop-in
// replacement: same constructor options, same methods, same events, same
// error codes.
//
// Nothing here touches the network. It runs a fake room in memory, which is why
// the lobby is fully explorable on a plane. Fault-injection flags in the query
// string (`?mock=net`, `?mock=full`, `?mock=room`, `?mock=lag`, `?mock=quick`)
// let me and QA exercise the error and reconnect states without a server.

/* global URLSearchParams, EventTarget, CustomEvent */

const FAKE_CODE = 'ABCD';
const ROSTER = [
  { name: 'Blorp', archetype: 'blob', color: 'pink' },
  { name: 'Squish', archetype: 'spiky', color: 'blue' },
  { name: 'Nugget', archetype: 'cube', color: 'green' },
  { name: 'Wobbles', archetype: 'blob', color: 'purple' },
  { name: 'Toast', archetype: 'cube', color: 'orange' },
  { name: 'Pickle', archetype: 'spiky', color: 'teal' },
  { name: 'Gumbo', archetype: 'blob', color: 'red' },
];
export const MOCK_MAX_PLAYERS = 8;

const wait = ms => new Promise(res => setTimeout(res, ms));

function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/** Fault-injection flags from the query string, e.g. ?mock=net,full. */
function mockFlags() {
  const raw = (new URLSearchParams(location.search).get('mock') || '').toLowerCase();
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

export class MockNetClient extends EventTarget {
  constructor({ serverUrl, playerName = 'You', transportDelay = 260 } = {}) {
    super();
    this.serverUrl = serverUrl || null;   // null = mocked transport, nothing is dialled
    this.playerName = playerName;
    this.transportDelay = transportDelay;
    this.connected = false;
    this.room = null;
    this.flags = mockFlags();
    this._rttMs = 18 + Math.floor(Math.random() * 30);
    this._pingTimer = null;
    this._botTimer = null;
    this._closed = false;
  }

  get rttMs() { return this._rttMs; }
  get mocked() { return true; }

  // ─── transport ────────────────────────────────────────────────────────────

  async connect() {
    if (this.connected) return;
    await wait(this.transportDelay);
    if (this.flags.has('net')) {
      this._emit('error', { code: 'SERVER_UNREACHABLE', message: 'Could not reach the server' });
      throw fail('SERVER_UNREACHABLE', 'Could not reach the server');
    }
    this.connected = true;
    this._closed = false;
    this._pingTimer = setInterval(() => {
      // Drift the fake RTT so the ping pill is visibly alive.
      const base = this.flags.has('lag') ? 140 : 20;
      this._rttMs = Math.max(4, base + Math.round((Math.random() - 0.5) * base));
      this._emit('ping', { rttMs: this._rttMs });
    }, 1500);
    this._emit('connected', { mocked: true });
  }

  async createRoom(profile = {}) {
    await this.connect();
    await wait(this.transportDelay);
    this.room = {
      code: FAKE_CODE,
      players: [this._me(profile, { host: true })],
      settings: { stocks: 3, time: 120, items: true },
    };
    this._fillBots();
    this._startBots();
    this._emit('room', this.roomSnapshot());
    return this.roomSnapshot();
  }

  async joinRoom(code, profile = {}) {
    const wanted = String(code || '').toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(wanted)) throw fail('ROOM_NOT_FOUND', 'Room not found');

    await this.connect();
    await wait(this.transportDelay);
    if (wanted !== FAKE_CODE || this.flags.has('room')) {
      this._emit('error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
      throw fail('ROOM_NOT_FOUND', 'Room not found');
    }
    if (this.flags.has('full')) {
      this._emit('error', { code: 'ROOM_FULL', message: 'Server is full' });
      throw fail('ROOM_FULL', 'Server is full');
    }

    // A joining player lands in a room that already has a host.
    this.room = {
      code: wanted,
      players: this.flags.has('bots')
        ? [this._peer(0, { host: true, ready: true }), this._me(profile, { host: false })]
        : [this._me(profile, { host: true })],
      settings: { stocks: 3, time: 120, items: true },
    };
    this._fillBots();
    this._startBots();
    this._emit('room', this.roomSnapshot());
    return this.roomSnapshot();
  }

  /** Quick play: join the busiest open room, else make one. */
  async quickPlay(profile = {}) {
    return this.flags.has('quick') ? this.createRoom(profile) : this.joinRoom(FAKE_CODE, profile);
  }

  // ─── room mutations ───────────────────────────────────────────────────────

  setReady(ready) {
    const me = this._meInRoom();
    if (!me) return;
    me.ready = !!ready;
    this._emit('room', this.roomSnapshot());
  }

  updateProfile({ name, archetype, color } = {}) {
    const me = this._meInRoom();
    if (!me) return;
    if (name) { me.name = String(name).slice(0, 12); this.playerName = me.name; }
    if (archetype) me.archetype = archetype;
    if (color) me.color = color;
    this._emit('room', this.roomSnapshot());
  }

  updateSettings({ stocks, time, items } = {}) {
    if (!this.room) return;
    const s = this.room.settings;
    if (stocks !== undefined) s.stocks = stocks;
    if (time !== undefined) s.time = time;
    if (items !== undefined) s.items = !!items;
    this._emit('room', this.roomSnapshot());
  }

  /** Plain, JSON-safe copy — the UI renders this directly. */
  roomSnapshot() {
    if (!this.room) return null;
    return JSON.parse(JSON.stringify(this.room));
  }

  leave() {
    this._stopTimers();
    this.room = null;
    this._emit('left', {});
  }

  disconnect() {
    this._stopTimers();
    const was = this.connected;
    this.connected = false;
    if (was) this._emit('disconnected', { reason: 'client-leave' });
  }

  /** Simulate a dropped connection, to exercise the reconnect toasts. */
  simulateDrop() {
    if (!this.connected) return;
    this.connected = false;
    this._emit('disconnected', { reason: 'network' });
    this._emit('reconnecting', { attempt: 1, delayMs: 600 });
    setTimeout(() => {
      if (this._closed) return;
      this.connected = true;
      this._rttMs = 20 + Math.round(Math.random() * 40);
      this._emit('connected', { reconnected: true });
      if (this.room) this._emit('room', this.roomSnapshot());
    }, 600);
  }

  /** Subscribe; returns an unsubscribe function. */
  on(type, fn) {
    const handler = e => fn(e.detail);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  _me(profile, flags) {
    return {
      id: 'p-you',
      name: profile.name || this.playerName || 'You',
      archetype: profile.archetype || 'cube',
      color: profile.color || 'yellow',
      ready: false,
      ping: this._rttMs,
      host: !!flags.host,
      you: true,
    };
  }

  _meInRoom() { return this.room?.players.find(p => p.you) || null; }

  _peer(i, flags = {}) {
    const r = ROSTER[i % ROSTER.length];
    return {
      id: 'p-' + i,
      name: r.name,
      archetype: r.archetype,
      color: r.color,
      ready: !!flags.ready,
      ping: 15 + Math.round(Math.random() * 70),
      host: !!flags.host,
      bot: true,
    };
  }

  /** Pad the room with made-up peers, only when asked for (?mock=bots). Without it
   *  the offline lobby shows just you: fake names must never pass for real players. */
  _fillBots() {
    if (!this.room || !this.flags.has('bots')) return;
    const want = 3 + Math.floor(Math.random() * 3);
    while (this.room.players.length < want && this.room.players.length < MOCK_MAX_PLAYERS) {
      this.room.players.push(this._peer(this.room.players.length, { ready: Math.random() > 0.5 }));
    }
  }

  /** Bots toggle ready now and then, so the ready states visibly react. */
  _startBots() {
    clearInterval(this._botTimer);
    this._botTimer = setInterval(() => {
      if (!this.room) return;
      const bot = this.room.players.find(p => p.bot && Math.random() > 0.5);
      if (bot) { bot.ready = !bot.ready; this._emit('room', this.roomSnapshot()); }
    }, 4000);
  }

  _stopTimers() {
    clearInterval(this._pingTimer); this._pingTimer = null;
    clearInterval(this._botTimer); this._botTimer = null;
    this._closed = true;
  }
}

export const MOCK_ROOM_CODE = FAKE_CODE;
