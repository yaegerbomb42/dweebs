// NetClientApp.js — the real client behind the APP→NET contract.
//
// NetClient (src/net) speaks the wire: rooms by code, slots, ticks, snapshots. The
// app shell speaks the UI: rooms by name, players, ready buttons, online counts.
// This file is the translation point, and its API IS the contract published in
// COORDINATION.md — MockNetClient is the drop-in twin for offline/fault-injection.
//
// What it does, in join order:
//   1. opens a real WebSocket to the server (or a public ?server= override),
//   2. sends name/type/color + token, gets a slot back,
//   3. maps the server's `room` message to the {code,players,settings} shape lobby
//      renders, where `you`/`host`/`ping` make the READY button work,
//   4. relays the server's `online` broadcast so the Play Online screen shows the
//      live number without joining anything.
// No accounts anywhere: identity is a name + a reconnect token in localStorage, the
// same as the character select. Delete your cookies and you are a new dweeb.

/* global CustomEvent, localStorage, setTimeout, clearTimeout */

import { PROTOCOL_VERSION, MAX_PLAYERS, RECONNECT_HOLD_MS, ROOM_ALPHABET, isRoomCode } from './protocol.js';
import { NetClient, defaultUrl } from './NetClient.js';
import { SimAdapter } from '../sim/simAdapter.js';

const TOKEN_KEY = 'dweebs.token';
const JOIN_RETRY_MS = 800;         // QA's dropped-join finding: a lost join must retry
const ONLINE_STALE_MS = 6000;      // no broadcast in a while → the number is a guess

const err = (code, message) => { const e = new Error(message || code); e.code = code; return e; };
const tidyName = n => (String(n ?? '').trim().slice(0, 12) || 'dweeb');
import { VALID_TYPES } from '../player/characterList.js';
const tidyType = t => (VALID_TYPES.includes(t) ? t : 'cube');
const tidyColor = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#8ec7ff');

/**
 * @param {object} [opts]
 * @param {string|null} [opts.serverUrl]  ws URL ('' = same-origin /ws via defaultUrl)
 * @param {string} [opts.playerName]
 */
export class NetClientApp {
  constructor({ serverUrl, playerName = 'dweeb' } = {}) {
    this.serverUrl = serverUrl || null;   // null = auto (same-origin in prod, :8787 in dev)
    this.playerName = tidyName(playerName);
    this.connected = false;
    this.room = null;             // APP shape {code,players,settings}, or null
    this.online = { humans: 0, rooms: 0, matches: 0, openRooms: 0, stale: true };
    this._wire = null;            // the NetClient underneath
    this._sim = null;             // SimAdapter prediction sim in the browser
    this._handlers = new Map();   // on() subscriptions
    this._profile = { name: this.playerName, archetype: 'cube', color: '#8ec7ff' };
    this._pending = null;         // the join in flight, if any
    this._lastOnlineAt = 0;
    this._closed = false;
    this._lastJoin = null;
  }

  get mocked() { return false; }
  get rttMs() { return Math.round(this._wire?.rttMs ?? -1); }

