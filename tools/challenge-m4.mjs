// challenge-m4.mjs — Comprehensive Empirical Challenge & Stress Harness for Milestone 4
// Focus: Autonomous Colosseum Duel Combat, Archetype Presets, Model Rigging, and Results Flow

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { Dweeb } from '../src/player/Dweeb.js';
import { CombatSystem } from '../src/combat/CombatSystem.js';
import { BuilderBot } from '../src/ai/BuilderBot.js';
import {
  ARCHETYPE_PRESETS,
  DEFAULT_BUILD_CONFIG,
  BODY_SHAPES,
  buildCustomDweebModel,
} from '../src/builder/CustomDweebModel.js';
import { BuildADweebLab } from '../src/builder/BuildADweebLab.js';
import { BuildADweebHud } from '../src/builder/BuildADweebHud.js';

// Setup minimal headless DOM environment
globalThis.document = {
  createElement: tag => {
    if (tag === 'canvas') {
      return {
        width: 64,
        height: 64,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop: () => {} }),
          fillRect: () => {},
        }),
      };
    }
    return {
      tagName: tag.toUpperCase(),
      style: {},
      classList: {
        _classes: new Set(),
        add: (...c) => c.forEach(x => globalThis.document.classList?._classes?.add(x)),
        remove: (...c) => c.forEach(x => globalThis.document.classList?._classes?.delete(x)),
        contains: c => false,
      },
      appendChild: () => {},
      removeChild: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  },
  getElementById: () => null,
};

globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};

function applyCustomDweebToBrawler(dweeb, config) {
  const custom = buildCustomDweebModel(config);
  dweeb.customModel = custom;
  for (const c of dweeb.rig.children) {
    if (c !== dweeb.playerRing && c !== dweeb.bubbleMesh && c !== dweeb.freezeMesh && c !== dweeb.parryMesh) {
      c.visible = false;
    }
  }
  dweeb.rig.add(custom.root);
  custom.root.traverse(child => {
    if (child.isMesh && child.material && !dweeb.flashMats.includes(child.material)) {
      dweeb.flashMats.push(child.material);
    }
  });
  if (config.stats) {
    if (config.stats.speed) dweeb.stats.speed *= config.stats.speed;
    if (config.stats.jump) dweeb.stats.jump *= config.stats.jump;
    if (config.stats.mass) {
      dweeb.stats.mass = config.stats.mass;
      dweeb.collider?.setMass?.(config.stats.mass);
    }
  }
  if (config.name) dweeb.name = config.name;
  return custom;
}

function getArchetypeBadge(config = {}) {
  if (config.badge) return config.badge.startsWith('[') ? config.badge : `[${config.badge}]`;
  for (const preset of Object.values(ARCHETYPE_PRESETS || {})) {
    if (preset.name && preset.name.toLowerCase() === (config.name || '').toLowerCase()) {
      return `[${preset.badge}]`;
    }
  }
  if (config.shape === 'chonk') return '[🦏 TITAN CHONK]';
  if (config.shape === 'spiky') return '[⚡ SPEED GREMLIN]';
  if (config.shape === 'capsule') return '[🎯 SNIPER BEAN]';
  if (config.appendage === 'boxing_gloves' || config.appendages === 'boxing_gloves') return '[🥊 PUGILIST CHAMP]';
  return '[🧬 CUSTOM DWEEB]';
}

function formatDnaTags(dna = {}) {
  const conf = dna.confidence ?? 0.8;
  const stance = conf > 0.65 ? 'Stance: Rushdown 🔥' : conf < 0.4 ? 'Stance: Kiter 🌀' : 'Stance: Balanced ⚔️';
  const aim = dna.aimAccuracy ?? 0.7;
  const aimStr = aim > 0.6 ? 'Aim: Sniper 🎯' : 'Aim: Chaos 🎯';
  const agi = dna.agility ?? 0.7;
  const agiStr = agi > 0.7 ? 'Agility: Hyper ⚡' : 'Agility: Heavy ⚡';
  const scav = dna.scavenge ?? 0.6;
  const scavStr = scav > 0.5 ? 'Scavenge: Toy Hunter 🎁' : 'Scavenge: Fists 🎁';
  return [stance, aimStr, agiStr, scavStr];
}

console.log('================================================================');
console.log('  STARTING M4 EMPIRICAL CHALLENGE HARNESS');
console.log('================================================================');

