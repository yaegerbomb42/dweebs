// expedition-dynasty-upgrade.test.js — M2: Expedition & Dynasty upgrade.
//
// Town tiers, multi-chamber ruin vaults (sequential plates → moving stone
// block → treasure chest with a rare blueprint), wildlife (gatherer beetles,
// nocturnal thieves, watchtower defense), weather (rain/fog), plus regression
// tests for the three bug fixes: toon-material roughness, citizen corner
// sticking, and corrupt-save persistence.
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { Colony, TOWN_TIERS, CORE_BLUEPRINTS } from '../src/adventure/colony.js';
import { Citizen, CITIZEN_STATES } from '../src/adventure/citizen.js';
import { BuildingManager, BLUEPRINTS } from '../src/adventure/building.js';
import { Meadowlands } from '../src/world/Meadowlands.js';
import { ballPitMaterial } from '../src/world/Arena.js';
import {
  saveVillage, loadVillage, applySave, SAVE_KEY, SAVE_VERSION,
} from '../src/adventure/persistence.js';

function fakeBody(x = 0, y = 0, z = 0) {
  return {
    _p: { x, y, z },
    _v: { x: 0, y: 0, z: 0 },
    translation() { return this._p; },
    linvel() { return this._v; },
    setLinvel(v) { this._v = { ...v }; },
    setTranslation(p) { this._p = { ...p }; },
  };
}

function fakeDweeb(name, x = 0, y = 0, z = 0) {
  return { name, body: fakeBody(x, y, z), controllerInput: null };
}

/** A world stub with the pieces citizens read. */
function fakeWorld(over = {}) {
  return {
    berryBushes: [{ x: 5, y: 0, z: 5, available: 5 }],
    springPads: [],
    buildingManager: { placedStructures: [] },
    critters: [],
    stuntFeed: [],
    timeOfDay: 12,
    ...over,
  };
}

function worldWithColony() {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);
  const colony = new Colony();
  return { world, colony, scene };
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); },
    _map: map,
  };
}

// ─── 1. Town tiers ───────────────────────────────────────────────────────────

describe('town tiers', () => {
  it('a new settlement starts as a hamlet with the core blueprints unlocked', () => {
    const colony = new Colony();
    expect(colony.tier).toBe('hamlet');
    expect(colony.tierIndex).toBe(0);
    for (const id of CORE_BLUEPRINTS) expect(colony.isBlueprintUnlocked(id)).toBe(true);
    expect(colony.isBlueprintUnlocked('gazebo')).toBe(false);
    expect(colony.isBlueprintUnlocked('windmill')).toBe(false);
    expect(colony.isBlueprintUnlocked('watchtower')).toBe(false);
    expect(colony.villageRadius).toBe(TOWN_TIERS[0].boundary);
  });

  it('population + structure milestones advance hamlet → village → town → citadel', () => {
    const colony = new Colony();
    const world = fakeWorld();
    const grow = (citizens, structures) => {
      while (colony.citizens.length < citizens) colony.addCitizen(fakeDweeb(`D${colony.citizens.length}`));
      world.buildingManager.placedStructures = new Array(structures).fill(0).map((_, i) => ({ id: `s${i}` }));
      return colony.recalculateTier(world);
    };
    expect(grow(3, 2)).toBe('village');
    expect(colony.isBlueprintUnlocked('gazebo')).toBe(true);
    expect(colony.isBlueprintUnlocked('waterwheel')).toBe(true);
    expect(colony.isBlueprintUnlocked('windmill')).toBe(false);
    expect(colony.villageRadius).toBe(24);
    expect(colony.historyLog[0].text).toMatch(/Village/);

    expect(grow(6, 5)).toBe('town');
    expect(colony.isBlueprintUnlocked('windmill')).toBe(true);
    expect(colony.isBlueprintUnlocked('clockwork')).toBe(true);
    expect(colony.villageRadius).toBe(32);

    expect(grow(10, 9)).toBe('citadel');
    expect(colony.isBlueprintUnlocked('watchtower')).toBe(true);
    expect(colony.isBlueprintUnlocked('fort')).toBe(true);
    expect(colony.villageRadius).toBe(44);
    expect(colony.historyLog[0].text).toMatch(/Citadel/);
  });

  it('tiers never demote when structures are lost', () => {
    const colony = new Colony();
    const world = fakeWorld();
    while (colony.citizens.length < 3) colony.addCitizen(fakeDweeb('D'));
    world.buildingManager.placedStructures = [{ id: 'a' }, { id: 'b' }];
    expect(colony.recalculateTier(world)).toBe('village');
    world.buildingManager.placedStructures = [];
    expect(colony.recalculateTier(world)).toBe('village');
  });

  it('queueBuild rejects locked blueprints until their tier (or a vault chest)', () => {
    const colony = new Colony();
    expect(colony.queueBuild('gazebo')).toBe(false);
    expect(colony.queueBuild('tent')).toBe(true);
    colony.unlockBlueprint('gazebo');
    expect(colony.queueBuild('gazebo')).toBe(true);
  });

  it('confirmPlacement refuses locked blueprints with a clear reason', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingManager(scene, null);
    const colony = new Colony();
    colony.unlockedBlueprints.delete('tent'); // simulate a locked blueprint
    bm.activeBlueprint = BLUEPRINTS.find(b => b.id === 'tent');
    bm.isValidPlacement = true;
    bm.placementPos.set(0, 0, 0);
    const res = bm.confirmPlacement(colony, fakeWorld());
    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/locked/i);
  });

  it('tier state round-trips through save / restore', () => {
    const colony = new Colony();
    const world = fakeWorld();
    while (colony.citizens.length < 6) colony.addCitizen(fakeDweeb('D'));
    world.buildingManager.placedStructures = new Array(5).fill(0).map((_, i) => ({ id: `s${i}` }));
    colony.recalculateTier(world);
    expect(colony.tier).toBe('town');

    const data = colony.serialize();
    const colony2 = new Colony();
    colony2.restore(data);
    expect(colony2.tier).toBe('town');
    expect(colony2.isBlueprintUnlocked('windmill')).toBe(true);
    expect(colony2.villageRadius).toBe(32);
  });
});

