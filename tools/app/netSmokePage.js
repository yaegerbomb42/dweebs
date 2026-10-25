// netSmokePage.js — a REAL BROWSER NetClient probe, for tools/app/smoke-net-browser.mjs.
//
// Why this exists: every netcode check so far ran Node's `ws` behind a WebSocket shim.
// That proves the protocol logic but not the things a browser actually does differently —
// real binary frames via BinaryType=arraybuffer, real event-loop timing, real clock. This
// page runs the shipped NetClient unmodified in Chrome and publishes its measurements on
// `window.__netSmoke`, so the harness can compare two browsers against each other.
import { NetClient } from '/src/net/NetClient.js';
import { MockSim } from '/src/net/mockSim.js';
import { makeCodec, PROTOCOL_VERSION } from '/src/net/protocol.js';

const q = new URLSearchParams(location.search);
const server = q.get('server') || 'ws://localhost:8787';
const room = (q.get('room') || 'SMOK').toUpperCase();
const create = q.get('create') === '1';
const name = q.get('name') || 'browser';

const out = document.getElementById('out');
const M = window.__netSmoke = {
  server, room, status: 'connecting', slot: -1, snaps: 0, events: 0, tick: 0,
  entities: 0, maxEntityCm: null, errors: [], alive: false, agreed: null,
};

const client = new NetClient({
  sim: new MockSim({ players: 8 }), room, create, name,
  type: 'cube', color: '#8ec7ff', url: server, codec: 'bin',
});
window.__client = client;

let readied = false;
const yawOf = e => e.yaw ?? 0;

client.onStatus = s => { M.status = s; if (s.startsWith('error')) M.errors.push(s); };

// Snapshot bookkeeping. Two things matter here and they are easy to get wrong:
//
//  1. Snapshots are DELTAS. A tick's frame contains only the entities whose quantized
//     state changed, so recording that frame alone measures one entity, not the world —
//     the baseline has to be accumulated exactly as NetClient itself does it (reset on a
//     full snapshot, merged on every delta).
//  2. Comparing the LAST frame of two browsers is meaningless: they arrive at different
//     wall-clock moments. Comparing the same server TICK is exact, because the server's
//     authoritative values for a tick are the same bytes for everyone.
const baseline = new Map();
const firstPose = new Map();
const lastPose = new Map();
const MAX_TICK_BUFFER = 40;
const origHandle = client.handle.bind(client);
client.handle = m => {
  if (m.t === 'snapshot') {
    M.snaps++;
    M.tick = m.tick;
    if (m.full) baseline.clear();
    for (const e of m.entities) baseline.set(e.id, { ...e });
    const world = {};
    for (const [id, e] of baseline) world[id] = { x: e.x, y: e.y, z: e.z, q: e.q, state: e.state, flags: e.flags };
    (M.snapByTick ??= {})[m.tick] = world;
    const ticks = Object.keys(M.snapByTick).map(Number).sort((x, y) => x - y);
    while (ticks.length > MAX_TICK_BUFFER) delete M.snapByTick[ticks.shift()];
    for (const [id, e] of baseline) {
      if (!firstPose.has(id)) firstPose.set(id, { x: e.x, y: e.y, z: e.z });
      lastPose.set(id, { x: e.x, y: e.y, z: e.z });
    }
    M.entities = baseline.size;
    let max = 0;
    for (const [id, p0] of firstPose) {
      const p1 = lastPose.get(id);
      if (p1) max = Math.max(max, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y), Math.abs(p1.z - p0.z));
    }
    M.maxEntityCm = max;
  }
  if (m.t === 'event') M.events++;
  return origHandle(m);
};

client.connect();

// Drive input at 60 Hz from inside the browser, exactly as the game does.
let i = 0;
setInterval(() => {
  if (!client.joined) return;
  i++;
  if (!readied) { readied = true; client.setReady(true); }
  client.setInput({
    moveX: Math.sin(i / 40), moveZ: Math.cos(i / 55),
    jump: i % 45 === 0, attack: i % 23 === 0, grab: false, dodge: false,
    superYeet: false, drop: false, aimYaw: 0, aimLoft: 0.15, charge: 0,
  });
  client.update(1 / 60);
  M.rtt = client.rttMs;
  M.slot = client.slot;
  M.alive = client.joined && client.status === 'joined';
  M.renderCount = client.renderEntities().length;
  out.textContent = JSON.stringify({ status: M.status, slot: M.slot, ticks: client.serverTick, snaps: M.snaps, events: M.events, ents: M.entities, movedCm: Math.round(M.maxEntityCm || 0), rtt: Math.round(M.rtt || 0) }, null, 1);
}, 1000 / 60);

window.__codec = makeCodec('bin');
window.__protocol = PROTOCOL_VERSION;
void yawOf;
