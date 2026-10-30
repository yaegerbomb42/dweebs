// seasons2.test.js — seasons 2.0 effects.
import { describe, it, expect } from 'vitest';
import { SEASON_EFFECTS, seasonEffects } from '../src/adventure/seasons.js';

describe('seasons 2.0', () => {
  it('has effects for all seasons', () => {
    for (const s of ['spring', 'summer', 'autumn', 'winter']) {
      expect(SEASON_EFFECTS[s]).toBeTruthy();
    }
  });

  it('winter slows movement', () => {
    expect(seasonEffects('winter').moveMul).toBeLessThan(1);
  });

  it('spring boosts healing', () => {
    expect(seasonEffects('spring').healMul).toBeGreaterThan(1);
  });

  it('summer boosts work', () => {
    expect(seasonEffects('summer').workMul).toBeGreaterThan(1);
  });

  it('autumn doubles harvest', () => {
    expect(seasonEffects('autumn').harvestMul).toBe(2);
  });

  it('unknown seasons default to summer', () => {
    expect(seasonEffects('nope')).toBe(SEASON_EFFECTS.summer);
  });
});
