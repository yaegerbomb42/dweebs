// caravans.js — trading caravan visits in the expedition meadow.
//
// A merchant caravan arrives every few days: warning → 90s of trading →
// departs. Trades convert surplus resources (berries/wood) into gold and let
// gold buy hats for citizens. Pure logic; Meadowlands wires visuals + UI.

export const CARAVAN_WARNING_SECS = 30;
export const CARAVAN_TRADING_SECS = 90;

/** Trade offers. cost: what the colony pays; gain: what it receives. */
export const TRADE_OFFERS = [
  { id: 'sell-berries', label: 'Sell 15 🫐 → +8 🪙', cost: { berries: 15 }, gain: { gold: 8 } },
  { id: 'sell-wood', label: 'Sell 10 🪵 → +6 🪙', cost: { wood: 10 }, gain: { gold: 6 } },
  { id: 'sell-stone', label: 'Sell 8 🪨 → +7 🪙', cost: { stone: 8 }, gain: { gold: 7 } },
  { id: 'buy-hat', label: 'Buy 🎩 for 20 🪙', cost: { gold: 20 }, gain: { hats: 1 } },
];

export class CaravanManager {
  constructor() {
    this.state = 'idle'; // idle | warning | trading | departed
    this.timer = 0;
    this.nextIn = 3 * 24 * 60; // first caravan ~day 3 (game-seconds)
    this.tradesDone = 0;
  }

  /**
   * Advance the schedule.
   * @param {number} dt game-seconds
   * @param {{rng: function, onEvent: function}} ctx
   * @returns {string[]} events fired this tick
   */
  update(dt, ctx = {}) {
    const events = [];
    const emit = (type, data) => {
      events.push({ type, ...data });
      ctx.onEvent?.({ type, ...data });
    };
    if (this.state === 'idle') {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.state = 'warning';
        this.timer = CARAVAN_WARNING_SECS;
        emit('caravanWarning', { inSecs: CARAVAN_WARNING_SECS });
      }
    } else if (this.state === 'warning') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'trading';
        this.timer = CARAVAN_TRADING_SECS;
        emit('caravanArrived', {});
      }
    } else if (this.state === 'trading') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'departed';
        this.timer = 20;
        emit('caravanDeparted', { trades: this.tradesDone });
      }
    } else if (this.state === 'departed') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'idle';
        // Next visit in 3–6 days.
        const r = typeof ctx.rng === 'function' ? ctx.rng() : Math.random();
        this.nextIn = (3 + r * 3) * 24 * 60;
        this.tradesDone = 0;
      }
    }
    return events;
  }

  get isTrading() { return this.state === 'trading'; }
  get tradingTimeLeft() { return this.state === 'trading' ? Math.max(0, this.timer) : 0; }

  /** Offers the colony can currently afford. */
  affordableOffers(colony) {
    const res = colony?.resources || {};
    return TRADE_OFFERS.filter(o =>
      Object.entries(o.cost).every(([k, v]) => (res[k] || 0) >= v)
    );
  }

  /**
   * Execute a trade. Returns {ok, message}.
   * @param {*} colony with resources + spendResource/addResource
   * @param {string} offerId
   */
  trade(colony, offerId) {
    const offer = TRADE_OFFERS.find(o => o.id === offerId);
    if (!offer) return { ok: false, message: 'No such offer.' };
    if (this.state !== 'trading') return { ok: false, message: 'No caravan to trade with.' };
    const res = colony?.resources || {};
    for (const [k, v] of Object.entries(offer.cost)) {
      if ((res[k] || 0) < v) return { ok: false, message: 'Not enough resources.' };
    }
    for (const [k, v] of Object.entries(offer.cost)) {
      if (typeof colony.spendResource === 'function') colony.spendResource(k, v);
      else res[k] -= v;
    }
    for (const [k, v] of Object.entries(offer.gain)) {
      if (typeof colony.addResource === 'function') colony.addResource(k, v);
      else res[k] = (res[k] || 0) + v;
    }
    this.tradesDone++;
    return { ok: true, message: `Traded: ${offer.label}` };
  }

  serialize() {
    return { state: this.state, timer: this.timer, nextIn: this.nextIn, tradesDone: this.tradesDone };
  }

  deserialize(s) {
    if (!s) return;
    this.state = s.state || 'idle';
    this.timer = s.timer || 0;
    this.nextIn = s.nextIn ?? this.nextIn;
    this.tradesDone = s.tradesDone || 0;
  }
}
