// adventure-building.test.js — Expedition & Dynasty structures.
// Headless: real THREE scene graph, fake scene/physics/colony where the game
// would hand over a renderer and a Rapier world.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BLUEPRINTS, BuildingManager, SILO_CAP_BONUS, SILO_CAPACITY } from '../src/adventure/building.js';
import { Colony } from '../src/adventure/colony.js';

const fakeScene = () => ({ add() {}, remove() {} });
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
const fakePhysics = () => ({
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

function setup() {
  const bm = new BuildingManager(fakeScene(), fakePhysics());
  const colony = new Colony();
  colony.resources = { wood: 50, berries: 50, stone: 50, gold: 0 };
  // These tests exercise the construction mechanics, not tier gating —
  // unlock every blueprint so landmark placement is allowed.
  for (const bp of BLUEPRINTS) colony.unlockBlueprint(bp.id);
  const world = {
    springPads: [],
    ziplines: [],
    berryBushes: [{ x: 0, y: 0, z: 0, available: 5 }],
    critters: [],
    buildingManager: bm,
    addTorchlight() { return null; },
    _pushStunt() {},
    removeCritter(c) {
      const i = this.critters.indexOf(c);
      if (i !== -1) this.critters.splice(i, 1);
    },
  };
  return { bm, colony, world };
}

function place(bm, colony, world, id, x = 10, y = 0, z = 10) {
  bm.activeBlueprint = BLUEPRINTS.find(b => b.id === id);
  bm.isValidPlacement = true;
  bm.placementPos.set(x, y, z);
  const res = bm.confirmPlacement(colony, world);
  expect(res && res.success).toBe(true);
  return res.structure;
}

describe('blueprints', () => {
  it('has all 16 blueprints (5 original + 5 Expedition & Dynasty + 6 ToyTown landmarks)', () => {
    expect(BLUEPRINTS.length).toBe(16);
    for (const id of ['springboard', 'ramp', 'tent', 'firepit', 'catapult',
      'launchpad', 'ziptower', 'berrymill', 'silo', 'cannon',
      'windmill', 'watchtower', 'gazebo', 'clockwork', 'waterwheel', 'fort']) {
      expect(BLUEPRINTS.some(b => b.id === id), id).toBe(true);
    }
  });

  it('every blueprint has a name, icon, description and non-negative costs', () => {
    for (const bp of BLUEPRINTS) {
      expect(bp.name.length).toBeGreaterThan(0);
      expect(bp.icon.length).toBeGreaterThan(0);
      expect(bp.desc.length).toBeGreaterThan(0);
      for (const [res, n] of Object.entries(bp.cost)) {
        expect(['wood', 'berries', 'stone']).toContain(res);
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('startPlacing rejects unknown blueprints', () => {
    const { bm } = setup();
    expect(bm.startPlacing('nope')).toBe(false);
    expect(bm.startPlacing('launchpad')).toBe(true);
    expect(bm.activeBlueprint.id).toBe('launchpad');
  });
});

describe('placement & costs', () => {
  it('deducts the blueprint cost and registers the structure', () => {
    const { bm, colony, world } = setup();
    const before = colony.resources.wood;
    place(bm, colony, world, 'launchpad');
    expect(colony.resources.wood).toBe(before - 2);
    expect(bm.placedStructures.length).toBe(1);
  });

  it('refuses placement when resources are short and deducts nothing', () => {
    const { bm, colony, world } = setup();
    colony.resources.wood = 0;
    bm.activeBlueprint = BLUEPRINTS.find(b => b.id === 'cannon');
    bm.isValidPlacement = true;
    bm.placementPos.set(1, 0, 1);
    const res = bm.confirmPlacement(colony, world);
    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/wood/);
    expect(colony.resources.wood).toBe(0);
    expect(bm.placedStructures.length).toBe(0);
  });

  it('returns null when nothing is being placed', () => {
    const { bm, colony, world } = setup();
    expect(bm.confirmPlacement(colony, world)).toBeNull();
  });
});

describe('launchpad', () => {
  it('registers a hotter springpad that also launches items', () => {
    const { bm, colony, world } = setup();
    place(bm, colony, world, 'launchpad', 5, 0, 5);
    expect(world.springPads.length).toBe(1);
    const pad = world.springPads[0];
    expect(pad.boostVelocity).toBe(22);
    expect(pad.radius).toBe(2.0);
    expect(pad.launchesItems).toBe(true);
  });
});

describe('ziptower + zipline', () => {
  it('registers a zipline from the tower top toward the village', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'ziptower', 20, 0, 0);
    expect(world.ziplines.length).toBe(1);
    const line = world.ziplines[0];
    expect(s.zipline).toBe(line);
    expect(line.from.y).toBeCloseTo(6.4);
    expect(line.length).toBeGreaterThan(10);
    expect(line.speed).toBe(14);
    // The wire runs from the tower toward the village centre.
    expect(line.to.x).toBeLessThan(line.from.x);
  });

  it('a Dweeb on the platform grabs the wire and slides to the anchor', () => {
    const { bm, colony, world } = setup();
    place(bm, colony, world, 'ziptower', 20, 0, 0);
    const line = world.ziplines[0];
    const rider = { body: fakeBody(line.from.x, line.from.y, line.from.z) };
    const player = { body: fakeBody(0, 1, 0) };
    const ctx = { dweebs: [rider], colony, world };
    bm.update(1 / 60, player, null, ctx);
    expect(rider._ziplineRide).toBeDefined();
    // Ride it out: ~1s at speed 14 over a ~13m wire.
    for (let i = 0; i < 120; i++) bm.update(1 / 60, player, null, ctx);
    expect(rider._ziplineRide).toBeNull();
    const p = rider.body.translation();
    expect(Math.hypot(p.x - line.to.x, p.z - line.to.z)).toBeLessThan(2);
  });
});

describe('berrymill', () => {
  it('spins its blades and gathers berries from nearby bushes', () => {
    const { bm, colony, world } = setup();
    world.berryBushes = [{ x: 11, y: 0, z: 10, available: 5 }];
    const s = place(bm, colony, world, 'berrymill', 10, 0, 10);
    const before = colony.resources.berries;
    const spin0 = s.blades.rotation.z;
    for (let i = 0; i < 60 * 5; i++) bm.update(1 / 60, null, null, { dweebs: [], colony, world });
    expect(s.blades.rotation.z).toBeGreaterThan(spin0);
    expect(world.berryBushes[0].available).toBeLessThan(5);
    expect(s.gatheredTotal).toBeGreaterThan(0);
    expect(colony.resources.berries).toBeGreaterThan(before);
  });

  it('ignores bushes out of range', () => {
    const { bm, colony, world } = setup();
    world.berryBushes = [{ x: 100, y: 0, z: 100, available: 5 }];
    const s = place(bm, colony, world, 'berrymill', 10, 0, 10);
    for (let i = 0; i < 60 * 5; i++) bm.update(1 / 60, null, null, { dweebs: [], colony, world });
    expect(s.gatheredTotal).toBe(0);
    expect(world.berryBushes[0].available).toBe(5);
  });
});

describe('silo', () => {
  it('stores and returns resources up to its capacity', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'silo', 10, 0, 10);
    expect(s.capacity).toBe(SILO_CAPACITY);
    expect(s.deposit('wood', 10)).toBe(10);
    expect(s.stored.wood).toBe(10);
    expect(s.deposit('wood', 100)).toBe(SILO_CAPACITY - 10);
    expect(s.withdraw('wood', 4)).toBe(4);
    expect(s.stored.wood).toBe(SILO_CAPACITY - 4);
    expect(s.withdraw('wood', 999)).toBe(SILO_CAPACITY - 4);
    expect(s.stored.wood).toBe(0);
    expect(s.deposit('gold', 5)).toBe(0); // only wood/berries/stone
  });

  it('raises the colony storage caps on placement', () => {
    const { bm, colony, world } = setup();
    const before = colony.storageCap.wood;
    place(bm, colony, world, 'silo', 10, 0, 10);
    expect(colony.storageCap.wood).toBe(before + SILO_CAP_BONUS);
    expect(colony.storageCap.berries).toBe(before + SILO_CAP_BONUS);
  });

  it('overflow from a full colony pool lands in the silo, not the void', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'silo', 10, 0, 10);
    colony.resources.berries = colony.storageCap.berries;
    const res = colony.addResource('berries', 7, [s]);
    expect(res.added).toBe(0);
    expect(res.overflowStored).toBe(7);
    expect(res.overflowLost).toBe(0);
    expect(s.stored.berries).toBe(7);
  });

  it('without a silo the overflow is lost', () => {
    const { colony } = setup();
    colony.resources.berries = colony.storageCap.berries;
    const res = colony.addResource('berries', 7, []);
    expect(res.overflowLost).toBe(7);
  });
});

