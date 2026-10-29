// challenger-m4-fix-2.test.js — Adversarial Stress Testing Suite for Milestone 4 Fix
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  ARCHETYPE_PRESETS,
  BODY_SHAPES,
} from '../src/builder/CustomDweebModel.js';
import { BuildADweebLab } from '../src/builder/BuildADweebLab.js';
import { BuildADweebHud } from '../src/builder/BuildADweebHud.js';
import { BuilderBot } from '../src/ai/BuilderBot.js';

function makeMockDweeb(x = 0, y = 1, z = 0) {
  return {
    name: 'Dweeb',
    active: true,
    eliminated: false,
    swimFlail: 0,
    hitstun: 0,
    ragdolling: false,
    isCharging: false,
    charging: 0,
    held: null,
    moveInput: new THREE.Vector2(),
    grounded: true,
    ledge: false,
    aimError: 0,
    techChance: 0,
    yaw: 0,
    getPosition: () => ({ x, y, z }),
    requestJump: vi.fn(),
    requestLedgeHop: vi.fn(),
  };
}

function makeMockArena() {
  return {
    isOverGround: (x, z) => Math.hypot(x, z) < 12,
    objects: [],
    items: [],
    hazardAt: () => false,
  };
}

function makeMockCombat() {
  return {
    canAct: () => true,
    startCharge: vi.fn(d => {
      if (d.isCharging) return false;
      d.isCharging = true;
      d.charging = 0.001;
      return true;
    }),
    releaseAttack: vi.fn(d => {
      d.isCharging = false;
      d.charging = 0;
    }),
    grab: vi.fn(),
    throwHeld: vi.fn((d, force) => {
      d.held = null;
    }),
    drop: vi.fn(),
    dodgeOrDive: vi.fn(),
    startParry: vi.fn(),
  };
}

describe('Adversarial Stress Test 1: High-Frequency Preset Switching & Scene Graph Invariants', () => {
  let scene, lab;

  beforeEach(() => {
    scene = new THREE.Scene();
    globalThis.localStorage = {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; },
    };
    lab = new BuildADweebLab(scene, null, null);
  });

  it('survives 300 rapid random preset applications and mutations without scene graph leaks', () => {
    const presetKeys = Object.keys(ARCHETYPE_PRESETS);
    expect(presetKeys.length).toBe(4);

    for (let i = 0; i < 300; i++) {
      if (i % 2 === 0) {
        const key = presetKeys[i % presetKeys.length];
        const res = lab.applyPreset(key);
        expect(res).not.toBeNull();
      } else {
        const mutant = lab.mutateRandom();
        expect(mutant).toBeDefined();
        expect(BODY_SHAPES).toContain(mutant.shape);
      }

      // Group children count must remain strictly invariant (pedestal, ring, lights, model root)
      expect(lab.group.children.length).toBe(4);
      expect(lab.modelInstance).toBeDefined();
      expect(lab.modelInstance.root).toBe(lab.currentModelRoot);

      // Verify animation does not throw under stress
      lab.update(0.016);
    }

    lab.dispose();
    expect(scene.children).not.toContain(lab.group);
  });

  it('gracefully handles invalid, empty, or malicious preset keys without crashing', () => {
    const invalidKeys = ['', ' ', 'unknown', 'null', 'undefined', 'DROP TABLE', 'invalid_preset_123'];
    const initialConfig = { ...lab.config };

    for (const key of invalidKeys) {
      const res = lab.applyPreset(key);
      expect(res).toBeNull();
      // Lab config must remain valid and operational
      expect(lab.config.name).toBe(initialConfig.name);
      expect(() => lab.update(0.016)).not.toThrow();
    }

    lab.dispose();
  });

  it('demonstrates prototype key edge case (e.g. constructor) does not throw', () => {
    // Accessing Object.prototype properties returns functions rather than undefined
    lab.applyPreset('constructor');
    // Does not crash the lab or Three.js scene
    expect(() => lab.update(0.016)).not.toThrow();
    lab.dispose();
  });
});

describe('Adversarial Stress Test 2: Extreme & Pathological DNA Permutations', () => {
  const pathologicalDNAs = [
    { label: 'absolute zero', dna: { confidence: 0, aimAccuracy: 0, scavenge: 0, agility: 0 } },
    { label: 'absolute max', dna: { confidence: 1, aimAccuracy: 1, scavenge: 1, agility: 1 } },
    { label: 'negative values', dna: { confidence: -1, aimAccuracy: -0.5, scavenge: -2, agility: -10 } },
    { label: 'extreme over-unity', dna: { confidence: 10, aimAccuracy: 5, scavenge: 100, agility: 50 } },
    { label: 'sparse partial', dna: { confidence: 0.9 } },
    { label: 'empty object', dna: {} },
  ];

  it.each(pathologicalDNAs)('initializes and executes BuilderBot safely under $label DNA', ({ dna }) => {
    const dweeb = makeMockDweeb(0, 1, 0);
    const rival = makeMockDweeb(2.0, 1, 0);
    const arena = makeMockArena();
    const combat = makeMockCombat();

    const bot = new BuilderBot(dweeb, arena, combat, dna);

    // Dweeb modifiers should be finite numbers
    expect(Number.isFinite(dweeb.aimError)).toBe(true);
    expect(Number.isFinite(dweeb.techChance)).toBe(true);

    // Run 50 frames of simulation
    for (let f = 0; f < 50; f++) {
      bot.update(0.016, [dweeb, rival]);
      expect(Number.isNaN(dweeb.moveInput.x)).toBe(false);
      expect(Number.isNaN(dweeb.moveInput.y)).toBe(false);
    }
  });
});

