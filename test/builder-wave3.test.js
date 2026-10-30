// builder-wave3.test.js — Wave 3 (BIGGER content drop): new parts with gameplay
// effects, part synergies, breeding/evolution genetics, the deterministic
// BattleSim (dojo spar / gauntlet / endless), lab slots + dojo records,
// lab atmosphere, HUD event-bridge wiring, and new MimicLab mutations.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  buildCustomDweebModel,
  DEFAULT_BUILD_CONFIG,
  ARCHETYPE_PRESETS,
  BODY_SHAPES,
  APPENDAGES,
  FEET_TYPES,
  BROW_STYLES,
  MOUTH_STYLES,
  APPENDAGE_EFFECTS,
  FEET_EFFECTS,
  SHAPE_EFFECTS,
  PART_SYNERGIES,
  effectiveStats,
  detectSynergies,
  computeBattleProfile,
  breedConfigs,
  evolveBuild,
  randomizeConfig,
} from '../src/builder/CustomDweebModel.js';
import {
  createRng,
  simulateDuel,
  simulateBout,
  GAUNTLET_TIERS,
  gauntletOpponent,
  runGauntlet,
  runEndlessGauntlet,
  dojoSparOpponent,
  buildSnapshot,
} from '../src/builder/BattleSim.js';
import { BuildADweebLab } from '../src/builder/BuildADweebLab.js';
import { BuildADweebHud } from '../src/builder/BuildADweebHud.js';
import { MimicLab, MUTATION_TYPES } from '../src/mimic/MimicLab.js';

// ─── test doubles ────────────────────────────────────────────────────────────

function stubLocalStorage(initial = {}) {
  const store = { ...initial };
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  return store;
}

/** A real routing event bus: document dispatches actually reach listeners. */
function makeEventBus() {
  const listeners = new Map();
  globalThis.CustomEvent = class {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
  const dispatched = [];
  globalThis.document = {
    addEventListener: (t, fn) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t).add(fn);
    },
    removeEventListener: (t, fn) => { listeners.get(t)?.delete(fn); },
    dispatchEvent: e => {
      dispatched.push(e);
      for (const fn of [...(listeners.get(e.type) || [])]) fn(e);
      return true;
    },
    getElementById: () => null,
  };
  return { listeners, dispatched };
}

function makeMockPhysics() {
  const bodies = new Map();
  let n = 0;
  const mk = kind => (...args) => {
    const id = `${kind}_${n++}`;
    bodies.set(id, args);
    return { id, body: { mockId: id } };
  };
  return {
    bodies,
    createFixedCylinder: mk('fixedCylinder'),
    createStaticBox: mk('staticBox'),
    createDynamicBody: mk('dynamicBody'),
    removeBody: vi.fn(id => { bodies.delete(id); }),
  };
}

function makePupil() {
  return {
    isPlayer: false,
    body: { setLinvel: vi.fn() },
    onBounce: vi.fn(),
  };
}

beforeEach(() => {
  delete globalThis.document;
  delete globalThis.CustomEvent;
  delete globalThis.localStorage;
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.CustomEvent;
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

// ─── New parts: catalog integrity ────────────────────────────────────────────

describe('new part catalog', () => {
  it('every appendage in APPENDAGES renders visible geometry (except none)', () => {
    for (const appendage of APPENDAGES) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, appendage });
      if (appendage === 'none') {
        expect(model.appGroup.children.length).toBe(0);
      } else {
        expect(model.appGroup.children.length, appendage).toBeGreaterThan(0);
      }
    }
  });

  it('every foot type and body shape builds without throwing', () => {
    for (const feet of FEET_TYPES) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, feet });
      expect(model.feetGroup.children.length, feet).toBeGreaterThanOrEqual(2);
    }
    for (const shape of BODY_SHAPES) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, shape });
      expect(model.bodyMesh.geometry, shape).toBeDefined();
    }
    for (const brows of BROW_STYLES) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, brows });
      const browsGroup = model.root.getObjectByName('Brows');
      expect(browsGroup.children.length, brows).toBe(brows === 'none' ? 0 : 2);
    }
    for (const mouth of MOUTH_STYLES) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, mouth });
      const mouthGroup = model.root.getObjectByName('Mouth');
      expect(mouthGroup.children.length, mouth).toBeGreaterThan(0);
    }
  });

  it('new parts have the expected mesh counts', () => {
    const counts = {
      jetpack: 5, wings: 2, ram_plates: 4, shock_gloves: 8, satellite: 3,
    };
    for (const [appendage, n] of Object.entries(counts)) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, appendage });
      expect(model.appGroup.children.length, appendage).toBe(n);
    }
    for (const feet of ['treads', 'jet_skates']) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, feet });
      expect(model.feetGroup.children.length, feet).toBe(4);
    }
  });

  it('part lists have no duplicates and effects cover every entry', () => {
    for (const [list, name] of [[BODY_SHAPES, 'shapes'], [APPENDAGES, 'appendages'], [FEET_TYPES, 'feet']]) {
      expect(new Set(list).size, name).toBe(list.length);
    }
    for (const a of APPENDAGES) expect(APPENDAGE_EFFECTS[a], a).toBeDefined();
    for (const f of FEET_TYPES) expect(FEET_EFFECTS[f], f).toBeDefined();
    for (const s of BODY_SHAPES) expect(SHAPE_EFFECTS[s], s).toBeDefined();
  });

  it('new archetype presets are complete and buildable', () => {
    for (const key of ['sky_corsair', 'siege_turtle']) {
      const p = ARCHETYPE_PRESETS[key];
      expect(p, key).toBeDefined();
      expect(p.badge).toBeTruthy();
      const model = buildCustomDweebModel(p);
      expect(model.root.children.length).toBeGreaterThan(0);
    }
  });

  it('shape x appendage x feet soak: no NaN positions anywhere', () => {
    const shapes = ['pyramid', 'donut', 'blob'];
    for (const shape of shapes) {
      for (const appendage of APPENDAGES) {
        for (const feet of FEET_TYPES) {
          const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, shape, appendage, feet });
          model.root.traverse(c => {
            if (c.isMesh) {
              for (const v of [c.position.x, c.position.y, c.position.z]) {
                expect(Number.isFinite(v), `${shape}/${appendage}/${feet}`).toBe(true);
              }
            }
          });
        }
      }
    }
  });
});

