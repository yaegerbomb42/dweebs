// src/sim/match.js — knockout brawl rules: stocks, blast zones, rounds, sudden death.
//
// A counterpart of src/game/Match.js with the callbacks replaced by events, so the sim can run it
// in Node and the view can subscribe to the same rules it already listens to. The numbers are the
// live ones: Match.js reads them from Balance.js, and so does this.
//
// The one structural change is KO *credit*. In the live game `onKO(d, credited, kind, pos)` hands
// the view a dweeb object. Here it hands over entity ids, because a server cannot hand a client an
// object reference it will later mutate.

import { BALANCE } from '../game/Balance.js';
import { STAGE_RADIUS, WATER_LEVEL } from './arena.js';
import { TICK_DT } from './contracts.js';

const HILL = BALANCE.hill;

export const Phase = {
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  ROUND_END: 'roundEnd',
  RESULTS: 'results',
};

const KO_CREDIT_WINDOW = BALANCE.match.koCreditWindow;
const RESPAWN_DELAY = 2;

export class SimMatch {
  /** @param {object} opts @param {object} opts.events @param {object} opts.config */
  constructor({ events, config }) {
    this.events = events;
    this.config = config;
    this.phase = Phase.MENU;
    this.dweebs = [];
    this.round = 0;
    /** @type {number[]} rounds won per slot */
    this.roundWins = [];
    this.timer = 0;
    this.countdown = 0;
    this.phaseTimer = 0;
    this.time = 0;
    this.suddenDeath = false;
    this.blastSide = BALANCE.match.blastSide;
    this.roundWinner = -1;
    this.matchWinner = -1;
    this.lastCount = 4;
    this.playerOutAt = null;
    this.stocks = config.stocks;
    this.roundsToWin = config.roundsToWin;
    this.roundTime = config.roundTime;
    this.suddenDeathAt = config.suddenDeathAt;
    /** 'brawl' | 'hill' | 'teams' | 'sudden'. Teams reuses brawl rules with no friendly fire. */
    this.mode = config.mode ?? 'brawl';
    this.hillTarget = config.hillTarget ?? HILL.target;
    this.hillRate = config.hillRate ?? HILL.rate;
    this.hillHolderId = 0;
    this.hillMilestone = [];
    /** slot -> team index, from config.teams (arrays of slots). Empty = free-for-all. */
    this.slotToTeam = new Map();
    for (const [ti, slots] of (config.teams || []).entries())
      for (const sl of slots) this.slotToTeam.set(sl, ti);
  }

  get running() { return this.phase === Phase.PLAYING; }

  /** Reset per-match counters. Called once, before the first round. */
  startMatch(dweebs) {
    this.dweebs = dweebs;
    this.round = 0;
    this.roundWins = dweebs.map(() => 0);
    this.matchWinner = -1;
    this.stocks = this.config.stocks;
    for (const d of dweebs) {
      d.kos = 0; d.falls = 0; d.damageDealt = 0; d.totalKos = 0; d.totalFalls = 0;
      d.hillScore = 0;
    }
  }

  /** Called once the stage and the dweebs have been reset for a new round. */
  beginRound(api) {
    this.round++;
    this.timer = this.roundTime;
    this.countdown = 3.999;
    this.lastCount = 4;
    this.suddenDeath = false;
    this.blastSide = BALANCE.match.blastSide;
    this.roundWinner = -1;
    this.playerOutAt = null;
    this.phase = Phase.COUNTDOWN;
    for (const d of this.dweebs) {
      d.stocks = this.stocks;
      d.kos = 0;
      d.falls = 0;
      d.hillScore = 0;
    }
    this.hillHolderId = 0;
    this.hillMilestone = this.dweebs.map(() => 0);
    if (this.mode === 'sudden') {
      // Sudden-death mode: the arena is already closing in at GO.
      this.suddenDeath = true;
      this.blastSide = BALANCE.match.blastSide * BALANCE.match.sdBlastScale;
      api.arena.startSuddenDeath();
      api.emit('suddenDeath', {});
    }
  }

