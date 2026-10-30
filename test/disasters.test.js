// disasters.test.js — weather disasters: storm lightning, meteor strikes,
// starmetal payouts, structure damage, scheduling, persistence.
import { describe, it, expect } from 'vitest';
import { DISASTER_TYPES, DisasterManager } from '../src/adventure/disasters.js';

function makeCtx(structures = [{ x: 5, z: 0, hp: 40, label: 'hut' }]) {
  const logs = [];
  const colony = {
    resources: {},
    _addLog: (m) => logs.push(m),
    addResource(res, n) { this.resources[res] = (this.resources[res] || 0) + n; },
  };
  const events = [];
  const strikes = [];
  return {
    colony, logs, events, strikes,
    structures: () => structures,
    damageStructure: (s, n) => { s.hp -= n; },
    onStrike: (x, z, id) => strikes.push({ x, z, id }),
    onEvent: (e) => events.push(e),
  };
}

const rng0 = () => 0; // deterministic: first structure, min timers

describe('disaster table', () => {
  it('defines storm and meteor with sane numbers', () => {
    expect(Object.keys(DISASTER_TYPES)).toEqual(['storm', 'meteor']);
    for (const d of Object.values(DISASTER_TYPES)) {
      expect(d.duration).toBeGreaterThan(0);
      expect(d.strikeDamage).toBeGreaterThan(0);
    }
  });
});

describe('DisasterManager', () => {
  it('is idle until started', () => {
    const m = new DisasterManager({ rng: rng0 });
    const ctx = makeCtx();
    m.update(10, ctx);
    expect(m.isActive).toBe(false);
    expect(ctx.events.length).toBe(0);
  });

  it('start() announces the disaster', () => {
    const m = new DisasterManager({ rng: rng0 });
    const ctx = makeCtx();
    const type = m.start('storm', ctx);
    expect(type.id).toBe('storm');
    expect(m.isActive).toBe(true);
    expect(ctx.events.some(e => e.type === 'disasterStart')).toBe(true);
    expect(ctx.logs.some(l => l.includes('Thunderstorm'))).toBe(true);
  });

  it('storm lightning strikes structures', () => {
    const m = new DisasterManager({ rng: rng0 });
    const structs = [{ x: 5, z: 0, hp: 40, label: 'hut' }];
    const ctx = makeCtx(structs);
    m.start('storm', ctx);
    m.update(2, ctx); // past the 1.5s first-strike timer
    expect(ctx.strikes.length).toBe(1);
    expect(ctx.strikes[0].id).toBe('storm');
    expect(structs[0].hp).toBeLessThan(40);
    expect(ctx.events.some(e => e.type === 'disasterHit')).toBe(true);
  });

  it('storm destroys a weakened structure and logs it', () => {
    const m = new DisasterManager({ rng: rng0 });
    const structs = [{ x: 5, z: 0, hp: 5, label: 'shed' }];
    const ctx = makeCtx(structs);
    m.start('storm', ctx);
    m.update(2, ctx);
    expect(structs[0].hp).toBeLessThanOrEqual(0);
    expect(ctx.logs.some(l => l.includes('destroyed'))).toBe(true);
  });

  it('meteor strikes pay starmetal', () => {
    const m = new DisasterManager({ rng: rng0 });
    const ctx = makeCtx([]);
    m.start('meteor', ctx);
    m.update(2, ctx);
    expect(ctx.strikes.length).toBe(1);
    expect(ctx.colony.resources.starmetal).toBeGreaterThan(0);
    expect(ctx.logs.some(l => l.includes('starmetal'))).toBe(true);
  });

  it('meteor blast damages nearby structures', () => {
    const m = new DisasterManager({ rng: () => 0.999 }); // far edge... use rng0 for center-ish
    const structs = [{ x: 8, z: 0, hp: 40, label: 'hut' }];
    const ctx = makeCtx(structs);
    // Force the strike near the hut: rng 0 → angle 0, r = 8.
    const m2 = new DisasterManager({ rng: rng0 });
    m2.start('meteor', ctx);
    m2.update(2, ctx);
    // strike at (8, 0): hut at (8,0) is within blast radius 4.
    expect(structs[0].hp).toBeLessThan(40);
    expect(m).toBeDefined();
  });

  it('ends after its duration', () => {
    const m = new DisasterManager({ rng: rng0 });
    const ctx = makeCtx();
    m.start('storm', ctx);
    m.update(DISASTER_TYPES.storm.duration + 1, ctx);
    expect(m.isActive).toBe(false);
    expect(ctx.events.some(e => e.type === 'disasterEnd')).toBe(true);
  });

  it('strikes repeatedly while active', () => {
    const m = new DisasterManager({ rng: rng0 });
    const ctx = makeCtx([]);
    m.start('meteor', ctx);
    for (let t = 0; t < 30; t++) m.update(1, ctx);
    expect(ctx.strikes.length).toBeGreaterThan(2);
  });

  it('serialize captures state', () => {
    const m = new DisasterManager({ rng: rng0 });
    const ctx = makeCtx();
    expect(m.serialize().active).toBeNull();
    m.start('storm', ctx);
    const s = m.serialize();
    expect(s.active).toBe('storm');
    expect(s.timeLeft).toBeGreaterThan(0);
    expect(s.disastersSeen).toBe(1);
  });
});
