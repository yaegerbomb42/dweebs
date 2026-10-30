// betting.test.js — arena betting: balance, wagers, payouts, pity coins.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BETTING_KEY, STARTING_COINS, PITY_COINS, MIN_WAGER,
  getCoins, placeBet, resolveBet,
} from '../src/app/betting.js';

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

describe('getCoins', () => {
  it('starts new players with starting coins', () => {
    mockStorage();
    expect(getCoins()).toBe(STARTING_COINS);
  });
  it('grants pity coins when bankrupt', () => {
    mockStorage({ [BETTING_KEY]: JSON.stringify({ coins: 5 }) });
    expect(getCoins()).toBe(5 + PITY_COINS);
  });
  it('does not grant pity coins when solvent', () => {
    mockStorage({ [BETTING_KEY]: JSON.stringify({ coins: 50 }) });
    expect(getCoins()).toBe(50);
  });
  it('survives corrupt JSON', () => {
    mockStorage({ [BETTING_KEY]: 'nope{{' });
    expect(getCoins()).toBe(STARTING_COINS);
  });
});

describe('placeBet', () => {
  it('deducts the wager', () => {
    mockStorage();
    const res = placeBet(25);
    expect(res).toEqual({ ok: true, wager: 25 });
    expect(getCoins()).toBe(STARTING_COINS - 25);
  });
  it('rejects wagers below the minimum', () => {
    mockStorage();
    expect(placeBet(5).ok).toBe(false);
    expect(getCoins()).toBe(STARTING_COINS);
  });
  it('rejects wagers above the balance', () => {
    mockStorage();
    expect(placeBet(STARTING_COINS + 1).ok).toBe(false);
    expect(getCoins()).toBe(STARTING_COINS);
  });
});

describe('resolveBet', () => {
  it('win pays 2:1 (net +wager)', () => {
    mockStorage();
    placeBet(40);
    const r = resolveBet(40, true);
    expect(r.profit).toBe(40);
    expect(r.coins).toBe(STARTING_COINS + 40);
  });
  it('loss nets -wager', () => {
    mockStorage();
    placeBet(40);
    const r = resolveBet(40, false);
    expect(r.profit).toBe(-40);
    expect(r.coins).toBe(STARTING_COINS - 40);
  });
  it('full round trip is consistent', () => {
    mockStorage();
    placeBet(100);
    resolveBet(100, true);
    expect(getCoins()).toBe(STARTING_COINS + 100);
  });
  it('MIN_WAGER is sane', () => {
    expect(MIN_WAGER).toBeGreaterThan(0);
    expect(MIN_WAGER).toBeLessThanOrEqual(STARTING_COINS);
  });
});
