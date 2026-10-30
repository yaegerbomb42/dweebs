// combos.test.js — KO combo system.
import { describe, it, expect } from 'vitest';
import { COMBO_WINDOW, ComboTracker } from '../src/sim/combos.js';

describe('KO combos', () => {
  it('starts at zero', () => {
    const c = new ComboTracker();
    expect(c.combo).toBe(0);
  });

  it('chains KOs in window', () => {
    const c = new ComboTracker();
    c.ko(0);
    c.ko(3); // within 5s
    expect(c.combo).toBe(2);
  });

  it('resets after window', () => {
    const c = new ComboTracker();
    c.ko(0);
    c.ko(10); // after 5s
    expect(c.combo).toBe(1);
  });

  it('tracks best', () => {
    const c = new ComboTracker();
    c.ko(0); c.ko(1); c.ko(2);
    c.ko(10);
    expect(c.best).toBe(3);
  });

  it('bonus scales', () => {
    const c = new ComboTracker();
    c.ko(0); c.ko(1);
    expect(c.bonus()).toBe(10);
    c.ko(2);
    expect(c.bonus()).toBe(20);
  });

  it('names combos', () => {
    const c = new ComboTracker();
    c.ko(0); c.ko(1);
    expect(c.name()).toBe('DOUBLE KO!');
    c.ko(2);
    expect(c.name()).toBe('TRIPLE KO!');
  });

  it('no bonus for single', () => {
    const c = new ComboTracker();
    c.ko(0);
    expect(c.bonus()).toBe(0);
    expect(c.name()).toBe('');
  });
});