describe('cannon', () => {
  it('fires plush balls at critters in range and pops them for gold', () => {
    const { bm, colony, world } = setup();
    place(bm, colony, world, 'cannon', 0, 0, 0);
    const critter = { x: 8, y: 0, z: 0, hp: 2, speed: 2, mesh: null };
    world.critters.push(critter);
    const gold0 = colony.resources.gold;
    // Fire twice (1.4s interval) and fly the balls home.
    for (let i = 0; i < 60 * 6; i++) bm.update(1 / 60, null, null, { dweebs: [], colony, world });
    expect(world.critters.length).toBe(0); // popped by two balls
    expect(colony.resources.gold).toBe(gold0 + 1);
  });

  it('holds fire when no critters are around', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'cannon', 0, 0, 0);
    for (let i = 0; i < 60 * 3; i++) bm.update(1 / 60, null, null, { dweebs: [], colony, world });
    expect(s.projectiles.length).toBe(0);
  });

  it('holds fire at critters beyond its range', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'cannon', 0, 0, 0);
    world.critters.push({ x: 40, y: 0, z: 0, hp: 2, speed: 2, mesh: null });
    for (let i = 0; i < 60 * 3; i++) bm.update(1 / 60, null, null, { dweebs: [], colony, world });
    expect(s.projectiles.length).toBe(0);
    expect(world.critters.length).toBe(1);
  });
});

