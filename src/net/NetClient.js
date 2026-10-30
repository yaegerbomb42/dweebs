// NetClient.js — the browser/net half of DWEEBS netcode (NET).
/* global WebSocket, URLSearchParams, performance, localStorage, location, setInterval, clearInterval */
//
// Responsibilities, in the order they matter:
//   1. clock sync (ping/pong, NTP-style offset + RTT) so we know what "now" means on
//      the server and how far ahead of it to render;
//   2. send our input at 60 Hz, each packet repeating the last 3 frames, so one lost
//      packet costs nothing;
//   3. predict our own dweeb locally and reconcile against every snapshot by
//      rewinding to the server state and replaying our inputs — smoothed over 100 ms,
//      and never a teleport for a sub-metre error;
//   4. interpolate everyone else ~100 ms in the past, which hides 30 Hz + jitter;
//   5. hand authoritative events (KO, stock, round) to the Hud/Announcer and keep
//      cosmetic hit Fx predicted and local.
//
// The sim is injected: `new NetClient({ sim })` where sim exposes
//   { step(inputsBySlot), entities(), entityById(id), drainEvents() }
// The same object runs in the browser (src/sim) and headless in the server. Without
// one, a MockSim is used so the netcode is testable before SIM's contract lands.

import {
  PROTOCOL_VERSION, SIM_HZ, INPUT_REDUNDANCY, EMPTY_INPUT, EventKind,
  makeCodec, AUTHORITATIVE_EVENTS, sanitizeInput, normSlot,
} from './protocol.js';
import { InputHistory, CorrectionSmoother, INTERP_TICKS, sampleBuffer, MIN_SNAP_M, SMOOTH_MS } from './prediction.js';
import { addNetSimulation, parseNetFlags } from './lagSim.js';
import { MockSim } from './mockSim.js';

const PING_INTERVAL_MS = 1000;
const CLOCK_SAMPLES = 8;      // keep the last N clock samples, use the lowest RTT
const SNAP_BUFFER = 12;       // snapshots kept for interpolation (~0.4 s)
const MAX_CATCHUP_TICKS = 2; // sim steps per rendered frame, at most

/**
 * ws:// for the game server. ?server= wins; then on a deployed (https) page the
 * client uses the same origin over /ws so the game just works behind nginx with no
 * extra port to open; localhost dev keeps the classic :8787.
 */
export function defaultUrl(search = '') {
  const q = new URLSearchParams(String(search).replace(/^\?/, ''));
  const s = q.get('server');
  if (s) return s;
  if (typeof location === 'undefined') return 'ws://localhost:8787';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return `${proto}//${location.hostname}:8787`;
  }
  return `${proto}//${location.host}/ws`;
}

/** Wire entities arrive in centimetres; the view thinks in metres. */
export function toMeters(e) {
  return {
    id: e.id,
    x: e.x / 100, y: e.y / 100, z: e.z / 100,
    yaw: (e.q / 255) * Math.PI * 2,
    vx: e.vx / 100, vy: e.vy / 100, vz: e.vz / 100,
    state: e.state, flags: e.flags,
  };
}

export class NetClient {
  /** The UI-facing surface, so APP builds against this and not the internals. */
  static get interface() {
    return {
      connect: '(opts) => this',
      join: '() => this',
      setReady: '(ready:boolean) => void',
      setRematch: '(want:boolean) => void      // vote for another round after the match',
      spectate: '() => this                   // watch without a slot: no input, no votes',
      setInput: '({moveX,moveY,jump,attack,grab,dodge,special,down,aimYaw,aimLoft,charge}) => void',
      update: '(dtSeconds) => void',
      renderEntities: '() => [{id,x,y,z,yaw,mine}]   // remote dweebs are ~100ms behind',
      takeAuthoritative: '() => [{kind,id,tick}]       // KO/stock/round: drive the Hud',
      onEvent: '(cb) => void      // cosmetic hit Fx, may be predicted',
      onRoom: '(cb) => void       // {room, phase, players:[{slot,bot,connected,ready,name,type,color}]}',
      onStatus: "(cb) => void     // 'connecting'|'connected'|'joined'|'disconnected'|'error:*'|'room_full'",
      reconnect: '() => this      // reuses the token, so the server keeps your slot',
      'close': '() => void',
      room: 'string', slot: 'number', token: 'string',
      status: 'string', connected: 'boolean', ready: 'boolean',
      rttMs: 'number', lastError: 'number',
      stats: '{in,out,upBps,downBps,avgUpBps,avgDownBps}',
    };
  }

