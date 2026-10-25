// Knockback / DI / percent-curve maths straight out of Balance.js + Dweeb.receiveHit.
// These are the numbers the Lead tunes, so the tests assert the *shape* of the curve
// (Smash-style `launch = (base + growth·%/100) · armor`) and the invariants that must
// never break, rather than hardcoding every value.
import { describe, it, expect } from 'vitest';
import { BALANCE, TYPE_STATS, statsFor } from '../src/game/Balance.js';

const KB = BALANCE.knockback;
const DI = BALANCE.di;
const MV = BALANCE.move;

/** Exactly the formula in Dweeb.receiveHit. */
function launchFor({ base, growth, percent, type = 'cube', mega = false }) {
  const s = statsFor(type);
  const dmgArmor = mega ? 0.6 : 1;
  const armor = dmgArmor * s.armor;
  return (base + growth * s.growthTaken * (percent / 100)) * armor;
}

/** A charged punch: the most common source of knockback in the game. */
const punch = c => BALANCE.attacks.punch(c);

describe('percent curve', () => {
  it('is linear in percent with the attack growth rate', () => {
    const atk = punch(1);
    expect(launchFor({ base: atk.base, growth: atk.growth, percent: 0 }))
      .toBeCloseTo(atk.base, 6);
    expect(launchFor({ base: atk.base, growth: atk.growth, percent: 100 }))
      .toBeCloseTo(atk.base + atk.growth, 6);
    expect(launchFor({ base: atk.base, growth: atk.growth, percent: 150 }))
      .toBeCloseTo(atk.base + atk.growth * 1.5, 6);
  });

  it('is strictly increasing for every attack table', () => {
    for (const name of ['punch', 'hammer', 'anvil', 'spiky', 'dweebThrow']) {
      for (const c of [0, 0.5, 1]) {
        const atk = BALANCE.attacks[name](c);
        let prev = -Infinity;
        for (let pct = 0; pct <= 200; pct += 5) {
          const l = launchFor({ base: atk.base, growth: atk.growth, percent: pct });
          expect(l).toBeGreaterThan(prev);
          prev = l;
        }
      }
    }
  });

  it('stays finite and positive at silly percents', () => {
    const atk = punch(1);
    for (const pct of [0, 300, 999]) {
      const l = launchFor({ base: atk.base, growth: atk.growth, percent: pct });
      expect(Number.isFinite(l)).toBe(true);
      expect(l).toBeGreaterThan(0);
    }
  });

  it('matches the documented feel bands in the Balance.js header', () => {
    // 0–40% hits are stage-control fodder, 120%+ charged hits KO from anywhere sensible.
    const at = (a, pct) => launchFor({ base: a.base, growth: a.growth, percent: pct });
    expect(at(punch(0), 40)).toBeLessThan(KB.ragdollAt);
    expect(at(punch(1), 120)).toBeGreaterThan(KB.ragdollAt);
    expect(at(BALANCE.attacks.hammer(1), 120)).toBeGreaterThan(KB.ragdollAt);
  });
});

describe('archetype armour / growth scaling', () => {
  it('blob takes less launch than cube, spiky more', () => {
    const atk = punch(1);
    const at = t => launchFor({ base: atk.base, growth: atk.growth, percent: 80, type: t });
    expect(at('blob')).toBeLessThan(at('cube'));
    expect(at('spiky')).toBeGreaterThan(at('cube'));
  });

  it('falls back to cube for an unknown type', () => {
    expect(statsFor('nope')).toBe(TYPE_STATS.cube);
  });

  it('keeps every archetype within a sane band of the cube launch', () => {
    const atk = punch(1);
    const base = launchFor({ base: atk.base, growth: atk.growth, percent: 100 });
    for (const t of Object.keys(TYPE_STATS)) {
      const l = launchFor({ base: atk.base, growth: atk.growth, percent: 100, type: t });
      expect(l / base).toBeGreaterThan(0.75);
      expect(l / base).toBeLessThan(1.25);
    }
  });

  it('mega (power-up) reduces both damage and knockback taken', () => {
    const atk = punch(1);
    const plain = launchFor({ base: atk.base, growth: atk.growth, percent: 60 });
    const mega = launchFor({ base: atk.base, growth: atk.growth, percent: 60, mega: true });
    expect(mega).toBeLessThan(plain);
    expect(mega / plain).toBeCloseTo(0.6, 6); // dmgArmor 0.6 · armor 1 for a cube
  });
});

