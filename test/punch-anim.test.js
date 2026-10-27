// punchAnim tests — punch wind-up / strike snap / recoil pure math (Round 3).
// Pure module contract: no three.js, no DOM, no Math.random, plain {x,y,z} vectors.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUNCH_DEFAULTS,
  makePunchState,
  makePunchPose,
  beginWindup,
  releaseStrike,
  interruptPunch,
  applyRecoilImpulse,
  parryRecoilStrength,
  heavyRecoilStrength,
  updatePunch,
  punchPose,
  trailPath,
} from '../src/player/punchAnim.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;
const EPS = 1e-6;

function advance(state, seconds, charge = 0, out = null) {
  let pose = out;
  let left = seconds;
  while (left > EPS) {
    const step = Math.min(DT, left);
    pose = updatePunch(state, step, charge, {}, pose);
    left -= step;
  }
  return pose;
}

function strikeState(charge = 0, kind = null) {
  const s = makePunchState();
  beginWindup(s);
  return releaseStrike(s, charge, kind);
}

describe('punchAnim purity', () => {
  it('imports nothing from three.js and touches no DOM/random', () => {
    const src = readFileSync(join(ROOT, 'src/player/punchAnim.js'), 'utf8');
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

describe('state creation & transitions', () => {
  it('makePunchPose returns a clean idle pose', () => {
    const pose = makePunchPose();
    expect(pose.phase).toBe('idle');
    expect(pose.mode).toBeNull();
    expect(pose.armRx).toBe(0);
    expect(pose.armRz).toBe(0);
    expect(pose.handRetract).toBe(0);
    expect(pose.twist).toBe(0);
    expect(pose.scale).toEqual({ sy: 1, sxz: 1 });
    expect(pose.trail.active).toBe(false);
    expect(pose.trail.strength).toBe(0);
    expect(pose.head2d).toEqual({ y: 0, z: 0 });
  });

  it('starts idle with zeroed pose, lock and recoil', () => {
    const s = makePunchState();
    expect(s.phase).toBe('idle');
    expect(s.t).toBe(0);
    expect(s.lock).toEqual({ charge: 0, mode: null });
    expect(s.recoil).toEqual({ disp: 0, vel: 0 });
    const pose = punchPose(s);
    expect(pose.phase).toBe('idle');
    expect(pose.mode).toBeNull();
    expect(pose.armRx).toBe(0);
    expect(pose.armRz).toBe(0);
    expect(pose.handRetract).toBe(0);
    expect(pose.twist).toBe(0);
    expect(pose.scale).toEqual({ sy: 1, sxz: 1 });
    expect(pose.trail.active).toBe(false);
    expect(pose.trail.strength).toBe(0);
  });

  it('beginWindup works from idle, recover and strike; idempotent from windup', () => {
    const s1 = makePunchState();
    expect(beginWindup(s1).phase).toBe('windup');
    expect(beginWindup(s1).phase).toBe('windup'); // idempotent

    const s2 = makePunchState();
    releaseStrike(s2, 0, 'punch');
    advance(s2, 0.1); // still striking
    expect(beginWindup(s2).phase).toBe('windup');

    const s3 = makePunchState();
    releaseStrike(s3, 0, 'punch');
    advance(s3, 0.2); // into recover
    expect(beginWindup(s3).phase).toBe('windup');
  });

  it('releaseStrike locks mode from the explicit kind', () => {
    const s = strikeState(0.8, 'punch');
    expect(s.phase).toBe('strike');
    expect(s.lock.mode).toBe('punch');
    expect(s.lock.charge).toBeCloseTo(0.8, 9);
  });

  it('releaseStrike derives mode from charge when kind is omitted (≥0.2 = smash)', () => {
    expect(releaseStrike(makePunchState(), 0.1).lock.mode).toBe('punch');
    expect(releaseStrike(makePunchState(), 0.2).lock.mode).toBe('smash');
    expect(releaseStrike(makePunchState(), 1).lock.mode).toBe('smash');
  });

  it('releaseStrike works straight from idle (buffered/bot attack)', () => {
    const s = makePunchState();
    releaseStrike(s, 0, 'punch');
    expect(s.phase).toBe('strike');
  });

  it('releaseStrike clamps charge to [0,1]', () => {
    const s = releaseStrike(makePunchState(), 5, 'smash');
    expect(s.lock.charge).toBe(1);
  });

  it('interruptPunch drops to idle from every phase and clears the lock', () => {
    for (const phase of ['windup', 'strike', 'recover']) {
      const s = phase === 'windup' ? beginWindup(makePunchState()) : strikeState(1, 'smash');
      if (phase === 'windup') beginWindup(s);
      if (phase === 'recover') advance(s, 0.2);
      interruptPunch(s);
      expect(s.phase).toBe('idle');
      expect(s.lock.mode).toBeNull();
      expect(updatePunch(s, DT, 0).phase).toBe('idle');
    }
  });

  it('re-coil impulse applies even from idle (parry flinch while unengaged)', () => {
    const s = makePunchState();
    applyRecoilImpulse(s, parryRecoilStrength());
    expect(s.recoil.vel).toBeGreaterThan(0);
    const pose = updatePunch(s, DT);
    expect(pose.handRetract).toBeGreaterThan(0); // fist pulled inward
    expect(pose.twist).toBeLessThan(0);          // body flinches back
  });
});

describe('wind-up poses (charge-scaled telegraph)', () => {
  it('at charge 0 the windup is a bare jab: minPull only, zero twist/squash', () => {
    const s = beginWindup(makePunchState());
    const pose = punchPose(s, 0);
    expect(pose.phase).toBe('windup');
    expect(pose.handRetract).toBeCloseTo(PUNCH_DEFAULTS.punch.minPull, 9);
    expect(pose.twist).toBeCloseTo(0, 9);
    expect(pose.scale.sy).toBeCloseTo(1, 9);
    expect(pose.scale.sxz).toBeCloseTo(1, 9);
    expect(pose.trail.active).toBe(false);
  });

  it('pull, twist and squash are monotonic increasing in charge', () => {
    const pulls = [], twists = [], squashes = [];
    for (let c = 0; c <= 1.0001; c += 0.1) {
      const pose = punchPose(beginWindup(makePunchState()), c);
      pulls.push(pose.handRetract);
      twists.push(pose.twist);
      squashes.push(1 - pose.scale.sy);
    }
    for (let i = 1; i < pulls.length; i++) {
      expect(pulls[i]).toBeGreaterThanOrEqual(pulls[i - 1] - EPS);
      expect(twists[i]).toBeLessThanOrEqual(twists[i - 1] + EPS); // twist is negative, grows in magnitude
      expect(squashes[i]).toBeGreaterThanOrEqual(squashes[i - 1] - EPS);
    }
  });

  it('matches exact endpoints at charge 1', () => {
    const pose = punchPose(beginWindup(makePunchState()), 1);
    expect(pose.handRetract).toBeCloseTo(PUNCH_DEFAULTS.windup.pullMax, 9);
    expect(pose.twist).toBeCloseTo(-PUNCH_DEFAULTS.windup.twistMax, 9);
    expect(pose.scale.sy).toBeCloseTo(1 - PUNCH_DEFAULTS.windup.squashMax, 9);
  });

  it('twist is negative (right shoulder back — the load for a right punch)', () => {
    const pose = punchPose(beginWindup(makePunchState()), 0.6);
    expect(pose.twist).toBeLessThan(0);
  });

  it('preserves volume across charge samples (sy·sxz² ≈ 1)', () => {
    for (let c = 0; c <= 1.0001; c += 0.125) {
      const { scale } = punchPose(beginWindup(makePunchState()), c);
      expect(scale.sy * scale.sxz * scale.sxz).toBeCloseTo(1, 6);
    }
  });
});

describe('strike snap profile', () => {
  it('is front-loaded: most travel happens in the first half of the strike', () => {
    const s = strikeState(1, 'smash');
    let prev = null;
    let firstHalf = 0;
    let secondHalf = 0;
    let i = 0;
    while (s.phase === 'strike') {
      const pose = updatePunch(s, DT, 0);
      if (prev) {
        const d = Math.hypot(pose.head2d.y - prev.y, pose.head2d.z - prev.z);
        if (i < 14) firstHalf += d; else secondHalf += d;
      }
      prev = pose.head2d;
      i++;
    }
    expect(firstHalf).toBeGreaterThan(secondHalf * 1.8);
  });

  it('the fist crosses past rest before the impact marker and reaches full extension at the end', () => {
    const s = strikeState(1, 'smash');
    const dur = PUNCH_DEFAULTS.smash.strikeBase + PUNCH_DEFAULTS.smash.strikeCharge;
    let last = null;
    for (let t = 0; t <= dur + 1e-9; t += DT) {
      last = updatePunch(s, DT, 0);
      if (t < dur * PUNCH_DEFAULTS.strike.impactAt && t > dur * 0.2) {
        expect(last.head2d.z).toBeGreaterThan(0); // forward of the shoulder already
      }
    }
    const ext = PUNCH_DEFAULTS.smash.extensionRx;
    expect(last.head2d.z).toBeCloseTo(-Math.sin(ext) * PUNCH_DEFAULTS.armLen, 4);
    expect(last.head2d.y).toBeCloseTo(-Math.cos(ext) * PUNCH_DEFAULTS.armLen, 4);
  });

  it('punch strikes are shorter than smash strikes, and smash scales with charge', () => {
    const punch = strikeState(0, 'punch');
    let punchT = 0;
    while (punch.phase === 'strike') { updatePunch(punch, DT); punchT += DT; }
    expect(punchT).toBeCloseTo(PUNCH_DEFAULTS.punch.strikeDuration, 2);

    const smashHalf = strikeState(0.5, 'smash');
    let tHalf = 0;
    while (smashHalf.phase === 'strike') { updatePunch(smashHalf, DT); tHalf += DT; }
    const smashFull = strikeState(1, 'smash');
    let tFull = 0;
    while (smashFull.phase === 'strike') { updatePunch(smashFull, DT); tFull += DT; }
    expect(tHalf).toBeGreaterThan(punchT);
    expect(tFull).toBeGreaterThan(tHalf);
  });

  it('uncoils the twist during extension', () => {
    const s = strikeState(1, 'smash');
    const start = updatePunch(s, 0, 0);
    expect(Math.abs(start.twist)).toBeGreaterThan(0.1);
    let pose = start;
    for (let i = 0; i < 8; i++) pose = updatePunch(s, DT);
    expect(Math.abs(pose.twist)).toBeLessThan(Math.abs(start.twist));
  });
});

describe('recoil spring', () => {
  it('kicks on impulse, clamps, oscillates and settles', () => {
    const s = makePunchState();
    applyRecoilImpulse(s, 10);
    let maxDisp = 0;
    for (let i = 0; i < 120; i++) {
      updatePunch(s, DT);
      maxDisp = Math.max(maxDisp, s.recoil.disp);
    }
    expect(maxDisp).toBeLessThanOrEqual(PUNCH_DEFAULTS.recoil.maxDisp + EPS);
    expect(maxDisp).toBeGreaterThan(0);
    // settle over ~2s
    for (let i = 0; i < 120; i++) updatePunch(s, DT);
    expect(Math.abs(s.recoil.disp)).toBeLessThan(0.01);
    expect(Math.abs(s.recoil.vel)).toBeLessThan(0.01);
  });

  it('is underdamped by default (the disp overshoots and comes back)', () => {
    const s = makePunchState();
    applyRecoilImpulse(s, parryRecoilStrength());
    updatePunch(s, DT);
    const peak = s.recoil.disp;
    expect(peak).toBeGreaterThan(0);
    // step past the peak and watch it fall
    let fell = false;
    for (let i = 0; i < 200; i++) {
      updatePunch(s, DT);
      if (s.recoil.disp < peak * 0.5 && i > 3) { fell = true; break; }
    }
    expect(fell).toBe(true);
  });

  it('zero dt advances nothing', () => {
    const s = makePunchState();
    applyRecoilImpulse(s, 1);
    const before = { ...s.recoil };
    updatePunch(s, 0);
    expect(s.recoil).toEqual(before);
  });

  it('heavyRecoilStrength scales with mass above threshold and clamps', () => {
    expect(heavyRecoilStrength(1)).toBeCloseTo(PUNCH_DEFAULTS.recoil.heavyBase, 9);
    expect(heavyRecoilStrength(2.5)).toBeCloseTo(PUNCH_DEFAULTS.recoil.heavyBase, 9);
    expect(heavyRecoilStrength(3.5)).toBeGreaterThan(heavyRecoilStrength(2.5));
    expect(heavyRecoilStrength(20)).toBeCloseTo(PUNCH_DEFAULTS.recoil.heavyMax, 9);
    expect(heavyRecoilStrength(3.5, 1)).toBeGreaterThan(heavyRecoilStrength(3.5, 0));
  });

  it('parryRecoilStrength returns the default and honours opts', () => {
    expect(parryRecoilStrength()).toBeCloseTo(PUNCH_DEFAULTS.recoil.parryImpulse, 9);
    expect(parryRecoilStrength({ recoil: { parryImpulse: 2 } })).toBe(2);
  });
});

describe('trail', () => {
  it('is inactive in idle and windup, active in strike, fades in recover', () => {
    const idle = punchPose(makePunchState());
    expect(idle.trail.active).toBe(false);

    const w = punchPose(beginWindup(makePunchState()), 1);
    expect(w.trail.active).toBe(false);

    const s = strikeState(1, 'smash');
    const strike = updatePunch(s, DT);
    expect(strike.trail.active).toBe(true);
    expect(strike.trail.strength).toBeGreaterThan(0);
    expect(strike.trail.strength).toBeLessThanOrEqual(1);

    let recover = null;
    while (s.phase === 'strike') recover = updatePunch(s, DT);
    expect(recover.phase).toBe('recover');
    expect(recover.trail.active).toBe(true);
    // fade by the end of recover
    while (s.phase === 'recover') recover = updatePunch(s, DT);
    expect(s.phase).toBe('idle');
    expect(recover.trail.active).toBe(false);
  });

  it('head2d starts behind and ends forward for both modes', () => {
    for (const [charge, kind] of [[0, 'punch'], [1, 'smash']]) {
      const s = strikeState(charge, kind);
      const first = updatePunch(s, 0);
      expect(first.head2d.z).toBeLessThan(0); // chambered behind the shoulder
      let last = first;
      while (s.phase === 'strike') last = updatePunch(s, DT);
      expect(last.head2d.z).toBeGreaterThan(0); // extended forward
    }
  });

  it('trailPath fills the requested count with points on the chamber arc', () => {
    const s = strikeState(1, 'smash');
    const out = { points: Array.from({ length: 8 }, () => ({ y: 0, z: 0 })), count: 0 };
    trailPath(s, {}, out);
    expect(out.count).toBe(8);
    const first = out.points[0];
    const last = out.points[7];
    expect(first.z).toBeLessThan(0);
    expect(last.z).toBeGreaterThan(0);
    // every point sits on the arm arc: radius ∈ [armLen, armLen + pullMax]
    const minR = PUNCH_DEFAULTS.armLen - 1e-6;
    const maxR = PUNCH_DEFAULTS.armLen + PUNCH_DEFAULTS.windup.pullMax + 1e-6;
    for (const pt of out.points) {
      const r = Math.hypot(pt.y, pt.z);
      expect(r).toBeGreaterThanOrEqual(minR);
      expect(r).toBeLessThanOrEqual(maxR);
    }
  });

  it('trailPath creates its own points when no out is passed', () => {
    const s = strikeState(0, 'punch');
    const { points, count } = trailPath(s);
    expect(count).toBe(PUNCH_DEFAULTS.trail.points);
    expect(points).toHaveLength(PUNCH_DEFAULTS.trail.points);
    expect(points[count - 1].z).toBeGreaterThan(points[0].z);
  });
});

describe('full cycles & robustness', () => {
  it('a full charged smash cycle returns to a resting pose', () => {
    const s = beginWindup(makePunchState());
    advance(s, 0.6, 1);                 // wind up at full charge
    releaseStrike(s, 1, 'smash');
    advance(s, 0.6);                    // strike + recover
    expect(s.phase).toBe('idle');
    expect(s.lock.mode).toBeNull();
    const pose = punchPose(s);
    expect(pose.armRx).toBe(0);
    expect(pose.twist).toBe(0);
    expect(pose.scale).toEqual({ sy: 1, sxz: 1 });
    expect(pose.handRetract).toBe(0);
  });

  it('a tap jab (windup skipped) plays quickly and ends clean', () => {
    const s = releaseStrike(makePunchState(), 0, 'punch');
    advance(s, 0.4);
    expect(s.phase).toBe('idle');
    const pose = punchPose(s);
    expect(pose.scale.sy).toBeCloseTo(1, 6);
    expect(isFinite(pose.twist) && isFinite(pose.armRx) && isFinite(pose.handRetract)).toBe(true);
  });

  it('interrupting mid-strike zeroes the pose next frame (recoil aside)', () => {
    const s = strikeState(1, 'smash');
    updatePunch(s, DT * 3);
    interruptPunch(s);
    const pose = updatePunch(s, DT);
    expect(pose.phase).toBe('idle');
    expect(pose.armRx).toBe(0);
    expect(pose.armRz).toBe(0);
    expect(pose.twist).toBe(0);
    expect(pose.trail.active).toBe(false);
    expect(pose.scale.sy).toBeCloseTo(1, 6);
  });

  it('returns NaN-free poses across a noisy multi-attack session', () => {
    const s = makePunchState();
    let pose = null;
    const charges = [0, 0.3, 1, 0.05, 0.9, 0];
    for (let k = 0; k < 6; k++) {
      beginWindup(s);
      for (let i = 0; i < 20 && s.phase === 'windup'; i++) {
        pose = updatePunch(s, DT, charges[k]);
        expect(pose.phase).toBe('windup');
      }
      releaseStrike(s, charges[k], charges[k] >= 0.2 ? 'smash' : 'punch');
      for (let i = 0; i < 40; i++) pose = updatePunch(s, DT);
      expect(s.phase).toBe('idle');
      for (const v of [pose.armRx, pose.armRz, pose.handRetract, pose.twist, pose.scale.sy, pose.scale.sxz, pose.trail.strength, pose.head2d.y, pose.head2d.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('reuses and mutates the provided out object', () => {
    const s = beginWindup(makePunchState());
    const out = {
      phase: 'x', mode: 'x', charge: 9, armRx: 9, armRz: 9, handRetract: 9, twist: 9,
      scale: { sy: 9, sxz: 9 },
      trail: { active: true, strength: 9 },
      head2d: { y: 9, z: 9 },
    };
    const r = updatePunch(s, DT, 0.5, {}, out);
    expect(r).toBe(out);
    expect(out.phase).toBe('windup');
    expect(out.scale.sy).not.toBe(9);
    expect(out.trail.active).toBe(false);
  });
});