// ─── 2. Multi-chamber ruin vaults ────────────────────────────────────────────

describe('multi-chamber ruin vaults', () => {
  it('each ruin has sequential plates, a stone block and a locked chest', () => {
    const { world } = worldWithColony();
    expect(world.ruins.length).toBe(2);
    for (const ruin of world.ruins) {
      expect(ruin.stage).toBe('plates');
      expect(ruin.sequence).toEqual([]);
      expect(ruin.plates.map(p => p.order)).toEqual([0, 1, 2]);
      expect(ruin.block).toBeDefined();
      expect(ruin.block.progress).toBe(0);
      expect(ruin.chest).toBeDefined();
      expect(ruin.chest.opened).toBe(false);
      expect(typeof ruin.chest.blueprint).toBe('string');
    }
    expect(world.ruins[0].chest.blueprint).toBe('gazebo');
    expect(world.ruins[1].chest.blueprint).toBe('windmill');
  });

  it('pressing plates out of order resets the sequence', () => {
    const { world, colony } = worldWithColony();
    const ruin = world.ruins[0];
    const d = fakeDweeb('Sneak', ruin.plates[2].x, ruin.plates[2].y, ruin.plates[2].z);
    world.update(1 / 60, [d], colony);
    expect(ruin.sequence).toEqual([]);
    expect(ruin.opened).toBe(false);
    // Plate 0 then plate 2 (skipping 1) also resets.
    d.body._p.x = ruin.plates[0].x; d.body._p.z = ruin.plates[0].z;
    world.update(1 / 60, [d], colony);
    expect(ruin.sequence).toEqual([0]);
    d.body._p.x = ruin.plates[2].x; d.body._p.z = ruin.plates[2].z;
    world.update(1 / 60, [d], colony);
    expect(ruin.sequence).toEqual([]);
    expect(ruin.opened).toBe(false);
  });

  it('plates pressed in order complete the sequence and start the stone block', () => {
    const { world, colony } = worldWithColony();
    const ruin = world.ruins[0];
    const d = fakeDweeb('Delver', 0, 0, 0);
    for (const plate of ruin.plates) {
      d.body._p.x = plate.x; d.body._p.y = plate.y; d.body._p.z = plate.z;
      world.update(1 / 60, [d], colony);
    }
    expect(ruin.sequence).toEqual([0, 1, 2]);
    expect(ruin.opened).toBe(true);
    expect(ruin.stage).toBe('block');
    expect(colony.hats.length).toBe(1);
    expect(colony.tools.length).toBe(1);
  });

  it('the block slides aside, then the chest grants its rare blueprint', () => {
    const { world, colony } = worldWithColony();
    const ruin = world.ruins[0];
    expect(colony.isBlueprintUnlocked('gazebo')).toBe(false); // hamlet: still locked
    const dweebs = ruin.plates.map(p => fakeDweeb('Crew', p.x, p.y, p.z));
    world.update(1 / 60, dweebs, colony);
    expect(ruin.opened).toBe(true);
    const blockX0 = ruin.block.mesh.position.x;
    for (let i = 0; i < 60 * 4; i++) world.update(1 / 60, [], colony);
    expect(ruin.block.progress).toBe(1);
    expect(ruin.block.mesh.position.x).toBeGreaterThan(blockX0);
    expect(ruin.chest.opened).toBe(true);
    expect(ruin.stage).toBe('done');
    // The chest blueprint integrates with the tier unlocks: usable immediately.
    expect(colony.isBlueprintUnlocked('gazebo')).toBe(true);
    expect(colony.historyLog[0].text).toMatch(/rare blueprint/);
    expect(colony.queueBuild('gazebo')).toBe(true);
  });

  it('a fully opened ruin restores with block moved and chest open', () => {
    const { world } = worldWithColony();
    const ruin = world.ruins[1];
    const dweebs = ruin.plates.map(p => fakeDweeb('Crew', p.x, p.y, p.z));
    world.update(1 / 60, dweebs, null);
    for (let i = 0; i < 60 * 4; i++) world.update(1 / 60, [], null);
    expect(ruin.stage).toBe('done');
    const data = world.serialize();
    const scene2 = new THREE.Scene();
    const world2 = new Meadowlands(null, scene2);
    world2.restore(data);
    expect(world2.ruins[1].stage).toBe('done');
    expect(world2.ruins[1].chest.opened).toBe(true);
    expect(world2.ruins[1].block.progress).toBe(1);
  });
});