// ─── Part gameplay effects + synergies ───────────────────────────────────────

describe('effectiveStats', () => {
  const base = { stats: { speed: 1.0, mass: 3.0, jump: 1.0, armor: 1.0 } };

  it('applies appendage deltas', () => {
    const s = effectiveStats({ ...base, appendage: 'jetpack', feet: 'pegs', shape: 'blob' });
    expect(s.jump).toBeCloseTo(1.3, 5);
    expect(s.mass).toBeCloseTo(3.2, 5);
    expect(s.speed).toBeCloseTo(0.95, 5);
  });

  it('applies feet and shape deltas', () => {
    const s = effectiveStats({ ...base, appendage: 'none', feet: 'treads', shape: 'chonk' });
    expect(s.armor).toBeCloseTo(1.15, 5);
    expect(s.mass).toBeCloseTo(3.4, 5);
    expect(s.speed).toBeCloseTo(0.9, 5);
  });

  it('clamps to sane bounds and tolerates garbage', () => {
    const s = effectiveStats({ stats: { speed: 9, mass: -3, jump: NaN, armor: 'x' }, appendage: 'jetpack' });
    expect(s.speed).toBeLessThanOrEqual(1.6);
    expect(s.mass).toBeGreaterThanOrEqual(1.5);
    expect(Number.isFinite(s.jump)).toBe(true);
    expect(Number.isFinite(s.armor)).toBe(true);
    expect(effectiveStats().mass).toBe(3.0);
    expect(effectiveStats({ appendage: 'not-a-part' }).speed).toBe(1.0);
  });

  it('detects synergies and applies their bonuses', () => {
    const cfg = { ...base, shape: 'spiky', appendage: 'spikes', feet: 'pegs' };
    const found = detectSynergies(cfg);
    expect(found.map(s => s.id)).toContain('porcupine');
    // armor: 1.0 base + 0.05 shape + 0.15 appendage + 0.15 synergy
    expect(effectiveStats(cfg).armor).toBeCloseTo(1.35, 5);
    expect(detectSynergies({ ...base, shape: 'blob', appendage: 'horns' })).toEqual([]);
  });

  it('all defined synergies are reachable with valid parts', () => {
    for (const s of PART_SYNERGIES) {
      const cfg = { shape: 'blob', appendage: 'none', feet: 'pegs', ...s.needs };
      expect(detectSynergies(cfg).map(x => x.id), s.id).toContain(s.id);
    }
  });
});

describe('computeBattleProfile with parts', () => {
  it('still rates maxed/min builds S/100 and D/0 (no-part regression)', () => {
    const maxed = computeBattleProfile({ stats: { mass: 4.5, speed: 1.4, jump: 1.4, armor: 1.4 } });
    expect(maxed.rating).toBe(100);
    expect(maxed.tier).toBe('S');
    const mined = computeBattleProfile({ stats: { mass: 1.8, speed: 0.7, jump: 0.8, armor: 0.8 } });
    expect(mined.rating).toBe(0);
    expect(mined.tier).toBe('D');
  });

  it('part effects move the rating and expose effective stats + synergy tags', () => {
    const plain = computeBattleProfile({ stats: { speed: 1, mass: 3, jump: 1, armor: 1 }, shape: 'blob', appendage: 'none', feet: 'pegs' });
    const geared = computeBattleProfile({ stats: { speed: 1, mass: 3, jump: 1, armor: 1 }, shape: 'spiky', appendage: 'spikes', feet: 'treads' });
    expect(geared.rating).toBeGreaterThan(plain.rating);
    expect(geared.effective.armor).toBeCloseTo(1.5, 5);
    expect(geared.synergies).toContain('🦔 PORCUPINE ARMOR');
    expect(plain.synergies).toEqual([]);
  });
});

// ─── Genetics: breeding + evolution ──────────────────────────────────────────

