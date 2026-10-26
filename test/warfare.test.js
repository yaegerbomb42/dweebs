// Dweeb Warfare: unit balance, damage, wave scaling, AI behaviours and the battle loop.
// All of this runs the real headless sim (src/sim/warfare*.js), so the numbers it pins are the
// numbers players feel.
import { describe, it, expect } from 'vitest';
import { UNIT_TYPES, RECRUITABLE, COUNTER_OF, counterMult, stats, bounty } from '../src/sim/warfareUnits.js';
import { computeDamage, splashFalloff, knockback, COVER_MULT } from '../src/sim/warfareDamage.js';
import { FINAL_WAVE, isBossWave, waveComposition, waveScaling, waveBudget, waveThreat, unlockedTypes } from '../src/sim/warfareWaves.js';
import { pickTarget, shouldRetreat, flankGoal, commanderDecide } from '../src/sim/warfareAI.js';
import { createBattle, stepBattle, spawnUnit, battleHash, applyCommand, armyCounts, PREP_FIRST } from '../src/sim/warfareBattle.js';
import { duel } from '../src/sim/warfareDuel.js';

const SEEDS = [1, 2, 3, 4, 5];
const wins = (a, b, budget = 280) => SEEDS.filter(seed => duel(a, b, { seed, budget }).winner === 'blue').length;

const unit = (o) => ({ id: 1, team: 'blue', type: 'shield', x: 0, z: 0, vx: 0, vz: 0, hp: 100, maxHp: 100, alive: true, carriedBy: 0, targetId: 0, radius: 0.5, ...o });

describe('warfare units', () => {
  it('every unit has sane stats and a recruitable counter', () => {
    for (const [type, s] of Object.entries(UNIT_TYPES)) {
      expect(s.hp, type).toBeGreaterThan(0);
      expect(s.speed, type).toBeGreaterThan(0);
      expect(s.cost, type).toBeGreaterThan(0);
      expect(RECRUITABLE, type).toContain(COUNTER_OF[type]);
    }
    expect(() => stats('nope')).toThrow();
    expect(bounty('rocket')).toBe(16);
  });
  it('counter multipliers express the triangle', () => {
    expect(counterMult('rocket', 'shield')).toBeLessThan(1);
    expect(counterMult('shield', 'rocket')).toBeGreaterThan(1);
    expect(counterMult('kami', 'shield')).toBeGreaterThan(1);
    expect(counterMult('stealer', 'kami')).toBeGreaterThan(1);
    expect(counterMult('rocket', 'stealer')).toBeGreaterThan(1);
    expect(counterMult('boss', 'shield')).toBe(1);
  });
});

describe('warfare balance (real equal-cost duels)', () => {
  it.each([
    ['shield', 'rocket'], ['rocket', 'stealer'], ['stealer', 'kami'], ['kami', 'shield'],
  ])('%s beats %s cost-for-cost', (a, b) => {
    expect(wins(a, b)).toBeGreaterThanOrEqual(4);
    expect(SEEDS.filter(seed => duel(b, a, { seed }).winner === 'red').length).toBeGreaterThanOrEqual(4);
  });
  it('no dominant unit: every recruitable loses to something and beats something', () => {
    for (const a of RECRUITABLE) {
      const others = RECRUITABLE.filter(b => b !== a);
      const beatenBy = others.filter(b => wins(b, a) >= 4);
      const beats = others.filter(b => wins(a, b) >= 4);
      expect(beatenBy.length, `${a} is never beaten`).toBeGreaterThan(0);
      expect(beats.length, `${a} beats nothing`).toBeGreaterThan(0);
    }
  });
  it('counters hold at a bigger budget too', () => {
    expect(wins('shield', 'rocket', 500)).toBeGreaterThanOrEqual(3);
    expect(wins('kami', 'shield', 500)).toBeGreaterThanOrEqual(4);
    expect(wins('stealer', 'kami', 500)).toBeGreaterThanOrEqual(4);
  });
});

describe('warfare damage', () => {
  it('splash falls off with distance and stops at the edge', () => {
    expect(splashFalloff(0, 4)).toBe(1);
    expect(splashFalloff(2, 4)).toBeLessThan(1);
    expect(splashFalloff(3, 4)).toBeLessThan(splashFalloff(1, 4));
    expect(splashFalloff(4, 4)).toBe(0);
  });
  it('applies counters, wave scaling and shield cover', () => {
    const base = computeDamage('rocket', 'stealer');
    expect(base).toBeCloseTo(42 * 1.6, 6);
    expect(computeDamage('rocket', 'stealer', { dmgMul: 1.5 })).toBeCloseTo(base * 1.5, 6);
    expect(computeDamage('rocket', 'stealer', { covered: true })).toBeCloseTo(base * COVER_MULT, 6);
    expect(computeDamage('rocket', 'shield', { covered: true })).toBeCloseTo(computeDamage('rocket', 'shield'), 6);
  });
  it('heavy units get knocked back less, and knockback is capped', () => {
    expect(knockback(50, 1)).toBeGreaterThan(knockback(50, 7));
    expect(knockback(5000, 1)).toBeLessThanOrEqual(9);
  });
});

