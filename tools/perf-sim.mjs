// tools/perf-sim.mjs — T25: real-sim step benchmark. Steps an 8-bot sim and reports
// p50/p95/p99 per-step ms; fails if p95 exceeds budget (default 4ms). For CI perf gate.
// Usage: node tools/perf-sim.mjs [--bots 8] [--ticks 1200] [--budget-ms 4]
import { Sim } from '../src/sim/Sim.js';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i+1] !== undefined ? Number(args[i+1]) : d; };
const BOTS = opt('bots', 8), TICKS = opt('ticks', 1200), BUDGET = opt('budget-ms', 4);
const TYPES = ['cube','blob','spiky'];
const sim = new Sim({ seed: 1, items: true, botDifficulty: 'normal' });
await sim.init();
for (let i = 0; i < BOTS; i++) sim.addSeat({ slot: i, name: 'P'+i, type: TYPES[i % TYPES.length], isBot: true });
sim.startMatch();
for (let t = 0; t < 120; t++) sim.step(); // warmup (JIT + WASM paths)
const samples = [];
for (let t = 0; t < TICKS; t++) { const t0 = performance.now(); sim.step(); samples.push(performance.now() - t0); }
samples.sort((a, b) => a - b);
const at = q => samples[Math.min(samples.length-1, Math.floor(samples.length*q))];
console.log(`perf-sim (${BOTS} bots, ${TICKS} steps): p50=${at(0.5).toFixed(3)}ms p95=${at(0.95).toFixed(3)}ms p99=${at(0.99).toFixed(3)}ms budget=${BUDGET}ms`);
if (at(0.95) > BUDGET) { console.error('perf-sim FAIL: p95 over budget'); process.exit(1); }
console.log('perf-sim OK');
