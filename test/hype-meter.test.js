// hype-meter.test.js — crowd hype: accumulation, level crossings, decay.
import { describe, it, expect } from 'vitest';
import { HypeMeter, HYPE_LEVELS, HYPE_DECAY_PER_SEC } from '../src/game/HypeMeter.js';

describe('HypeMeter', () => {
  it('starts cold', () => {
    const h = new HypeMeter();
    expect(h.hype).toBe(0);
    expect(h.level).toBe(0);
  });

  it('add() returns the new level on crossing', () => {
    const h = new HypeMeter();
    expect(h.add(10)).toBe(0); // 10 < 20
    expect(h.add(15)).toBe(1); // 25 >= 20
    expect(h.level).toBe(1);
  });

  it('climbs through all levels', () => {
    const h = new HypeMeter();
    expect(h.add(25)).toBe(1);
    expect(h.add(25)).toBe(2); // 50 >= 40
    expect(h.add(25)).toBe(3); // 75 >= 60
    expect(h.add(25)).toBe(4); // 100 >= 80
    expect(h.maxed).toBe(true);
  });

  it('caps at 100', () => {
    const h = new HypeMeter();
    h.add(500);
    expect(h.hype).toBe(100);
  });

  it('no re-fire without a new crossing', () => {
    const h = new HypeMeter();
    h.add(25);
    expect(h.add(5)).toBe(0); // 30, still level 1
  });

  it('decays over time and drops levels', () => {
    const h = new HypeMeter();
    h.add(50); // level 2
    h.update(10); // -30 → 20
    expect(h.hype).toBeCloseTo(20, 5);
    expect(h.level).toBe(1);
  });

  it('pandemonium unlatches when hype falls', () => {
    const h = new HypeMeter();
    h.add(100);
    expect(h.maxed).toBe(true);
    const ended = h.update(10); // 100 - 30 = 70 < 80
    expect(ended).toBe(true);
    expect(h.maxed).toBe(false);
  });

  it('reset() clears everything', () => {
    const h = new HypeMeter();
    h.add(100);
    h.reset();
    expect(h.hype).toBe(0);
    expect(h.level).toBe(0);
    expect(h.maxed).toBe(false);
  });

  it('decay rate is sane', () => {
    expect(HYPE_DECAY_PER_SEC).toBeGreaterThan(0);
    expect(HYPE_LEVELS).toEqual([20, 40, 60, 80]);
  });
});
