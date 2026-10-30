// streaks.test.js — arena win streaks.
import { describe, it, expect, beforeEach } from 'vitest';
import { STREAK_KEY, getStreak, recordResult, resetStreak } from '../src/app/streaks.js';

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

describe('win streaks', () => {
  it('starts at zero', () => {
    const s = getStreak();
    expect(s.streak).toBe(0);
    expect(s.best).toBe(0);
  });

  it('increments on win', () => {
    recordResult(true);
    recordResult(true);
    expect(getStreak().streak).toBe(2);
  });

  it('resets on loss', () => {
    recordResult(true);
    recordResult(true);
    recordResult(false);
    expect(getStreak().streak).toBe(0);
  });

  it('tracks best', () => {
    recordResult(true);
    recordResult(true);
    recordResult(false);
    recordResult(true);
    expect(getStreak().best).toBe(2);
  });

  it('bonus on multiples of 3', () => {
    recordResult(true);
    recordResult(true);
    const r = recordResult(true);
    expect(r.bonus).toBe(true);
    expect(r.streak).toBe(3);
  });

  it('no bonus on non-multiples', () => {
    const r = recordResult(true);
    expect(r.bonus).toBe(false);
  });

  it('resetStreak clears', () => {
    recordResult(true);
    resetStreak();
    expect(getStreak().streak).toBe(0);
  });
});
