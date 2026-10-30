// bossrush.test.js — boss rush mode.
import { describe, it, expect } from 'vitest';
import { BossRush, BOSS_RUSH_ORDER } from '../src/adventure/bossrush.js';

describe('boss rush', () => {
  it('has 3 bosses in order', () => {
    expect(BOSS_RUSH_ORDER.length).toBe(3);
    expect(BOSS_RUSH_ORDER).toContain('grumblor');
  });

  it('starts with the first boss', () => {
    const r = new BossRush();
    const boss = r.start();
    expect(boss.id).toBe('grumblor');
    expect(r.active).toBe(true);
  });

  it('advances through bosses', () => {
    const r = new BossRush();
    r.start();
    const next = r.defeat('grumblor');
    expect(next.id).toBe('skitter');
    expect(r.progress().defeated).toBe(1);
  });

  it('completes after all 3', () => {
    const r = new BossRush();
    r.start();
    r.defeat('grumblor');
    r.defeat('skitter');
    const result = r.defeat('mudking');
    expect(result).toBe('complete');
    expect(r.active).toBe(false);
  });

  it('timed mode returns completion time', () => {
    const r = new BossRush();
    r.start(true);
    r.defeat('grumblor');
    r.defeat('skitter');
    const result = r.defeat('mudking');
    expect(result.complete).toBe(true);
    expect(result.time).toBeGreaterThanOrEqual(0);
  });

  it('currentBoss returns null when inactive', () => {
    const r = new BossRush();
    expect(r.currentBoss()).toBeNull();
  });
});
