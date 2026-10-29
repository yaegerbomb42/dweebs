// tools/headless-match.mjs — play a full bot match in Node, with no browser and no DOM.
//
// This is the acceptance test for ROLE CARD 1 item 6, and the thing NET's server will be a thin
// wrapper around: if `node tools/headless-match.mjs` can finish a match, the simulation runs
// anywhere, and a server is just a loop that feeds it inputs and reads snapshots.
//
// Usage:
//   node tools/headless-match.mjs                     one 4-bot match, default seed
//   node tools/headless-match.mjs --bots 8 --seed 42  an 8-bot match
//   node tools/headless-match.mjs --matches 3         run N matches, all seeds reported
//   node tools/headless-match.mjs --ticks 40000        give up after N ticks (default 40000:
//                                                      a best-of-3 can need ~37000 on slow rounds)
//   node tools/headless-match.mjs --verify            run the same match twice and compare the
//                                                      checksum at EVERY tick
//   node tools/headless-match.mjs --snapshot-at 900   snapshot at tick N, restore into a second
//                                                      sim, and check that resuming equals never
//                                                      having stopped
//   node tools/headless-match.mjs --perf              report sim step p50/p95/p99
//   node tools/headless-match.mjs --arena gale --mode hill
//                                                     play on an arena / in a mode
//   node tools/headless-match.mjs --difficulty brutal --teams 0,1:2,3
//                                                     brutal bots, 2v2 team battle
//
// Exit code 0 only if the match finished cleanly, no NaN appeared, nothing got stuck, and (with
// --verify) the two runs agreed at every single tick.

import { Sim } from '../src/sim/Sim.js';
import { TICK_HZ, TICK_DT } from '../src/sim/contracts.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? Number(args[i + 1]) : dflt;
};
const flag = name => args.includes(`--${name}`);

const BOTS = opt('bots', 4);
const SEED = opt('seed', 1);
const MATCHES = opt('matches', 1);
const MAX_TICKS = opt('ticks', 40000);
const ARENA = (() => { const i = args.indexOf('--arena'); return i >= 0 ? args[i + 1] : 'stadium'; })();
const MODE = (() => { const i = args.indexOf('--mode'); return i >= 0 ? args[i + 1] : 'brawl'; })();
const DIFF = (() => { const i = args.indexOf('--difficulty'); return i >= 0 ? args[i + 1] : 'normal'; })();
const TEAMS = (() => {
  const i = args.indexOf('--teams');
  if (i < 0) return null;
  // --teams 0,1:2,3  ->  [[0,1],[2,3]]
  return args[i + 1].split(':').map(g => g.split(',').map(Number));
})();
const SNAPSHOT_AT = opt('snapshot-at', 0);
const VERIFY = flag('verify');
const PERF = flag('perf');

const TYPES = ['cube', 'blob', 'spiky'];
const NAMES = ['Blorp', 'Squish', 'Nugget', 'Wobbles', 'Toast', 'Pickle', 'Gumbo', 'Brim'];

/** Build a sim with `bots` bot seats. Identical for every run with the same seed. */
async function makeSim(seed, bots) {
  const sim = new Sim({ seed, items: true, botDifficulty: DIFF, arena: ARENA, mode: MODE, teams: TEAMS });
  await sim.init();
  for (let i = 0; i < bots; i++) {
    sim.addSeat({ slot: i, name: NAMES[i % NAMES.length], type: TYPES[i % TYPES.length], isBot: true });
  }
  sim.startMatch();
  return sim;
}

/**
 * Play one match to the end, watching for the failure modes that matter.
 * @returns {Promise<{report: object, checksums: string[]|null, steps: number[]|null}>}
 */
