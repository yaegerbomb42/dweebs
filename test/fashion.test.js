// fashion.test.js — dweeb fashion show.
import { describe, it, expect } from 'vitest';
import { fashionLineup, vote, winner } from '../src/app/fashion.js';

function seqRng() {
  let i = 0;
  return () => (i++ % 100) / 100;
}

describe('fashion show', () => {
  it('generates a lineup', () => {
    const lineup = fashionLineup(5, seqRng());
    expect(lineup.length).toBe(5);
    for (const c of lineup) {
      expect(c.name).toBeTruthy();
      expect(c.score).toBeGreaterThanOrEqual(1);
      expect(c.score).toBeLessThanOrEqual(100);
    }
  });

  it('sorts by score descending', () => {
    const lineup = fashionLineup(5, seqRng());
    for (let i = 1; i < lineup.length; i++) {
      expect(lineup[i - 1].score).toBeGreaterThanOrEqual(lineup[i].score);
    }
  });

  it('voting increments votes', () => {
    const lineup = fashionLineup(3, seqRng());
    const updated = vote(lineup, 1);
    expect(updated[1].votes).toBe(1);
    expect(updated[0].votes).toBe(0);
  });

  it('ignores bad indices', () => {
    const lineup = fashionLineup(3, seqRng());
    expect(vote(lineup, 99)).toBe(lineup);
  });

  it('picks the winner by votes', () => {
    let lineup = fashionLineup(3, seqRng());
    lineup = vote(lineup, 2);
    lineup = vote(lineup, 2);
    const w = winner(lineup);
    expect(w).toBe(lineup[2]);
  });

  it('returns null for empty lineup', () => {
    expect(winner([])).toBeNull();
  });
});
