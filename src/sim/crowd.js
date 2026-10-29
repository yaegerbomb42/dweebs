// src/sim/crowd.js — the arena crowd as a deterministic hype model.
//
// The view owns the visible crowd (meshes, chants, the wave). The sim owns the *reason* the
// crowd reacts: a hype meter 0..100 driven by the same events the view already drains. When
// hype crosses a level threshold (BALANCE.crowd.levels), the sim emits a 'hype' event and the
// view can cut to the crowd, swell the cheer track, or have the announcer ride the moment.
//
// Everything here is deterministic: no RNG, no wall clock — hype only moves on sim events
// and on the fixed tick dt. It is part of the snapshot, so a restored sim resumes mid-roar.

import { BALANCE } from '../game/Balance.js';
import { TICK_DT } from './contracts.js';

const C = BALANCE.crowd;

export class Crowd {
  constructor() {
    this.hype = 0;
    this.level = 0;
  }

  get levelName() { return C.names[this.level] ?? C.names[0]; }

  /**
   * React to one sim event. Returns a 'hype' event to emit when a level threshold was
   * crossed, or null. The 'hype' event itself is never fed back in (no recursion).
   */
  notice(type, e = {}) {
    let delta = 0;
    switch (type) {
      case 'ko':
        // A star KO (launched off the top) pops the crowd; a self-KO deflates it.
        delta = e.b === 0 ? C.selfKo : (e.kind === 'top' || e.kind === 'star' ? C.starKo : C.ko);
        break;
      case 'launch':
        if (e.mag >= 18) delta = C.bigLaunch;
        else if (e.mag >= 11) delta = C.solidLaunch;
        break;
      case 'trickShot': delta = C.trickShot; break;
      case 'explosion': delta = C.explosion; break;
      case 'styleUp': delta = C.styleUp; break;
      case 'suddenDeath': delta = C.suddenDeath; break;
      case 'roundEnd': delta = C.roundEnd; break;
      case 'matchEnd': delta = C.matchEnd; break;
      case 'award': delta = C.award; break;
      case 'eliminated': delta = C.eliminated; break;
      case 'lightning':
        if (e.kind === 'strike') delta = C.lightningStrike;
        break;
      case 'lavaHit': delta = C.lavaHit; break;
      default: return null;
    }
    if (!delta) return null;
    this.hype = Math.max(0, Math.min(100, this.hype + delta));
    return this._checkLevel();
  }

  /** Hype bleeds off every tick with nothing happening. Called from Sim.step. */
  step() {
    if (this.hype <= 0) return null;
    this.hype = Math.max(0, this.hype - C.decay * TICK_DT);
    return this._checkLevel();
  }

  _checkLevel() {
    let level = 0;
    for (let i = 0; i < C.levels.length; i++) if (this.hype >= C.levels[i]) level = i + 1;
    if (level === this.level) return null;
    const prev = this.level;
    this.level = level;
    return { type: 'hype', fields: { mag: level, tier: prev, kind: this.levelName } };
  }

  snapshot() { return { hype: this.hype, level: this.level }; }

  /** @param {ReturnType<Crowd['snapshot']>} s */
  restore(s) {
    this.hype = s?.hype ?? 0;
    this.level = s?.level ?? 0;
    return this;
  }
}
