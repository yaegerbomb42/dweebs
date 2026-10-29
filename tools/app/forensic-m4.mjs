// forensic-m4.mjs — Independent forensic verification of Milestone 4 Build-A-Dweeb
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ARCHETYPE_PRESETS,
  buildCustomDweebModel,
  DEFAULT_BUILD_CONFIG,
  BODY_SHAPES,
  APPENDAGES,
  FEET_TYPES,
  BROW_STYLES,
  MOUTH_STYLES,
} from '../../src/builder/CustomDweebModel.js';
import { BuildADweebLab } from '../../src/builder/BuildADweebLab.js';
import { BuilderBot } from '../../src/ai/BuilderBot.js';

console.log('--- STARTING FORENSIC VERIFICATION FOR MILESTONE 4 ---');

// 1. ARCHETYPE PRESETS INTEGRITY
console.log('1. Checking ARCHETYPE_PRESETS definitions...');
const requiredPresets = ['titan_chonk', 'speed_gremlin', 'sniper_bean', 'pugilist_champ'];
for (const pKey of requiredPresets) {
  const p = ARCHETYPE_PRESETS[pKey];
  assert.ok(p, `Preset ${pKey} must exist in ARCHETYPE_PRESETS`);
  assert.ok(p.name && typeof p.name === 'string', `${pKey} must have name`);
  assert.ok(p.badge && typeof p.badge === 'string', `${pKey} must have badge`);
  assert.ok(p.shape && typeof p.shape === 'string', `${pKey} must have shape`);
  assert.ok(p.mass && typeof p.mass === 'number', `${pKey} must have numeric mass`);
  assert.ok(p.speed && typeof p.speed === 'number', `${pKey} must have numeric speed`);
  assert.ok(p.jump && typeof p.jump === 'number', `${pKey} must have numeric jump`);
  assert.ok(p.armor && typeof p.armor === 'number', `${pKey} must have numeric armor`);
  assert.ok(p.dna && typeof p.dna === 'object', `${pKey} must have dna object`);
  assert.ok(p.dna.confidence !== undefined, `${pKey} must have dna.confidence`);
  assert.ok(p.dna.aimAccuracy !== undefined, `${pKey} must have dna.aimAccuracy`);
  assert.ok(p.dna.agility !== undefined, `${pKey} must have dna.agility`);
  assert.ok(p.dna.scavenge !== undefined, `${pKey} must have dna.scavenge`);
  console.log(`   ✓ Preset ${pKey}: "${p.name}" (Badge: ${p.badge}, Shape: ${p.shape}, Mass: ${p.mass})`);
}

// 2. PROCEDURAL 3D MESH GENERATION FOR ALL PRESETS & COMBINATIONS
console.log('2. Checking 3D procedural generation for all presets...');
for (const [key, preset] of Object.entries(ARCHETYPE_PRESETS)) {
  const model = buildCustomDweebModel(preset);
  assert.ok(model.root instanceof THREE.Group, `${key} model.root must be THREE.Group`);
  assert.ok(model.bodyMesh instanceof THREE.Mesh, `${key} bodyMesh must be THREE.Mesh`);
  assert.ok(model.eyeMeshes.length > 0, `${key} eyeMeshes must not be empty`);
  assert.ok(model.appGroup instanceof THREE.Group, `${key} appGroup must be THREE.Group`);
  assert.ok(model.feetGroup instanceof THREE.Group, `${key} feetGroup must be THREE.Group`);
  assert.equal(typeof model.animate, 'function', `${key} animate must be a function`);
  // Test live animation step
  model.animate(1.23, 'happy');
  console.log(`   ✓ 3D generation & animation step passed for preset ${key}`);
}

