// duel.test.js — 1v1 duel mode.
import { describe, it, expect } from 'vitest';
import { DUEL_ARENAS, duelConfig, DuelSeries } from '../src/sim/duel.js';

describe('duel mode', () => {
  it('has 3 arenas', () => {
    expect(DUEL_ARENAS.length).toBe(3);
  });

  it('duelConfig sets 2 players', () => {
    const c = duelConfig('bridge');
    expect(c.players).toBe(2);
    expect(c.mode).toBe('duel');
    expect(c.bestOf).toBe(3);
  });

  it('DuelSeries tracks wins', () => {
    const s = new DuelSeries();
    expect(s.record('p1')).toBeNull();
    expect(s.score()).toBe('1 - 0');
    expect(s.record('p1')).toBe('p1');
  });

  it('needs 2 wins', () => {
    const s = new DuelSeries();
    s.record('p1');
    s.record('p2');
    expect(s.record('p2')).toBe('p2');
    expect(s.score()).toBe('1 - 2');
  });

  it('rejects bad winners', () => {
    const s = new DuelSeries();
    expect(s.record('nope')).toBeNull();
  });
});