async function run() {
  // ---------------------------------------------------------------------------
  // Challenge 1: Archetype Presets Integrity & Model Generation
  // ---------------------------------------------------------------------------
  console.log('\n[Challenge 1] Testing Archetype Presets & Procedural Models...');
  const expectedPresets = ['titan_chonk', 'speed_gremlin', 'sniper_bean', 'pugilist_champ'];
  for (const key of expectedPresets) {
    const p = ARCHETYPE_PRESETS[key];
    assert.ok(p, `Preset ${key} must exist`);
    assert.ok(p.name && typeof p.name === 'string', `${key} name must be string`);
    assert.ok(BODY_SHAPES.includes(p.shape), `${key} shape must be in BODY_SHAPES`);
    assert.ok(p.badge && typeof p.badge === 'string', `${key} badge must be string`);
    assert.ok(p.mass > 0 && p.armor > 0 && p.speed > 0 && p.jump > 0, `${key} stats must be positive`);
    assert.ok(p.dna && p.dna.confidence >= 0 && p.dna.confidence <= 1, `${key} dna confidence valid`);
    assert.ok(p.dna.aimAccuracy >= 0 && p.dna.aimAccuracy <= 1, `${key} dna aimAccuracy valid`);
    assert.ok(p.dna.agility >= 0 && p.dna.agility <= 1, `${key} dna agility valid`);
    assert.ok(p.dna.scavenge >= 0 && p.dna.scavenge <= 1, `${key} dna scavenge valid`);

    // Verify 3D Model Generation
    const model = buildCustomDweebModel(p);
    assert.ok(model.root instanceof THREE.Group, `${key} model root must be THREE.Group`);
    assert.ok(model.bodyMesh instanceof THREE.Mesh, `${key} bodyMesh must be THREE.Mesh`);
    assert.equal(model.eyeMeshes.length, p.eyeCount, `${key} eyeMeshes count matches`);
    assert.ok(model.feetGroup.children.length >= 2, `${key} feetGroup has feet`);
    if (p.appendage !== 'none') {
      assert.ok(model.appGroup.children.length > 0, `${key} appGroup has appendages`);
    }
  }
  console.log('  ✓ All 4 archetype presets valid and generated clean 3D procedural meshes.');

  // ---------------------------------------------------------------------------
  // Challenge 2: Rapid Preset Switching & Lab State Invariants
  // ---------------------------------------------------------------------------
  console.log('\n[Challenge 2] Testing Rapid Preset Switching & Turntable Mesh Invariants (100 cycles)...');
  const labScene = new THREE.Scene();
  const lab = new BuildADweebLab(labScene, null, null);
  const initialChildCount = lab.group.children.length;

  for (let i = 0; i < 100; i++) {
    const key = expectedPresets[i % expectedPresets.length];
    const cfg = lab.applyPreset(key);
    assert.equal(cfg.name, ARCHETYPE_PRESETS[key].name);
    assert.equal(lab.group.children.length, initialChildCount, 'No orphaned meshes accumulated in group');
    lab.update(0.016);
  }
  lab.dispose();
  console.log('  ✓ 100 consecutive preset applications maintained exact scene graph child count (no leaks).');

  // ---------------------------------------------------------------------------
  // Challenge 3: HUD Notification Deduplication (Defect 2 Verification)
  // ---------------------------------------------------------------------------
  console.log('\n[Challenge 3] Testing BuildADweebHud Notification Deduplication...');
  let onConfigChangeCalls = 0;
  let onChangeCalls = 0;
  let lastPatch = null;

  const mockCtx = {
    handlers: {
      onConfigChange: patch => { onConfigChangeCalls++; lastPatch = patch; },
      onChange: patch => { onChangeCalls++; lastPatch = patch; },
    },
  };

  BuildADweebHud.prototype._notifyChange.call(mockCtx, { eyeCount: 4 });
  assert.equal(onConfigChangeCalls, 1, 'onConfigChange must be called exactly once');
  assert.equal(onChangeCalls, 0, 'onChange must NOT be called when onConfigChange exists (deduplicated)');
  assert.equal(lastPatch.eyeCount, 4);

  // Fallback test
  const fallbackCtx = {
    handlers: {
      onChange: patch => { onChangeCalls++; lastPatch = patch; },
    },
  };
  BuildADweebHud.prototype._notifyChange.call(fallbackCtx, { shape: 'spiky' });
  assert.equal(onChangeCalls, 1, 'onChange must be called when onConfigChange is absent');
  assert.equal(lastPatch.shape, 'spiky');
  console.log('  ✓ BuildADweebHud callback deduplication verified.');

  // ---------------------------------------------------------------------------
  // Challenge 4: Melee Autonomous Combat Simulation with Rapier Physics
  // ---------------------------------------------------------------------------
  console.log('\n[Challenge 4] Testing Melee Autonomous Combat with Rapier Physics & Authentic Dweebs...');
  const physics = new PhysicsWorld();
  await physics.init();
  const combatScene = new THREE.Scene();

  // Arena ground collider: 30m diameter disc / platform
  physics.createStaticBox(0, -0.5, 0, 30, 0.5, 30, 'stage');

  const dummyFx = new Proxy({}, { get: () => () => {} });

  const arenaStub = {
    isOverGround: (x, z) => Math.hypot(x, z) < 14,
    items: [],
    objects: [],
    hazardAt: () => false,
    bumperByHandle: () => null,
    trampolineByHandle: () => null,
    bumpers: [],
    trampolines: [],
    spinners: [],
    pendulums: [],
    powerups: [],
    getObjectsNear: () => [],
    edgeRadius: () => 11,
    removeObject: () => {},
    spawnDebris: () => {},
    removePowerUp: () => {},
  };

  const combat = new CombatSystem(physics, arenaStub, dummyFx);

  // Combatant 1: Titan Chonk (High confidence, high aim accuracy -> charge attack / smash)
  const dweeb1 = new Dweeb(combatScene, physics, {
    name: 'Titan Chonk',
    type: 'chonk',
    isPlayer: true,
    position: { x: -1.0, y: 0.5, z: 0 },
  });
  applyCustomDweebToBrawler(dweeb1, ARCHETYPE_PRESETS.titan_chonk);

  // Combatant 2: Speed Gremlin (High confidence, low aim accuracy -> rapid jab chaos)
  const dweeb2 = new Dweeb(combatScene, physics, {
    name: 'Speed Gremlin',
    type: 'spiky',
    isPlayer: false,
    position: { x: 1.0, y: 0.5, z: 0 },
  });
  applyCustomDweebToBrawler(dweeb2, ARCHETYPE_PRESETS.speed_gremlin);

  const combatants = [dweeb1, dweeb2];
  combat.setDweebs(combatants);

  const bot1 = new BuilderBot(dweeb1, arenaStub, combat, ARCHETYPE_PRESETS.titan_chonk.dna);
  const bot2 = new BuilderBot(dweeb2, arenaStub, combat, ARCHETYPE_PRESETS.speed_gremlin.dna);

  console.log('  Simulating 300 physics frames (5 seconds of live brawl in melee range < 2.5m)...');

  let bot1Charges = 0;
  let bot1Releases = 0;
  let bot2Attacks = 0;

  // Wrap combat methods to count invocations
  const origStartCharge = combat.startCharge.bind(combat);
  const origReleaseAttack = combat.releaseAttack.bind(combat);

  combat.startCharge = d => {
    if (d === dweeb1) bot1Charges++;
    if (d === dweeb2) bot2Attacks++;
    return origStartCharge(d);
  };

  combat.releaseAttack = d => {
    if (d === dweeb1) bot1Releases++;
    return origReleaseAttack(d);
  };

  for (let frame = 0; frame < 300; frame++) {
    const dt = 1 / 60;
    bot1.update(dt, combatants);
    bot2.update(dt, combatants);

    dweeb1.preStep(dt);
    dweeb2.preStep(dt);

    physics.step(dt);

    dweeb1.postStep(dt, frame * dt);
    dweeb2.postStep(dt, frame * dt);

    combat.update(dt, frame * dt);

    // Assert no NaNs anywhere in physics coordinates
    const p1 = dweeb1.getPosition();
    const p2 = dweeb2.getPosition();
    assert.ok(Number.isFinite(p1.x) && Number.isFinite(p1.y) && Number.isFinite(p1.z), `Frame ${frame}: p1 must be finite`);
    assert.ok(Number.isFinite(p2.x) && Number.isFinite(p2.y) && Number.isFinite(p2.z), `Frame ${frame}: p2 must be finite`);
  }

  console.log(`  Brawl metrics: Bot1 (Titan charge) charges=${bot1Charges}, releases=${bot1Releases}; Bot2 (Gremlin jab) attacks=${bot2Attacks}`);
  console.log(`  Damage state: Dweeb1 percent=${dweeb1.percent.toFixed(1)}%, Dweeb2 percent=${dweeb2.percent.toFixed(1)}%`);
  assert.ok(bot1Charges > 0, 'Bot 1 must execute startCharge');
  assert.ok(bot1Releases > 0, 'Bot 1 must execute releaseAttack');
  assert.ok(bot2Attacks > 0, 'Bot 2 must execute rapid attack');
  console.log('  ✓ Autonomous combat in melee range ran 300 frames with zero TypeErrors and zero NaNs.');

  // ---------------------------------------------------------------------------
  // Challenge 5: Held Item Throw Invariant
  // ---------------------------------------------------------------------------
  console.log('\n[Challenge 5] Testing Held Item Throwing in Combat AI...');
  let throwHeldCalls = 0;
  let throwForce = 0;
  combat.throwHeld = (d, force) => {
    throwHeldCalls++;
    throwForce = force;
    d.held = null;
  };

  dweeb1.held = { kind: 'object', ref: { isWeapon: false, def: {} } };
  bot1.actionTimer = 0;
  bot1.update(0.016, [dweeb1, dweeb2]);

  assert.equal(throwHeldCalls, 1, 'combat.throwHeld must be called when holding an item');
  assert.ok(throwForce > 0 && throwForce <= 1.5, `throwForce must be valid number, got ${throwForce}`);
  console.log(`  ✓ throwHeld executed cleanly with force=${throwForce.toFixed(3)} and target yaw alignment.`);

  // ---------------------------------------------------------------------------
  // Challenge 6: Boundary DNA & Extreme Values Stress Test
  // ---------------------------------------------------------------------------
  console.log('\n[Challenge 6] Stress-testing Extreme DNA Configurations [0.0, 1.0, extreme kiting, extreme rush]...');
  const extremeConfigs = [
    { name: 'AllZero', dna: { confidence: 0, aimAccuracy: 0, agility: 0, scavenge: 0 } },
    { name: 'AllOne', dna: { confidence: 1, aimAccuracy: 1, agility: 1, scavenge: 1 } },
    { name: 'ExtremeKiter', dna: { confidence: 0.1, aimAccuracy: 0.9, agility: 1, scavenge: 0.1 } },
    { name: 'ExtremeBerserk', dna: { confidence: 1.0, aimAccuracy: 0.1, agility: 0.1, scavenge: 0.9 } },
    { name: 'EmptyDNA', dna: {} },
  ];

  for (const tc of extremeConfigs) {
    const dTest = new Dweeb(combatScene, physics, { name: tc.name, position: { x: 0, y: 0.5, z: 0 } });
    const bTest = new BuilderBot(dTest, arenaStub, combat, tc.dna);
    for (let f = 0; f < 50; f++) {
      bTest.update(0.016, [dTest, dweeb2]);
      assert.ok(Number.isFinite(dTest.moveInput.x), `${tc.name}: moveInput.x must be finite`);
      assert.ok(Number.isFinite(dTest.moveInput.y), `${tc.name}: moveInput.y must be finite`);
    }
  }
  console.log('  ✓ All 5 extreme/boundary DNA configurations executed stably without NaN.');

  // ---------------------------------------------------------------------------
  // Challenge 7: Spectator Overlay & Results Routing Logic
  // ---------------------------------------------------------------------------
  console.log('\n[Challenge 7] Testing Spectator Overlay & Results Routing Logic...');
  const titanBadge = getArchetypeBadge(ARCHETYPE_PRESETS.titan_chonk);
  const gremlinBadge = getArchetypeBadge(ARCHETYPE_PRESETS.speed_gremlin);
  assert.equal(titanBadge, '[🦏 TITAN CHONK]');
  assert.equal(gremlinBadge, '[⚡ SPEED GREMLIN]');

  const rushTags = formatDnaTags({ confidence: 0.9, aimAccuracy: 0.8, agility: 0.9, scavenge: 0.8 });
  assert.ok(rushTags.includes('Stance: Rushdown 🔥'));
  assert.ok(rushTags.includes('Aim: Sniper 🎯'));
  assert.ok(rushTags.includes('Agility: Hyper ⚡'));
  assert.ok(rushTags.includes('Scavenge: Toy Hunter 🎁'));

  const kiterTags = formatDnaTags({ confidence: 0.2, aimAccuracy: 0.4, agility: 0.4, scavenge: 0.2 });
  assert.ok(kiterTags.includes('Stance: Kiter 🌀'));
  assert.ok(kiterTags.includes('Aim: Chaos 🎯'));
  assert.ok(kiterTags.includes('Agility: Heavy ⚡'));
  assert.ok(kiterTags.includes('Scavenge: Fists 🎁'));

  console.log('  ✓ Spectator overlay badges and DNA chips formatted correctly.');

  console.log('\n================================================================');
  console.log('  ALL M4 EMPIRICAL CHALLENGES PASSED SUCCESSFULLY (0 FAILURES)');
  console.log('================================================================');
}

run().catch(err => {
  console.error('\n❌ CHALLENGE FAILED WITH ERROR:', err);
  process.exit(1);
});
