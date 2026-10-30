// archaeology.test.js — dig sites and relics.
import { describe, it, expect } from 'vitest';
import { ArchaeologyManager, DIG_SITES, RELICS } from '../src/adventure/archaeology.js';

function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('archaeology', () => {
  it('has 3 dig sites', () => {
    expect(DIG_SITES.length).toBe(3);
    const m = new ArchaeologyManager();
    expect(m.sites.length).toBe(3);
  });

  it('digging accumulates progress', () => {
    const m = new ArchaeologyManager();
    expect(m.dig('north', 0.3)).toBeNull(); // 0.3 < 1
    expect(m.dig('north', 0.3)).toBeNull(); // 0.6 < 1
    const loot = m.dig('north', 0.5, seqRng([0.5, 0.9])); // 1.1 >= 1
    expect(loot).not.toBeNull();
    expect(loot.gold).toBeGreaterThanOrEqual(5);
  });

  it('sometimes yields a relic', () => {
    const m = new ArchaeologyManager();
    const loot = m.dig('east', 1, seqRng([0.5, 0.1, 0.5])); // rng < 0.25 → relic
    expect(loot.relic).not.toBeNull();
    expect(RELICS).toContain(loot.relic);
  });

  it('never yields a relic when rng is high', () => {
    const m = new ArchaeologyManager();
    const loot = m.dig('west', 1, seqRng([0.5, 0.9]));
    expect(loot.relic).toBeNull();
  });

  it('nearestSite finds the closest', () => {
    const m = new ArchaeologyManager();
    const s = m.nearestSite(-15, -25);
    expect(s.id).toBe('north');
  });

  it('unknown site returns null', () => {
    const m = new ArchaeologyManager();
    expect(m.dig('nowhere', 1)).toBeNull();
  });
});
