// speedbuild.js — timed building challenges.

export const CHALLENGES = [
  { id: 'speedy', name: 'Speedy', desc: 'Build any dweeb in under 60s', time: 60 },
  { id: 'blitz', name: 'Blitz', desc: 'Build any dweeb in under 30s', time: 30 },
  { id: 'marathon', name: 'Marathon', desc: 'Build 3 dweebs in 5 minutes', time: 300, count: 3 },
];

export class SpeedBuild {
  constructor() {
    this.active = false;
    this.challenge = null;
    this.startTime = 0;
    this.built = 0;
  }

  /** Start a challenge. */
  start(challengeId) {
    const c = CHALLENGES.find(x => x.id === challengeId);
    if (!c) return null;
    this.active = true;
    this.challenge = c;
    this.startTime = Date.now();
    this.built = 0;
    return c;
  }

  /** Record a completed build. Returns 'complete', 'failed', or null. */
  completeBuild() {
    if (!this.active) return null;
    this.built++;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const needed = this.challenge.count || 1;
    if (this.built >= needed) {
      this.active = false;
      return elapsed <= this.challenge.time ? 'complete' : 'failed';
    }
    return null;
  }

  /** Time remaining in seconds. */
  remaining() {
    if (!this.active) return 0;
    const elapsed = (Date.now() - this.startTime) / 1000;
    return Math.max(0, this.challenge.time - elapsed);
  }
}
