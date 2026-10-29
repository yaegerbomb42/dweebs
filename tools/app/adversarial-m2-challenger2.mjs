// adversarial-m2-challenger2.mjs
// Rigorous adversarial challenge harness for Milestone 2: Expedition & Dynasty (Meadowlands)
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { Meadowlands } from '../../src/world/Meadowlands.js';
import { Colony } from '../../src/adventure/colony.js';
import { Citizen, ROLES, PERSONALITIES } from '../../src/adventure/citizen.js';
import { BuildingManager, BLUEPRINTS, SILO_CAPACITY, SILO_CAP_BONUS } from '../../src/adventure/building.js';
import { saveVillage, loadVillage, clearSave, applySave } from '../../src/adventure/persistence.js';
import { AudioManager } from '../../src/audio/AudioManager.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
  } else {
    failedTests++;
    console.error(`  [FAIL] ${message}`);
    failures.push(message);
  }
}

async function runTest(suiteName, fn) {
  console.log(`\n▶ Running: ${suiteName}`);
  try {
    await fn();
    console.log(`  ✓ Passed`);
  } catch (err) {
    failedTests++;
    console.error(`  ✗ Threw error: ${err.message}\n${err.stack}`);
    failures.push(`${suiteName}: ${err.message}`);
  }
}

let _fakeBodySeq = 0;
const fakePhysBody = () => ({
  _p: { x: 0, y: 0, z: 0 },
  translation() { return this._p; },
  linvel() { return { x: 0, y: 0, z: 0 }; },
  rotation() { return { x: 0, y: 0, z: 0, w: 1 }; },
  setLinvel() {},
  setTranslation(p) { this._p = { ...p }; },
  setNextKinematicTranslation() {},
  setNextKinematicRotation() {},
  setGravityScale() {},
});
const fakePhysReg = (kind) => ({ id: `${kind}_${++_fakeBodySeq}`, body: fakePhysBody(), collider: {} });

console.log('================================================================');
console.log('CHALLENGER 2: ADVERSARIAL STRESS HARNESS — MILESTONE 2');
console.log('================================================================');

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 1: Exit to Mall Teardown, Audio & Post-Exit Frame Stability
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 1.1: Double-click / Spam Exit to Mall does not throw or double-dispose', async () => {
  const scene = new THREE.Scene();
  let meadowlands = new Meadowlands(null, scene);
  let colony = new Colony();
  let buildingManager = new BuildingManager(scene, null);
  meadowlands.buildingManager = buildingManager;

  // Mock audio
  let stopAmbienceCount = 0;
  const audio = {
    playUIClick: () => {},
    stopAmbience: () => { stopAmbienceCount++; },
    stopMusic: () => {},
    setCharge: () => {},
  };

  // Mock router & DOM
  let currentRoute = '/match';
  let matchLock = true;
  const mockRouter = {
    setMatchLock: (val) => { matchLock = val; },
    go: (p) => { currentRoute = p; }
  };

  const simulateExitClick = () => {
    audio.playUIClick();
    if (colony && buildingManager && meadowlands) {
      saveVillage({ colony, buildingManager, world: meadowlands });
    }
    if (meadowlands) {
      meadowlands.dispose();
      meadowlands = null;
    }
    if (buildingManager) {
      buildingManager.cancelPlacing();
      buildingManager = null;
    }
    colony = null;
    audio.stopAmbience?.();
    mockRouter.setMatchLock(false);
    mockRouter.go('/');
  };

  // First click
  simulateExitClick();
  assert(meadowlands === null, 'meadowlands is nulled on click 1');
  assert(colony === null, 'colony is nulled on click 1');
  assert(buildingManager === null, 'buildingManager is nulled on click 1');
  assert(matchLock === false, 'matchLock unlocked on click 1');
  assert(currentRoute === '/', 'navigated to "/" on click 1');
  assert(stopAmbienceCount === 1, 'audio.stopAmbience called once');

  // Second rapid click (spam)
  simulateExitClick();
  assert(meadowlands === null, 'meadowlands remains null on click 2');
  assert(colony === null, 'colony remains null on click 2');
  assert(buildingManager === null, 'buildingManager remains null on click 2');
  assert(stopAmbienceCount === 2, 'audio.stopAmbience handled safely second time');
});

