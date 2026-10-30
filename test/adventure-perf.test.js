// adventure-perf.test.js — the 60 fps promise, measured headless.
// Steps a full village (24 citizens, 36 structures incl. berrymills, cannons,
// silos, ziptowers and a live critter) through the sim-only update path and
// asserts the per-frame cost stays inside one 16.6ms frame. Rendering is not
// measured here — a real browser frame also pays for the WebGL draw.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Meadowlands } from '../src/world/Meadowlands.js';
import { Colony } from '../src/adventure/colony.js';
import { BuildingManager, BLUEPRINTS } from '../src/adventure/building.js';

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

describe('adventure perf (24 citizens, 36 structures)', () => {
  it('sim steps stay inside a 16.6ms frame budget', () => {
    const scene = new THREE.Scene();
    const world = new Meadowlands(null, scene);
    const bm = new BuildingManager(scene, fakePhysics());
    world.buildingManager = bm;
    const colony = new Colony();
    colony.resources = { wood: 999, berries: 999, stone: 999, gold: 0 };
    for (const bp of BLUEPRINTS) colony.unlockBlueprint(bp.id); // perf test: all tiers unlocked

    // 24 citizens with spread roles.
    const roles = ['forager', 'builder', 'defender', 'tinkerer', null];
    const dweebs = [];
    for (let i = 0; i < 24; i++) {
      const d = { name: `Cit${i}`, body: fakeBody((i % 6) * 3 - 7, 0, Math.floor(i / 6) * 3 - 5) };
      dweebs.push(d);
      const c = colony.addCitizen(d);
      if (roles[i % roles.length]) colony.assignRole(c, roles[i % roles.length]);
    }
    colony.queueBuild('tent');
    colony.queueBuild('silo');

    // 36 structures: a mix of everything, spread around the village.
    const ids = BLUEPRINTS.map(b => b.id);
    for (let i = 0; i < 36; i++) {
      const id = ids[i % ids.length];
      const ang = (i / 36) * Math.PI * 2;
      const r = 6 + (i % 4) * 4;
      bm.activeBlueprint = BLUEPRINTS.find(b => b.id === id);
      bm.isValidPlacement = true;
      bm.placementPos.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      bm.confirmPlacement(colony, world);
    }
    expect(bm.placedStructures.length).toBe(36);

    // A live critter for the cannons and defenders to chew on.
    const critter = world.spawnCritter();
    critter.x = 5; critter.z = 5;

    const step = () => {
      const dt = 1 / 60;
      bm.update(dt, { body: fakeBody(0, 1, 0) }, null, { dweebs, colony, world });
      bm.updatePlaced(dt, dweebs);
      world.update(dt, dweebs, colony);
      colony.update(dt, world);
    };

    for (let i = 0; i < 60; i++) step(); // warmup (JIT, first-frame setup)
    const samples = [];
    for (let i = 0; i < 600; i++) {
      const t0 = performance.now();
      step();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    console.log(`adventure-perf (24 citizens, 36 structures, 600 steps): mean=${mean.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms`);
    expect(mean).toBeLessThan(8);
    expect(p95).toBeLessThan(16.6);
    // And the village is still intact after all that stepping.
    expect(bm.placedStructures.length).toBeGreaterThanOrEqual(30);
    expect(colony.citizens.length).toBe(24);
  });
});