describe('breedConfigs', () => {
  const a = { ...DEFAULT_BUILD_CONFIG, name: 'Alpha Beast', shape: 'chonk', eyeCount: 1, stats: { speed: 0.7, mass: 4.5, jump: 0.8, armor: 1.4 }, dna: { confidence: 1, aimAccuracy: 0.2, scavenge: 0.1, agility: 0.3 } };
  const b = { ...DEFAULT_BUILD_CONFIG, name: 'Beta Zoom', shape: 'capsule', eyeCount: 4, stats: { speed: 1.4, mass: 1.8, jump: 1.4, armor: 0.8 }, dna: { confidence: 0.1, aimAccuracy: 1, scavenge: 0.9, agility: 1 } };

  it('is deterministic with a seeded rng', () => {
    const c1 = breedConfigs(a, b, createRng(5));
    const c2 = breedConfigs(a, b, createRng(5));
    expect(c1).toEqual(c2);
  });

  it('child genes come from the parents', () => {
    const c = breedConfigs(a, b, createRng(9));
    expect(c.name).toContain('×');
    expect(['chonk', 'capsule']).toContain(c.shape);
    expect([1, 4]).toContain(c.eyeCount);
    expect(c.stats.speed).toBeGreaterThanOrEqual(0.65);
    expect(c.stats.speed).toBeLessThanOrEqual(1.45);
    expect(c.stats.mass).toBeGreaterThanOrEqual(1.75);
    expect(c.stats.mass).toBeLessThanOrEqual(4.55);
    for (const k of ['confidence', 'aimAccuracy', 'scavenge', 'agility']) {
      expect(c.dna[k]).toBeGreaterThanOrEqual(0.05);
      expect(c.dna[k]).toBeLessThanOrEqual(1.0);
    }
    // child builds a real model
    expect(() => buildCustomDweebModel(c)).not.toThrow();
  });
});

describe('evolveBuild', () => {
  const weak = { ...DEFAULT_BUILD_CONFIG, stats: { speed: 0.7, mass: 1.8, jump: 0.8, armor: 0.8 }, dna: { confidence: 0.1, aimAccuracy: 0.1, scavenge: 0.1, agility: 0.3 } };

  it('never regresses the best rating and records monotone history', () => {
    const before = computeBattleProfile(weak).rating;
    const res = evolveBuild(weak, { rounds: 20, target: 100, rng: createRng(11) });
    expect(res.rating).toBeGreaterThanOrEqual(before);
    expect(res.roundsRun).toBe(20);
    expect(res.history.length).toBe(21);
    for (let i = 1; i < res.history.length; i++) {
      expect(res.history[i].rating).toBeGreaterThanOrEqual(res.history[i - 1].rating);
    }
    expect(() => buildCustomDweebModel(res.config)).not.toThrow();
  });

  it('stops early once the target rating is reached', () => {
    const startRating = computeBattleProfile(weak).rating;
    const res = evolveBuild(weak, { rounds: 50, target: startRating, rng: createRng(3) });
    expect(res.roundsRun).toBe(1);
    expect(res.rating).toBeGreaterThanOrEqual(startRating);
  });

  it('is deterministic with a seeded rng', () => {
    const r1 = evolveBuild(weak, { rounds: 8, rng: createRng(21) });
    const r2 = evolveBuild(weak, { rounds: 8, rng: createRng(21) });
    expect(r1.config).toEqual(r2.config);
    expect(r1.rating).toBe(r2.rating);
  });
});

describe('randomizeConfig', () => {
  it('produces valid configs and is seed-deterministic', () => {
    const c1 = randomizeConfig(createRng(77));
    const c2 = randomizeConfig(createRng(77));
    expect(c1).toEqual(c2);
    expect(BODY_SHAPES).toContain(c1.shape);
    expect(APPENDAGES).toContain(c1.appendage);
    expect(FEET_TYPES).toContain(c1.feet);
    expect(BROW_STYLES).toContain(c1.brows);
    expect(MOUTH_STYLES).toContain(c1.mouth);
    expect(c1.stats.mass).toBeGreaterThanOrEqual(2.0);
    expect(c1.stats.mass).toBeLessThanOrEqual(4.2);
    expect(() => buildCustomDweebModel(c1)).not.toThrow();
  });
});

// ─── BattleSim ───────────────────────────────────────────────────────────────

