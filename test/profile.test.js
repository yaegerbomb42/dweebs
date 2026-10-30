// profile.test.js — hub profile customization.
import { describe, it, expect, beforeEach } from 'vitest';
import { PROFILE_KEY, AVATARS, TITLES, getProfile, updateProfile } from '../src/app/profile.js';

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

describe('profile customization', () => {
  it('has defaults', () => {
    const p = getProfile();
    expect(p.name).toBe('Player');
    expect(AVATARS).toContain(p.avatar);
    expect(TITLES).toContain(p.title);
  });

  it('updates name', () => {
    const p = updateProfile({ name: 'Ziggy' });
    expect(p.name).toBe('Ziggy');
    expect(getProfile().name).toBe('Ziggy');
  });

  it('validates avatar', () => {
    const p = updateProfile({ avatar: '💩' });
    expect(AVATARS).toContain(p.avatar);
  });

  it('validates title', () => {
    const p = updateProfile({ title: 'Nope' });
    expect(p.title).toBe('Rookie');
  });

  it('trims and limits name', () => {
    const p = updateProfile({ name: '  A very long name indeed  ' });
    expect(p.name.length).toBeLessThanOrEqual(20);
    expect(p.name.startsWith('A')).toBe(true);
  });

  it('persists to storage', () => {
    updateProfile({ name: 'Test' });
    const raw = globalThis.localStorage.getItem(PROFILE_KEY);
    expect(raw).toContain('Test');
  });
});
