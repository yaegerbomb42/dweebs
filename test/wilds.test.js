import { describe, it, expect } from 'vitest';
import { runWilds, generateWorld } from '../src/builder/traits/WildsSim.js';
import { generateBuild } from '../src/builder/traits/TraitBalance.js';
import { TRAITS } from '../src/builder/traits/TraitCatalog.js';

const ents = seed => Array.from({ length: 8 }, (_, i) => ({ name: 'D' + i, traits: generateBuild(seed * 100 + i, TRAITS), ai: true }));

describe('Dweeb Wilds', () => {
  it('generates a big world with every playground kind', () => {
    const w = generateWorld(3);
    const types = new Set(w.props.map(p => p.type));
    for (const t of ['tramp', 'slide', 'merry', 'swing', 'seesaw', 'gym', 'platform']) expect(types.has(t)).toBe(true);
    expect(w.hazards.some(h => h.kind === 'pendulum')).toBe(true);
    expect(w.zones.some(z => z.kind === 'conveyor')).toBe(true);
  });
  it('always ends with a winner and full placements', () => {
    for (const seed of [1, 7, 42]) {
      const s = runWilds(ents(seed), seed);
      expect(s.over).toBe(true);
      expect(s.winner).toBeTruthy();
      expect(new Set(s.dweebs.map(d => d.place)).size).toBe(8);
    }
  });
  it('is deterministic per seed', () => {
    const a = runWilds(ents(5), 5), b = runWilds(ents(5), 5);
    expect(a.winner.name).toBe(b.winner.name);
    expect(a.t).toBe(b.t);
  });
});
