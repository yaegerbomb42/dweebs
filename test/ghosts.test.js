// ghosts.test.js — async ghost rivals: comparison, persistence, pace checks.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GHOST_KEY, compareGhosts, isNewRecord, getGhost, saveGhost,
  ghostLine, aheadOfGhost, ghostBeaten,
} from '../src/app/ghosts.js';

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

const G1 = { mode: 'derby', kos: 5, durationSec: 150, stylePeak: 80 };
const G2 = { mode: 'derby', kos: 7, durationSec: 200, stylePeak: 60 };
const G3 = { mode: 'derby', kos: 5, durationSec: 120, stylePeak: 80 }; // faster than G1

describe('compareGhosts', () => {
  it('more KOs wins', () => {
    expect(compareGhosts(G2, G1)).toBeGreaterThan(0);
    expect(compareGhosts(G1, G2)).toBeLessThan(0);
  });
  it('ties break on shorter duration', () => {
    expect(compareGhosts(G3, G1)).toBeGreaterThan(0);
  });
  it('null handling', () => {
    expect(compareGhosts(null, G1)).toBeLessThan(0);
    expect(compareGhosts(G1, null)).toBeGreaterThan(0);
    expect(compareGhosts(null, null)).toBe(0);
  });
  it('isNewRecord', () => {
    expect(isNewRecord(G2, G1)).toBe(true);
    expect(isNewRecord(G1, G2)).toBe(false);
    expect(isNewRecord(G1, G1)).toBe(false);
  });
});

describe('persistence', () => {
  it('getGhost returns null with no storage', () => {
    expect(getGhost('derby')).toBeNull();
  });

  it('first save returns saved', () => {
    mockStorage();
    expect(saveGhost('derby', G1)).toBe('saved');
    expect(getGhost('derby')).toMatchObject({ kos: 5 });
  });

  it('better ghost returns record and replaces', () => {
    mockStorage();
    saveGhost('derby', G1);
    expect(saveGhost('derby', G2)).toBe('record');
    expect(getGhost('derby')).toMatchObject({ kos: 7 });
  });

  it('worse ghost returns kept', () => {
    mockStorage();
    saveGhost('derby', G2);
    expect(saveGhost('derby', G1)).toBe('kept');
    expect(getGhost('derby')).toMatchObject({ kos: 7 });
  });

  it('ghosts are per-mode', () => {
    mockStorage();
    saveGhost('derby', G1);
    expect(getGhost('brawl')).toBeNull();
  });

  it('survives corrupt JSON', () => {
    mockStorage({ [GHOST_KEY]: 'garbage{{' });
    expect(getGhost('derby')).toBeNull();
    expect(saveGhost('derby', G1)).toBe('saved');
  });
});

describe('ghostLine', () => {
  it('formats a ghost', () => {
    expect(ghostLine({ ...G1, fighterName: 'Zed' })).toBe('5 KOs · 2:30 · Zed');
  });
  it('handles null', () => {
    expect(ghostLine(null)).toContain('No rival');
  });
});

describe('pace checks', () => {
  it('aheadOfGhost compares KO pace', () => {
    // Ghost: 5 KOs in 150s → 1 KO per 30s.
    expect(aheadOfGhost(G1, 3, 60)).toBe(true);   // 3 in 60s vs expected 2
    expect(aheadOfGhost(G1, 1, 60)).toBe(false);  // 1 in 60s vs expected 2
    expect(aheadOfGhost(null, 5, 60)).toBe(false);
  });
  it('ghostBeaten checks the final total', () => {
    expect(ghostBeaten(G1, 6)).toBe(true);
    expect(ghostBeaten(G1, 5)).toBe(false);
    expect(ghostBeaten(null, 99)).toBe(false);
  });
});
