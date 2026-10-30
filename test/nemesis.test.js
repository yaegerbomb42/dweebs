// nemesis.test.js — rival bots that remember you.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  NEMESIS_KEY, NEMESIS_THRESHOLD,
  recordRivalry, getRivalry, getNemesis, nemesisTaunt, rivalryLine,
} from '../src/app/nemesis.js';

function mockStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
}

beforeEach(() => {
  delete globalThis.localStorage;
  mockStorage();
});

describe('nemesis', () => {
  it('starts with no history', () => {
    expect(getRivalry('Blorp')).toEqual({ wins: 0, losses: 0 });
    expect(getNemesis()).toBeNull();
  });

  it('records wins and losses', () => {
    recordRivalry('Blorp', false);
    recordRivalry('Blorp', false);
    recordRivalry('Blorp', true);
    expect(getRivalry('Blorp')).toEqual({ wins: 2, losses: 1 });
  });

  it('crowns a nemesis at the threshold', () => {
    for (let i = 0; i < NEMESIS_THRESHOLD; i++) recordRivalry('Gumbo', false);
    const n = getNemesis();
    expect(n.name).toBe('Gumbo');
    expect(n.wins).toBe(NEMESIS_THRESHOLD);
  });

  it('picks the bot with the most wins', () => {
    recordRivalry('Blorp', false); recordRivalry('Blorp', false);
    recordRivalry('Gumbo', false); recordRivalry('Gumbo', false); recordRivalry('Gumbo', false);
    expect(getNemesis().name).toBe('Gumbo');
  });

  it('taunts are deterministic', () => {
    recordRivalry('Blorp', false);
    const t1 = nemesisTaunt('Blorp');
    const t2 = nemesisTaunt('Blorp');
    expect(t1).toBe(t2);
    expect(typeof t1).toBe('string');
  });

  it('rivalryLine formats history', () => {
    expect(rivalryLine('Nobody')).toContain('no history');
    recordRivalry('Blorp', false);
    expect(rivalryLine('Blorp')).toContain('1-0');
  });

  it('persists to storage', () => {
    recordRivalry('Toast', false);
    const raw = globalThis.localStorage.getItem(NEMESIS_KEY);
    expect(raw).toContain('Toast');
  });
});
