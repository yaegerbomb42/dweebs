// adventure-wave2.test.js — W4: weather system, earned expeditions, build
// claims, destroy-cleanup, silo-cap save fix, REPAIR stuck recovery.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Meadowlands } from '../src/world/Meadowlands.js';
import { Colony } from '../src/adventure/colony.js';
import { Citizen, PERSONALITIES, CITIZEN_STATES } from '../src/adventure/citizen.js';
import { BuildingManager, BLUEPRINTS } from '../src/adventure/building.js';
import { saveVillage, loadVillage, applySave } from '../src/adventure/persistence.js';

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

function fakeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); },
  };
}

function richColony() {
  const colony = new Colony();
  colony.resources = { wood: 999, berries: 999, stone: 999, gold: 0 };
  return colony;
}

function worldWithManager() {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);
  const bm = new BuildingManager(scene, null);
  world.buildingManager = bm;
  return { scene, world, bm };
}

function place(bm, colony, world, id, x, z) {
  bm.activeBlueprint = BLUEPRINTS.find(b => b.id === id);
  bm.isValidPlacement = true;
  bm.placementPos.set(x, 0, z);
  const res = bm.confirmPlacement(colony, world);
  expect(res && res.success).toBe(true);
  return res.structure;
}

/** A citizen with zeroed needs for deterministic goal selection. */
function calmCitizen(name, role = null, personalityId = null) {
  const dweeb = { name, body: fakeBody(0, 0, 0) };
  const c = new Citizen(dweeb, personalityId
    ? { personality: PERSONALITIES.find(p => p.id === personalityId) }
    : {});
  c.hunger = 0; c.energy = 100; c.curiosity = 0; c.social = 0;
  if (role) c.assignRole(role);
  return c;
}

function calmWorld() {
  const { world, bm } = worldWithManager();
  world.timeOfDay = 12;
  world.weather = 'clear';
  world.weatherTimer = 99999;
  world.toyTown = null; // no damaged landmarks in these unit tests
  return { world, bm };
}

describe('weather', () => {
  it('cycles clear -> rain|wind -> clear and logs the change', () => {
    const { world } = worldWithManager();
    const colony = richColony();
    expect(world.weather).toBe('clear');
    world.weatherTimer = 0.01;
    world.update(0.02, [], colony);
    // Merged weather: clear breaks into rain, wind (wave-2) or fog (milestone).
    expect(['rain', 'wind', 'fog', 'locusts']).toContain(world.weather); // locust swarm (#90) is a legit break too
    expect(colony.historyLog.length).toBeGreaterThan(1); // founding log + weather log
    world.weatherTimer = 0.01;
    world.update(0.02, [], colony);
    expect(world.weather).toBe('clear');
  });

  it('rain doubles berry-bush regrowth', () => {
    const mk = (weather) => {
      const { world } = worldWithManager();
      world.weather = weather;
      world.weatherTimer = 99999;
      world.critterTimer = 99999;
      const bush = { x: 0, y: 0, z: 0, berries: [], available: 0, regenTimer: 0 };
      world.berryBushes = [bush];
      return { world, bush };
    };
    const rainy = mk('rain');
    for (let i = 0; i < 11; i++) rainy.world.update(1, [], null);
    expect(rainy.bush.available).toBeGreaterThanOrEqual(1);

    const clear = mk('clear');
    for (let i = 0; i < 11; i++) clear.world.update(1, [], null);
    expect(clear.bush.available).toBe(0);
  });

  it('wind doubles the windmill gather rate', () => {
    const mk = (weather) => {
      const { world, bm } = worldWithManager();
      const colony = new Colony(); // default stores: berries 20, cap 99
      world.weather = weather;
      world.weatherTimer = 99999;
      place(bm, colony, world, 'berrymill', 0, 0);
      world.berryBushes = [{ x: 5, y: 0, z: 0, berries: [], available: 5, regenTimer: 0 }];
      return { world, bm, colony };
    };
    const windy = mk('wind');
    for (let i = 0; i < 150; i++) windy.bm.update(1 / 60, { body: fakeBody(0, 1, 0) }, null,
      { dweebs: [], colony: windy.colony, world: windy.world });

    const calm = mk('clear');
    for (let i = 0; i < 150; i++) calm.bm.update(1 / 60, { body: fakeBody(0, 1, 0) }, null,
      { dweebs: [], colony: calm.colony, world: calm.world });
    // 2.5s: wind (2x rate) passes the 4s gather threshold, clear does not.
    // (one berry per bush per gather cycle)
    expect(windy.colony.resources.berries).toBe(21);
    expect(calm.colony.resources.berries).toBe(20);
  });

  it('critters wander in faster while it rains', () => {
    const mk = (weather) => {
      const { world } = worldWithManager();
      world.weather = weather;
      world.weatherTimer = 99999;
      world.critterTimer = 10;
      world.dayCount = 1; // moonPhase 1: neutral moon, so only weather varies
      return world;
    };
    const rainy = mk('rain');
    const clear = mk('clear');
    for (let i = 0; i < 5; i++) { rainy.update(1, [], null); clear.update(1, [], null); }
    expect(rainy.critterTimer).toBeLessThan(clear.critterTimer);
    expect(clear.critterTimer).toBeCloseTo(5, 5);
  });

  it('weather round-trips through save/restore; junk is ignored', () => {
    const { world } = worldWithManager();
    world.weather = 'wind';
    const data = world.serialize();
    expect(data.weather).toBe('wind');
    const w2 = new Meadowlands(null, new THREE.Scene());
    w2.restore(data);
    expect(w2.weather).toBe('wind');
    w2.restore({ weather: 'meteor-storm' });
    expect(w2.weather).toBe('wind');
  });

  it('cozy citizens shelter from rain; only the brave explore in it', () => {
    const { world } = worldWithManager();
    world.weather = 'rain';
    world.timeOfDay = 12;
    world.toyTown = null;

    const cozy = calmCitizen('Nap', null, 'cozy');
    cozy.energy = 50;
    cozy.stateTimer = 0;
    cozy._selectNextGoal(world, [], null);
    expect(cozy.state).toBe(CITIZEN_STATES.REST);

    const timid = calmCitizen('Tim', null, 'builder'); // bravery 1.0
    timid.curiosity = 80;
    timid.stateTimer = 0;
    timid._selectNextGoal(world, [], null);
    expect(timid.state).not.toBe(CITIZEN_STATES.EXPEDITION);

    const brave = calmCitizen('Bra', null, 'adventurer'); // bravery 1.4
    brave.curiosity = 80;
    brave.stateTimer = 0;
    brave._selectNextGoal(world, [], null);
    expect(brave.state).toBe(CITIZEN_STATES.EXPEDITION);
  });
});