describe('warfare waves', () => {
  it('boss every 5th wave, final wave is a boss wave', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(isBossWave)).toEqual([false, false, false, false, true, false, true]);
    expect(isBossWave(FINAL_WAVE)).toBe(true);
    expect(waveComposition(5)[0]).toBe('boss');
    expect(waveComposition(4)).not.toContain('boss');
  });
  it('waves escalate: more units, more HP, harder hits', () => {
    for (let n = 2; n <= FINAL_WAVE; n++) {
      const a = waveThreat(n - 1), b = waveThreat(n);
      expect(b.hp, `wave ${n} hp`).toBeGreaterThan(a.hp * (isBossWave(n - 1) ? 0.4 : 1));
      if (!isBossWave(n) && !isBossWave(n - 1)) expect(b.count, `wave ${n} count`).toBeGreaterThanOrEqual(a.count);
      expect(waveScaling(n).hpMul).toBeGreaterThan(waveScaling(n - 1).hpMul);
      expect(waveScaling(n).dmgMul).toBeGreaterThan(waveScaling(n - 1).dmgMul);
      expect(waveBudget(n)).toBeGreaterThan(waveBudget(n - 1));
    }
  });
  it('compositions stay in budget and only use unlocked types', () => {
    for (let n = 1; n <= 12; n++) {
      const comp = waveComposition(n).filter(t => t !== 'boss' && !(n >= 10 && t === 'brute' && isBossWave(n)));
      const spent = comp.reduce((s, t) => s + stats(t).cost, 0);
      expect(spent).toBeLessThanOrEqual(waveBudget(n));
      for (const t of comp) expect(unlockedTypes(n)).toContain(t);
    }
    expect(waveComposition(7)).toEqual(waveComposition(7));
  });
});

describe('warfare AI', () => {
  it('rockets prefer a clump over a lone closer target', () => {
    const r = unit({ type: 'rocket' });
    const lone = unit({ id: 2, team: 'red', type: 'kami', x: 8 });
    const clump = [3, 4, 5, 6].map((id, i) => unit({ id, team: 'red', type: 'kami', x: 12, z: i * 0.8 }));
    expect(pickTarget(r, [lone, ...clump]).id).not.toBe(2);
  });
  it('stealers and sneaks hunt the backline instead of the nearer shield', () => {
    const shield = unit({ id: 2, team: 'red', type: 'shield', x: 4 });
    const rocket = unit({ id: 3, team: 'red', type: 'rocket', x: 10 });
    expect(pickTarget(unit({ type: 'stealer' }), [shield, rocket]).id).toBe(3);
    expect(pickTarget(unit({ type: 'sneak' }), [shield, rocket]).id).toBe(3);
    expect(pickTarget(unit({ type: 'shield' }), [shield, rocket]).id).toBe(2);
  });
  it('ignores enemies outside aggro and carried enemies', () => {
    const far = unit({ id: 2, team: 'red', x: 60 });
    const carried = unit({ id: 3, team: 'red', x: 2, carriedBy: 9 });
    expect(pickTarget(unit({}), [far, carried])).toBe(null);
  });
  it('retreats fragile units when low, never kamis or bosses', () => {
    expect(shouldRetreat(unit({ type: 'rocket', hp: 20 }))).toBe(true);
    expect(shouldRetreat(unit({ type: 'rocket', hp: 90 }))).toBe(false);
    expect(shouldRetreat(unit({ type: 'kami', hp: 1 }))).toBe(false);
    expect(shouldRetreat(unit({ type: 'boss', hp: 1 }))).toBe(false);
  });
  it('flankers aim beside a far target, straight at a near one', () => {
    const u = unit({ flankSide: 1 });
    const g = flankGoal(u, 20, 0);
    expect(Math.abs(g.z)).toBeGreaterThan(4);
    expect(flankGoal(u, 3, 0)).toEqual({ x: 3, z: 0 });
    expect(Math.sign(flankGoal(unit({ flankSide: -1 }), 20, 0).z)).toBe(-Math.sign(g.z));
  });
  it('the AI commander buys the counter to what it faces', () => {
    const st = createBattle({ mode: 'versus', army: false, coins: 500 });
    for (let i = 0; i < 6; i++) spawnUnit(st, 'blue', 'rocket', { x: -10, z: i });
    st.tick = 45 * 1 + 7; // a decision tick for red, not a cycle tick
    const cmds = commanderDecide(st, 'red');
    expect(cmds.find(c => c.type === 'recruit').unit).toBe('shield');
  });
});

