// forecast.test.js — weather forecast.
import { describe, it, expect } from 'vitest';
import { forecast, formatForecast } from '../src/adventure/forecast.js';

function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('weather forecast', () => {
  it('generates 3 days', () => {
    const f = forecast(() => 0.5);
    expect(f.length).toBe(3);
  });

  it('predicts disasters', () => {
    const f = forecast(seqRng([0.1, 0.5])); // 0.1 < 0.4 → disaster
    expect(f[0].disaster).not.toBe('Clear');
    expect(f[0].icon).toBeTruthy();
  });

  it('predicts clear days', () => {
    const f = forecast(() => 0.9); // 0.9 > 0.4 → clear
    expect(f[0].disaster).toBe('Clear');
    expect(f[0].icon).toBe('☀️');
  });

  it('formats for display', () => {
    const f = forecast(() => 0.9);
    const s = formatForecast(f);
    expect(s).toContain('Day 1');
    expect(s).toContain('Clear');
  });
});