describe('createRng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(123), b = createRng(123), c = createRng(124);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('simulateDuel', () => {
  it('is fully deterministic for a fixed seed', () => {
    const a = { ...DEFAULT_BUILD_CONFIG, name: 'A' };
    const b = { ...ARCHETYPE_PRESETS.titan_chonk, name: 'B' };
    const d1 = simulateDuel(a, b, createRng(42));
    const d2 = simulateDuel(a, b, createRng(42));
    expect(d1).toEqual(d2);
  });

  it('returns a well-formed result that always terminates', () => {
    for (let s = 0; s < 20; s++) {
      const d = simulateDuel(randomizeConfig(createRng(s)), randomizeConfig(createRng(1000 + s)), createRng(s));
      expect([0, 1, 'draw']).toContain(d.winner);
      expect(d.rounds).toBeGreaterThanOrEqual(1);
      expect(d.rounds).toBeLessThanOrEqual(60);
      expect(Number.isFinite(d.hpA) && Number.isFinite(d.hpB)).toBe(true);
      expect(Array.isArray(d.log)).toBe(true);
    }
  });

  it('a duel that runs the full round cap reports rounds <= 60 (no off-by-one)', () => {
    // rng stuck near 1.0 => every strike misses => 60 scoreless rounds, draw on HP
    const d = simulateDuel(DEFAULT_BUILD_CONFIG, ARCHETYPE_PRESETS.titan_chonk, () => 0.999);
    expect(d.rounds).toBe(60);
    expect(d.winner).toBe('draw');
    expect(d.hpA).toBe(d.maxHpA);
    expect(d.hpB).toBe(d.maxHpB);
  });

  it('a titan build crushes a min-maxed weakling, but trades evenly with a balanced build', () => {
    const weakling = {
      ...DEFAULT_BUILD_CONFIG, name: 'Weakling',
      stats: { speed: 0.7, mass: 1.8, jump: 0.8, armor: 0.8 },
      dna: { confidence: 0.1, aimAccuracy: 0.1, scavenge: 0.1, agility: 0.3 },
      appendage: 'none', feet: 'pegs', shape: 'blob',
    };
    const stomp = simulateBout(ARCHETYPE_PRESETS.titan_chonk, weakling, { bestOf: 40, rng: createRng(7) });
    expect(stomp.winsA).toBeGreaterThan(stomp.winsB * 3);
    // ...while the S-tier bruiser beats the balanced default roughly 2:1 —
    // the sim's hit-chance retune keeps tanks hittable without making them
    // helpless, so the gauntlet's final boss feels like a boss.
    const even = simulateBout(ARCHETYPE_PRESETS.titan_chonk, DEFAULT_BUILD_CONFIG, { bestOf: 120, rng: createRng(7) });
    const share = even.winsA / (even.winsA + even.winsB);
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.9);
  });

  it('a mirror match is roughly a coin flip', () => {
    const cfg = { ...DEFAULT_BUILD_CONFIG, name: 'M' };
    const bout = simulateBout(cfg, { ...cfg, name: 'Anti-M' }, { bestOf: 200, rng: createRng(13) });
    const total = bout.winsA + bout.winsB;
    expect(total).toBeGreaterThan(100);
    const share = bout.winsA / total;
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
  });
});

describe('simulateBout', () => {
  it('plays exactly bestOf duels and aggregates correctly', () => {
    const bout = simulateBout(DEFAULT_BUILD_CONFIG, ARCHETYPE_PRESETS.speed_gremlin, { bestOf: 5, rng: createRng(2) });
    expect(bout.winsA + bout.winsB + bout.draws).toBe(5);
    expect(bout.duels.length).toBe(5);
    expect(bout.avgRounds).toBeGreaterThan(0);
    expect([0, 1, 'draw']).toContain(bout.winner);
  });
});

describe('gauntlet', () => {
  it('has 6 escalating tiers with valid presets', () => {
    expect(GAUNTLET_TIERS.length).toBe(6);
    for (const t of GAUNTLET_TIERS) {
      expect(ARCHETYPE_PRESETS[t.preset], t.preset).toBeDefined();
    }
    const buffs = GAUNTLET_TIERS.map(t => t.buff);
    for (let i = 1; i < buffs.length; i++) expect(buffs[i]).toBeGreaterThanOrEqual(buffs[i - 1]);
  });

  it('gauntletOpponent scales stats by the tier buff', () => {
    const opp = gauntletOpponent(GAUNTLET_TIERS[5]);
    const base = ARCHETYPE_PRESETS.titan_chonk.stats;
    expect(opp.stats.mass).toBe(Number((base.mass * 1.25).toFixed(2)));
    expect(opp.badge).toContain('GAUNTLET');
  });

  it('runGauntlet stops at the first lost tier and reports structure', () => {
    const res = runGauntlet(DEFAULT_BUILD_CONFIG, { rng: createRng(1), bestOf: 3 });
    expect(res.rounds.length).toBeLessThanOrEqual(6);
    expect(res.cleared).toBe(res.rounds.filter(r => r.won).length);
    // cleared rounds are a prefix: no wins after the first loss
    const firstLoss = res.rounds.findIndex(r => !r.won);
    if (firstLoss >= 0) {
      expect(res.rounds.slice(firstLoss + 1)).toEqual([]);
      expect(res.cleared).toBe(firstLoss);
    } else {
      expect(res.champion).toBe(true);
    }
    for (const r of res.rounds) {
      expect(r.bout.winsA + r.bout.winsB + r.bout.draws).toBe(3);
    }
  });

  it('a maxed build can clear the ladder', () => {
    const maxed = {
      ...DEFAULT_BUILD_CONFIG,
      name: 'Maximus',
      stats: { speed: 1.4, mass: 4.5, jump: 1.4, armor: 1.4 },
      dna: { confidence: 1, aimAccuracy: 1, scavenge: 0.1, agility: 1 },
      appendage: 'ram_plates', feet: 'treads', shape: 'chonk',
    };
    const res = runGauntlet(maxed, { rng: createRng(4), bestOf: 3 });
    expect(res.champion).toBe(true);
    expect(res.cleared).toBe(6);
  });
});

