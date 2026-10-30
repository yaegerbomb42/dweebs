// minigames.test.js — hub mini-games.
import { describe, it, expect } from 'vitest';
import { MINIGAMES, ClickerGame } from '../src/app/minigames.js';

describe('mini-games', () => {
  it('has 3 games', () => {
    expect(Object.keys(MINIGAMES).length).toBe(3);
  });

  it('ClickerGame counts clicks', () => {
    const g = new ClickerGame();
    g.start();
    g.click();
    g.click();
    expect(g.clicks).toBe(2);
  });

  it('ClickerGame tracks time', () => {
    const g = new ClickerGame();
    g.start();
    const r = g.remaining();
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(10);
  });

  it('clicks stop when inactive', () => {
    const g = new ClickerGame();
    expect(g.click()).toBe(0);
  });
});
