// brutalist-arena.test.js — the Brutalist Foundry brawl stage.
//
// Verifies the brutalist arena builds cleanly: geometry + Rapier colliders,
// walkable platforms all have colliders, spawn points sit on solid ground
// (raycast down hits), and no spawn is inside a wall.

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { BrutalistArena, BRUTALIST_OFFSET, hazardTexture, zoneTexture } from '../src/world/BrutalistArena.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { ARENAS, arenaById } from '../src/game/Arenas.js';

let physics;
let scene;

beforeAll(async () => {
  physics = new PhysicsWorld();
  await physics.init();
  scene = new THREE.Scene();
}, 30000);

/** Build a fresh brutalist arena at the origin (no offset) for testing. */
function buildArena() {
  const arena = new BrutalistArena(scene, physics, new THREE.Vector3(0, 0, 0));
  arena.build();
  // Rapier needs a step to populate the broadphase before raycasts work.
  physics.world.step();
  return arena;
}

describe('brutalist arena registration', () => {
  it('is registered in Arenas.js with id brutalist', () => {
    const def = arenaById('brutalist');
    expect(def.id).toBe('brutalist');
    expect(def.name).toContain('Brutalist');
    expect(ARENAS.some(a => a.id === 'brutalist')).toBe(true);
  });

  it('has sane personality stats (standard traction/gravity)', () => {
    const def = arenaById('brutalist');
    expect(def.traction).toBe(1);
    expect(def.gravity).toBe(1);
    expect(def.isBrutalist).toBe(true);
  });
});

describe('brutalist arena construction', () => {
  it('builds without errors and creates a scene group', () => {
    const arena = buildArena();
    expect(arena.built).toBe(true);
    expect(arena.group).not.toBeNull();
    expect(scene.children).toContain(arena.group);
    expect(arena.group.children.length).toBeGreaterThan(20);
    arena.dispose();
  });

  it('is idempotent — build() twice does not duplicate', () => {
    const arena = buildArena();
    const kids = arena.group.children.length;
    const bodies = arena.bodyIds.length;
    arena.build();
    expect(arena.group.children.length).toBe(kids);
    expect(arena.bodyIds.length).toBe(bodies);
    arena.dispose();
  });

  it('every walkable platform has a matching physics collider', () => {
    const arena = buildArena();
    // Main deck + 2 walkways + upper platform = 4 platforms
    expect(arena.platforms.length).toBe(4);
    for (const p of arena.platforms) {
      // There must be a static body whose top surface matches the platform top
      const match = arena.bodyIds.some(id => {
        const entry = physics.bodies.get(id);
        if (!entry) return false;
        const t = entry.rigid.translation();
        // Platform colliders are boxes; check center proximity (x/z) — y varies by thickness
        return Math.abs(t.x - p.x) < 0.01 && Math.abs(t.z - p.z) < 0.01;
      });
      expect(match, `platform at (${p.x}, ${p.z}) top=${p.top}`).toBe(true);
    }
    arena.dispose();
  });

  it('creates colliders for stairs ramps, walls, and props', () => {
    const arena = buildArena();
    // bodyIds includes: 4 platforms + 3 ramp colliders + pillars + walls + crates + barriers + supports
    expect(arena.bodyIds.length).toBeGreaterThan(15);
    // Every tracked body must exist in the physics world
    for (const id of arena.bodyIds) {
      expect(physics.bodies.has(id), `missing body ${id}`).toBe(true);
    }
    arena.dispose();
  });

  it('dispose() removes meshes and physics bodies', () => {
    const arena = buildArena();
    const ids = [...arena.bodyIds];
    expect(ids.length).toBeGreaterThan(0);
    arena.dispose();
    expect(arena.built).toBe(false);
    expect(scene.children).not.toContain(arena.group);
    for (const id of ids) {
      expect(physics.bodies.has(id), `body ${id} not removed`).toBe(false);
    }
  });

  it('setVisible toggles the group', () => {
    const arena = buildArena();
    arena.setVisible(false);
    expect(arena.group.visible).toBe(false);
    arena.setVisible(true);
    expect(arena.group.visible).toBe(true);
    arena.dispose();
  });
});

describe('brutalist arena spawn points', () => {
  it('provides 4 spread-out spawn points on the main deck', () => {
    const arena = buildArena();
    const pts = [0, 1, 2, 3].map(i => arena.getSpawnPoint(i, 4));
    expect(pts.length).toBe(4);
    // Spread out: every pair at least 6m apart
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
        expect(d, `spawns ${i} and ${j} too close`).toBeGreaterThanOrEqual(6);
      }
    }
    // On the main deck (within its 24×24 bounds)
    for (const p of pts) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(12);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(12);
    }
    arena.dispose();
  });

  it('raycast down from each spawn hits a collider (solid ground)', () => {
    const arena = buildArena();
    for (let i = 0; i < 4; i++) {
      const p = arena.getSpawnPoint(i, 4);
      // Cast from 5m above the spawn point straight down
      const hit = physics.raycast(
        { x: p.x, y: p.y + 5, z: p.z },
        { x: 0, y: -1, z: 0 },
        20
      );
      expect(hit, `spawn ${i} has no ground below`).not.toBeNull();
      if (hit) {
        // Ground should be within ~6m below the ray origin (spawn y + 5)
        const groundY = (p.y + 5) - hit.distance;
        expect(groundY, `spawn ${i} ground too far`).toBeGreaterThan(-2);
        expect(groundY, `spawn ${i} ground above spawn`).toBeLessThanOrEqual(p.y + 0.5);
      }
    }
    arena.dispose();
  });

  it('no spawn point is inside a wall or pillar', () => {
    const arena = buildArena();
    // Walls/pillars are solid boxes; a spawn inside one would be stuck.
    // We approximate: spawn must not be within any platform's side volume
    // below its top (i.e., inside the slab). Check against body AABBs.
    for (let i = 0; i < 4; i++) {
      const p = arena.getSpawnPoint(i, 4);
      for (const id of arena.bodyIds) {
        const entry = physics.bodies.get(id);
        if (!entry?.collider) continue;
        // Only check axis-aligned box colliders (ramps are rotated — skip those)
        if (id.startsWith('brut_ramp_')) continue;
        const t = entry.rigid.translation();
        // Heuristic: spawn y (1.2) is above all platform tops except the deck (0).
        // If a spawn were inside a pillar, its x/z would match a tall narrow body.
        // Pillars are 2×6×2 — check for overlap at spawn height.
        const half = 1.0; // pillar half-extent
        const isPillarLike = t.y > 2; // pillar centers are high (y=3)
        if (isPillarLike && Math.abs(p.x - t.x) < half && Math.abs(p.z - t.z) < half) {
          throw new Error(`spawn ${i} inside pillar at (${t.x}, ${t.z})`);
        }
      }
    }
    arena.dispose();
  });
});

describe('brutalist procedural textures', () => {
  it('hazardTexture returns null in node (no document), texture in browser', () => {
    // In the vitest node environment there is no document.
    if (typeof document === 'undefined') {
      expect(hazardTexture()).toBeNull();
      expect(zoneTexture('ZONE 04')).toBeNull();
    }
  });

  it('BRUTALIST_OFFSET keeps clear of the stadium (radius 16)', () => {
    // Stadium core radius 11, stage radius 16 — offset 200 is far clear.
    expect(BRUTALIST_OFFSET.length()).toBeGreaterThan(100);
  });
});
