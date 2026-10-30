// HypeMeter.js — crowd hype meter for the legacy arena game.
//
// Hype 0..100 builds on exciting moments (KOs, trickshots, style) and decays
// over time. Crossing a level threshold (20/40/60/80) fires onLevelUp; hitting
// max triggers pandemonium. The sim has its own deterministic Crowd; this is
// the juicy view-layer twin for live play.

export const HYPE_LEVELS = [20, 40, 60, 80];
export const HYPE_DECAY_PER_SEC = 3;

export class HypeMeter {
  constructor() {
    this.hype = 0;
    this.level = 0;
    this.maxed = false; // latched while at pandemonium
  }

  /** Add hype; returns the new level if a threshold was crossed upward, else 0. */
  add(n) {
    this.hype = Math.max(0, Math.min(100, this.hype + n));
    let level = 0;
    for (let i = 0; i < HYPE_LEVELS.length; i++) if (this.hype >= HYPE_LEVELS[i]) level = i + 1;
    if (level > this.level) {
      this.level = level;
      if (level >= 4) this.maxed = true;
      return level;
    }
    return 0;
  }

  /** Decay over time; returns true on the tick pandemonium ends. */
  update(dt) {
    if (this.hype <= 0) return false;
    this.hype = Math.max(0, this.hype - HYPE_DECAY_PER_SEC * dt);
    let level = 0;
    for (let i = 0; i < HYPE_LEVELS.length; i++) if (this.hype >= HYPE_LEVELS[i]) level = i + 1;
    this.level = level;
    if (this.maxed && level < 4) {
      this.maxed = false;
      return true; // pandemonium ended
    }
    return false;
  }

  reset() {
    this.hype = 0;
    this.level = 0;
    this.maxed = false;
  }
}
