// crossgame.test.js — cross-game triathlon tracker.
import { describe, it, expect, beforeEach } from 'vitest';
import { CROSSGAME_KEY, getProgress, completeLeg, isComplete, progressLine } from '../src/app/crossgame.js';

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

describe('cross-game triathlon', () => {
  it('starts empty each day', () => {
    const p = getProgress();
    expect(p.arena).toBe(false);
    expect(p.warfare).toBe(false);
    expect(p.builder).toBe(false);
    expect(isComplete()).toBe(false);
  });

  it('completing legs tracks progress', () => {
    completeLeg('arena');
    expect(getProgress().arena).toBe(true);
    expect(isComplete()).toBe(false);
    completeLeg('warfare');
    completeLeg('builder');
    expect(isComplete()).toBe(true);
  });

  it('rejects bad legs', () => {
    const p = completeLeg('nope');
    expect(p.arena).toBe(false);
  });

  it('progressLine shows checkboxes', () => {
    expect(progressLine()).toContain('⬜');
    completeLeg('arena');
    expect(progressLine()).toContain('✅');
  });

  it('persists to storage', () => {
    completeLeg('builder');
    const raw = globalThis.localStorage.getItem(CROSSGAME_KEY);
    expect(raw).toContain('builder');
  });
});