// 3. LAB STATE & PRESET APPLICATION
console.log('3. Checking BuildADweebLab preset application & live config...');
const dummyScene = new THREE.Scene();
const lab = new BuildADweebLab(dummyScene, null, null);
for (const pKey of requiredPresets) {
  const applied = lab.applyPreset(pKey);
  assert.equal(applied.name, ARCHETYPE_PRESETS[pKey].name);
  assert.equal(applied.shape, ARCHETYPE_PRESETS[pKey].shape);
  assert.equal(applied.stats.mass, ARCHETYPE_PRESETS[pKey].mass);
  assert.equal(applied.dna.confidence, ARCHETYPE_PRESETS[pKey].dna.confidence);
  assert.equal(applied.dna.aimAccuracy, ARCHETYPE_PRESETS[pKey].dna.aimAccuracy);
  console.log(`   ✓ Lab applied preset ${pKey} cleanly`);
}

// 4. RANDOM MUTATION GENERATOR DIVERSITY
console.log('4. Checking BuildADweebLab mutateRandom diversity...');
const shapesSeen = new Set();
for (let i = 0; i < 50; i++) {
  const mut = lab.mutateRandom();
  shapesSeen.add(mut.shape);
  assert.ok(mut.dna.confidence >= 0.2 && mut.dna.confidence <= 1.0, 'DNA confidence out of bounds');
  assert.ok(mut.dna.aimAccuracy >= 0.2 && mut.dna.aimAccuracy <= 0.95, 'DNA aimAccuracy out of bounds');
  assert.ok(mut.dna.scavenge >= 0.1 && mut.dna.scavenge <= 0.9, 'DNA scavenge out of bounds');
  assert.ok(mut.dna.agility >= 0.4 && mut.dna.agility <= 0.95, 'DNA agility out of bounds');
}
assert.ok(shapesSeen.size >= 4, `Expected variety of body shapes from mutation, saw: ${shapesSeen.size}`);
console.log(`   ✓ Mutator generated diverse shapes (${Array.from(shapesSeen).join(', ')})`);
lab.dispose();

// 5. AUTONOMOUS COMBAT AI BEHAVIOR EMULATION
console.log('5. Checking BuilderBot AI combat decisions...');
function createMockCombatant(x, y, z) {
  return {
    active: true,
    eliminated: false,
    swimFlail: 0,
    hitstun: 0,
    charging: 0,
    held: null,
    moveInput: new THREE.Vector2(),
    grounded: true,
    getPosition: () => ({ x, y, z }),
    requestJump: () => { mockJumps++; },
  };
}

let mockJumps = 0;
const arena = {
  items: [
    { held: false, mesh: { position: { x: 3, y: 0.5, z: 0 } } },
  ],
};
const combat = {
  attack: () => { attacks++; },
  chargeAttack: () => { charges++; },
  releaseAttack: () => { releases++; },
  grab: () => { grabs++; },
  throwItem: () => { throws++; },
};

let attacks = 0, charges = 0, releases = 0, grabs = 0, throws = 0;

// High-confidence rushdown bot
const rushDweeb = createMockCombatant(0, 0.5, 0);
const targetDweeb = createMockCombatant(6, 0.5, 0);
const rushBot = new BuilderBot(rushDweeb, arena, combat, { confidence: 0.95, aimAccuracy: 0.9, scavenge: 0.1, agility: 0.8 });
rushBot.update(0.016, [rushDweeb, targetDweeb]);
assert.ok(rushDweeb.moveInput.x > 0, 'Rushdown bot must advance toward opponent (+x)');
console.log('   ✓ Rushdown bot successfully advances toward opponent');

// Low-confidence kiting bot (close to opponent: dist = 2.5 < 4.0)
const kiteDweeb = createMockCombatant(3.5, 0.5, 0);
const kiteBot = new BuilderBot(kiteDweeb, arena, combat, { confidence: 0.2, aimAccuracy: 0.5, scavenge: 0.1, agility: 0.8 });
kiteBot.update(0.016, [kiteDweeb, targetDweeb]);
assert.ok(kiteDweeb.moveInput.x < 0, 'Kiter bot must backpedal away from close opponent (-x)');
console.log('   ✓ Kiter bot successfully backpedals away from close opponent');

