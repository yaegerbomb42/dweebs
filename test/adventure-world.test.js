// adventure-world.test.js — toy-ruin vaults, day/night cycle, fireflies,
// torchlights, critters and berry regrowth in the real Meadowlands.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Meadowlands, HAT_POOL, TOOL_POOL, MAX_TORCHLIGHTS } from '../src/world/Meadowlands.js';
import { Colony } from '../src/adventure/colony.js';

function fakeBody(x, y, z) {
  return {
    _p: { x, y, z },
    _v: { x: 0, y: 0, z: 0 },
    translation() { return this._p; },
    linvel() { return this._v; },
    setLinvel(v) { this._v = { ...v }; },
    setTranslation(p) { this._p = { ...p }; },
  };
}

function fakeDweeb(x, y, z) {
  return { body: fakeBody(x, y, z) };
}

function worldWithColony() {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);
  const colony = new Colony();
  return { world, colony, scene };
}

describe('toy ruins & vaults', () => {
  it('the world has four ruin sites: two plate trials, a bounce gauntlet and a sentry vault', () => {
    const { world } = worldWithColony();
    expect(world.ruins.length).toBe(4);
    const kinds = world.ruins.map(r => r.kind).sort();
    expect(kinds).toEqual(['bounce', 'guard', 'plates', 'plates']);
    for (const ruin of world.ruins) {
      expect(ruin.opened).toBe(false);
      expect(ruin.vault).toBeDefined();
      expect(HAT_POOL).toContain(ruin.loot.hat);
      expect(TOOL_POOL).toContain(ruin.loot.tool);
      expect(ruin.loot.coins).toBeGreaterThanOrEqual(15);
    }
    for (const ruin of world.ruins.filter(r => r.kind === 'plates')) {
      expect(ruin.plates.length).toBe(3);
    }
    expect(world.ruins.find(r => r.kind === 'bounce').plates.length).toBe(0);
    expect(world.ruins.find(r => r.kind === 'guard').plates.length).toBe(0);
  });

  it('standing on all three plates at once opens the vault and pays out loot', () => {
    const { world, colony } = worldWithColony();
    const ruin = world.ruins[0];
    const dweebs = ruin.plates.map(p => fakeDweeb(p.x, p.y, p.z));
    const gold0 = colony.resources.gold;
    world.update(1 / 60, dweebs, colony);
    expect(ruin.opened).toBe(true);
    expect(colony.resources.gold).toBeGreaterThan(gold0);
    expect(colony.hats.length).toBe(1);
    expect(colony.tools.length).toBe(1);
    expect(colony.historyLog[0].text).toMatch(/vault opened/);
    // The lid slides open over the next seconds.
    for (let i = 0; i < 60 * 3; i++) world.update(1 / 60, dweebs, colony);
    expect(ruin.progress).toBe(1);
    expect(ruin.vault.glow.intensity).toBeGreaterThan(0);
  });

  it('two plates are not enough — the vault stays shut', () => {
    const { world, colony } = worldWithColony();
    const ruin = world.ruins[0];
    const dweebs = ruin.plates.slice(0, 2).map(p => fakeDweeb(p.x, p.y, p.z));
    world.update(1 / 60, dweebs, colony);
    expect(ruin.opened).toBe(false);
    expect(colony.hats.length).toBe(0);
  });

  it('the original two-plate gate puzzle still works unchanged', () => {
    const { world } = worldWithColony();
    expect(world.pressurePlates.length).toBe(2);
    const dweebs = world.pressurePlates.map(p => fakeDweeb(p.x, p.y, p.z));
    world.update(1 / 60, dweebs, null);
    expect(world.gateState.isOpen).toBe(true);
  });
});

describe('day / night cycle', () => {
  it('time advances and wraps around a full day', () => {
    const { world } = worldWithColony();
    expect(world.timeOfDay).toBe(8);
    world.update(120, [], null); // half a day
    expect(world.timeOfDay).toBeCloseTo(20, 5);
    world.update(120, [], null);
    expect(world.timeOfDay).toBeCloseTo(8, 5);
  });

  it('midday is bright, midnight is dark', () => {
    const { world } = worldWithColony();
    world.timeOfDay = 12;
    world.update(0.1, [], null);
    expect(world.lightLevel).toBe(1);
    expect(world.isNight).toBe(false);
    world.timeOfDay = 0;
    world.update(0.1, [], null);
    expect(world.lightLevel).toBe(0);
    expect(world.isNight).toBe(true);
  });

  it('the sun dims at night and warms at dusk', () => {
    const { world } = worldWithColony();
    world.timeOfDay = 12;
    world.update(0.1, [], null);
    const dayIntensity = world.dayLight.intensity;
    world.timeOfDay = 0;
    world.update(0.1, [], null);
    expect(world.dayLight.intensity).toBeLessThan(dayIntensity);
  });

  it('fireflies glow at night and vanish by day', () => {
    const { world } = worldWithColony();
    world.timeOfDay = 0;
    world.update(0.1, [], null);
    expect(world.fireflies.material.opacity).toBeCloseTo(0.9, 5);
    world.timeOfDay = 12;
    world.update(0.1, [], null);
    expect(world.fireflies.material.opacity).toBe(0);
  });
});

describe('torchlights', () => {
  it('torches are capped so a big village stays fast', () => {
    const { world } = worldWithColony();
    for (let i = 0; i < MAX_TORCHLIGHTS + 5; i++) {
      world.addTorchlight(i, 0, 0);
    }
    expect(world.torchlights.length).toBe(MAX_TORCHLIGHTS);
    expect(world.addTorchlight(99, 0, 0)).toBeNull();
  });

  it('torches burn brighter at night', () => {
    const { world } = worldWithColony();
    world.addTorchlight(2, 0, 2);
    world.timeOfDay = 12;
    world.update(0.1, [], null);
    const day = world.torchlights[0].light.intensity;
    world.timeOfDay = 0;
    world.update(0.1, [], null);
    expect(world.torchlights[0].light.intensity).toBeGreaterThan(day);
  });
});

