// login.test.js — daily login rewards.
import { describe, it, expect, beforeEach } from 'vitest';
import { LOGIN_KEY, checkIn, currentStreak } from '../src/app/login.js';

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

describe('daily login', () => {
  it('first check-in gives day 1 reward', () => {
    const r = checkIn();
    expect(r.isNew).toBe(true);
    expect(r.streak).toBe(1);
    expect(r.reward.day).toBe(1);
  });

  it('second check-in same day is not new', () => {
    checkIn();
    const r = checkIn();
    expect(r.isNew).toBe(false);
    expect(r.reward).toBeNull();
  });

  it('consecutive days increment streak', () => {
    // Simulate yesterday's check-in.
    const y = new Date();
    y.setDate(y.getDate() - 1);
    globalThis.localStorage.setItem(LOGIN_KEY, JSON.stringify({
      last: y.toISOString().slice(0, 10),
      streak: 3,
    }));
    const r = checkIn();
    expect(r.streak).toBe(4);
    expect(r.reward.day).toBe(4);
  });

  it('broken streak resets to 1', () => {
    // Simulate 5 days ago.
    const d = new Date();
    d.setDate(d.getDate() - 5);
    globalThis.localStorage.setItem(LOGIN_KEY, JSON.stringify({
      last: d.toISOString().slice(0, 10),
      streak: 10,
    }));
    const r = checkIn();
    expect(r.streak).toBe(1);
  });

  it('rewards cycle weekly', () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    globalThis.localStorage.setItem(LOGIN_KEY, JSON.stringify({
      last: y.toISOString().slice(0, 10),
      streak: 7,
    }));
    const r = checkIn();
    expect(r.streak).toBe(8);
    expect(r.reward.day).toBe(1); // cycles back
  });

  it('currentStreak reads without writing', () => {
    expect(currentStreak()).toBe(0);
    checkIn();
    expect(currentStreak()).toBe(1);
  });
});