  /**
   * @param {object} [opts]
   * @param {object} [opts.sim]             shared sim (defaults to MockSim)
   * @param {string} [opts.url]             ws://… (defaults to ?server= or host:8787)
   * @param {string} [opts.room]            4-letter code
   * @param {boolean} [opts.create]         create the room if it does not exist
   * @param {boolean} [opts.spectate]       watch instead of joining (no slot, no input)
   * @param {string} [opts.name] [opts.type] [opts.color] [opts.token]
   * @param {object} [opts.net]             {lag, loss, jitter} to inject
   * @param {(c:NetClient) => void} [opts.onTick]       once per rendered frame
   * @param {(e:object) => void} [opts.onEvent]         cosmetic OR authoritative
   * @param {(room:object) => void} [opts.onRoom]
   * @param {(status:string) => void} [opts.onStatus]
   */
  constructor(opts = {}) {
    const q = typeof location !== 'undefined' ? location.search : '';
    this.flags = opts.net || parseNetFlags(q);
    this.url = opts.url || defaultUrl(q);
    this.room = (opts.room || '').toUpperCase();
    this.create = !!opts.create;
    this.spectateOnConnect = !!opts.spectate;
    this.name = opts.name || 'dweeb';
    this.type = opts.type || 'cube';
    this.color = opts.color || '#8ec7ff';
    this.token = opts.token || '';

    this.codec = makeCodec(opts.codec || 'bin');
    this.sim = opts.sim || new MockSim({ players: 8 });
    this.onEvent = opts.onEvent || (() => {});
    this.onRoom = opts.onRoom || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.onTick = opts.onTick || (() => {});

    this.sock = null;
    this.slot = -1;
    this.spectating = false;   // watching a room: snapshots render, nothing is predicted
    this.status = 'idle';
    this.connected = false;
    this.ready = false;

    this.tick = 0;                  // our predicted tick
    this.acc = 0;
    this.input = { ...EMPTY_INPUT };
    this.history = new InputHistory();
    this.smoother = new CorrectionSmoother();
    this.snapBuffer = [];           // [{tick, entities}] for remote interpolation
    this.serverTick = 0;
    this.serverEntities = new Map();

    this.clock = { offset: 0, rtt: 0, samples: [] };
    this.pingId = 0;
    this.pingSent = new Map();

    this.authoritative = [];        // queued for the Hud/Announcer, never predicted
    this.lastError = 0;
    this.lastErrorMsg = null;
    this.stats = { in: 0, out: 0, upBps: 0, downBps: 0, avgUpBps: 0, avgDownBps: 0 };
    this._timers = [];
    this._bwAt = 0; this._bwIn = 0; this._bwOut = 0;
  }

  // --------------------------------------------------------------- lifecycle --

  connect() {
    this.setStatus('connecting');
    const sock = new WebSocket(this.url);
    sock.binaryType = 'arraybuffer';
    // ?lag=120&loss=2 in the URL wraps the socket before anything else uses it.
    if (this.flags.lag || this.flags.loss || this.flags.jitter) addNetSimulation(sock, this.flags);
    this.sock = sock;
    sock.onopen = () => {
      this.connected = true;
      this.setStatus('connected');
      // The codec rides in hello so the server answers in kind (see server/index.js);
      // without it a --codec json server and a bin client could never talk.
      this.send({ t: 'hello', client: 'dweebs-web', clientTime: Date.now(), protocol: PROTOCOL_VERSION, codec: this.codec.name });
      if (this.spectateOnConnect) this.spectate();
      else this.join();
      this.startPing();
    };
    sock.onclose = () => { this.connected = false; this.setStatus('disconnected'); this.stopTimers(); };
    sock.onerror = () => this.setStatus('error');
    sock.onmessage = ev => {
      this.stats.in += ev.data.byteLength ?? ev.data.length ?? 0;
      let m;
      try { m = this.codec.decode(ev.data); } catch { return; }
      this.handle(m);
    };
    return this;
  }

  /** Reconnect keeps the token, so the server hands back the same slot and dweeb. */
  reconnect() {
    if (!this.token && typeof localStorage !== 'undefined') {
      this.token = localStorage.getItem('dweebs.token') || '';
    }
    this.close();
    return this.connect();
  }