describe('critters', () => {
  it('critters wander in on a timer and march on the village', () => {
    const { world } = worldWithColony();
    expect(world.critters.length).toBe(0);
    world.critterTimer = 0.01;
    world.update(0.1, [], null);
    expect(world.critters.length).toBe(1);
    const c = world.critters[0];
    const d0 = Math.hypot(c.x, c.z);
    for (let i = 0; i < 60; i++) world.update(1 / 60, [], null);
    expect(Math.hypot(c.x, c.z)).toBeLessThan(d0);
  });

  it('a critter that reaches the campfire steals a berry and flees', () => {
    const { world, colony } = worldWithColony();
    colony.resources.berries = 10;
    const c = world.spawnCritter();
    c.x = 1; c.z = 1; // already at the fire
    c.state = 'approach';
    for (let i = 0; i < 60 * 4; i++) world.update(1 / 60, [], colony);
    expect(colony.resources.berries).toBe(9);
    expect(c.state).toBe('flee');
  });

  it('a critter chews a barricade instead of walking through it', () => {
    const { world, colony } = worldWithColony();
    const cannon = { id: 'cannon', pos: { x: 0, y: 0, z: 0 }, hp: 60 };
    world.buildingManager = {
      placedStructures: [cannon],
      destroyStructure(s) {
        const i = this.placedStructures.indexOf(s);
        if (i !== -1) this.placedStructures.splice(i, 1);
      },
    };
    const c = world.spawnCritter();
    c.x = 1; c.z = 0; // right next to the barricade
    for (let i = 0; i < 60 * 2; i++) world.update(1 / 60, [], colony);
    expect(cannon.hp).toBeLessThan(60);
    expect(c.chewTarget).toBe(cannon);
  });

  it('removeCritter takes a critter (and its mesh) out of the world', () => {
    const { world } = worldWithColony();
    const c = world.spawnCritter();
    world.removeCritter(c);
    expect(world.critters.length).toBe(0);
    expect(world.group.children).not.toContain(c.mesh);
  });
});

describe('berry regrowth & launchpads', () => {
  it('picked bushes regrow one berry every 20 seconds', () => {
    const { world } = worldWithColony();
    const bush = world.berryBushes[0];
    bush.available = 0;
    world.update(19, [], null);
    expect(bush.available).toBe(0);
    world.update(2, [], null);
    expect(bush.available).toBe(1);
  });

  it('a launchpad flings loose props, not just Dweebs', () => {
    const { world } = worldWithColony();
    const pad = { x: 0, y: 0, z: 0, radius: 2.0, boostVelocity: 22, mesh: { scale: { set() {} } }, rebound: 0, launchesItems: true };
    world.springPads.push(pad);
    const prop = { body: fakeBody(0, 0, 0) };
    world.looseProps.push(prop);
    world.update(1 / 60, [], null);
    expect(prop.body.linvel().y).toBe(22);
  });

  it('a springpad bounce lands on the stunt feed for citizens to react to', () => {
    const { world } = worldWithColony();
    const pad = world.springPads[0]; // the ruin bounce altar
    const d = fakeDweeb(pad.x, pad.y, pad.z);
    world.update(1 / 60, [d], null);
    expect(world.stuntFeed.length).toBeGreaterThan(0);
    expect(world.stuntFeed[0].type).toBe('bounce');
  });
});

describe('world serialize / restore', () => {
  it('round-trips time of day and opened vaults', () => {
    const { world } = worldWithColony();
    world.timeOfDay = 21.5;
    world.ruins[1].opened = true;
    const data = world.serialize();
    const scene2 = new THREE.Scene();
    const world2 = new Meadowlands(null, scene2);
    world2.restore(data);
    expect(world2.timeOfDay).toBe(21.5);
    expect(world2.ruins[1].opened).toBe(true);
    expect(world2.ruins[1].progress).toBe(1);
    expect(world2.ruins[0].opened).toBe(false);
  });
});

/** Physics stub shaped like the real PhysicsWorld: { id, body, collider }. */
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
const toyPhysics = () => ({
  createFixedCylinder: () => fakePhysReg('cyl'),
  createStaticBox: () => fakePhysReg('box'),
  createStaticBoxRotated: () => fakePhysReg('box-rot'),
  createFixedCone: () => fakePhysReg('cone'),
  createKinematicShape: () => fakePhysReg('kin'),
  createKinematicBox: () => fakePhysReg('kin-box'),
  createDynamicBody: () => ({ body: fakePhysBody() }),
  applyImpulse: () => {},
  removeBody: () => {},
  getImpacts: () => [],
});

describe('toy town district', () => {
  it('the world builds a six-landmark toy district when physics exists', () => {
    const scene = new THREE.Scene();
    const world = new Meadowlands(toyPhysics(), scene);
    expect(world.toyTown).not.toBeNull();
    expect(world.toyTown.structures.length).toBe(6);
    expect(world.toyTown.getDamaged()).toEqual([]);
  });

  it('the district updates alongside the world without throwing', () => {
    const scene = new THREE.Scene();
    const world = new Meadowlands(toyPhysics(), scene);
    const colony = new Colony();
    expect(() => world.update(1 / 60, [], colony)).not.toThrow();
  });

  it('without a physics world the district is skipped, not crashed', () => {
    const { world } = worldWithColony();
    expect(world.toyTown).toBeNull();
  });
});
