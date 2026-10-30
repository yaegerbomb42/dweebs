// powerups.test.js — arena power-ups.
import { describe, it, expect } from 'vitest';
import { POWERUPS, POWERUP_IDS, spawnPowerup, applyPowerup } from '../src/sim/powerups.js';

describe('power-ups', () => {
  it('has 4 types', () => {
    expect(POWERUP_IDS.length).toBe(4);
    expect(POWERUPS.speed).toBeTruthy();
  });

  it('spawns at valid positions', () => {
    const p = spawnPowerup(() => 0.5);
    expect(POWERUP_IDS).toContain(p.type);
    const dist = Math.hypot(p.x, p.z);
    expect(dist).toBeGreaterThanOrEqual(4);
    expect(dist).toBeLessThanOrEqual(14);
  });

  it('applies to dweeb', () => {
    const dweeb = {};
    const p = spawnPowerup(() => 0.1);
    const applied = applyPowerup(dweeb, p);
    expect(dweeb.powerup.type).toBe(p.type);
    expect(applied.expires).toBeGreaterThan(0);
  });

  it('stacks duration', () => {
    const dweeb = {};
    const p1 = { type: 'speed', duration: 10 };
    const p2 = { type: 'speed', duration: 10 };
    applyPowerup(dweeb, p1);
    applyPowerup(dweeb, p2);
    expect(dweeb.powerup.expires).toBe(20);
  });
});
