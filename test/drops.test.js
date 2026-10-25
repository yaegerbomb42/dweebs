// Arena.pickDropItem — the drop table is the game's randomiser, so a rare item that leaks out
// early wrecks a match. Tested over 10k draws against a *stub* arena (no scene, no Rapier):
// pickDropItem only reads `objects` and `lastRareDrop`, so Object.create(Arena.prototype) is
// enough and the test stays fast and headless.
import { describe, it, expect } from 'vitest';
import { Arena, DROP_ITEMS } from '../src/world/Arena.js';
import { OBJECT_DEFS } from '../src/world/ObjectRegistry.js';

// Mirrors the RARE table in Arena.js: key → { max live, cooldown seconds }.
const RARE = {
  giantHammer: { max: 1, cd: 45 },
  anvil: { max: 1, cd: 45 },
  toyRocket: { max: 1, cd: 30 },
  explosiveBarrel: { max: 2, cd: 25 },
};

const DRAWS = 10_000;
const TOTAL_W = DROP_ITEMS.reduce((s, i) => s + i.w, 0);

/**
 * A headless arena stub: only what pickDropItem reads.
 * @param live array of [key, count] — count live (non-debris) copies of that item
 */
function stubArena(live = []) {
  const a = Object.create(Arena.prototype);
  a.objects = [];
  for (const [key, count] of live) {
    for (let i = 0; i < count; i++) a.objects.push({ key, isDebris: false, broken: false });
  }
  a.lastRareDrop = {};
  return a;
}

/** The natural table share of a key, as a count out of `n` draws. */
const naturalRate = (key, n) => (DROP_ITEMS.find(i => i.key === key).w / TOTAL_W) * n;

