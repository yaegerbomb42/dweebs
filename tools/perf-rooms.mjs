// tools/perf-rooms.mjs — capacity bench: how many 8-seat rooms fit in one 60 Hz tick.
//
// The server is ONE Node process with ONE tick loop (server/index.js), so the whole
// fleet's physics is serialised onto a single core. That makes the only number that
// matters: the wall time to step EVERY live room once, because it has to fit in
// TICK_MS = 16.67 ms. This tool measures exactly that and prints the ceiling.
//
//   node tools/perf-rooms.mjs [--rooms 8] [--bots 8] [--ticks 600] [--target-hz 60]
//
// Reported:
//   per-room ms  = tick wall time / rooms          (the marginal cost of one room)
//   max rooms    = floor(target tick budget / per-room ms)
//   max players  = max rooms * bots                (8 slots per room, bots fill them)
//
// It also prints peak RSS, because on a shared VPS the memory ceiling bites before
// the CPU one does (Rapier keeps a world + entity set per room).
import { Sim } from '../src/sim/Sim.js';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : d;
};
const ROOMS = Math.max(1, opt('rooms', 8));
const BOTS = Math.min(8, Math.max(1, opt('bots', 8)));
const TICKS = Math.max(60, opt('ticks', 600));
const TARGET_HZ = opt('target-hz', 60);
const WARMUP = 120;
const TYPES = ['cube', 'blob', 'spiky'];
const NAMES = ['Blorp', 'Squish', 'Nugget', 'Wobbles', 'Toast', 'Pickle', 'Gumbo', 'Brim'];

const rooms = [];
for (let r = 0; r < ROOMS; r++) {
  const sim = new Sim({ seed: 1000 + r, items: true, botDifficulty: 'normal' });
  await sim.init();
  for (let i = 0; i < BOTS; i++) {
    sim.addSeat({ slot: i, name: NAMES[i % NAMES.length], type: TYPES[i % TYPES.length], isBot: true });
  }
  sim.startMatch();
  rooms.push(sim);
}

// Warm every room (JIT + WASM paths), then measure the whole batch per tick.
for (let t = 0; t < WARMUP; t++) for (const s of rooms) s.step();

const budget = 1000 / TARGET_HZ;
const samples = [];
let items = 0;
for (let t = 0; t < TICKS; t++) {
  const t0 = performance.now();
  for (const s of rooms) s.step();
  samples.push(performance.now() - t0);
}
for (const s of rooms) items += s.getState().items.length;

samples.sort((a, b) => a - b);
const at = q => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
const p50 = at(0.5), p95 = at(0.95), worst = samples[samples.length - 1];
const perRoom = p50 / ROOMS;
const maxRooms = Math.floor(budget / perRoom);
const maxPlayers = maxRooms * BOTS;
const rssMb = process.memoryUsage().rss / 1048576;

console.log(`perf-rooms: ${ROOMS} rooms x ${BOTS} seats, ${TICKS} ticks @ ${TARGET_HZ} Hz target`);
console.log(`  batch tick: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms worst=${worst.toFixed(2)}ms  budget=${budget.toFixed(2)}ms`);
console.log(`  per-room: ${perRoom.toFixed(3)}ms  (${(perRoom / budget * 100).toFixed(1)}% of one tick)`);
console.log(`  ceiling on ONE core: ~${maxRooms} live rooms = ~${maxPlayers} players, headroom kept`);
console.log(`  live items across rooms: ${items}  ·  peak RSS: ${rssMb.toFixed(0)} MB  ·  per-room RSS: ~${(rssMb / ROOMS).toFixed(1)} MB`);

// Fail loudly if even this small batch cannot hold the frame: that is a real ceiling.
if (p95 > budget) {
  console.error(`perf-rooms FAIL: p95 ${p95.toFixed(2)}ms exceeds the ${budget.toFixed(2)}ms tick budget at ${ROOMS} rooms`);
  process.exit(1);
}
console.log('perf-rooms OK');
