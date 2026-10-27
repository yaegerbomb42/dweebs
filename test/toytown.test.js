// ToyTown — pure maths, catalog integrity, structure lifecycle and worker repair AI.
// These tests run headless: a stub physics world records collider bookkeeping so we can assert
// that every building's dispose() is atomic without booting Rapier or a renderer.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  impactScore, shouldShatter, ziplinePoint, ziplineSpeed,
  sampleTrack, nearestOnTrack, toyResourceStats,
} from '../src/world/ToyKit.js';
import { ToyTown, ToyFort, Windmill } from '../src/world/ToyBuildings.js';
import { STRUCTURE_CATALOG, TOY_TOWN_LAYOUT, getStructureDef } from '../src/world/ObjectRegistry.js';
import { Citizen, CITIZEN_STATES, PERSONALITIES } from '../src/adventure/citizen.js';
import { BLUEPRINTS, BuildingManager } from '../src/adventure/building.js';
import { Dweeb } from '../src/player/Dweeb.js';

class StubBody {
  constructor(kind = 'static') {
    this.kind = kind;
    this._p = { x: 0, y: 1, z: 0 };
    this._v = { x: 0, y: 0, z: 0 };
    this._r = { x: 0, y: 0, z: 0, w: 1 };
  }
  translation() { return { ...this._p }; }
  rotation() { return { ...this._r }; }
  linvel() { return { ...this._v }; }
  setLinvel(v) { this._v = { ...v }; }
  setTranslation(v) { this._p = { ...v }; }
  setRotation() {}
  setGravityScale() {}
  setNextKinematicTranslation(v) { this._p = { ...v }; }
  setNextKinematicRotation(q) { this._r = { ...q }; }
  isDynamic() { return this.kind === 'dynamic'; }
  isSleeping() { return false; }
}

class StubPhysics {
  constructor() {
    this.bodies = new Map();
    this.colliderInfo = new Map();
    this.impacts = [];
    this.next = 1;
    this.removed = 0;
  }

  _collider() {
    const handle = this.next++;
    return { handle, parent: () => null };
  }

  _register(collider, info = {}) {
    this.colliderInfo.set(collider.handle, { ...info, rigid: null, pv: { x: 0, y: 0, z: 0 } });
  }

  _add(type, collider, body = new StubBody(type)) {
    const id = `stub_${this.next++}`;
    this.bodies.set(id, { id, body, collider, type });
    return { id, body, collider };
  }

  createStaticBox() {
    const c = this._collider();
    this._register(c, { kind: 'stage', material: 'wood' });
    return this._add('static', c);
  }

  createStaticBoxRotated() { return this.createStaticBox(); }
  createFixedCylinder() { return this.createStaticBox(); }
  createFixedCone() { return this.createStaticBox(); }
  createKinematicShape() { return this.createStaticBox(); }

  createKinematicBox() {
    const c = this._collider();
    this._register(c, { kind: 'hazard', material: 'wood' });
    return this._add('kinematic', c);
  }

  createDynamicBody(x, y, z, shape, dims, props = {}) {
    const c = this._collider();
    const body = new StubBody('dynamic');
    body._p = { x, y, z };
    this.colliderInfo.set(c.handle, {
      kind: 'object', material: props.material || 'wood', ref: null,
      dynamic: true, mass: props.mass || 1, rigid: body, pv: { x: 0, y: 0, z: 0 },
    });
    const id = props.id || `stub_${this.next++}`;
    this.bodies.set(id, { id, body, collider: c, type: 'dynamic', props });
    return { id, body, collider: c };
  }

  applyImpulse() {}
  getImpacts() { return this.impacts; }

  removeBody(id) {
    const entry = this.bodies.get(id);
    if (!entry) return;
    this.colliderInfo.delete(entry.collider.handle);
    this.bodies.delete(id);
    this.removed++;
  }
}

function buildTown() {
  const physics = new StubPhysics();
  const scene = new THREE.Scene();
  const town = new ToyTown(physics, scene, {
    layout: TOY_TOWN_LAYOUT,
    groundAt: () => 0,
  });
  return { physics, scene, town };
}

