// src/sim/accumulator.js — the fixed-timestep clock.
//
// The single most important thing in this file: the sim NEVER receives a variable dt. A render
// frame is 16.7 ms on a 144 Hz monitor and 41 ms on a struggling laptop, and feeding either
// number straight into the physics would change how the game plays. So wall-clock time goes in
// one side and fixed 1/60 s ticks come out the other, whole.
//
// Why an accumulator and not a smoothing dt: every alternative (a capped variable dt, a
// fixed-max-substep scheme) makes the simulation's behaviour depend on the frame rate. Two
// players on different machines would then be playing measurably different games, which for a
// server-authoritative brawler is a desync bug wearing a gameplay costume.

import { TICK_DT, MAX_STEPS_PER_FRAME, MAX_FRAME_TIME } from './contracts.js';

export class FixedStepClock {
  /**
   * @param {object} [opts]
   * @param {number} [opts.dt]      Step size; defaults to the contract's 1/60.
   * @param {number} [opts.maxSteps] Catch-up cap per call.
   */
  constructor({ dt = TICK_DT, maxSteps = MAX_STEPS_PER_FRAME } = {}) {
    this.dt = dt;
    this.maxSteps = maxSteps;
    this.acc = 0;          // leftover wall-clock seconds not yet consumed by a tick
    this.ticks = 0;        // total ticks ever run
    this.dropped = 0;      // ticks skipped by the catch-up cap (a genuine stall, worth logging)
    this.discarded = 0;    // seconds thrown away because a frame was longer than MAX_FRAME_TIME
  }

  /**
   * Add elapsed wall-clock seconds and report how many fixed steps to run now.
   *
   * The two clamps, and why both exist:
   *   • MAX_FRAME_TIME discards time from a frame longer than 250 ms. This is the tab that was
   *     backgrounded, or the GC pause. Running 25 catch-up ticks would teleport every dweeb
   *     across the stage and fire a burst of sound; dropping the time is invisible and correct.
   *   • MAX_STEPS_PER_FRAME caps catch-up at 5. This is a machine that is briefly too slow, not
   *     a tab that was hidden. Dropping *some* time is the lesser evil: the game runs slightly
   *     slow instead of exploding, and `dropped` records that it happened.
   *
   * @param {number} elapsed Seconds since the last call.
   * @returns {number} ticks to step now (0..maxSteps)
   */
  advance(elapsed) {
    if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
    if (elapsed > MAX_FRAME_TIME) {
      this.discarded += elapsed;
      elapsed = 0;
    }
    this.acc += elapsed;
    let steps = Math.floor(this.acc / this.dt);
    if (steps > this.maxSteps) {
      this.dropped += steps - this.maxSteps;
      // Discard the surplus rather than carrying it, or the backlog grows forever.
      this.acc -= (steps - this.maxSteps) * this.dt;
      steps = this.maxSteps;
    }
    this.acc -= steps * this.dt;
    this.ticks += steps;
    return steps;
  }

  /**
   * How far the view should sit between the previous and current tick, 0..1.
   * Presentation only — never fed back into the sim, and not part of any checksum.
   */
  alpha() {
    return this.acc / this.dt;
  }

  /** Called after restore(): a snapshot carries no half-tick, so the remainder is dropped. */
  reset() {
    this.acc = 0;
    return this;
  }

  snapshot() { return { acc: this.acc, ticks: this.ticks }; }

  /** @param {ReturnType<FixedStepClock['snapshot']>} s */
  restore(s) {
    this.acc = s.acc;
    this.ticks = s.ticks;
    return this;
  }
}
