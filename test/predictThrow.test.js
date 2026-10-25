// predictThrow vs the real throw. The aim guide tells the player where the item will land;
// if that lies, aiming feels broken. We fly the *same* launch velocity through a real Rapier
// world (flat floor, no bumpers) and check the simulated landing point matches the prediction.
//
// Headless: no DOM, no WebGL. Arena is stubbed with the two lookups predictThrow needs
// (bumperByHandle / trampolineByHandle) because the visual arena wants a canvas, and the item is
// a bare physics body (InteractiveObject would build sticker-textured meshes, i.e. needs a DOM).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { CombatSystem, DEFAULT_LOFT } from '../src/combat/CombatSystem.js';
import { getObjectDef } from '../src/world/ObjectRegistry.js';

const FLOOR_TOP = 0;   // the arena's core disc top sits at y = 0
const TOL_XZ = 1.0;    // metres of allowed horizontal drift from the prediction
const TOL_Y = 0.6;

/** A stand-in for the dweeb that throws: predictThrow only reads getPosition/yaw/megaTimer. */
function throwerAt(x, y, z, yaw) {
  return { getPosition: () => ({ x, y, z }), yaw, megaTimer: 0, active: true, grabbedBy: null, held: null };
}

const stubArena = {
  bumperByHandle: () => null,
  trampolineByHandle: () => null,
  bumpers: [],
  trampolines: [],
  powerups: [],
};

/**
 * A throw rig in its OWN Rapier world: a flat floor and a thrower. Fresh per test, because
 * leftover item bodies from an earlier case change the outcome (they bounce the next throw).
 */
async function makeRig() {
  const p = new PhysicsWorld();
  await p.init();
  p.createStaticBox(0, FLOOR_TOP - 0.5, 0, 60, 0.5, 60, 'toy');
  // Rapier only refreshes its scene queries on step, so a raycast before the first step sees an
  // empty world. One priming step makes predictThrow's raycasts valid.
  p.step(1 / 60);
  return {
    physics: p,
    system: new CombatSystem(p, stubArena, { hit() {}, throw() {}, rocketSmoke() {} }),
    item(key, x = 0, y = 1, z = 0) {
      const def = getObjectDef(key);
      const b = p.createDynamicBody(x, y, z, def.shape, def.dims, { material: def.material, mass: def.mass });
      // InteractiveObject also exposes getPosition(); CombatSystem._thrust calls it.
      return { key, def, collider: b.collider, body: b.body, physicsId: b.id, getPosition: () => b.body.translation() };
    },
  };
}

/**
 * Throw for real: apply exactly what throwHeld does (translation + linvel from launch()), then
 * step the world until the item first reaches the floor.
 * @returns { {x,y,z,t} } first floor contact
 */
function simulateLanding(rig, obj, d, charge, yaw, loft) {
  const L = rig.system.launch(d, obj, charge, yaw, loft);
  obj.body.setTranslation(L.origin, true);
  obj.body.setLinvel(L.vel, true);
  // A toy rocket is not ballistic: CombatSystem._thrust re-pins its velocity every frame while
  // the fuel lasts, so the simulation has to do the same or the arcs cannot be compared.
  if (L.dir) obj.rocket = { dir: L.dir, fuel: L.fuel };

  let t = 0;
  const dt = 1 / 60;
  // Landing = the frame the body's vertical velocity stops being downward, i.e. it has hit the
  // floor. Using the *velocity sign* is shape-agnostic: guessing a rest height from dims is
  // wrong for round-cuboids, and missing the contact means measuring where the item rolled to
  // rather than where it landed. The check only arms once the body has actually started falling,
  // since every lob begins with vy > 0.
  let falling = false;
  while (t < 4) {
    if (obj.rocket?.fuel > 0) rig.system._thrust(obj, dt);
    rig.physics.step(dt);
    t += dt;
    const vy = obj.body.linvel().y;
    if (vy < 0) falling = true;
    else if (falling) break;
  }
  const p = obj.body.translation();
  return { x: p.x, y: p.y, z: p.z, t };
}

