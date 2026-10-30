// randomizer.test.js — builder part randomizer.
import { describe, it, expect } from 'vitest';
import { randomConfig } from '../src/builder/randomizer.js';
import {
  BODY_SHAPES, APPENDAGES, FEET_TYPES, BROW_STYLES, MOUTH_STYLES,
  ELEMENTAL_PALETTES,
} from '../src/builder/CustomDweebModel.js';

function seqRng() {
  let i = 0;
  return () => (i++ % 100) / 100;
}

describe('part randomizer', () => {
  it('generates a valid config', () => {
    const c = randomConfig(seqRng());
    expect(BODY_SHAPES).toContain(c.bodyShape);
    expect(FEET_TYPES).toContain(c.feet);
    expect(BROW_STYLES).toContain(c.brows);
    expect(MOUTH_STYLES).toContain(c.mouth);
    expect(Object.keys(ELEMENTAL_PALETTES)).toContain(c.palette);
  });

  it('picks two appendages', () => {
    const c = randomConfig(seqRng());
    expect(c.appendages.length).toBe(2);
    for (const a of c.appendages) expect(APPENDAGES).toContain(a);
  });

  it('generates a name', () => {
    const c = randomConfig(seqRng());
    expect(c.name).toBeTruthy();
    expect(typeof c.name).toBe('string');
  });

  it('is actually random (different seeds differ)', () => {
    const a = randomConfig(() => 0.1);
    const b = randomConfig(() => 0.9);
    // Different rng values should give different configs (at least sometimes).
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    expect(sa === sb).toBe(false);
  });
});
