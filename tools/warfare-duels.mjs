// Prints the Dweeb Warfare duel matrix: equal-cost armies of type A vs type B.
// Usage: node tools/warfare-duels.mjs [budget] [seeds]
import { duel } from '../src/sim/warfareDuel.js';
import { RECRUITABLE } from '../src/sim/warfareUnits.js';
const budget = +process.argv[2] || 280, seeds = +process.argv[3] || 6;
const types = RECRUITABLE;
console.log('row beats col? (wins/' + seeds + ', avg survivor cost share)');
console.log('        ' + types.map(t => t.padEnd(12)).join(''));
for (const a of types) {
  let line = a.padEnd(8);
  for (const b of types) {
    if (a === b) { line += '-'.padEnd(12); continue; }
    let w = 0, share = 0;
    for (let s = 1; s <= seeds; s++) { const r = duel(a, b, { budget, seed: s }); if (r.winner === 'blue') w++; share += r.blueShare; }
    line += `${w} ${(share / seeds).toFixed(2)}`.padEnd(12);
  }
  console.log(line);
}
