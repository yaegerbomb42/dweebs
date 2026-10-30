// adventure-persistence.test.js — save/load round-trips with a fake storage.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { saveVillage, loadVillage, clearSave, applySave, SAVE_KEY } from '../src/adventure/persistence.js';
import { Colony } from '../src/adventure/colony.js';
import { BuildingManager } from '../src/adventure/building.js';
import { Meadowlands } from '../src/world/Meadowlands.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); },
    _map: map,
  };
}

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

function buildVillage() {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);
  const bm = new BuildingManager(scene, null);
  world.buildingManager = bm;
  const colony = new Colony();
  colony.addCitizen({ name: 'Blorp', body: fakeBody(0, 0, 0) });
  colony.addCitizen({ name: 'Squish', body: fakeBody(1, 0, 1) });
  return { scene, world, bm, colony };
}

function place(bm, colony, world, id, x, y, z) {
  bm.activeBlueprint = { id, cost: { wood: 0, stone: 0 } };
  bm.isValidPlacement = true;
  bm.placementPos.set(x, y, z);
  const res = bm.confirmPlacement(colony, world);
  expect(res && res.success).toBe(true);
  return res.structure;
}

describe('save / load', () => {
  it('round-trips a whole village: citizens, structures, resources, vaults', () => {
    const v = buildVillage();
    v.colony.assignRole(v.colony.citizens[0], 'forager');
    v.colony.citizens[0].hunger = 77;
    v.colony.resources.gold = 33;
    v.colony.hats.push('👑 Tin Crown');
    place(v.bm, v.colony, v.world, 'silo', 5, 0, 5);
    place(v.bm, v.colony, v.world, 'berrymill', -5, 0, -5);
    v.world.timeOfDay = 19.25;
    v.world.ruins[0].opened = true;

    const storage = fakeStorage();
    const saved = saveVillage({ colony: v.colony, buildingManager: v.bm, world: v.world }, storage);
    expect(saved.ok).toBe(true);
    expect(storage._map.has(SAVE_KEY)).toBe(true);

    // Fresh village, same Dweebs, then restore.
    const v2 = buildVillage();
    const loaded = loadVillage(storage);
    expect(loaded).not.toBeNull();
    expect(loaded.version).toBe(1);
    const summary = applySave(loaded, { colony: v2.colony, buildingManager: v2.bm, world: v2.world });
    expect(summary.citizens).toBe(2);
    expect(summary.structures).toBe(2);
    expect(summary.gold).toBe(33);
    expect(v2.colony.citizens[0].role).toBe('forager');
    expect(v2.colony.citizens[0].hunger).toBe(77);
    expect(v2.colony.hats).toEqual(['👑 Tin Crown']);
    expect(v2.bm.placedStructures.map(s => s.id).sort()).toEqual(['berrymill', 'silo']);
    expect(v2.world.timeOfDay).toBe(19.25);
    expect(v2.world.ruins[0].opened).toBe(true);
    expect(v2.world.ruins[1].opened).toBe(false);
  });

  it('a silo keeps its stored goods across a save', () => {
    const v = buildVillage();
    const s = place(v.bm, v.colony, v.world, 'silo', 5, 0, 5);
    s.deposit('wood', 12);
    const storage = fakeStorage();
    saveVillage({ colony: v.colony, buildingManager: v.bm, world: v.world }, storage);
    const v2 = buildVillage();
    applySave(loadVillage(storage), { colony: v2.colony, buildingManager: v2.bm, world: v2.world });
    const restored = v2.bm.placedStructures.find(x => x.id === 'silo');
    expect(restored.stored.wood).toBe(12);
  });

  it('loadVillage returns null when nothing was saved', () => {
    expect(loadVillage(fakeStorage())).toBeNull();
  });

  it('corrupt JSON and wrong versions are rejected, not thrown', () => {
    const storage = fakeStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(loadVillage(storage)).toBeNull();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 99, colony: {} }));
    expect(loadVillage(storage)).toBeNull();
  });

  it('saveVillage without storage reports no-storage instead of throwing', () => {
    const v = buildVillage();
    const state = { colony: v.colony, buildingManager: v.bm, world: v.world };
    expect(saveVillage(state, null)).toEqual({ ok: false, reason: 'no-storage' });
    expect(saveVillage(state, {})).toEqual({ ok: false, reason: 'no-storage' });
  });

  it('clearSave removes the save', () => {
    const v = buildVillage();
    const storage = fakeStorage();
    saveVillage({ colony: v.colony, buildingManager: v.bm, world: v.world }, storage);
    expect(loadVillage(storage)).not.toBeNull();
    expect(clearSave(storage)).toBe(true);
    expect(loadVillage(storage)).toBeNull();
  });

  it('applySave with no save is a harmless no-op', () => {
    const v = buildVillage();
    expect(applySave(null, v)).toEqual({ citizens: 0, structures: 0, gold: 0, errors: 0 });
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

describe('landmark saves', () => {
  it('a placed landmark round-trips through a save', () => {
    const scene = new THREE.Scene();
    const world = new Meadowlands(null, scene);
    const bm = new BuildingManager(scene, toyPhysics());
    world.buildingManager = bm;
    const colony = new Colony();
    colony.addCitizen({ name: 'Blorp', body: fakeBody(0, 0, 0) });
    colony.unlockBlueprint('fort'); // landmarks unlock via town tiers or vault chests
    place(bm, colony, world, 'fort', 5, 0, 5);
    const storage = fakeStorage();
    saveVillage({ colony, buildingManager: bm, world }, storage);

    const scene2 = new THREE.Scene();
    const world2 = new Meadowlands(null, scene2);
    const bm2 = new BuildingManager(scene2, toyPhysics());
    world2.buildingManager = bm2;
    const colony2 = new Colony();
    colony2.addCitizen({ name: 'Blorp', body: fakeBody(0, 0, 0) });
    const summary = applySave(loadVillage(storage), { colony: colony2, buildingManager: bm2, world: world2 });
    expect(summary.structures).toBe(1);
    expect(bm2.placedStructures[0].id).toBe('fort');
    expect(bm2.placedStructures[0].toy).toBeDefined();
  });
});
