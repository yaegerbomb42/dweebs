// builder.test.js — Unit test suite for Build-A-Dweeb procedural generation, lab and bot AI
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  buildCustomDweebModel,
  DEFAULT_BUILD_CONFIG,
  BODY_SHAPES,
  APPENDAGES,
  FEET_TYPES,
  ARCHETYPE_PRESETS,
} from '../src/builder/CustomDweebModel.js';
import { BuildADweebLab } from '../src/builder/BuildADweebLab.js';
import { BuildADweebHud } from '../src/builder/BuildADweebHud.js';
import { BuilderBot } from '../src/ai/BuilderBot.js';

describe('Build-A-Dweeb Procedural Mesh Generator', () => {
  it('generates a valid Three.js mesh tree from default config', () => {
    const model = buildCustomDweebModel(DEFAULT_BUILD_CONFIG);
    expect(model.root).toBeInstanceOf(THREE.Group);
    expect(model.bodyMesh).toBeInstanceOf(THREE.Mesh);
    expect(model.eyeMeshes.length).toBe(2);
    expect(model.appGroup).toBeInstanceOf(THREE.Group);
    expect(model.feetGroup).toBeInstanceOf(THREE.Group);
    expect(typeof model.animate).toBe('function');
  });

  it('builds every body shape geometry without errors', () => {
    for (const shape of BODY_SHAPES) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, shape });
      expect(model.bodyMesh.geometry).toBeDefined();
    }
  });

  it('supports eye counts from 1 to 4 and scales dimensions', () => {
    for (let count = 1; count <= 4; count++) {
      const model = buildCustomDweebModel({
        ...DEFAULT_BUILD_CONFIG,
        eyeCount: count,
        eyeSize: 1.2,
        eyeSpacing: 1.1,
      });
      expect(model.eyeMeshes.length).toBe(count);
    }
  });

  it('attaches all appendage variations to the head/body', () => {
    for (const appendage of APPENDAGES) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, appendage });
      if (appendage === 'none') {
        expect(model.appGroup.children.length).toBe(0);
      } else {
        expect(model.appGroup.children.length).toBeGreaterThan(0);
      }
    }
  });

  it('attaches all feet styles', () => {
    for (const feet of FEET_TYPES) {
      const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, feet });
      expect(model.feetGroup.children.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('animates breathing, pupils and appendage jiggle smoothly', () => {
    const model = buildCustomDweebModel(DEFAULT_BUILD_CONFIG);
    expect(() => {
      model.animate(0.5);
      model.animate(1.0);
    }).not.toThrow();
  });
});

describe('BuildADweebLab Workshop State & Mutation', () => {
  it('initializes with default config and provides mutateRandom', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null);

    expect(lab.config).toBeDefined();
    expect(lab.config.shape).toBeDefined();

    const mutant = lab.mutateRandom();
    expect(BODY_SHAPES).toContain(mutant.shape);
    expect(mutant.dna.confidence).toBeGreaterThanOrEqual(0.2);
    expect(mutant.dna.confidence).toBeLessThanOrEqual(1.0);
    expect(mutant.dna.aimAccuracy).toBeGreaterThanOrEqual(0.2);
    expect(mutant.dna.aimAccuracy).toBeLessThanOrEqual(1.0);

    lab.dispose();
  });

  it('patches config incrementally and rebuilds model', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null);

    lab.updateConfig({ shape: 'chonk', eyeCount: 1 });
    expect(lab.config.shape).toBe('chonk');
    expect(lab.config.eyeCount).toBe(1);

    lab.dispose();
  });
});

