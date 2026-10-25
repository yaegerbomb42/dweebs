// online.test.js — the hosted-game surface: live headcount, matchmaking, room rules.
//
// The commit contract for every test here: the browser UI shows "N dweebs online",
// PLAY NOW lands a player in a public room without a code, and the host's rules
// become the match's rules. So the tests assert all three, over a real server on a
// random port, with the binary codec the clients will actually use.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, makeCodec } from '../src/net/protocol.js';

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


describe('room privacy and rules', () => {
  it('a room code stays private and the host owns the rules', async () => {
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
