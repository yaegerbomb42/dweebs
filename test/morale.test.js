// morale.test.js — dweeb morale: work multipliers, mood overrides, drift,
// event shocks, and the citizen integration (forage rate scales with morale).
import { describe, it, expect } from 'vitest';
import {
  workMultiplier, moraleMood, moraleTarget, driftMorale,
  applyMoraleShock, averageMorale,
} from '../src/adventure/morale.js';

describe('workMultiplier', () => {
  it('maps 0→0.7x, 100→1.3x, 50→1.0x', () => {
    expect(workMultiplier(0)).toBeCloseTo(0.7, 5);
    expect(workMultiplier(100)).toBeCloseTo(1.3, 5);
    expect(workMultiplier(50)).toBeCloseTo(1.0, 5);
  });
  it('clamps out-of-range input', () => {
    expect(workMultiplier(-50)).toBeCloseTo(0.7, 5);
    expect(workMultiplier(500)).toBeCloseTo(1.3, 5);
  });
});

describe('moraleMood', () => {
  it('overrides at the extremes only', () => {
    expect(moraleMood(10)).toBe('miserable');
    expect(moraleMood(30)).toBe('sad');
    expect(moraleMood(60)).toBeNull();
    expect(moraleMood(95)).toBe('ecstatic');
  });
});

describe('moraleTarget', () => {
  const base = { hunger: 40, energy: 80 };
  it('baseline is content', () => {
    const t = moraleTarget(base, {});
    expect(t).toBeGreaterThan(55);
    expect(t).toBeLessThan(75);
  });
  it('starving tanks the target', () => {
    expect(moraleTarget({ ...base, hunger: 90 }, {})).toBeLessThan(moraleTarget(base, {}));
  });
  it('disasters and invasions drag it down', () => {
    const calm = moraleTarget(base, {});
    expect(moraleTarget(base, { disaster: true })).toBeLessThan(calm);
    expect(moraleTarget(base, { invasion: true })).toBeLessThan(calm);
  });
  it('festivals lift it', () => {
    expect(moraleTarget(base, { festival: true })).toBeGreaterThan(moraleTarget(base, {}));
  });
  it('stays in [0, 100]', () => {
    const t = moraleTarget({ hunger: 100, energy: 0 }, { disaster: true, invasion: true, isNight: true });
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(100);
  });
});

describe('driftMorale', () => {
  it('moves toward the target', () => {
    const m1 = driftMorale(50, 80, 1);
    expect(m1).toBeGreaterThan(50);
    expect(m1).toBeLessThan(80);
    const m2 = driftMorale(90, 40, 1);
    expect(m2).toBeLessThan(90);
    expect(m2).toBeGreaterThan(40);
  });
  it('larger dt moves further', () => {
    expect(driftMorale(50, 80, 10)).toBeGreaterThan(driftMorale(50, 80, 1));
  });
});

describe('applyMoraleShock / averageMorale', () => {
  it('shocks all citizens and clamps', () => {
    const cs = [{ morale: 90 }, { morale: 5 }, {}];
    applyMoraleShock(cs, 20);
    expect(cs[0].morale).toBe(100);
    expect(cs[1].morale).toBe(25);
    expect(cs[2].morale).toBe(80);
    applyMoraleShock(cs, -200);
    expect(cs.every(c => c.morale === 0)).toBe(true);
  });
  it('averageMorale', () => {
    expect(averageMorale([{ morale: 80 }, { morale: 40 }])).toBe(60);
    expect(averageMorale([])).toBe(60);
  });
});

describe('friendship and morale', () => {
  const base = { hunger: 40, energy: 80 };
  it('strong friendships lift the target', () => {
    const lonely = moraleTarget(base, {});
    const loved = moraleTarget({ ...base, friends: new Map([['a', 90], ['b', 80]]) }, {});
    expect(loved).toBeGreaterThan(lonely);
    expect(loved - lonely).toBeCloseTo(5 + (85 / 100) * 12, 5); // -5 lonely removed, +bond bonus
  });
  it('loneliness drags the target', () => {
    expect(moraleTarget(base, {})).toBe(moraleTarget({ ...base, friends: new Map() }, {}));
    expect(moraleTarget({ ...base, friends: new Map() }, {})).toBeLessThan(
      moraleTarget({ ...base, friends: new Map([['a', 10]]) }, {})
    );
  });
});
