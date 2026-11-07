// darwin.test.js — Dumb Ways to Die scoring (src/game/Darwin.js).
// The mode's whole promise is that the death is the score, so the scoring rules are the
// game rules: they get pinned here the way balance numbers are pinned in balance.test.js.
import { describe, it, expect } from 'vitest';
import { scoreDeath, receiptLine, spectacle, DARWIN_POINTS as P } from '../src/game/Darwin.js';

const plain = { kind: 'side', sudden: false, credited: true, height: 1, fallSpeed: 0 };

describe('scoreDeath', () => {
  it('gives a plain, credited, boring fall the base award and nothing else', () => {
    const s = scoreDeath(plain);
    expect(s.total).toBe(P.base);
    expect(s.beats).toHaveLength(0);
    expect(s.label).toBe('DARWIN');
  });

  it('pays for each independent fact once', () => {
    const s = scoreDeath({ ...plain, credited: false, kind: 'splash', height: 9, sudden: true });
    const ids = s.beats.map(b => b.id);
    expect(ids).toEqual(expect.arrayContaining(['splash', 'sky', 'self', 'sudden']));
    expect(s.total).toBe(P.base + P.splash + P.sky + P.self + P.sudden);
  });

  it('caps the fall-speed bonus instead of letting a rocket ride print points', () => {
    const s = scoreDeath({ ...plain, fallSpeed: 999 });
    const meteor = s.beats.find(b => b.id === 'meteor');
    expect(meteor.value).toBe(P.meteorCap);
    expect(scoreDeath({ ...plain, fallSpeed: -999 }).total).toBe(s.total);
  });

  it('caps hang time', () => {
    const air = scoreDeath({ ...plain, airTime: 600 }).beats.find(b => b.id === 'air');
    expect(air.value).toBe(P.airCap);
  });

  it('only counts a chain of two or more hits, and charges less for the deep ones', () => {
    expect(scoreDeath({ ...plain, chainHits: 1 }).beats.some(b => b.id === 'combo')).toBe(false);
    const three = scoreDeath({ ...plain, chainHits: 3 }).beats.find(b => b.id === 'combo');
    const five = scoreDeath({ ...plain, chainHits: 5 }).beats.find(b => b.id === 'combo');
    expect(three.value).toBe(P.comboPerHit * 3);
    expect(five.value).toBe(P.comboPerHit * 3 + P.comboLateHalf * 2);
    expect(five.label).toBe('5-HIT SEND-OFF');
  });

  it('caps the combo bonus so one absurd combo cannot decide the ladder', () => {
    const s = scoreDeath({ ...plain, chainHits: 40 }).beats.find(b => b.id === 'combo');
    expect(s.value).toBe(P.comboCap);
  });

  it('pays for dying with something still in your hands, more for a pupil', () => {
    const toy = scoreDeath({ ...plain, held: 'object' });
    const pupil = scoreDeath({ ...plain, held: 'dweeb' });
    expect(toy.beats.find(b => b.id === 'held').value).toBe(P.held);
    expect(pupil.label).toBe('STILL HOLDING A PUPIL');
    expect(pupil.total).toBe(toy.total);
  });

  it('pays for coming back from a previous KO, but not without limit', () => {
    expect(scoreDeath({ ...plain, rebounds: 1 }).beats.find(b => b.id === 'rebound').value).toBe(P.rebound);
    expect(scoreDeath({ ...plain, rebounds: 9 }).beats.find(b => b.id === 'rebound').value).toBe(P.reboundCap);
  });

  it('sorts the receipt biggest-first and keeps the funniest label on top', () => {
    const s = scoreDeath({ ...plain, kind: 'splash', height: 12, held: 'dweeb' });
    const values = s.beats.map(b => b.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    // A pupil in hand is the headline even though SKY DIVE is worth more.
    expect(s.label).toBe('STILL HOLDING A PUPIL');
  });

  it('records revenge only when the victor is the victim\'s own last victim', () => {
    expect(scoreDeath({ ...plain, revenge: true }).beats.some(b => b.id === 'revenge')).toBe(true);
    expect(scoreDeath({ ...plain, credited: false, revenge: true }).beats.some(b => b.id === 'revenge')).toBe(true);
  });

  it('is pure: same facts, same answer, and the facts object is not mutated', () => {
    const facts = { ...plain, chainHits: 4, held: 'object' };
    const copy = JSON.parse(JSON.stringify(facts));
    expect(scoreDeath(facts)).toEqual(scoreDeath(facts));
    expect(facts).toEqual(copy);
  });
});

describe('receiptLine', () => {
  it('names the top beats with their values', () => {
    const s = scoreDeath({ ...plain, credited: false, height: 9 });
    const line = receiptLine(s, 2);
    expect(line).toContain('SKY DIVE');
    expect(line).toContain(String(P.sky));
    expect(line.split(' · ')).toHaveLength(2);
  });

  it('says nothing for a boring death', () => {
    expect(receiptLine(scoreDeath(plain))).toBe('');
  });
});

describe('spectacle', () => {
  it('runs from 0 for a walk-off to 1 for a full circus', () => {
    expect(spectacle(scoreDeath(plain))).toBe(0);
    const huge = scoreDeath({
      kind: 'splash', sudden: true, credited: false, height: 14, fallSpeed: 60,
      airTime: 20, held: 'dweeb', chainHits: 6, rebounds: 4, revenge: true,
    });
    expect(spectacle(huge)).toBe(1);
  });

  it('is monotonic in the score', () => {
    const a = spectacle(scoreDeath({ ...plain, height: 9 }));
    const b = spectacle(scoreDeath({ ...plain, height: 9, sudden: true }));
    expect(b).toBeGreaterThan(a);
  });
});
