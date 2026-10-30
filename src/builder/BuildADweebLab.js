// BuildADweebLab.js — 3D Turntable Workshop & Creature Customizer
//
// Manages the real-time 3D pedestal, lighting, live mesh regeneration,
// procedural random mutation, and configuration persistence for Build-A-Dweeb.

/* global structuredClone:readonly, CustomEvent:readonly */

import * as THREE from 'three';
import { toonMat, noOutline } from '../render/Toon.js';
import {
  buildCustomDweebModel,
  DEFAULT_BUILD_CONFIG,
  ARCHETYPE_PRESETS,
  BODY_SHAPES,
  APPENDAGES,
  FEET_TYPES,
  BROW_STYLES,
  MOUTH_STYLES,
  ELEMENTAL_PALETTES,
  // Merge: milestone #4 (collider sync + appendage gameplay) and wave-2
  // (genetics / battle profile) model imports are all kept.
  refreshDweebCollider,
  installAppendageGameplay,
  randomizeConfig,
  breedConfigs,
  evolveBuild,
  computeBattleProfile,
} from './CustomDweebModel.js';
import { TournamentBracket } from './Tournament.js';
import {
  createRng,
  simulateBout,
  runGauntlet,
  runEndlessGauntlet,
  dojoSparOpponent,
  buildSnapshot,
} from './BattleSim.js';

const STORAGE_KEY = 'dweebs-custom-build';
export const TOURNAMENT_KEY = 'dweebs-tournament-v1';
const SLOTS_KEY = 'dweebs-build-slots-v1';
const DOJO_RECORDS_KEY = 'dweebs-dojo-records-v1';
const MAX_SLOTS = 3;

/**
 * HUD <-> Lab event protocol (keeps the lab self-wiring: the app shell only
 * passes the original handler set, so the HUD talks to the lab over document
 * CustomEvents and the lab answers back the same way).
 *   HUD -> Lab : 'bd-undo' | 'bd-redo' | 'bd-soft-mutate'
 *              | 'bd-breed' { partner } | 'bd-evolve' { rounds, target }
 *              | 'bd-dojo-spar' { opp, seed, bestOf } | 'bd-dojo-gauntlet' { mode, seed }
 *              | 'bd-slot-save' { slot } | 'bd-slot-load' { slot }
 *   Lab -> HUD : 'bd-config-sync' { config } | 'bd-history-sync' { canUndo, canRedo }
 *              | 'bd-dojo-report' { kind, ... } | 'bd-slots-sync' { slots }
 */
const EVT_UNDO = 'bd-undo';
const EVT_REDO = 'bd-redo';
const EVT_SOFT_MUTATE = 'bd-soft-mutate';
const EVT_BREED = 'bd-breed';
const EVT_EVOLVE = 'bd-evolve';
const EVT_DOJO_SPAR = 'bd-dojo-spar';
const EVT_DOJO_GAUNTLET = 'bd-dojo-gauntlet';
const EVT_SLOT_SAVE = 'bd-slot-save';
const EVT_SLOT_LOAD = 'bd-slot-load';
const EVT_CONFIG_SYNC = 'bd-config-sync';
const EVT_HISTORY_SYNC = 'bd-history-sync';
const EVT_DOJO_REPORT = 'bd-dojo-report';
const EVT_SLOTS_SYNC = 'bd-slots-sync';
const EVT_SLOTS_REQ = 'bd-slots-request';
const EVT_DOJO_RECORDS_REQ = 'bd-dojo-records-request';

function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

/** True only when the full document CustomEvent API is usable (node + stubbed-DOM safe). */
function docEventsAvailable() {
  return typeof document !== 'undefined'
    && typeof document.addEventListener === 'function'
    && typeof document.removeEventListener === 'function'
    && typeof document.dispatchEvent === 'function'
    && typeof CustomEvent === 'function';
}

/** Dispose every geometry / material under an Object3D so rebuilds don't leak GPU memory. */
export function disposeObjectTree(obj) {
  obj.traverse(child => {
    if (child.isMesh || child.isLine || child.isPoints) {
      if (child.geometry) child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) if (m && typeof m.dispose === 'function') m.dispose();
    }
  });
}

// ─── Build Share Code (DNA) ──────────────────────────────────────────────────
// Versioned, key-ordered, URL-safe base64. Prefix: DWEEB1-
const SHARE_VERSION = 1;
const SHARE_PREFIX = 'DWEEB1-';

// Only these fields travel in the share code (build-only, no runtime state)
const SHARE_FIELDS = [
  'name',
  'shape',
  'width',
  'height',
  'depth',
  'primaryColor',
  'accentColor',
  'eyeColor',
  'eyeCount',
  'eyeSize',
  'eyeSpacing',
  'brows',
  'mouth',
  'appendage',
  'feet',
  'palette',
  'stats',
  'dna',
];

