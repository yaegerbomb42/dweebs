// shortcuts.test.js — keyboard shortcuts.
import { describe, it, expect } from 'vitest';
import { SHORTCUTS, formatShortcuts } from '../src/app/shortcuts.js';

describe('shortcuts', () => {
  it('has shortcuts', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(5);
  });

  it('each has key, action, context', () => {
    for (const s of SHORTCUTS) {
      expect(s.key).toBeTruthy();
      expect(s.action).toBeTruthy();
      expect(s.context).toBeTruthy();
    }
  });

  it('formats for display', () => {
    const f = formatShortcuts();
    expect(f[0]).toContain(':');
  });

  it('includes taunt', () => {
    expect(SHORTCUTS.some(s => s.key === 'T')).toBe(true);
  });
});