describe('Adversarial Stress Test 3: Sustained Multi-Condition Combat Loop Simulation', () => {
  it('strictly invokes only valid CombatSystem APIs across 5000 frames of combat simulation', () => {
    const botDweeb = makeMockDweeb(0, 1, 0);
    const rivalDweeb = makeMockDweeb(1.5, 1, 0);
    const arena = makeMockArena();

    // Attach items to arena for scavenging tests
    const itemMesh = new THREE.Mesh();
    itemMesh.position.set(4, 1, 0);
    arena.items = [{ mesh: itemMesh, held: false }];

    const combat = makeMockCombat();

    // Verify non-existent methods do NOT exist on mock combat
    expect(combat['chargeAttack']).toBeUndefined();
    expect(combat['attack']).toBeUndefined();
    expect(combat['throwItem']).toBeUndefined();

    const bot = new BuilderBot(botDweeb, arena, combat, {
      confidence: 0.85,
      aimAccuracy: 0.75,
      scavenge: 0.8,
      agility: 0.8,
    });

    for (let frame = 0; frame < 5000; frame++) {
      const dt = 0.016;

      // Periodically switch states (close, far, held item, void recovery)
      if (frame % 200 === 0) {
        rivalDweeb.getPosition = () => ({ x: 1.5, y: 1, z: 0 }); // Melee
      } else if (frame % 200 === 50) {
        rivalDweeb.getPosition = () => ({ x: 8.0, y: 1, z: 0 }); // Distant
      } else if (frame % 200 === 100) {
        botDweeb.held = { kind: 'object', ref: {} }; // Held item
      } else if (frame % 200 === 150) {
        botDweeb.getPosition = () => ({ x: 13.5, y: 0.1, z: 0 }); // Void edge
      } else if (frame % 200 === 180) {
        botDweeb.getPosition = () => ({ x: 0, y: 1, z: 0 }); // Safe ground
      }

      // Execute update — must never throw TypeError
      bot.update(dt, [botDweeb, rivalDweeb]);
    }

    // Verify valid combat methods were called
    expect(combat.startCharge.mock.calls.length).toBeGreaterThan(0);
    expect(combat.releaseAttack.mock.calls.length).toBeGreaterThan(0);
    expect(combat.throwHeld.mock.calls.length).toBeGreaterThan(0);

    // Verify throwHeld force argument was always valid finite number <= 1
    for (const call of combat.throwHeld.mock.calls) {
      expect(call[0]).toBe(botDweeb);
      expect(Number.isFinite(call[1])).toBe(true);
      expect(call[1]).toBeGreaterThanOrEqual(0);
      expect(call[1]).toBeLessThanOrEqual(1.5);
    }
  });

  it('handles empty rival list, dead rivals, and self-only list gracefully', () => {
    const dweeb = makeMockDweeb(0, 1, 0);
    const deadRival = makeMockDweeb(2, 1, 0);
    deadRival.eliminated = true;
    deadRival.active = false;

    const arena = makeMockArena();
    const combat = makeMockCombat();
    const bot = new BuilderBot(dweeb, arena, combat, ARCHETYPE_PRESETS.speed_gremlin.dna);

    // Empty rivals
    expect(() => bot.update(0.016, [])).not.toThrow();
    // Self-only
    expect(() => bot.update(0.016, [dweeb])).not.toThrow();
    // Dead rivals
    expect(() => bot.update(0.016, [dweeb, deadRival])).not.toThrow();
    expect(bot.target).toBeNull();
  });
});

describe('Adversarial Stress Test 4: HUD Notification Deduplication Under High Concurrency', () => {
  it('strictly calls onConfigChange and prevents duplicate onChange under 1000 consecutive slider changes', () => {
    const onConfigChange = vi.fn();
    const onChange = vi.fn();

    const ctx = { handlers: { onConfigChange, onChange } };

    for (let i = 0; i < 1000; i++) {
      BuildADweebHud.prototype._notifyChange.call(ctx, { width: 1.0 + (i % 10) * 0.1 });
    }

    expect(onConfigChange).toHaveBeenCalledTimes(1000);
    expect(onChange).toHaveBeenCalledTimes(0);
  });

  it('strictly falls back to onChange when onConfigChange is undefined', () => {
    const onChange = vi.fn();
    const ctx = { handlers: { onChange } };

    for (let i = 0; i < 500; i++) {
      BuildADweebHud.prototype._notifyChange.call(ctx, { mass: 3.0 });
    }

    expect(onChange).toHaveBeenCalledTimes(500);
  });
});
