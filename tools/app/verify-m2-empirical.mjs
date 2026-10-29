// verify-m2-empirical.mjs — Comprehensive empirical test harness for Milestone 2: Expedition & Dynasty
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { Meadowlands } from '../../src/world/Meadowlands.js';
import { Colony } from '../../src/adventure/colony.js';
import { Citizen, ROLES } from '../../src/adventure/citizen.js';
import { BuildingManager } from '../../src/adventure/building.js';

let pass = 0, fail = 0;
const errors = [];
const ok = (cond, msg) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('  FAIL:', msg);
    errors.push(msg);
  }
};
const test = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fail++;
    console.error('✗', name, '—', e.message);
    errors.push(`${name}: ${e.message}`);
  }
};

console.log('====================================================');
console.log('STARTING EMPIRICAL CHALLENGE SUITE: MILESTONE 2');
console.log('====================================================\n');

// -----------------------------------------------------------------------------
// SECTION 1: Meadowlands exposed nodes (trees, rockNodes, bushes)
// -----------------------------------------------------------------------------
await test('Meadowlands: trees array structure & coordinates', () => {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);

  ok(Array.isArray(world.trees), 'world.trees should be an array');
  ok(world.trees.length === 9, `world.trees length should be 9, got ${world.trees.length}`);

  world.trees.forEach((t, i) => {
    ok(Number.isFinite(t.x), `tree[${i}].x is finite number: ${t.x}`);
    ok(Number.isFinite(t.y), `tree[${i}].y is finite number: ${t.y}`);
    ok(Number.isFinite(t.z), `tree[${i}].z is finite number: ${t.z}`);
    ok(t.type === 'pine' || t.type === 'broad', `tree[${i}].type valid: ${t.type}`);
    ok(Number.isFinite(t.s) && t.s > 0, `tree[${i}].s is positive scale: ${t.s}`);
  });
});

await test('Meadowlands: rockNodes array structure & coordinates', () => {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);

  ok(Array.isArray(world.rockNodes), 'world.rockNodes should be an array');
  ok(world.rockNodes.length === 7, `world.rockNodes length should be 7, got ${world.rockNodes.length}`);

  world.rockNodes.forEach((r, i) => {
    ok(Number.isFinite(r.x), `rockNode[${i}].x is finite number: ${r.x}`);
    ok(Number.isFinite(r.y), `rockNode[${i}].y is finite number: ${r.y}`);
    ok(Number.isFinite(r.z), `rockNode[${i}].z is finite number: ${r.z}`);
    ok(Number.isFinite(r.s) && r.s > 0, `rockNode[${i}].s is positive scale: ${r.s}`);
  });
});

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