describe('earned expeditions', () => {
  it('launchExpedition sends a citizen out; the haul lands on arrival, not before', () => {
    const { world } = worldWithManager();
    const colony = new Colony(); // default stores, well under caps
    const before = { ...colony.resources };
    const dweeb = { name: 'Scout', body: fakeBody(0, 0, 0) };
    const citizen = colony.addCitizen(dweeb);

    colony.launchExpedition(world);
    // Nothing granted yet — the citizen has to get there first.
    expect(colony.resources).toEqual(before);
    expect(citizen._expeditionHaul).toBeTruthy();
    expect(citizen.state).toBe(CITIZEN_STATES.EXPEDITION);

    // Walk them to the destination and step the colony.
    const t = citizen.targetPos;
    dweeb.body._p = { x: t.x, y: t.y, z: t.z };
    colony.update(1 / 60, world);

    expect(citizen._expeditionHaul).toBeNull();
    expect(colony.resources.berries).toBe(before.berries + 4);
    expect(colony.resources.wood).toBe(before.wood + 2);
    expect(colony.resources.stone).toBe(before.stone + 2);
    expect(colony.resources.gold).toBe(before.gold + 1);
    expect(colony.historyLog[0].text).toContain('returned');
  });

  it('a pending haul survives interruption and resumes afterwards', () => {
    const { world } = calmWorld();
    world.berryBushes = [{ x: 2, y: 0, z: 2, berries: [], available: 5, regenTimer: 0 }];
    const colony = richColony();
    const citizen = calmCitizen('Scout');
    colony.citizens.push(citizen);

    colony.launchExpedition(world);
    expect(citizen._expeditionHaul).toBeTruthy();

    // Starving interrupts the trek…
    citizen.hunger = 95;
    citizen.stateTimer = 0;
    citizen._selectNextGoal(world, [citizen], colony);
    expect(citizen.state).toBe(CITIZEN_STATES.FORAGE);
    expect(citizen._expeditionHaul).toBeTruthy(); // haul kept

    // …and once fed, the expedition resumes.
    citizen.hunger = 0;
    citizen.stateTimer = 0;
    citizen._selectNextGoal(world, [citizen], colony);
    expect(citizen.state).toBe(CITIZEN_STATES.EXPEDITION);
    expect(citizen._expeditionHaul).toBeTruthy();
  });
});