describe('predictThrow matches the real landing', () => {
  const CASES = [
    { key: 'beachBall', charge: 0, loft: DEFAULT_LOFT },
    { key: 'beachBall', charge: 1, loft: 0.45 },
    { key: 'crate', charge: 0, loft: 0.1 },
    { key: 'anvil', charge: 1, loft: 0.7 },           // heavy: a slow lob
    { key: 'mattress', charge: 0.25, loft: 0.2 },
    { key: 'bowlingBall', charge: 0.8, loft: -0.05 }, // roll:true, skims the floor
    // The rocket is deliberately looser: predictThrow integrates it in 1/45 s steps *without*
    // re-pinning velocity, while the real game re-pins it to ROCKET_SPEED every 1/60 s frame
    // (CombatSystem._thrust), so the arcs diverge by ~1 m over a 45 m flight. Filed as a
    // finding on the board rather than silently tolerated.
    { key: 'toyRocket', charge: 1, loft: 0.3, tol: 2.5 },
  ];

  for (const c of CASES) {
    it(`${c.key} @ charge ${c.charge}, loft ${c.loft}`, async () => {
      const rig = await makeRig();
      const d = throwerAt(0, 1, 0, 0); // yaw 0 → +Z
      const obj = rig.item(c.key);
      const pred = rig.system.predictThrow(d, obj, c.charge, 0, c.loft);
      expect(pred.n).toBeGreaterThan(1);

      // The guide predicts the ray's floor contact; the real body rests one half-height
      // up and keeps rolling/bouncing, so allow a wider band for boxes and rockets.
      const actual = simulateLanding(rig, obj, d, c.charge, 0, c.loft);
      const dx = Math.abs(pred.end.x - actual.x);
      const dz = Math.abs(pred.end.z - actual.z);
      const tol = c.tol ?? TOL_XZ;
      expect(dx, `x drift ${dx.toFixed(2)}m (pred ${pred.end.x.toFixed(2)} vs ${actual.x.toFixed(2)})`)
        .toBeLessThan(tol);
      expect(dz, `z drift ${dz.toFixed(2)}m`).toBeLessThan(tol);
      // The guide stops on the floor surface; the body stops a radius above it.
      expect(Math.abs(pred.end.y - actual.y)).toBeLessThan(TOL_Y);
      expect(actual.t).toBeGreaterThan(0);
    });
  }
});

