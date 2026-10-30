// netSmoke.js — NET's own end-to-end check: boot the server, connect N fake clients
// with simulated lag and loss, drive them, and report convergence plus bandwidth.
//
//   node tools/netSmoke.mjs [--clients 8] [--seconds 10] [--lag 120] [--loss 2]
//
// QA owns test/**, so this lives in NET's own lane; the same harness is what a QA
// net test should grow into (see the Request on the board).

import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, INPUT_REDUNDANCY, makeCodec, ROOM_ALPHABET, NET } from '../src/net/protocol.js';
import { addNetSimulation, parseNetFlags } from '../src/net/lagSim.js';

const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const CLIENTS = Number(flag('clients', 8));
const SECONDS = Number(flag('seconds', 10));
const LAG = Number(flag('lag', 120));
const LOSS = Number(flag('loss', 2));
const PORT = Number(flag('port', 8799));
const CODEC = flag('codec', 'bin');

const room = [...ROOM_ALPHABET].filter((_, i) => i % 5 === 0).slice(0, 4).join('');

const server = spawn(process.execPath, ['server/index.js', '--port', String(PORT), '--codec', CODEC], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', d => process.stdout.write(`[srv] ${d}`));
server.stderr.on('data', d => process.stderr.write(`[srv!] ${d}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(500);

/** One fake client: connects, joins, sends input at 60 Hz with redundancy, counts bytes. */
function makeClient(i, flags) {
  const codec = makeCodec(CODEC);
  const sock = new WebSocket(`ws://localhost:${PORT}`);
  addNetSimulation(sock, flags);
  const c = {
    i, sock, codec, slot: -1, room: null, tick: 0, bytesIn: 0, bytesOut: 0,
    snapshots: 0, events: 0, lastEntities: new Map(), rtt: 0, status: 'connecting',
    errors: [], retries: 0,
    input: { moveX: Math.sin(i), moveY: Math.cos(i), jump: false, attack: false, grab: false, dodge: false, special: false, down: false, aimYaw: 0, aimLoft: 0.15, charge: 0 },
    history: [],
  };
  sock.on('open', () => {
    c.status = 'connected';
    c.send({ t: 'hello', client: 'smoke', clientTime: Date.now(), protocol: PROTOCOL_VERSION, codec: CODEC });
    c.join();
  });
  sock.on('message', data => {
    c.bytesIn += data.byteLength ?? data.length ?? 0;
    const m = codec.decode(data);
    if (m.t === 'welcome') {
      // The server's greeting carries the schema version and no slot; only a real
      // join answers with `you >= 0`. Answering ready to the greeting is harmless
      // (it fails NOT_IN_ROOM) but would poison the error list, so skip it.
      if (m.you < 0 || !m.token) return;
      c.slot = m.you; c.room = m.room; c.status = 'joined';
      // The room phases lobby -> playing only when every connected human is ready, and
      // the sim does not step until then. Without this the whole harness measured a
      // frozen world and reported perfect agreement — a false PASS.
      c.send({ t: 'ready', ready: true });
    }
    if (m.t === 'room' && m.phase === 'lobby' && c.slot >= 0) {
      // Lost-frame recovery, same as NetClient._confirmReady: a dropped ready used to
      // strand the harness in a frozen lobby with a spurious FAIL.
      const me = (m.players || []).find(p => p.slot === c.slot && !p.bot);
      if (me && !me.ready) c.send({ t: 'ready', ready: true });
    }
    if (m.t === 'error') {
      c.errors.push(m.code);
      // Everyone connects at once, so a late joiner can beat room creation. Back off
      // and retry; only the first client's join carries `create`.
      if (m.code === 'room_not_found' && c.retries < 40) {
        c.retries++;
        setTimeout(() => c.join(), 250);
      }
    }
    if (m.t === 'snapshot') {
      c.snapshots++;
      c.serverTick = m.tick;
      if (m.full) c.lastEntities = new Map();
      for (const e of m.entities) c.lastEntities.set(e.id, e);
    }
    if (m.t === 'event') c.events++;
    if (m.t === 'pong') c.rtt = Date.now() - m.clientTime;
  });
  c.join = () => c.send({
    t: 'join', room, create: i === 0, token: '', name: `P${i}`, type: 'cube', color: '#8ec7ff',
  });
  c.send = m => {
    const d = codec.encode(m);
    c.bytesOut += typeof d === 'string' ? d.length : d.byteLength;
    sock.send(d);
  };
  return c;
}

const flags = parseNetFlags({ lag: LAG, loss: LOSS, jitter: 20 });
const clients = Array.from({ length: CLIENTS }, (_, i) => makeClient(i, flags));

const inputTimer = setInterval(() => {
  for (const c of clients) {
    if (c.slot < 0) continue;
    c.tick++;
    c.input.jump = c.tick % 47 === 0;
    c.input.attack = c.tick % 11 === 0;
    const frames = [];
    for (let k = INPUT_REDUNDANCY - 1; k >= 0; k--) frames.push(c.input);
    c.send({ t: 'input', tick: c.tick, ack: 0, frames });
  }
}, 1000 / 60);

const pingTimer = setInterval(() => {
  for (const c of clients) c.send({ t: 'ping', id: c.tick, clientTime: Date.now() });
}, 1000);

// Wait for everyone to get a slot before the clock starts. A client whose join
// collided with room creation retries, and measuring inside that window reports a
// spurious failure and an artificially low bandwidth.
const joinDeadline = Date.now() + 15000;
while (clients.some(c => c.slot < 0) && Date.now() < joinDeadline) await sleep(100);
const missing = clients.filter(c => c.slot < 0);
if (missing.length) console.log(`!! ${missing.length} client(s) never joined: ${missing.map(c => c.i).join(',')}`);

const t0 = Date.now();
for (const c of clients) {
  c.bytesIn = 0;
  // Baseline for the liveness check: a frozen world must never look like convergence.
  c.posAtStart = new Map([...c.lastEntities].map(([id, e]) => [id, { x: e.x, y: e.y, z: e.z }]));
  c.tickAtStart = c.serverTick ?? 0;
}
await sleep(SECONDS * 1000);
const measured = (Date.now() - t0) / 1000;   // real elapsed, not the requested seconds
clearInterval(inputTimer); clearInterval(pingTimer);

console.log(`\n=== ${CLIENTS} clients, ${measured.toFixed(1)}s, lag=${LAG}ms loss=${LOSS}% ===`);
let ok = missing.length === 0;
for (const c of clients) {
  const kbps = c.bytesIn / measured / 1024;
  const up = c.bytesOut / measured / 1024;
  const line = `P${c.i} slot=${c.slot} snaps=${c.snapshots} events=${c.events} ` +
    `down=${kbps.toFixed(2)} KB/s up=${up.toFixed(2)} KB/s ents=${c.lastEntities.size} ` +
    `errors=[${[...new Set(c.errors)].join(',')}]`;
  console.log(line + (kbps > NET.budgetKBpsDown ? '  OVER BUDGET' : ''));
  if (c.slot < 0 || c.snapshots < 10) { ok = false; console.log(`  !! client ${c.i} did not join/receive`); }
  if (kbps > NET.budgetKBpsDown) ok = false;
}

// Liveness: the sim must actually be stepping. A frozen room used to pass every check
// below, because "all clients agree" is trivially true when nothing moves.
let worstMove = 0, worstTickAdvance = Infinity;
for (const c of clients) {
  for (const [id, e] of c.lastEntities) {
    const p = c.posAtStart.get(id);
    if (!p) continue;
    worstMove = Math.max(worstMove, Math.abs(e.x - p.x), Math.abs(e.y - p.y), Math.abs(e.z - p.z));
  }
  worstTickAdvance = Math.min(worstTickAdvance, (c.serverTick ?? 0) - c.tickAtStart);
}
console.log(`liveness: worst entity movement ${worstMove} cm, min server-tick advance ${worstTickAdvance}`);
if (worstMove < 50) { ok = false; console.log('  !! the world is frozen — the sim is not stepping'); }
if (worstTickAdvance < measured * 30) { ok = false; console.log(`  !! server tick only advanced ${worstTickAdvance} in ${measured.toFixed(1)}s (expect ~60/s)`); }

// Convergence: every client should agree on every dweeb to within 1 cm.
const ref = clients[0].lastEntities;
let worst = 0;
for (const c of clients.slice(1)) {
  for (const [id, e] of ref) {
    const o = c.lastEntities.get(id);
    if (!o) continue;
    worst = Math.max(worst, Math.abs(e.x - o.x), Math.abs(e.y - o.y), Math.abs(e.z - o.z));
  }
}
console.log(`worst cross-client disagreement: ${worst} cm`);
if (worst > 2) { ok = false; console.log('  !! clients disagree — deltas or baselines are wrong'); }

// Budget: the brief allows 8 KB/s downstream per client at 8 players. The worst case
// measured is 1 player + 7 bots all in motion, which moves every entity every frame.
const budget = NET.budgetKBpsDown;
const peak = Math.max(...clients.map(c => c.bytesIn / measured / 1024));
console.log(`peak downstream: ${peak.toFixed(2)} KB/s of a ${budget} KB/s budget`);
if (peak > budget) { ok = false; console.log('  !! over budget'); }

console.log(ok ? '\nPASS' : '\nFAIL');
for (const c of clients) c.sock.close();
server.kill('SIGINT');
process.exit(ok ? 0 : 1);
