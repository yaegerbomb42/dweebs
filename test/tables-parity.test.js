// T6 parity: every drop key must exist in OBJECT_DEFS (imported live, not copied),
// every table key must be a droppable-or-weapon item, and weapon/explosive flags must agree.
// Weights/shapes are tuned per-layer and intentionally NOT asserted — only identity + flags.
import { describe, it, expect } from 'vitest';
import { DROP_ITEMS, RARE, WEAPONS, ITEM_DEFS, itemDef } from '../src/sim/tables.js';
import { OBJECT_DEFS } from '../src/world/ObjectRegistry.js';
import { DIFFICULTY as LIVE_DIFF } from '../src/ai/Bot.js';
import { DIFFICULTY as SIM_DIFF } from '../src/sim/bot.js';
import { STYLE as LIVE_STYLE } from '../src/combat/CombatSystem.js';
import { BALANCE } from '../src/game/Balance.js';
import { NEUTRAL_INPUT } from '../src/sim/contracts.js';
import { EMPTY_INPUT, sanitizeInput } from '../src/net/protocol.js';

describe('tables parity (T6)', () => {
  it('every sim drop key is a real OBJECT_DEFS entry with no duplicates', () => {
    const seen = new Set();
    for (const { key, w } of DROP_ITEMS) {
      expect(OBJECT_DEFS[key], `sim drop key ${key} missing from OBJECT_DEFS`).toBeTruthy();
      expect(w).toBeGreaterThan(0);
      expect(seen.has(key), `duplicate drop key ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('every ITEM_DEFS key exists in OBJECT_DEFS and weapon/explosive flags agree', () => {
    for (const [key, def] of Object.entries(ITEM_DEFS)) {
      const live = OBJECT_DEFS[key];
      expect(live, `ITEM_DEFS key ${key} missing from OBJECT_DEFS`).toBeTruthy();
      expect(!!def.weapon).toBe(!!live.weapon);
      expect(!!def.explosive).toBe(!!live.explosive);
      if (def.blast) expect(live.explosionRadius).toBe(def.blast);
    }
  });

  it('WEAPONS keys resolve to real weapon defs on both sides', () => {
    for (const [itemKey, w] of Object.entries(WEAPONS)) {
      const live = OBJECT_DEFS[itemKey];
      expect(live?.weapon, `${itemKey} not a weapon in OBJECT_DEFS`).toBeTruthy();
      expect(w.range).toBeGreaterThan(0);
      expect(w.cd).toBeGreaterThan(0);
    }
  });

  it('RARE keys are all real drop keys', () => {
    const drops = new Set(DROP_ITEMS.map(d => d.key));
    for (const key of Object.keys(RARE)) expect(drops.has(key)).toBe(true);
  });

  it('STYLE single source: CombatSystem.STYLE === BALANCE.style', () => {
    expect(LIVE_STYLE).toBe(BALANCE.style);
    expect(BALANCE.style.tiers).toEqual([0, 25, 55, 90]);
  });

  it('DIFFICULTY tables agree across live Bot and sim Bot', () => {
    expect(Object.keys(SIM_DIFF).sort()).toEqual(Object.keys(LIVE_DIFF).sort());
    for (const k of Object.keys(LIVE_DIFF)) expect(SIM_DIFF[k]).toEqual(LIVE_DIFF[k]);
  });

  it('input unification (T4): sanitizeInput emits both canonical + legacy aliases', () => {
    const s = sanitizeInput({ moveX: 0.5, moveY: -0.7, special: true, down: 1 });
    expect(s.moveZ).toBeCloseTo(-0.7, 6);
    expect(s.moveY).toBeCloseTo(-0.7, 6); // legacy alias mirrors canonical
    expect(s.superYeet).toBe(true);
    expect(s.special).toBe(true); // legacy alias mirrors canonical
    expect(s.drop).toBe(true);
    expect(s.down).toBe(true);
    const cz = sanitizeInput({ moveX: 0.2, moveZ: 0.9 });
    expect(cz.moveY).toBeCloseTo(0.9, 6);
    expect(cz.moveZ).toBeCloseTo(0.9, 6);
    expect(NEUTRAL_INPUT.moveZ).toBe(0);
    expect(EMPTY_INPUT.moveZ).toBe(0);
    expect(EMPTY_INPUT.moveY).toBe(0);
  });

  it('itemDef falls back instead of NaN for unknown keys', () => {
    const d = itemDef('nope-not-real');
    expect(Number.isFinite(d.mass)).toBe(true);
  });
});