describe('serialize / placeSaved / destroy', () => {
  it('round-trips every new structure through save data', () => {
    const { bm, colony, world } = setup();
    for (const id of ['launchpad', 'ziptower', 'berrymill', 'silo', 'cannon']) {
      place(bm, colony, world, id, 10 + Math.random() * 5, 0, 10);
    }
    const saved = bm.placedStructures.map(s => s.serialize());
    expect(saved.length).toBe(5);
    const bm2 = new BuildingManager(fakeScene(), fakePhysics());
    const world2 = { springPads: [], ziplines: [], berryBushes: [], critters: [], buildingManager: bm2, addTorchlight() {} };
    for (const data of saved) bm2.placeSaved(data, world2, colony);
    expect(bm2.placedStructures.map(s => s.id).sort()).toEqual(
      ['berrymill', 'cannon', 'launchpad', 'silo', 'ziptower']
    );
    expect(world2.springPads.length).toBe(1);
    expect(world2.ziplines.length).toBe(1);
  });

  it('destroyStructure removes the structure and its projectiles', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'cannon', 0, 0, 0);
    expect(bm.destroyStructure(s, colony)).toBe(true);
    expect(bm.placedStructures.length).toBe(0);
    expect(bm.destroyStructure(s, colony)).toBe(false);
  });

  it('THREE import sanity: structures build real scene groups', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'ziptower', 5, 0, 5);
    expect(s.group).toBeInstanceOf(THREE.Group);
    expect(s.group.children.length).toBeGreaterThan(5);
    expect(s.colliders.length).toBeGreaterThan(0);
  });
});

describe('ToyTown landmarks (merged catalog)', () => {
  it('the six catalog landmarks are blueprints with kind landmark', () => {
    for (const id of ['windmill', 'watchtower', 'gazebo', 'clockwork', 'waterwheel', 'fort']) {
      const bp = BLUEPRINTS.find(b => b.id === id);
      expect(bp, id).toBeDefined();
      expect(bp.kind).toBe('landmark');
    }
  });

  it('placing a landmark builds a toy structure with a serialize round-trip', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'fort', 10, 0, 10);
    expect(s.toy).toBeDefined();
    expect(s.group).toBeInstanceOf(THREE.Group);
    expect(s.serialize()).toEqual({ id: 'fort', x: 10, y: 0, z: 10 });
    // Restore it elsewhere via placeSaved.
    const bm2 = new BuildingManager(fakeScene(), fakePhysics());
    const restored = bm2.placeSaved(s.serialize(), world, colony);
    expect(restored.id).toBe('fort');
    expect(restored.toy).toBeDefined();
    expect(bm2.placedStructures.length).toBe(1);
  });

  it('updatePlaced advances landmark mechanisms without throwing', () => {
    const { bm, colony, world } = setup();
    place(bm, colony, world, 'windmill', -10, 0, -10);
    place(bm, colony, world, 'watchtower', 10, 0, 10);
    expect(() => bm.updatePlaced(1 / 60, [])).not.toThrow();
    expect(() => bm.updatePlaced(1 / 60, [])).not.toThrow();
  });

  it('destroyStructure disposes a landmark toy', () => {
    const { bm, colony, world } = setup();
    const s = place(bm, colony, world, 'gazebo', 0, 0, 0);
    expect(bm.destroyStructure(s, colony)).toBe(true);
    expect(bm.placedStructures.length).toBe(0);
  });
});