describe('ToyKit maths', () => {
  it('scores impacts from speed and game-mass', () => {
    expect(impactScore(0, 3)).toBe(0);
    expect(impactScore(8, 3)).toBe(192);
    expect(impactScore(-4, 2)).toBe(0); // negative speeds are clamped
    expect(shouldShatter(192, 150)).toBe(true);
    expect(shouldShatter(100, 150)).toBe(false);
  });

  it('samples a zipline with sag and a terminal speed', () => {
    const a = { x: 0, y: 8, z: 0 };
    const b = { x: 10, y: 1, z: 0 };
    const mid = ziplinePoint(a, b, 0.5, 0.6);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(4.5 - 0.6);
    expect(ziplinePoint(a, b, 0).y).toBeCloseTo(8);
    expect(ziplinePoint(a, b, 1).y).toBeCloseTo(1);
    expect(ziplineSpeed(25, 7, 10, 0)).toBeLessThan(10);
    expect(ziplineSpeed(25, 7, 10, 1000, 13)).toBe(13);
  });

  it('finds the nearest segment on a curved chute', () => {
    const track = sampleTrack([
      new THREE.Vector3(0, 4, 0),
      new THREE.Vector3(4, 2, 0),
      new THREE.Vector3(8, 0.5, 0),
    ], 9, 0.2);
    const hit = nearestOnTrack(track, new THREE.Vector3(4, 2.1, 0.1));
    expect(hit).not.toBeNull();
    expect(hit.point.x).toBeGreaterThan(3);
    expect(hit.point.x).toBeLessThan(5);
    expect(hit.tangent.x).toBeGreaterThan(0);
  });
});

describe('toy architecture catalog', () => {
  it('ships six distinct modular landmarks', () => {
    expect(STRUCTURE_CATALOG).toHaveLength(6);
    expect(new Set(STRUCTURE_CATALOG.map(s => s.id)).size).toBe(6);
    for (const def of STRUCTURE_CATALOG) {
      expect(def.name.length).toBeGreaterThan(3);
      expect(def.cost.wood).toBeGreaterThan(0);
      expect(def.footprint).toBeGreaterThan(0);
      expect(getStructureDef(def.id)).toBe(def);
    }
  });

  it('places every catalog landmark in the Meadowlands layout', () => {
    const ids = new Set(TOY_TOWN_LAYOUT.map(s => s.id));
    for (const def of STRUCTURE_CATALOG) expect(ids.has(def.id)).toBe(true);
    expect(TOY_TOWN_LAYOUT).toHaveLength(6);
  });
});