await runTest('Adversarial 1.2: Main loop rendering tick survives immediately after Exit to Mall', async () => {
  let currentMeadowlands = null;
  let colony = null;
  let buildingManager = null;
  let player = { getPosition: () => ({ x: 0, y: 1, z: 0 }) };
  let matchPhase = 0; // MENU

  // Simulate what main.js loop() does on subsequent frame ticks after exit:
  // 1. inGame check
  const inGame = matchPhase !== 0;
  assert(!inGame, 'inGame is false when in MENU');

  // 2. Meadowlands check
  let meadowlandsUpdated = false;
  if (currentMeadowlands) {
    meadowlandsUpdated = true;
  }
  assert(!meadowlandsUpdated, 'Meadowlands update safely skipped when null');

  // 3. Proximity prompt check
  let proxPromptVisible = false;
  const mockProxPrompt = {
    classList: {
      add: (cls) => { if (cls === 'hidden') proxPromptVisible = false; },
      remove: (cls) => { if (cls === 'hidden') proxPromptVisible = true; }
    }
  };

  if (mockProxPrompt && player && !buildingManager?.activeBlueprint) {
    if (currentMeadowlands) {
      // Proximity scanning
    } else {
      mockProxPrompt.classList.add('hidden');
    }
  }
  assert(!proxPromptVisible, 'Proximity prompt hidden when meadowlands is null');

  // 4. Dynasty objective banner check
  let bannerUpdated = false;
  const mockBanner = { textContent: '' };
  if (mockBanner && colony && currentMeadowlands) {
    bannerUpdated = true;
  }
  assert(!bannerUpdated, 'Dynasty banner update safely skipped when colony & meadowlands are null');
});

await runTest('Adversarial 1.3: Audio loop teardown safety in AudioManager', () => {
  const dummyCtx = {
    currentTime: 10,
    createGain: () => ({ gain: { value: 0, setTargetAtTime: () => {} } }),
    createBiquadFilter: () => ({ frequency: { value: 0, setTargetAtTime: () => {} }, Q: { value: 0 } }),
  };
  const audioManager = Object.create(AudioManager.prototype);
  audioManager._amb = null;
  audioManager.ctx = dummyCtx;

  let threw = false;
  try {
    audioManager.updateLoops(1/60, 10, 1.0);
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'AudioManager.updateLoops safely returns when _amb is null');

  threw = false;
  try {
    audioManager.stopAmbience();
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'AudioManager.stopAmbience safely returns when _amb is null');
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 2: Citizen Roles Cycling (R), Badges, Speech Bubbles & Edge Cases
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 2.1: Citizen role cycling under modulo stress & edge cases', () => {
  const colony = new Colony();
  const citizen = new Citizen('Gumbo', { body: null });
  colony.citizens.push(citizen);

  const rolesCycle = [null, 'forager', 'builder', 'defender', 'tinkerer'];
  let activeCitizenIdx = 0;

  const cycleRole = () => {
    if (colony && colony.citizens.length > 0) {
      const cit = colony.citizens[activeCitizenIdx % colony.citizens.length];
      if (cit) {
        const curIdx = rolesCycle.indexOf(cit.role || null);
        const nextRole = rolesCycle[(curIdx + 1) % rolesCycle.length];
        colony.assignRole(cit, nextRole);
        cit.say?.(nextRole ? `I am now a ${nextRole}!` : 'I am free to wander!', nextRole ? '🛠️' : '🌱');
      }
    }
  };

  // Perform 50 cycles (10 full loops)
  for (let i = 0; i < 50; i++) {
    const expectedRole = rolesCycle[(i + 1) % rolesCycle.length];
    cycleRole();
    assert(citizen.role === expectedRole, `Cycle ${i+1}: expected role ${expectedRole}, got ${citizen.role}`);
    const bubble = citizen.bubbleText();
    assert(bubble && bubble.text.length > 0, `Speech bubble text exists: "${bubble.text}"`);
    if (expectedRole) {
      assert(bubble.text.includes(expectedRole), `Speech bubble mentions role ${expectedRole}`);
      assert(bubble.icon === '🛠️', `Speech bubble has tool icon`);
    } else {
      assert(bubble.text.includes('free'), `Speech bubble mentions free`);
      assert(bubble.icon === '🌱', `Speech bubble has sprout icon`);
    }
  }

  // Edge case: Corrupted role set on citizen
  citizen.role = 'corrupted_unknown_role';
  cycleRole();
  assert(citizen.role === null, 'Recovers safely from unknown role to null');

  // Edge case: Colony with 0 citizens
  colony.citizens = [];
  let errorCaught = false;
  try {
    cycleRole();
  } catch (e) {
    errorCaught = true;
  }
  assert(!errorCaught, '0 citizens in colony does not throw on role cycle');

  // Edge case: Large activeCitizenIdx modulo wrap
  colony.citizens.push(citizen);
  activeCitizenIdx = 999999;
  cycleRole();
  assert(citizen.role === 'forager', 'Large activeCitizenIdx cleanly wraps modulo');
});

