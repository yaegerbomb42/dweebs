// timeattack.test.js — arena time attack.
import { describe, it, expect, beforeEach } from 'vitest';
import { TIMEATTACK_KEY, bestTime, recordTime, formatTime } from '../src/app/timeattack.js';

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

describe('time attack', () => {
  it('returns null for no record', () => {
    expect(bestTime('brawl')).toBeNull();
  });

  it('records first time as record', () => {
    const r = recordTime('brawl', 120.5);
    expect(r.isRecord).toBe(true);
    expect(bestTime('brawl')).toBe(120.5);
  });

  it('only faster times are records', () => {
    recordTime('brawl', 100);
    expect(recordTime('brawl', 120).isRecord).toBe(false);
    expect(recordTime('brawl', 90).isRecord).toBe(true);
    expect(bestTime('brawl')).toBe(90);
  });

  it('tracks per mode', () => {
    recordTime('brawl', 100);
    recordTime('royale', 200);
    expect(bestTime('brawl')).toBe(100);
    expect(bestTime('royale')).toBe(200);
  });

  it('formats times', () => {
    expect(formatTime(65.5)).toBe('1:05.5');
    expect(formatTime(120)).toBe('2:00.0');
  });
});