describe('runEndlessGauntlet', () => {
  it('scales opponents each round and stops at first loss', () => {
    const res = runEndlessGauntlet(DEFAULT_BUILD_CONFIG, { rng: createRng(3), maxRounds: 5 });
    expect(res.rounds.length).toBeLessThanOrEqual(5);
    expect(res.cleared).toBe(res.rounds.filter(r => r.won).length);
    for (let i = 1; i < res.rounds.length; i++) {
      expect(res.rounds[i].scale).toBeGreaterThan(res.rounds[i - 1].scale);
    }
  });
});

describe('dojoSparOpponent', () => {
  const player = { ...DEFAULT_BUILD_CONFIG, name: 'Hero' };

  it('resolves every HUD picker key', () => {
    const mirror = dojoSparOpponent('mirror', player, createRng(1));
    expect(mirror.name).toBe('Anti-Hero');
    expect(mirror.primaryColor).toBe('#2b1b3d');
    expect(dojoSparOpponent('juggernaut', player).badge).toBe(ARCHETYPE_PRESETS.titan_chonk.badge);
    expect(dojoSparOpponent('gremlin', player).badge).toBe(ARCHETYPE_PRESETS.speed_gremlin.badge);
    expect(dojoSparOpponent('sniper', player).badge).toBe(ARCHETYPE_PRESETS.sniper_bean.badge);
    expect(dojoSparOpponent('pugilist', player).badge).toBe(ARCHETYPE_PRESETS.pugilist_champ.badge);
    const rand = dojoSparOpponent('random', player, createRng(8));
    expect(rand.badge).toBe('👾 DOJO MUTANT');
  });

  it('buildSnapshot summarizes a build', () => {
    const s = buildSnapshot(player);
    expect(s.name).toBe('Hero');
    expect(Number.isFinite(s.rating)).toBe(true);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(s.tier);
  });
});

// ─── Lab: breed / evolve / dojo / slots ──────────────────────────────────────

