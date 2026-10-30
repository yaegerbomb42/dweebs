// combos.js — arena KO combo system.
//
// Chain KOs within a time window for escalating bonuses.

export const COMBO_WINDOW = 5; // seconds

export class ComboTracker {
  constructor() {
    this.combo = 0;
    this.lastKo = 0;
    this.best = 0;
  }

  /**
   * Record a KO at time t (seconds). Returns the current combo.
   * @param {number} t
   */
  ko(t) {
    if (t - this.lastKo <= COMBO_WINDOW) {
      this.combo++;
    } else {
      this.combo = 1;
    }
    this.lastKo = t;
    this.best = Math.max(this.best, this.combo);
    return this.combo;
  }

  /** Bonus style for the current combo. */
  bonus() {
    if (this.combo < 2) return 0;
    return (this.combo - 1) * 10; // 10, 20, 30...
  }

  /** Combo name. */
  name() {
    if (this.combo >= 5) return 'RAMPAGE!';
    if (this.combo >= 4) return 'QUAD KO!';
    if (this.combo >= 3) return 'TRIPLE KO!';
    if (this.combo >= 2) return 'DOUBLE KO!';
    return '';
  }

  reset() {
    this.combo = 0;
    this.lastKo = 0;
  }
}
