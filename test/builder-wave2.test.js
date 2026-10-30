// builder-wave2.test.js — Wave 2: battle telemetry, undo/redo history, disposal
// regression tests, soft mutation, MimicLab physics cleanup, camera guards.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  buildCustomDweebModel,
  DEFAULT_BUILD_CONFIG,
  BODY_SHAPES,
  computeBattleProfile,
  dnaStanceLabel,
  dnaAimLabel,
  dnaAgilityLabel,
  dnaScavengeLabel,
} from '../src/builder/CustomDweebModel.js';
import { BuildADweebLab, disposeObjectTree } from '../src/builder/BuildADweebLab.js';
import { MimicLab } from '../src/mimic/MimicLab.js';
import { CameraController } from '../src/camera/CameraController.js';

// ─── test doubles ────────────────────────────────────────────────────────────

function stubLocalStorage(initial = {}) {
  const store = { ...initial };
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  return store;
}

function makeMockPhysics() {
  const calls = [];
  const bodies = new Map();
  let n = 0;
  const mk = kind => (...args) => {
    const id = `${kind}_${n++}`;
    bodies.set(id, args);
    calls.push({ kind, id, args });
    return { id, body: { mockId: id } };
  };
  return {
    bodies,
    calls,
    createFixedCylinder: mk('fixedCylinder'),
    createStaticBox: mk('staticBox'),
    createDynamicBody: mk('dynamicBody'),
    removeBody: vi.fn(id => { bodies.delete(id); }),
  };
}

function makeDocumentStub() {
  globalThis.CustomEvent = class {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
  globalThis.document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

beforeEach(() => {
  delete globalThis.document;
  delete globalThis.CustomEvent;
  delete globalThis.localStorage;
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.CustomEvent;
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

// ─── Battle profile telemetry ────────────────────────────────────────────────

describe('computeBattleProfile', () => {
  it('rates a maxed build S/100 and a min build D/0', () => {
    const maxed = computeBattleProfile({
      stats: { mass: 4.5, speed: 1.4, jump: 1.4, armor: 1.4 },
      dna: { confidence: 1, aimAccuracy: 1, scavenge: 1, agility: 1 },
    });
    expect(maxed.rating).toBe(100);
    expect(maxed.tier).toBe('S');

    const mined = computeBattleProfile({
      stats: { mass: 1.8, speed: 0.7, jump: 0.8, armor: 0.8 },
    });
    expect(mined.rating).toBe(0);
    expect(mined.tier).toBe('D');
  });

  it('handles partial and garbage configs without throwing', () => {
    const p = computeBattleProfile({ stats: { mass: NaN, speed: 'fast' } });
    expect(Number.isFinite(p.rating)).toBe(true);
    expect(p.rating).toBeGreaterThanOrEqual(0);
    expect(p.rating).toBeLessThanOrEqual(100);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(p.tier);

    const empty = computeBattleProfile();
    expect(Number.isFinite(empty.rating)).toBe(true);
  });

  it('includes human-readable DNA trait tags', () => {
    const p = computeBattleProfile({
      dna: { confidence: 0.9, aimAccuracy: 0.9, scavenge: 0.1, agility: 0.95 },
    });
    expect(p.stance).toBe('Berserk Rushdown');
    expect(p.aim).toBe('Sniper / Calculated');
    expect(p.agility).toBe('Hyper-Agile');
    expect(p.scavenge).toBe('Fists & Kicks');
  });
});

describe('DNA trait labels', () => {
  it('stance thresholds match the HUD sliders', () => {
    expect(dnaStanceLabel(0.66)).toBe('Berserk Rushdown');
    expect(dnaStanceLabel(0.65)).toBe('Balanced');
    expect(dnaStanceLabel(0.5)).toBe('Balanced');
    expect(dnaStanceLabel(0.39)).toBe('Elusive Kiter');
  });
  it('aim / agility / scavenge thresholds match the HUD sliders', () => {
    expect(dnaAimLabel(0.61)).toBe('Sniper / Calculated');
    expect(dnaAimLabel(0.6)).toBe('Rapid Chaos Spam');
    expect(dnaAgilityLabel(0.71)).toBe('Hyper-Agile');
    expect(dnaAgilityLabel(0.7)).toBe('Steady');
    expect(dnaScavengeLabel(0.51)).toBe('Toy / Bomb Hunter');
    expect(dnaScavengeLabel(0.5)).toBe('Fists & Kicks');
  });
});

// ─── Lab disposal (GPU leak regression) ──────────────────────────────────────

describe('BuildADweebLab disposal', () => {
  it('disposeObjectTree frees geometries and materials of a built model', () => {
    const model = buildCustomDweebModel(DEFAULT_BUILD_CONFIG);
    const geos = new Set();
    const mats = new Set();
    model.root.traverse(c => {
      if (c.isMesh) {
        geos.add(c.geometry);
        (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => mats.add(m));
      }
    });
    expect(geos.size).toBeGreaterThan(5);

    const disposedGeos = new Set();
    const disposedMats = new Set();
    const origGeoDispose = THREE.BufferGeometry.prototype.dispose;
    const origMatDispose = THREE.Material.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function () { disposedGeos.add(this); };
    THREE.Material.prototype.dispose = function () { disposedMats.add(this); };
    try {
      disposeObjectTree(model.root);
    } finally {
      THREE.BufferGeometry.prototype.dispose = origGeoDispose;
      THREE.Material.prototype.dispose = origMatDispose;
    }
    for (const g of geos) expect(disposedGeos.has(g)).toBe(true);
    for (const m of mats) expect(disposedMats.has(m)).toBe(true);
  });

  it('rebuildModel disposes the previous model tree (no leak across slider ticks)', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null, { historyWindowMs: 0 });

    const oldGeos = new Set();
    lab.currentModelRoot.traverse(c => { if (c.isMesh) oldGeos.add(c.geometry); });
    const disposed = new Set();
    const orig = THREE.BufferGeometry.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function () { disposed.add(this); };
    try {
      lab.updateConfig({ shape: 'cube', width: 1.5 });
    } finally {
      THREE.BufferGeometry.prototype.dispose = orig;
    }
    expect(lab.config.shape).toBe('cube');
    for (const g of oldGeos) expect(disposed.has(g)).toBe(true);
    lab.dispose();
  });

  it('dispose detaches the group from the scene and drops model refs', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null);
    expect(scene.children).toContain(lab.group);
    lab.dispose();
    expect(scene.children).not.toContain(lab.group);
    expect(lab.currentModelRoot).toBeNull();
    expect(lab.modelInstance).toBeNull();
  });
});

