// expedition-invasions.test.js — boss invasion events: scheduling, warning,
// boss AI, structure attacks, victory loot, retreat, persistence.
import { describe, it, expect } from 'vitest';
import { BOSS_TYPES, InvasionManager } from '../src/adventure/invasions.js';

function makeCtx(overrides = {}) {
  const logs = [];
  const colony = {
    citizens: [{}, {}, {}],
    resources: { gold: 0, stone: 0, wood: 0, berries: 0 },
    _addLog: (m) => logs.push(m),
    addResource(res, n) { this.resources[res] = (this.resources[res] || 0) + n; },
  };
  const critters = [];
  const events = [];
  const structureList = [{ x: 5, z: 0, hp: 30, label: 'hut', destroyed: false }];
  const ctx = {
    colony, critters, events, logs,
    structures: structureList, logs,
    spawnBoss: (type) => {
      const c = { kind: 'boss', bossType: type.id, x: 40, z: 0, hp: type.hp, maxHp: type.hp, hostile: true };
      critters.push(c);
      return c;
    },
    removeCritter: (c) => { const i = critters.indexOf(c); if (i >= 0) critters.splice(i, 1); },
    structures: () => structureList,
    damageStructure: (s, n) => { s.hp -= n; if (s.hp <= 0) s.destroyed = true; },
    onEvent: (e) => events.push(e),
    ...overrides,
  };
  return ctx;
}

/** Deterministic rng: always picks the first boss (grumblor). */
const rng0 = () => 0;

describe('boss table', () => {
  it('has 3 distinct bosses with sane stats', () => {
    const ids = Object.keys(BOSS_TYPES);
    expect(ids.length).toBe(3);
    for (const b of Object.values(BOSS_TYPES)) {
      expect(b.hp).toBeGreaterThan(0);
      expect(b.speed).toBeGreaterThan(0);
      expect(b.dmg).toBeGreaterThan(0);
      expect(Object.keys(b.loot).length).toBeGreaterThan(0);
      expect(b.name.length).toBeGreaterThan(0);
    }
  });
});

describe('invasion scheduling', () => {
  it('stays idle before the timer', () => {
    const m = new InvasionManager({ firstInvasionAt: 100, rng: rng0 });
    const ctx = makeCtx();
    m.update(50, ctx);
    expect(m.state).toBe('idle');
    expect(ctx.events.length).toBe(0);
  });

  it('does not invade a tiny settlement', () => {
    const m = new InvasionManager({ firstInvasionAt: 10, rng: rng0 });
    const ctx = makeCtx({ colony: { ...makeCtx().colony, citizens: [{}] } });
    m.update(11, ctx);
    expect(m.state).toBe('idle');
  });

  it('warns when the timer fires', () => {
    const m = new InvasionManager({ firstInvasionAt: 10, warnTime: 30, rng: rng0 });
    const ctx = makeCtx();
    m.update(11, ctx);
    expect(m.state).toBe('warned');
    expect(m.bossType.id).toBe('grumblor');
    expect(ctx.events.some(e => e.type === 'invasionWarn')).toBe(true);
    expect(ctx.logs.some(l => l.includes('approaches'))).toBe(true);
  });

  it('spawns the boss after the warning', () => {
    const m = new InvasionManager({ firstInvasionAt: 10, warnTime: 5, rng: rng0 });
    const ctx = makeCtx();
    m.update(11, ctx); // -> warned
    m.update(6, ctx);  // -> active
    expect(m.state).toBe('active');
    expect(ctx.critters.length).toBe(1);
    expect(ctx.critters[0].kind).toBe('boss');
    expect(ctx.critters[0].hostile).toBe(true);
    expect(ctx.events.some(e => e.type === 'invasionSpawn')).toBe(true);
  });
});

