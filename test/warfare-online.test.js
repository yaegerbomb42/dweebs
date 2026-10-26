// warfare-online.test.js — Dweeb Warfare over the real dweebs-server: matchmaking, forced teams,
// lockstep turn relay, desync detection, partner leaving. Two in-process sims fed the relayed turns
// must stay hash-identical — that is the whole promise of lockstep.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { sanitizeCmd, WarfareLobby, TURN_TICKS } from '../server/warfare.js';
import { createBattle, stepBattle, battleHash } from '../src/sim/warfareBattle.js';

const PORT = 18847;
let server;
const wait = ms => new Promise(r => setTimeout(r, ms));

beforeAll(async () => {
  server = spawn(process.execPath, ['server/index.js', '--port', String(PORT), '--max-rooms', '4'], { stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => process.stderr.write(`[srv] ${d}`));
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(`http://localhost:${PORT}/status`); if (r.ok) return; } catch { /* not up */ }
    if (Date.now() - t0 > 20000) throw new Error('server never came up');
    await wait(150);
  }
}, 30000);
afterAll(async () => { server?.kill('SIGINT'); await wait(300); });

function connect() {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://localhost:${PORT}`);
    const c = { sock, mail: [], send: m => sock.send(JSON.stringify(m)) };
    sock.on('message', (d, isBinary) => {
      if (isBinary) return; // brawler frames
      try { const m = JSON.parse(d.toString()); if (m.wf) c.mail.push(m); } catch { /* ignore */ }
    });
    sock.on('open', () => resolve(c));
    sock.on('error', reject);
  });
}

async function first(c, wf, timeoutMs = 4000, where = null) {
  const t0 = Date.now();
  for (;;) {
    const i = c.mail.findIndex(m => m.wf === wf && (!where || where(m)));
    if (i >= 0) return c.mail.splice(i, 1)[0];
    if (Date.now() - t0 > timeoutMs) return null;
    await wait(15);
  }
}

describe('warfare lobby (unit)', () => {
  it('room codes never spin forever, even with a constant rand', () => {
    const mk = () => ({ out: [], send(m) { this.out.push(m); } });
    const solo = new WarfareLobby({ rand: () => 0.5 });
    const codes = new Set();
    for (let i = 0; i < 20; i++) { const c = mk(); solo.waiting.push({ client: c, mode: 'x', code: solo._code(), name: '' }); codes.add(solo.waiting.at(-1).code); }
    expect(codes.size).toBe(20);
  });

  it('sanitizeCmd forces the sender team and drops junk', () => {
    expect(sanitizeCmd({ type: 'recruit', team: 'red', unit: 'rocket' }, 'blue')).toEqual({ type: 'recruit', team: 'blue', unit: 'rocket' });
    expect(sanitizeCmd({ type: 'recruit', unit: 'boss' }, 'blue')).toBeNull();
    expect(sanitizeCmd({ type: 'rally', x: 'NaN', z: 1 }, 'red')).toBeNull();
    expect(sanitizeCmd({ type: 'rally', x: 3.14159, z: -2 }, 'red')).toEqual({ type: 'rally', team: 'red', x: 3.14, z: -2 });
    expect(sanitizeCmd({ type: 'nuke' }, 'red')).toBeNull();
  });

  it('pairs by mode, by code, and a finished player does not trigger peerLeft', () => {
    let r = 0;
    const lobby = new WarfareLobby({ rand: () => (r = (r * 0.618 + 0.37) % 1) });
    const mk = () => ({ out: [], send(m) { this.out.push(m); } });
    const a = mk(), b = mk(), c = mk();
    lobby.handle(a, { wf: 'queue', mode: 'versus' });
    lobby.handle(c, { wf: 'queue', mode: 'coop' });
    expect(lobby.stats.waiting).toBe(2);
    lobby.handle(b, { wf: 'queue', mode: 'versus' });
    expect(a.out.at(-1)).toMatchObject({ wf: 'start', team: 'blue', slot: 0 });
    expect(b.out.at(-1)).toMatchObject({ wf: 'start', team: 'red', slot: 1 });
    lobby.handle(a, { wf: 'over' });
    expect(b.out.some(m => m.wf === 'peerLeft')).toBe(false);
    lobby.tick();
    expect(b.out.at(-1).wf).toBe('turn'); // lagging partner still gets turns to finish
    lobby.handle(b, { wf: 'over' });
    expect(lobby.stats.matches).toBe(0);
    const d = mk();
    lobby.handle(d, { wf: 'queue', mode: 'versus', code: 'ZZZZ' });
    expect(d.out.at(-1).wf).toBe('error');
    lobby.handle(d, { wf: 'queue', mode: 'versus', code: c.out[0].code.toLowerCase() });
    expect(d.out.at(-1)).toMatchObject({ wf: 'start', mode: 'coop', team: 'blue' }); // joins the host's mode
  });
});