  join() {
    this.send({
      t: 'join', room: this.room, create: this.create, token: this.token,
      name: this.name, type: this.type, color: this.color,
    });
    // QA's dropped-join finding: a lost join frame was permanent. Retry until the
    // server answers (welcome, room_full, or error:*), backed off at the input
    // budget's pace — the control rate limit is generous, a retry every 0.8 s is not.
    clearTimeout(this._joinRetry);
    const retry = () => {
      if (this.slot >= 0) return;                    // welcome arrived, stop
      if (this.status === 'room_full' || this.status === 'joined'
        || (typeof this.status === 'string' && this.status.startsWith('error'))) return;
      if (this.sock && this.sock.readyState === 1) this.join();
      else return;                                   // reconnect restarts the loop
      this._joinRetry = setTimeout(retry, 800);
    };
    this._joinRetry = setTimeout(retry, 800);
  }

  setReady(v) { if (this.spectating) return; this.ready = !!v; this.send({ t: 'ready', ready: this.ready }); }
  /** Vote for a rematch (or withdraw the vote). Unanimous => the room resets to lobby. */
  setRematch(want) { this.send({ t: 'rematch', want: !!want }); }
  /**
   * Watch the room without playing: no slot, no input, no votes. Snapshots are
   * rendered as-is; nothing is predicted or reconciled.
   */
  spectate() {
    this.send({
      t: 'spectate', room: this.room, token: this.token,
      name: this.name, type: this.type, color: this.color,
    });
    // The room might not exist yet (the spectator beat the host): retry until the
    // server confirms, like the join retry. room_not_found is retried; other
    // errors are terminal.
    clearTimeout(this._spectateRetry);
    const retry = () => {
      if (this.status === 'spectating') return;
      if (typeof this.status === 'string' && this.status.startsWith('error')
        && this.status !== 'error:room_not_found') return;
      if (this.sock && this.sock.readyState === 1) this.spectate();
      else return;
      this._spectateRetry = setTimeout(retry, 800);
    };
    this._spectateRetry = setTimeout(retry, 800);
    return this;
  }
  /**
   * The ready handshake's lost-frame recovery. The server only starts the match when
   * every connected human is ready; if our ready frame was dropped, the room sits in
   * the lobby forever while the UI shows us as ready. The server heartbeats the lobby
   * state, so any disagreement is eventually visible — and we close the loop by
   * re-sending ready until the server agrees. Idempotent server-side, so a duplicate
   * is harmless.
   */
  _confirmReady(m) {
    if (m.phase !== 'lobby' || !this.ready || this.slot < 0) return;
    const me = (m.players || []).find(p => p.slot === this.slot && !p.bot);
    if (me && !me.ready) this.send({ t: 'ready', ready: true });
  }
  leave() { this.send({ t: 'leave' }); }
  close() { this.stopTimers(); if (this.sock) this.sock.close(); }
  setStatus(s) { this.status = s; this.onStatus(s); }

  send(m) {
    if (!this.sock || this.sock.readyState !== 1) return;
    const data = this.codec.encode(m);
    this.stats.out += typeof data === 'string' ? data.length : data.byteLength;
    this.sock.send(data);
  }

  startPing() {
    this._timers.push(setInterval(() => {
      const id = ++this.pingId;
      this.pingSent.set(id, performance.now());
      if (this.pingSent.size > 32) this.pingSent.delete(this.pingSent.keys().next().value);
      this.send({ t: 'ping', id, clientTime: Date.now() });
    }, PING_INTERVAL_MS));
  }

  stopTimers() { for (const t of this._timers) clearInterval(t); this._timers = []; clearTimeout(this._joinRetry); clearTimeout(this._spectateRetry); }

  // ---------------------------------------------------------------- clock sync --

  /**
   * NTP-style, with `offset` meaning "serverClock = localClock + offset":
   *   offset = ((t1 - t0) + (t3 - t2)) / 2      (t0, t3 local · t1, t2 server)
   *   rtt    = (t3 - t0) - (t1 - t2)
   * We keep the sample with the lowest RTT, because that estimates the path delay
   * best, and use a rolling median offset so one spike cannot jerk the timeline.
   */
  onPong(m) {
    const t0 = this.pingSent.get(m.id);
    if (t0 === undefined) return;
    this.pingSent.delete(m.id);
    const t1 = m.clientTime, t2 = m.serverTime, t3 = performance.now();
    const rtt = (t3 - t0) - (t1 - t2);
    if (rtt < 0 || rtt > 5000) return;              // a garbage sample is worse than none
    const offset = ((t1 - t0) + (t3 - t2)) / 2;
    const s = this.clock.samples;
    s.push({ rtt, offset });
    if (s.length > CLOCK_SAMPLES) s.shift();
    this.clock.rtt = s.reduce((a, b) => (b.rtt < a.rtt ? b : a)).rtt;
    const offsets = s.map(x => x.offset).sort((a, b) => a - b);
    this.clock.offset = offsets[offsets.length >> 1];
  }

