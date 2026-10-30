// personality.test.js — dweeb personality traits.
import { describe, it, expect } from 'vitest';
import { TRAITS, TRAIT_IDS, randomTrait, traitDmgMul, traitDefMul, traitStyleMul } from '../src/sim/personality.js';

describe('personality traits', () => {
  it('has 5 traits', () => {
    expect(TRAIT_IDS.length).toBe(5);
    expect(TRAITS.aggressive).toBeTruthy();
  });

  it('randomTrait picks valid traits', () => {
    for (let i = 0; i < 20; i++) {
      expect(TRAIT_IDS).toContain(randomTrait());
    }
  });

  it('aggressive boosts damage', () => {
    expect(traitDmgMul('aggressive')).toBe(1.2);
  });

  it('cautious boosts defense', () => {
    expect(traitDefMul('cautious')).toBe(1.2);
  });

  it('showboat boosts style', () => {
    expect(traitStyleMul('showboat')).toBe(1.5);
  });

  it('hothead scales with damage taken', () => {
    const full = traitDmgMul('hothead', 1.0);
    const hurt = traitDmgMul('hothead', 0.5);
    expect(hurt).toBeGreaterThan(full);
  });

  it('unknown traits are neutral', () => {
    expect(traitDmgMul('nope')).toBe(1);
    expect(traitDefMul('nope')).toBe(1);
    expect(traitStyleMul('nope')).toBe(1);
  });
});
