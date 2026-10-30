// botPersonalities.test.js — AI personalities.
import { describe, it, expect } from 'vitest';
import { BOT_PERSONALITIES, BOT_PERSONALITY_IDS, randomPersonality } from '../src/sim/botPersonalities.js';

describe('bot personalities', () => {
  it('has 5 personalities', () => {
    expect(BOT_PERSONALITY_IDS.length).toBe(5);
  });

  it('each has stats', () => {
    for (const id of BOT_PERSONALITY_IDS) {
      const p = BOT_PERSONALITIES[id];
      expect(p.name).toBeTruthy();
      expect(p.aggression).toBeGreaterThan(0);
      expect(p.evasion).toBeGreaterThan(0);
    }
  });

  it('randomPersonality picks valid', () => {
    for (let i = 0; i < 20; i++) {
      expect(BOT_PERSONALITY_IDS).toContain(randomPersonality());
    }
  });

  it('brawler is aggressive', () => {
    expect(BOT_PERSONALITIES.brawler.aggression).toBeGreaterThan(1);
  });

  it('coward evades', () => {
    expect(BOT_PERSONALITIES.coward.evasion).toBeGreaterThan(1);
  });
});