  /** One tick of rules, called from Sim.step after the physics step. */
  step(dweebs, api) {
    this.time += TICK_DT;

    if (this.phase === Phase.COUNTDOWN) {
      this.countdown -= TICK_DT;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n > 0) api.emit('countdown', { mag: n });
      }
      if (this.countdown <= 0) {
        this.phase = Phase.PLAYING;
        api.emit('go', {});
      }
      return;
    }

    if (this.phase === Phase.ROUND_END) {
      this.phaseTimer -= TICK_DT;
      if (this.phaseTimer <= 0) {
        if (this.matchWinner >= 0) {
          this.phase = Phase.RESULTS;
          api.emit('matchEnd', { a: this.matchWinner });
        } else {
          api.onNextRound?.();
        }
      }
      return;
    }

    if (this.phase !== Phase.PLAYING) return;

    this.timer -= TICK_DT;
    if (!this.suddenDeath && this.timer <= this.suddenDeathAt) {
      this.suddenDeath = true;
      this.blastSide = BALANCE.match.blastSide * BALANCE.match.sdBlastScale;  // the arena closes in
      api.arena.startSuddenDeath();
      api.emit('suddenDeath', {});
    }

    for (const d of dweebs) {
      if (d.eliminated) continue;
      if (d.out) {
        d.respawnTimer -= TICK_DT;
        if (d.respawnTimer <= 0) api.onRespawn?.(d);
        continue;
      }
      const p = d.position;
      let kind = null;
      if (p[1] < WATER_LEVEL + 0.6) {
        // Deep below the world: no flail, no debate — take the stock. A flailing dweeb hovers
        // at the waterline; fifty metres past it nothing is coming back, and without this a
        // dweeb whose flail ever froze could fall forever while still "active".
        if (p[1] < WATER_LEVEL - 50) kind = 'splash';
        // Flailing: one chance to splash-jump out.
        else if (d.swimFlail > 0) continue;
        // Barely under, right by the lip: flail first (micro-comeback), then the dunk counts
        else if (!d.flailUsed && Math.hypot(p[0], p[2]) < STAGE_RADIUS + BALANCE.water.flailEdge) {
          d.flailUsed = true;
          d.swimFlail = BALANCE.water.flailTime;
          api.emit('flail', { a: d.id, x: p[0], y: p[1], z: p[2] });
          continue;
        }
        kind = 'splash';
      } else if (Math.hypot(p[0], p[2]) > this.blastSide) kind = 'side';
      else if (p[1] > BALANCE.match.blastTop) kind = 'top';
      if (!kind) continue;
      if (kind === 'splash') api.emit('splash', { a: d.id, x: p[0], y: p[1], z: p[2] });
      // Volcano: the first dip spits you back out — the KO only counts on a cooled dip.
      if (kind === 'splash' && api.arena?.profile?.lava && api.arena.lavaDip(d, api)) continue;
      this._ko(d, kind, api);
      api.onKO?.(d);
    }

    if (this.mode === 'hill') this._hillTick(dweebs, api);

    // Round over when one dweeb is left standing, or when the clock runs out. A lone
    // dweeb (online with no bots) plays until the clock, instead of winning at GO.
    // Teams: the round ends when at most one team still has dweebs standing.
    const standing = dweebs.filter(d => !d.eliminated).length;
    const teamsAlive = new Set(dweebs.filter(d => !d.eliminated).map(d => d.team)).size;
    const teamWipe = this.mode === 'teams' && dweebs.length > 1 && teamsAlive <= 1;
    const player = dweebs.find(d => !d.isBot);
    if (standing === 0 || teamWipe || (this.mode !== 'teams' && dweebs.length > 1 && standing <= 1) || this.timer <= 0) {
      this._endRound(dweebs, api);
    } else if (player?.eliminated) {
      // Let the player watch the finish for a moment before wrapping up (live Match parity).
      this.playerOutAt ??= this.time;
      if (this.time - this.playerOutAt > 3) this._endRound(dweebs, api);
    }
  }

  /**
   * King of the hill: the sole dweeb inside the centre zone accrues points; a contested
   * hill scores nothing. Crossing the target ends the round immediately.
   */
  _hillTick(dweebs, api) {
    const inHill = dweebs.filter(d =>
      d.active && !d.out && !d.eliminated && d.position[1] < 4 &&
      Math.hypot(d.position[0], d.position[2]) < HILL.radius);
    const holder = inHill.length === 1 ? inHill[0] : null;
    const holderId = holder?.id ?? 0;
    if (holderId !== this.hillHolderId) {
      this.hillHolderId = holderId;
      api.emit('hillHold', { a: holderId });
    }
    if (!holder) return;
    holder.hillScore += this.hillRate * TICK_DT;
    const ms = Math.floor(holder.hillScore / HILL.milestone);
    if (ms > (this.hillMilestone[holder.slot] || 0)) {
      this.hillMilestone[holder.slot] = ms;
      api.emit('hillScore', { a: holder.id, mag: Math.floor(holder.hillScore) });
    }
    if (holder.hillScore >= this.hillTarget) this._endRound(dweebs, api);
  }

  /**
   * A KO. Credit goes to the last attacker inside the credit window, unless it was the victim
   * themselves — the same rule as the live Match._ko, including the 6-second window.
   *
   * Hill mode never costs a stock: a KO is a respawn, not an elimination.
   */
  _ko(d, kind, api) {
    const credited = d.lastHitBy && this.time - d.lastHitAt < KO_CREDIT_WINDOW && d.lastHitBy !== d.id
      ? api.byId(d.lastHitBy) : null;
    if (credited) {
      credited.kos++;
      credited.totalKos = (credited.totalKos || 0) + 1;
    }
    if (this.mode === 'hill') {
      // Infinite stocks on the hill: out for the respawn delay, then back in.
      d.out = true;
      d.active = false;
      d.respawnTimer = RESPAWN_DELAY;
      api.emit('ko', { a: d.id, b: credited?.id ?? 0, x: d.position[0], y: d.position[1], z: d.position[2], kind });
      return;
    }
    d.stocks--;
    d.falls++;
    d.totalFalls = (d.totalFalls || 0) + 1;
    d.out = true;
    d.active = false;
    d.respawnTimer = RESPAWN_DELAY;
    if (d.stocks <= 0) {
      d.eliminated = true;
      d.out = false;
      api.emit('eliminated', { a: d.id, kind });
    } else {
      api.emit('stockLost', { a: d.id, mag: RESPAWN_DELAY });
    }
    api.emit('ko', { a: d.id, b: credited?.id ?? 0, x: d.position[0], y: d.position[1], z: d.position[2], kind });
  }

  _endRound(dweebs, api) {
    if (this.phase !== Phase.PLAYING) return;
    this.playerOutAt = null;
    const ranked = this.roundStandings(dweebs);
    const winner = ranked[0];
    if (!winner) return;
    this.roundWinner = winner.slot;
    this.roundWins[winner.slot] = (this.roundWins[winner.slot] || 0) + 1;
    if (this.roundWins[winner.slot] >= this.roundsToWin) this.matchWinner = winner.slot;
    this.phase = Phase.ROUND_END;
    this.phaseTimer = 4;
    api.emit('roundEnd', { a: winner.id, kind: this.matchWinner >= 0 ? 'match' : 'round', mag: this.round });
  }

  /** Order for this round: most stocks, then lowest damage. Hill: most points, then KOs.
   *  Matches Match.roundStandings. */
  roundStandings(dweebs = this.dweebs) {
    if (this.mode === 'hill') {
      return [...dweebs].sort((a, b) =>
        (b.hillScore - a.hillScore) || ((b.totalKos || 0) - (a.totalKos || 0)));
    }
    return [...dweebs].sort((a, b) => {
      const sa = a.eliminated ? 0 : a.stocks, sb = b.eliminated ? 0 : b.stocks;
      if (sb !== sa) return sb - sa;
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      return a.percent - b.percent;
    });
  }

  /** Match order: rounds won, then total KOs, then fewest falls. Matches Match.standings. */
  standings(dweebs = this.dweebs) {
    return [...dweebs].sort((a, b) =>
      (this.roundWins[b.slot] - this.roundWins[a.slot]) ||
      ((b.totalKos || 0) - (a.totalKos || 0)) ||
      ((a.totalFalls || 0) - (b.totalFalls || 0)));
  }

  timerString() {
    const t = Math.max(0, Math.ceil(this.timer));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  snapshot() {
    return {
      phase: this.phase, round: this.round, roundWins: [...this.roundWins], timer: this.timer,
      countdown: this.countdown, phaseTimer: this.phaseTimer, time: this.time,
      suddenDeath: this.suddenDeath, blastSide: this.blastSide,
      roundWinner: this.roundWinner, matchWinner: this.matchWinner, lastCount: this.lastCount,
      stocks: this.stocks, playerOutAt: this.playerOutAt,
      mode: this.mode, hillTarget: this.hillTarget, hillRate: this.hillRate,
      hillHolderId: this.hillHolderId, hillMilestone: [...this.hillMilestone],
    };
  }

  /** @param {ReturnType<SimMatch['snapshot']>} s */
  restore(s) {
    Object.assign(this, s);
    this.roundWins = [...s.roundWins];
    this.hillMilestone = [...(s.hillMilestone ?? [])];
    this.slotToTeam = new Map();
    for (const [ti, slots] of (this.config.teams || []).entries())
      for (const sl of slots) this.slotToTeam.set(sl, ti);
    return this;
  }
}
