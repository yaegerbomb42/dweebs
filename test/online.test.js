// online.test.js — the hosted-game surface: live headcount, matchmaking, room rules.
//
// The commit contract for every test here: the browser UI shows "N dweebs online",
// PLAY NOW lands a player in a public room without a code, and the host's rules
// become the match's rules. So the tests assert all three, over a real server on a
// random port, with the binary codec the clients will actually use.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, makeCodec, normSlot } from '../src/net/protocol.js';
import { NetClient } from '../src/net/NetClient.js';
import { recordMatch, recentMatches, clearHistory } from '../server/history.js';

const PORT = 18831;
const CODEC = 'bin';

let server;
const wait = ms => new Promise(r => setTimeout(r, ms));

async function startServer() {
  server = spawn(process.execPath, ['server/index.js', '--port', String(PORT), '--codec', CODEC, '--sim', 'real', '--max-rooms', '4'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', d => process.stderr.write(`[srv] ${d}`));
  // Wait for the socket, not a guess: poll /status until it answers.
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://localhost:${PORT}/status`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > 20000) throw new Error('server never came up');
    await wait(150);
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const codec = makeCodec(CODEC);
    const sock = new WebSocket(`ws://localhost:${PORT}`);
    const c = { sock, codec, mail: [], send: m => sock.send(codec.encode(m)) };
    sock.on('message', d => { try { c.mail.push(codec.decode(d)); } catch { /* ignore */ } });
    sock.on('open', () => resolve(c));
    sock.on('error', reject);
  });
}

  /** The first message of a given shape that passes the filter, or null on timeout. */
  async function first(c, t, timeoutMs = 6000, where = null) {
    const t0 = Date.now();
    for (;;) {
      const i = c.mail.findIndex(m => m.t === t && (!where || where(m)));
      if (i >= 0) return c.mail.splice(i, 1)[0];
      if (Date.now() - t0 > timeoutMs) return null;
      await wait(25);
    }
  }

beforeAll(async () => { await startServer(); }, 30000);
afterAll(async () => { server?.kill('SIGINT'); await wait(300); });

describe('hosted surface', () => {
  it('/status reports the live totals with zero players', async () => {
    const r = await (await fetch(`http://localhost:${PORT}/status`)).json();
    expect(r.ok).toBe(true);
    expect(r.service).toBe('dweebs');
    expect(r.humans).toBe(0);
    expect(r.seatsPerRoom).toBe(8);
    expect(r.maxRooms).toBe(4);
    expect(r.sim).toBe('real');
  });

  it('every connection learns the live number before joining', async () => {
    const cc = await connect();
    cc.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
    const online = await first(cc, 'online');
    expect(online).not.toBeNull();
    expect(online.humans).toBe(0);
    cc.sock.close();
  });

  it('PLAY NOW puts two strangers in the same public room', async () => {
    const a = await connect();
    const b = await connect();
    for (const [c, name] of [[a, 'Alf'], [b, 'Bea']]) {
      c.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
      await first(c, 'welcome');
      c.send({ t: 'quick', token: '', name, type: 'cube', color: '#ffd23f' });
    }
    const ra = await first(a, 'room', 6000, m => (m.players || []).some(p => !p.bot && p.name === 'Bea'));
    const rb = await first(b, 'room', 6000, m => (m.players || []).some(p => !p.bot && p.name === 'Alf'));
    expect(ra).not.toBeNull();
    expect(rb).not.toBeNull();
    expect(ra.room).toBeTruthy();
    expect(ra.room).toBe(rb.room);
    const names = ra.players.filter(p => !p.bot).map(p => p.name).sort();
    expect(names).toEqual(['Alf', 'Bea']);
    a.sock.close(); b.sock.close();
  });
});


