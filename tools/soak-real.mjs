// tools/soak-real.mjs — T26: real-sim soak. Runs N headless 8-bot matches on src/sim/Sim
// and asserts: no NaN, no stuck dweebs (>10s unmoving while alive), bounded live items,
// matches end, plus KO-cause + avg-length report. Replaces tools/soak.mjs scaffolding.
// Usage: node tools/soak-real.mjs [--matches 3] [--bots 8] [--ticks 18000] [--seed 1]
import { Sim } from '../src/sim/Sim.js';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i+1] !== undefined ? Number(args[i+1]) : d; };
const MATCHES = opt('matches', 3), BOTS = opt('bots', 8), MAX_TICKS = opt('ticks', 18000), SEED = opt('seed', 1);
const TYPES = ['cube','blob','spiky'], NAMES = ['Blorp','Squish','Nugget','Wobbles','Toast','Pickle','Gumbo','Brim'];
let fail = 0;
const totals = { side: 0, top: 0, splash: 0, ticks: 0, nan: 0, stuck: 0 };
for (let m = 0; m < MATCHES; m++) {
  const sim = new Sim({ seed: SEED + m, items: true, botDifficulty: 'normal' });
  await sim.init();
  for (let i = 0; i < BOTS; i++) sim.addSeat({ slot: i, name: NAMES[i % NAMES.length], type: TYPES[i % TYPES.length], isBot: true });
  sim.startMatch();
  const kos = { side: 0, top: 0, splash: 0 };
  let nan = 0, stuck = 0, peakItems = 0, ended = false, ticks = 0;
  const stillFor = new Map(), prevPos = new Map();
  for (let t = 1; t <= MAX_TICKS; t++) {
    ticks = t;
    for (const e of sim.step()) if (e.type === 'ko') kos[e.kind] = (kos[e.kind] || 0) + 1;
    const st = sim.getState();
    peakItems = Math.max(peakItems, st.items.length);
    if (st.items.length > 40) { console.log(`match ${m+1}: ITEM LEAK (${st.items.length} live)`); fail++; break; }
    for (const d of st.dweebs) {
      if (!Number.isFinite(d.pos[0]+d.pos[1]+d.pos[2]+d.vel[0]+d.vel[1]+d.vel[2]+d.percent)) nan++;
      if (!d.active) { stillFor.set(d.slot, 0); prevPos.set(d.slot, d.pos); continue; }
      const p = prevPos.get(d.slot);
      if (p && Math.hypot(d.pos[0]-p[0], d.pos[2]-p[2]) < 0.01) {
        stillFor.set(d.slot, (stillFor.get(d.slot)||0)+1);
        if (stillFor.get(d.slot) > 600 && (d.hitstun ?? 0) <= 0) stuck++;
      } else stillFor.set(d.slot, 0);
      prevPos.set(d.slot, d.pos);
    }
    if (st.phase === 'results') { ended = true; break; }
  }
  const ok = ended && nan === 0 && stuck === 0;
  if (!ok) fail++;
  totals.side += kos.side; totals.top += kos.top; totals.splash += kos.splash; totals.ticks += ticks; totals.nan += nan; totals.stuck += stuck;
  console.log(`match ${m+1}: ${ended ? 'finished' : 'TIMED OUT'} in ${ticks} ticks KO side=${kos.side} top=${kos.top} splash=${kos.splash} peakItems=${peakItems} nan=${nan} stuck=${stuck} ${ok ? 'OK' : 'FAIL'}`);
}
console.log(`soak-real: ${MATCHES}x${BOTS} bots avgLen=${Math.round(totals.ticks/MATCHES)} ticks KO side=${totals.side} top=${totals.top} splash=${totals.splash} nan=${totals.nan} stuck=${totals.stuck}`);
process.exit(fail ? 1 : 0);
