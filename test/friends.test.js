// friends.test.js — friend activity feed.
import { describe, it, expect } from 'vitest';
import { friendActivity } from '../src/app/friends.js';

describe('friend activity', () => {
  it('returns 3-5 items', () => {
    const items = friendActivity(new Date(2026, 9, 30));
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it('is deterministic per day', () => {
    const a = friendActivity(new Date(2026, 9, 30));
    const b = friendActivity(new Date(2026, 9, 30));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('differs across days', () => {
    const a = friendActivity(new Date(2026, 9, 30));
    const b = friendActivity(new Date(2026, 9, 31));
    // Very likely different (not guaranteed, but overwhelmingly so).
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false);
  });

  it('has friend, emoji, activity, time', () => {
    const [item] = friendActivity(new Date(2026, 9, 30));
    expect(item.friend).toBeTruthy();
    expect(item.emoji).toBeTruthy();
    expect(item.activity).toBeTruthy();
    expect(item.time).toMatch(/h ago/);
  });

  it('no duplicate friends in one day', () => {
    const items = friendActivity(new Date(2026, 9, 30));
    const names = items.map(i => i.friend);
    expect(new Set(names).size).toBe(names.length);
  });
});
