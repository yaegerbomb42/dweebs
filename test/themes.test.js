// themes.test.js — village themes.
import { describe, it, expect, beforeEach } from 'vitest';
import { THEMES, THEME_KEY, currentTheme, themeData, setTheme } from '../src/adventure/themes.js';

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

describe('village themes', () => {
  it('has 5 themes', () => {
    expect(Object.keys(THEMES).length).toBe(5);
  });

  it('defaults to meadow', () => {
    expect(currentTheme()).toBe('meadow');
  });

  it('gets theme data', () => {
    const d = themeData('desert');
    expect(d.name).toBe('Desert');
    expect(d.sky).toBeTruthy();
  });

  it('sets valid themes', () => {
    expect(setTheme('snow')).toBe(true);
    expect(currentTheme()).toBe('snow');
  });

  it('rejects invalid themes', () => {
    expect(setTheme('nope')).toBe(false);
  });

  it('persists to storage', () => {
    setTheme('night');
    const raw = globalThis.localStorage.getItem(THEME_KEY);
    expect(raw).toBe('night');
  });
});
