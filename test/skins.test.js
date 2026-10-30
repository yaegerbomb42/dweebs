// skins.test.js — warfare unit skins.
import { describe, it, expect, beforeEach } from 'vitest';
import { SKINS, SKIN_KEY, selectedSkin, unlockedSkins, unlockSkin, selectSkin } from '../src/warfare/skins.js';

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

describe('unit skins', () => {
  it('has 4 skins', () => {
    expect(Object.keys(SKINS).length).toBe(4);
  });

  it('defaults to default skin', () => {
    expect(selectedSkin()).toBe('default');
    expect(unlockedSkins()).toContain('default');
  });

  it('unlocks new skins', () => {
    expect(unlockSkin('golden')).toBe(true);
    expect(unlockedSkins()).toContain('golden');
  });

  it('does not re-unlock', () => {
    unlockSkin('golden');
    expect(unlockSkin('golden')).toBe(false);
  });

  it('rejects unknown skins', () => {
    expect(unlockSkin('nope')).toBe(false);
  });

  it('selects unlocked skins', () => {
    unlockSkin('shadow');
    expect(selectSkin('shadow')).toBe(true);
    expect(selectedSkin()).toBe('shadow');
  });

  it('cannot select locked skins', () => {
    expect(selectSkin('rainbow')).toBe(false);
  });
});
