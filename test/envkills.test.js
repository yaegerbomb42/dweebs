// envkills.test.js — Hall of Doom: death-cause tally, leaderboard order, icons.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ENVKILLS_KEY, CAUSE_ICONS, causeIcon, recordDeath, getBoard, totalDeaths,
} from '../src/app/envkills.js';

function mockStorage(data = {}) {
  const store = { ...data };
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  return store;
}

beforeEach(() => { delete globalThis.localStorage; });

describe('recordDeath / getBoard', () => {
  it('starts empty', () => {
    mockStorage();
    expect(getBoard()).toEqual([]);
    expect(totalDeaths()).toBe(0);
  });

  it('tallies causes and sorts desc', () => {
    mockStorage();
    recordDeath('VAPORIZED IN THE VOID');
    recordDeath('DROWNED IN THE LAGOON');
    recordDeath('VAPORIZED IN THE VOID');
    const board = getBoard();
    expect(board[0]).toMatchObject({ cause: 'VAPORIZED IN THE VOID', count: 2 });
    expect(board[1]).toMatchObject({ cause: 'DROWNED IN THE LAGOON', count: 1 });
    expect(totalDeaths()).toBe(3);
  });

  it('attaches icons', () => {
    mockStorage();
    recordDeath('DROWNED IN THE LAGOON');
    expect(getBoard()[0].icon).toBe('🌊');
  });

  it('respects the limit', () => {
    mockStorage();
    for (let i = 0; i < 10; i++) recordDeath('CAUSE ' + i);
    expect(getBoard(3).length).toBe(3);
  });

  it('ignores empty causes', () => {
    mockStorage();
    recordDeath('');
    recordDeath(null);
    expect(totalDeaths()).toBe(0);
  });

  it('survives corrupt JSON', () => {
    mockStorage({ [ENVKILLS_KEY]: 'bad{{' });
    expect(getBoard()).toEqual([]);
    recordDeath('VAPORIZED IN THE VOID');
    expect(totalDeaths()).toBe(1);
  });
});

describe('causeIcon', () => {
  it('maps known causes, defaults the rest', () => {
    expect(causeIcon('VAPORIZED IN THE VOID')).toBe('🌌');
    expect(causeIcon('SOMETHING ELSE')).toBe('👊');
  });
  it('every table entry has an icon', () => {
    for (const cause of Object.keys(CAUSE_ICONS)) {
      expect(causeIcon(cause)).toBeTruthy();
    }
  });
});
