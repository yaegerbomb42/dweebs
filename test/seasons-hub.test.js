// seasons-hub.test.js — seasonal hub decorations.
import { describe, it, expect } from 'vitest';
import { currentSeason, SEASON_DECOR, applySeason } from '../src/app/seasons-hub.js';

describe('seasonal hub', () => {
  it('maps months to seasons', () => {
    expect(currentSeason(new Date(2026, 3, 15))).toBe('spring'); // April
    expect(currentSeason(new Date(2026, 6, 15))).toBe('summer'); // July
    expect(currentSeason(new Date(2026, 9, 15))).toBe('autumn'); // October
    expect(currentSeason(new Date(2026, 0, 15))).toBe('winter'); // January
    expect(currentSeason(new Date(2026, 11, 15))).toBe('winter'); // December
  });

  it('has decor for every season', () => {
    for (const s of ['spring', 'summer', 'autumn', 'winter']) {
      expect(SEASON_DECOR[s].emoji).toBeTruthy();
      expect(SEASON_DECOR[s].label).toBeTruthy();
    }
  });

  it('applySeason sets the class', () => {
    const classes = new Set();
    const root = {
      classList: {
        add: c => classes.add(c),
        remove: (...cs) => cs.forEach(c => classes.delete(c)),
      },
    };
    const season = applySeason(root, new Date(2026, 9, 15));
    expect(season).toBe('autumn');
    expect(classes.has('season-autumn')).toBe(true);
  });

  it('applySeason never throws without a root', () => {
    expect(() => applySeason(null)).not.toThrow();
  });
});
