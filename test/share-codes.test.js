// share-codes.test.js — blueprint share codes round-trip.
import { describe, it, expect } from 'vitest';
import { SHARE_PREFIX, encodeConfig, decodeConfig } from '../src/builder/shareCodes.js';

const SAMPLE = {
  body: 'cube', color: 'red',
  stats: { power: 5, speed: 3 },
  dna: { horns: true },
};

describe('shareCodes', () => {
  it('encodes with the version prefix', () => {
    const code = encodeConfig(SAMPLE);
    expect(code.startsWith(SHARE_PREFIX)).toBe(true);
    expect(code.length).toBeGreaterThan(SHARE_PREFIX.length + 10);
  });

  it('round-trips a config', () => {
    const code = encodeConfig(SAMPLE);
    const back = decodeConfig(code);
    expect(back).toEqual(SAMPLE);
  });

  it('is URL-safe (no + / =)', () => {
    for (let i = 0; i < 20; i++) {
      const code = encodeConfig({ ...SAMPLE, seed: i * 997 });
      expect(code).not.toMatch(/[+/=]/);
    }
  });

  it('rejects malformed codes', () => {
    expect(decodeConfig('')).toBeNull();
    expect(decodeConfig('nope')).toBeNull();
    expect(decodeConfig('DW1.!!!')).toBeNull();
    expect(decodeConfig(null)).toBeNull();
    expect(decodeConfig(123)).toBeNull();
  });

  it('encode handles unicode names', () => {
    const cfg = { ...SAMPLE, name: 'Blorp 👹' };
    expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
  });

  it('encode returns empty on unserializable input', () => {
    const circular = {};
    circular.self = circular;
    expect(encodeConfig(circular)).toBe('');
  });
});
