// handRig tests — expressive hands & reach (Round 1).
// Pure module contract: no three.js, no DOM, no Math.random, plain {x,y,z} vectors.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HAND_SHAPES, DEFAULT_HAND_SHAPE, handShapeFor,
  decideOneOrTwoHanded, HEAVY_MASS,
  squashOnAccel, defaultGripPoints, GRIP_OVERRIDES,
  selectGripPoints, solveReach,
  springStep, makeSpringState, ARM_LENGTHS,
} from '../src/player/handRig.js';
import { OBJECT_DEFS, getObjectDef } from '../src/world/ObjectRegistry.js';
import { VALID_TYPES } from '../src/player/characterList.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('handRig purity', () => {
  it('imports nothing from three.js and touches no DOM/random', () => {
    const src = readFileSync(join(ROOT, 'src/player/handRig.js'), 'utf8');
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

describe('hand shapes', () => {
  it('defines a shape for every roster archetype', () => {
    for (const t of VALID_TYPES) {
      expect(HAND_SHAPES[t], `missing hand shape for ${t}`).toBeDefined();
      expect(HAND_SHAPES[t].kind).toBeTypeOf('string');
      expect(HAND_SHAPES[t].scale).toBeGreaterThan(0);
      expect(HAND_SHAPES[t].squash).toBeGreaterThan(0);
    }
  });

  it('falls back to the stock mitt for unknown types', () => {
    expect(handShapeFor('made-up')).toEqual(DEFAULT_HAND_SHAPE);
  });
});

describe('one/two-hand decision', () => {
  it('is one-handed below the heavy threshold', () => {
    expect(decideOneOrTwoHanded(0)).toBe('one');
    expect(decideOneOrTwoHanded(1.4)).toBe('one');   // freeze ray
    expect(decideOneOrTwoHanded(2.4)).toBe('one');
  });

  it('is two-handed at and above the heavy threshold', () => {
    expect(decideOneOrTwoHanded(HEAVY_MASS)).toBe('two');
    expect(decideOneOrTwoHanded(3)).toBe('two');       // hammer
    expect(decideOneOrTwoHanded(6)).toBe('two');       // anvil
    expect(decideOneOrTwoHanded(100)).toBe('two');
  });

  it('honours a custom threshold', () => {
    expect(decideOneOrTwoHanded(4, 5)).toBe('one');
    expect(decideOneOrTwoHanded(5, 5)).toBe('two');
  });
});

describe('squash on accel', () => {
  it('stays at rest when velocity is constant', () => {
    const v = { x: 2, y: 0, z: 0 };
    const s = squashOnAccel(v, v, 1 / 60);
    expect(s.sy).toBeCloseTo(1, 6);
    expect(s.sxz).toBeCloseTo(1, 6);
  });

  it('grows with acceleration and keeps volume roughly', () => {
    const slow = squashOnAccel({ x: 5.2, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 1 / 60);
    const fast = squashOnAccel({ x: 7, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 1 / 60);
    expect(fast.sy).toBeLessThan(slow.sy);
    expect(fast.sy).toBeLessThan(1);
    expect(fast.sxz).toBeGreaterThan(1);
    expect(fast.sy * fast.sxz * fast.sxz).toBeCloseTo(1, 6);
  });

  it('clamps at the maximum squash', () => {
    const s = squashOnAccel({ x: 999, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1e-3);
    expect(s.sy).toBeGreaterThanOrEqual(1 - 0.45);
  });
});

describe('grip points', () => {
  it('derives points for every object def', () => {
    for (const key of Object.keys(OBJECT_DEFS)) {
      const def = getObjectDef(key);
      const g = defaultGripPoints(def);
      expect(g.oneHand.length, `${key} needs a one-hand grip`).toBeGreaterThan(0);
      for (const p of g.oneHand) {
        for (const a of ['x', 'y', 'z']) expect(Number.isFinite(p[a])).toBe(true);
      }
    }
  });

  it('overrides target the marquee objects that exist in the registry', () => {
    for (const key of Object.keys(GRIP_OVERRIDES)) {
      expect(getObjectDef(key), `override key ${key} not in ObjectRegistry`).toBeDefined();
    }
  });

  it('selects one point for light one-handed holds', () => {
    const def = getObjectDef('freezeRay'); // mass 1.4
    const { mode, points } = selectGripPoints(def, def.mass, { key: 'freezeRay' });
    expect(mode).toBe('one');
    expect(points).toHaveLength(1);
    expect(points[0].z).toBeGreaterThan(0); // forward on the body
  });

  it('selects two distinct points for heavy two-handed holds', () => {
    for (const key of ['anvil', 'giantHammer', 'cinderBlock', 'couch', 'table', 'barrel']) {
      const def = getObjectDef(key);
      expect(def.mass, key).toBeGreaterThanOrEqual(HEAVY_MASS);
      const { mode, points } = selectGripPoints(def, def.mass, { key });
      expect(mode, key).toBe('two');
      expect(points.length, key).toBe(2);
      expect(points[0]).not.toEqual(points[1]);
    }
  });

  it('mirrors a lone one-hand point when a heavy hold needs two', () => {
    const def = { ...getObjectDef('bowlingBall'), gripPoints: { oneHand: [{ x: 0.1, y: -0.1, z: 0.2 }], twoHand: [] } };
    const { mode, points } = selectGripPoints(def, 2.2, { key: 'bowlingBall' });
    // bowlingBall is 2.2 → light → one point; force heavy via threshold to exercise the mirror
    const heavy = selectGripPoints(def, 3, { key: 'bowlingBall' });
    expect(mode).toBe('one');
    expect(heavy.mode).toBe('two');
    expect(heavy.points).toHaveLength(2);
    expect(heavy.points[1]).not.toBe(heavy.points[0]);
    expect(heavy.points[1].x).toBe(-heavy.points[0].x);
    expect(heavy.points[1].y).toBe(heavy.points[0].y);
    expect(heavy.points[1].z).toBe(heavy.points[0].z);
  });

  it('prefers explicit def.gripPoints over overrides and derivation', () => {
    const def = { ...getObjectDef('giantHammer'), gripPoints: { oneHand: [{ x: 9, y: 9, z: 9 }], twoHand: [] } };
    const { points } = selectGripPoints(def, 3, { key: 'giantHammer' });
    expect(points[0]).toEqual({ x: 9, y: 9, z: 9 });
  });
});

describe('reach solve', () => {
  const shoulder = { x: 0, y: 0.5, z: 0 };

  it('places the hand exactly on a reachable target', () => {
    const target = { x: 0.2, y: 0.35, z: 0.05 };
    const r = solveReach(shoulder, target, {});
    expect(r.hand.x).toBeCloseTo(target.x, 9);
    expect(r.hand.y).toBeCloseTo(target.y, 9);
    expect(r.hand.z).toBeCloseTo(target.z, 9);
    expect(r.clamped).toBe(false);
  });

  it('clamps the hand to max arm length for far targets', () => {
    const target = { x: 12, y: 12, z: 12 };
    const r = solveReach(shoulder, target, {});
    const len = Math.hypot(r.hand.x, r.hand.y - 0.5, r.hand.z);
    const { upper, forearm } = ARM_LENGTHS;
    expect(len).toBeCloseTo(upper + forearm, 6);
    expect(r.clamped).toBe(true);
  });

  it('keeps the reach direction on the line from shoulder to the clamped target', () => {
    const target = { x: 0.3, y: 0.3, z: 0.1 };
    const r = solveReach(shoulder, target, {});
    const dir = Math.atan2(r.hand.x, r.hand.z);
    const expectDir = Math.atan2(target.x, target.z);
    expect(dir).toBeCloseTo(expectDir, 6);
  });

  it('bows the elbow off the shoulder-hand line and flips the bow with side', () => {
    const target = { x: 0.2, y: 0.35, z: 0.05 };
    const l = solveReach(shoulder, target, { side: 1 });
    const r = solveReach(shoulder, target, { side: -1 });
    // Elbow positions differ (opposite bows) while the hand lands on the same point
    expect(l.elbow).not.toEqual(r.elbow);
    expect(l.hand).toEqual(r.hand);

    // Both elbows sit off the shoulder→hand line (the bent-arm read)
    const ax = l.hand.x - shoulder.x, ay = l.hand.y - shoulder.y, az = l.hand.z - shoulder.z;
    const len2 = ax * ax + ay * ay + az * az;
    for (const { elbow } of [l, r]) {
      const ex = elbow.x - shoulder.x, ey = elbow.y - shoulder.y, ez = elbow.z - shoulder.z;
      const t = (ex * ax + ey * ay + ez * az) / len2;
      const px = ex - t * ax, py = ey - t * ay, pz = ez - t * az;
      expect(Math.hypot(px, py, pz)).toBeGreaterThan(0.015);
    }
  });

  it('never returns NaN for degenerate targets', () => {
    for (const target of [{ x: 0, y: 0.5, z: 0 }, { x: 0, y: -0.5, z: 0 }]) {
      const r = solveReach(shoulder, target, {});
      for (const v of [r.hand.x, r.hand.y, r.hand.z, r.elbow.x, r.elbow.y, r.elbow.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('spring step', () => {
  it('converges to the target and settles', () => {
    const state = makeSpringState(0, 0, 0);
    const target = { x: 0.5, y: 0, z: 0 };
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) springStep(state, target, dt);
    expect(state.current.x).toBeCloseTo(target.x, 3);
    expect(state.current.y).toBeCloseTo(target.y, 6);
    expect(state.current.z).toBeCloseTo(target.z, 6);
    expect(Math.abs(state.vel.x)).toBeLessThan(0.05);
  });

  it('tracks a moving target with bounded lag', () => {
    const state = makeSpringState(0, 0, 0);
    const dt = 1 / 60;
    for (let i = 0; i < 240; i++) {
      springStep(state, { x: i * dt * 0.5, y: 0, z: 0 }, dt);
    }
    // A damped spring chasing a constant-velocity target settles with a fixed lag
    // (c/k · v = 0.1 here) — it should be close, and never fly past by much.
    expect(Math.abs(state.current.x - 2)).toBeLessThan(0.15);
    expect(Math.abs(state.current.x - 2)).toBeLessThan(0.2);
  });

  it('does not blow up at hiccup frame rates', () => {
    const state = makeSpringState(0, 0, 0);
    springStep(state, { x: 10, y: 0, z: 0 }, 0.1);
    springStep(state, { x: 10, y: 0, z: 0 }, 0.1);
    for (const v of [state.current.x, state.current.y, state.current.z, state.vel.x, state.vel.y, state.vel.z]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(Math.abs(state.current.x)).toBeLessThan(50);
  });

  it('mutates and returns the same state object', () => {
    const state = makeSpringState(0, 0, 0);
    const ret = springStep(state, { x: 1, y: 0, z: 0 }, 1 / 60);
    expect(ret).toBe(state);
    expect(state.current.x).not.toBe(0);
  });
});
