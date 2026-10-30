// reactions.test.js — dweeb emoji reactions.
import { describe, it, expect } from 'vitest';
import { REACTIONS, react, reactAll } from '../src/adventure/reactions.js';

describe('emoji reactions', () => {
  it('has reactions for events', () => {
    expect(REACTIONS.festival.length).toBeGreaterThan(0);
    expect(REACTIONS.bossDefeated.length).toBeGreaterThan(0);
  });

  it('react returns an emoji', () => {
    const e = react('festival', () => 0);
    expect(REACTIONS.festival).toContain(e);
  });

  it('unknown events get default', () => {
    expect(react('nope')).toBe('💬');
  });

  it('reactAll makes citizens say', () => {
    const said = [];
    const citizens = [
      { say: (t, icon) => said.push(icon) },
      { say: (t, icon) => said.push(icon) },
    ];
    reactAll(citizens, 'festival', () => 0);
    expect(said.length).toBe(2);
    expect(REACTIONS.festival).toContain(said[0]);
  });

  it('reactAll skips citizens without say', () => {
    expect(() => reactAll([{}], 'festival')).not.toThrow();
  });
});
