// Match.js — knockout brawl rules: stocks, blast zones, rounds (first to N wins), sudden death.

import { WATER_LEVEL, STAGE_RADIUS } from '../world/Arena.js';
import { BALANCE } from './Balance.js';

export const Phase = {
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  ROUND_END: 'roundEnd',
  RESULTS: 'results',
};

const BLAST_SIDE = BALANCE.match.blastSide;
const BLAST_TOP = BALANCE.match.blastTop;
const KO_CREDIT_WINDOW = BALANCE.match.koCreditWindow;
const RESPAWN_DELAY = 2;

export class Match {
  constructor() {
    this.phase = Phase.MENU;
    this.settings = { stocks: 3, roundsToWin: 2, roundTime: 120, suddenDeathAt: 40, mode: 'brawl' };
    this.darwinPoints = new Map();
    this.deathReel = [];
    this.dweebs = [];
    this.round = 0;
    this.roundWins = new Map();
    this.timer = 0;
    this.countdown = 0;
    this.phaseTimer = 0;
    this.pausedForCinema = false;
    this.time = 0;
    this.suddenDeath = false;
    this.roundWinner = null;
    this.matchWinner = null;
    this.events = null; // { onKO, onRespawn, onCountdown, onGo, onSuddenDeath, onRoundEnd, onMatchEnd }
  }

  startMatch(dweebs) {
    this.dweebs = dweebs;
    this.round = 0;
    this.roundWins = new Map(dweebs.map(d => [d, 0]));
    this.matchWinner = null;
    for (const d of dweebs) {
      d.kos = 0; d.falls = 0; d.damageDealt = 0; d.totalKos = 0; d.totalFalls = 0;
      d.trickshots = 0; d.maxAir = 0; d.stylePeak = 0; d.koedBy = null;
    }
    // Highlight reel for the results screen
    this.highlights = { launch: 0, launchBy: null, launchOn: null };
  }

  /** Called by main once the stage + Dweebs have been reset for a new round. */
  beginRound() {
    this.round++;
    this.timer = this.settings.roundTime;
    this.countdown = 3.999;
    this.lastCount = 4;
    this.suddenDeath = false;
    this.blastSide = BLAST_SIDE;
    this.roundWinner = null;
    this.playerOutAt = null;
    this.phase = Phase.COUNTDOWN;
    for (const d of this.dweebs) {
      d.stocks = this.settings.stocks;
      d.kos = 0;
      d.falls = 0;
    }
  }

  get running() {
    return this.phase === Phase.PLAYING;
  }

  update(dt) {
    this.time += dt;

    if (this.phase === Phase.COUNTDOWN) {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n > 0) this.events?.onCountdown?.(n);
      }
      if (this.countdown <= 0) {
        this.phase = Phase.PLAYING;
        this.events?.onGo?.();
      }
      return;
    }

    if (this.phase === Phase.ROUND_END) {
      if (this.pausedForCinema) return;
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.matchWinner) {
          this.phase = Phase.RESULTS;
          this.events?.onMatchEnd?.(this.matchWinner, this.standings());
        } else {
          this.events?.onNextRound?.();
        }
      }
      return;
    }

    if (this.phase !== Phase.PLAYING) return;
    if (this.settings.mode === 'adventure') return;

    this.timer -= dt;
    if (!this.suddenDeath && this.timer <= this.settings.suddenDeathAt) {
      this.suddenDeath = true;
      this.blastSide = BLAST_SIDE * BALANCE.match.sdBlastScale; // the arena closes in
      this.events?.onSuddenDeath?.();
    }

    for (const d of this.dweebs) {
      if (d.eliminated) continue;
      if (d.out) {
        if (d.respawnTimer <= 0) this.events?.onRespawn?.(d);
        continue;
      }
      const p = d.getPosition();
      let kind = null;
      if (p.y < WATER_LEVEL + 0.6) {
        if (d.swimFlail > 0) continue; // flailing: one chance to splash-jump out
        // Barely under, right by the lip: flail first (micro-comeback), then the dunk counts
        if (!d.flailUsed && Math.hypot(p.x, p.z) < STAGE_RADIUS + BALANCE.water.flailEdge) {
          d.startFlail(BALANCE.water.flailTime);
          this.events?.onFlail?.(d, p);
          continue;
        }
        kind = 'splash';
      }
      else if (Math.hypot(p.x, p.z) > this.blastSide) kind = 'side';
      else if (p.y > BLAST_TOP) kind = 'star';
      if (kind) this._ko(d, kind, p);
    }

    // Round over?
    const standing = this.dweebs.filter(d => !d.eliminated);
    const player = this.dweebs.find(d => d.isPlayer);
    if (standing.length === 0 || (this.dweebs.length > 1 && standing.length <= 1) || this.timer <= 0) {
      this._endRound();
    } else if (player?.eliminated) {
      // Let the player watch for a moment before wrapping up
      this.playerOutAt ??= this.time;
      if (this.time - this.playerOutAt > 3) this._endRound();
    }
  }

  /** Called on every hit that launches (main wires Dweeb.onHit): keeps the biggest yeet of the match. */
  noteLaunch(victim, launch) {
    const h = this.highlights;
    if (!h || launch <= h.launch) return;
    h.launch = launch;
    h.launchOn = victim;
    h.launchBy = victim.lastHitBy && this.time - victim.lastHitTime < 0.1 ? victim.lastHitBy : null;
  }

  _ko(d, kind, pos) {
    const credited = d.lastHitBy && this.time - d.lastHitTime < KO_CREDIT_WINDOW && d.lastHitBy !== d ? d.lastHitBy : null;
    d.stocks--;
    d.falls++;
    d.totalFalls = (d.totalFalls || 0) + 1;
    if (credited) {
      credited.kos++;
      credited.totalKos = (credited.totalKos || 0) + 1;
    }
    if (d.stocks <= 0) d.eliminate();
    else d.knockOut(RESPAWN_DELAY);
    this.events?.onKO?.(d, credited, kind, pos);
  }

  _endRound() {
    if (this.phase !== Phase.PLAYING) return;
    this.playerOutAt = null;
    const ranked = this.roundStandings();
    const winner = ranked[0];
    this.roundWinner = winner;
    this.roundWins.set(winner, (this.roundWins.get(winner) || 0) + 1);
    if (this.roundWins.get(winner) >= this.settings.roundsToWin) this.matchWinner = winner;
    this.phase = Phase.ROUND_END;
    this.phaseTimer = 4;
    this.events?.onRoundEnd?.(winner, ranked);
  }

  /** Order for this round: most stocks, then lowest damage. */
  roundStandings() {
    return [...this.dweebs].sort((a, b) => {
      const sa = a.eliminated ? 0 : a.stocks, sb = b.eliminated ? 0 : b.stocks;
      if (sb !== sa) return sb - sa;
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      return a.percent - b.percent;
    });
  }

  /** Match order: round wins, then total KOs, then fewest falls. */
  standings() {
    return [...this.dweebs].sort((a, b) =>
      (this.roundWins.get(b) - this.roundWins.get(a)) ||
      ((b.totalKos || 0) - (a.totalKos || 0)) ||
      ((a.totalFalls || 0) - (b.totalFalls || 0)));
  }

  timerString() {
    const t = Math.max(0, Math.ceil(this.timer));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
}