describe('hitstun', () => {
  it('grows with launch speed and starts at hitstunBase', () => {
    expect(KB.hitstunBase).toBeGreaterThan(0);
    expect(KB.hitstunPerLaunch).toBeGreaterThan(0);
    const hs = l => KB.hitstunBase + l * KB.hitstunPerLaunch;

describe('juice tiers', () => {
  it('tiers are ascending and bracket the ragdoll threshold', () => {
    const t = BALANCE.juice.tiers;
    expect(t).toHaveLength(3);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(KB.ragdollAt).toBeGreaterThan(t[0]);
    expect(t[t.length - 1]).toBeLessThan(30);
  });

  it('hitStop / shake / squash arrays match the tier count and never go backwards', () => {
    for (const key of ['hitStop', 'shake', 'squash']) {
      const a = BALANCE.juice[key];
      expect(a.length).toBe(BALANCE.juice.tiers.length + 1);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBeGreaterThanOrEqual(0);
        if (i) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
      }
    }
  });
});

describe('attack tables', () => {
  it('charging never reduces damage or knockback', () => {
    for (const name of ['punch', 'hammer', 'anvil', 'spiky', 'dweebThrow']) {
      let prev = null;
      for (const c of [0, 0.25, 0.5, 0.75, 1]) {
        const a = BALANCE.attacks[name](c);
        if (prev) {
          expect(a.damage).toBeGreaterThanOrEqual(prev.damage);
          expect(a.base + a.growth).toBeGreaterThanOrEqual(prev.base + prev.growth);
        }
        prev = a;
      }
    }
  });

  it('explosion scales linearly with falloff k', () => {
    const full = BALANCE.attacks.explosion(1);
    const half = BALANCE.attacks.explosion(0.5);
    expect(half.damage).toBeCloseTo(full.damage / 2, 6);
    expect(half.growth).toBeCloseTo(full.growth / 2, 6);
    expect(BALANCE.attacks.explosion(0).growth).toBe(0);
  });

  it('thrown-item knockback scales with heft and trickshot factor', () => {
    const light = BALANCE.attacks.thrown(0.5, 1);
    const heavy = BALANCE.attacks.thrown(2, 1);
    const trick = BALANCE.attacks.thrown(0.5, 1.2);
    expect(heavy.damage).toBeGreaterThan(light.damage);
    expect(trick.damage).toBeGreaterThan(light.damage);
    expect(trick.growth).toBeGreaterThan(light.growth);
  });
});

describe('match geometry', () => {
  it('sudden death pulls the side blast line in, top blast line stays above it', () => {
    const m = BALANCE.match;
    expect(m.sdBlastScale).toBeLessThan(1);
    expect(m.blastSide * m.sdBlastScale).toBeLessThan(m.blastSide);
    expect(m.blastTop).toBeGreaterThan(m.blastSide * m.sdBlastScale);
  });
});

    expect(hs(0)).toBeCloseTo(KB.hitstunBase, 9);
    expect(hs(10)).toBeGreaterThan(hs(1));
  });

  it('stays bounded at a 999% charged smash (no multi-second stunlock)', () => {
    const atk = punch(1);
    const l = launchFor({ base: atk.base, growth: atk.growth, percent: 999 });
    expect(KB.hitstunBase + l * KB.hitstunPerLaunch).toBeLessThan(3.0);
  });
});

describe('directional influence (DI)', () => {
  it('budget is a fixed fraction of move speed and cannot reverse a smash', () => {
    const budget = DI.strength * MV.speed;
    expect(budget).toBeCloseTo(2.625, 6); // 0.35 × 7.5
    const atk = punch(1);
    const smash = launchFor({ base: atk.base, growth: atk.growth, percent: 999 });
    expect(budget).toBeLessThan(smash * 0.05);
  });

  it('can be fully spent within a second at its rated rate', () => {
    expect(DI.strength * MV.speed / DI.rate).toBeLessThan(1);
    expect(DI.rate).toBeGreaterThan(0);
  });

  it('up-DI is weaker than sideways and tumbling DI is milder', () => {
    expect(DI.vertical).toBeLessThan(1);
    expect(DI.ragdollScale).toBeLessThan(1);
  });
});