describe('boss behaviour', () => {
  function activeManager() {
    const m = new InvasionManager({ firstInvasionAt: 1, warnTime: 1, rng: rng0 });
    const ctx = makeCtx();
    m.update(2, ctx);
    m.update(2, ctx);
    expect(m.state).toBe('active');
    return { m, ctx };
  }

  it('stomps toward the nearest structure', () => {
    const { m, ctx } = activeManager();
    const boss = m.bossCritter;
    const x0 = boss.x;
    m.update(1, ctx);
    expect(boss.x).toBeLessThan(x0); // structure at x=5, boss at x=40
  });

  it('attacks structures in range', () => {
    const { m, ctx } = activeManager();
    const boss = m.bossCritter;
    boss.x = 6; boss.z = 0; // inside grumblor's 3.5 range of the hut at x=5
    const hut = ctx.structures()[0];
    const hp0 = hut.hp;
    m.update(3, ctx); // past the 2.5s attack interval
    expect(ctx.structures()[0].hp).toBeLessThan(hp0);
    expect(ctx.events.some(e => e.type === 'invasionHit')).toBe(true);
  });

  it('victory pays loot when the boss dies', () => {
    const { m, ctx } = activeManager();
    m.bossCritter.hp = 0; // defenders did their job
    m.update(0.1, ctx);
    expect(m.state).toBe('idle');
    expect(ctx.colony.resources.gold).toBeGreaterThan(0);
    expect(ctx.events.some(e => e.type === 'invasionVictory')).toBe(true);
    expect(ctx.logs.some(l => l.includes('DEFEATED'))).toBe(true);
    expect(m.invasionsSeen).toBe(1);
  });

  it('victory also triggers when the critter is removed', () => {
    const { m, ctx } = activeManager();
    ctx.removeCritter(m.bossCritter);
    m.update(0.1, ctx);
    expect(m.state).toBe('idle');
    expect(ctx.events.some(e => e.type === 'invasionVictory')).toBe(true);
  });

  it('retreats after smashing 3 structures', () => {
    const m = new InvasionManager({ firstInvasionAt: 1, warnTime: 1, rng: rng0 });
    const ctx = makeCtx();
    ctx.structures().push(
      { x: 6, z: 1, hp: 5, label: 'shed', destroyed: false },
      { x: 4, z: -1, hp: 5, label: 'tent', destroyed: false },
    );
    m.update(2, ctx); m.update(2, ctx);
    const boss = m.bossCritter;
    boss.x = 5; boss.z = 0;
    // Grumblor does 8 dmg per 2.5s; structures have 5-30 hp. Smash them all.
    for (let t = 0; t < 60 && m.state === 'active'; t++) m.update(1, ctx);
    expect(m.state).toBe('idle');
    expect(ctx.events.some(e => e.type === 'invasionRetreat')).toBe(true);
    expect(ctx.critters.length).toBe(0); // boss removed
  });

  it('retreats when the boredom timer expires', () => {
    const m = new InvasionManager({ firstInvasionAt: 1, warnTime: 1, maxActiveTime: 5, rng: rng0 });
    const ctx = makeCtx();
    ctx.structures().length = 0; // nothing to smash
    m.update(2, ctx); m.update(2, ctx);
    m.update(6, ctx);
    expect(m.state).toBe('idle');
    expect(ctx.events.some(e => e.type === 'invasionRetreat')).toBe(true);
  });

  it('schedules the next invasion after resolution', () => {
    const m = new InvasionManager({ firstInvasionAt: 1, warnTime: 1, minInterval: 100, maxInterval: 100, rng: rng0 });
    const ctx = makeCtx();
    m.update(2, ctx); m.update(2, ctx);
    m.bossCritter.hp = 0;
    m.update(0.1, ctx);
    expect(m.nextIn).toBe(100);
  });
});

describe('invasion persistence', () => {
  it('serialize captures the state machine', () => {
    const m = new InvasionManager({ firstInvasionAt: 50, rng: rng0 });
    const ctx = makeCtx();
    m.update(10, ctx);
    const s = m.serialize();
    expect(s.state).toBe('idle');
    expect(s.nextIn).toBeLessThan(50);
    expect(s.invasionsSeen).toBe(0);
    m.update(41, ctx);
    const s2 = m.serialize();
    expect(s2.state).toBe('warned');
    expect(s2.bossType).toBe('grumblor');
  });
});
