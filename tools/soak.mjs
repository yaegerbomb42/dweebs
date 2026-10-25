// tools/soak.mjs — QA-owned bot soak harness (M1 scaffold).
// Full headless 8-bot matches land with src/sim/ (SIM's contract). Until then this scaffold
// checks the harness contract itself: arg parsing, per-match invariants on synthetic
// trajectories, KO-cause/length reporting, and non-zero exit on violation.
// Usage: node tools/soak.mjs [--matches N] [--bots N] [--ticks N] [--seed N]
import { BALANCE } from '../src/game/Balance.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : dflt;
};
const MATCHES = opt('matches', 2);
const BOTS = opt('bots', 8);
const TICKS = opt('ticks', 3600);
const SEED = opt('seed', 1);

// Deterministic PRNG (mulberry32) so soak runs are reproducible in CI logs.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Synthetic stand-in for a headless match: random-walk dweebs on a disc, KO when they
// leave the blast radius. Exercises the invariant checks, not the game.
function runMatch(seed) {
  const rand = rng(seed);
  const R = BALANCE.match.blastSide;
  const dweebs = Array.from({ length: BOTS }, () => ({
    x: (rand() - 0.5) * 10, z: (rand() - 0.5) * 10,
    alive: true, still: 0, px: 0, pz: 0,
  }));
  const kos = { blast: 0, dunk: 0 };
  let stuck = 0, nan = 0, peakItems = 0;
  for (let t = 0; t < TICKS; t++) {
    let liveItems = 0;
    for (const d of dweebs) {
      if (!d.alive) continue;
      d.px = d.x; d.pz = d.z;
      const r0 = Math.hypot(d.x, d.z) || 1;
      d.x += (d.x / r0) * 0.35 + (rand() - 0.5) * 1.6; d.z += (d.z / r0) * 0.35 + (rand() - 0.5) * 1.6;
      if (!Number.isFinite(d.x + d.z)) nan++;
      const moved = Math.hypot(d.x - d.px, d.z - d.pz);
      d.still = moved < 0.01 ? d.still + 1 : 0;
      if (d.still > 600) stuck++;
      if (Math.hypot(d.x, d.z) > R) { d.alive = false; kos[rand() < 0.7 ? 'blast' : 'dunk']++; }
      liveItems += rand() < 0.3 ? 1 : 0;
    }
    peakItems = Math.max(peakItems, liveItems);
    if (dweebs.filter(d => !d.alive).length >= BOTS - 1) break;
  }
  return { kos, stuck, nan, peakItems, ended: dweebs.filter(d => !d.alive).length >= BOTS - 1 };
}

let fail = 0;
const totals = { blast: 0, dunk: 0 };
for (let m = 0; m < MATCHES; m++) {
  const r = runMatch(SEED + m);
  totals.blast += r.kos.blast; totals.dunk += r.kos.dunk;
  const ok = r.nan === 0 && r.stuck === 0 && r.peakItems <= BOTS && r.ended;
  console.log(`match ${m + 1}: KO blast=${r.kos.blast} dunk=${r.kos.dunk} peakItems=${r.peakItems} ended=${r.ended} ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) fail++;
}
console.log(`soak scaffold: ${MATCHES} matches x ${BOTS} bots x ${TICKS} ticks (seed ${SEED}) — KO blast=${totals.blast} dunk=${totals.dunk}`);
console.log('NOTE: synthetic trajectories until src/sim/ lands; SIM contract will plug real matches in.');
process.exit(fail ? 1 : 0);