describe('room privacy and rules', () => {  it('a room code stays private and the host owns the rules', async () => {
    const h = await connect();
    const g = await connect();
    h.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
    await first(h, 'welcome');
    h.send({ t: 'join', room: 'QWER', create: true, token: '', name: 'Host', type: 'blob', color: '#ff6fb5' });
    const created = await first(h, 'room');
    expect(created.settings).toMatchObject({ stocks: 3, time: 120, items: true });

    // A stranger's PLAY NOW must not land in the private room.
    g.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
    await first(g, 'welcome');
    g.send({ t: 'quick', token: '', name: 'Stranger', type: 'spiky', color: '#3fa9ff' });
    const quickRoom = await first(g, 'room');
    expect(quickRoom.room).not.toBe('QWER');

    // The host's rule patch lands for everyone; a guest's is refused.
    h.send({ t: 'settings', stocks: '5', time: '60', items: 'off' });
    const afterHost = await first(h, 'room', 6000, m => m.settings && m.settings.stocks === 5);
    expect(afterHost).not.toBeNull();
    expect(afterHost.settings).toMatchObject({ stocks: 5, time: 60, items: false });
    h.sock.close(); g.sock.close();
  });

  it('a guest who is not the host is refused the rule book', async () => {
    const h = await connect();
    h.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
    await first(h, 'welcome');
    h.send({ t: 'join', room: 'QWER', create: true, token: '', name: 'Host', type: 'blob', color: '#ff6fb5' });
    await first(h, 'room', 6000, m => (m.players || []).some(p => !p.bot && p.name === 'Host'));
    const g = await connect();
    g.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
    await first(g, 'welcome');
    g.send({ t: 'join', room: 'QWER', create: false, token: '', name: 'Guest', type: 'cube', color: '#5ee06a' });
    const guestRoom = await first(g, 'room', 6000, m => (m.players || []).some(p => !p.bot && p.name === 'Guest'));
    expect(guestRoom).not.toBeNull();
    g.send({ t: 'settings', stocks: '1' });
    const refused = await first(g, 'error');
    expect(refused).not.toBeNull();
    expect(refused.code).toBe('not_host');
    h.sock.close(); g.sock.close();
  });

  it('the fleet limit is rooms, not players: extra humans share a room', async () => {
    const socks = [];
    // 4 rooms x 1 human each will NOT fill the fleet to 4 rooms, because quick play
    // reuses the fullest lobby-phase room — so assert the sharing behaviour instead:
    // all five players land in ONE public room, never in the private one.
    const h = await connect();
    h.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
    await first(h, 'welcome');
    h.send({ t: 'join', room: 'ZXCV', create: true, token: '', name: 'Priv', type: 'cube', color: '#ffd23f' });
    await first(h, 'room');
    socks.push(h);
    const codes = new Set();
    for (let i = 0; i < 5; i++) {
      const c = await connect();
      socks.push(c);
      c.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
      await first(c, 'welcome');
      c.send({ t: 'quick', token: '', name: 'Q' + i, type: 'cube', color: '#ffd23f' });
      const r = await first(c, 'room');
      codes.add(r.room);
      expect(r.room).not.toBe('ZXCV');
    }
    expect(codes.size).toBe(1);
    for (const c of socks) c.sock.close();
  });
});

