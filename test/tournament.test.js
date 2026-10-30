// tournament.test.js — daily tournament.
import { describe, it, expect } from 'vitest';
import { dailyBracket, playMatch } from '../src/app/tournament.js';

describe('daily tournament', () => {
  it('generates 4 quarterfinals', () => {
    const b = dailyBracket(new Date(2026, 9, 30));
    expect(b.quarterfinals.length).toBe(4);
  });

  it('is deterministic per day', () => {
    const a = dailyBracket(new Date(2026, 9, 30));
    const b = dailyBracket(new Date(2026, 9, 30));
    expect(JSON.stringify(a.quarterfinals)).toBe(JSON.stringify(b.quarterfinals));
  });

  it('includes the player', () => {
    const b = dailyBracket(new Date(2026, 9, 30));
    const players = b.quarterfinals.flatMap(m => [m.p1, m.p2]);
    expect(players).toContain('You');
  });

  it('playMatch picks a winner', () => {
    const m = { p1: 'A', p2: 'B', winner: null };
    const w = playMatch(m, () => 0.1);
    expect(['A', 'B']).toContain(w);
    expect(m.winner).toBe(w);
  });

  it('player has 60% win rate', () => {
    let wins = 0;
    for (let i = 0; i < 100; i++) {
      const m = { p1: 'You', p2: 'Bot', winner: null };
      if (playMatch(m, () => i / 100) === 'You') wins++;
    }
    expect(wins).toBe(60); // rng < 0.6 wins
  });
});