  /** Server time, as best we can tell it, in ms. */
  get serverNow() { return Date.now() + this.clock.offset; }
  get rttMs() { return this.clock.rtt; }
  /**
   * Extra ticks of interpolation delay that scale with observed RTT spread.
   * A calm connection keeps the 100 ms baseline; a jittery one buffers up to
   * ~100 ms more so remote Dweebs glide instead of teleporting between snapshots.
   */
  get interpTicks() {
    const s = this.clock.samples;
    if (s.length < 3) return INTERP_TICKS;
    let lo = Infinity, hi = 0;
    for (const x of s) { if (x.rtt < lo) lo = x.rtt; if (x.rtt > hi) hi = x.rtt; }
    const jitter = (hi - lo) / 2;
    return Math.min(INTERP_TICKS + 3, INTERP_TICKS + Math.ceil(jitter / (1000 / SIM_HZ)));
  }
  /** The tick we render at: ~100 ms behind the newest snapshot (+ jitter padding). */
  get renderTick() { return this.serverTick - this.interpTicks; }

  // ----------------------------------------------------------------- handlers --

  handle(m) {
    switch (m.t) {
      case 'welcome':
        // normSlot: the binary wire cannot hold the greeting's you=-1, so it arrives
        // as 2^32-1 — normalize before anything treats it as a seat. And the greeting
        // must never clobber a real slot: under jitter it can arrive after the join's
        // welcome, and it carries the schema version and nothing else.
        clearTimeout(this._joinRetry);
        if (m.spectating) {
          // The server confirmed the watch: no slot, no token, just the room.
          this.spectating = true;
          clearTimeout(this._spectateRetry);
          this.room = m.room || this.room;
          this.setStatus('spectating');
          return;
        }
        if (normSlot(m.you) < 0 || !m.token) {
          // The pre-handshake greeting: it carries the schema version and nothing
          // else, and must never mark the client as joined (see the version gate).
          this.room = m.room || this.room;
          return;
        }
        this.slot = normSlot(m.you);
        this.room = m.room || this.room;
        this.token = m.token || this.token;
        if (this.token && typeof localStorage !== 'undefined') {
          localStorage.setItem('dweebs.token', this.token);
        }
        this.setStatus('joined');
        return;
      case 'room':
        this.roomState = m;
        this.onRoom(m);
        this._confirmReady(m);
        return;
      case 'snapshot':
        return this.onSnapshot(m);
      case 'event':
        return this.onEvents(m);
      case 'pong':
        return this.onPong(m);
      case 'online':
        // The live headcount, on every connection whether joined or not. Relays to
        // the UI through onOnline when it exists; the shell's facade owns that hook.
        if (typeof this.onOnline === 'function') this.onOnline(m);
        return;
      case 'server_full':
        this.lastErrorMsg = { t: 'error', code: 'server_full', message: 'The servers are full right now' };
        this.setStatus('error:server_full');
        return;
      case 'error':
        this.lastErrorMsg = m;
        this.setStatus(`error:${m.code}`);
        return;
      case 'room_full':
        this.setStatus('room_full');
        return;
      default:
        return undefined;
    }
  }