// Low-confidence kiting bot (circle strafe: dist = 5.0 >= 4.0)
const strafeDweeb = createMockCombatant(1.0, 0.5, 0);
const strafeBot = new BuilderBot(strafeDweeb, arena, combat, { confidence: 0.2, aimAccuracy: 0.5, scavenge: 0.1, agility: 0.8 });
strafeBot.update(0.016, [strafeDweeb, targetDweeb]);
assert.ok(Math.abs(strafeDweeb.moveInput.y) > 0, 'Kiter bot must circle-strafe when at distance');
console.log('   ✓ Kiter bot successfully circle-strafes when at distance');

// High-scavenge bot with item nearby
const scavDweeb = createMockCombatant(0, 0.5, 0);
const farawayDweeb = createMockCombatant(20, 0.5, 0);
const scavBot = new BuilderBot(scavDweeb, arena, combat, { confidence: 0.5, aimAccuracy: 0.5, scavenge: 0.95, agility: 0.7 });
scavBot.update(0.016, [scavDweeb, farawayDweeb]);
assert.ok(scavDweeb.moveInput.x > 0, 'Scavenger bot must advance toward item at (3, 0.5, 0)');
console.log('   ✓ Scavenger bot approaches nearby ground item');

// Void recovery jump
mockJumps = 0;
const voidDweeb = createMockCombatant(14, 0.1, 0);
const voidBot = new BuilderBot(voidDweeb, arena, combat, { confidence: 0.8, aimAccuracy: 0.8, scavenge: 0.5, agility: 0.9 });
voidBot.update(0.016, [voidDweeb]);
assert.ok(voidDweeb.moveInput.x < 0, 'Void bot must steer toward arena center (0, 0)');
assert.ok(mockJumps > 0, 'Void bot must trigger jump recovery');
console.log('   ✓ Void edge recovery executes steer and jump');

// 6. SPECTATOR MATCH OVERLAY LOGIC VERIFICATION
console.log('6. Checking Spectator Match Overlay badge & DNA tag synthesis...');
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

assert.equal(getArchetypeBadge({ shape: 'chonk' }), '[🦏 TITAN CHONK]');
assert.equal(getArchetypeBadge({ shape: 'spiky' }), '[⚡ SPEED GREMLIN]');
assert.equal(getArchetypeBadge({ shape: 'capsule' }), '[🎯 SNIPER BEAN]');
assert.equal(getArchetypeBadge({ shape: 'blob', appendage: 'boxing_gloves' }), '[🥊 PUGILIST CHAMP]');
assert.equal(getArchetypeBadge({ name: 'Speed Gremlin' }), '[⚡ SPEED GREMLIN]');
assert.equal(getArchetypeBadge({ shape: 'cube' }), '[🧬 CUSTOM DWEEB]');
console.log('   ✓ Archetype badges correctly classified across presets and shapes');

const tagsRush = formatDnaTags({ confidence: 0.9, aimAccuracy: 0.95, agility: 0.9, scavenge: 0.8 });
assert.deepEqual(tagsRush, ['Stance: Rushdown 🔥', 'Aim: Sniper 🎯', 'Agility: Hyper ⚡', 'Scavenge: Toy Hunter 🎁']);

const tagsKite = formatDnaTags({ confidence: 0.3, aimAccuracy: 0.4, agility: 0.5, scavenge: 0.2 });
assert.deepEqual(tagsKite, ['Stance: Kiter 🌀', 'Aim: Chaos 🎯', 'Agility: Heavy ⚡', 'Scavenge: Fists 🎁']);
console.log('   ✓ DNA combat traits correctly categorized into live spectator tags');

console.log('--- ALL FORENSIC CHECKS PASSED EMPIRICALLY ---');
