// seasons.test.js — seasonal framework: year cycle, growth multipliers,
// harvest festival scheduling, events, persistence.
import { describe, it, expect } from 'vitest';
import { SEASONS, DAYS_PER_SEASON, SEASON_INFO, FESTIVAL, SeasonManager } from '../src/adventure/seasons.js';

function makeCtx() {
  const logs = [];
  const events = [];
  return {
    logs, events,
    colony: { _addLog: (m) => logs.push(m) },
    onEvent: (e) => events.push(e),
  };
}

describe('season table', () => {
  it('has 4 seasons with growth numbers', () => {
    expect(SEASONS).toEqual(['spring', 'summer', 'autumn', 'winter']);
    for (const s of SEASONS) {
      expect(SEASON_INFO[s].growth).toBeGreaterThan(0);
    }
    expect(SEASON_INFO.winter.growth).toBeLessThan(SEASON_INFO.spring.growth);
  });
});

describe('SeasonManager', () => {
  it('starts in spring', () => {
    const m = new SeasonManager({ dayLength: 100 });
    expect(m.season).toBe('spring');
    expect(m.festivalActive).toBe(false);
  });

  it('advances seasons every 3 days', () => {
    const m = new SeasonManager({ dayLength: 100 });
    const ctx = makeCtx();
    m.update(301, ctx); // just over 3 days
    expect(m.season).toBe('summer');
    expect(ctx.events.some(e => e.type === 'seasonChange' && e.season === 'summer')).toBe(true);
    expect(ctx.logs.some(l => l.includes('Summer'))).toBe(true);
  });

  it('wraps the year back to spring', () => {
    const m = new SeasonManager({ dayLength: 100 });
    m.update(1201, makeCtx()); // 12 days
    expect(m.season).toBe('spring');
  });

  it('starts the harvest festival on the first day of autumn', () => {
    const m = new SeasonManager({ dayLength: 100 });
    const ctx = makeCtx();
    m.update(601, ctx); // 6 days → autumn
    expect(m.season).toBe('autumn');
    expect(m.festivalActive).toBe(true);
    expect(m.festivalsHeld).toBe(1);
    expect(ctx.events.some(e => e.type === 'festivalStart')).toBe(true);
    expect(ctx.logs.some(l => l.includes('Harvest Festival'))).toBe(true);
  });

  it('festival boosts growth and ends after 2 days', () => {
    const m = new SeasonManager({ dayLength: 100 });
    const ctx = makeCtx();
    m.update(601, ctx);
    expect(m.growthMultiplier()).toBe(FESTIVAL.growth);
    m.update(201, ctx); // festival over
    expect(m.festivalActive).toBe(false);
    expect(ctx.events.some(e => e.type === 'festivalEnd')).toBe(true);
    expect(m.growthMultiplier()).toBe(SEASON_INFO.autumn.growth);
  });

  it('winter slows growth, spring quickens it', () => {
    const m = new SeasonManager({ dayLength: 100 });
    const ctx = makeCtx();
    expect(m.growthMultiplier()).toBe(SEASON_INFO.spring.growth);
    m.update(901, ctx); // 9 days → winter
    expect(m.season).toBe('winter');
    expect(m.growthMultiplier()).toBe(SEASON_INFO.winter.growth);
  });

  it('serialize captures state', () => {
    const m = new SeasonManager({ dayLength: 100 });
    m.update(650, makeCtx());
    const s = m.serialize();
    expect(s.season).toBe('autumn');
    expect(s.festivalDaysLeft).toBeGreaterThan(0);
    expect(s.festivalsHeld).toBe(1);
  });
});

describe('player-triggered festivals', () => {
  function colony(gold) {
    const res = { gold };
    return {
      resources: res,
      spendResource: (k, n) => { res[k] -= n; },
      _addLog: () => {},
    };
  }

  it('throwFestival costs gold and starts the party', () => {
    const s = new SeasonManager();
    const c = colony(100);
    const r = s.throwFestival(c);
    expect(r.ok).toBe(true);
    expect(c.resources.gold).toBe(50);
    expect(s.festivalActive).toBe(true);
    expect(s.festivalsHeld).toBe(1);
  });

  it('refuses without enough gold', () => {
    const s = new SeasonManager();
    const c = colony(10);
    const r = s.throwFestival(c);
    expect(r.ok).toBe(false);
    expect(c.resources.gold).toBe(10);
    expect(s.festivalActive).toBe(false);
  });

  it('refuses during an active festival', () => {
    const s = new SeasonManager();
    const c = colony(200);
    s.throwFestival(c);
    const r = s.throwFestival(c);
    expect(r.ok).toBe(false);
    expect(c.resources.gold).toBe(150); // only charged once
  });
});