  onSnapshot(m) {
    // Spectators don't predict: they render the authoritative feed as-is. The
    // interpolation buffer still smooths the 30 Hz snapshots for them.
    if (this.spectating) {
      if (m.tick <= this.serverTick && this.snapBuffer.length) return;
      if (m.full || this.snapBuffer.length === 0) this.serverEntities = new Map();
      for (const e of m.entities) this.serverEntities.set(e.id, e);
      this.snapBuffer.push({ tick: m.tick, entities: m.entities.map(toMeters) });
      if (this.snapBuffer.length > SNAP_BUFFER) this.snapBuffer.shift();
      this.serverTick = Math.max(this.serverTick, m.tick);
      return;
    }
    // Jitter can reorder packets. Reconciling an older snapshot after a newer one
    // rewinds the sim and shows up as a rubber-band, so stale snapshots are dropped.
    if (m.tick <= this.serverTick && this.joined) return;
    const full = m.full || this.snapBuffer.length === 0;
    if (full) this.serverEntities = new Map();
    for (const e of m.entities) this.serverEntities.set(e.id, e);
    this.snapBuffer.push({ tick: m.tick, entities: m.entities.map(toMeters) });
    if (this.snapBuffer.length > SNAP_BUFFER) this.snapBuffer.shift();
    this.serverTick = Math.max(this.serverTick, m.tick);
    // The very first snapshot is a join, not a correction: the local sim was
    // initialised from our own defaults, so its dweeb can be metres from the server's.
    // Adopting the authoritative state outright is right here — smoothing a spawn would
    // mean gliding in from nowhere. Every snapshot after this one reconciles.
    if (!this.joined) {
      this.joined = true;
      this.tick = m.tick;
      this.adopt();
      this.smoother.reset();
      // Restart the byte counters: the join burst (full snapshot, room state, welcome)
      // is not steady-state traffic, and averaging it in makes the client look like it
      // is using 35 KB/s when it is using less than half the budget.
      this.stats.in = 0; this.stats.out = 0;
      this._bwIn = 0; this._bwOut = 0; this._openedAt = 0; this._bwAt = 0;
      return;
    }
    // Keep our tick clock tied to the server's. If we fall behind (a long stall), the
    // input buffer drains, and re-anchoring here costs one dropped tick instead of a
    // growing prediction error.
    if (m.tick > this.tick) this.tick = m.tick;
    this.reconcile(m.tick);
  }

  /** Snap the local sim to the authoritative state for our dweeb, with no easing. */
  adopt() {
    const truth = this.myAuthority();
    const mine = this.myEntity();
    if (!truth || !mine) return;
    mine.x = truth.x; mine.y = truth.y; mine.z = truth.z;
    mine.vx = truth.vx; mine.vy = truth.vy; mine.vz = truth.vz;
    mine.yaw = truth.yaw;
    this.history.map.clear();
  }

  onEvents(m) {
    for (const ev of m.events) {
      const e = { ...ev, tick: m.tick, authoritative: AUTHORITATIVE_EVENTS.has(ev.kind) };
      if (e.authoritative) this.authoritative.push(e);
      this.onEvent(e);
    }
  }

  // ------------------------------------------------------ prediction/replay --

  /**
   * Rewind-and-replay. The server's snapshot says where our dweeb was at `serverTick`;
   * that is truth. We put our dweeb back there, replay every input we sent after it,
   * and whatever error is left is the prediction error.
   *
   * The error never becomes a teleport. It becomes a smoothing offset that decays to
   * zero over SMOOTH_MS, and an error under MIN_SNAP_M (1 m) is only ever eased in —
   * a sub-metre disagreement is invisible in motion, and snapping there is exactly
   * what makes netcode feel bad.
   *
   * @param {number} serverTick
   * @returns {number} error magnitude in metres (for tests and the HUD)
   */
  reconcile(serverTick) {
    const truth = this.myAuthority();
    const mine = this.myEntity();
    if (!truth || !mine) return 0;

    const predicted = { x: mine.x, y: mine.y, z: mine.z };
    // rewind to the authoritative state, then replay our inputs after that tick
    mine.x = truth.x; mine.y = truth.y; mine.z = truth.z;
    mine.vx = truth.vx; mine.vy = truth.vy; mine.vz = truth.vz;
    mine.yaw = truth.yaw;
    for (const [, input] of this.history.since(serverTick + 1)) {
      this.sim.step(new Map([[this.slot, input]]));
    }

    const err = { x: mine.x - predicted.x, y: mine.y - predicted.y, z: mine.z - predicted.z };
    const mag = Math.hypot(err.x, err.y, err.z);
    this.lastError = mag;
    if (mag > 1e-4) this.smoother.begin(err);
    return mag;
  }

  /** Our dweeb in the local (predicted) sim, or null before we have joined. */
  myEntity() {
    if (this.slot < 0) return null;
    return this.sim.entityById ? this.sim.entityById(this.slot + 1) : null;
  }

  /** Our authoritative state in metres from the newest snapshot we hold. */
  myAuthority() {
    if (this.slot < 0) return null;
    const e = this.serverEntities.get(this.slot + 1);   // the sim maps slot -> entity id
    return e ? toMeters(e) : null;
  }

  // ----------------------------------------------------------------- ticking --

  /** Feed the current input every frame; it is sanitized before it goes anywhere. */
  setInput(input) { if (!this.spectating) this.input = sanitizeInput(input); }

