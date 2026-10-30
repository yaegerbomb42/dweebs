// duel.js — 1v1 duel mode.
//
// Two dweebs enter. One leaves.

export const DUEL_ARENAS = ['center', 'bridge', 'pit'];

export function duelConfig(arena = 'center') {
  return {
    mode: 'duel',
    players: 2,
    arena,
    bestOf: 3, // first to 2 wins
  };
}

/**
 * Track a best-of-3 series.
 */
export class DuelSeries {
  constructor() {
    this.wins = { p1: 0, p2: 0 };
    this.round = 1;
  }

  /** Record a round winner ('p1' or 'p2'). Returns 'p1', 'p2', or null. */
  record(winner) {
    if (winner !== 'p1' && winner !== 'p2') return null;
    this.wins[winner]++;
    this.round++;
    if (this.wins[winner] >= 2) return winner;
    return null;
  }

  /** Current score line. */
  score() {
    return `${this.wins.p1} - ${this.wins.p2}`;
  }
}
