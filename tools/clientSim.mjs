// clientSimTest.mjs — drives NetClient in Node against the real server, with a fake
// WebSocket. This exercises the parts the smoke harness does not: prediction,
// rewind-and-replay reconciliation, the smoothing rule and the interpolation buffer.
//
//   node tools/clientSim.mjs [--lag 120] [--loss 2] [--seconds 6]

import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { NetClient } from '../src/net/NetClient.js';
import { MockSim } from '../src/net/mockSim.js';
import { parseNetFlags } from '../src/net/lagSim.js';
import { ROOM_ALPHABET } from '../src/net/protocol.js';
import { MIN_SNAP_M, SMOOTH_MS } from '../src/net/prediction.js';

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LAG = Number(flag('lag', 0));
const LOSS = Number(flag('loss', 0));
const SECONDS = Number(flag('seconds', 6));
const PORT = Number(flag('port', 8805));
const room = [...ROOM_ALPHABET].filter((_, i) => i % 5 === 0).slice(0, 4).join('');

const server = spawn(process.execPath, ['server/index.js', '--port', String(PORT)], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(500);

// NetClient uses browser-style socket props (onopen/onmessage/binaryType): use ws directly.
globalThis.WebSocket = WebSocket;
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const sim = new MockSim({ players: 8 });
const client = new NetClient({
  sim, room, create: true, name: 'tester', url: `ws://localhost:${PORT}`,
  net: parseNetFlags({ lag: LAG, loss: LOSS, jitter: 20 }),
});

let maxSnapJump = 0;      // biggest per-frame move of our own rendered dweeb, in metres
let maxError = 0;
let snaps = 0;
let events = 0;
const origHandle = client.handle.bind(client);
client.handle = m => {
  if (m.t === 'snapshot') snaps++;
  if (m.t === 'event') events++;
  // NetClient.onSnapshot already reconciles; read the error it left behind. The very
  // first snapshot adopts rather than corrects, so it is not counted as an error.
  const wasJoined = client.joined;
  const r = origHandle(m);
  if (m.t === 'snapshot' && wasJoined) maxError = Math.max(maxError, client.lastError || 0);
  return r;
};

client.connect();
await sleep(SECONDS * 1000);

// Measure the steady state explicitly. Incoming bytes land on the socket's event
// loop, not inside update(), so they are sampled after the loop; outgoing bytes are
// counted as they are sent.
let bwInStart = 0;
let bwOut = 0;
const origSend = client.send.bind(client);
client.send = m => {
  const before = client.stats.out;
  origSend(m);
  bwOut += client.stats.out - before;
};
bwInStart = client.stats.in;
const tStart = Date.now();
let prev = null;
let warmup = true;          // ignore frames until the first snapshot anchors the sim
let readied = false;        // ready-up once, so the room leaves the lobby and the sim steps
// Pacing evidence. This loop calls update(1/60) once per iteration, but it can only *pace* itself
// with the wall clock — under load (CI running the build, several Chrome instances) an iteration
// can take 40-100 ms instead of 16.7 ms, so more server ticks land between two updates and the
// rendered dweeb has more to catch up on. That is a property of the harness, not of the netcode,
// so it is measured and printed rather than silently tolerated: worstRate tells you whether a
// number came from a real jump (a teleport reads as tens of m/s) or from a starved frame.
let tPrev = Date.now();
let worstRate = 0, starved = 0;
for (let i = 0; i < 180; i++) {
  const tNow = Date.now();
  const dtMs = tNow - tPrev; tPrev = tNow;
  if (dtMs > 40) starved++;
  client.setInput({ moveX: 1, moveY: 0.2, jump: i % 30 === 0, attack: false, grab: false, dodge: false, special: false, down: false, aimYaw: 0, aimLoft: 0.15, charge: 0 });
  client.update(1 / 60);
  const me = client.renderEntities().find(e => e.mine);
  if (me && !warmup && prev) {
    const jump = Math.hypot(me.x - prev.x, me.y - prev.y, me.z - prev.z);
    maxSnapJump = Math.max(maxSnapJump, jump);
    worstRate = Math.max(worstRate, jump / Math.max(dtMs, 1) * 1000);
  }
  if (me) prev = { x: me.x, y: me.y, z: me.z };
  // The adopt lands on the frame `joined` flips; drop the pre-adopt sample so the
  // join snap is not counted as a mid-match teleport.
  if (warmup && client.joined) { warmup = false; prev = null; }
  // Ready up: the room stays in 'lobby' (sim not stepping) until every human is ready.
  if (!readied && client.joined) { readied = true; client.setReady(true); }
  await sleep(1000 / 60);
}

// A running dweeb covers ~0.12 m per 60 Hz frame, so a teleport is an order of magnitude beyond
// that. The threshold is the smoothing contract's OWN number, MIN_SNAP_M (1 m): under 1 m of error
// the client interpolates instead of snapping, so a single-frame move at or above it is precisely
// the violation the rule exists to prevent.
//
// This used to be a hand-tuned 0.6 — stricter than the contract, and its own comment justified
// 1 m, so the two disagreed. Measured over six runs the real spread is 0.46-0.58 m, which means a
// 0.6 threshold fails randomly on a loaded machine while a genuine teleport (metres) still fails
// it every time. A CI gate that flakes is worse than no gate: it teaches people to re-run.
const TELEPORT = MIN_SNAP_M;
console.log(`slot=${client.slot} snaps=${snaps} events=${events} rtt≈${client.rttMs.toFixed(0)}ms`);
console.log(`max prediction error after join: ${maxError.toFixed(4)} m`);
console.log(`largest single-frame move: ${maxSnapJump.toFixed(4)} m (teleport threshold ${TELEPORT} m)`);
console.log(`worst effective speed: ${worstRate.toFixed(2)} m/s over ${starved} starved frame(s) of 180`);
console.log(`smoothing: ${SMOOTH_MS} ms, no-snap under ${MIN_SNAP_M} m`);
const measureS = (Date.now() - tStart) / 1000;   // real elapsed, not the nominal 3 s
const bwIn = client.stats.in - bwInStart;
console.log(`down ${(bwIn / measureS / 1024).toFixed(2)} KB/s · up ${(bwOut / measureS / 1024).toFixed(2)} KB/s ` +
  `(over ${measureS.toFixed(1)}s; budget 8 KB/s down at 8 players, this is 1 player + 7 bots)`);

const ok = client.slot >= 0 && snaps > 20 && maxSnapJump < TELEPORT;
// Say WHICH invariant broke. A bare "FAIL" next to a wall of zeros is indistinguishable from a
// metrics bug, and the never-joined case is a real, known failure mode: `NetClient.join()` runs
// once in `sock.onopen` (src/net/NetClient.js:149) and is never retried, so one dropped
// join/join_ok packet strands the client forever. At --loss 5 that is roughly one run in ten.
// CI runs this harness at loss 0 for exactly that reason; the flakiness belongs to the client,
// not to the gate.
const reasons = [];
if (!client.joined || client.slot < 0) reasons.push(`the client never joined (status=${client.status}, slot=${client.slot})`);
if (snaps <= 20) reasons.push(`only ${snaps} snapshot(s) arrived (need > 20)`);
if (maxSnapJump >= TELEPORT) reasons.push(`single-frame move ${maxSnapJump.toFixed(3)} m crossed the ${TELEPORT} m smoothing contract`);
console.log(ok ? 'PASS' : `FAIL: ${reasons.join('; ')}`);
if (reasons.some(r => r.startsWith('the client never joined'))) {
  console.log('  cause to check first: a single un-retried join packet (NetClient.js join() is called');
  console.log('  only from sock.onopen), so packet loss at join is permanent for that client.');
}
client.close();
server.kill('SIGINT');
process.exit(ok ? 0 : 1);