describe('BuilderBot Autonomous AI', () => {
  function makeMockDweeb(x = 0, y = 1, z = 0) {
    return {
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
      startCharge: vi.fn(() => true),
      releaseAttack: vi.fn(),
      releaseCharge: vi.fn(),
      grab: vi.fn(),
      throwHeld: vi.fn(),
      drop: vi.fn(),
      dodgeOrDive: vi.fn(),
      startParry: vi.fn(),
    };
  }

  it('initializes DNA modifiers on Dweeb', () => {
    const dweeb = makeMockDweeb();
    const arena = makeMockArena();
    const combat = makeMockCombat();

    const bot = new BuilderBot(dweeb, arena, combat, {
      confidence: 0.9,
      aimAccuracy: 0.85,
      scavenge: 0.4,
      agility: 0.9,
    });

    expect(dweeb.aimError).toBeCloseTo((1 - 0.85) * 0.45);
    expect(dweeb.techChance).toBeCloseTo(0.3 + 0.9 * 0.6);
    expect(bot.dna.confidence).toBe(0.9);
  });

  it('steers toward rivals and executes combat decisions autonomously', () => {
    const botDweeb = makeMockDweeb(0, 1, 0);
    const rivalDweeb = makeMockDweeb(5, 1, 0);
    const arena = makeMockArena();
    const combat = makeMockCombat();

    const bot = new BuilderBot(botDweeb, arena, combat, {
      confidence: 1.0,
      aimAccuracy: 0.9,
      scavenge: 0.1,
      agility: 0.8,
    });

    bot.update(0.016, [botDweeb, rivalDweeb]);
    // With confidence 1.0, bot should steer towards rival (positive X)
    expect(botDweeb.moveInput.x).toBeGreaterThan(0);
  });

  it('triggers edge recovery jump when near void', () => {
    const botDweeb = makeMockDweeb(14, 0.5, 0); // Near or off stage edge
    botDweeb.grounded = false;
    const arena = makeMockArena();
    const combat = makeMockCombat();

    const bot = new BuilderBot(botDweeb, arena, combat, {
      confidence: 0.8,
      aimAccuracy: 0.7,
      scavenge: 0.5,
      agility: 1.0,
    });

    bot.update(0.05, [botDweeb]);
    expect(botDweeb.requestJump).toHaveBeenCalled();
  });

  it('executes charged attack at melee range with high aim accuracy (startCharge -> releaseAttack)', () => {
    const botDweeb = makeMockDweeb(0, 1, 0);
    const rivalDweeb = makeMockDweeb(1.5, 1, 0); // dist = 1.5 < 2.8m
    const arena = makeMockArena();
    const combat = makeMockCombat();

    const bot = new BuilderBot(botDweeb, arena, combat, {
      confidence: 0.9,
      aimAccuracy: 0.85, // > 0.6 triggers charged smash
      scavenge: 0.1,
      agility: 0.5,
    });

    // Advance time until actionTimer ticks down and startCharge is triggered
    let charged = false;
    for (let i = 0; i < 40; i++) {
      bot.update(0.02, [botDweeb, rivalDweeb]);
      if (combat.startCharge.mock.calls.length > 0) {
        charged = true;
        botDweeb.charging = 0.5; // Simulate charging state
        break;
      }
    }
    expect(charged).toBe(true);
    expect(combat.startCharge).toHaveBeenCalledWith(botDweeb);

    // Advance time until chargeHold ticks down and releaseAttack is triggered
    for (let i = 0; i < 60; i++) {
      bot.update(0.02, [botDweeb, rivalDweeb]);
      if (combat.releaseAttack.mock.calls.length > 0) break;
    }
    expect(combat.releaseAttack).toHaveBeenCalledWith(botDweeb);
  });

  it('executes rapid jab attack at melee range with low aim accuracy (startCharge + releaseAttack)', () => {
    const botDweeb = makeMockDweeb(0, 1, 0);
    const rivalDweeb = makeMockDweeb(1.5, 1, 0); // dist = 1.5 < 2.8m
    const arena = makeMockArena();
    const combat = makeMockCombat();

    const bot = new BuilderBot(botDweeb, arena, combat, {
      confidence: 0.9,
      aimAccuracy: 0.3, // <= 0.6 triggers rapid jabs
      scavenge: 0.1,
      agility: 0.5,
    });

    // Advance time until actionTimer <= 0
    for (let i = 0; i < 40; i++) {
      bot.update(0.02, [botDweeb, rivalDweeb]);
      if (combat.releaseAttack.mock.calls.length > 0) break;
    }

    expect(combat.startCharge).toHaveBeenCalledWith(botDweeb);
    expect(combat.releaseAttack).toHaveBeenCalledWith(botDweeb);
  });

  it('throws held item at target using throwHeld', () => {
    const botDweeb = makeMockDweeb(0, 1, 0);
    const rivalDweeb = makeMockDweeb(3.0, 1, 0);
    botDweeb.held = { kind: 'object', ref: {} };
    const arena = makeMockArena();
    const combat = makeMockCombat();

    const bot = new BuilderBot(botDweeb, arena, combat, {
      confidence: 0.8,
      aimAccuracy: 0.8,
      scavenge: 0.5,
      agility: 0.6,
    });

    // Advance time until throw executes
    for (let i = 0; i < 40; i++) {
      bot.update(0.02, [botDweeb, rivalDweeb]);
      if (combat.throwHeld.mock.calls.length > 0) break;
    }

    expect(combat.throwHeld).toHaveBeenCalled();
    expect(combat.throwHeld.mock.calls[0][0]).toBe(botDweeb);
    expect(typeof combat.throwHeld.mock.calls[0][1]).toBe('number');
  });
});