// ─── 3. Wildlife: beetles, thieves, watchtowers ──────────────────────────────

describe('wildlife & threat encounters', () => {
  it('spawnCritter supports kinds; beetles are friendly, thieves hostile', () => {
    const { world } = worldWithColony();
    const thief = world.spawnCritter('thief');
    const beetle = world.spawnBeetle();
    expect(thief.kind).toBe('thief');
    expect(thief.hostile).toBe(true);
    expect(beetle.kind).toBe('beetle');
    expect(beetle.hostile).toBe(false);
    expect(world.spawnCritter().kind).toBe('mischief'); // default unchanged
  });

  it('thieves spawn at night and flee at dawn', () => {
    const { world, colony } = worldWithColony();
    const origRandom = Math.random;
    Math.random = () => 0.1; // force the nocturnal thief roll (< 0.65)
    try {
      world.timeOfDay = 0; // midnight
      world.critterTimer = 0.01;
      world.update(0.1, [], colony);
    } finally {
      Math.random = origRandom;
    }
    expect(world.isNight).toBe(true);
    expect(world.critters.length).toBe(1);
    expect(world.critters[0].kind).toBe('thief');
    // Dawn sends the thief fleeing.
    world.timeOfDay = 12;
    world.update(0.1, [], colony);
    expect(world.critters[0].state).toBe('flee');
  });

  it('a thief at the campfire steals a berry AND a gold coin, then flees', () => {
    const { world, colony } = worldWithColony();
    world.timeOfDay = 0;
    world.update(0.1, [], null); // settle isNight
    colony.resources.berries = 10;
    colony.resources.gold = 5;
    const thief = world.spawnCritter('thief');
    thief.x = 1; thief.z = 1;
    for (let i = 0; i < 60 * 3; i++) world.update(1 / 60, [], colony);
    expect(colony.resources.berries).toBe(9);
    expect(colony.resources.gold).toBe(4);
    expect(thief.state).toBe('flee');
    expect(colony.historyLog[0].text).toMatch(/thief/i);
  });

  it('a gatherer beetle hauls berries from bushes into the village stores', () => {
    const { world, colony } = worldWithColony();
    const bush = world.berryBushes[0];
    bush.available = 5;
    const berries0 = colony.resources.berries;
    const beetle = world.spawnBeetle();
    beetle.x = bush.x + 1; beetle.z = bush.z + 1; // nose in the bush
    for (let i = 0; i < 60 * 7; i++) world.update(1 / 60, [], colony);
    expect(bush.available).toBeLessThan(5);
    expect(colony.resources.berries).toBeGreaterThan(berries0);
    expect(world.critters).toContain(beetle); // beetles never flee
  });

  it('plush cannons never target friendly beetles', () => {
    const { world, colony, scene } = worldWithColony();
    const bm = new BuildingManager(scene, null);
    const cannon = bm._instantiateStructure('cannon', new THREE.Vector3(0, 0, 0), world);
    const thief = world.spawnCritter('thief');
    thief.x = 5; thief.z = 0;
    const beetle = world.spawnBeetle();
    beetle.x = 6; beetle.z = 0;
    for (let i = 0; i < 60 * 4; i++) cannon.update(1 / 60, { world, colony });
    expect(beetle.hp).toBe(1); // untouched
    expect(thief.hp).toBeLessThan(2); // engaged
  });

  it('watchtowers pelt thieves with darts but ignore beetles', () => {
    const { world, colony, scene } = worldWithColony();
    const bm = new BuildingManager(scene, null);
    const tower = bm._instantiateStructure('ziptower', new THREE.Vector3(0, 0, 0), world);
    expect(typeof tower.update).toBe('function');
    const thief = world.spawnCritter('thief');
    thief.x = 5; thief.z = 0;
    const beetle = world.spawnBeetle();
    beetle.x = 7; beetle.z = 0;
    for (let i = 0; i < 60 * 5; i++) tower.update(1 / 60, { world, colony });
    expect(beetle.hp).toBe(1); // never targeted
    expect(thief.hp).toBeLessThan(2); // pelted
  });

  it('defender citizens bonk hostile critters but leave beetles alone', () => {
    const beetle = { kind: 'beetle', hostile: false, x: 2, y: 0, z: 0, hp: 1 };
    const guard = new Citizen(fakeDweeb('Guard', 0, 0, 0));
    guard.assignRole('defender');
    guard.state = CITIZEN_STATES.GUARD;
    guard.stateTimer = 9999;
    const w = fakeWorld({ critters: [beetle] });
    for (let i = 0; i < 200; i++) guard._executeGoal(1 / 60, w, [], null);
    expect(beetle.hp).toBe(1);

    const pest = { kind: 'mischief', hostile: true, x: 1, y: 0, z: 0, hp: 2 };
    const guard2 = new Citizen(fakeDweeb('Guard2', 0, 0, 0));
    guard2.assignRole('defender');
    guard2.state = CITIZEN_STATES.GUARD;
    guard2.stateTimer = 9999;
    const w2 = fakeWorld({ critters: [pest] });
    for (let i = 0; i < 200; i++) guard2._executeGoal(1 / 60, w2, [], null);
    expect(pest.hp).toBeLessThan(2);
  });
});