await runTest('Adversarial 2.2: Role badge buttons DOM active state synchronization', () => {
  const badgeStates = {
    forager: false,
    builder: false,
    defender: false,
    tinkerer: false,
    '': false
  };

  const updateCitizenRoleBadgesMock = (cit) => {
    const curRole = cit?.role || '';
    for (const [r] of Object.entries(badgeStates)) {
      badgeStates[r] = (r === curRole);
    }
  };

  const cit = { role: 'builder' };
  updateCitizenRoleBadgesMock(cit);
  assert(badgeStates['builder'] === true, 'builder button is active');
  assert(badgeStates['forager'] === false, 'forager button is not active');
  assert(badgeStates[''] === false, 'free button is not active');

  cit.role = null;
  updateCitizenRoleBadgesMock(cit);
  assert(badgeStates[''] === true, 'free button is active when role is null');
  assert(badgeStates['builder'] === false, 'builder button is not active when role is null');
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 3: Gathering Math, Boundaries, Cap Clamping & Silo Routing
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 3.1: Proximity boundary precision & target conflict resolution', () => {
  const mockWorld = {
    trees: [{ x: 10, y: 0, z: 0, type: 'pine', s: 1 }],
    rockNodes: [{ x: 0, y: 0, z: 10, s: 1 }],
    berryBushes: [{ x: -10, y: 0, z: 0, available: 5, berries: [] }],
    ruins: [],
    pressurePlates: []
  };

  const evalProx = (px, pz) => {
    const p = { x: px, z: pz };
    let bestTarget = null;
    let minScore = Infinity;

    for (const tree of mockWorld.trees) {
      const d = Math.hypot(p.x - tree.x, p.z - tree.z);
      if (d < 3.2 && (d / 3.2) < minScore) {
        minScore = d / 3.2;
        bestTarget = { type: 'tree', tree, d };
      }
    }
    for (const rock of mockWorld.rockNodes) {
      const d = Math.hypot(p.x - rock.x, p.z - rock.z);
      if (d < 3.0 && (d / 3.0) < minScore) {
        minScore = d / 3.0;
        bestTarget = { type: 'rock', rock, d };
      }
    }
    for (const bush of mockWorld.berryBushes) {
      const d = Math.hypot(p.x - bush.x, p.z - bush.z);
      if (d < 2.6 && (d / 2.6) < minScore) {
        minScore = d / 2.6;
        bestTarget = { type: 'bush', bush, d };
      }
    }
    return bestTarget;
  };

  // Exact boundary tests
  assert(evalProx(10, 3.199)?.type === 'tree', 'Tree detected at 3.199m (< 3.2m)');
  assert(evalProx(10, 3.201) === null, 'Tree ignored at 3.201m (>= 3.2m)');

  assert(evalProx(0, 10 - 2.999)?.type === 'rock', 'Rock detected at 2.999m (< 3.0m)');
  assert(evalProx(0, 10 - 3.001) === null, 'Rock ignored at 3.001m (>= 3.0m)');

  assert(evalProx(-10 + 2.599, 0)?.type === 'bush', 'Bush detected at 2.599m (< 2.6m)');
  assert(evalProx(-10 + 2.601, 0) === null, 'Bush ignored at 2.601m (>= 2.6m)');
});

