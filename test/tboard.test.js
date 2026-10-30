// tboard.test.js — time attack leaderboard.
import { describe, it, expect, beforeEach } from 'vitest';
import { TBOARD_KEY, getBoard, bestFor, submit } from '../src/app/tboard.js';

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

describe('time attack leaderboard', () => {
  it('starts empty', () => {
    expect(getBoard()).toEqual({});
    expect(bestFor('brawl')).toBeNull();
  });

  it('submits records', () => {
    expect(submit('brawl', 100)).toBe(true);
    expect(bestFor('brawl')).toBe(100);
  });

  it('only faster times record', () => {
    submit('brawl', 100);
    expect(submit('brawl', 120)).toBe(false);
    expect(submit('brawl', 90)).toBe(true);
    expect(bestFor('brawl')).toBe(90);
  });

  it('tracks per mode', () => {
    submit('brawl', 100);
    submit('royale', 200);
    expect(getBoard()).toEqual({ brawl: 100, royale: 200 });
  });
});