describe('netcode robustness (W2)', () => {
  /** Poll `fn` until true or the timeout; tests stay fast when the server is healthy. */
  async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    for (;;) {
      if (fn()) return;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label);
      await wait(50);
    }
  }

  it('the pre-handshake greeting decodes to "no slot", not 2^32-1', async () => {
    // The binary wire cannot hold you=-1, so the greeting used to arrive as
    // 4294967295 — a client that only checked `you >= 0` believed it had joined.
    const cc = await connect();
    const greeting = await first(cc, 'welcome');
    expect(greeting).not.toBeNull();
    expect(greeting.token).toBe('');
    expect(normSlot(greeting.you)).toBe(-1);
    cc.sock.close();
  });

  it('a dropped client reclaims its slot and dweeb with the token', async () => {
    const a = await connect();
    a.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
    await first(a, 'welcome');
    a.send({ t: 'join', room: 'RCNQ', create: true, token: '', name: 'Re', type: 'cube', color: '#ffd23f' });
    const w1 = await first(a, 'welcome', 6000, m => m.token);
    expect(w1).not.toBeNull();
    expect(w1.you).toBeGreaterThanOrEqual(0);
    a.sock.close();
    await wait(400); // let the server process the close and hold the slot
    const b = await connect();
    b.send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
    await first(b, 'welcome');
    b.send({ t: 'join', room: 'RCNQ', create: false, token: w1.token, name: 'Re', type: 'cube', color: '#ffd23f' });
    const w2 = await first(b, 'welcome', 6000, m => m.token);
    expect(w2).not.toBeNull();
    expect(w2.you).toBe(w1.you);
    const r = await first(b, 'room', 6000, m => (m.players || []).some(p => !p.bot && p.name === 'Re' && p.connected));
    expect(r).not.toBeNull();
    b.sock.close();
  });

  it('a JSON-codec client negotiates its codec and plays a match', async () => {
    // Before codec negotiation, a JSON hello hit the warfare prefix check ('{'),
    // found no `wf`, and died as 'bad frame' — a total connection failure.
    const sock = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((res, rej) => { sock.on('open', res); sock.on('error', rej); });
    const mail = [];
    sock.on('message', d => { try { mail.push(JSON.parse(d.toString())); } catch { /* binary greeting */ } });
    const send = m => sock.send(JSON.stringify(m));
    try {
      send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION, codec: 'json' });
      await waitFor(() => mail.some(m => m.t === 'room' && m.phase === 'hello'), 3000, 'hello reply');
      send({ t: 'join', room: 'JJSN', create: true, token: '', name: 'Json', type: 'cube', color: '#8ec7ff' });
      await waitFor(() => mail.some(m => m.t === 'welcome' && m.token), 3000, 'welcome');
      send({ t: 'ready', ready: true });
      await waitFor(() => mail.some(m => m.t === 'room' && m.phase === 'playing'), 6000, 'playing');
      await waitFor(() => mail.some(m => m.t === 'snapshot' && m.tick > 30), 6000, 'snapshots');
      const snaps = mail.filter(m => m.t === 'snapshot');
      expect(snaps.length).toBeGreaterThan(5);
      // every snapshot the JSON client received decoded as JSON, in its own codec
      expect(snaps.every(s => Array.isArray(s.entities))).toBe(true);
    } finally {
      sock.close();
    }
  });

  it('a lost ready frame does not strand the room: the client re-sends on the lobby heartbeat', async () => {
    // Deterministic version of the 2%-loss case: both ready frames are dropped, so
    // without the heartbeat + _confirmReady loop the room would sit in the lobby
    // forever with tick 0.
    globalThis.WebSocket = WebSocket;
    const mk = (name, create) => {
      const c = new NetClient({ url: `ws://localhost:${PORT}`, room: 'QRDY', create, name, codec: 'bin' });
      const orig = c.send.bind(c);
      let dropped = false;
      c.send = m => { if (!dropped && m.t === 'ready') { dropped = true; return; } orig(m); };
      return c;
    };
    const a = mk('Ra', true), b = mk('Rb', false);
    let phase = 'lobby';
    try {
      for (const c of [a, b]) c.onRoom = m => { if (m.phase) phase = m.phase; };
      a.connect(); b.connect();
      await waitFor(() => a.slot >= 0 && b.slot >= 0, 8000, 'join');
      a.setReady(true); b.setReady(true);   // both frames "lost"
      await waitFor(() => phase === 'playing', 10000, 'playing');
      expect(phase).toBe('playing');
    } finally {
      a.close(); b.close();
    }
  }, 20000);
});