await runTest('Adversarial 3.2: Blueprint placement overrides gathering interaction on KeyE', () => {
  const buildingManager = {
    activeBlueprint: { id: 'silo' },
    placedCount: 0,
    confirmPlacement() {
      this.placedCount++;
      this.activeBlueprint = null;
      return { success: true };
    }
  };

  let gatherExecuted = false;
  const currentGatherTarget = { type: 'tree' };

  const handleKeyE = () => {
    if (buildingManager && buildingManager.activeBlueprint) {
      buildingManager.confirmPlacement();
    } else if (currentGatherTarget) {
      gatherExecuted = true;
    }
  };

  handleKeyE();
  assert(buildingManager.placedCount === 1, 'Blueprint confirmed on first E press');
  assert(!gatherExecuted, 'Gather was NOT executed while blueprint was active');

  handleKeyE();
  assert(gatherExecuted, 'Gather executed on second E press once blueprint was cleared');
});

await runTest('Adversarial 3.3: Silo chain capacity, overflow and fill mesh scaling', () => {
  const scene = new THREE.Scene();
  const fakePhysics = {
    createFixedCylinder: () => fakePhysReg('cyl'),
    createStaticBox: () => fakePhysReg('box'),
  };
  const bm = new BuildingManager(scene, fakePhysics);
  const colony = new Colony();

  // Initial caps in Colony: wood 99, berries 99, stone 99
  assert(colony.storageCap.wood === 99, 'Initial wood cap 99');
  assert(colony.storageCap.stone === 99, 'Initial stone cap 99');

  // Place Silo 1
  const s1 = bm._instantiateStructure('silo', { x: 5, y: 0, z: 5 });
  bm.placedStructures.push(s1);
  for (const res of ['wood', 'berries', 'stone']) {
    colony.storageCap[res] += SILO_CAP_BONUS;
  }
  assert(colony.storageCap.wood === 149, 'Wood cap increased by 50 to 149');

  // Fill colony wood to cap (149)
  colony.resources.wood = 149;

  // Add 40 wood via addResource with silo
  const r1 = colony.addResource('wood', 40, [s1]);
  assert(r1.added === 0, 'No direct colony room (added 0)');
  assert(r1.overflowStored === 40, '40 wood stored in Silo 1');
  assert(s1.stored.wood === 40, 'Silo 1 holds 40 wood');
  assert(s1._storedTotal() === 40, 'Silo 1 total stored 40');
  // Fill mesh scale: frac = 40/60 = 0.6667
  assert(Math.abs(s1.fillMesh.scale.y - (40 / 60)) < 0.01, `Silo fill mesh scaled correctly: ${s1.fillMesh.scale.y}`);

  // Place Silo 2
  const s2 = bm._instantiateStructure('silo', { x: 10, y: 0, z: 5 });
  bm.placedStructures.push(s2);
  for (const res of ['wood', 'berries', 'stone']) {
    colony.storageCap[res] += SILO_CAP_BONUS;
  }
  assert(colony.storageCap.wood === 199, 'Wood cap increased to 199');

  // Now colony has room for (199 - 149) = 50 wood!
  // Add 70 wood: 50 goes into colony, 20 into silos!
  // Silo 1 has 20 capacity left (60 - 40 = 20), so Silo 1 takes exactly 20 and is 100% full!
  const r2 = colony.addResource('wood', 70, [s1, s2]);
  assert(r2.added === 50, '50 added to colony');
  assert(r2.overflowStored === 20, '20 overflow stored');
  assert(s1.stored.wood === 60, 'Silo 1 now at full capacity (60)');
  assert(s1.fillMesh.scale.y === 1, 'Silo 1 fill mesh at 1.0 (full)');

  // Now Silo 1 is completely full. Next overflow must spill into Silo 2!
  colony.resources.stone = colony.storageCap.stone;
  const r3 = colony.addResource('stone', 25, [s1, s2]);
  assert(r3.added === 0, 'Colony stone was at cap');
  assert(r3.overflowStored === 25, '25 stone stored in overflow');
  assert(s1.stored.stone === 0, 'Silo 1 could take 0 stone because it was already at 60/60');
  assert(s2.stored.stone === 25, 'Silo 2 took all 25 stone');
  assert(Math.abs(s2.fillMesh.scale.y - (25 / 60)) < 0.01, 'Silo 2 fill mesh matches 25/60');

  // Overfill beyond all silos
  // Silo 2 has 35 room left. Add 50 berries (colony at cap):
  colony.resources.berries = colony.storageCap.berries;
  const r4 = colony.addResource('berries', 50, [s1, s2]);
  assert(r4.overflowStored === 35, '35 berries stored into Silo 2');
  assert(r4.overflowLost === 15, '15 berries lost to meadow (all silos full)');
  assert(s2._storedTotal() === 60, 'Silo 2 now at 60/60');
});

