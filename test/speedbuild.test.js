// speedbuild.test.js — timed building challenges.
import { describe, it, expect } from 'vitest';
import { CHALLENGES, SpeedBuild } from '../src/builder/speedbuild.js';

describe('speed build', () => {
  it('has 3 challenges', () => {
    expect(CHALLENGES.length).toBe(3);
  });

  it('starts a challenge', () => {
    const s = new SpeedBuild();
    const c = s.start('speedy');
    expect(c.name).toBe('Speedy');
    expect(s.active).toBe(true);
  });

  it('rejects unknown challenges', () => {
    const s = new SpeedBuild();
    expect(s.start('nope')).toBeNull();
  });

  it('completes fast builds', () => {
    const s = new SpeedBuild();
    s.start('blitz');
    expect(s.completeBuild()).toBe('complete');
    expect(s.active).toBe(false);
  });

  it('tracks remaining time', () => {
    const s = new SpeedBuild();
    s.start('speedy');
    const r = s.remaining();
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(60);
  });

  it('marathon needs 3 builds', () => {
    const s = new SpeedBuild();
    s.start('marathon');
    expect(s.completeBuild()).toBeNull();
    expect(s.completeBuild()).toBeNull();
    expect(s.completeBuild()).toBe('complete');
  });
});
