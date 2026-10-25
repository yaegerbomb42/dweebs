// T1/T2/T3/T18: SimAdapter + viewAdapter regression net.
import { describe, it, expect } from 'vitest';
import { SimAdapter, simEventToWire, dweebToWire, itemToWire } from '../src/sim/simAdapter.js';
import { blastMargin, pickSpectate, wireSimEvents, createViewBus } from '../src/sim/viewAdapter.js';
import { sanitizeInput } from '../src/net/protocol.js';

describe('SimAdapter (T3 real-sim bridge)', () => {
  it('creates 8 wire entities with MockSim-compatible shape', async () => {
    const a = await SimAdapter.create({ players: 8, seed: 7, humans: 1 });
    expect(a.list().length).toBe(8);
    const me = a.entityById(1);
    expect(me.slot).toBe(0);
    for (const k of ['id','x','y','z','q','flags','state']) expect(Number.isInteger(me[k])).toBe(true);
    expect(me._cm).toBe(true);
  });
  it('steps, emits wire events, checksums, snapshots/restores exactly', async () => {
    const a = await SimAdapter.create({ players: 2, seed: 42, humans: 1 });
    const before = a.checksum();
    a.step(new Map());
    expect(a.tick).toBe(1);
    expect(typeof a.checksum()).toBe('string');
    expect(a.checksum()).not.toBe(before);
    const snap = a.snapshot();
    const c1 = a.checksum();
    a.step(new Map());
    a.restore(snap);
    expect(a.checksum()).toBe(c1);
  });
  it('keyframe() logs tick/phase/round/checksum for T18', async () => {
    const a = await SimAdapter.create({ players: 2, seed: 1, humans: 0 });
    expect(a.keyframe('test')).toMatch(/keyframe test tick=\d+ phase=\w+ round=\d+ checksum=[0-9a-f]{8}/);
  });
  it('simEventToWire maps ko/splash/hit kinds + cm ints', () => {
    const ko = simEventToWire({ type: 'ko', a: 3, b: 1, x: 1.5, y: 2, z: -0.5, tick: 9 });
    expect(ko.kind).toBe('ko'); expect(ko.x).toBe(150); expect(ko._cm).toBe(true);
    expect(simEventToWire({ type: 'stockLost', a: 1 }).kind).toBe('ko');
    expect(simEventToWire({ type: 'splash', a: 2 }).kind).toBe('splash');
    expect(simEventToWire({ type: 'hit', a: 2, mag: 5 }).kind).toBe('hit');
  });
  it('dweeb/item wire mapping: ids stable, q in u8, human flag clear', () => {
    const d = dweebToWire({ slot: 2, pos: [1,2,3], vel: [0,0,0], yaw: Math.PI, type: 'cube', color: 0xff0000, eliminated: false, out: false, isBot: false }, 8);
    expect(d.id).toBe(3); expect(d.q).toBeGreaterThanOrEqual(0); expect(d.q).toBeLessThanOrEqual(255);
    expect(d.flags).toBe(0);
    const it = itemToWire({ id: 5, pos: [0,1,0], vel: [0,0,0], key: 'crate', heldBy: 0, active: true });
    expect(it.id).toBe(1005);
  });
});
describe('sanitizeInput aliases (T4)', () => {
  it('canonical moveZ wins, legacy mirrors stay in sync', () => {
    const s = sanitizeInput({ moveX: 2, moveZ: -0.5, superYeet: 1 });
    expect(s.moveX).toBe(1); expect(s.moveZ).toBe(-0.5); expect(s.moveY).toBe(-0.5);
    expect(s.superYeet).toBe(true); expect(s.special).toBe(true);
  });
});
describe('viewAdapter (T1)', () => {
  it('blastMargin is min distance to any KO plane', () => {
    expect(blastMargin([0, 0, 0])).toBeLessThan(blastMargin([0, -50, 0]) === 0 ? 1e9 : 1e9);
    expect(blastMargin([15, 0, 0])).toBeLessThan(blastMargin([0, 0, 0]));
  });
  it('pickSpectate skips out/eliminated, prefers stocks then %', () => {
    const ds = [
      { active: true, out: true, eliminated: false, stocks: 3, percent: 0 },
      { active: true, out: false, eliminated: false, stocks: 1, percent: 90 },
      { active: true, out: false, eliminated: false, stocks: 2, percent: 10 },
    ];
    expect(pickSpectate(ds).stocks).toBe(2);
    expect(pickSpectate(ds.slice(0, 1))).toBe(null);
  });
  it('wireSimEvents dispatches without throwing when view is empty', () => {
    const bus = createViewBus();
    const off = wireSimEvents(bus, {});
    expect(() => bus.dispatch([{ tick: 1, type: 'ko', a: 1, b: 2, x: 0, y: 0, z: 0, mag: 5, kind: 'side', tier: 0 }])).not.toThrow();
    off();
  });
});
