// tools/perf-smoke.mjs — QA-owned CI perf smoke (M1 scaffold).
// Measures headless throughput of the pure-math hot path (attack-table evaluation +
// launch formula over thousands of samples) and fails if p95 per-op exceeds the budget.
// When src/sim/ lands, this extends to stepping the real sim headless (budget: p95 < 4 ms).
// Usage: node tools/perf-smoke.mjs [--budget-ms 4] (budget applies to the future sim step;
// the current math micro-bench reports its own p95 in microseconds).
import { BALANCE, statsFor } from '../src/game/Balance.js';

const budgetArg = process.argv.indexOf('--budget-ms');
const SIM_BUDGET_MS = budgetArg >= 0 ? Number(process.argv[budgetArg + 1]) : 4;
const N = 20000;
const samples = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const atk = BALANCE.attacks.punch((i % 101) / 100);
  const s = statsFor(i % 3 === 0 ? 'blob' : i % 3 === 1 ? 'spiky' : 'cube');
  const launch = (atk.base + atk.growth * s.growthTaken * ((i % 201) / 100)) * s.armor;
  if (!Number.isFinite(launch)) throw new Error('non-finite launch');
  samples.push(performance.now() - t0);
}
samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(N * 0.5)] * 1000;
const p95 = samples[Math.floor(N * 0.95)] * 1000;
console.log(`perf-smoke (math micro-bench, ${N} ops): p50=${p50.toFixed(2)}us p95=${p95.toFixed(2)}us; sim-step budget=${SIM_BUDGET_MS}ms (enforced once src/sim/ lands)`);
if (!(p95 > 0) || p95 > 1000) { console.error('perf-smoke FAIL: micro-bench p95 out of range'); process.exit(1); }
console.log('perf-smoke OK');