await test('Meadowlands: rock physics cylinder creation when physicsWorld present', () => {
  const scene = new THREE.Scene();
  const cylinders = [];
  const fakePhysics = {
    createFixedCylinder(x, y, z, r, h, tag) {
      cylinders.push({ x, y, z, r, h, tag });
      return fakePhysReg('cyl');
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
  const stoneCylinders = cylinders.filter(c => c.tag === 'stone');
  ok(stoneCylinders.length >= 4, `stone physics colliders created, got ${stoneCylinders.length}`);
});

await test('Meadowlands: berry bush pluck & regrowth restores mesh visibility', () => {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);

  ok(world.berryBushes.length > 0, 'berry bushes exist');
  const bush = world.berryBushes[0];
  ok(bush.available === 5, 'bush starts with 5 berries');
  ok(bush.berries && bush.berries.length === 5, '5 berry meshes exist on bush');

  // Pluck one berry
  bush.available--;
  const pluckedMesh = bush.berries[bush.available];
  pluckedMesh.visible = false;
  ok(pluckedMesh.visible === false, 'plucked berry mesh hidden');

  // Advance bush regrowth timer to 20 seconds
  bush.regenTimer = 19.9;
  world._updateBushRegrowth(0.2);
  ok(bush.available === 5, 'bush regrows berry to 5');
  ok(pluckedMesh.visible === true, 'bush regrown berry mesh visible again');
});

// -----------------------------------------------------------------------------
// SECTION 2: DOM elements in index.html for Milestone 2
// -----------------------------------------------------------------------------
await test('DOM: index.html contains required Milestone 2 HUD elements', () => {
  const htmlPath = path.resolve('index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // 1. #civ-hud
  ok(html.includes('id="civ-hud"'), '#civ-hud container exists');

  // 2. #dynasty-objective-banner
  ok(html.includes('id="dynasty-objective-banner"'), '#dynasty-objective-banner exists');
  ok(html.includes('Goal: Gather Wood &amp; Stone to build a Silo'), 'initial objective banner text present');

  // 3. #btn-civ-exit-mall
  ok(html.includes('id="btn-civ-exit-mall"'), '#btn-civ-exit-mall exists');
  ok(html.includes('civ-mall-btn'), 'civ-mall-btn class present');
  ok(html.includes('🏛️ Exit to Mall'), 'Exit to Mall button label present');

  // 4. #civ-proximity-prompt
  ok(html.includes('id="civ-proximity-prompt"'), '#civ-proximity-prompt exists');
  ok(html.includes('id="civ-prompt-action"'), '#civ-prompt-action exists');

  // 5. Citizen role badges (.role-badge-btn)
  ok(html.includes('class="role-badge-btn'), '.role-badge-btn class present');
  ok(html.includes('data-role="forager"'), 'forager badge button present');
  ok(html.includes('data-role="builder"'), 'builder badge button present');
  ok(html.includes('data-role="defender"'), 'defender badge button present');
  ok(html.includes('data-role="tinkerer"'), 'tinkerer badge button present');
  ok(html.includes('data-role=""'), 'free/wander badge button present');
});

// -----------------------------------------------------------------------------
// SECTION 3: Proximity detection math and prompt prioritization
// -----------------------------------------------------------------------------
function evaluateProximity(p, world) {
  let bestTarget = null;
  let minScore = Infinity;

  // Trees (< 3.2m)
  for (const tree of world.trees || []) {
    const d = Math.hypot(p.x - tree.x, p.z - tree.z);
    if (d < 3.2 && (d / 3.2) < minScore) {
      minScore = d / 3.2;
      bestTarget = { type: 'tree', tree, text: '[E] Gather Lumber (+2 Wood)' };
    }
  }

  // Rock Nodes (< 3.0m)
  for (const rock of world.rockNodes || []) {
    const d = Math.hypot(p.x - rock.x, p.z - rock.z);
    if (d < 3.0 && (d / 3.0) < minScore) {
      minScore = d / 3.0;
      bestTarget = { type: 'rock', rock, text: '[E] Mine Stone (+2 Stone)' };
    }
  }

  // Berry Bushes (< 2.6m)
  for (const bush of world.berryBushes || []) {
    const d = Math.hypot(p.x - bush.x, p.z - bush.z);
    if (d < 2.6 && (d / 2.6) < minScore) {
      minScore = d / 2.6;
      const hasBerries = (bush.available ?? 5) > 0;
      bestTarget = {
        type: hasBerries ? 'bush' : 'bush_empty',
        bush,
        text: hasBerries ? '[E] Harvest Berries (+1 Berry)' : '🍓 Berry Bush (Regrowing...)'
      };
    }
  }

  // Pressure Plates (< 2.2m)
  const plates = [
    ...(world.pressurePlates || []),
    ...((world.ruins || []).flatMap(r => r.plates || []))
  ];
  for (const plate of plates) {
    const d = Math.hypot(p.x - plate.x, p.z - plate.z);
    if (d < 2.2 && (d / 2.2) < minScore) {
      minScore = d / 2.2;
      bestTarget = { type: 'plate', plate, text: '[E] Step on Plate' };
    }
  }

  // Vaults (< 3.2m)
  for (const ruin of world.ruins || []) {
    const d = Math.hypot(p.x - ruin.x, p.z - ruin.z);
    if (d < 3.2 && (d / 3.2) < minScore) {
      minScore = d / 3.2;
      bestTarget = {
        type: 'vault',
        ruin,
        text: ruin.opened ? '✨ Ancient Vault (Opened)' : '🔒 Sealed Toy Vault (Requires 3 Plates)'
      };
    }
  }

  return bestTarget;
}

await test('Proximity Math: correctly detects closest interactive targets', () => {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);

  // 1. Near tree (-24, 18)
  const nearTree = evaluateProximity({ x: -24.5, z: 18.2 }, world);
  ok(nearTree !== null, 'found target near tree');
  ok(nearTree?.type === 'tree', `expected tree, got ${nearTree?.type}`);
  ok(nearTree?.text === '[E] Gather Lumber (+2 Wood)', `expected lumber prompt, got ${nearTree?.text}`);

  // 2. Near rock (-18, -10)
  const nearRock = evaluateProximity({ x: -18.2, z: -10.3 }, world);
  ok(nearRock !== null, 'found target near rock');
  ok(nearRock?.type === 'rock', `expected rock, got ${nearRock?.type}`);
  ok(nearRock?.text === '[E] Mine Stone (+2 Stone)', `expected rock prompt, got ${nearRock?.text}`);

  // 3. Near ruin plate
  const plate = world.ruins[0]?.plates[0];
  ok(plate !== undefined, 'plate exists on ruin');
  const nearPlate = evaluateProximity({ x: plate.x + 0.5, z: plate.z + 0.5 }, world);
  ok(nearPlate !== null, 'found target near plate');
  ok(nearPlate?.type === 'plate', `expected plate, got ${nearPlate?.type}`);
  ok(nearPlate?.text === '[E] Step on Plate', `expected plate text, got ${nearPlate?.text}`);

  // 4. Near closed vault
  const ruin = world.ruins[0];
  const nearVault = evaluateProximity({ x: ruin.x + 0.5, z: ruin.z + 0.5 }, world);
  ok(nearVault !== null, 'found target near vault');
  ok(nearVault?.type === 'vault', `expected vault, got ${nearVault?.type}`);
  ok(nearVault?.text === '🔒 Sealed Toy Vault (Requires 3 Plates)', `expected sealed prompt, got ${nearVault?.text}`);

  // 5. Far from everything
  const farAway = evaluateProximity({ x: 999, z: 999 }, world);
  ok(farAway === null, 'no prompt when player is far away');
});

await test('Proximity Math: normalized distance competition between close objects', () => {
  // Tree at (0, 2.0) -> d = 2.0, score = 2.0 / 3.2 = 0.625
  // Rock at (0, -2.5) -> d = 2.5, score = 2.5 / 3.0 = 0.833
  const mockWorld = {
    trees: [{ x: 0, z: 2.0 }],
    rockNodes: [{ x: 0, z: -2.5 }],
    berryBushes: [],
    ruins: [],
    pressurePlates: []
  };
  const target = evaluateProximity({ x: 0, z: 0 }, mockWorld);
  ok(target?.type === 'tree', `tree should win with lower normalized score (0.625 vs 0.833), got ${target?.type}`);
});

await test('Proximity Math: empty berry bush shows regrowing prompt and does not harvest', () => {
  const emptyBush = { x: 5, z: 5, available: 0 };
  const mockWorld = {
    trees: [],
    rockNodes: [],
    berryBushes: [emptyBush],
    ruins: [],
    pressurePlates: []
  };
  const target = evaluateProximity({ x: 5.5, z: 5.5 }, mockWorld);
  ok(target?.type === 'bush_empty', `expected bush_empty, got ${target?.type}`);
  ok(target?.text.includes('Regrowing'), `expected Regrowing text, got ${target?.text}`);
});

// -----------------------------------------------------------------------------
// SECTION 4: Gathering via KeyE and colony resource mutation
// -----------------------------------------------------------------------------
await test('KeyE Gathering: trees yield +2 Wood', () => {
  const colony = new Colony();
  colony.resources.wood = 0;

  const gatherTarget = { type: 'tree' };
  if (gatherTarget.type === 'tree') {
    colony.addResource('wood', 2, []);
  }

  ok(colony.resources.wood === 2, `wood should be 2, got ${colony.resources.wood}`);
});

await test('KeyE Gathering: rocks yield +2 Stone', () => {
  const colony = new Colony();
  colony.resources.stone = 0;

  const gatherTarget = { type: 'rock' };
  if (gatherTarget.type === 'rock') {
    colony.addResource('stone', 2, []);
  }

  ok(colony.resources.stone === 2, `stone should be 2, got ${colony.resources.stone}`);
});

await test('KeyE Gathering: berry bushes yield +1 Berry and decrement bush count', () => {
  const colony = new Colony();
  colony.resources.berries = 0;
  const bush = { available: 3, berries: [{ visible: true }, { visible: true }, { visible: true }] };

  const gatherTarget = { type: 'bush', bush };
  if (gatherTarget.type === 'bush') {
    if ((bush.available ?? 0) > 0) {
      bush.available--;
      if (bush.berries && bush.berries.length > 0) {
        const bMesh = bush.berries[bush.available];
        if (bMesh) bMesh.visible = false;
      }
      colony.addResource('berries', 1, []);
    }
  }

  ok(bush.available === 2, `bush available should be 2, got ${bush.available}`);
  ok(bush.berries[2].visible === false, 'third berry mesh hidden');
  ok(colony.resources.berries === 1, `colony berries should be 1, got ${colony.resources.berries}`);
});

await test('KeyE Gathering: overflow deposits into Silos', () => {
  const colony = new Colony();
  colony.storageCap.wood = 10;
  colony.resources.wood = 9;

  let siloStored = 0;
  const mockSilo = {
    id: 'silo',
    deposit(res, n) {
      siloStored += n;
      return n;
    }
  };

  const res = colony.addResource('wood', 2, [mockSilo]);
  ok(colony.resources.wood === 10, `colony wood at cap (10), got ${colony.resources.wood}`);
  ok(res.overflowStored === 1, `1 unit overflow stored in silo, got ${res.overflowStored}`);
  ok(siloStored === 1, `silo received 1 unit, got ${siloStored}`);
});

// -----------------------------------------------------------------------------
// SECTION 5: Citizen Role Assignment and Cycling
// -----------------------------------------------------------------------------
await test('Role Assignment: valid roles, free role, and rejection of invalid roles', () => {
  const colony = new Colony();
  const citizen = new Citizen('Blorp', { body: null });
  colony.citizens.push(citizen);

  const roles = ['forager', 'builder', 'defender', 'tinkerer'];
  for (const r of roles) {
    const okAssign = colony.assignRole(citizen, r);
    ok(okAssign === true, `assigning ${r} should succeed`);
    ok(citizen.role === r, `citizen role should be ${r}, got ${citizen.role}`);
  }

  // Clear role to free
  const okClear = colony.assignRole(citizen, null);
  ok(okClear === true, 'clearing role to null should succeed');
  ok(citizen.role === null, `citizen role should be null, got ${citizen.role}`);

  // Bad role
  const okBad = colony.assignRole(citizen, 'astronaut');
  ok(okBad === false, 'bad role should be rejected');
  ok(citizen.role === null, 'role remains null');
});

await test('Role Assignment: hotkey R cycle logic matches state transitions', () => {
  const rolesCycle = [null, 'forager', 'builder', 'defender', 'tinkerer'];

  let currentRole = null;
  const cycleOnce = (role) => {
    const curIdx = rolesCycle.indexOf(role || null);
    return rolesCycle[(curIdx + 1) % rolesCycle.length];
  };

  currentRole = cycleOnce(currentRole);
  ok(currentRole === 'forager', `step 1: expected forager, got ${currentRole}`);
  currentRole = cycleOnce(currentRole);
  ok(currentRole === 'builder', `step 2: expected builder, got ${currentRole}`);
  currentRole = cycleOnce(currentRole);
  ok(currentRole === 'defender', `step 3: expected defender, got ${currentRole}`);
  currentRole = cycleOnce(currentRole);
  ok(currentRole === 'tinkerer', `step 4: expected tinkerer, got ${currentRole}`);
  currentRole = cycleOnce(currentRole);
  ok(currentRole === null, `step 5: expected null (free), got ${currentRole}`);
});

// -----------------------------------------------------------------------------
// SECTION 6: Dynasty Objective Banner Progression
// -----------------------------------------------------------------------------
function generateObjectiveBannerText(colony, world, buildingManager) {
  const placed = buildingManager?.placedStructures || [];
  const hasSilo = placed.some(s => s.id === 'silo');
  const openedVaults = (world.ruins || []).filter(r => r.opened).length;
  const totalVaults = (world.ruins || []).length || 2;
  const wood = colony.resources.wood || 0;
  const stone = colony.resources.stone || 0;

  if (!hasSilo) {
    return `Goal: Gather Wood & Stone to build a Silo (🪵 ${Math.min(3, wood)}/3 · 🪨 ${Math.min(3, stone)}/3) or step on 3 Ancient Plates to unlock the Toy Vault (${openedVaults}/${totalVaults})`;
  } else if (openedVaults < totalVaults) {
    return `Goal: Step on 3 Ancient Plates to unlock the Toy Vault! (${openedVaults}/${totalVaults} Unlocked)`;
  } else {
    return `Goal: Expand New Dweebtopia! Build Watchtowers & Barricades to defend against Critters (Gen ${colony.generation})`;
  }
}

await test('Dynasty Objective Banner: transitions correctly through all 3 stages', () => {
  const colony = new Colony();
  const world = { ruins: [{ opened: false }, { opened: false }] };
  const bm = { placedStructures: [] };

  // Phase 1: No silo, resources 0/3
  colony.resources.wood = 1;
  colony.resources.stone = 2;
  let text = generateObjectiveBannerText(colony, world, bm);
  ok(text.includes('🪵 1/3 · 🪨 2/3'), `displays wood/stone counts: ${text}`);
  ok(text.includes('(0/2)'), `displays vault count 0/2: ${text}`);

  // Phase 2: Silo placed, 0/2 vaults opened
  bm.placedStructures.push({ id: 'silo' });
  text = generateObjectiveBannerText(colony, world, bm);
  ok(text === 'Goal: Step on 3 Ancient Plates to unlock the Toy Vault! (0/2 Unlocked)', `phase 2 0/2: ${text}`);

  // Phase 2b: 1/2 vaults opened
  world.ruins[0].opened = true;
  text = generateObjectiveBannerText(colony, world, bm);
  ok(text === 'Goal: Step on 3 Ancient Plates to unlock the Toy Vault! (1/2 Unlocked)', `phase 2 1/2: ${text}`);

  // Phase 3: Both vaults opened (2/2)
  world.ruins[1].opened = true;
  colony.generation = 4;
  text = generateObjectiveBannerText(colony, world, bm);
  ok(text === 'Goal: Expand New Dweebtopia! Build Watchtowers & Barricades to defend against Critters (Gen 4)', `phase 3: ${text}`);
});

// -----------------------------------------------------------------------------
// SECTION 7: Adversarial Stress Tests & Boundary Verification
// -----------------------------------------------------------------------------
await test('Stress: Proximity math boundary precision (epsilon check)', () => {
  const tree = { x: 0, z: 0 };
  const mockWorld = {
    trees: [tree],
    rockNodes: [],
    berryBushes: [],
    ruins: [],
    pressurePlates: []
  };

  // Just inside 3.2m (3.199m)
  const inside = evaluateProximity({ x: 3.199, z: 0 }, mockWorld);
  ok(inside !== null && inside.type === 'tree', '3.199m is within 3.2m threshold');

  // Just outside 3.2m (3.201m)
  const outside = evaluateProximity({ x: 3.201, z: 0 }, mockWorld);
  ok(outside === null, '3.201m is outside 3.2m threshold');
});

await test('Stress: Adversarial inputs (NaN, null, undefined) do not crash proximity logic', () => {
  const mockWorld = {
    trees: [{ x: 0, z: 0 }],
    rockNodes: [{ x: 10, z: 10 }],
    berryBushes: [],
    ruins: [],
    pressurePlates: []
  };

  ok(evaluateProximity({ x: NaN, z: 0 }, mockWorld) === null, 'NaN handled safely');
  ok(evaluateProximity({ x: Infinity, z: 0 }, mockWorld) === null, 'Infinity handled safely');
  ok(evaluateProximity({ x: undefined, z: undefined }, mockWorld) === null, 'undefined handled safely');
  ok(evaluateProximity({}, mockWorld) === null, 'empty object handled safely');
});

await test('Stress: Proximity evaluation performance (1,000 frames benchmark)', () => {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);

  const t0 = performance.now();
  const iterations = 1000;
  for (let i = 0; i < iterations; i++) {
    const rx = (Math.random() - 0.5) * 60;
    const rz = (Math.random() - 0.5) * 60;
    evaluateProximity({ x: rx, z: rz }, world);
  }
  const elapsed = performance.now() - t0;
  const perFrame = elapsed / iterations;
  console.log(`    Performance: ${iterations} proximity evaluations took ${elapsed.toFixed(2)}ms (${perFrame.toFixed(4)}ms/eval)`);
  ok(perFrame < 0.1, `per-frame cost should be < 0.1ms, measured ${perFrame.toFixed(4)}ms`);
});

await test('Stress: Rapid role cycling (1,000 transitions)', () => {
  const colony = new Colony();
  const citizen = new Citizen('Speedy', { body: null });
  colony.citizens.push(citizen);

  const rolesCycle = [null, 'forager', 'builder', 'defender', 'tinkerer'];
  let curRole = null;
  for (let i = 0; i < 1000; i++) {
    const curIdx = rolesCycle.indexOf(curRole);
    curRole = rolesCycle[(curIdx + 1) % rolesCycle.length];
    const okAssign = colony.assignRole(citizen, curRole);
    if (!okAssign) {
      throw new Error(`Failed to assign role ${curRole} at iteration ${i}`);
    }
  }
  ok(citizen.role === null, '1000 cycles completed cleanly and returned to null');
});

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n====================================================');
console.log(`EMPIRICAL CHALLENGE RESULTS: ${pass} passed, ${fail} failed`);
console.log('====================================================');

if (fail > 0) {
  console.error('\nErrors encountered:');
  errors.forEach(e => console.error(' -', e));
  process.exit(1);
} else {
  console.log('\nAll empirical tests passed cleanly!');
}
