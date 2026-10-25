// A water dunk and a side blast must never share a KO line — the wet/dry pools are the whole
// point of the announcer. These tests are statistical over many draws because koLine picks
// randomly (and avoids repeating the previous line within a pool).
import { describe, it, expect } from 'vitest';
import { koLine, playerKOWord, winBanners, ALL_LINES } from '../src/game/Announcer.js';

const A = '<b>Alice</b>', V = '<b>Bob</b>';

/** Every context that koLine can branch on, in priority order. */
const CONTEXTS = [
  { name: 'plain', ctx: {} },
  { name: 'self', ctx: { self: true } },
  { name: 'revenge', ctx: { revenge: true } },
  { name: 'trick', ctx: { trick: true } },
  { name: 'sd', ctx: { sd: true } },
  { name: 'style', ctx: { styleTier: 2 } },
];

describe('koLine wet vs dry distinctness', () => {
  it('a water dunk and a side blast never share a line, in any context', () => {
    for (const { name, ctx } of CONTEXTS) {
      const wet = new Set();
      const dry = new Set();
      for (let i = 0; i < 500; i++) {
        wet.add(koLine({ ...ctx, kind: 'splash' }, A, V).line);
        dry.add(koLine({ ...ctx, kind: 'side' }, A, V).line);
      }
      const overlap = [...wet].filter(l => dry.has(l));
      expect(overlap, `context "${name}" shared ${overlap.length} line(s)`).toEqual([]);
      expect(wet.size).toBeGreaterThan(1);
      expect(dry.size).toBeGreaterThan(1);
    }
  });

  it('top blast (star) is also its own pool', () => {
    const star = new Set();
    const side = new Set();
    for (let i = 0; i < 500; i++) {
      star.add(koLine({ kind: 'star' }, A, V).line);
      side.add(koLine({ kind: 'side' }, A, V).line);
    }
    expect([...star].filter(l => side.has(l))).toEqual([]);
  });

  it('every context has at least two wet and two dry lines to pick from', () => {
    for (const { name, ctx } of CONTEXTS) {
      const wet = new Set(), dry = new Set();
      for (let i = 0; i < 400; i++) {
        wet.add(koLine({ ...ctx, kind: 'splash' }, A, V).line);
        dry.add(koLine({ ...ctx, kind: 'side' }, A, V).line);
      }
      expect(wet.size, name).toBeGreaterThanOrEqual(2);
      expect(dry.size, name).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('koLine behaviour', () => {
  it('fills in the name tags and leaves no placeholders', () => {
    for (let i = 0; i < 200; i++) {
      const { line } = koLine({ kind: i % 2 ? 'splash' : 'side' }, A, V);
      expect(line).not.toMatch(/\{[av]\}/);
      // Some lines name only the victim (self-KOs) or only the attacker — what matters is
      // that no raw {a}/{v} survives and at least one real tag lands.
      expect(line.includes(A) || line.includes(V)).toBe(true);
    }
  });

  it('reports the context that outranked the plain line', () => {
    expect(koLine({ kind: 'splash' }, A, V).context).toBe('splash');
    expect(koLine({ kind: 'side', trick: true }, A, V).context).toBe('trick');
    expect(koLine({ kind: 'splash', self: true }, A, V).context).toBe('self');
    expect(koLine({ kind: 'side', styleTier: 3 }, A, V).context).toBe('style');
    // self outranks revenge, revenge outranks trick
    expect(koLine({ kind: 'side', self: true, revenge: true, trick: true }, A, V).context).toBe('self');
    expect(koLine({ kind: 'side', revenge: true, trick: true }, A, V).context).toBe('revenge');
  });

  it('styleTier 1 stays a plain line', () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(koLine({ kind: 'side', styleTier: 1 }, A, V).context);
    expect([...seen]).toEqual(['side']);
  });

  it('a pool with >1 line never repeats itself back to back', () => {
    let prev = null;
    for (let i = 0; i < 300; i++) {
      const { line } = koLine({ kind: 'side' }, A, V);
      expect(line).not.toBe(prev);
      prev = line;
    }
  });
});

describe('playerKOWord', () => {
  it('keeps the "you did it" pool separate from the "you died" pool', () => {
    const ko = new Set(), got = new Set();
    for (let i = 0; i < 300; i++) {
      ko.add(playerKOWord('splash', false));
      got.add(playerKOWord('splash', true));
    }
    expect([...ko].filter(w => got.has(w))).toEqual([]);
  });

  it('falls back to a side word for an unknown kind', () => {
    const allowed = new Set([...ALL_LINES.PLAYER_KO.side, ...ALL_LINES.PLAYER_GOT.side]);
    expect(allowed.has(playerKOWord('nonsense', false))).toBe(true);
    expect(allowed.has(playerKOWord('nonsense', true))).toBe(true);
  });
});

describe('winBanners', () => {
  const match = (o = {}) => ({ settings: { stocks: 3 }, roundWins: new Map(), suddenDeath: false, ...o });
  const winner = (o = {}) => ({ eliminated: false, stocks: 3, ...o });

  it('awards CLUTCH 1-STOCK on the last life', () => {
    const b = winBanners({ winner: winner({ stocks: 1 }), match: match(), isMatch: false });
    expect(b.map(x => x.title)).toContain('CLUTCH 1-STOCK');
  });

  it('awards STOCK SWEPT only when the full stock count is intact', () => {
    expect(winBanners({ winner: winner({ stocks: 3 }), match: match(), isMatch: false }).map(x => x.title))
      .toContain('STOCK SWEPT');
    expect(winBanners({ winner: winner({ stocks: 2 }), match: match(), isMatch: false }).map(x => x.title))
      .not.toContain('STOCK SWEPT');
  });

  it('does not claim a sweep in a single-stock match', () => {
    const b = winBanners({ winner: winner({ stocks: 1 }), match: match({ settings: { stocks: 1 } }), isMatch: true });
    expect(b.map(x => x.title)).not.toContain('CLUTCH 1-STOCK');
    expect(b.map(x => x.title)).not.toContain('STOCK SWEPT');
  });

  it('only calls a clean sweep when every other player has zero round wins', () => {
    const w = winner();
    const clean = winBanners({ winner: w, match: match({ roundWins: new Map([[w, 3], [{}, 0]]) }), isMatch: true });
    const dirty = winBanners({ winner: w, match: match({ roundWins: new Map([[w, 3], [{}, 1]]) }), isMatch: true });
    expect(clean.map(x => x.title)).toContain('CLEAN SWEEP 3–0');
    expect(dirty.map(x => x.title)).not.toContain('CLEAN SWEEP 3–0');
  });

  it('never banners an eliminated player in a real match state', () => {
    // Realistic state: someone else has a round win, so no degenerate empty-map sweep.
    const w = winner();
    const m = match({ roundWins: new Map([[w, 1], [{}, 1]]), suddenDeath: false });
    const b = winBanners({ winner: winner({ eliminated: true, stocks: 0 }), match: m, isMatch: true });
    expect(b).toEqual([]);
  });

  it('adds the sudden-death hero banner', () => {
    const b = winBanners({ winner: winner({ stocks: 2 }), match: match({ suddenDeath: true }), isMatch: false });
    expect(b.map(x => x.title)).toContain('SUDDEN DEATH HERO');
  });
});
