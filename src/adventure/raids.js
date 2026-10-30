// raids.js — night raids for Expedition & Dynasty.
//
// When night falls, a band of thieves may slink in together to loot the
// village. A warning goes out at dusk; the raid spawns 3-5 thieves that the
// village's Defenders (and plush cannons) fight with the existing combat.
// Repel them all for a gold bonus and a morale lift. Pure logic, fully tested.

export class NightRaidManager {
  /**
   * @param {object} opts
   * @param {number} opts.warnTime seconds of warning before the raid
   * @param {number} opts.raidChance chance of a raid each nightfall
   * @param {number} opts.maxActiveTime seconds before the raid disperses
   * @param {() => number} opts.rng
   */
  constructor(opts = {}) {
    this.warnTime = opts.warnTime ?? 20;
    this.raidChance = opts.raidChance ?? 0.4;
    this.maxActiveTime = opts.maxActiveTime ?? 180;
    this.rng = opts.rng ?? Math.random;
    this.state = 'idle'; // idle | warned | active
    this.timer = 0;
    this.raiders = [];
    this.raidsSeen = 0;
    this.raidsRepelled = 0;
    this._wasNight = false;
  }

  /**
   * @param {number} dt seconds
   * @param {object} ctx
   * @param {boolean} ctx.isNight
   * @param {object} ctx.colony
   * @param {() => object} ctx.spawnThief spawn one thief critter, return it
   * @param {object[]} ctx.critters live critter list
   * @param {(e) => void} ctx.onEvent
   */
  update(dt, ctx) {
    const isNight = !!ctx.isNight;
    // Nightfall trigger.
    if (this.state === 'idle') {
      if (isNight && !this._wasNight) {
        const citizens = ctx.colony?.citizens?.length ?? 0;
        if (citizens >= 2 && this.rng() < this.raidChance) {
          this.state = 'warned';
          this.timer = this.warnTime;
          ctx.onEvent?.({ type: 'raidWarn', seconds: this.warnTime });
          ctx.colony._addLog('🌙 Shadows move at the treeline… raiders gather in the dark! Man the defenses!');
        }
      }
      this._wasNight = isNight;
      return;
    }
    this._wasNight = isNight;
    if (this.state === 'warned') {
      this.timer -= dt;
      if (this.timer <= 0) {
        const n = 3 + Math.floor(this.rng() * 3); // 3-5 raiders
        this.raiders = [];
        for (let i = 0; i < n; i++) {
          const c = ctx.spawnThief();
          if (c) this.raiders.push(c);
        }
        this.state = 'active';
        this.timer = this.maxActiveTime;
        this.raidsSeen++;
        ctx.onEvent?.({ type: 'raidStart', raiders: n });
        ctx.colony._addLog(`🥷 A night raid! ${n} thieves slink toward the village!`);
      }
      return;
    }
    // ── active: raid ends when all raiders are gone (dead or fled) ──
    this.raiders = this.raiders.filter(c => ctx.critters.includes(c));
    this.timer -= dt;
    if (this.raiders.length === 0) {
      this.raidsRepelled++;
      const bonus = 3;
      if (typeof ctx.colony.addResource === 'function') ctx.colony.addResource('gold', bonus);
      else ctx.colony.resources.gold = (ctx.colony.resources.gold || 0) + bonus;
      ctx.onEvent?.({ type: 'raidRepelled', bonus });
      ctx.colony._addLog(`🎉 The night raid was repelled! The village shares the spoils: +${bonus} 🪙.`);
      this._reset();
      return;
    }
    if (this.timer <= 0) {
      ctx.onEvent?.({ type: 'raidDispersed' });
      ctx.colony._addLog('🌙 The raiders melt back into the dark…');
      this._reset();
    }
  }

  _reset() {
    this.state = 'idle';
    this.raiders = [];
  }

  serialize() {
    return {
      state: this.state,
      raidsSeen: this.raidsSeen,
      raidsRepelled: this.raidsRepelled,
    };
  }
}
