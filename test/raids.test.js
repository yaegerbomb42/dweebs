// raids.test.js — night raids: dusk trigger, warning, spawn, repel, disperse.
import { describe, it, expect } from 'vitest';
import { NightRaidManager } from '../src/adventure/raids.js';

function makeCtx() {
  const logs = [];
  const colony = {
    citizens: [{}, {}],
    resources: { gold: 0 },
    _addLog: (m) => logs.push(m),
    addResource(res, n) { this.resources[res] = (this.resources[res] || 0) + n; },
  };
  const critters = [];
  const events = [];
  return {
    colony, critters, logs, events,
    isNight: false,
    spawnThief: () => {
      const c = { kind: 'thief', hp: 2, hostile: true };
      critters.push(c);
      return c;
    },
    onEvent: (e) => events.push(e),
  };
}

const rng0 = () => 0; // always raids, 3 raiders

describe('NightRaidManager', () => {
  it('is idle during the day', () => {
    const m = new NightRaidManager({ rng: rng0 });
    const ctx = makeCtx();
    m.update(100, ctx);
    expect(m.state).toBe('idle');
  });

  it('warns at nightfall', () => {
    const m = new NightRaidManager({ rng: rng0, warnTime: 20 });
    const ctx = makeCtx();
    m.update(1, ctx); // day
    ctx.isNight = true;
    m.update(1, ctx); // nightfall
    expect(m.state).toBe('warned');
    expect(ctx.events.some(e => e.type === 'raidWarn')).toBe(true);
    expect(ctx.logs.some(l => l.includes('raiders gather'))).toBe(true);
  });

  it('does not raid a tiny settlement', () => {
    const m = new NightRaidManager({ rng: rng0 });
    const ctx = makeCtx();
    ctx.colony.citizens = [{}];
    ctx.isNight = true;
    m.update(1, ctx);
    m.update(1, ctx);
    expect(m.state).toBe('idle');
  });

  it('spawns raiders after the warning', () => {
    const m = new NightRaidManager({ rng: rng0, warnTime: 5 });
    const ctx = makeCtx();
    ctx.isNight = true;
    m.update(1, ctx);
    m.update(6, ctx);
    expect(m.state).toBe('active');
    expect(ctx.critters.length).toBe(3);
    expect(ctx.events.some(e => e.type === 'raidStart')).toBe(true);
    expect(m.raidsSeen).toBe(1);
  });

  it('repelled raid pays a gold bonus', () => {
    const m = new NightRaidManager({ rng: rng0, warnTime: 1 });
    const ctx = makeCtx();
    ctx.isNight = true;
    m.update(1, ctx);
    m.update(2, ctx);
    expect(m.state).toBe('active');
    ctx.critters.length = 0; // defenders bonked them all
    m.update(1, ctx);
    expect(m.state).toBe('idle');
    expect(m.raidsRepelled).toBe(1);
    expect(ctx.colony.resources.gold).toBe(3);
    expect(ctx.events.some(e => e.type === 'raidRepelled')).toBe(true);
  });

  it('tracks raiders killed mid-raid', () => {
    const m = new NightRaidManager({ rng: rng0, warnTime: 1 });
    const ctx = makeCtx();
    ctx.isNight = true;
    m.update(1, ctx);
    m.update(2, ctx);
    ctx.critters.pop(); // one down
    m.update(1, ctx);
    expect(m.state).toBe('active');
    expect(m.raiders.length).toBe(2);
  });

  it('disperses after the max time', () => {
    const m = new NightRaidManager({ rng: rng0, warnTime: 1, maxActiveTime: 10 });
    const ctx = makeCtx();
    ctx.isNight = true;
    m.update(1, ctx);
    m.update(2, ctx);
    m.update(11, ctx);
    expect(m.state).toBe('idle');
    expect(ctx.events.some(e => e.type === 'raidDispersed')).toBe(true);
  });

  it('only triggers on the nightfall edge, not every night tick', () => {
    const m = new NightRaidManager({ rng: () => 0.99, warnTime: 1 }); // 0.99 > chance
    const ctx = makeCtx();
    ctx.isNight = true;
    for (let i = 0; i < 10; i++) m.update(1, ctx);
    expect(m.state).toBe('idle');
  });

  it('serialize captures counts', () => {
    const m = new NightRaidManager({ rng: rng0, warnTime: 1 });
    const ctx = makeCtx();
    ctx.isNight = true;
    m.update(1, ctx);
    m.update(2, ctx);
    const s = m.serialize();
    expect(s.state).toBe('active');
    expect(s.raidsSeen).toBe(1);
  });
});