describe('build claims', () => {
  it('two builders never claim the same blueprint', () => {
    const { world } = calmWorld();
    const colony = richColony();
    const c1 = calmCitizen('Bob1', 'builder');
    const c2 = calmCitizen('Bob2', 'builder');
    colony.citizens.push(c1, c2);
    expect(colony.queueBuild('tent')).toBe(true);

    c1._selectNextGoal(world, [c1, c2], colony);
    c2._selectNextGoal(world, [c1, c2], colony);
    expect(c1.state).toBe(CITIZEN_STATES.BUILD);
    expect(c1.targetEntity).toBe('tent');
    expect(c2.state).not.toBe(CITIZEN_STATES.BUILD);
    expect(colony._buildClaims.size).toBe(1);
  });

  it('unaffordable blueprints are not claimed', () => {
    const { world } = calmWorld();
    const colony = new Colony(); // default meager resources
    colony.resources = { wood: 0, berries: 0, stone: 0, gold: 0 };
    const c = calmCitizen('Bob', 'builder');
    colony.citizens.push(c);
    colony.queueBuild('tent'); // costs wood 3, berries 2
    c._selectNextGoal(world, [c], colony);
    expect(c.state).not.toBe(CITIZEN_STATES.BUILD);
  });

  it('the structure rises where the builder hammered', () => {
    const { world, bm } = calmWorld();
    const colony = richColony();
    const c = calmCitizen('Bob', 'builder');
    colony.citizens.push(c);
    colony.queueBuild('tent');
    c._selectNextGoal(world, [c], colony);
    expect(c.state).toBe(CITIZEN_STATES.BUILD);

    const done = colony._completeBuild('tent', world, c.targetPos, c);
    expect(done).toBe(true);
    expect(colony.buildQueue.length).toBe(0);
    expect(colony._buildClaims.size).toBe(0);
    const tent = bm.placedStructures.find(s => s.id === 'tent');
    expect(tent).toBeTruthy();
    expect(tent.pos.x).toBeCloseTo(c.targetPos.x, 5);
    expect(tent.pos.z).toBeCloseTo(c.targetPos.z, 5);
  });
});

describe('destroyStructure cleanup (regression)', () => {
  it('demolishing a springboard removes its bounce hook', () => {
    const { world, bm } = worldWithManager();
    const colony = richColony();
    const padsBefore = world.springPads.length;
    const s = place(bm, colony, world, 'springboard', 5, 5);
    expect(world.springPads.length).toBe(padsBefore + 1);
    expect(bm.destroyStructure(s, colony)).toBe(true);
    expect(world.springPads.length).toBe(padsBefore);
    expect(world.springPads).not.toContain(s.springPad);
  });

  it('demolishing a ziptower removes its ghost zipline', () => {
    const { world, bm } = worldWithManager();
    const colony = richColony();
    expect(world.ziplines.length).toBe(0);
    const t = place(bm, colony, world, 'ziptower', -5, -5);
    expect(world.ziplines.length).toBe(1);
    expect(bm.destroyStructure(t, colony)).toBe(true);
    expect(world.ziplines.length).toBe(0);
  });

  it('demolishing a launchpad removes its prop-flinging hook', () => {
    const { world, bm } = worldWithManager();
    const colony = richColony();
    const padsBefore = world.springPads.length;
    const s = place(bm, colony, world, 'launchpad', 7, -3);
    expect(world.springPads.length).toBe(padsBefore + 1);
    expect(bm.destroyStructure(s, colony)).toBe(true);
    expect(world.springPads.length).toBe(padsBefore);
  });
});

describe('silo cap save round-trip (regression)', () => {
  it('storage caps are not double-counted after a load', () => {
    const { world, bm } = worldWithManager();
    const colony = richColony();
    place(bm, colony, world, 'silo', 5, 5);
    expect(colony.storageCap.wood).toBe(99 + 50);

    const storage = fakeStorage();
    saveVillage({ colony, buildingManager: bm, world }, storage);

    const w2 = new Meadowlands(null, new THREE.Scene());
    const bm2 = new BuildingManager(new THREE.Scene(), null);
    w2.buildingManager = bm2;
    const colony2 = new Colony();
    applySave(loadVillage(storage), { colony: colony2, buildingManager: bm2, world: w2 });
    // Was 199 before the fix (saved 149 restored, then +50 again per silo).
    expect(colony2.storageCap.wood).toBe(149);
    expect(colony2.storageCap.berries).toBe(149);
    expect(colony2.storageCap.stone).toBe(149);
    expect(colony2.storageCap.gold).toBe(999);
  });
});

describe('REPAIR stuck recovery (regression)', () => {
  it('a repair worker that cannot reach its landmark re-evaluates instead of freezing', () => {
    const { world } = calmWorld();
    const c = calmCitizen('Fix');
    c.state = CITIZEN_STATES.REPAIR;
    c.stateTimer = 25;
    // Landmark 70m away; the body never moves (blocked path).
    c.targetEntity = { name: 'Old Fort', repairStep: () => true };
    c.targetPos.set(50, 0, 50);
    c.lastPos.set(0, 0, 0);

    for (let i = 0; i < 60; i++) c.update(1 / 60, world, [], null);
    expect(c.state).toBe(CITIZEN_STATES.REPAIR); // not stuck yet at 1s

    for (let i = 0; i < 180; i++) c.update(1 / 60, world, [], null);
    // Stuck detection fired (~2.5s), forced a re-pick: worker moved on.
    expect(c.state).not.toBe(CITIZEN_STATES.REPAIR);
  });
});

