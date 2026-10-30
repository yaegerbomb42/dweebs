// cards.test.js — dweeb trading cards.
import { describe, it, expect, beforeEach } from 'vitest';
import { RARITIES, CARD_KEY, getCards, drawCard, addCard, countByRarity } from '../src/app/cards.js';

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

describe('trading cards', () => {
  it('has 4 rarities', () => {
    expect(Object.keys(RARITIES).length).toBe(4);
    expect(RARITIES.legendary).toBeTruthy();
  });

  it('starts empty', () => {
    expect(getCards()).toEqual([]);
  });

  it('draws a card with rarity', () => {
    const c = drawCard(() => 0.5);
    expect(c.dweeb).toBeTruthy();
    expect(RARITIES[c.rarity]).toBeTruthy();
    expect(c.id).toBeTruthy();
  });

  it('adds cards to collection', () => {
    const c = drawCard(() => 0.1);
    addCard(c);
    expect(getCards().length).toBe(1);
  });

  it('counts by rarity', () => {
    addCard({ dweeb: 'A', rarity: 'common', id: '1' });
    addCard({ dweeb: 'B', rarity: 'rare', id: '2' });
    addCard({ dweeb: 'C', rarity: 'common', id: '3' });
    const counts = countByRarity();
    expect(counts.common).toBe(2);
    expect(counts.rare).toBe(1);
  });

  it('persists to storage', () => {
    addCard({ dweeb: 'X', rarity: 'epic', id: '9' });
    const raw = globalThis.localStorage.getItem(CARD_KEY);
    expect(raw).toContain('X');
  });
});