  /** Subscribe; returns an unsubscribe function (mirrors MockNetClient.on). */
  on(type, fn) {
    const h = e => fn(e.detail);
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(h);
    return () => this._handlers.get(type)?.delete(h);
  }
  _emit(type, detail) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const h of [...set]) { try { h(new CustomEvent(type, { detail })); } catch { /* a UI handler must never kill the client */ } }
  }

  /** Open the socket (idempotent) and keep it open for the online count. */
  async connect() {
    if (this.connected && this._wire) return;
    await this._openWire();
  }

  async _openWire() {
    this._closed = false;
    this._closeWire();
    const sim = await SimAdapter.create({ players: MAX_PLAYERS, seed: (Date.now() % 2147483647) || 1 });
    this._sim = sim;
    const url = this.serverUrl || defaultUrl(typeof location !== 'undefined' ? location.search : '');
    const wire = new NetClient({
      sim, url, codec: 'bin',
      onRoom: m => this._onRoomMessage(m),
      onStatus: s => this._onWireStatus(s),
      onEvent: () => {},
    });
    wire.onOnline = m => this._onOnlineMessage(m);
    this._wire = wire;
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(err('SERVER_UNREACHABLE', 'Could not reach the server')), 8000);
      const prev = wire.onStatus;
      wire.onStatus = s => {
        prev(s);
        if (s === 'connected') { clearTimeout(to); resolve(); }
        if (s === 'disconnected' || (typeof s === 'string' && s.startsWith('error'))) { clearTimeout(to); reject(err('SERVER_UNREACHABLE', 'Could not reach the server')); }
      };
      try { wire.connect(); } catch { clearTimeout(to); reject(err('SERVER_UNREACHABLE', 'Could not reach the server')); }
    });
    this.connected = true;
    this._emit('connected', { mocked: false });
  }


  _onWireStatus(s) {
    if (s === 'disconnected') {
      const wasRoom = !!this.room;
      this.connected = false;
      this._emit('disconnected', { reason: 'network' });
      // Reconnect with the token; the server holds the slot for RECONNECT_HOLD_MS.
      this._emit('reconnecting', { attempt: 1, delayMs: 600 });
      setTimeout(() => {
        if (this._closed) return;
        this._openWire().then(() => {
          this._emit('connected', { reconnected: true });
          if (wasRoom && this._lastJoin) {
            const { kind, code, profile } = this._lastJoin;
            const again = kind === 'quick' ? this._joinOnce('quick', '', profile)
              : this._joinOnce(kind === 'create' ? 'create' : 'join', code, profile);
            again.catch(() => {});
          }
        }).catch(() => this._emit('error', { code: 'SERVER_UNREACHABLE', message: 'Could not reach the server' }));
      }, 600);
      return;
    }
    if (typeof s === 'string' && s.startsWith('error')) {
      this._emit('error', { code: 'SERVER_UNREACHABLE', message: 'Connection error' });
    }
  }

  _closeWire() {
    try { this._wire?.close(); } catch { /* already gone */ }
    this._wire = null;
  }

  // ─── joins ────────────────────────────────────────────────────────────────

  /** Private room for friends, by invite code. */
  async createRoom(profile = {}) { return this._joinOnce('create', this._newCode(), profile); }
  /** Join a friend's room by its code. */
  async joinRoom(code, profile = {}) {
    const wanted = String(code || '').toUpperCase();
    // The server only accepts the protocol's alphabet (letters, no I/L/O, no
    // digits): validate with isRoomCode, not a looser regex, so a code the app
    // accepts is a code the server will take.
    if (!isRoomCode(wanted)) throw err('ROOM_NOT_FOUND', 'Room not found');
    return this._joinOnce('join', wanted, profile);
  }
  /** PLAY NOW: the server picks the room, never the player. */
  async quickPlay(profile = {}) { return this._joinOnce('quick', '', profile); }

  _newCode() {
    // Draw from the protocol's room alphabet: the old hand-rolled alphabet included
    // digits, which the server's isRoomCode rejects — ~70% of app-created rooms
    // failed to create with a confusing "room not found".
    let s = '';
    for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    return s;
  }

  _applyProfile(profile = {}) {
    if (profile.name) this._profile.name = tidyName(profile.name);
    if (profile.archetype) this._profile.archetype = tidyType(profile.archetype);
    if (profile.color) this._profile.color = tidyColor(profile.color);
    this.playerName = this._profile.name;
  }

  async _joinOnce(kind, code, profile = {}) {
    this._applyProfile(profile);
    await this.connect();
    if (this._pending) this._failPending(err('NOT_CONNECTED', 'Already joining a room'));
    this._lastJoin = { kind, code, profile: { ...this._profile } };
    return new Promise((resolve, reject) => {
      this._pending = { kind, code, resolve, reject, timer: null, deadline: null };
      const attempt = () => {
        if (!this._pending || !this._wire?.connected) return;
        try {
          if (kind === 'quick') this._sendQuick(this._profile);
          else this._sendJoin(kind === 'create', code, this._profile);
        } catch { /* the retry timer covers a failed send */ }
        this._pending.timer = setTimeout(attempt, JOIN_RETRY_MS);
      };
      attempt();
      // A join that never answers in 10 s is not "slow", it is lost.
      this._pending.deadline = setTimeout(() => {
        if (this._pending) this._failPending(err('SERVER_UNREACHABLE', 'The server did not answer'));
      }, 10000);
    });
  }

  _token() {
    try { return this._wire?.token || localStorage.getItem(TOKEN_KEY) || ''; } catch { return this._wire?.token || ''; }
  }

  _sendJoin(create, code, profile) {
    const w = this._wire;
    w.room = code; w.create = create;
    w.name = profile.name; w.type = profile.archetype; w.color = profile.color;
    w.token = this._token();
    w.join();
  }

  _sendQuick(profile) {
    const w = this._wire;
    w.name = profile.name; w.type = profile.archetype; w.color = profile.color;
    w.token = this._token();
    w.send({ t: 'quick', token: w.token, name: w.name, type: w.type, color: w.color });
  }


  _failPending(e) {
    const p = this._pending;
    this._pending = null;
    if (p) { clearTimeout(p.timer); clearTimeout(p.deadline); p.reject(e); }
  }

  _finishPending(room) {
    const p = this._pending;
    if (!p) return;
    this._pending = null;
    clearTimeout(p.timer); clearTimeout(p.deadline);
    p.resolve(room);
  }

  // ─── wire → APP ───────────────────────────────────────────────────────────

  _onRoomMessage(m) {
    // The hello handshake's empty room is not a room; a real one always has a code.
    if (m.phase === 'hello' || !m.room) return;
    const host = typeof m.host === 'number' ? m.host : -1;
    const mySlot = this._wire?.slot ?? -1;
    this.room = {
      code: m.room,
      phase: m.phase,
      players: (m.players || []).map(p => ({
        id: 'p-' + p.slot,
        name: tidyName(p.name),
        archetype: tidyType(p.type),
        color: tidyColor(p.color),
        ready: !!p.ready,
        ping: this._wire ? Math.round(this._wire.rttMs) : null,
        host: p.slot === host,
        you: p.slot === mySlot,
        bot: !!p.bot,
        connected: p.connected !== false,
      })),
      settings: {
        stocks: Number(m.settings?.stocks) || 3,
        time: Number(m.settings?.time) || 120,
        items: m.settings?.items !== false,
        bots: Number(m.settings?.bots) || 0,
      },
    };
    this._emit('room', this.roomSnapshot());
    if (this._pending) this._finishPending(this.roomSnapshot());
  }

  _onOnlineMessage(m) {
    this.online = {
      humans: Number(m.humans) || 0, rooms: Number(m.rooms) || 0,
      matches: Number(m.matches) || 0, openRooms: Number(m.openRooms) || 0,
      seatsPerRoom: Number(m.seatsPerRoom) || MAX_PLAYERS,
      who: Array.isArray(m.who) ? m.who.map(String).slice(0, 32) : [],
      stale: false,
    };
    this._lastOnlineAt = Date.now();
    this._emit('online', { ...this.online });
  }

  /** The Play Online screen's number, never blocked on being in a room. */
  onlineSnapshot() {
    const stale = Date.now() - this._lastOnlineAt > ONLINE_STALE_MS;
    return { ...this.online, stale };
  }

  // ─── room mutations ───────────────────────────────────────────────────────

  setReady(ready) { this._wire?.setReady?.(!!ready); }

  updateProfile({ name, archetype, color } = {}) {
    this._applyProfile({ name, archetype, color });
    // The server takes identity at join; a lobby rename is a re-join away. The UI
    // applies it locally at once so the name field never lies to the player.
    if (this.room) {
      const me = this.room.players.find(p => p.you);
      if (me) {
        me.name = this._profile.name; me.archetype = this._profile.archetype; me.color = this._profile.color;
        this._emit('room', this.roomSnapshot());
      }
    }
  }

  updateSettings(patch = {}) {
    if (!this.room) return;
    const clean = {};
    if (patch.stocks !== undefined && [1, 3, 5].includes(Number(patch.stocks))) clean.stocks = Number(patch.stocks);
    if (patch.time !== undefined && [60, 120, 300].includes(Number(patch.time))) clean.time = Number(patch.time);
    if (patch.items !== undefined) clean.items = !!patch.items;
    if (patch.bots !== undefined && [0, 1, 3, 7].includes(Number(patch.bots))) clean.bots = Number(patch.bots);
    if (!Object.keys(clean).length) return;
    // Optimistic: the host sees the rule change at once; the server's broadcast
    // confirms it (or corrects a non-host's wishful click).
    Object.assign(this.room.settings, clean);
    this._emit('room', this.roomSnapshot());
    this._wire?.send?.({ t: 'settings', ...clean });
  }

  /** Plain, JSON-safe copy — the UI renders this directly. */
  roomSnapshot() {
    if (!this.room) return null;
    return JSON.parse(JSON.stringify(this.room));
  }

  leave() {
    try { this._wire?.leave?.(); } catch { /* already gone */ }
    this.room = null;
    this._lastJoin = null;
    if (this._pending) this._failPending(err('NOT_CONNECTED', 'Left the room'));
    this._emit('left', {});
  }

  disconnect() {
    this._closed = true;
    if (this._pending) this._failPending(err('NOT_CONNECTED', 'Disconnected'));
    this._closeWire();
    this.connected = false;
    this.room = null;
    this._emit('disconnected', { reason: 'client-leave' });
  }

  /** Simulate a drop for the reconnect toasts (mirrors MockNetClient.simulateDrop). */
  simulateDrop() { this._onWireStatus('disconnected'); }
}

export { PROTOCOL_VERSION, MAX_PLAYERS, RECONNECT_HOLD_MS };
