// nicknames.test.js — warfare unit nicknames.
import { describe, it, expect, beforeEach } from 'vitest';
import { NICKNAME_KEY, getNickname, setNickname, clearNicknames } from '../src/warfare/nicknames.js';

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

describe('nicknames', () => {
  it('returns null for unknown units', () => {
    expect(getNickname(999)).toBeNull();
  });

  it('sets and gets nicknames', () => {
    setNickname(1, 'Bubbles');
    expect(getNickname(1)).toBe('Bubbles');
  });

  it('trims and limits length', () => {
    setNickname(2, '  A very long name that exceeds twenty chars  ');
    const n = getNickname(2);
    expect(n.length).toBeLessThanOrEqual(20);
    expect(n.startsWith('A')).toBe(true);
  });

  it('empty name clears the nickname', () => {
    setNickname(3, 'Test');
    setNickname(3, '');
    expect(getNickname(3)).toBeNull();
  });

  it('persists to storage', () => {
    setNickname(4, 'Hero');
    const raw = globalThis.localStorage.getItem(NICKNAME_KEY);
    expect(raw).toContain('Hero');
  });

  it('clearNicknames wipes all', () => {
    setNickname(5, 'Test');
    clearNicknames();
    expect(getNickname(5)).toBeNull();
  });
});