describe('BuildADweebLab genetics + dojo', () => {
  let bus, lab;

  beforeEach(() => {
    stubLocalStorage();
    bus = makeEventBus();
    lab = new BuildADweebLab(new THREE.Scene(), null, null);
  });

  afterEach(() => { lab.dispose(); });

  it('breedWithPartner blends genes and is a single undo step', () => {
    const parentName = lab.config.name;
    const child = lab.breedWithPartner('pugilist', createRng(31));
    expect(child.name).toContain('×');
    expect(lab.canUndo()).toBe(true);
    const restored = lab.undo();
    expect(restored.name).toBe(parentName);
    const reports = bus.dispatched.filter(e => e.type === 'bd-dojo-report' && e.detail.kind === 'breed');
    expect(reports.length).toBe(1);
    expect(reports[0].detail.partnerName).toBe(ARCHETYPE_PRESETS.pugilist_champ.name);
  });

  it('breedWithPartner accepts a raw config partner', () => {
    const child = lab.breedWithPartner({ ...DEFAULT_BUILD_CONFIG, name: 'Custom Pal' }, createRng(3));
    expect(child.name).toContain('×');
  });

  it('evolve improves (or keeps) the rating and reports history', () => {
    lab.config = {
      ...DEFAULT_BUILD_CONFIG,
      stats: { speed: 0.7, mass: 1.8, jump: 0.8, armor: 0.8 },
      dna: { confidence: 0.1, aimAccuracy: 0.1, scavenge: 0.1, agility: 0.3 },
    };
    const before = computeBattleProfile(lab.config).rating;
    const res = lab.evolve({ rounds: 10, target: 100, rng: createRng(17) });
    expect(res.rating).toBeGreaterThanOrEqual(before);
    expect(res.history.length).toBe(res.roundsRun + 1);
    expect(lab.canUndo()).toBe(true);
    const reports = bus.dispatched.filter(e => e.type === 'bd-dojo-report' && e.detail.kind === 'evolve');
    expect(reports[0].detail.ratingAfter).toBe(res.rating);
  });

  it('dojoSpar runs a simulated bout, updates records, and reports', () => {
    const { bout, records } = lab.dojoSpar('mirror', { seed: 42, bestOf: 3 });
    expect(bout.winsA + bout.winsB + bout.draws).toBe(3);
    expect(records.sparWins + records.sparLosses + records.sparDraws).toBe(3);
    const reports = bus.dispatched.filter(e => e.type === 'bd-dojo-report' && e.detail.kind === 'spar');
    expect(reports.length).toBe(1);
    expect(reports[0].detail.opponent.name).toContain('Anti-');
    // records persist across lab instances via localStorage
    const lab2 = new BuildADweebLab(new THREE.Scene(), null, null);
    expect(lab2.getDojoRecords().sparWins).toBe(records.sparWins);
    lab2.dispose();
  });

  it('dojoGauntlet ladder reports rounds and tracks best streak', () => {
    const res = lab.dojoGauntlet('ladder', { seed: 42 });
    expect(res.rounds.length).toBeGreaterThan(0);
    expect(res.records.bestLadder).toBe(res.cleared);
    const reports = bus.dispatched.filter(e => e.type === 'bd-dojo-report' && e.detail.kind === 'gauntlet');
    expect(reports[0].detail.mode).toBe('ladder');
  });

  it('dojoGauntlet endless tracks best endless streak', () => {
    const res = lab.dojoGauntlet('endless', { seed: 42, maxRounds: 4 });
    expect(res.rounds.length).toBeLessThanOrEqual(4);
    expect(res.records.bestEndless).toBe(res.cleared);
  });

  it('build slots save / load / reject bad input', () => {
    expect(lab.saveSlot(0)).toBeNull();
    expect(lab.saveSlot(4)).toBeNull();
    expect(lab.loadSlot(1)).toBeNull(); // empty
    lab.config.name = 'Slotty McSlotface';
    const saved = lab.saveSlot(2);
    expect(saved.name).toBe('Slotty McSlotface');
    expect(lab.getSlots()[2].name).toBe('Slotty McSlotface');
    lab.config.name = 'Changed';
    const loaded = lab.loadSlot(2);
    expect(loaded.name).toBe('Slotty McSlotface');
    expect(lab.config.name).toBe('Slotty McSlotface');
    expect(lab.canUndo()).toBe(true); // loading is undoable
    const syncs = bus.dispatched.filter(e => e.type === 'bd-slots-sync');
    expect(syncs.length).toBeGreaterThan(0);
  });

  it('dojo records default to zeros', () => {
    const rec = lab.getDojoRecords();
    expect(rec).toEqual({ sparWins: 0, sparLosses: 0, sparDraws: 0, bestLadder: 0, bestEndless: 0, ladderClears: 0 });
  });

  it('event bridge: HUD-style dispatches reach the lab and it answers', () => {
    bus.dispatched.length = 0;
    globalThis.document.dispatchEvent(new globalThis.CustomEvent('bd-dojo-spar', { detail: { opp: 'sniper', seed: 9, bestOf: 1 } }));
    const reports = bus.dispatched.filter(e => e.type === 'bd-dojo-report' && e.detail.kind === 'spar');
    expect(reports.length).toBe(1);
    expect(reports[0].detail.bout.winsA + reports[0].detail.bout.winsB + reports[0].detail.bout.draws).toBe(1);

    globalThis.document.dispatchEvent(new globalThis.CustomEvent('bd-breed', { detail: { partner: 'gremlin' } }));
    expect(bus.dispatched.some(e => e.type === 'bd-dojo-report' && e.detail.kind === 'breed')).toBe(true);

    globalThis.document.dispatchEvent(new globalThis.CustomEvent('bd-slots-request', {}));
    expect(bus.dispatched.some(e => e.type === 'bd-slots-sync')).toBe(true);

    globalThis.document.dispatchEvent(new globalThis.CustomEvent('bd-dojo-records-request', {}));
    expect(bus.dispatched.some(e => e.type === 'bd-dojo-report' && e.detail.kind === 'records')).toBe(true);
  });

  it('lab atmosphere: scan beam fires on discrete rebuilds and dust animates', () => {
    lab._scanT = 0;
    lab.mutateRandom(createRng(5));
    expect(lab._scanT).toBe(1);
    expect(lab._scan).toBeDefined();
    expect(lab._dust).toBeDefined();
    expect(lab._holo).toBeDefined();
    const before = lab._dust.geometry.attributes.position.getY(0);
    lab.update(0.5);
    const after = lab._dust.geometry.attributes.position.getY(0);
    expect(after).not.toBe(before);
    expect(lab._scanT).toBeLessThan(1);
    // continuous slider rebuilds (no juice) don't trigger the scan
    lab._scanT = 0;
    lab.rebuildModel({ juice: false });
    expect(lab._scanT).toBe(0);
    // atmosphere survives disposal without leaking the group
    const group = lab.group;
    expect(() => lab.update(0.016)).not.toThrow();
    expect(group.children).toContain(lab._scan);
  });

  it('mutateRandom delegates to randomizeConfig (seedable)', () => {
    const c1 = lab.mutateRandom(createRng(64));
    lab.dispose();
    const lab2 = new BuildADweebLab(new THREE.Scene(), null, null);
    const c2 = lab2.mutateRandom(createRng(64));
    expect(c1).toEqual(c2);
    lab2.dispose();
    lab = new BuildADweebLab(new THREE.Scene(), null, null); // for afterEach
  });
});

// ─── HUD: template renders new content + request methods ─────────────────────

