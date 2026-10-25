// Haptics.js — tactile feedback for the brawl.
//
// Two backends, one API:
//   • Gamepad rumble via the Gamepad API's `vibrationActuator` (dual-rumble).
//   • Mobile vibration via `navigator.vibrate`, but only on coarse-pointer devices
//     so desktop browsers never buzz a trackpad.
//
// Everything is best-effort: if the hardware or permission isn't there, calls are
// silent no-ops. Pulses are debounced and short so rapid hits read as texture
// instead of one continuous buzz.

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEVICE_CHECK_MS = 1000;

export class Haptics {
  constructor() {
    this.enabled = true;
    this.lastPulseAt = -Infinity;
    this.padIndex = -1;
    this.coarse = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    this._checkedAt = 0;
    this._hasPad = false;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.stop();
  }

  stop() {
    this._chargeAt = 0;
    this._chargeFull = false;
    this._hbAt = 0;
    const pad = this._gamepad();
    try { pad?.vibrationActuator?.reset?.(); } catch { /* unsupported */ }
    try {
      if (this.coarse && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(0);
    } catch { /* unsupported */ }
  }

  _gamepad() {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    const now = performance.now();
    if (now - this._checkedAt < DEVICE_CHECK_MS && this._hasPad) {
      const pad = navigator.getGamepads()[this.padIndex];
      if (pad?.connected) return pad;
    }
    this._checkedAt = now;
    const pads = navigator.getGamepads() || [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad?.connected && pad.vibrationActuator?.playEffect) {
        this.padIndex = i;
        this._hasPad = true;
        return pad;
      }
    }
    this._hasPad = false;
    return null;
  }

  /**
   * Fire one tactile pulse.
   * @param {number} strength 0..1 overall intensity
   * @param {number} duration milliseconds
   * @param {number} sharp    0..1 high-frequency (sharp) share
   */
  pulse(strength = 0.4, duration = 80, sharp = 0.5) {
    if (!this.enabled) return;
    const s = clamp01(strength);
    if (s < 0.04) return;
    const now = performance.now();
    if (now - this.lastPulseAt < 26) return; // faster than this reads as one long buzz
    this.lastPulseAt = now;

    const pad = this._gamepad();
    const actuator = pad?.vibrationActuator;
    if (actuator?.playEffect) {
      try {
        const p = actuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: Math.round(duration),
          strongMagnitude: s * 0.85,
          weakMagnitude: s * clamp01(sharp) * 0.9,
        });
        p?.catch?.(() => {});
        return;
      } catch { /* fall through to mobile */ }
    }
    if (this.coarse && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(Math.max(12, Math.round(duration * (0.55 + s * 0.7)))); } catch { /* unsupported */ }
    }
  }

  /** Hit, tiered like the juice table (jab → fireworks). */
  hit(tier = 1, near = 1, involved = false) {
    const power = [0.1, 0.2, 0.42, 0.72][tier] ?? 0.42;
    const falloff = involved ? 1 : 0.4 + near * 0.6;
    const dur = [40, 55, 85, 135][tier] ?? 80;
    this.pulse(power * falloff, dur, 0.35 + tier * 0.16);
  }

  /** Ground contact: a soft thud for hops, a proper jolt for hard landings. */
  land(speed = 8, involved = false, near = 1) {
    if (speed < 6) return;
    const falloff = involved ? 1 : 0.25 + near * 0.5;
    this.pulse(clamp01((speed - 5) / 16) * 0.55 * falloff, 60 + Math.min(80, speed * 5), 0.25);
  }

  /** A connected parry is a sharp double tick: block, then counter. */
  parry() {
    this.pulse(0.62, 70, 0.85);
    setTimeout(() => this.pulse(0.4, 55, 0.6), 65);
  }

  slam(involved = false, near = 1) {
    this.pulse(0.8 * (involved ? 1 : 0.45 + near * 0.4), 150, 0.3);
  }

  freeze(burst = false) {
    this.pulse(burst ? 0.5 : 0.24, burst ? 190 : 70, 0.9);
  }

  explosion(near = 1) {
    this.pulse(clamp01(0.35 + near * 0.5), 170, 0.25);
  }

  ko(involved = false, suddenDeath = false) {
    this.pulse((involved ? 0.9 : 0.35) * (suddenDeath ? 1 : 0.8), 220, 0.45);
  }

  throwHeavy() {
    this.pulse(0.3, 80, 0.2);
  }

  /**
   * Charging a punch/throw: a sparser, rising tick that tightens as the meter fills.
   * Passing 0 (or letting go) resets so the next wind-up starts clean.
   */
  charge(level = 0) {
    if (!this.enabled) return;
    const lvl = clamp01(level);
    if (lvl <= 0) { this._chargeAt = 0; this._chargeFull = false; return; }
    const now = performance.now();
    if (lvl >= 0.995 && !this._chargeFull) {
      this._chargeFull = true;
      this._chargeAt = now;
      this.pulse(0.24, 70, 0.55);
      return;
    }
    const interval = 260 - lvl * 120;
    if (now - (this._chargeAt || 0) < interval) return;
    this._chargeAt = now;
    this.pulse(0.03 + lvl * 0.14, 30, 0.15 + lvl * 0.4);
  }

  /** Danger pulse: high percent (and sudden death) gives a slow, low rumble heartbeat. */
  heartbeat(percent = 0, suddenDeath = false) {
    if (!this.enabled) return;
    const pct = Math.max(0, percent);
    if (!suddenDeath && pct < 90) { this._hbAt = 0; return; }
    const now = performance.now();
    const interval = suddenDeath ? 900 : Math.max(700, 1700 - (pct - 90) * 8);
    if (now - (this._hbAt || 0) < interval) return;
    this._hbAt = now;
    const strength = (suddenDeath ? 0.2 : 0.08) + Math.min(0.16, pct * 0.001);
    this.pulse(strength, 60, 0.2);
  }
}
