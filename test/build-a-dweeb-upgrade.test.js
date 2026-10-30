// build-a-dweeb-upgrade.test.js — Milestone 4 upgrade suite:
// tournament ladder, 4 new appendages + elemental palettes, combat telemetry,
// spectator-camera high-action framing, and DNA-mutation collider sync.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  buildCustomDweebModel,
  DEFAULT_BUILD_CONFIG,
  APPENDAGES,
  APPENDAGE_GAMEPLAY,
  ELEMENTAL_PALETTES,
  applyElementalPalette,
  paletteUnlocked,
  installAppendageGameplay,
  updateAppendageGameplay,
  computeBuildBounds,
  refreshDweebCollider,
  applyBuildToFighter,
} from '../src/builder/CustomDweebModel.js';
import { BuildADweebLab } from '../src/builder/BuildADweebLab.js';
import { BuildADweebHud } from '../src/builder/BuildADweebHud.js';
import {
  TournamentBracket,
  CHAMPION_BUILDS,
  TOURNAMENT_ROUNDS,
  powerOf,
  simulateAiMatch,
} from '../src/builder/Tournament.js';
import { CombatTelemetry } from '../src/builder/CombatTelemetry.js';
import { CameraController } from '../src/camera/CameraController.js';

// ─── Minimal DOM (mirrors test/challenger-m4.test.js) ────────────────────────
const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'link', 'meta']);

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.classList = {
      _classes: new Set(),
      add: (...c) => c.forEach(x => this.classList._classes.add(x)),
      remove: (...c) => c.forEach(x => this.classList._classes.delete(x)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._classes.has(c)) this.classList._classes.delete(c);
          else this.classList._classes.add(c);
        } else if (force) this.classList._classes.add(c);
        else this.classList._classes.delete(c);
      },
      contains: c => this.classList._classes.has(c),
    };
    this.attributes = {};
    this.listeners = {};
    this._value = '';
    this._textContent = '';
    this._innerHTML = '';
  }
  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = v; }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v); this._parseHTML(v); }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  removeEventListener() {}
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    event.preventDefault = () => {};
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) h(event);
    if (this.parentNode) this.parentNode.dispatchEvent(event);
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    const check = el => {
      if (matchesSelector(el, selector)) out.push(el);
      for (const c of el.children) check(c);
    };
    for (const c of this.children) check(c);
    return out;
  }
  closest(selector) {
    let cur = this;
    while (cur) {
      if (matchesSelector(cur, selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  _parseHTML(html) {
    this.children = [];
    const tokenRegex = /<!--[\s\S]*?-->|<([a-z0-9-]+)([^>]*?)(\/?)>|<\/([a-z0-9-]+)>|([^<]+)/gi;
    let match;
    const stack = [this];
    while ((match = tokenRegex.exec(html)) !== null) {
      const [full, openTag, rawAttrs, isSelfClosing, closeTag, text] = match;
      if (full.startsWith('<!--')) continue;
      if (openTag) {
        const tag = openTag.toLowerCase();
        const el = new MockElement(tag);
        stack[stack.length - 1].appendChild(el);
        const attrRegex = /([a-z0-9_-]+)(?:=["']([^"']*)["'])?/gi;
        let am;
        while ((am = attrRegex.exec(rawAttrs)) !== null) {
          const [, k, v = ''] = am;
          el.attributes[k] = v;
          if (k === 'id') el.id = v;
          if (k === 'class') v.split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
          if (k.startsWith('data-')) el.dataset[k.slice(5)] = v;
          if (k === 'value') el.value = v;
        }
        if (!VOID_TAGS.has(tag) && !isSelfClosing && !full.endsWith('/>')) stack.push(el);
      } else if (closeTag) {
        if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === closeTag.toLowerCase()) stack.pop();
      } else if (text && text.trim()) {
        const cur = stack[stack.length - 1];
        if (cur) cur.textContent = (cur.textContent || '') + text.trim();
      }
    }
  }
}

function matchesSelector(el, sel) {
  if (!el || !sel) return false;
  let rem = sel;
  const tag = rem.match(/^[a-z0-9-]+/i);
  if (tag) {
    if (el.tagName !== tag[0].toUpperCase()) return false;
    rem = rem.slice(tag[0].length);
  }
  for (const m of rem.matchAll(/\.([a-z0-9_-]+)/gi)) {
    if (!el.classList.contains(m[1])) return false;
  }
  rem = rem.replace(/\.[a-z0-9_-]+/gi, '');
  const idm = rem.match(/#([a-z0-9_-]+)/i);
  if (idm) {
    if (el.id !== idm[1]) return false;
    rem = rem.replace(/#[a-z0-9_-]+/gi, '');
  }
  for (const m of rem.matchAll(/\[([a-z0-9_-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/gi)) {
    const [, attr, val] = m;
    if (!(attr in el.attributes)) return false;
    if (val !== undefined && el.attributes[attr] !== val) return false;
  }
  return true;
}

function setupMockDom() {
  const root = new MockElement('body');
  globalThis.document = {
    head: new MockElement('head'),
    body: root,
    getElementById: id => (root.id === id ? root : root.querySelector(`#${id}`)),
    createElement: tag => new MockElement(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  return root;
}

function makeMockStorage() {
  return {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  };
}

// ─── Mock fighter dweebs ────────────────────────────────────────────────────
function makeMockFighter(overrides = {}) {
  const vel = { x: 0, y: 0, z: 0 };
  const f = {
    name: 'MockDweeb',
    active: true,
    eliminated: false,
    grounded: true,
    jumpsLeft: 2,
    hitstun: 0,
    groundSlamming: false,
    stats: { speed: 1, jump: 1, mass: 3 },
    body: {
      linvel: () => ({ ...vel }),
      setLinvel: nv => Object.assign(vel, nv),
      applyImpulse: vi.fn(),
    },
    getPosition: () => ({ x: 0, y: 1, z: 0 }),
    appendageGameplay: null,
    customModel: null,
    _vel: vel,
    ...overrides,
  };
  return f;
}

function makeMockCollider() {
  return { setHalfHeight: vi.fn(), setRadius: vi.fn(), setMass: vi.fn() };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Tournament ladder
// ═══════════════════════════════════════════════════════════════════════════
describe('Tournament ladder', () => {
  it('defines 7 champions with escalating power ratings', () => {
    expect(CHAMPION_BUILDS).toHaveLength(7);
    const powers = CHAMPION_BUILDS.map(powerOf);
    // strictly escalating from the player's QF draw to the grand-champion tier
    expect(powers[0]).toBeLessThan(powers[2]);
    expect(powers[2]).toBeLessThan(powers[4]);
    expect(powers[4]).toBeLessThan(powers[6]);
    // every champion uses BuilderBot DNA traits
    for (const c of CHAMPION_BUILDS) {
      expect(c.dna.confidence).toBeGreaterThanOrEqual(0);
      expect(c.dna.confidence).toBeLessThanOrEqual(1);
      expect(c.dna.aimAccuracy).toBeDefined();
      expect(c.dna.scavenge).toBeDefined();
      expect(c.dna.agility).toBeDefined();
      expect(APPENDAGES).toContain(c.appendage);
    }
  });

  it('builds a quarterfinal bracket with the player facing the softest champion', () => {
    const t = new TournamentBracket({ ...DEFAULT_BUILD_CONFIG, name: 'Hero' });
    const s = t.state();
    expect(s.status).toBe('in');
    expect(s.roundName).toBe('QUARTERFINALS');
    expect(s.rounds[0].matches).toHaveLength(4);
    expect(s.opponent.name).toBe('Rusty Rivet');
    expect(s.playerMatch).not.toBeNull();
  });

  it('advances QF → SF → Final → Champion on wins with increasingly strong opponents', () => {
    const rng = () => 0; // deterministic: first entrant wins every undercard bout
    const t = new TournamentBracket({ ...DEFAULT_BUILD_CONFIG, name: 'Hero' }, rng);
    const oppPowers = [];
    oppPowers.push(powerOf(t.opponentForPlayer()));
    t.recordPlayerResult(true);
    expect(t.state().roundName).toBe('SEMIFINALS');
    oppPowers.push(powerOf(t.opponentForPlayer()));
    t.recordPlayerResult(true);
    expect(t.state().roundName).toBe('GRAND FINAL');
    oppPowers.push(powerOf(t.opponentForPlayer()));
    const final = t.recordPlayerResult(true);
    expect(final.status).toBe('champion');
    expect(final.champion.name).toBe('Hero');
    // each round's champion is more formidable than the last
    expect(oppPowers[0]).toBeLessThan(oppPowers[1]);
    expect(oppPowers[1]).toBeLessThan(oppPowers[2]);
    expect(t.playerMatch()).toBeNull();
    expect(t.opponentForPlayer()).toBeNull();
  });

  it('eliminates the player on a loss and stops the run', () => {
    const t = new TournamentBracket({ ...DEFAULT_BUILD_CONFIG });
    const s = t.recordPlayerResult(false);
    expect(s.status).toBe('eliminated');
    expect(t.playerMatch()).toBeNull();
    expect(t.opponentForPlayer()).toBeNull();
  });

  it('simulates undercard bouts proportionally to power (deterministic rng)', () => {
    const weak = { stats: { mass: 2, armor: 0.8, speed: 0.9, jump: 0.9 }, dna: { confidence: 0.3, aimAccuracy: 0.3, scavenge: 0.3, agility: 0.3 } };
    const strong = { stats: { mass: 4, armor: 1.5, speed: 1.3, jump: 1.3 }, dna: { confidence: 0.95, aimAccuracy: 0.95, scavenge: 0.9, agility: 0.95 } };
    expect(powerOf(strong)).toBeGreaterThan(powerOf(weak));
    // rng()=0 → first entrant always wins; rng()→1 → second entrant always wins
    expect(simulateAiMatch(weak, strong, () => 0)).toBe(weak);
    expect(simulateAiMatch(weak, strong, () => 0.9999)).toBe(strong);
  });

  it('has exactly three rounds: Quarterfinals → Semifinals → Grand Final', () => {
    expect(TOURNAMENT_ROUNDS.map(r => r.id)).toEqual(['quarterfinal', 'semifinal', 'final']);
  });

  it('serializes and restores mid-tournament state', () => {
    const t = new TournamentBracket({ ...DEFAULT_BUILD_CONFIG, name: 'Hero' }, () => 0);
    t.recordPlayerResult(true);
    const restored = TournamentBracket.fromJSON(t.toJSON());
    expect(restored.state().roundName).toBe('SEMIFINALS');
    expect(restored.opponentForPlayer().name).toBe(t.opponentForPlayer().name);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Appendages: visuals + gameplay effects
// ═══════════════════════════════════════════════════════════════════════════
describe('New appendages', () => {
  const NEW = ['dragon_wings', 'anvil_tail', 'magnet_eyes', 'spring_stompers'];

  it('registers the four new appendage types', () => {
    for (const a of NEW) expect(APPENDAGES).toContain(a);
  });

  it('builds visible geometry for every new appendage', () => {
    for (const a of NEW) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, appendage: a });
      expect(model.appGroup.children.length).toBeGreaterThan(0);
    }
  });

  it('exposes gameplay descriptors for every appendage', () => {
    for (const a of APPENDAGES) {
      expect(APPENDAGE_GAMEPLAY[a]).toBeDefined();
      expect(APPENDAGE_GAMEPLAY[a].label).toBeTruthy();
    }
    expect(APPENDAGE_GAMEPLAY.dragon_wings.glideMaxFall).toBeGreaterThan(0);
    expect(APPENDAGE_GAMEPLAY.anvil_tail.stunDuration).toBeGreaterThan(0);
    expect(APPENDAGE_GAMEPLAY.magnet_eyes.magnetRadius).toBeGreaterThan(0);
    expect(APPENDAGE_GAMEPLAY.spring_stompers.jumpMul).toBeGreaterThan(1);
  });

  it('dragon_wings: glides (caps sink rate) and grants one bonus air jump per flight', () => {
    const d = makeMockFighter({ grounded: false });
    installAppendageGameplay(d, { appendage: 'dragon_wings' });
    d._vel.y = -20;
    updateAppendageGameplay(d, 1 / 60, {});
    expect(d._vel.y).toBe(-APPENDAGE_GAMEPLAY.dragon_wings.glideMaxFall);

    // glide recovery: out of jumps mid-air → one bonus jump, only once per flight
    d.jumpsLeft = 0;
    d.appendageGameplay.st.glideUsedThisAir = false;
    updateAppendageGameplay(d, 1 / 60, {});
    expect(d.jumpsLeft).toBe(1);
    d.jumpsLeft = 0;
    updateAppendageGameplay(d, 1 / 60, {});
    expect(d.jumpsLeft).toBe(0); // not refreshed until landing
    d.grounded = true;
    updateAppendageGameplay(d, 1 / 60, {});
    expect(d.appendageGameplay.st.glideUsedThisAir).toBe(false); // re-armed
  });

  it('anvil_tail: hard landings stun nearby rivals (once per slam)', () => {
    const d = makeMockFighter({ grounded: false });
    installAppendageGameplay(d, { appendage: 'anvil_tail' });
    const rival = makeMockFighter({ name: 'Rival' });
    rival.getPosition = () => ({ x: 2, y: 1, z: 0 }); // within stunRadius
    const far = makeMockFighter({ name: 'Far' });
    far.getPosition = () => ({ x: 30, y: 1, z: 0 });
    const ctx = { rivals: [rival, far] };

    // falling fast, then lands hard
    d._vel.y = -12;
    updateAppendageGameplay(d, 1 / 60, ctx); // still airborne
    expect(rival.hitstun).toBe(0);
    d.grounded = true;
    updateAppendageGameplay(d, 1 / 60, ctx); // slam!
    expect(rival.hitstun).toBe(APPENDAGE_GAMEPLAY.anvil_tail.stunDuration);
    expect(far.hitstun).toBe(0);

    // no double-trigger while staying grounded
    rival.hitstun = 0;
    updateAppendageGameplay(d, 1 / 60, ctx);
    expect(rival.hitstun).toBe(0);
  });

  it('magnet_eyes: pulls loose nearby items toward the fighter', () => {
    const d = makeMockFighter();
    installAppendageGameplay(d, { appendage: 'magnet_eyes' });
    const near = { body: { applyImpulse: vi.fn() }, mesh: { position: { x: 3, y: 1, z: 0 } }, isGrabbed: false };
    const grabbed = { body: { applyImpulse: vi.fn() }, mesh: { position: { x: 3, y: 1, z: 0 } }, isGrabbed: true };
    const distant = { body: { applyImpulse: vi.fn() }, mesh: { position: { x: 40, y: 1, z: 0 } }, isGrabbed: false };
    updateAppendageGameplay(d, 1 / 60, { objects: [near, grabbed, distant] });
    expect(near.body.applyImpulse).toHaveBeenCalled();
    const imp = near.body.applyImpulse.mock.calls[0][0];
    expect(imp.x).toBeLessThan(0); // toward the fighter at x=0
    expect(grabbed.body.applyImpulse).not.toHaveBeenCalled();
    expect(distant.body.applyImpulse).not.toHaveBeenCalled();
  });

  it('spring_stompers: +35% jump and bounce on hard landings, no compounding', () => {
    const d = makeMockFighter({ grounded: false });
    installAppendageGameplay(d, { appendage: 'spring_stompers' });
    expect(d.stats.jump).toBeCloseTo(1.35, 5);
    // re-install (mutation) must not compound
    installAppendageGameplay(d, { appendage: 'spring_stompers' });
    expect(d.stats.jump).toBeCloseTo(1.35, 5);

    d._vel.y = -10;
    updateAppendageGameplay(d, 1 / 60, {}); // airborne
    d.grounded = true;
    updateAppendageGameplay(d, 1 / 60, {}); // hard landing → bounce
    expect(d._vel.y).toBeCloseTo(Math.min(10 * 0.45, 9), 5);
  });

  it('bindFighter drives gameplay through the existing animate() call', () => {
    const d = makeMockFighter({ grounded: false });
    d._vel.y = -30;
    const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, appendage: 'dragon_wings' });
    d.customModel = model;
    model.bindFighter(d);
    expect(() => { model.animate(0.5); model.animate(0.6); }).not.toThrow();
    expect(d._vel.y).toBe(-APPENDAGE_GAMEPLAY.dragon_wings.glideMaxFall);
  });

  it('applyBuildToFighter rebuilds model, stats, gameplay and collider together', () => {
    const rig = new THREE.Group();
    const d = makeMockFighter({ rig, flashMats: [], collider: makeMockCollider() });
    const custom = applyBuildToFighter(d, { ...DEFAULT_BUILD_CONFIG, appendage: 'spring_stompers', stats: { mass: 3.5 } });
    expect(custom).toBe(d.customModel);
    expect(rig.children).toContain(custom.root);
    expect(d.stats.mass).toBe(3.5);
    expect(d.collider.setMass).toHaveBeenCalledWith(3.5);
    expect(d.collider.setRadius).toHaveBeenCalled();
    expect(d.appendageGameplay.type).toBe('spring_stompers');
    expect(d.stats.jump).toBeCloseTo(1.35, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Elemental palettes
// ═══════════════════════════════════════════════════════════════════════════
describe('Elemental palettes', () => {
  it('applies palette colors onto a config copy', () => {
    const out = applyElementalPalette(DEFAULT_BUILD_CONFIG, 'ember');
    expect(out.primaryColor).toBe(ELEMENTAL_PALETTES.ember.primaryColor);
    expect(out.accentColor).toBe(ELEMENTAL_PALETTES.ember.accentColor);
    expect(out.palette).toBe('ember');
    expect(DEFAULT_BUILD_CONFIG.palette).toBeUndefined(); // pure
    expect(applyElementalPalette(DEFAULT_BUILD_CONFIG, 'nope').primaryColor)
      .toBe(DEFAULT_BUILD_CONFIG.primaryColor);
  });

  it('gates palettes behind real progression', () => {
    expect(paletteUnlocked('ember', {})).toBe(false);
    expect(paletteUnlocked('ember', { tournamentsEntered: true })).toBe(true);
    expect(paletteUnlocked('frost', { roundsWon: 1 })).toBe(true);
    expect(paletteUnlocked('frost', { roundsWon: 0 })).toBe(false);
    expect(paletteUnlocked('storm', { finalsReached: true })).toBe(true);
    expect(paletteUnlocked('terra', { roundsWon: 2 })).toBe(true);
    expect(paletteUnlocked('void', { tournamentsWon: true })).toBe(true);
    expect(paletteUnlocked('solar', { totalDamageDealt: 500 })).toBe(true);
    expect(paletteUnlocked('solar', { totalDamageDealt: 499 })).toBe(false);
    expect(paletteUnlocked('nope', {})).toBe(false);
  });

  it('builds a model with palette colors', () => {
    const cfg = applyElementalPalette(DEFAULT_BUILD_CONFIG, 'void');
    const model = buildCustomDweebModel(cfg);
    expect(model.config.primaryColor).toBe(ELEMENTAL_PALETTES.void.primaryColor);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Combat telemetry
// ═══════════════════════════════════════════════════════════════════════════
describe('CombatTelemetry', () => {
  function feed(t) {
    t.recordDamage({ attackerId: 'a', attackerName: 'Alpha', targetId: 'b', targetName: 'Beta', damage: 10, time: 1 });
    t.recordDamage({ attackerId: 'a', targetId: 'b', damage: 20, time: 2 });
    t.recordDamage({ attackerId: 'a', targetId: 'b', damage: 30, time: 8 });
    t.recordDamage({ attackerId: 'b', targetId: 'a', damage: 15, time: 3 });
    t.recordEvasion({ dweebId: 'a', time: 4 });
    t.recordEvasion({ dweebId: 'a', time: 5 });
    t.recordEvasion({ dweebId: 'a', time: 6 });
    t.recordRecoveryJump({ dweebId: 'b', time: 7 });
    t.recordRecoveryJump({ dweebId: 'b', time: 9 });
    t.recordImpact({ dweebId: 'a', force: 22.5, time: 8 });
    t.recordImpact({ dweebId: 'a', force: 12, time: 9 });
    t.recordKO({ dweebId: 'b', name: 'Beta', byId: 'a', time: 10 });
  }

  it('computes rolling DPS from recorded damage events', () => {
    const t = new CombatTelemetry();
    feed(t);
    // window (3,8]: only the t=8 hit (30) → 30/5
    expect(t.dps('a', 5, 8)).toBe(6);
    expect(t.dps('a', 5, 2)).toBe(6); // (10+20)/5
    expect(t.totalDamage('a')).toBe(60);
    expect(t.totalDamage('nope')).toBe(0);
  });

  it('computes peak DPS across the bout', () => {
    const t = new CombatTelemetry();
    feed(t);
    expect(t.peakDps('a', 5)).toBe(6);
  });

  it('computes evasion rate from evasions vs hits taken', () => {
    const t = new CombatTelemetry();
    feed(t);
    // a: 3 evasions, 1 hit taken (15 dmg from b) → 3/4
    expect(t.evasionRate('a')).toBeCloseTo(0.75, 5);
    expect(t.evasionRate('ghost')).toBe(0);
  });

  it('counts recovery jumps and tracks peak kinetic impact force', () => {
    const t = new CombatTelemetry();
    feed(t);
    expect(t.recoveryJumps('b')).toBe(2);
    expect(t.recoveryJumps('a')).toBe(0);
    expect(t.peakImpact('a')).toBe(22.5);
    expect(t.peakImpact('b')).toBe(0);
  });

  it('produces an end-of-match recap with a damage timeline graph', () => {
    const t = new CombatTelemetry();
    feed(t);
    const recap = t.recap(2);
    expect(recap.fighters).toHaveLength(2);
    // sorted by damage dealt: Alpha (60) first
    expect(recap.fighters[0].name).toBe('Alpha');
    expect(recap.fighters[0].damageDealt).toBe(60);
    expect(recap.fighters[0].evasionRate).toBeCloseTo(0.75, 5);
    expect(recap.fighters[0].kos).toBe(1);
    expect(recap.fighters[1].recoveryJumps).toBe(2);
    // timeline buckets cover the whole bout and sum to total damage
    const total = recap.timeline.reduce((s, b) => s + b.total, 0);
    expect(total).toBe(75);
    expect(recap.duration).toBe(9); // t=1..10
    for (const b of recap.timeline) {
      expect(Object.keys(b.per)).toContain('a');
      expect(Object.keys(b.per)).toContain('b');
    }
  });

  it('round-trips through JSON without losing names or numbers', () => {
    const t = new CombatTelemetry();
    feed(t);
    const t2 = CombatTelemetry.fromJSON(t.toJSON());
    expect(t2.totalDamage('a')).toBe(60);
    expect(t2.evasionRate('a')).toBeCloseTo(0.75, 5);
    expect(t2.peakImpact('a')).toBe(22.5);
    expect(t2.recap().fighters[0].name).toBe('Alpha');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Bug fix: spectator camera high-action framing
// ═══════════════════════════════════════════════════════════════════════════
describe('CameraController high-action framing (bug fix)', () => {
  function makeController() {
    globalThis.document = { addEventListener() {}, removeEventListener() {}, pointerLockElement: null };
    const canvas = { addEventListener() {}, removeEventListener() {} };
    const camera = {
      fov: 60,
      position: new THREE.Vector3(),
      lookAt() {},
      updateProjectionMatrix() {},
    };
    const cam = new CameraController(camera, canvas);
    cam.setMode('explorer');
    return { cam, camera };
  }

  const step = (cam, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) cam.update(dt); };

  it('leaves normal ground-level follow bit-identical (no engagement)', () => {
    const { cam } = makeController();
    cam.setTarget(0, 2, 0); // → target.y = 3.2
    step(cam, 180);
    expect(cam.highActionAmount).toBeCloseTo(0, 3);
    expect(cam.currentTarget.y).toBeCloseTo(3.2, 2);
  });

  it('compresses extreme follow heights instead of chasing fighters into the sky', () => {
    const { cam, camera } = makeController();
    cam.setTarget(0, 26, 0); // explosive launch toward the blastTop → target.y = 27.2
    step(cam, 300);
    // engaged, but the follow height is compressed well under the raw target
    expect(cam.highActionAmount).toBeGreaterThan(0.9);
    expect(cam.currentTarget.y).toBeLessThan(20); // raw chase would reach ~27.2
    expect(cam.currentTarget.y).toBeGreaterThan(10); // still rises with the action
    // camera itself stays within sane bounds (no sky-chasing)
    expect(camera.position.y).toBeLessThan(30);
    expect(camera.position.y).toBeGreaterThan(cam.minCameraY);
  });

  it('disengages smoothly when the action comes back down', () => {
    const { cam } = makeController();
    cam.setTarget(0, 26, 0);
    step(cam, 200);
    expect(cam.highActionAmount).toBeGreaterThan(0.5);
    cam.setTarget(0, 2, 0);
    step(cam, 300);
    expect(cam.highActionAmount).toBeCloseTo(0, 2);
    expect(cam.currentTarget.y).toBeCloseTo(3.2, 1);
  });

  it('never engages in first_person mode (camera stays glued to the head)', () => {
    const { cam } = makeController();
    cam.setMode('first_person');
    cam.setTarget(0, 26, 0);
    step(cam, 120);
    expect(cam.highActionAmount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Bug fix: DNA mutations synchronously refresh colliders (no reload)
// ═══════════════════════════════════════════════════════════════════════════
describe('DNA mutation → collider sync (bug fix)', () => {
  let lab;
  beforeEach(() => {
    globalThis.localStorage = makeMockStorage();
    lab = new BuildADweebLab(new THREE.Scene(), null, null);
  });

  it('computeBuildBounds reflects config dimensions', () => {
    const small = computeBuildBounds({ ...DEFAULT_BUILD_CONFIG, width: 0.6, height: 0.6, depth: 0.6 });
    const big = computeBuildBounds({ ...DEFAULT_BUILD_CONFIG, width: 1.8, height: 1.7, depth: 1.6 });
    const ss = small.getSize(new THREE.Vector3());
    const bs = big.getSize(new THREE.Vector3());
    expect(bs.x).toBeGreaterThan(ss.x);
    expect(bs.y).toBeGreaterThan(ss.y);
  });

  it('refreshDweebCollider resizes the capsule in place and syncs mass', () => {
    const d = { collider: makeMockCollider(), stats: { mass: 3 } };
    const applied = refreshDweebCollider(d, { ...DEFAULT_BUILD_CONFIG, stats: { mass: 4.2 } });
    expect(d.collider.setRadius).toHaveBeenCalledWith(applied.radius);
    expect(d.collider.setHalfHeight).toHaveBeenCalledWith(applied.halfHeight);
    expect(d.collider.setMass).toHaveBeenCalledWith(4.2);
    expect(applied.radius).toBeGreaterThan(0.15);
  });

  it('mutating the lab with an attached fighter refreshes its collider synchronously', () => {
    const fighter = { collider: makeMockCollider(), stats: { speed: 1, jump: 1, mass: 3 } };
    lab.attachFighter(fighter);
    expect(fighter.collider.setRadius).toHaveBeenCalled(); // immediate sync on attach

    const r1 = fighter.collider.setRadius.mock.calls.at(-1)[0];
    const h1 = fighter.collider.setHalfHeight.mock.calls.at(-1)[0];

    // DNA mutation: bigger body — collider bounds must change with NO reload
    lab.updateConfig({ width: 1.8, height: 1.7, depth: 1.6 });
    const r2 = fighter.collider.setRadius.mock.calls.at(-1)[0];
    const h2 = fighter.collider.setHalfHeight.mock.calls.at(-1)[0];
    expect(r2).not.toBe(r1);
    expect(h2).not.toBe(h1);

    // mass mutation syncs too
    lab.updateConfig({ stats: { mass: 4.2 } });
    expect(fighter.collider.setMass).toHaveBeenCalledWith(4.2);

    // detached fighters are untouched by later mutations
    lab.detachFighter();
    const calls = fighter.collider.setRadius.mock.calls.length;
    lab.updateConfig({ width: 0.6 });
    expect(fighter.collider.setRadius.mock.calls.length).toBe(calls);
    lab.dispose();
  });

  it('mutateRandom on an attached fighter also refreshes the collider', () => {
    const fighter = { collider: makeMockCollider(), stats: { speed: 1, jump: 1, mass: 3 } };
    lab.attachFighter(fighter);
    const before = fighter.collider.setRadius.mock.calls.length;
    lab.mutateRandom();
    expect(fighter.collider.setRadius.mock.calls.length).toBeGreaterThan(before);
    lab.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Lab tournament wiring + HUD integration
// ═══════════════════════════════════════════════════════════════════════════
describe('BuildADweebLab tournament wiring', () => {
  let lab;
  beforeEach(() => {
    globalThis.localStorage = makeMockStorage();
    lab = new BuildADweebLab(new THREE.Scene(), null, null);
  });

  it('starts a tournament, serves the QF opponent, and records results', () => {
    const s0 = lab.startTournament();
    expect(s0.roundName).toBe('QUARTERFINALS');
    expect(lab.tournamentOpponent().name).toBe('Rusty Rivet');
    const s1 = lab.recordTournamentResult(true);
    expect(s1.roundName).toBe('SEMIFINALS');
    expect(lab.tournamentState().status).toBe('in');
    lab.dispose();
  });

  it('persists an in-progress tournament across lab instances (workshop round-trip)', () => {
    lab.startTournament();
    lab.recordTournamentResult(true);
    const lab2 = new BuildADweebLab(new THREE.Scene(), null, null);
    expect(lab2.tournamentState().roundName).toBe('SEMIFINALS');
    lab.dispose();
    lab2.dispose();
  });

  it('clears storage when the run ends and supports abandon', () => {
    lab.startTournament();
    const s = lab.recordTournamentResult(false);
    expect(s.status).toBe('eliminated');
    // the finished bracket stays renderable, but nothing persists
    expect(lab.tournamentState().status).toBe('eliminated');
    expect(globalThis.localStorage.getItem('dweebs-tournament-v1')).toBeNull();
    const lab2 = new BuildADweebLab(new THREE.Scene(), null, null);
    expect(lab2.tournamentState()).toBeNull();
    lab2.dispose();
    lab.startTournament();
    lab.abandonTournament();
    expect(lab.tournamentState()).toBeNull();
    lab.dispose();
  });
});

describe('BuildADweebHud tournament + telemetry UI', () => {
  let root, lab, hud, launched;
  beforeEach(() => {
    root = setupMockDom();
    globalThis.localStorage = makeMockStorage();
    lab = new BuildADweebLab(new THREE.Scene(), null, null);
    launched = null;
    hud = new BuildADweebHud(root, {
      onTournamentStart: () => lab.startTournament(),
      onTournamentState: () => lab.tournamentState(),
      onTournamentFight: () => lab.tournamentOpponent(),
      onTournamentResult: won => lab.recordTournamentResult(won),
      onTournamentAbandon: () => lab.abandonTournament(),
      onLaunchTournament: cfg => { launched = cfg; },
    });
  });

  it('starts a tournament from the HUD and shows the bracket', () => {
    root.querySelector('#bd-btn-tournament').click();
    const body = root.querySelector('#bd-tournament-body');
    expect(body.innerHTML).toContain('QUARTERFINALS');
    expect(body.innerHTML).toContain('Rusty Rivet');
    expect(root.querySelector('[data-tact="fight"]')).not.toBeNull();
  });

  it('fight button launches the pending champion config', () => {
    root.querySelector('#bd-btn-tournament').click();
    root.querySelector('[data-tact="fight"]').click();
    expect(launched).not.toBeNull();
    expect(launched.name).toBe('Rusty Rivet');
  });

  it('records a win and advances the bracket display', () => {
    root.querySelector('#bd-btn-tournament').click();
    root.querySelector('[data-tact="won"]').click();
    expect(root.querySelector('#bd-tournament-body').innerHTML).toContain('SEMIFINALS');
  });

  it('applies an elemental palette from the HUD', () => {
    const patches = [];
    const hud2 = new BuildADweebHud(root, { onConfigChange: p => patches.push(p) });
    const btn = hud2.root.querySelector('#bd-seg-palette').querySelector('[data-v="ember"]');
    btn.click();
    expect(patches.length).toBe(1);
    expect(patches[0].primaryColor).toBe(ELEMENTAL_PALETTES.ember.primaryColor);
    expect(patches[0].palette).toBe('ember');
    expect(btn.classList.contains('active')).toBe(true);
    hud2.dispose();
  });

  it('shows live DPS and renders the end-of-match recap', () => {
    const t = new CombatTelemetry();
    t.recordDamage({ attackerId: 'a', attackerName: 'Alpha', targetId: 'b', targetName: 'Beta', damage: 25, time: 1 });
    t.recordEvasion({ dweebId: 'a', time: 2 });
    t.recordImpact({ dweebId: 'a', force: 30, time: 3 });
    hud.attachTelemetry(t);
    expect(root.querySelector('#bd-t-dps').textContent).toContain('5.0');
    expect(root.querySelector('#bd-t-impact-num').textContent).toBe('30.0');

    const recap = t.recap();
    hud.renderMatchRecap(recap);
    expect(root.querySelector('#bd-recap-table').innerHTML).toContain('Alpha');
    // persisted for the next workshop visit
    expect(globalThis.localStorage.getItem('dweebs-last-telemetry')).toContain('Alpha');
    lab.dispose();
  });
});
