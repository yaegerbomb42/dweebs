// showcase.test.js — achievement showcase pins.
import { describe, it, expect, beforeEach } from 'vitest';
import { SHOWCASE_KEY, MAX_PINNED, getPinned, pin, unpin, isPinned } from '../src/app/showcase.js';

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

describe('achievement showcase', () => {
  it('starts empty', () => {
    expect(getPinned()).toEqual([]);
  });

  it('pins achievements', () => {
    pin('first-blood');
    expect(isPinned('first-blood')).toBe(true);
    expect(getPinned()).toContain('first-blood');
  });

  it('does not duplicate', () => {
    pin('a');
    pin('a');
    expect(getPinned().filter(x => x === 'a').length).toBe(1);
  });

  it('caps at MAX_PINNED, keeps newest', () => {
    pin('a'); pin('b'); pin('c'); pin('d');
    const pinned = getPinned();
    expect(pinned.length).toBe(MAX_PINNED);
    expect(pinned).toContain('d');
    expect(pinned).not.toContain('a');
  });

  it('unpins', () => {
    pin('x');
    unpin('x');
    expect(isPinned('x')).toBe(false);
  });

  it('persists to storage', () => {
    pin('test');
    const raw = globalThis.localStorage.getItem(SHOWCASE_KEY);
    expect(raw).toContain('test');
  });
});