// ─── 4. Weather ──────────────────────────────────────────────────────────────

describe('weather & environmental cycles', () => {
  it('rain showers accelerate berry regrowth', () => {
    const { world } = worldWithColony();
    const bush = world.berryBushes[0];
    bush.available = 0;
    bush.regenTimer = 0;
    world.weather = 'rain';
    world.weatherTimer = 9999;
    world.update(7, [], null); // 7s × 3 = 21s of growth
    expect(bush.available).toBe(1);
  });

  it('clear skies keep the normal regrowth pace', () => {
    const { world } = worldWithColony();
    const bush = world.berryBushes[0];
    bush.available = 0;
    bush.regenTimer = 0;
    world.weather = 'clear';
    world.weatherTimer = 9999;
    world.update(7, [], null);
    expect(bush.available).toBe(0);
  });

  it('fog thickens the air, brightens torches, then lifts cleanly', () => {
    const { world } = worldWithColony();
    world.addTorchlight(2, 0, 2);
    world._startFog(null);
    expect(world.weather).toBe('fog');
    expect(world.scene.fog).toBeInstanceOf(THREE.Fog);
    world.timeOfDay = 12;
    world.update(0.1, [], null);
    expect(world.torchlights[0].light.intensity).toBeCloseTo(0.4 * 1.6, 5);
    world._endWeather();
    expect(world.scene.fog).toBeNull(); // base fog restored
    expect(world.rainDrops.visible).toBe(false);
  });

  it('in fog, thieves strike faster unless a torch is watching', () => {
    const mkThief = () => {
      const { world, colony } = worldWithColony();
      world.timeOfDay = 0;
      world.update(0.1, [], null);
      world.weather = 'fog';
      world.weatherTimer = 9999;
      colony.resources.berries = 10;
      const thief = world.spawnCritter('thief');
      thief.x = 1; thief.z = 1;
      return { world, colony, thief };
    };
    // No torch nearby: the thief strikes in ~1.25s.
    const dark = mkThief();
    for (let i = 0; i < 60 * 1.6; i++) dark.world.update(1 / 60, [], dark.colony);
    expect(dark.colony.resources.berries).toBe(9);
    // A torch watching the campfire: normal 2.5s pace.
    const lit = mkThief();
    lit.world.addTorchlight(2, 0, 2);
    for (let i = 0; i < 60 * 1.6; i++) lit.world.update(1 / 60, [], lit.colony);
    expect(lit.colony.resources.berries).toBe(10);
  });
});