async function playMatch(seed, { captureChecksums = false, perf = false, snapshotAt = 0 } = {}) {
  const sim = await makeSim(seed, BOTS);
  const kos = { side: 0, top: 0, splash: 0 };
  const checksums = captureChecksums ? [] : null;
  const steps = perf ? [] : null;
  let nan = 0, stuck = 0, ended = false, maxPercent = 0, peakItems = 0;
  const stillFor = new Map();
  const prevPos = new Map();

  // A second sim, warmed to `snapshotAt` and snapshotted, to check restore later.
  let resumeSim = null, resumeSnap = null;
  if (snapshotAt > 0) {
    resumeSim = await makeSim(seed, BOTS);
    for (let t = 0; t < snapshotAt; t++) resumeSim.step();
    resumeSnap = resumeSim.snapshot();
  }

  for (let t = 1; t <= MAX_TICKS; t++) {
    const t0 = perf ? performance.now() : 0;
    const events = sim.step();
    if (perf) steps.push(performance.now() - t0);

    for (const e of events) if (e.type === 'ko') kos[e.kind] = (kos[e.kind] || 0) + 1;

    const state = sim.getState();
    peakItems = Math.max(peakItems, state.items.length);
    for (const d of state.dweebs) {
      maxPercent = Math.max(maxPercent, d.percent);
      if (!Number.isFinite(d.pos[0] + d.pos[1] + d.pos[2] + d.vel[0] + d.vel[1] + d.vel[2])) nan++;
      const key = d.slot;
      if (!d.active) { stillFor.set(key, 0); prevPos.set(key, d.pos); continue; }
      const p = prevPos.get(key);
      if (p && Math.hypot(d.pos[0] - p[0], d.pos[2] - p[2]) < 0.01) {
        stillFor.set(key, (stillFor.get(key) || 0) + 1);
        // QA's definition: more than 10 s unmoved while alive and not in hitstun.
        if (stillFor.get(key) > 10 * TICK_HZ && d.hitstun <= 0) stuck++;
      } else stillFor.set(key, 0);
      prevPos.set(key, d.pos);
    }
    if (checksums) checksums.push(sim.checksum());
    if (state.phase === 'results') { ended = true; break; }
  }

  const state = sim.getState();
  const report = {
    seed, arena: ARENA, mode: MODE, ended, ticks: state.tick, phase: state.phase, kos, maxPercent, peakItems, nan, stuck,
    checksum: sim.checksum(),
    winner: state.dweebs.length ? sim.match.standings(state.dweebs)[0]?.name : '?',
    stocks: state.dweebs.map(d => `${d.name}:${d.stocks}`).join(' '),
  };

  // Snapshot → restore → continue must equal never having stopped.
  if (snapshotAt > 0 && resumeSnap) {
    const straight = await makeSim(seed, BOTS);
    for (let t = 0; t < snapshotAt; t++) straight.step();
    const snapChecksum = straight.checksum();
    resumeSim.restore(resumeSnap);
    const afterRestore = resumeSim.checksum();
    const rest = Math.min(600, MAX_TICKS - snapshotAt);
    for (let t = 0; t < rest; t++) straight.step();
    for (let t = 0; t < rest; t++) resumeSim.step();
    report.snapshot = {
      at: snapshotAt, bytes: resumeSnap.rapier.length,
      restoredExact: afterRestore === snapChecksum,
      resumedMatches: resumeSim.checksum() === straight.checksum(),
    };
  }
  return { report, checksums, steps };
}

function percentiles(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const at = q => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

// ─── Run ───
let fail = 0;
const t0 = performance.now();
for (let m = 0; m < MATCHES; m++) {
  const seed = SEED + m;
  const { report, checksums, steps } = await playMatch(seed, {
    captureChecksums: VERIFY || SNAPSHOT_AT > 0,
    perf: PERF,
    snapshotAt: SNAPSHOT_AT,
  });

  let verifyOk = null;
  if (VERIFY) {
    // A second, independent run of the same seed. Comparing EVERY tick, not just the last, is the
    // point: the first tick where the checksums differ is the tick the two simulations stopped
    // being the same simulation, and that is the only tick anybody ever actually wants.
    const second = await playMatch(seed, { captureChecksums: true });
    let firstDiff = -1;
    const n = Math.min(checksums.length, second.checksums.length);
    for (let i = 0; i < n; i++) {
      if (checksums[i] !== second.checksums[i]) { firstDiff = i; break; }
    }
    verifyOk = {
      ok: firstDiff < 0, firstDiff, ticks: n,
      finalA: checksums[n - 1], finalB: second.checksums[n - 1],
    };
    if (!verifyOk.ok) fail++;
  }
  if (report.snapshot && (!report.snapshot.restoredExact || !report.snapshot.resumedMatches)) fail++;

  const ok = report.ended && report.nan === 0 && report.stuck === 0;
  if (!ok) fail++;

  console.log(
    `match ${m + 1} (seed ${seed}): ${report.ended ? 'finished' : 'TIMED OUT'} in ${report.ticks} ticks` +
    ` · KO side=${report.kos.side} top=${report.kos.top} splash=${report.kos.splash}` +
    ` · winner ${report.winner} · max ${report.maxPercent}% · peakItems ${report.peakItems}` +
    ` · nan ${report.nan} stuck ${report.stuck} · ${report.checksum} ${ok ? 'OK' : 'FAIL'}`,
  );
  console.log(`  stocks: ${report.stocks}`);
  if (report.snapshot) {
    console.log(`  snapshot @${report.snapshot.at}: ${report.snapshot.bytes} B rapier` +
      ` · restore exact: ${report.snapshot.restoredExact} · resumed matches: ${report.snapshot.resumedMatches}`);
    if (!report.snapshot.restoredExact || !report.snapshot.resumedMatches) {
      console.log('  SNAPSHOT DESYNC — check the restore() ordering in src/sim/Sim.js');
    }
  }
  if (verifyOk) {
    console.log(`  verify (${verifyOk.ticks} ticks): ` +
      (verifyOk.ok ? 'IDENTICAL' : `DIVERGED at tick ${verifyOk.firstDiff + 1}`) +
      ` · ${verifyOk.finalA} vs ${verifyOk.finalB}`);
  }
  if (PERF && steps?.length) {
    const p = percentiles(steps);
    console.log(`  sim step ms: p50=${p.p50.toFixed(3)} p95=${p.p95.toFixed(3)} p99=${p.p99.toFixed(3)} (budget p95 < 4)`);
    if (p.p95 > 4) { console.error('perf: sim step p95 over budget'); fail++; }
  }
}
console.log(`headless: ${MATCHES} match(es) x ${BOTS} bots in ${((performance.now() - t0) / 1000).toFixed(1)}s` +
  ` · ${(TICK_DT * 1000).toFixed(2)} ms of sim time per tick`);
process.exit(fail ? 1 : 0);