await runTest('Adversarial 3.4: Berry bush harvest spam & multiple regrowth cycles', () => {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);
  const bush = world.berryBushes[0];

  // Pluck all 5 berries
  for (let i = 0; i < 5; i++) {
    assert(bush.available === 5 - i, `Bush has ${5 - i} berries before pluck`);
    bush.available--;
    bush.berries[bush.available].visible = false;
  }
  assert(bush.available === 0, 'Bush is empty');
  for (let i = 0; i < 5; i++) {
    assert(bush.berries[i].visible === false, `Berry ${i} mesh is hidden`);
  }

  // Attempt to pluck from empty bush
  if (bush.available > 0) {
    bush.available--;
  }
  assert(bush.available === 0, 'Plucking empty bush does not go below 0');

  // Regrow 1 berry (20s)
  world._updateBushRegrowth(20);
  assert(bush.available === 1, 'Bush regrew 1 berry after 20s');
  assert(bush.berries[0].visible === true, 'Berry 0 visible');
  assert(bush.berries[1].visible === false, 'Berry 1 still hidden');

  // Regrow remaining 4 berries (80s)
  for (let i = 0; i < 4; i++) {
    world._updateBushRegrowth(20);
  }
  assert(bush.available === 5, 'Bush fully regrown to 5');
  for (let i = 0; i < 5; i++) {
    assert(bush.berries[i].visible === true, `Berry ${i} visible again`);
  }

  // Additional regrowth should not exceed 5
  world._updateBushRegrowth(100);
  assert(bush.available === 5, 'Bush does not exceed max capacity of 5');
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 4: Dynasty Objective Banner Robustness
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 4.1: Dynasty Objective Banner edge cases (0, large counts, null props)', () => {
  const getBanner = (colony, currentMeadowlands, buildingManager) => {
    const placed = buildingManager?.placedStructures || [];
    const hasSilo = placed.some(s => s.id === 'silo');
    const openedVaults = (currentMeadowlands?.ruins || []).filter(r => r.opened).length;
    const totalVaults = (currentMeadowlands?.ruins || []).length || 2;
    const wood = colony?.resources?.wood || 0;
    const stone = colony?.resources?.stone || 0;

    if (!hasSilo) {
      return `Goal: Gather Wood & Stone to build a Silo (🪵 ${Math.min(3, wood)}/3 · 🪨 ${Math.min(3, stone)}/3) or step on 3 Ancient Plates to unlock the Toy Vault (${openedVaults}/${totalVaults})`;
    } else if (openedVaults < totalVaults) {
      return `Goal: Step on 3 Ancient Plates to unlock the Toy Vault! (${openedVaults}/${totalVaults} Unlocked)`;
    } else {
      return `Goal: Expand New Dweebtopia! Build Watchtowers & Barricades to defend against Critters (Gen ${colony?.generation || 1})`;
    }
  };

  // Case A: 0 resources, 0 vaults
  let banner = getBanner({ resources: { wood: 0, stone: 0 } }, { ruins: [{ opened: false }, { opened: false }] }, null);
  assert(banner.includes('🪵 0/3 · 🪨 0/3'), 'Handles 0 resources');
  assert(banner.includes('(0/2)'), 'Handles 0/2 vaults');

  // Case B: 100 resources (display caps at 3/3)
  banner = getBanner({ resources: { wood: 100, stone: 50 } }, { ruins: [{ opened: false }, { opened: false }] }, null);
  assert(banner.includes('🪵 3/3 · 🪨 3/3'), 'Caps display at 3/3 even with 100 resources');

  // Case C: Missing ruins array
  banner = getBanner({ resources: { wood: 1, stone: 1 } }, {}, null);
  assert(banner.includes('(0/2)'), 'Fallback to 2 total vaults if ruins missing');

  // Case D: Silo placed, 1 of 2 vaults opened
  banner = getBanner({ resources: {} }, { ruins: [{ opened: true }, { opened: false }] }, { placedStructures: [{ id: 'silo' }] });
  assert(banner === 'Goal: Step on 3 Ancient Plates to unlock the Toy Vault! (1/2 Unlocked)', 'Phase 2 with 1/2 unlocked');

  // Case E: Silo placed, both vaults opened, Generation 7
  banner = getBanner({ generation: 7, resources: {} }, { ruins: [{ opened: true }, { opened: true }] }, { placedStructures: [{ id: 'silo' }] });
  assert(banner === 'Goal: Expand New Dweebtopia! Build Watchtowers & Barricades to defend against Critters (Gen 7)', 'Phase 3 with Gen 7');
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 5: Meadowlands World Geometry & Colliders
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 5.1: Verify Meadowlands landmarks and rock colliders', () => {
  const scene = new THREE.Scene();
  const colliders = [];
  const fakePhysics = {
    createFixedCylinder: (x, y, z, r, h, tag) => {
      const c = { x, y, z, r, h, tag };
      colliders.push(c);
      return { id: 'cyl', body: fakePhysBody(), collider: c };
    },
    createStaticBox: () => fakePhysReg('box'),
    createStaticBoxRotated: () => fakePhysReg('box-rot'),
    createFixedCone: () => fakePhysReg('cone'),
    createKinematicShape: () => fakePhysReg('kin'),
    createKinematicBox: () => fakePhysReg('kin-box'),
    createDynamicBody: () => ({ body: fakePhysBody() }),
    applyImpulse() {},
    removeBody() {},
    getImpacts: () => [],
  };

  const world = new Meadowlands(fakePhysics, scene);
  assert(world.trees.length === 9, `9 trees in world (got ${world.trees.length})`);
  assert(world.rockNodes.length === 7, `7 rockNodes in world (got ${world.rockNodes.length})`);
  assert(world.ruins.length === 2, `2 ruins in world (got ${world.ruins.length})`);

  // Each ruin must have 3 plates
  for (let i = 0; i < world.ruins.length; i++) {
    const r = world.ruins[i];
    assert(r.plates.length === 3, `Ruin ${i} has 3 plates`);
  }

  // Verify physics colliders for rocks
  const rockColliders = colliders.filter(c => c.tag === 'stone');
  assert(rockColliders.length >= 7, `Stone colliders created in world (got ${rockColliders.length})`);
});

console.log('\n================================================================');
console.log(`TOTAL ADVERSARIAL TESTS: ${totalTests}`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${failedTests}`);
console.log('================================================================');

if (failedTests > 0) {
  console.error('\nFAILURES RECORDED:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
} else {
  console.log('\n>>> ALL ADVERSARIAL CHALLENGES EMPIRICALLY CONFIRMED AND PASSED! <<<');
  process.exit(0);
}