// ─── Undo / redo history ─────────────────────────────────────────────────────

describe('BuildADweebLab undo/redo', () => {
  it('undo restores the pre-change config, redo reapplies it', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null, { historyWindowMs: 0 });
    expect(lab.canUndo()).toBe(false);
    expect(lab.undo()).toBeNull();

    lab.applyPreset('titan_chonk');
    expect(lab.config.shape).toBe('chonk');
    expect(lab.canUndo()).toBe(true);

    lab.updateConfig({ shape: 'star', eyeCount: 4 });
    expect(lab.config.shape).toBe('star');

    const undone = lab.undo();
    expect(undone.shape).toBe('chonk');
    expect(lab.config.shape).toBe('chonk');
    expect(lab.config.name).toBe('Titan Chonk');
    expect(lab.canRedo()).toBe(true);

    const redone = lab.redo();
    expect(redone.shape).toBe('star');
    expect(lab.config.eyeCount).toBe(4);
    expect(lab.canRedo()).toBe(false);

    lab.dispose();
  });

  it('a new change after undo clears the redo tail', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null, { historyWindowMs: 0 });
    lab.updateConfig({ shape: 'cube' });
    lab.updateConfig({ shape: 'star' });
    lab.undo();
    expect(lab.canRedo()).toBe(true);
    lab.updateConfig({ shape: 'spiky' });
    expect(lab.canRedo()).toBe(false);
    expect(lab.config.shape).toBe('spiky');
    lab.dispose();
  });

  it('coalesces rapid slider ticks into a single history step', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null, { historyWindowMs: 1e9 });
    lab.updateConfig({ width: 1.1 });
    lab.updateConfig({ width: 1.2 });
    lab.updateConfig({ width: 1.3 });
    // one coalesced step for the whole drag
    expect(lab.history.length).toBe(1);
    lab.undo();
    expect(lab.config.width).toBe(1.0);
    lab.dispose();
  });

  it('records every step when the coalesce window is 0', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null, { historyWindowMs: 0 });
    lab.updateConfig({ width: 1.1 });
    lab.updateConfig({ width: 1.2 });
    lab.updateConfig({ width: 1.3 });
    expect(lab.history.length).toBe(3);
    lab.dispose();
  });

  it('caps history at 60 entries', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null, { historyWindowMs: 0 });
    for (let i = 0; i < 80; i++) lab.updateConfig({ width: 1 + (i % 5) * 0.1 });
    expect(lab.history.length).toBeLessThanOrEqual(60);
    lab.dispose();
  });
});