// ─── 5. Bug fix: toon-material roughness ─────────────────────────────────────

describe('bug fix: roughness on MeshToonMaterial', () => {
  let warns;
  let errors;
  let origWarn;
  let origError;

  const spy = () => {
    warns = [];
    errors = [];
    origWarn = console.warn;
    origError = console.error;
    console.warn = (...a) => { warns.push(a.join(' ')); };
    console.error = (...a) => { errors.push(a.join(' ')); };
  };
  const unspy = () => {
    console.warn = origWarn;
    console.error = origError;
  };

  afterEach(() => {
    // Safety: never leak the spy into other suites.
    if (origWarn && console.warn !== origWarn) console.warn = origWarn;
    if (origError && console.error !== origError) console.error = origError;
  });

  it('building the Meadowlands emits no material warnings', () => {
    spy();
    try {
      const scene = new THREE.Scene();
      new Meadowlands(null, scene);
    } finally {
      unspy();
    }
    expect(warns.filter(w => w.includes('not a property'))).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('the arena ball-pit material emits no material warnings', () => {
    spy();
    let mat;
    try {
      // Instantiate exactly what the mega-stadium theme builder uses.
      mat = ballPitMaterial();
    } finally {
      unspy();
    }
    expect(mat).toBeDefined();
    expect(warns.filter(w => w.includes('not a property'))).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('the spy is sensitive: roughness on a toon material really does warn', () => {
    spy();
    try {
      new THREE.MeshToonMaterial({ color: 0xffffff, roughness: 0.3 });
    } finally {
      unspy();
    }
    expect(warns.some(w => w.includes("'roughness' is not a property"))).toBe(true);
  });
});

// ─── 6. Bug fix: citizen corner sticking ─────────────────────────────────────

describe('bug fix: citizen pathfinding at sharp building corners', () => {
  it('a citizen wedged against a corner sidesteps and rounds it', () => {
    const dweeb = fakeDweeb('Stuck', 0, 0, 0);
    const c = new Citizen(dweeb, { personality: { id: 't', name: 'T', curiosityBias: 1, bravery: 1 } });
    c.state = CITIZEN_STATES.WANDER;
    c.stateTimer = 1e9; // never re-pick a goal mid-test
    c.targetPos.set(12, 0.5, 0);
    c.lastPos.set(0, 0, 0);
    const world = fakeWorld();
    const dt = 1 / 60;

    // A sharp building corner: a wall segment at x = 5 spanning z in (-1, 1).
    // Pushing straight into it makes no progress; lateral motion slides along.
    const step = dt => {
      c.update(dt, world, [], null);
      // The stuck detector re-picks goals every ~2.5s of slow walking (existing
      // behavior); pin the goal back so the test measures the sidestep, not
      // goal selection.
      if (c.state !== CITIZEN_STATES.WANDER || Math.abs(c.targetPos.x - 12) > 0.01) {
        c.state = CITIZEN_STATES.WANDER;
        c.targetPos.set(12, 0.5, 0);
        c.stateTimer = 1e9;
      }
      const inp = dweeb.controllerInput || { moveX: 0, moveY: 0 };
      const p = dweeb.body._p;
      const nx = p.x + inp.moveX * 4.2 * dt;
      const nz = p.z + (-inp.moveY) * 4.2 * dt;
      if (Math.abs(nz) < 1 && p.x < 5 && nx >= 5) {
        p.x = 5; // blocked by the corner
      } else {
        p.x = nx;
        p.z = nz;
      }
    };

    for (let i = 0; i < 60 * 12; i++) step(dt);

    expect(c.unstuckCount).toBeGreaterThanOrEqual(1); // the sidestep fired
    const p = dweeb.body._p;
    const distToTarget = Math.hypot(12 - p.x, 0 - p.z);
    expect(distToTarget).toBeLessThan(3); // rounded the corner, nearly there
  });
});

// ─── 7. Bug fix: corrupt-save persistence ────────────────────────────────────

describe('bug fix: corrupt / missing saves never freeze boot', () => {
  it('loadVillage returns null for corrupt, missing, wrong-version and non-object saves', () => {
    const s = fakeStorage();
    expect(loadVillage(s)).toBeNull(); // missing key
    s.setItem(SAVE_KEY, '{ this is not json');
    expect(loadVillage(s)).toBeNull(); // corrupt JSON
    s.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION + 99, colony: {} }));
    expect(loadVillage(s)).toBeNull(); // wrong version
    s.setItem(SAVE_KEY, '42');
    expect(loadVillage(s)).toBeNull(); // valid JSON, not a save object
    s.setItem(SAVE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadVillage(s)).toBeNull(); // arrays are not saves
  });

  it('a healthy save still loads', () => {
    const s = fakeStorage();
    const scene = new THREE.Scene();
    const world = new Meadowlands(null, scene);
    const colony = new Colony();
    saveVillage({ colony, buildingManager: null, world }, s);
    const data = loadVillage(s);
    expect(data).not.toBeNull();
    expect(data.version).toBe(SAVE_VERSION);
  });

  it('applySave skips malformed structure entries and never throws', () => {
    const scene = new THREE.Scene();
    const world = new Meadowlands(null, scene);
    const bm = new BuildingManager(scene, null);
    const colony = new Colony();
    const save = {
      version: SAVE_VERSION,
      colony: { citizens: [null, 'junk', { name: 'Fine' }], resources: null },
      structures: [
        null,
        { id: 42 },
        { nope: true },
        { id: 'tent', x: 1, y: 0, z: 1 }, // the one good entry
      ],
      world: null,
    };
    let summary;
    expect(() => {
      summary = applySave(save, { colony, buildingManager: bm, world });
    }).not.toThrow();
    expect(summary.structures).toBe(1);
    expect(summary.errors).toBe(3);
  });

  it('applySave survives throwing restore / placeSaved implementations', () => {
    const badColony = { restore() { throw new Error('bad colony'); }, citizens: [], resources: {} };
    const badBm = { placeSaved() { throw new Error('bad bm'); } };
    const badWorld = { restore() { throw new Error('bad world'); } };
    let summary;
    expect(() => {
      summary = applySave(
        { version: SAVE_VERSION, colony: {}, structures: [{ id: 'tent' }], world: {} },
        { colony: badColony, buildingManager: badBm, world: badWorld },
      );
    }).not.toThrow();
    expect(summary.errors).toBe(3);
    expect(summary.structures).toBe(0);
  });

  it('applySave on a nullish save returns an empty summary without throwing', () => {
    expect(applySave(null, {})).toEqual({ citizens: 0, structures: 0, gold: 0, errors: 0 });
    expect(applySave('junk', {})).toEqual({ citizens: 0, structures: 0, gold: 0, errors: 0 });
  });
});