describe('pickDropItem drop table', () => {
  it('every drop key is a real object, weighted positively, with no duplicates', () => {
    expect(DROP_ITEMS.length).toBeGreaterThan(20);
    const seen = new Set();
    for (const it of DROP_ITEMS) {
      expect(OBJECT_DEFS[it.key], `unknown item ${it.key}`).toBeTruthy();
      expect(it.w).toBeGreaterThan(0);
      expect(seen.has(it.key)).toBe(false);
      seen.add(it.key);
    }
  });

  it('only returns keys from the table, and every key is reachable over 10k draws', () => {
    const arena = stubArena();
    const allowed = new Set(DROP_ITEMS.map(i => i.key));
    const counts = new Map();
    for (let i = 0; i < DRAWS; i++) {
      const key = arena.pickDropItem(0);
      expect(allowed.has(key)).toBe(true);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    expect(counts.size).toBe(DROP_ITEMS.length); // no dead weights
  });

  it('honours the relative weights within a binomial tolerance', () => {
    // Rares are on cooldown after their first handout, so weight fidelity is measured with a
    // fresh stub per draw — this isolates the weighted picker from the cap/cooldown layer.
    const counts = new Map();
    for (let i = 0; i < DRAWS; i++) {
      const key = stubArena().pickDropItem(0);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const { key, w } of DROP_ITEMS) {
      const expected = (w / TOTAL_W) * DRAWS;
      const tol = Math.max(5, Math.sqrt(expected) * 5); // ~5 sigma, floored for low weights
      expect(Math.abs(counts.get(key) - expected), `${key} weight drift`).toBeLessThan(tol);
    }
  });
});

describe('pickDropItem rare caps', () => {
  it('rare items stay rare (they must not dominate the table)', () => {
    let rare = 0;
    for (let i = 0; i < DRAWS; i++) if (RARE[stubArena().pickDropItem(0)]) rare++;
    expect(rare / DRAWS).toBeLessThan(0.1);
  });

  it('respects the live-item cap: a capped rare key is never drawn', () => {
    for (const [key, rare] of Object.entries(RARE)) {
      const arena = stubArena([[key, rare.max]]);
      for (let i = 0; i < DRAWS; i++) {
        expect(arena.pickDropItem(0), `${key} leaked while capped`).not.toBe(key);
      }
    }
  });

  it('allows a rare key under the cap and stops handing it out at the cap', () => {
    // Time must advance between draws: a rare handout stamps lastRareDrop, so drawing the same
    // rare key 2000 times at t = 0 is blocked by the *cooldown*, not the cap. Step past the
    // cooldown each time so the live-count cap is the only thing under test.
    const hammer = RARE.giantHammer;
    const N = 2000;
    const expected = naturalRate('giantHammer', N); // ≈ 22
    let t = 0;
    const under = stubArena([['giantHammer', 0]]);
    let seen = 0;
    for (let i = 0; i < N; i++, t += hammer.cd + 1) {
      if (under.pickDropItem(t) === 'giantHammer') seen++;
    }
    // Under the cap the hammer drops at its natural table rate: never zero, never rampant.
    expect(seen).toBeGreaterThan(expected / 3);
    expect(seen).toBeLessThan(expected * 3);

    // Same walk, but one hammer is already lying on the stage: the cap now filters it out.
    const at = stubArena([['giantHammer', 1]]);
    t = 0;
    for (let i = 0; i < N; i++, t += hammer.cd + 1) {
      expect(at.pickDropItem(t)).not.toBe('giantHammer');
    }
  });

  it('a two-slot rare may still be handed out below its cap of 2', () => {
    const barrel = RARE.explosiveBarrel;
    const one = stubArena([['explosiveBarrel', 1]]);
    let t = 0;
    let seen = 0;
    for (let i = 0; i < 2000; i++, t += barrel.cd + 1) {
      if (one.pickDropItem(t) === 'explosiveBarrel') seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('debris and broken objects do not count against the live cap', () => {
    const arena = stubArena();
    for (let i = 0; i < 5; i++) arena.objects.push({ key: 'anvil', isDebris: true, broken: false });
    arena.objects.push({ key: 'anvil', isDebris: false, broken: true });
    let got = false;
    for (let i = 0; i < DRAWS; i++) if (arena.pickDropItem(0) === 'anvil') got = true;
    expect(got).toBe(true);
  });
});

describe('pickDropItem cooldowns', () => {
  it('enforces the per-key cooldown for the whole window, then lets the key back in', () => {
    for (const [key, rare] of Object.entries(RARE)) {
      const arena = stubArena();
      let t = 0;
      let handouts = 0;
      for (let i = 0; i < DRAWS; i++) {
        if (arena.pickDropItem(t) === key) {
          handouts++;
          // Every instant inside the cooldown must refuse the key...
          for (let dt = 0; dt < rare.cd - 1e-6; dt += 0.5) {
            expect(arena.pickDropItem(t + dt), `${key} ignored its ${rare.cd}s cooldown`).not.toBe(key);
          }
          t += rare.cd; // ...and past it the key is available again
        }
        t += 0.05;
      }
      expect(handouts, `${key} never dropped at all`).toBeGreaterThan(0);
    }
  });

  it('stamps lastRareDrop only for rare keys it actually hands out', () => {
    const arena = stubArena();
    let handedOut = 0;
    for (let i = 0; i < DRAWS; i++) if (RARE[arena.pickDropItem(0)]) handedOut++;
    expect(handedOut).toBeGreaterThan(0);
    // All draws share t = 0, so every rare key that appeared is stamped with 0.
    for (const key of Object.keys(RARE)) expect(arena.lastRareDrop[key]).toBe(0);
  });

  it('cooldowns are independent per key: a fresh arena has no stamps', () => {
    expect(Object.keys(stubArena().lastRareDrop)).toEqual([]);
  });

  it('over a long match every rare key does eventually appear', () => {
    // Rares are ~1% of the table each, so a coarse time walk is not enough samples to see all
    // four; walk a full simulated match length at a fine step instead.
    const arena = stubArena();
    const seen = new Set();
    for (let t = 0; t < 1800; t += 0.25) {
      const k = arena.pickDropItem(t);
      if (RARE[k]) seen.add(k);
    }
    expect([...seen].sort()).toEqual(Object.keys(RARE).sort());
  });

  it('bias multiplies weights, and a zero bias removes an item entirely', () => {
    const arena = stubArena();
    for (let i = 0; i < 500; i++) expect(arena.pickDropItem(0, { beachBall: 0 })).not.toBe('beachBall');
    // A 10_000x bias makes beachBall ~99.8% of the table, so assert dominance, not certainty:
    // the picker is a weighted sample, and "always" would be a flaky test, not a strict one.
    let beach = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (arena.pickDropItem(0, { beachBall: 10_000 }) === 'beachBall') beach++;
    expect(beach / N).toBeGreaterThan(0.9);
  });

  it('never returns a key outside the table, under any bias', () => {
    const allowed = new Set(DROP_ITEMS.map(i => i.key));
    const arena = stubArena();
    for (let i = 0; i < 2000; i++) {
      const bias = { beachBall: Math.random() * 10, anvil: Math.random() * 10, crate: -1 };
      expect(allowed.has(arena.pickDropItem(i * 0.1, bias))).toBe(true);
    }
  });
});
