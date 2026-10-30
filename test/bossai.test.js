// bossai.test.js — smarter boss AI.
import { describe, it, expect } from 'vitest';
import { BOSS_TACTICS, pickTarget, shouldUseSpecial } from '../src/adventure/bossai.js';

const boss = { x: 0, z: 0 };

describe('boss AI 2.0', () => {
  it('has tactics for all bosses', () => {
    expect(BOSS_TACTICS.grumblor).toBeTruthy();
    expect(BOSS_TACTICS.skitter).toBeTruthy();
    expect(BOSS_TACTICS.mudking).toBeTruthy();
  });

  it('grumblor targets buildings', () => {
    const targets = [
      { x: 10, z: 0, type: 'citizen', hp: 100 },
      { x: 5, z: 0, type: 'building', hp: 100 },
    ];
    const t = pickTarget('grumblor', targets, boss);
    expect(t.type).toBe('building');
  });

  it('skitter targets weak citizens', () => {
    const targets = [
      { x: 1, z: 0, type: 'citizen', hp: 100 },
      { x: 2, z: 0, type: 'citizen', hp: 10 },
    ];
    const t = pickTarget('skitter', targets, boss);
    expect(t.hp).toBe(10);
  });

  it('mudking targets nearest', () => {
    const targets = [
      { x: 10, z: 0, type: 'citizen', hp: 100 },
      { x: 2, z: 0, type: 'building', hp: 100 },
    ];
    const t = pickTarget('mudking', targets, boss);
    expect(t.x).toBe(2);
  });

  it('returns null for no targets', () => {
    expect(pickTarget('grumblor', [], boss)).toBeNull();
  });

  it('special on cooldown blocked', () => {
    expect(shouldUseSpecial('grumblor', 5, 0.1)).toBe(false);
  });

  it('hurt bosses use special', () => {
    expect(shouldUseSpecial('grumblor', 0, 0.3)).toBe(true);
  });
});