describe('warfare battle loop', () => {
  const run = (seed, ticks, policy) => {
    const st = createBattle({ seed });
    for (let i = 0; i < ticks && !st.winner; i++) stepBattle(st, policy ? policy(st) : []);
    return st;
  };
  const mix = ['shield', 'rocket', 'shield', 'kami', 'rocket', 'stealer'];
  const mixPolicy = () => { let k = 0; return st => {
    const c = [];
    if (st.tick % 30 === 0 && st.coins.blue >= 40) c.push({ type: 'recruit', team: 'blue', unit: mix[k++ % mix.length] });
    if (st.phase === 'prep' && st.coins.blue < 40) c.push({ type: 'startWave' });
    return c;
  }; };

  it('is deterministic: same seed + same commands ⇒ same hash', () => {
    const a = run(7, 3000, mixPolicy()), b = run(7, 3000, mixPolicy());
    expect(battleHash(a)).toBe(battleHash(b));
    expect(battleHash(run(8, 3000, mixPolicy()))).not.toBe(battleHash(a));
  });
  it('starts in prep, startWave skips the countdown, waves spawn from the east', () => {
    const st = createBattle({ seed: 1 });
    expect(st.phase).toBe('prep');
    expect(st.prepTicks).toBe(PREP_FIRST);
    stepBattle(st, [{ type: 'startWave' }]);
    stepBattle(st);
    expect(st.phase).toBe('battle');
    expect(st.wave).toBe(1);
    for (let i = 0; i < 60; i++) stepBattle(st);
    expect(st.units.some(u => u.team === 'red' && u.x > 20)).toBe(true);
  });
  it('recruiting costs coins and cannot overspend', () => {
    const st = createBattle({ seed: 1, coins: 50 });
    expect(applyCommand(st, { type: 'recruit', team: 'blue', unit: 'rocket' })).toBe(true);
    expect(st.coins.blue).toBe(10);
    expect(applyCommand(st, { type: 'recruit', team: 'blue', unit: 'shield' })).toBe(false);
    expect(applyCommand(st, { type: 'recruit', team: 'red', unit: 'kami' })).toBe(false); // defense: red never buys
    expect(applyCommand(st, { type: 'recruit', team: 'blue', unit: 'boss' })).toBe(false);
  });
  it('a commander who does nothing loses early; a sensible mix gets deep', () => {
    const idle = run(1, 30 * 900);
    expect(idle.phase).toBe('lost');
    expect(idle.wave).toBeLessThanOrEqual(4);
    const busy = run(1, 30 * 1500, mixPolicy());
    expect(busy.wave).toBeGreaterThanOrEqual(5); // reaches the first boss
    expect(busy.stats.blue.kills).toBeGreaterThan(12);
  });
  it('the boss arrives on wave 5 with escorts', () => {
    const st = createBattle({ seed: 2 });
    st.wave = 4; st.prepTicks = 0;
    const seen = [];
    for (let i = 0; i < 30; i++) { stepBattle(st); seen.push(...st.events.map(e => e.type)); }
    expect(st.wave).toBe(5);
    expect(seen).toContain('boss');
    expect(st.units.some(u => u.type === 'boss' && u.maxHp > stats('boss').hp)).toBe(true);
  });
  it('clearing the final wave wins and pays out', () => {
    const st = createBattle({ seed: 3 });
    st.wave = FINAL_WAVE; st.phase = 'battle'; st.spawnQueue = [];
    st.units = st.units.filter(u => u.team === 'blue');
    stepBattle(st);
    expect(st.phase).toBe('won');
    expect(st.winner).toBe('blue');
    expect(st.events.map(e => e.type)).toContain('win');
  });
  it('emits the events the view needs: hits, deaths, fire, explode, retreat, convert', () => {
    const types = new Set();
    const s2 = createBattle({ seed: 4 });
    const pol = mixPolicy();
    for (let i = 0; i < 30 * 400 && !s2.winner; i++) { stepBattle(s2, pol(s2)); for (const e of s2.events) types.add(e.type); }
    for (const t of ['hit', 'death', 'fire', 'explode', 'retreat', 'convert', 'waveStart', 'waveClear', 'fortHit']) expect(types, t).toContain(t);
  });
  it('versus: two AI commanders fight to a winner', () => {
    const st = createBattle({ seed: 5, mode: 'versus' });
    for (let i = 0; i < 30 * 600 && !st.winner; i++) stepBattle(st, [...commanderDecide(st, 'blue'), ...commanderDecide(st, 'red')]);
    expect(st.winner === 'blue' || st.winner === 'red').toBe(true);
    expect(armyCounts(st)[st.winner]).toBeGreaterThan(0);
  });
});