describe('BuildADweebHud wave3', () => {
  let capturedHtml;

  function stubDom() {
    capturedHtml = '';
    globalThis.CustomEvent = class {
      constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
    };
    const mkEl = () => ({
      children: [], style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
      querySelector: () => mkEl(), querySelectorAll: () => [],
      closest: () => null,
      set innerHTML(v) { /* only root captures */ },
      get innerHTML() { return ''; },
      value: '', textContent: '',
    });
    const root = mkEl();
    Object.defineProperty(root, 'innerHTML', {
      get() { return capturedHtml; },
      set(v) { capturedHtml = String(v); },
    });
    globalThis.document = {
      getElementById: () => null,
      createElement: tag => (tag === 'div' ? root : mkEl()),
      head: mkEl(),
      body: mkEl(),
      addEventListener() {}, removeEventListener() {},
      dispatchEvent: vi.fn(),
    };
  }

  beforeEach(() => { stubDom(); });

  it('renders all archetype presets (incl. new ones), dojo buttons, slots, and modal', () => {
    const hud = new BuildADweebHud({});
    for (const p of Object.values(ARCHETYPE_PRESETS)) {
      expect(capturedHtml).toContain(p.badge);
    }
    expect(capturedHtml).toContain('SKY CORSAIR');
    expect(capturedHtml).toContain('SIEGE TURTLE');
    for (const id of ['bd-btn-breed', 'bd-btn-evolve', 'bd-btn-dojo-spar', 'bd-btn-dojo-ladder', 'bd-btn-dojo-endless', 'bd-dojo-records', 'bd-slots', 'bd-dojo-modal', 'bd-dojo-body']) {
      expect(capturedHtml, id).toContain(id);
    }
    hud.dispose();
  });

  it('renders every part option from the extended catalogs', () => {
    const hud = new BuildADweebHud({});
    for (const s of BODY_SHAPES) expect(capturedHtml).toContain(`data-v="${s}"`);
    for (const a of APPENDAGES) expect(capturedHtml).toContain(`data-v="${a}"`);
    for (const f of FEET_TYPES) expect(capturedHtml).toContain(`data-v="${f}"`);
    hud.dispose();
  });

  it('request methods dispatch the right lab events when no handler is wired', () => {
    const hud = new BuildADweebHud({});
    hud.requestBreed('pugilist');
    hud.requestEvolve(10, 70);
    hud.requestDojoSpar('sniper', 5);
    hud.requestDojoGauntlet('endless');
    hud.requestSlotSave(1);
    hud.requestSlotLoad(2);
    const types = globalThis.document.dispatchEvent.mock.calls.map(c => c[0].type);
    expect(types).toContain('bd-breed');
    expect(types).toContain('bd-evolve');
    expect(types).toContain('bd-dojo-spar');
    expect(types).toContain('bd-dojo-gauntlet');
    expect(types).toContain('bd-slot-save');
    expect(types).toContain('bd-slot-load');
    const breed = globalThis.document.dispatchEvent.mock.calls.find(c => c[0].type === 'bd-breed');
    expect(breed[0].detail).toEqual({ partner: 'pugilist' });
    hud.dispose();
  });

  it('prefers explicit handlers over the event bridge', () => {
    const onBreed = vi.fn(), onDojoSpar = vi.fn();
    const hud = new BuildADweebHud({ onBreed, onDojoSpar });
    globalThis.document.dispatchEvent.mockClear(); // ignore constructor's slots/records requests
    hud.requestBreed('gremlin');
    hud.requestDojoSpar('random', 3);
    expect(onBreed).toHaveBeenCalledWith('gremlin');
    expect(onDojoSpar).toHaveBeenCalledWith('random', { bestOf: 3 });
    expect(globalThis.document.dispatchEvent).not.toHaveBeenCalled();
    hud.dispose();
  });

  it('report HTML builders render spar / gauntlet / breed / evolve', () => {
    const ctx = {
      _esc: s => String(s ?? ''),
      _vsCard: snap => `<div>${snap.name}|${snap.rating}|${snap.tier}</div>`,
    };
    const spar = BuildADweebHud.prototype._sparHtml.call(ctx, {
      player: { name: 'Hero', rating: 70, tier: 'A', synergies: [] },
      opponent: { name: 'Rival', rating: 60, tier: 'B', synergies: [] },
      bout: { winner: 0, winsA: 2, winsB: 1, draws: 0, avgRounds: 5.2, totalDmgA: 300, totalDmgB: 180, duels: [{ log: ['Hero hits for 10'] }] },
    });
    expect(spar).toContain('YOU WIN THE SPAR');
    expect(spar).toContain('Hero hits for 10');

    const gauntlet = BuildADweebHud.prototype._gauntletHtml.call(ctx, {
      mode: 'ladder', cleared: 2, total: 6, champion: false,
      records: { bestLadder: 2, bestEndless: 0, ladderClears: 0 },
      rounds: [
        { tier: '🥊 WARM-UP', opponent: 'Pugilist', won: true, bout: { winsA: 2, winsB: 0 } },
        { tier: '🎯 SHARPSHOOTER', opponent: 'Sniper', won: false, bout: { winsA: 1, winsB: 2 } },
      ],
    });
    expect(gauntlet).toContain('CLEARED 2/6');

    const breed = BuildADweebHud.prototype._breedHtml.call(ctx, {
      parentA: 'Kid', partnerName: 'Pal', ratingBefore: 50, ratingAfter: 62,
    });
    expect(breed).toContain('50 → 62');

    const evolve = BuildADweebHud.prototype._evolveHtml.call(ctx, {
      ratingBefore: 40, ratingAfter: 75, roundsRun: 9,
      history: [{ round: 0, rating: 40 }, { round: 9, rating: 75 }],
    });
    expect(evolve).toContain('40 → 75');
  });

  it('syncProfile appends synergy tags without breaking DNA tags', () => {
    const tags = [];
    const hud = new BuildADweebHud({});
    // drive syncProfile with a stubbed root
    hud.root = {
      remove() {},
      querySelector: sel => {
        if (sel === '#bd-prof-dna') {
          return { set innerHTML(v) { tags.push(v); } };
        }
        return { style: {}, set textContent(v) {} };
      },
    };
    hud.syncProfile({ stats: { speed: 1, mass: 3, jump: 1, armor: 1 }, shape: 'spiky', appendage: 'spikes', feet: 'pegs' });
    expect(tags.length).toBe(1);
    expect(tags[0]).toContain('bd-dna-tag');
    expect(tags[0]).toContain('bd-synergy-tag');
    expect(tags[0]).toContain('PORCUPINE ARMOR');
    hud.dispose();
  });
});

