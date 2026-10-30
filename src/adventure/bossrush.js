// bossrush.js — boss rush mode for Expedition.
//
// Spawn all 3 bosses in sequence. Survive them all for a reward.

import { BOSS_TYPES } from './invasions.js';

export const BOSS_RUSH_ORDER = ['grumblor', 'skitter', 'mudking'];

export class BossRush {
  constructor() {
    this.active = false;
    this.index = 0;
    this.defeated = [];
    this.startTime = 0;
    this.timed = false;
  }

  /** Start the rush. Returns the first boss. */
  start(timed = false) {
    this.active = true;
    this.index = 0;
    this.defeated = [];
    this.timed = timed;
    this.startTime = Date.now();
    return this.currentBoss();
  }

  /** The current boss, or null if the rush is over. */
  currentBoss() {
    if (!this.active || this.index >= BOSS_RUSH_ORDER.length) return null;
    return BOSS_TYPES[BOSS_RUSH_ORDER[this.index]];
  }

  /**
   * Record a boss defeat. Returns the next boss, 'complete', or {complete, time}.
   * @param {string} bossId
   */
  defeat(bossId) {
    if (!this.active) return null;
    this.defeated.push(bossId);
    this.index++;
    if (this.index >= BOSS_RUSH_ORDER.length) {
      this.active = false;
      if (this.timed) {
        const time = (Date.now() - this.startTime) / 1000;
        return { complete: true, time };
      }
      return 'complete';
    }
    return this.currentBoss();
  }

  /** Progress: {defeated, total}. */
  progress() {
    return { defeated: this.defeated.length, total: BOSS_RUSH_ORDER.length };
  }
}