// ─── Config persistence ──────────────────────────────────────────────────────

describe('BuildADweebLab loadConfig', () => {
  it('deep-merges partial saves so stats/dna subfields survive', () => {
    stubLocalStorage({
      'dweebs-custom-build': JSON.stringify({ name: 'Old Pal', stats: { mass: 4.0 } }),
    });
    const lab = new BuildADweebLab(new THREE.Scene(), null, null);
    expect(lab.config.name).toBe('Old Pal');
    expect(lab.config.stats.mass).toBe(4.0);
    expect(lab.config.stats.speed).toBe(DEFAULT_BUILD_CONFIG.stats.speed);
    expect(lab.config.dna.confidence).toBe(DEFAULT_BUILD_CONFIG.dna.confidence);
    lab.dispose();
  });

  it('falls back to defaults on corrupt saves', () => {
    stubLocalStorage({ 'dweebs-custom-build': 'not-json{{{' });
    const lab = new BuildADweebLab(new THREE.Scene(), null, null);
    expect(lab.config.shape).toBe(DEFAULT_BUILD_CONFIG.shape);
    lab.dispose();
  });
});

// ─── Soft mutation + mutation soak (bug hunt automation) ─────────────────────

describe('BuildADweebLab mutation', () => {
  it('softMutate keeps identity, stays in bounds, and rebuilds', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null);
    lab.applyPreset('pugilist_champ');
    const before = JSON.parse(JSON.stringify(lab.config));

    for (let i = 0; i < 30; i++) {
      const cfg = lab.softMutate();
      expect(cfg.name).toBe('Pugilist Champ'); // identity preserved
      expect(BODY_SHAPES).toContain(cfg.shape);
      expect(cfg.width).toBeGreaterThanOrEqual(0.5);
      expect(cfg.width).toBeLessThanOrEqual(1.8);
      expect(cfg.stats.mass).toBeGreaterThanOrEqual(1.8);
      expect(cfg.stats.mass).toBeLessThanOrEqual(4.5);
      for (const k of ['confidence', 'aimAccuracy', 'scavenge', 'agility']) {
        expect(cfg.dna[k]).toBeGreaterThanOrEqual(0);
        expect(cfg.dna[k]).toBeLessThanOrEqual(1);
      }
      expect(cfg.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(lab.currentModelRoot).toBeDefined();
      expect(() => lab.modelInstance.animate(i * 0.1)).not.toThrow();
    }
    // Soft mutation actually changed something across the run.
    expect(JSON.stringify(lab.config)).not.toBe(JSON.stringify(before));
    // ...and it is undoable back to the preset.
    lab.undo();
    expect(lab.config.name).toBe('Pugilist Champ');
    lab.dispose();
  });

  it('soak: 60 mutateRandom cycles stay consistent with no exceptions', () => {
    const scene = new THREE.Scene();
    const lab = new BuildADweebLab(scene, null, null, { historyWindowMs: 0 });
    for (let i = 0; i < 60; i++) {
      const cfg = lab.mutateRandom();
      expect(BODY_SHAPES).toContain(cfg.shape);
      expect(cfg.eyeMeshes).toBeUndefined(); // config, not model
      expect(lab.currentModelRoot).toBeInstanceOf(THREE.Group);
      expect(lab.modelInstance.eyeMeshes.length).toBe(cfg.eyeCount);
      expect(() => lab.modelInstance.animate(i * 0.13)).not.toThrow();
      lab.update(0.016); // pop/flash/turntable animation path
    }
    expect(lab.history.length).toBeLessThanOrEqual(60);
    expect(lab.canUndo()).toBe(true);
    lab.dispose();
  });

  it('clamps extreme depth/eye values instead of producing degenerate meshes', () => {
    const model = buildCustomDweebModel({
      ...DEFAULT_BUILD_CONFIG,
      depth: 99,
      width: -5,
      eyeSize: 0,
      eyeSpacing: 50,
      eyeCount: 99,
    });
    expect(model.bodyMesh.scale.z).toBe(2.0);
    expect(model.bodyMesh.scale.x).toBe(0.4);
    expect(model.eyeMeshes.length).toBe(4);
    for (const e of model.eyeMeshes) {
      expect(Number.isFinite(e.white.position.x)).toBe(true);
    }
  });
});

