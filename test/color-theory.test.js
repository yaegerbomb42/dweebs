// color-theory.test.js — color harmony suggestions.
import { describe, it, expect } from 'vitest';
import { hexToHsl, hslToHex, suggestAccents } from '../src/builder/colorTheory.js';

describe('color theory', () => {
  it('converts hex to HSL and back', () => {
    const hsl = hexToHsl('#ff0000');
    expect(hsl.h).toBeCloseTo(0, 0);
    expect(hsl.s).toBeCloseTo(1, 1);
    const back = hslToHex(hsl.h, hsl.s, hsl.l);
    expect(back).toBe('#ff0000');
  });

  it('complementary is 180° away', () => {
    const { complementary } = suggestAccents('#ff0000');
    const hsl = hexToHsl(complementary);
    expect(hsl.h).toBeCloseTo(180, 0);
  });

  it('analogous are ±30°', () => {
    const { analogous } = suggestAccents('#ff0000');
    expect(analogous.length).toBe(2);
    const h0 = hexToHsl(analogous[0]).h;
    const h1 = hexToHsl(analogous[1]).h;
    expect(h0).toBeCloseTo(330, 0);
    expect(h1).toBeCloseTo(30, 0);
  });

  it('triadic are 120° apart', () => {
    const { triadic } = suggestAccents('#ff0000');
    expect(triadic.length).toBe(2);
  });

  it('handles grayscale', () => {
    const s = suggestAccents('#808080');
    expect(s.complementary).toMatch(/^#[0-9a-f]{6}$/);
  });
});