// ─── MimicLab: new mutations, encore, cheer ──────────────────────────────────

describe('MimicLab wave3', () => {
  let lab, physics;

  beforeEach(() => {
    physics = makeMockPhysics();
    lab = new MimicLab(physics, new THREE.Scene());
    globalThis.document = { getElementById: () => null };
  });

  afterEach(() => { lab.dispose(); });

  it('registers the three new mutation types', () => {
    const ids = MUTATION_TYPES.map(m => m.id);
    for (const id of ['backfire', 'slowmo', 'prodigy']) {
      expect(ids).toContain(id);
      const m = MUTATION_TYPES.find(x => x.id === id);
      expect(m.name).toBeTruthy();
      expect(m.blurb).toBeTruthy();
    }
  });

  it('backfire launches + ragdolls + dazes the pupil', () => {
    const pupil = makePupil();
    lab.triggerDemonstration('BONK', [pupil], 'backfire');
    const v = pupil.body.setLinvel.mock.calls[0][0];
    expect(v.y).toBeCloseTo(14.0, 5);
    expect(pupil.ragdolling).toBe(true);
    expect(pupil.hitstun).toBe(2.0);
  });

  it('slowmo floats gently and flags slowmoT', () => {
    const pupil = makePupil();
    lab.triggerDemonstration('DIVE', [pupil], 'slowmo');
    const v = pupil.body.setLinvel.mock.calls[0][0];
    expect(v.y).toBeCloseTo(6.0, 5);
    expect(pupil.slowmoT).toBe(3.0);
  });

  it('prodigy pops cleanly and bounces', () => {
    const pupil = makePupil();
    lab.triggerDemonstration('JUMP', [pupil], 'prodigy');
    const v = pupil.body.setLinvel.mock.calls[0][0];
    expect(v).toEqual({ x: 0, y: 12.0, z: 0 });
    expect(pupil.onBounce).toHaveBeenCalled();
  });

  it('encore escalation boosts impulses on repeated demos (capped)', () => {
    const pupil = makePupil();
    lab.triggerDemonstration('BONK', [pupil], 'prodigy');
    lab.triggerDemonstration('BONK', [pupil], 'prodigy');
    lab.triggerDemonstration('BONK', [pupil], 'prodigy');
    lab.triggerDemonstration('BONK', [pupil], 'prodigy');
    lab.triggerDemonstration('BONK', [pupil], 'prodigy');
    const ys = pupil.body.setLinvel.mock.calls.map(c => c[0].y);
    expect(ys[0]).toBeCloseTo(12.0, 5);
    expect(ys[1]).toBeCloseTo(15.0, 5);
    expect(ys[2]).toBeCloseTo(18.0, 5);
    expect(ys[3]).toBeCloseTo(21.0, 5); // capped at +75%
    expect(ys[4]).toBeCloseTo(21.0, 5);
    expect(lab.encoreCount).toBe(5);
    // a different action resets the encore
    lab.triggerDemonstration('OTHER', [pupil], 'prodigy');
    expect(lab.encoreCount).toBe(1);
    expect(pupil.body.setLinvel.mock.calls.at(-1)[0].y).toBeCloseTo(12.0, 5);
  });

  it('the crowd cheers the performer with a hop', () => {
    const p1 = makePupil(), p2 = makePupil();
    lab.triggerDemonstration('BONK', [p1, p2], 'prodigy');
    const ys = [
      ...p1.body.setLinvel.mock.calls.map(c => c[0].y),
      ...p2.body.setLinvel.mock.calls.map(c => c[0].y),
    ].sort((a, b) => a - b);
    expect(ys).toEqual([3.0, 12.0]); // one performer pop, one crowd hop
  });

  it('announcer shows the encore tag on repeats', () => {
    const announcer = { className: '', innerHTML: '' };
    globalThis.document = { getElementById: () => announcer };
    const pupil = makePupil();
    lab.triggerDemonstration('BONK', [pupil], 'prodigy');
    expect(announcer.innerHTML).not.toContain('ENCORE');
    lab.triggerDemonstration('BONK', [pupil], 'prodigy');
    expect(announcer.innerHTML).toContain('ENCORE x2');
  });
});