describe('throw aim guide', () => {
  it('prediction is monotonic in loft: a higher loft lands further away', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    const obj = rig.item('crate');
    const dist = p => Math.hypot(p.end.x, p.end.z);
    expect(dist(rig.system.predictThrow(d, obj, 1, 0, 0.75)))
      .toBeGreaterThan(dist(rig.system.predictThrow(d, obj, 1, 0, 0.05)));
  });

  it('the drawn path starts at the launch origin and ends in a Vector3', async () => {
    const rig = await makeRig();
    const d = throwerAt(2, 1, -3, 1.2);
    const obj = rig.item('beachBall', 2, 1, -3);
    const points = [];
    const pred = rig.system.predictThrow(d, obj, 0.6, 1.2, 0.3, points);
    expect(points[0].x).toBeCloseTo(pred.launch.origin.x, 6);
    expect(points[0].y).toBeCloseTo(pred.launch.origin.y, 6);
    expect(points[0].z).toBeCloseTo(pred.launch.origin.z, 6);
    expect(pred.end).toBeInstanceOf(THREE.Vector3);
  });

  it('the launch origin sits a metre in front of the thrower, at chest height', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, Math.PI / 2); // yaw π/2 → +X
    const obj = rig.item('beachBall');
    const L = rig.system.launch(d, obj, 0, Math.PI / 2, DEFAULT_LOFT);
    expect(L.origin.x).toBeCloseTo(1, 6);
    expect(L.origin.y).toBeCloseTo(1.9, 6);
    expect(L.origin.z).toBeCloseTo(0, 6);
  });

  it('throw speed rises with charge and falls with heft', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    const light = rig.item('beachBall'); // 0.15 kg
    const heavy = rig.item('anvil');     // stone
    const L = (o, c) => rig.system.launch(d, o, c, 0, 0).speed;
    expect(L(light, 1)).toBeGreaterThan(L(light, 0));
    expect(L(heavy, 0)).toBeLessThan(L(light, 0));
  });

  it('an empty arena reports no target but a sane flight time', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    const pred = rig.system.predictThrow(d, rig.item('beachBall'), 0.4, 0, 0.2);
    expect(pred.target).toBeNull();
    expect(pred.time).toBeGreaterThan(0);
    expect(pred.time).toBeLessThanOrEqual(2.6);
  });

  it('a rival standing in the arc is reported as the target', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    const obj = rig.item('beachBall');
    // Park the rival exactly on the predicted path, halfway down: the check is "does predictThrow
    // notice a rival in the arc", so the rival must genuinely be in it.
    const points = [];
    rig.system.predictThrow(d, obj, 0.5, 0, 0.15, points);
    const mid = points[Math.floor(points.length / 2)];
    const rival = {
      active: true, grabbedBy: null, velocity: { x: 0, y: 0, z: 0 },
      getPosition: () => ({ x: mid.x, y: mid.y, z: mid.z }),
    };
    rig.system.setDweebs([d, rival]);
    const withFoe = rig.system.predictThrow(d, obj, 0.5, 0, 0.15);
    expect(withFoe.target).toBe(rival);
    expect(withFoe.targetTime).toBeGreaterThan(0);
  });

  it('a rival well clear of the arc is not a target', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    const obj = rig.item('beachBall');
    const rival = {
      active: true, grabbedBy: null, velocity: { x: 0, y: 0, z: 0 },
      getPosition: () => ({ x: 40, y: 0.5, z: 40 }),
    };
    rig.system.setDweebs([d, rival]);
    expect(rig.system.predictThrow(d, obj, 0.5, 0, 0.15).target).toBeNull();
  });

  it('an inactive or grabbed rival is ignored', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    const obj = rig.item('beachBall');
    const points = [];
    rig.system.predictThrow(d, obj, 0.5, 0, 0.15, points);
    const mid = points[Math.floor(points.length / 2)];
    for (const flags of [{ active: false }, { grabbedBy: {} }]) {
      const rival = {
        active: true, grabbedBy: null, velocity: { x: 0, y: 0, z: 0 },
        getPosition: () => ({ x: mid.x, y: mid.y, z: mid.z }),
        ...flags,
      };
      rig.system.setDweebs([d, rival]);
      expect(rig.system.predictThrow(d, obj, 0.5, 0, 0.15).target).toBeNull();
    }
  });

  it('the thrower is never their own target', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    rig.system.setDweebs([d]);
    expect(rig.system.predictThrow(d, rig.item('beachBall'), 0.5, 0, 0.15).target).toBeNull();
  });

  it('predictThrow does not move the body it is predicting for', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    const obj = rig.item('crate', 3, 2, 3);
    const before = obj.body.translation();
    rig.system.predictThrow(d, obj, 1, 0.4, 0.3);
    const after = obj.body.translation();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
  });

  it('never returns a NaN endpoint, whatever the aim', async () => {
    const rig = await makeRig();
    const d = throwerAt(0, 1, 0, 0);
    const obj = rig.item('beachBall');
    for (let i = 0; i < 200; i++) {
      const p = rig.system.predictThrow(d, obj, Math.random(), Math.random() * 7 - 3.5, Math.random() * 2 - 0.8);
      expect(Number.isFinite(p.end.x)).toBe(true);
      expect(Number.isFinite(p.end.y)).toBe(true);
      expect(Number.isFinite(p.end.z)).toBe(true);
      expect(p.time).toBeGreaterThan(0);
    }
  });
});