describe('citizen movement direction (regression)', () => {
  it('walks toward its target on both axes — no mirrored Z', () => {
    const { world } = calmWorld();
    // A real Dweeb applies moveInput world-frame (tz = y * speed), so the
    // harness moves the body exactly like Dweeb.js does.
    const body = fakeBody(0, 0, 0);
    const dweeb = {
      name: 'Walker', body,
      moveInput: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
    };
    const c = new Citizen(dweeb, {});
    c.hunger = 0; c.energy = 100; c.curiosity = 0; c.social = 0;
    c.state = CITIZEN_STATES.WANDER;
    c.stateTimer = 60; // no re-selection during the walk
    // Pure +Z target: the axis the old -dirZ code walked away from.
    c.targetPos.set(0, 0, 10);

    const dist = () => Math.hypot(c.targetPos.x - body._p.x, c.targetPos.z - body._p.z);
    const start = dist();
    for (let i = 0; i < 300; i++) {
      c.update(1 / 60, world, [], null);
      body._p.x += dweeb.moveInput.x * 4.2 * (1 / 60);
      body._p.z += dweeb.moveInput.y * 4.2 * (1 / 60);
      if (dist() <= c.arrivalDist) break;
    }
    // With the old code the citizen walked to z=-10 and never arrived.
    expect(dist()).toBeLessThan(start);
    expect(dist()).toBeLessThanOrEqual(c.arrivalDist);
  });

  it('reaches a diagonal target too', () => {
    const { world } = calmWorld();
    const body = fakeBody(-6, 0, 4);
    const dweeb = {
      name: 'Walker', body,
      moveInput: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
    };
    const c = new Citizen(dweeb, {});
    c.hunger = 0; c.energy = 100; c.curiosity = 0; c.social = 0;
    c.state = CITIZEN_STATES.WANDER;
    c.stateTimer = 60;
    c.targetPos.set(6, 0, -8);

    const dist = () => Math.hypot(c.targetPos.x - body._p.x, c.targetPos.z - body._p.z);
    for (let i = 0; i < 600; i++) {
      c.update(1 / 60, world, [], null);
      body._p.x += dweeb.moveInput.x * 4.2 * (1 / 60);
      body._p.z += dweeb.moveInput.y * 4.2 * (1 / 60);
      if (dist() <= c.arrivalDist) break;
    }
    expect(dist()).toBeLessThanOrEqual(c.arrivalDist);
  });
});

describe('forage give-up (regression)', () => {
  it('stops ping-ponging between picked-clean bushes', () => {
    const { world } = calmWorld();
    const bush = { x: 5, y: 0, z: 5, berries: [], available: 0, regenTimer: 0 };
    world.berryBushes = [bush];
    const body = fakeBody(5, 0, 5);
    const dweeb = { name: 'Hungry', body };
    const c = new Citizen(dweeb, {});
    c.hunger = 95;
    c.energy = 100; c.curiosity = 0; c.social = 0;

    // Several seconds of arriving at a bare bush…
    for (let i = 0; i < 12; i++) c.update(0.5, world, [], null);
    // …and the citizen takes a break instead of looping FORAGE forever.
    expect(c._forageCooldown).toBeGreaterThan(0);

    // While the cooldown runs, hunger alone does not re-trigger foraging.
    c.stateTimer = 0;
    c._selectNextGoal(world, [], null);
    expect(c.state).not.toBe(CITIZEN_STATES.FORAGE);
  });

  it('a successful bite resets the bare-bush streak', () => {
    const { world } = calmWorld();
    const bush = { x: 5, y: 0, z: 5, berries: [], available: 2, regenTimer: 0 };
    world.berryBushes = [bush];
    const body = fakeBody(5, 0, 5);
    const dweeb = { name: 'Hungry', body };
    const c = new Citizen(dweeb, {});
    c.hunger = 95;
    c.energy = 100; c.curiosity = 0; c.social = 0;
    c.state = CITIZEN_STATES.FORAGE;
    c.targetEntity = bush;
    c.targetPos.set(5, 0, 5);
    c.stateTimer = 30;

    for (let i = 0; i < 4; i++) c.update(0.5, world, [], null);
    expect(bush.available).toBe(0); // ate both berries
    expect(c._emptyBushStreak).toBe(0);
    expect(c._forageCooldown).toBe(0);
  });
});
