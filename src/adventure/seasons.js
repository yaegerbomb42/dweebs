// seasons.js — seasonal event framework for Expedition & Dynasty.
//
// The year is 12 days: 3 days each of spring, summer, autumn, winter.
// Seasons change the land (berry growth rates) and autumn brings the Harvest
// Festival: 2 days of celebration that lift the whole village's morale.
// Pure logic; the world wires growth multipliers and festival flags.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const DAYS_PER_SEASON = 3;

export const SEASON_INFO = {
  spring: { icon: '🌸', name: 'Spring', growth: 1.25, blurb: 'The meadow blooms — berries regrow faster.' },
  summer: { icon: '☀️', name: 'Summer', growth: 1.0, blurb: 'Long warm days on the meadow.' },
  autumn: { icon: '🍂', name: 'Autumn', growth: 1.0, blurb: 'Harvest time approaches…' },
  winter: { icon: '❄️', name: 'Winter', growth: 0.5, blurb: 'Cold winds — berries are scarce.' },
};

// 2.0: Season-specific gameplay effects.
export const SEASON_EFFECTS = {
  spring: { moveMul: 1.0, healMul: 1.5, workMul: 1.0, desc: 'Faster healing' },
  summer: { moveMul: 1.0, healMul: 1.0, workMul: 1.25, desc: 'Longer work days' },
  autumn: { moveMul: 1.0, healMul: 1.0, workMul: 1.0, harvestMul: 2.0, desc: 'Double harvest' },
  winter: { moveMul: 0.7, healMul: 0.8, workMul: 0.9, desc: 'Cold slows everyone' },
};

/** Get the effect multipliers for a season. */
export function seasonEffects(season) {
  return SEASON_EFFECTS[season] || SEASON_EFFECTS.summer;
}

export const FESTIVAL = {
  id: 'harvest', name: 'Harvest Festival', icon: '🎃',
  durationDays: 2, growth: 1.5,
  blurb: 'Two days of feasting, singing, and joy! (+morale, +berry growth)',
};

export class SeasonManager {
  /**
   * @param {object} opts
   * @param {number} opts.dayLength seconds per full day
   * @param {() => number} opts.rng
   */
  constructor(opts = {}) {
    this.dayLength = opts.dayLength ?? 240;
    this.rng = opts.rng ?? Math.random;
    this.day = 0;
    this.festivalDaysLeft = 0;
    this.festivalsHeld = 0;
    this._lastSeason = this.season;
  }

  get season() {
    return SEASONS[Math.floor(this.day / DAYS_PER_SEASON) % SEASONS.length];
  }

  get festivalActive() {
    return this.festivalDaysLeft > 0;
  }

  /** Cost in gold to throw a player-triggered festival. */
  static get FESTIVAL_COST() { return 50; }

  /**
   * Throw a festival: costs gold, 2 days of celebration.
   * @param {*} colony with resources.gold and spendResource
   * @returns {{ok, message}}
   */
  throwFestival(colony) {
    if (this.festivalActive) return { ok: false, message: 'A festival is already raging!' };
    const cost = SeasonManager.FESTIVAL_COST;
    const gold = colony?.resources?.gold || 0;
    if (gold < cost) return { ok: false, message: `Need 🪙 ${cost} to throw a festival.` };
    if (typeof colony.spendResource === 'function') colony.spendResource('gold', cost);
    else colony.resources.gold -= cost;
    this.festivalDaysLeft = 2;
    this.festivalsHeld++;
    colony?._addLog?.(`🎉 You threw a festival! 2 days of feasting!`);
    return { ok: true, message: '🎉 Festival thrown! 2 days of celebration!' };
  }

  /** Berry growth multiplier right now (season × festival). */
  growthMultiplier() {
    if (this.festivalActive) return FESTIVAL.growth;
    return SEASON_INFO[this.season].growth;
  }

  /**
   * @param {number} dt seconds
   * @param {object} ctx {colony, onEvent}
   */
  update(dt, ctx = {}) {
    const prevDay = Math.floor(this.day);
    this.day += dt / this.dayLength;
    // Festival countdown runs in days.
    if (this.festivalDaysLeft > 0) {
      this.festivalDaysLeft -= dt / this.dayLength;
      if (this.festivalDaysLeft <= 0) {
        this.festivalDaysLeft = 0;
        ctx.onEvent?.({ type: 'festivalEnd', festival: FESTIVAL.id });
        ctx.colony?._addLog(`${FESTIVAL.icon} The ${FESTIVAL.name} ends. Bellies full, hearts warm.`);
      }
    }
    if (Math.floor(this.day) <= prevDay) return;
    // ── a new day dawns ──
    const season = this.season;
    if (season !== this._lastSeason) {
      this._lastSeason = season;
      const info = SEASON_INFO[season];
      ctx.onEvent?.({ type: 'seasonChange', season });
      ctx.colony?._addLog(`${info.icon} ${info.name} arrives! ${info.blurb}`);
      // The Harvest Festival opens on the first day of autumn.
      if (season === 'autumn') this._startFestival(ctx);
    }
  }

  _startFestival(ctx) {
    this.festivalDaysLeft = FESTIVAL.durationDays;
    this.festivalsHeld++;
    ctx.onEvent?.({ type: 'festivalStart', festival: FESTIVAL.id });
    ctx.colony?._addLog(`${FESTIVAL.icon} ${FESTIVAL.name} begins! ${FESTIVAL.blurb}`);
  }

  serialize() {
    return {
      day: this.day,
      season: this.season,
      festivalDaysLeft: this.festivalDaysLeft,
      festivalsHeld: this.festivalsHeld,
    };
  }
}
