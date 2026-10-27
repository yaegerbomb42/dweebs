// locomotionJuice tests — locomotion juice pure math (Round 2).
// Pure module contract: no three.js, no DOM, no Math.random, plain {x,y,z} vectors.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeLocomotionState,
  updateLean,
  beginJumpAnticipation,
  updateJumpAnticipation,
  aerialStretch,
  landingSquash,
  squashStretch,
  detectReversal,
  LOCOMOTION_DEFAULTS,
} from '../src/player/locomotionJuice.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;

describe('locomotionJuice purity', () => {
  it('imports nothing from three.js and touches no DOM/random', () => {
    const src = readFileSync(join(ROOT, 'src/player/locomotionJuice.js'), 'utf8');
    const banned = [
      [/from\s+['"]three['"]/, 'three.js import'],
      [/require\(\s*['"]three['"]\s*\)/, 'require(three)'],
      [/\bMath\.random\b/, 'Math.random()'],
      [/\bdocument\b/, 'document'],
      [/\bwindow\b/, 'window'],
      [/\bAudioContext\b/, 'AudioContext'],
    ];
    const violations = banned
      .map(([re, label]) => (re.test(src) ? label : null))
      .filter(Boolean);
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

describe('lean (banking) target', () => {
  it('is zero when stationary or nearly stationary', () => {
    const s = makeLocomotionState();
    expect(updateLean(s, { x: 0, y: 0, z: 0 }, { x: 1, z: 0 }, DT)).toBe(0);
    expect(updateLean(s, { x: 0.2, y: 0, z: 0 }, { x: 1, z: 0 }, DT)).toBe(0);
    expect(s.lean).toBe(0);
  });

  it('is zero when input aligns with travel', () => {
    const s = makeLocomotionState();
    expect(updateLean(s, { x: 0, y: 0, z: 7 }, { x: 0, z: 1 }, DT)).toBe(0);
    const s2 = makeLocomotionState();
    expect(updateLean(s2, { x: 5, y: 0, z: 3 }, { x: 5, z: 3 }, DT)).toBe(0);
  });

  it('leans right (negative) when input is to the right of travel', () => {
    const s = makeLocomotionState();
    // Travel +Z, input +X is a right turn under the yaw convention.
    const lean = updateLean(s, { x: 0, y: 0, z: 7 }, { x: 1, z: 0 }, DT);
    expect(lean).toBeLessThan(0);
  });

  it('leans left (positive) when input is to the left of travel', () => {
    const s = makeLocomotionState();
    // Travel +Z, input −X is a left turn.
    const lean = updateLean(s, { x: 0, y: 0, z: 7 }, { x: -1, z: 0 }, DT);
    expect(lean).toBeGreaterThan(0);
  });

  it('mirrors exactly for opposite turns', () => {
    const l = makeLocomotionState();
    const r = makeLocomotionState();
    // Travel +X, input +Z is a left turn (toward the body's left) under the yaw
    // convention → positive lean (top toward the character's left).
    // Travel +X, input −Z is a right turn → negative lean.
    const left = updateLean(l, { x: 7, y: 0, z: 0 }, { x: 0, z: 1 }, DT);
    const right = updateLean(r, { x: 7, y: 0, z: 0 }, { x: 0, z: -1 }, DT);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(0);
    expect(left).toBeCloseTo(-right, 6);
  });

  it('scales lean with speed (up to the speed reference)', () => {
    const slow = makeLocomotionState();
    const fast = makeLocomotionState();
    const a = updateLean(slow, { x: 0, y: 0, z: 3 }, { x: 1, z: 0 }, DT);
    const b = updateLean(fast, { x: 0, y: 0, z: 7 }, { x: 1, z: 0 }, DT);
    // 3 m/s is half the 6 m/s reference, so first-step lean is ~half.
    expect(Math.abs(a)).toBeCloseTo(Math.abs(b) * 0.5, 1);
  });

  it('clamps at maxLean even for full perpendicular turns', () => {
    const s = makeLocomotionState();
    // Speed well past the reference, input hard perpendicular: target saturates at
    // maxLean and the smoothed value approaches it but never exceeds it.
    let lean = 0;
    for (let i = 0; i < 480; i++) {
      lean = updateLean(s, { x: 10, y: 0, z: 0 }, { x: 0, z: -1 }, DT);
    }
    expect(Math.abs(lean)).toBeLessThanOrEqual(LOCOMOTION_DEFAULTS.lean.maxLean + 1e-9);
    expect(Math.abs(lean)).toBeGreaterThan(LOCOMOTION_DEFAULTS.lean.maxLean * 0.98);
  });

  it('smooths toward the target without overshoot and converges', () => {
    const s = makeLocomotionState();
    // Speed 7 ≥ ref 6 → speedF = 1, right turn (travel +Z, input +X) → target = −maxLean.
    const target = LOCOMOTION_DEFAULTS.lean.maxLean;
    let prev = 0, lean = 0;
    for (let i = 0; i < 300; i++) {
      lean = updateLean(s, { x: 0, y: 0, z: 7 }, { x: 1, z: 0 }, DT);
      if (i > 0) {
        expect(Math.abs(lean)).toBeGreaterThanOrEqual(Math.abs(prev) - 1e-9); // monotonic
        expect(Math.abs(lean)).toBeLessThanOrEqual(Math.abs(target) + 1e-9);   // no overshoot
      }
      prev = lean;
    }
    expect(lean).toBeCloseTo(-target, 6);
  });

  it('decays back to zero when input is released', () => {
    const s = makeLocomotionState();
    for (let i = 0; i < 120; i++) updateLean(s, { x: 0, y: 0, z: 7 }, { x: 1, z: 0 }, DT);
    expect(s.lean).toBeLessThan(0);
    for (let i = 0; i < 300; i++) updateLean(s, { x: 0, y: 0, z: 7 }, { x: 0, z: 0 }, DT);
    expect(s.lean).toBeCloseTo(0, 4);
  });

  it('accepts {x,y} input (Vector2-shaped) and zero dt without moving', () => {
    const s = makeLocomotionState();
    const before = updateLean(s, { x: 0, y: 0, z: 7 }, { x: 1, y: 0 }, DT);
    const after = updateLean(s, { x: 0, y: 0, z: 7 }, { x: 1, y: 0 }, 0);
    expect(after).toBeCloseTo(before, 12);
    expect(before).toBeLessThan(0);
  });
});

describe('jump anticipation squash', () => {
  it('returns zero before the envelope starts', () => {
    const s = makeLocomotionState();
    expect(updateJumpAnticipation(s, DT)).toBe(0);
  });

  it('rises to a peak then returns to zero and deactivates', () => {
    const s = makeLocomotionState();
    beginJumpAnticipation(s);
    let max = 0, prev = 0, sawFall = false;
    for (let i = 0; i < 60; i++) {
      const v = updateJumpAnticipation(s, DT);
      max = Math.max(max, v);
      if (v < prev) sawFall = true;
      prev = v;
    }
    expect(max).toBeGreaterThan(0.2);
    expect(max).toBeLessThanOrEqual(LOCOMOTION_DEFAULTS.anticipation.peak + 1e-9);
    expect(sawFall).toBe(true);
    // after the envelope, further updates return 0 and never revive
    let later = 0;
    for (let i = 0; i < 30; i++) later += updateJumpAnticipation(s, DT);
    expect(later).toBe(0);
  });

  it('honours a custom duration/peak', () => {
    const s = makeLocomotionState();
    beginJumpAnticipation(s);
    let max = 0;
    for (let i = 0; i < 30; i++) max = Math.max(max, updateJumpAnticipation(s, DT, { duration: 0.08, peak: 0.1 }));
    // 0.08 s ≈ 4.8 frames: sampled near the smoothstep peak (discretization error)
    expect(max).toBeCloseTo(0.1, 1);
    expect(updateJumpAnticipation(s, DT, { duration: 0.08, peak: 0.1 })).toBe(0);
  });
});

describe('aerial stretch and landing squash curves', () => {
  it('stretch is zero at rest and symmetric in sign', () => {
    expect(aerialStretch(0)).toBe(0);
    expect(aerialStretch(7.5)).toBeCloseTo(aerialStretch(-7.5), 9);
  });

  it('stretch ramps with vertical speed and clamps', () => {
    const cap = LOCOMOTION_DEFAULTS.stretch.maxStretch;
    expect(aerialStretch(15)).toBeCloseTo(cap, 9);
    expect(aerialStretch(50)).toBe(cap);
    expect(aerialStretch(7.5)).toBeCloseTo(cap / 2, 9);
    expect(aerialStretch(3.75)).toBeCloseTo(cap / 4, 9);
  });

  it('landing squash scales with fall speed and body mass, clamped', () => {
    expect(landingSquash(0)).toBe(0);
    const light = landingSquash(10, 2);
    const mid = landingSquash(10, 3);
    const heavy = landingSquash(10, 4);
    expect(heavy).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(light);
    expect(landingSquash(999, 3)).toBe(LOCOMOTION_DEFAULTS.landing.maxSquash);
  });
});

describe('squash/stretch composition', () => {
  it('identity at rest', () => {
    expect(squashStretch({})).toEqual({ sy: 1, sxz: 1 });
  });

  it('preserves volume (sy · sxz² ≈ 1)', () => {
    const cases = [
      { anticipating: 0.24, landing: 0, stretch: 0 },
      { anticipating: 0, landing: 0.3, stretch: 0 },
      { anticipating: 0.1, landing: 0.2, stretch: 0.18 },
      { anticipating: 0.24, landing: 0.5, stretch: 0.1 },
    ];
    for (const c of cases) {
      const { sy, sxz } = squashStretch(c);
      expect(sy * sxz * sxz).toBeCloseTo(1, 6);
    }
  });

  it('stretches above 1 and squashes below 1', () => {
    expect(squashStretch({ stretch: 0.18 }).sy).toBeCloseTo(1.18, 9);
    expect(squashStretch({ landing: 0.4 }).sy).toBeCloseTo(0.6, 9);
    expect(squashStretch({ anticipating: 0.24 }).sy).toBeCloseTo(0.76, 9);
  });

  it('clamps sy at minSy for absurd inputs', () => {
    const { sy } = squashStretch({ landing: 10, anticipating: 10, stretch: 1 }, { minSy: 0.3 });
    expect(sy).toBe(0.3);
  });

  it('mutates and returns the provided out object', () => {
    const out = { sy: 0, sxz: 0 };
    const ret = squashStretch({ stretch: 0.18 }, {}, out);
    expect(ret).toBe(out);
    expect(out.sy).toBeCloseTo(1.18, 9);
    expect(ret.sxz).toBeCloseTo(1 / Math.sqrt(1.18), 6);
  });
});

describe('reversal detection with hysteresis', () => {
  it('stays idle when slow or aligned', () => {
    const s = makeLocomotionState();
    expect(detectReversal(s, 2, -1, DT).event).toBeNull();
    expect(detectReversal(s, 8, 0.5, DT).event).toBeNull();
    expect(s.reversal.mode).toBe('idle');
  });

  it('starts on a fast full reversal and reports intensity', () => {
    const s = makeLocomotionState();
    const r = detectReversal(s, 8, -1, DT);
    expect(r.event).toBe('start');
    // 8 m/s ≥ eventMinSpeed 6 → intensity clamps at 1
    expect(r.intensity).toBe(1);
    expect(s.reversal.mode).toBe('skidding');
  });

  it('does not re-trigger while the cooldown is hot', () => {
    const s = makeLocomotionState();
    expect(detectReversal(s, 8, -1, DT).event).toBe('start');
    expect(detectReversal(s, 8, -1, DT).event).toBeNull();
    expect(s.reversal.mode).toBe('skidding');
  });

  it('repeats a skid event after the cooldown expires while still reversed', () => {
    const s = makeLocomotionState();
    expect(detectReversal(s, 8, -1, DT).event).toBe('start');
    let saw = null;
    for (let i = 0; i < 40; i++) {
      const r = detectReversal(s, 8, -1, DT);
      if (r.event === 'skid') { saw = r; break; }
    }
    expect(saw).not.toBeNull();
  });

  it('hysteresis: mild opposition keeps skidding until the release dot', () => {
    const s = makeLocomotionState();
    expect(detectReversal(s, 8, -1, DT).event).toBe('start');
    // -0.2 is within the hysteresis band (between engage -0.3 and release 0.15):
    // should NOT end the skid.
    for (let i = 0; i < 20; i++) detectReversal(s, 8, -0.2, DT);
    expect(s.reversal.mode).toBe('skidding');
    // crossing the release dot ends it
    expect(detectReversal(s, 8, 0.3, DT).event).toBe('end');
    expect(s.reversal.mode).toBe('idle');
  });

  it('does not re-engage inside the hysteresis band', () => {
    const s = makeLocomotionState();
    expect(detectReversal(s, 8, -1, DT).event).toBe('start');
    detectReversal(s, 8, 0.3, DT); // end
    // -0.2 is not enough to re-engage (engage is -0.3)
    expect(detectReversal(s, 8, -0.2, DT).event).toBeNull();
    expect(s.reversal.mode).toBe('idle');
    // wait out the post-end cooldown with aligned input (never engages)…
    for (let i = 0; i < 14; i++) detectReversal(s, 8, 0.6, DT);
    // …then a full reversal starts a fresh skid
    expect(detectReversal(s, 8, -1, DT).event).toBe('start');
  });

  it('ends when the body slows below the minimum skid speed', () => {
    const s = makeLocomotionState();
    expect(detectReversal(s, 8, -1, DT).event).toBe('start');
    // -0.5 is still a reversal, but we've nearly stopped
    for (let i = 0; i < 10; i++) detectReversal(s, 3, -0.5, DT);
    expect(s.reversal.mode).toBe('idle');
  });

  it('cooldown after an end prevents an instant restart', () => {
    const s = makeLocomotionState();
    expect(detectReversal(s, 8, -1, DT).event).toBe('start');
    expect(detectReversal(s, 8, 0.3, DT).event).toBe('end');
    // immediately reversed again: blocked by cooldown
    expect(detectReversal(s, 8, -1, DT).event).toBeNull();
    expect(s.reversal.mode).toBe('idle');
  });

  it('intensity is monotonic and clamped to [0, 1]', () => {
    const s = makeLocomotionState();
    let prev = -1;
    for (const speed of [4.5, 6, 7.5, 9, 12, 30]) {
      const r = detectReversal(s, speed, -1, DT);
      expect(r.intensity).toBeGreaterThanOrEqual(0);
      expect(r.intensity).toBeLessThanOrEqual(1);
      expect(r.intensity).toBeGreaterThanOrEqual(prev);
      prev = r.intensity;
    }
  });

  it('reuses a caller-provided out object', () => {
    const s = makeLocomotionState();
    const out = { event: null, intensity: 0 };
    const ret = detectReversal(s, 8, -1, DT, {}, out);
    expect(ret).toBe(out);
    expect(out.event).toBe('start');
    expect(out.intensity).toBeGreaterThan(0);
  });
});