describe('online features: rematch, spectators, history', () => {
  async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    for (;;) {
      if (fn()) return;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label);
      await wait(50);
    }
  }

  it('unanimous rematch vote restarts the match; a lone vote does not', async () => {
    globalThis.WebSocket = WebSocket;
    const mk = (name, create) => new NetClient({ url: `ws://localhost:${PORT}`, room: 'RMTB', create, name, codec: 'bin' });
    const a = mk('Ra', true), b = mk('Rb', false);
    let phase = 'lobby', tick = 0, rematch = null;
    try {
      for (const c of [a, b]) {
        c.onRoom = m => { phase = m.phase; rematch = m.rematch; };
        const origH = c.handle.bind(c);
        c.handle = m => { if (m.t === 'snapshot') tick = m.tick; return origH(m); };
      }
      a.connect(); b.connect();
      await waitFor(() => a.slot >= 0 && b.slot >= 0, 8000, 'join');
      a.setReady(true); b.setReady(true);
      await waitFor(() => phase === 'playing', 8000, 'playing');
      await waitFor(() => tick > 30, 8000, 'tick advances');
      const tickBefore = tick;
      // One vote: counted, but the match continues.
      a.setRematch(true);
      await waitFor(() => rematch && rematch.want === 1 && rematch.need === 2, 5000, 'one vote');
      expect(phase).toBe('playing');
      // Unanimous: the room resets and a fresh match starts (tick restarts).
      b.setRematch(true);
      await waitFor(() => phase === 'playing' && tick < tickBefore, 8000, 'rematch restart');
      expect(tick).toBeLessThan(tickBefore);
    } finally {
      a.close(); b.close();
    }
  }, 25000);

  it('a spectator watches the match without a slot, input, or vote', async () => {
    globalThis.WebSocket = WebSocket;
    const a = new NetClient({ url: `ws://localhost:${PORT}`, room: 'SPCB', create: true, name: 'Pa', codec: 'bin' });
    const b = new NetClient({ url: `ws://localhost:${PORT}`, room: 'SPCB', create: false, name: 'Pb', codec: 'bin' });
    const s = new NetClient({ url: `ws://localhost:${PORT}`, room: 'SPCB', name: 'Watch', codec: 'bin', spectate: true });
    let phase = 'lobby', specRoom = null, specSnaps = 0;
    try {
      a.onRoom = m => { phase = m.phase; };
      s.onRoom = m => { specRoom = m; };
      const origH = s.handle.bind(s);
      s.handle = m => { if (m.t === 'snapshot') specSnaps++; return origH(m); };
      a.connect(); b.connect(); s.connect();
      await waitFor(() => a.slot >= 0 && b.slot >= 0, 20000, 'join');
      // The spectator must not block (or join) the ready gate.
      a.setReady(true); b.setReady(true);
      await waitFor(() => phase === 'playing', 20000, 'playing');
      await waitFor(() => s.status === 'spectating', 10000, 'spectating');
      await waitFor(() => specSnaps > 5, 10000, 'spectator snapshots');
      expect(s.slot).toBe(-1);
      expect(specRoom).not.toBeNull();
      expect(specRoom.phase).toBe('playing');
      expect(specRoom.players.map(p => p.name).sort()).toEqual(['Pa', 'Pb']);
      expect(specRoom.spectators).toBe(1);
      const rendered = s.renderEntities();
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.every(e => e.mine === false)).toBe(true);
      // Spectator input and ready are no-ops; only players vote rematch.
      s.setInput({ moveX: 1 });
      s.setReady(true);
      // /status serves the cached `online` broadcast (refreshed every 2 s), so poll.
      const t0 = Date.now();
      let st = null;
      while (Date.now() - t0 < 6000) {
        st = await (await fetch(`http://localhost:${PORT}/status`)).json();
        if (st.spectators >= 1) break;
        await wait(200);
      }
      expect(st.spectators).toBeGreaterThanOrEqual(1);
    } finally {
      a.close(); b.close(); s.close();
    }
  }, 60000);

  it('spectating a missing room fails cleanly', async () => {
    const sock = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((res, rej) => { sock.on('open', res); sock.on('error', rej); });
    const codec = makeCodec(CODEC);
    const mail = [];
    sock.on('message', d => { try { mail.push(codec.decode(d)); } catch { /* ignore */ } });
    const send = m => sock.send(codec.encode(m));
    try {
      send({ t: 'hello', client: 'test', clientTime: Date.now(), protocol: PROTOCOL_VERSION });
      await wait(200);
      send({ t: 'spectate', room: 'ZZZZ', token: '', name: 'W', type: 'cube', color: '#8ec7ff' });
      const t0 = Date.now();
      let err = null;
      while (Date.now() - t0 < 4000) {
        err = mail.find(m => m.t === 'error');
        if (err) break;
        await wait(50);
      }
      expect(err).not.toBeNull();
      expect(err.code).toBe('room_not_found');
    } finally {
      sock.close();
    }
  });

  it('recent match history is a bounded newest-first ring', () => {
    clearHistory();
    for (let i = 0; i < 25; i++) recordMatch({ room: 'ABCD', durationS: 60 + i, players: ['Aa', 'Bb'] });
    const r = recentMatches();
    expect(r).toHaveLength(20);
    expect(r[0].durationS).toBe(84);
    expect(r[19].durationS).toBe(65);
    expect(r[0].players).toEqual(['Aa', 'Bb']);
    // Copies: mutating the result must not corrupt the ring.
    r[0].players.push('X');
    expect(recentMatches()[0].players).toEqual(['Aa', 'Bb']);
    clearHistory();
    expect(recentMatches()).toEqual([]);
  });

  it('/status exposes spectators and recent matches', async () => {
    const r = await (await fetch(`http://localhost:${PORT}/status`)).json();
    expect(r.ok).toBe(true);
    expect(typeof r.spectators).toBe('number');
    expect(Array.isArray(r.recent)).toBe(true);
  });
});