describe('ARCHETYPE_PRESETS Integrity & Balance', () => {
  const EXPECTED_PRESETS = ['titan_chonk', 'speed_gremlin', 'sniper_bean', 'pugilist_champ'];

  it('defines all 4 canonical archetype presets', () => {
    for (const key of EXPECTED_PRESETS) {
      expect(ARCHETYPE_PRESETS[key]).toBeDefined();
    }
  });

  it.each(EXPECTED_PRESETS)('preset %s has valid shape, badges, and positive numerical stats', (key) => {
    const preset = ARCHETYPE_PRESETS[key];
    expect(typeof preset.name).toBe('string');
    expect(preset.name.length).toBeGreaterThan(0);
    expect(BODY_SHAPES).toContain(preset.shape);
    expect(typeof preset.badge).toBe('string');
    expect(preset.badge.length).toBeGreaterThan(2);

    // Stats
    const mass = preset.mass ?? preset.stats?.mass;
    const armor = preset.armor ?? preset.stats?.armor;
    const speed = preset.speed ?? preset.stats?.speed;
    const jump = preset.jump ?? preset.stats?.jump;

    expect(typeof mass).toBe('number');
    expect(mass).toBeGreaterThan(0);
    expect(typeof armor).toBe('number');
    expect(armor).toBeGreaterThan(0);
    expect(typeof speed).toBe('number');
    expect(speed).toBeGreaterThan(0);
    expect(typeof jump).toBe('number');
    expect(jump).toBeGreaterThan(0);

    // DNA
    const dna = preset.dna || preset.DNA;
    expect(dna).toBeDefined();
    expect(dna.confidence).toBeGreaterThanOrEqual(0);
    expect(dna.confidence).toBeLessThanOrEqual(1);
    expect(dna.aimAccuracy).toBeGreaterThanOrEqual(0);
    expect(dna.aimAccuracy).toBeLessThanOrEqual(1);
    expect(dna.scavenge).toBeGreaterThanOrEqual(0);
    expect(dna.scavenge).toBeLessThanOrEqual(1);
    expect(dna.agility).toBeGreaterThanOrEqual(0);
    expect(dna.agility).toBeLessThanOrEqual(1);

    // Colors
    expect(preset.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(preset.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe('BuildADweebLab.applyPreset Integration', () => {
  it('applies archetype preset stats, shapes, and DNA traits accurately', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null);

    // Titan Chonk
    const titanConfig = lab.applyPreset('titan_chonk');
    expect(titanConfig).not.toBeNull();
    expect(titanConfig.shape).toBe('chonk');
    expect(titanConfig.name).toBe('Titan Chonk');
    expect(titanConfig.badge).toBe('🦏 TITAN CHONK');
    expect(titanConfig.stats.mass).toBe(4.5);
    expect(titanConfig.stats.armor).toBe(1.4);
    expect(titanConfig.dna.confidence).toBe(0.95);
    expect(titanConfig.appendage).toBe('horns');

    // Speed Gremlin
    const gremlinConfig = lab.applyPreset('speed_gremlin');
    expect(gremlinConfig.shape).toBe('spiky');
    expect(gremlinConfig.name).toBe('Speed Gremlin');
    expect(gremlinConfig.badge).toBe('⚡ SPEED GREMLIN');
    expect(gremlinConfig.stats.speed).toBe(1.35);
    expect(gremlinConfig.dna.agility).toBe(0.95);

    // Sniper Bean
    const sniperConfig = lab.applyPreset('sniper_bean');
    expect(sniperConfig.shape).toBe('capsule');
    expect(sniperConfig.name).toBe('Sniper Bean');
    expect(sniperConfig.badge).toBe('🎯 SNIPER BEAN');
    expect(sniperConfig.dna.aimAccuracy).toBe(0.95);

    // Pugilist Champ
    const champConfig = lab.applyPreset('pugilist_champ');
    expect(champConfig.shape).toBe('blob');
    expect(champConfig.name).toBe('Pugilist Champ');
    expect(champConfig.badge).toBe('🥊 PUGILIST CHAMP');
    expect(champConfig.appendage).toBe('boxing_gloves');

    // Invalid preset returns null and does not corrupt config
    const invalid = lab.applyPreset('non_existent');
    expect(invalid).toBeNull();
    expect(lab.config.name).toBe('Pugilist Champ');

    lab.dispose();
  });
});

describe('BuildADweebHud Notification Deduplication', () => {
  it('invokes onConfigChange and suppresses duplicate onChange call when both are provided', () => {
    const onConfigChange = vi.fn();
    const onChange = vi.fn();
    const ctx = { handlers: { onConfigChange, onChange } };

    BuildADweebHud.prototype._notifyChange.call(ctx, { eyeCount: 3 });

    expect(onConfigChange).toHaveBeenCalledWith({ eyeCount: 3 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to onChange if onConfigChange is not provided', () => {
    const onChange = vi.fn();
    const ctx = { handlers: { onChange } };

    BuildADweebHud.prototype._notifyChange.call(ctx, { shape: 'spiky' });

    expect(onChange).toHaveBeenCalledWith({ shape: 'spiky' });
  });
});

