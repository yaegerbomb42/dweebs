// caravans.test.js — trading caravan schedule, offers, trades.
import { describe, it, expect } from 'vitest';
import { CaravanManager, TRADE_OFFERS, CARAVAN_WARNING_SECS, CARAVAN_TRADING_SECS } from '../src/adventure/caravans.js';

function fakeColony(resources = {}) {
  const res = { wood: 0, berries: 0, stone: 0, gold: 0, ...resources };
  return {
    resources: res,
    spendResource: (k, n) => { res[k] -= n; },
    addResource: (k, n) => { res[k] = (res[k] || 0) + n; },
    _addLog: () => {},
  };
}

describe('CaravanManager', () => {
  it('schedules the first caravan ~day 3', () => {
    const c = new CaravanManager();
    expect(c.state).toBe('idle');
    expect(c.nextIn).toBeGreaterThan(0);
  });

  it('warning → trading → departed → idle', () => {
    const c = new CaravanManager();
    c.nextIn = 1;
    const seen = [];
    const ctx = { rng: () => 0.5, onEvent: e => seen.push(e.type) };
    c.update(2, ctx); // idle → warning
    expect(c.state).toBe('warning');
    expect(seen).toContain('caravanWarning');
    c.update(CARAVAN_WARNING_SECS + 1, ctx); // warning → trading
    expect(c.state).toBe('trading');
    expect(seen).toContain('caravanArrived');
    expect(c.isTrading).toBe(true);
    c.update(CARAVAN_TRADING_SECS + 1, ctx); // trading → departed
    expect(c.state).toBe('departed');
    expect(seen).toContain('caravanDeparted');
    c.update(25, ctx); // departed → idle
    expect(c.state).toBe('idle');
    expect(c.nextIn).toBeGreaterThan(0);
  });

  it('trades berries for gold', () => {
    const c = new CaravanManager();
    c.state = 'trading'; c.timer = 60;
    const colony = fakeColony({ berries: 20, gold: 0 });
    const r = c.trade(colony, 'sell-berries');
    expect(r.ok).toBe(true);
    expect(colony.resources.berries).toBe(5);
    expect(colony.resources.gold).toBe(8);
    expect(c.tradesDone).toBe(1);
  });

  it('refuses unaffordable trades', () => {
    const c = new CaravanManager();
    c.state = 'trading'; c.timer = 60;
    const colony = fakeColony({ berries: 5 });
    const r = c.trade(colony, 'sell-berries');
    expect(r.ok).toBe(false);
    expect(colony.resources.berries).toBe(5);
  });

  it('refuses trades when no caravan', () => {
    const c = new CaravanManager();
    const colony = fakeColony({ berries: 50 });
    expect(c.trade(colony, 'sell-berries').ok).toBe(false);
  });

  it('affordableOffers filters by resources', () => {
    const c = new CaravanManager();
    const colony = fakeColony({ berries: 20, wood: 5, gold: 30 });
    const ids = c.affordableOffers(colony).map(o => o.id);
    expect(ids).toContain('sell-berries');
    expect(ids).not.toContain('sell-wood'); // only 5 wood
    expect(ids).toContain('buy-hat'); // 30 gold
  });

  it('serializes round-trip', () => {
    const c = new CaravanManager();
    c.state = 'trading'; c.timer = 42; c.tradesDone = 3;
    const d = new CaravanManager();
    d.deserialize(c.serialize());
    expect(d.state).toBe('trading');
    expect(d.timer).toBe(42);
    expect(d.tradesDone).toBe(3);
  });

  it('has sane offers', () => {
    expect(TRADE_OFFERS.length).toBeGreaterThanOrEqual(4);
    for (const o of TRADE_OFFERS) {
      expect(o.id).toBeTruthy();
      expect(o.label).toBeTruthy();
    }
  });
});
