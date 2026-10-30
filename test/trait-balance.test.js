import { describe, it, expect } from 'vitest';
import { TRAITS, TRAIT_COUNT } from '../src/builder/traits/TraitCatalog.js';
import { normalizeBuild, generateBuild, powerScore, POWER_CAP, PRODUCT_CAPS } from '../src/builder/traits/TraitBalance.js';

describe('trait balance normalizer', () => {
  it('has ~1000 traits with unique ids', () => {
    expect(TRAIT_COUNT).toBeGreaterThan(1000);
    expect(new Set(TRAITS.map(t => t.id)).size).toBe(TRAIT_COUNT);
  });
  it('never lets any build exceed the power or trade-off caps', () => {
    for (let s = 1; s < 300; s++) {
      const ids = [];
      for (let i = 0; i < 20; i++) ids.push(TRAITS[(s * 7919 + i * 104729) % TRAITS.length].id);
      const b = normalizeBuild(ids);
      expect(powerScore(b.stats)).toBeLessThanOrEqual(POWER_CAP + 1e-9);
      for (const c of PRODUCT_CAPS) {
        const xa = Math.max(0, b.stats[c.a] - 0.5) / 0.5, xb = Math.max(0, b.stats[c.b] - 0.5) / 0.5;
        expect(xa * xb).toBeLessThanOrEqual(c.cap + 1e-9);
      }
    }
  });
  it('blocks heavy + fast and is deterministic', () => {
    const b = normalizeBuild(['heavy.V', 'vital.V', 'sprinter.V']);
    expect(b.traits).not.toContain('sprinter.V');
    expect(normalizeBuild(generateBuild(42, TRAITS))).toEqual(normalizeBuild(generateBuild(42, TRAITS)));
  });
});

import { rollDrops, STARTER_TRAITS } from '../src/builder/traits/TraitCollection.js';
describe('trait drops', () => {
  it('are deterministic and tied to fight facts', () => {
    const facts = { throws: 5, hideWin: 0, scrappy: 0, rides: 0, stomps: 0, smashes: 0, kos: 0, flees: 0, guards: 0, dmg: 0, team: 0 };
    const a = rollDrops(facts, 9, { owned: {} });
    expect(a).toEqual(rollDrops(facts, 9, { owned: {} }));
    const fams = ['sticky', 'wrestler', 'juggler', 'blockHoarder', 'sniper'];
    for (const id of a) expect(fams.includes(TRAITS.find(t => t.id === id).family)).toBe(true);
    expect(STARTER_TRAITS.length).toBeLessThan(100);
  });
});