describe('warfare online (real server)', () => {
  it('versus: matched with one seed, teams forced, turns relayed, sims stay identical', async () => {
    const a = await connect(), b = await connect();
    a.send({ wf: 'queue', mode: 'versus', name: 'Ann' });
    const q = await first(a, 'queued');
    expect(q.code).toMatch(/^[A-Z]{4}$/);
    b.send({ wf: 'queue', mode: 'versus', name: 'Bob' });
    const sa = await first(a, 'start'), sb = await first(b, 'start');
    expect(sa.seed).toBe(sb.seed);
    expect([sa.team, sb.team]).toEqual(['blue', 'red']);
    expect(sa.partner).toBe('Bob');
    expect(sa.turnTicks).toBe(TURN_TICKS);

    // b lies about its team: the server must rewrite it to red
    a.send({ wf: 'cmd', cmds: [{ type: 'recruit', team: 'blue', unit: 'rocket' }] });
    b.send({ wf: 'cmd', cmds: [{ type: 'recruit', team: 'blue', unit: 'shield' }, { type: 'rally', team: 'blue', x: 5, z: 2 }] });
    await wait(600);
    a.send({ wf: 'cmd', cmds: [{ type: 'startWave' }] });
    await wait(500);

    const sims = [createBattle({ seed: sa.seed, mode: 'versus' }), createBattle({ seed: sb.seed, mode: 'versus' })];
    const turnsA = a.mail.filter(m => m.wf === 'turn'), turnsB = b.mail.filter(m => m.wf === 'turn');
    const n = Math.min(turnsA.length, turnsB.length);
    expect(n).toBeGreaterThan(5);
    const all = turnsA.slice(0, n).flatMap(t => t.cmds);
    expect(all.find(c => c.unit === 'shield').team).toBe('red');
    expect(all.find(c => c.type === 'rally').team).toBe('red');
    expect(all.find(c => c.unit === 'rocket').team).toBe('blue');
    for (let i = 0; i < n; i++) {
      expect(turnsA[i].n).toBe(i);
      expect(turnsB[i]).toEqual(turnsA[i]);
      [turnsA[i], turnsB[i]].forEach((t, k) => {
        for (let j = 0; j < TURN_TICKS; j++) stepBattle(sims[k], j === 0 ? t.cmds : []);
      });
    }
    expect(battleHash(sims[0])).toBe(battleHash(sims[1]));
    expect(sims[0].units.filter(u => u.team === 'red').length).toBeGreaterThan(0);

    // matching hashes → quiet; different hashes → desync to both
    a.send({ wf: 'hash', turn: 30, h: 1234 }); b.send({ wf: 'hash', turn: 30, h: 1234 });
    expect(await first(a, 'desync', 400)).toBeNull();
    a.send({ wf: 'hash', turn: 60, h: 1 }); b.send({ wf: 'hash', turn: 60, h: 2 });
    expect(await first(a, 'desync')).toMatchObject({ turn: 60 });
    expect(await first(b, 'desync')).not.toBeNull();

    // b quits: a is told, and the versus match stops relaying
    b.sock.close();
    expect(await first(a, 'peerLeft')).not.toBeNull();
    const st = await (await fetch(`http://localhost:${PORT}/status`)).json();
    expect(st.warfare.matches).toBe(0);
    a.sock.close();
  }, 15000);

  it('co-op by code: both players are blue and the match survives a partner leaving', async () => {
    const a = await connect(), b = await connect();
    a.send({ wf: 'queue', mode: 'coop' });
    const { code } = await first(a, 'queued');
    b.send({ wf: 'queue', mode: 'versus', code });
    const sa = await first(a, 'start'), sb = await first(b, 'start');
    expect(sa.mode).toBe('coop');
    expect([sa.team, sb.team]).toEqual(['blue', 'blue']);
    b.send({ wf: 'leave' });
    expect(await first(a, 'peerLeft')).not.toBeNull();
    a.mail.length = 0;
    await wait(350);
    expect(a.mail.filter(m => m.wf === 'turn').length).toBeGreaterThan(1); // still running solo
    a.sock.close(); b.sock.close();
  }, 10000);
});