// ─── MimicLab physics cleanup ────────────────────────────────────────────────

describe('MimicLab physics lifecycle', () => {
  it('tracks every created body and removes them all on dispose', () => {
    const scene = new THREE.Scene();
    const phys = makeMockPhysics();
    const lab = new MimicLab(phys, scene);

    // floor + 3 bleachers + trunk + 6 props
    expect(phys.bodies.size).toBe(11);

    lab.dispose();
    expect(phys.removeBody).toHaveBeenCalledTimes(11);
    expect(phys.bodies.size).toBe(0);
    expect(scene.children).not.toContain(lab.group);
  });

  it('survives a null physics world', () => {
    const scene = new THREE.Scene();
    const lab = new MimicLab(null, scene);
    expect(lab.props.length).toBe(6);
    expect(() => lab.dispose()).not.toThrow();
    expect(scene.children).not.toContain(lab.group);
  });

  it('uses shape-matched colliders so boxes do not roll like balls', () => {
    const scene = new THREE.Scene();
    const phys = makeMockPhysics();
    const lab = new MimicLab(phys, scene);
    const dynCalls = phys.calls.filter(c => c.kind === 'dynamicBody');
    expect(dynCalls.length).toBe(6);

    const byName = {};
    lab.props.forEach((p, i) => { byName[p.name] = dynCalls[i].args; });

    // createDynamicBody(x, y, z, shape, dims, props)
    expect(byName.crate[3]).toBe('box');
    expect(byName.crate[4]).toEqual({ hx: 0.6, hy: 0.6, hz: 0.6 });
    expect(byName.giantDie[3]).toBe('box');
    expect(byName.watermelon[3]).toBe('sphere');
    expect(byName.watermelon[4]).toEqual({ radius: 0.65 });
    expect(byName.bowlingBall[3]).toBe('sphere');
    expect(byName.rubberChicken[3]).toBe('capsule');
    expect(byName.explosiveBarrel[3]).toBe('cylinder');
    lab.dispose();
  });
});

// ─── CameraController guards ─────────────────────────────────────────────────

describe('CameraController wave2', () => {
  function makeCam() {
    makeDocumentStub();
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    const cam = new CameraController(camera, canvas);
    return { cam, canvas, camera };
  }

  it('killCam with dur <= 0 is a no-op instead of producing NaN', () => {
    const { cam } = makeCam();
    cam.snapTo(0, 1, 0);
    cam.killCam({ x: 5, y: 1, z: 5 }, 0);
    expect(cam.kcT).toBe(0);
    expect(() => cam.update(0.016)).not.toThrow();
    expect(Number.isFinite(cam.currentTarget.x)).toBe(true);
    expect(Number.isFinite(cam.currentTarget.y)).toBe(true);
    expect(Number.isFinite(cam.currentTarget.z)).toBe(true);
  });

  it('killCam with a positive duration still eases toward the KO point', () => {
    const { cam } = makeCam();
    cam.snapTo(0, 1, 0);
    cam.killCam({ x: 10, y: 1, z: 0 }, 0.75);
    expect(cam.kcT).toBe(0.75);
    const before = cam.currentTarget.x;
    cam.update(0.05);
    expect(cam.currentTarget.x).toBeGreaterThan(before);
  });

  it('dispose detaches all listeners', () => {
    const { cam, canvas } = makeCam();
    const docRemove = globalThis.document.removeEventListener;
    cam.dispose();
    expect(canvas.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    expect(docRemove).toHaveBeenCalledWith('pointerlockchange', expect.any(Function));
    expect(docRemove).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(cam.isLocked).toBe(false);
  });
});