describe('ToyTown lifecycle', () => {
  it('builds, updates, toggles debug hulls and disposses every collider/geometry', () => {
    const { physics, scene, town } = buildTown();
    expect(town.structures).toHaveLength(6);
    expect(scene.children).toHaveLength(6);
    expect(physics.bodies.size).toBeGreaterThan(20);
    expect(toyResourceStats().geometries).toBeGreaterThan(0);

    for (let i = 0; i < 20; i++) town.update(1 / 60, []);
    town.setDebugWireframes(true);
    expect(town.debug).toBe(true);
    town.setDebugWireframes(false);

    // A launched plush ball lives in world space; disposing the gazebo must clean it up.
    expect(town.get('gazebo').spawner.fire()).toBeTruthy();
    town.update(1 / 60, []);

    town.dispose();
    expect(physics.bodies.size).toBe(0);
    expect(scene.children).toHaveLength(0);
    expect(toyResourceStats().geometries).toBe(0);
    expect(toyResourceStats().materials).toBe(0);
  });

  it('breaks fort blocks and rebuilds them with repairStep', () => {
    const physics = new StubPhysics();
    const scene = new THREE.Scene();
    const fort = new ToyFort(physics, scene, { x: 0, y: 0, z: 0 });
    expect(fort.blocks.length).toBeGreaterThan(20);
    const before = fort.blocks.filter(b => b.alive).length;
    const block = fort.blocks.find(b => b.alive);
    expect(fort.smashBlock(block, { x: 1, y: 0, z: 0 }, 1)).toBe(true);
    expect(fort.getDamaged()).toBe(true);
    expect(fort.blocks.filter(b => b.alive).length).toBe(before - 1);
    expect(fort.debris.length).toBe(3);

    fort.repairStep(1);
    expect(fort.blocks.filter(b => b.alive).length).toBe(before);
    expect(fort.isRepaired).toBe(true);
    fort.dispose();
    expect(physics.bodies.size).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it('opens a saloon door, drops its collider, then restores it', () => {
    const physics = new StubPhysics();
    const scene = new THREE.Scene();
    const mill = new Windmill(physics, scene, { x: 0, y: 0, z: 0 });
    const door = mill.door;
    expect(door.collider).toBeTruthy();
    door.openUp(true);
    expect(door.open).toBe(true);
    expect(door.collider).toBeNull();
    door.closeUp();
    for (let i = 0; i < 30; i++) door.update(0.05, { dweebs: [] });
    expect(door.collider).toBeTruthy();
    mill.dispose();
    expect(physics.bodies.size).toBe(0);
  });
});

describe('construction integration', () => {
  it('exposes every landmark blueprint and can place one through BuildingManager', () => {
    for (const def of STRUCTURE_CATALOG) {
      const bp = BLUEPRINTS.find(b => b.id === def.id);
      expect(bp).toBeTruthy();
      expect(bp.kind).toBe('landmark');
    }

    const physics = new StubPhysics();
    const scene = new THREE.Scene();
    const manager = new BuildingManager(scene, physics);
    const ghost = manager._createGhostMesh('windmill');
    expect(ghost.children.length).toBeGreaterThan(1);

    const placed = manager._instantiateStructure('windmill', new THREE.Vector3(0, 0, 0), {
      _getHeight: () => 0,
    });
    expect(placed.toy).toBeTruthy();
    expect(scene.children).toContain(placed.toy.group);
    manager.placedStructures.push(placed);
    manager.dispose();
    expect(physics.bodies.size).toBe(0);
    expect(scene.children).toHaveLength(0);
  });
});

describe('worker repair AI', () => {
  it('sends a builder toward a damaged fort', () => {
    const { town } = buildTown();
    const fort = town.get('fort');
    const block = fort.blocks.find(b => b.alive);
    fort.smashBlock(block, { x: 1, y: 0, z: 0 }, 1);

    const dweeb = { name: 'Mason', mesh: new THREE.Group(), body: null };
    const builder = new Citizen(dweeb, {
      personality: PERSONALITIES.find(p => p.id === 'builder'),
    });
    builder.hunger = 0;
    builder.energy = 80;
    builder.curiosity = 0;
    builder.social = 0;
    builder._selectNextGoal({ toyTown: town }, []);

    expect(builder.state).toBe(CITIZEN_STATES.REPAIR);
    expect(builder.targetEntity).toBe(fort);
    expect(builder.targetPos.distanceTo(fort.repairPoint)).toBeLessThan(0.001);
    town.dispose();
  });
});

describe('zipline rider hook', () => {
  it('Dweeb.preStep pins the body to the cable while zipRide is active', () => {
    const body = new StubBody('dynamic');
    const fake = {
      active: true,
      body,
      grabbedBy: null,
      zipRide: { pos: { x: 3, y: 5, z: 7 }, vel: { x: 4, y: -1, z: 2 } },
      jumpRequested: true,
      jumpBuffer: 1,
    };
    Dweeb.prototype.preStep.call(fake, 1 / 60);
    expect(body.translation()).toEqual({ x: 3, y: 5, z: 7 });
    expect(body.linvel()).toEqual({ x: 4, y: -1, z: 2 });
    expect(fake.jumpRequested).toBe(false);
    expect(fake.jumpBuffer).toBe(0);
  });
});