// Whitelists for validation
const VALID_SHAPES = new Set(BODY_SHAPES);
const VALID_APPENDAGES = new Set(APPENDAGES);
const VALID_FEET = new Set(FEET_TYPES);
const VALID_BROWS = new Set(BROW_STYLES);
const VALID_MOUTHS = new Set(MOUTH_STYLES);
const VALID_PALETTES = new Set(Object.keys(ELEMENTAL_PALETTES));

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function isValidColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}

// UTF-8 safe (names can contain emoji / accents, which raw btoa rejects).
function encodeBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeBase64Url(str) {
  const pad = str.length % 4;
  const padded = str + (pad === 0 ? '' : '='.repeat(4 - pad));
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class BuildADweebLab {
  constructor(scene, camera, renderer, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    this.group = new THREE.Group();
    this.group.name = 'BuildADweebLab';
    this.scene.add(this.group);

    // Undo/redo history: `history` is a stack of PRE-change config snapshots
    // (what to restore on undo); `redoStack` holds the states undone from.
    // Rapid slider ticks are coalesced into a single step via historyWindowMs.
    this.history = [];
    this.redoStack = [];
    this.historyWindowMs = opts.historyWindowMs ?? 1200;
    this._histArmed = true; // first edit after construction/undo always records

    this.config = this.loadConfig();
    this.turntableAngle = 0;
    this.autoRotate = true;
    this.clock = 0;
    this._popT = 1;    // spawn-pop animation progress (1 = settled)
    this._flashT = 0;  // pedestal rim flash on rebuild

    // Live fighter synced to lab mutations (DNA → collider, no reload) and
    // the active tournament bracket (null when no tournament is running).
    this.attachedFighter = null;
    this.tournament = this.loadTournament();

    this._buildStage();
    // Note: no seed snapshot — the first change records its own pre-change
    // state, so canUndo() is false until the user actually changes something.
    this.rebuildModel();

    // Self-wiring: answer HUD requests without the app shell having to know.
    this._onUndoReq = () => this.undo();
    this._onRedoReq = () => this.redo();
    this._onSoftMutateReq = () => this.softMutate();
    this._onBreedReq = e => this.breedWithPartner(e?.detail?.partner);
    this._onEvolveReq = e => this.evolve(e?.detail || {});
    this._onDojoSparReq = e => this.dojoSpar(e?.detail?.opp, e?.detail || {});
    this._onDojoGauntletReq = e => this.dojoGauntlet(e?.detail?.mode, e?.detail || {});
    this._onSlotSaveReq = e => this.saveSlot(e?.detail?.slot);
    this._onSlotLoadReq = e => this.loadSlot(e?.detail?.slot);
    this._onSlotsReq = () => this._emit(EVT_SLOTS_SYNC, { slots: this.getSlots() });
    this._onDojoRecordsReq = () => this._emit(EVT_DOJO_REPORT, { kind: 'records', records: this.getDojoRecords() });
    if (docEventsAvailable()) {
      document.addEventListener(EVT_UNDO, this._onUndoReq);
      document.addEventListener(EVT_REDO, this._onRedoReq);
      document.addEventListener(EVT_SOFT_MUTATE, this._onSoftMutateReq);
      document.addEventListener(EVT_BREED, this._onBreedReq);
      document.addEventListener(EVT_EVOLVE, this._onEvolveReq);
      document.addEventListener(EVT_DOJO_SPAR, this._onDojoSparReq);
      document.addEventListener(EVT_DOJO_GAUNTLET, this._onDojoGauntletReq);
      document.addEventListener(EVT_SLOT_SAVE, this._onSlotSaveReq);
      document.addEventListener(EVT_SLOT_LOAD, this._onSlotLoadReq);
      document.addEventListener(EVT_SLOTS_REQ, this._onSlotsReq);
      document.addEventListener(EVT_DOJO_RECORDS_REQ, this._onDojoRecordsReq);
    }
  }

  _emit(name, detail) {
    if (!docEventsAvailable()) return;
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  _emitHistory() {
    this._emit(EVT_HISTORY_SYNC, { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  _emitConfig() {
    this._emit(EVT_CONFIG_SYNC, { config: deepClone(this.config) });
    this._emitHistory();
  }

  /**
   * Record a pre-change snapshot. Call BEFORE mutating this.config.
   * Continuous callers (sliders) coalesce into one step; discrete ops force.
   * Any new change discards the redo tail.
   */
  _recordChange(force = false) {
    this.redoStack.length = 0;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!force && !this._histArmed && now - this._lastHistPush < this.historyWindowMs) return;
    this._histArmed = false;
    this._lastHistPush = now;
    this.history.push(deepClone(this.config));
    if (this.history.length > 60) this.history.shift();
  }

  canUndo() { return this.history.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.canUndo()) return null;
    this.redoStack.push(deepClone(this.config));
    this.config = this.history.pop();
    this._histArmed = true; // next edit starts a fresh step
    this.rebuildModel();
    this.saveConfig();
    this._emitConfig();
    return deepClone(this.config);
  }

  redo() {
    if (!this.canRedo()) return null;
    this.history.push(deepClone(this.config));
    if (this.history.length > 60) this.history.shift();
    this.config = this.redoStack.pop();
    this._histArmed = true;
    this.rebuildModel();
    this.saveConfig();
    this._emitConfig();
    return deepClone(this.config);
  }

  _buildStage() {
    // 1. Sleek circular showroom pedestal
    const pedestalGeo = new THREE.CylinderGeometry(1.6, 1.8, 0.28, 32);
    const pedestalMat = toonMat({ color: 0x221a36, flatShading: true });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.set(0, -0.14, 0);
    pedestal.receiveShadow = true;
    noOutline(pedestal);
    this.group.add(pedestal);

    // Glowing rim ring (flashes white briefly whenever the model rebuilds)
    const ringGeo = new THREE.TorusGeometry(1.62, 0.04, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.01, 0);
    noOutline(ring);
    this.group.add(ring);
    this.ring = ring;
    this._ringBaseColor = new THREE.Color(0xffd23f);
    this._ringFlashColor = new THREE.Color(0xffffff);

    // Dedicated showcase lighting
    this.lights = new THREE.Group();
    const spot = new THREE.SpotLight(0xffffff, 2.8, 18, Math.PI / 4, 0.4);
    spot.position.set(3, 7, 5);
    spot.target = this.group;
    const rim = new THREE.DirectionalLight(0x3fa9ff, 1.2);
    rim.position.set(-4, 3, -4);
    const fill = new THREE.AmbientLight(0xfff5ea, 1.4);
    this.lights.add(spot, rim, fill);
    this.group.add(this.lights);

    // 2. Lab atmosphere: drifting dust motes in the spotlight cone.
    const DUST_N = 90;
    const dustPos = new Float32Array(DUST_N * 3);
    this._dustSpeed = new Float32Array(DUST_N);
    for (let i = 0; i < DUST_N; i++) {
      const r = Math.sqrt(Math.random()) * 2.6;
      const a = Math.random() * Math.PI * 2;
      dustPos[i * 3] = Math.cos(a) * r;
      dustPos[i * 3 + 1] = Math.random() * 3.2;
      dustPos[i * 3 + 2] = Math.sin(a) * r;
      this._dustSpeed[i] = 0.08 + Math.random() * 0.22;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    this._dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0xffe9a3, size: 0.035, transparent: true, opacity: 0.65,
      depthWrite: false,
    }));
    noOutline(this._dust);
    this.group.add(this._dust);

    // 3. Hologram ring: slow-spinning accent ring under the pedestal.
    const holoGeo = new THREE.TorusGeometry(2.05, 0.025, 8, 48);
    this._holo = new THREE.Mesh(holoGeo, new THREE.MeshBasicMaterial({
      color: 0x3fa9ff, transparent: true, opacity: 0.5,
    }));
    this._holo.rotation.x = Math.PI / 2;
    this._holo.position.set(0, -0.26, 0);
    noOutline(this._holo);
    this.group.add(this._holo);

    // 4. Mutation scan beam: a translucent plane that sweeps upward over the
    // model on every discrete rebuild (presets / mutations / breed / evolve).
    this._scanT = 0; // 1 -> 0 sweep progress
    this._scan = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({
        color: 0x7df9ff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this._scan.rotation.x = -Math.PI / 2; // horizontal sweep plane
    noOutline(this._scan);
    this.group.add(this._scan);
  }

  /**
   * Rebuild the 3D model from the current config.
   * @param {object} juice - spawn-pop + rim flash; enabled for discrete ops
   *   (preset / mutate / undo), disabled for continuous slider drags.
   */
  rebuildModel({ juice = true } = {}) {
    if (this.currentModelRoot) {
      this.group.remove(this.currentModelRoot);
      // Free GPU buffers of the discarded tree — without this, every slider
      // tick leaks ~30 geometries + materials.
      disposeObjectTree(this.currentModelRoot);
      this.currentModelRoot = null;
    }

    this.modelInstance = buildCustomDweebModel(this.config);
    this.currentModelRoot = this.modelInstance.root;
    this.group.add(this.currentModelRoot);

    // Merge: milestone #4's DNA-to-collider/appendage live-fighter sync and
    // wave-2's mutation juice (spawn-pop + rim flash + scan sweep) both run
    // after every rebuild.
    if (this.attachedFighter) {
      this.modelInstance.root.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(this.modelInstance.root);
      refreshDweebCollider(this.attachedFighter, this.config, bounds);
      installAppendageGameplay(this.attachedFighter, this.config);
    }

    if (juice) {
      // Juice: spawn-pop + rim flash + scan-beam sweep so mutations feel impactful.
      this._popT = 0;
      this._flashT = 1;
      this._scanT = 1;
    }
  }

  /**
   * Attach a live fighter dweeb: every lab mutation (mutateRandom /
   * updateConfig / applyPreset) synchronously refreshes its physics collider
   * bounds and appendage gameplay to match the new DNA. Pass null to detach.
   */
  attachFighter(dweeb) {
    this.attachedFighter = dweeb || null;
    if (this.attachedFighter && this.modelInstance) {
      this.modelInstance.root.updateWorldMatrix(true, true);
      refreshDweebCollider(this.attachedFighter, this.config,
        new THREE.Box3().setFromObject(this.modelInstance.root));
      installAppendageGameplay(this.attachedFighter, this.config);
    }
    return this.attachedFighter;
  }

  detachFighter() {
    this.attachedFighter = null;
  }

  updateConfig(patch) {
    this._recordChange(); // coalesced for continuous slider drags
    this.config = {
      ...this.config,
      ...patch,
      stats: { ...this.config.stats, ...(patch.stats || {}) },
      dna: { ...this.config.dna, ...(patch.dna || {}) },
    };
    this.rebuildModel({ juice: false });
    this.saveConfig();
    this._emitHistory();
  }

  applyPreset(presetKey) {
    const preset = ARCHETYPE_PRESETS[presetKey];
    if (!preset) return null;
    this._recordChange(true);
    this.config = {
      ...this.config,
      ...preset,
      stats: {
        ...(this.config.stats || {}),
        ...(preset.stats || {}),
        mass: preset.mass ?? preset.stats?.mass ?? this.config.stats?.mass ?? 3.0,
        armor: preset.armor ?? preset.stats?.armor ?? this.config.stats?.armor ?? 1.0,
        speed: preset.speed ?? preset.stats?.speed ?? this.config.stats?.speed ?? 1.0,
        jump: preset.jump ?? preset.stats?.jump ?? this.config.stats?.jump ?? 1.0,
      },
      dna: {
        ...(this.config.dna || {}),
        ...(preset.dna || preset.DNA || {}),
      },
    };
    if (preset.brow && !this.config.brows) this.config.brows = preset.brow;
    if (preset.appendages && !this.config.appendage) this.config.appendage = preset.appendages;
    this.rebuildModel();
    this.saveConfig();
    this._emitConfig();
    return this.config;
  }

  mutateRandom(rng = Math.random) {
    this._recordChange(true);
    this.config = randomizeConfig(rng);
    this.rebuildModel();
    this.saveConfig();
    this._emitConfig();
    return this.config;
  }

  /**
   * Soft mutation: evolves the CURRENT build instead of replacing it.
   * Keeps the creature's identity (name, usually shape) while jittering
   * proportions, colors, gear, stats and DNA — the "one more roll" button.
   */
  softMutate() {
    this._recordChange(true);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v.toFixed(2))));
    const jitter = (v, amt, min, max, fb) => clamp((Number.isFinite(v) ? v : fb) + (Math.random() * 2 - 1) * amt, min, max);
    const maybeNew = (current, options, chance) => (Math.random() < chance ? pick(options) : current);
    const shiftColor = hex => {
      try {
        const c = new THREE.Color(hex);
        c.offsetHSL((Math.random() * 2 - 1) * 0.06, (Math.random() * 2 - 1) * 0.12, (Math.random() * 2 - 1) * 0.08);
        return `#${c.getHexString()}`;
      } catch { return hex; }
    };

    const cfg = this.config;
    const stats = cfg.stats || {};
    const dna = cfg.dna || {};
    this.config = {
      ...cfg,
      shape: maybeNew(cfg.shape, BODY_SHAPES, 0.22),
      width: jitter(cfg.width, 0.22, 0.5, 1.8, 1.0),
      height: jitter(cfg.height, 0.22, 0.5, 1.8, 1.0),
      depth: jitter(cfg.depth, 0.22, 0.5, 1.8, 1.0),
      primaryColor: shiftColor(cfg.primaryColor || '#ff4d5e'),
      accentColor: shiftColor(cfg.accentColor || '#ffd23f'),
      eyeCount: maybeNew(cfg.eyeCount ?? 2, [1, 2, 2, 3, 4], 0.25),
      eyeSize: jitter(cfg.eyeSize, 0.25, 0.5, 1.8, 1.0),
      eyeSpacing: jitter(cfg.eyeSpacing, 0.25, 0.4, 2.0, 1.0),
      brows: maybeNew(cfg.brows, BROW_STYLES, 0.25),
      mouth: maybeNew(cfg.mouth, MOUTH_STYLES, 0.25),
      appendage: maybeNew(cfg.appendage, APPENDAGES, 0.3),
      feet: maybeNew(cfg.feet, FEET_TYPES, 0.25),
      stats: {
        speed: jitter(stats.speed, 0.15, 0.7, 1.4, 1.0),
        mass: jitter(stats.mass, 0.5, 1.8, 4.5, 3.0),
        jump: jitter(stats.jump, 0.15, 0.8, 1.4, 1.0),
        armor: jitter(stats.armor, 0.15, 0.8, 1.4, 1.0),
      },
      dna: {
        confidence: jitter(dna.confidence, 0.2, 0.1, 1.0, 0.8),
        aimAccuracy: jitter(dna.aimAccuracy, 0.2, 0.1, 1.0, 0.7),
        scavenge: jitter(dna.scavenge, 0.2, 0.1, 1.0, 0.6),
        agility: jitter(dna.agility, 0.2, 0.3, 1.0, 0.7),
      },
    };

    this.rebuildModel();
    this.saveConfig();
    this._emitConfig();
    return this.config;
  }

  /**
   * Breed the current build with a partner (opponent-select key or a raw
   * config). The child blends both parents' genes. Recorded as one undo step.
   */
  breedWithPartner(partnerKey = 'random', rng = Math.random) {
    const partner = (partnerKey && typeof partnerKey === 'object')
      ? partnerKey
      : dojoSparOpponent(partnerKey, this.config, rng);
    const before = computeBattleProfile(this.config).rating;
    this._recordChange(true);
    this.config = breedConfigs(this.config, partner, rng);
    const after = computeBattleProfile(this.config).rating;
    this.rebuildModel();
    this.saveConfig();
    this._emitConfig();
    this._emit(EVT_DOJO_REPORT, {
      kind: 'breed',
      parentA: this.config.name,
      partnerName: partner.name || 'Partner',
      ratingBefore: before,
      ratingAfter: after,
      records: this.getDojoRecords(),
    });
    return this.config;
  }

  /**
   * Guided evolution: hill-climb the current build toward a fight-rating
   * target. Recorded as one undo step.
   */
  evolve({ rounds = 12, target = 80, rng = Math.random } = {}) {
    const before = computeBattleProfile(this.config).rating;
    this._recordChange(true);
    const result = evolveBuild(this.config, { rounds, target, rng });
    this.config = result.config;
    this.rebuildModel();
    this.saveConfig();
    this._emitConfig();
    this._emit(EVT_DOJO_REPORT, {
      kind: 'evolve',
      ratingBefore: before,
      ratingAfter: result.rating,
      roundsRun: result.roundsRun,
      history: result.history,
      records: this.getDojoRecords(),
    });
    return result;
  }

  // ─── Dojo (simulated bouts) ──────────────────────────────────────────────

  _seededRng(seed) {
    return seed === undefined || seed === null || seed === '' ? Math.random : createRng(Number(seed));
  }

  _recordSparOutcome(bout) {
    const rec = this.getDojoRecords();
    rec.sparWins += bout.winsA;
    rec.sparLosses += bout.winsB;
    rec.sparDraws += bout.draws;
    this._saveDojoRecords(rec);
    return rec;
  }

  /** Simulated best-of-N spar vs an opponent key from the HUD picker. */
  dojoSpar(oppKey = 'random', { seed = null, bestOf = 3 } = {}) {
    const rng = this._seededRng(seed);
    const opp = dojoSparOpponent(oppKey, this.config, rng);
    const bout = simulateBout(this.config, opp, { bestOf, rng });
    const records = this._recordSparOutcome(bout);
    this._emit(EVT_DOJO_REPORT, {
      kind: 'spar',
      oppKey,
      player: buildSnapshot(this.config),
      opponent: buildSnapshot(opp),
      bout,
      records,
    });
    return { opp, bout, records };
  }

  /** Simulated gauntlet: 'ladder' (6 tiers) or 'endless' (scaling mutants). */
  dojoGauntlet(mode = 'ladder', { seed = null, maxRounds = 25 } = {}) {
    const rng = this._seededRng(seed);
    const rec = this.getDojoRecords();
    let result;
    if (mode === 'endless') {
      result = runEndlessGauntlet(this.config, { rng, maxRounds });
      rec.bestEndless = Math.max(rec.bestEndless, result.cleared);
    } else {
      result = runGauntlet(this.config, { rng });
      rec.bestLadder = Math.max(rec.bestLadder, result.cleared);
      if (result.champion) rec.ladderClears += 1;
    }
    this._saveDojoRecords(rec);
    this._emit(EVT_DOJO_REPORT, { kind: 'gauntlet', mode, ...result, records: rec });
    return { ...result, records: rec };
  }

  getDojoRecords() {
    const fallback = { sparWins: 0, sparLosses: 0, sparDraws: 0, bestLadder: 0, bestEndless: 0, ladderClears: 0 };
    try {
      const raw = localStorage.getItem(DOJO_RECORDS_KEY);
      if (raw) return { ...fallback, ...JSON.parse(raw) };
    } catch { /* private mode */ }
    return fallback;
  }

  _saveDojoRecords(rec) {
    try {
      localStorage.setItem(DOJO_RECORDS_KEY, JSON.stringify(rec));
    } catch { /* private mode */ }
  }

  // ─── Build slots ─────────────────────────────────────────────────────────

  getSlots() {
    const slots = {};
    try {
      const raw = localStorage.getItem(SLOTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (let i = 1; i <= MAX_SLOTS; i++) {
          if (parsed[i]?.config) slots[i] = { name: parsed[i].name || 'Saved build', savedAt: parsed[i].savedAt || 0 };
        }
      }
    } catch { /* private mode */ }
    return slots;
  }

  _readSlotsRaw() {
    try {
      const raw = localStorage.getItem(SLOTS_KEY);
      if (raw) return JSON.parse(raw) || {};
    } catch { /* private mode */ }
    return {};
  }

  saveSlot(slot) {
    const i = Number(slot);
    if (!Number.isInteger(i) || i < 1 || i > MAX_SLOTS) return null;
    const all = this._readSlotsRaw();
    all[i] = { name: this.config.name || 'Saved build', savedAt: Date.now(), config: deepClone(this.config) };
    try { localStorage.setItem(SLOTS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
    this._emit(EVT_SLOTS_SYNC, { slots: this.getSlots() });
    return all[i];
  }

  loadSlot(slot) {
    const i = Number(slot);
    if (!Number.isInteger(i) || i < 1 || i > MAX_SLOTS) return null;
    const entry = this._readSlotsRaw()[i];
    if (!entry?.config) return null;
    this._recordChange(true);
    this.config = {
      ...deepClone(DEFAULT_BUILD_CONFIG),
      ...deepClone(entry.config),
      stats: { ...DEFAULT_BUILD_CONFIG.stats, ...(entry.config.stats || {}) },
      dna: { ...DEFAULT_BUILD_CONFIG.dna, ...(entry.config.dna || {}) },
    };
    this.rebuildModel();
    this.saveConfig();
    this._emitConfig();
    return this.config;
  }

  /** Export the current build as a compact share code: DWEEB1-<base64url>. */
  exportBuildCode() {
    try {
      const payload = { v: SHARE_VERSION };
      for (const key of SHARE_FIELDS) {
        const val = this.config?.[key];
        if (val !== undefined) {
          // Deep clone stats/dna to avoid reference issues
          if (key === 'stats' || key === 'dna') {
            payload[key] = { ...val };
          } else {
            payload[key] = val;
          }
        }
      }
      const json = JSON.stringify(payload);
      const code = SHARE_PREFIX + encodeBase64Url(json);
      return code;
    } catch (e) {
      console.warn('[BuildADweebLab] exportBuildCode failed', e);
      return null;
    }
  }

  /**
   * Import a build from a share code. Validates version, merges over DEFAULT_BUILD_CONFIG,
   * clamps numeric ranges, whitelists enums, then calls updateConfig.
   * Returns { ok: true, config } on success, or { ok: false, error: '...' } on failure.
   */
  importBuildCode(code) {
    try {
      if (!code || typeof code !== 'string') {
        return { ok: false, error: 'Empty or invalid share code.' };
      }
      const trimmed = code.trim();
      if (!trimmed.startsWith(SHARE_PREFIX)) {
        return { ok: false, error: 'Not a valid DWEEB share code (missing prefix).' };
      }
      const b64 = trimmed.slice(SHARE_PREFIX.length);
      let json;
      try {
        json = decodeBase64Url(b64);
      } catch {
        return { ok: false, error: 'Corrupted share code (bad base64).' };
      }
      let payload;
      try {
        payload = JSON.parse(json);
      } catch {
        return { ok: false, error: 'Corrupted share code (bad JSON).' };
      }
      if (!payload || typeof payload !== 'object') {
        return { ok: false, error: 'Corrupted share code (not an object).' };
      }
      if (payload.v !== SHARE_VERSION) {
        return { ok: false, error: `Unsupported share code version ${payload.v} (expected ${SHARE_VERSION}).` };
      }

      // Start from defaults, then merge validated payload
      const merged = { ...DEFAULT_BUILD_CONFIG };

      // Scalar fields with clamping/validation
      if (typeof payload.name === 'string') merged.name = payload.name.slice(0, 18);
      if (VALID_SHAPES.has(payload.shape)) merged.shape = payload.shape;
      if (typeof payload.width === 'number') merged.width = clamp(payload.width, 0.5, 1.8);
      if (typeof payload.height === 'number') merged.height = clamp(payload.height, 0.5, 1.8);
      if (typeof payload.depth === 'number') merged.depth = clamp(payload.depth, 0.5, 1.8);
      if (isValidColor(payload.primaryColor)) merged.primaryColor = payload.primaryColor;
      if (isValidColor(payload.accentColor)) merged.accentColor = payload.accentColor;
      if (isValidColor(payload.eyeColor)) merged.eyeColor = payload.eyeColor;
      if (Number.isInteger(payload.eyeCount)) merged.eyeCount = clamp(payload.eyeCount, 1, 4);
      if (typeof payload.eyeSize === 'number') merged.eyeSize = clamp(payload.eyeSize, 0.5, 1.8);
      if (typeof payload.eyeSpacing === 'number') merged.eyeSpacing = clamp(payload.eyeSpacing, 0.5, 2.0);
      if (VALID_BROWS.has(payload.brows)) merged.brows = payload.brows;
      if (VALID_MOUTHS.has(payload.mouth)) merged.mouth = payload.mouth;
      if (VALID_APPENDAGES.has(payload.appendage)) merged.appendage = payload.appendage;
      if (VALID_FEET.has(payload.feet)) merged.feet = payload.feet;
      if (VALID_PALETTES.has(payload.palette)) merged.palette = payload.palette;

      // Stats object
      if (payload.stats && typeof payload.stats === 'object') {
        merged.stats = { ...DEFAULT_BUILD_CONFIG.stats };
        const s = payload.stats;
        if (typeof s.speed === 'number') merged.stats.speed = clamp(s.speed, 0.5, 1.5);
        if (typeof s.mass === 'number') merged.stats.mass = clamp(s.mass, 1.8, 4.5);
        if (typeof s.jump === 'number') merged.stats.jump = clamp(s.jump, 0.5, 1.5);
        if (typeof s.armor === 'number') merged.stats.armor = clamp(s.armor, 0.5, 1.5);
      }

      // DNA object
      if (payload.dna && typeof payload.dna === 'object') {
        merged.dna = { ...DEFAULT_BUILD_CONFIG.dna };
        const d = payload.dna;
        if (typeof d.confidence === 'number') merged.dna.confidence = clamp(d.confidence, 0.1, 1.0);
        if (typeof d.aimAccuracy === 'number') merged.dna.aimAccuracy = clamp(d.aimAccuracy, 0.1, 1.0);
        if (typeof d.scavenge === 'number') merged.dna.scavenge = clamp(d.scavenge, 0.1, 1.0);
        if (typeof d.agility === 'number') merged.dna.agility = clamp(d.agility, 0.3, 1.0);
      }

      // Apply to lab (rebuilds model, saves to storage)
      this.updateConfig(merged);
      return { ok: true, config: merged };
    } catch (e) {
      console.warn('[BuildADweebLab] importBuildCode failed', e);
      return { ok: false, error: 'Import failed: ' + (e?.message || 'unknown error') };
    }
  }

  // ─── Colosseum tournament ladder ──────────────────────────────────────────

  /** Start a new tournament bracket with the lab's current build. */
  startTournament() {
    this.tournament = new TournamentBracket(this.config);
    this.saveTournament();
    return this.tournament.state();
  }

  /** Champion config for the player's pending bout (null when none). */
  tournamentOpponent() {
    return this.tournament ? this.tournament.opponentForPlayer() : null;
  }

  /**
   * Record the player's bout result and advance the bracket. Persists across
   * the workshop ⇄ arena round-trip; cleared when the run ends.
   */
  recordTournamentResult(playerWon) {
    if (!this.tournament) return null;
    const state = this.tournament.recordPlayerResult(!!playerWon);
    if (state.status === 'in') this.saveTournament();
    else this.clearTournamentStorage();
    return state;
  }

  /** Plain bracket summary for the HUD (null when no tournament active). */
  tournamentState() {
    return this.tournament ? this.tournament.state() : null;
  }

  abandonTournament() {
    this.tournament = null;
    this.clearTournamentStorage();
  }

  saveTournament() {
    try {
      if (this.tournament) localStorage.setItem(TOURNAMENT_KEY, JSON.stringify(this.tournament.toJSON()));
    } catch { /* private mode */ }
  }

  loadTournament() {
    try {
      const saved = localStorage.getItem(TOURNAMENT_KEY);
      if (!saved) return null;
      const t = TournamentBracket.fromJSON(JSON.parse(saved));
      return t.status === 'in' ? t : null;
    } catch { /* corrupted / private mode */ }
    return null;
  }

  clearTournamentStorage() {
    try { localStorage.removeItem(TOURNAMENT_KEY); } catch { /* private mode */ }
  }

  update(dt) {
    this.clock += dt;
    if (this.autoRotate && this.currentModelRoot) {
      this.turntableAngle += dt * 0.8;
      this.currentModelRoot.rotation.y = this.turntableAngle;
    }

    // Spawn-pop: overshoot scale ease on every rebuild.
    if (this.currentModelRoot && this._popT < 1) {
      this._popT = Math.min(1, this._popT + dt * 2.4);
      const t = this._popT;
      const c1 = 1.70158, c3 = c1 + 1;
      const ease = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      this.currentModelRoot.scale.setScalar(Math.max(0.05, 0.35 + 0.65 * ease));
    }

    // Rim flash decay.
    if (this.ring && this._flashT > 0) {
      this._flashT = Math.max(0, this._flashT - dt * 2.2);
      this.ring.material.color.copy(this._ringBaseColor).lerp(this._ringFlashColor, this._flashT);
    }

    // Scan-beam sweep: plane rises 0 -> 2.6 while fading out.
    if (this._scan && this._scanT > 0) {
      this._scanT = Math.max(0, this._scanT - dt * 1.6);
      const p = 1 - this._scanT;
      this._scan.position.y = 0.1 + p * 2.5;
      this._scan.material.opacity = 0.35 * Math.sin(p * Math.PI);
      this._scan.rotation.z += dt * 1.2;
    } else if (this._scan) {
      this._scan.material.opacity = 0;
    }

    // Dust motes drift upward and wrap; holo ring spins + breathes.
    if (this._dust) {
      const pos = this._dust.geometry.attributes.position;
      for (let i = 0; i < this._dustSpeed.length; i++) {
        let y = pos.getY(i) + this._dustSpeed[i] * dt;
        if (y > 3.2) y = 0;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    if (this._holo) {
      this._holo.rotation.z += dt * 0.5;
      this._holo.material.opacity = 0.35 + 0.2 * Math.sin(this.clock * 2.2);
    }

    if (this.modelInstance) {
      this.modelInstance.animate(this.clock);
    }
  }

  saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch { /* private mode */ }
  }

  loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // Deep-merge stats/dna so partial or older saves can't wipe subfields.
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_BUILD_CONFIG,
          ...parsed,
          stats: { ...DEFAULT_BUILD_CONFIG.stats, ...(parsed.stats || {}) },
          dna: { ...DEFAULT_BUILD_CONFIG.dna, ...(parsed.dna || {}) },
        };
      }
    } catch { /* fallback */ }
    return { ...DEFAULT_BUILD_CONFIG };
  }

  dispose() {
    if (docEventsAvailable()) {
      document.removeEventListener(EVT_UNDO, this._onUndoReq);
      document.removeEventListener(EVT_REDO, this._onRedoReq);
      document.removeEventListener(EVT_SOFT_MUTATE, this._onSoftMutateReq);
      document.removeEventListener(EVT_BREED, this._onBreedReq);
      document.removeEventListener(EVT_EVOLVE, this._onEvolveReq);
      document.removeEventListener(EVT_DOJO_SPAR, this._onDojoSparReq);
      document.removeEventListener(EVT_DOJO_GAUNTLET, this._onDojoGauntletReq);
      document.removeEventListener(EVT_SLOT_SAVE, this._onSlotSaveReq);
      document.removeEventListener(EVT_SLOT_LOAD, this._onSlotLoadReq);
      document.removeEventListener(EVT_SLOTS_REQ, this._onSlotsReq);
      document.removeEventListener(EVT_DOJO_RECORDS_REQ, this._onDojoRecordsReq);
    }
    // Free all GPU buffers held by the stage + model.
    disposeObjectTree(this.group);
    this.scene.remove(this.group);
    this.currentModelRoot = null;
    this.modelInstance = null;
  }
}