  /**
   * @param {number} dt seconds since the last call (frame time)
   *
   * Catch-up is capped at 2 ticks. Running 5 to "catch up" after a slow frame moves
   * the dweeb several ticks' worth in one frame, which the view sees as a jump — the
   * same feel problem as a teleport, caused by the clock instead of the network. The
   * leftover accumulator is dropped rather than repaid: the client clock is allowed to
   * drift a few ms per second, which is imperceptible, and the server's snapshots keep
   * pulling the timeline back into agreement anyway.
   */
  update(dt) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= 1 / SIM_HZ && steps < MAX_CATCHUP_TICKS) {
      this.acc -= 1 / SIM_HZ;
      this.stepLocal();
      steps++;
    }
    if (this.acc > 1 / SIM_HZ) this.acc = 0;
    this.stepsThisFrame = steps;
    this.smoother.step(dt);
    this.onTick(this);
    this.updateBandwidth();
  }

  stepLocal() {
    // No prediction before the first snapshot: without an authoritative baseline the
    // sim would free-run for a full RTT and then "correct" by metres, which is the
    // single ugliest thing netcode can do. We idle until the server anchors us.
    if (!this.joined) { this.tick++; return; }
    this.tick++;
    const frame = sanitizeInput(this.input);
    this.history.record(this.tick, frame);
    this.sim.step(new Map([[this.slot, frame]]));
    this.sendInput(frame);
  }

  /**
   * Send this tick's input plus the previous INPUT_REDUNDANCY-1 frames, so a dropped
   * packet is covered by the next one. That is the whole point of the redundancy.
   */
  sendInput(frame) {
    if (this.slot < 0 || this.spectating) return;
    const frames = [];
    for (let i = INPUT_REDUNDANCY - 1; i >= 0; i--) {
      const t = this.tick - i;
      frames.push(t === this.tick ? frame : (this.history.map.get(t) || frame));
    }
    this.send({ t: 'input', tick: this.tick, ack: this.serverTick, frames });
  }

  // ------------------------------------------------------------------- render --

  /**
   * What the view should draw this frame: everyone except us interpolated ~100 ms
   * behind (hiding 30 Hz and jitter), and us at the predicted position with whatever
   * smoothing offset is still being eased out.
   * @returns {{id:number, x:number, y:number, z:number, yaw:number, mine:boolean}[]}
   */
  renderEntities() {
    const sampled = sampleBuffer(this.snapBuffer, this.renderTick);
    // Spectators have no dweeb: everything in the feed renders, nobody is "mine".
    if (this.spectating) return (sampled ? sampled.entities : []).map(e => ({ ...e, mine: false }));
    const meId = this.slot + 1;
    const out = [];
    for (const e of (sampled ? sampled.entities : [])) {
      if (e.id === meId) continue;                        // ours comes from prediction
      out.push({ ...e, mine: false });
    }
    const me = this.myEntity();
    if (me) {
      const off = this.smoother.offset;
      out.push({ id: me.id, x: me.x + off.x, y: me.y + off.y, z: me.z + off.z, yaw: me.yaw, mine: true });
    }
    return out;
  }

  /**
   * Rolling byte counters, so the HUD can show KB/s in each direction.
   *
   * `avgDownBps` is the mean since the connection opened. Prefer it over
   * `downBps` when you want the real figure: snapshots arrive in bursts once latency
   * and jitter are applied, so any short window can catch two bursts and report double.
   */
  updateBandwidth() {
    const now = performance.now();
    if (this._openedAt) {
      const total = (now - this._openedAt) / 1000;
      if (total > 0.5) {
        this.stats.avgDownBps = this.stats.in / total;
        this.stats.avgUpBps = this.stats.out / total;
      }
    } else {
      this._openedAt = now;
    }
    const dt = (now - this._bwAt) / 1000;
    this._bwAt = now;
    if (dt < 0.5) return;
    this.stats.downBps = (this.stats.in - this._bwIn) / dt;
    this.stats.upBps = (this.stats.out - this._bwOut) / dt;
    this._bwIn = this.stats.in; this._bwOut = this.stats.out;
  }

  /** Pull authoritative events for the Hud/Announcer; they are never predicted. */
  takeAuthoritative() { const a = this.authoritative; this.authoritative = []; return a; }
}

export { EventKind, AUTHORITATIVE_EVENTS, SMOOTH_MS, MIN_SNAP_M };
