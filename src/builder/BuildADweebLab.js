// BuildADweebLab.js — 3D Turntable Workshop & Creature Customizer
//
// Manages the real-time 3D pedestal, lighting, live mesh regeneration,
// procedural random mutation, and configuration persistence for Build-A-Dweeb.

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
  refreshDweebCollider,
  installAppendageGameplay,
} from './CustomDweebModel.js';
import { TournamentBracket } from './Tournament.js';

const STORAGE_KEY = 'dweebs-custom-build';
const TOURNAMENT_KEY = 'dweebs-tournament-v1';

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
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    this.group = new THREE.Group();
    this.group.name = 'BuildADweebLab';
    this.scene.add(this.group);

    this.config = this.loadConfig();
    this.turntableAngle = 0;
    this.autoRotate = true;
    this.clock = 0;

    // Live fighter synced to lab mutations (DNA → collider, no reload) and
    // the active tournament bracket (null when no tournament is running).
    this.attachedFighter = null;
    this.tournament = this.loadTournament();

    this._buildStage();
    this.rebuildModel();
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

    // Glowing rim ring
    const ringGeo = new THREE.TorusGeometry(1.62, 0.04, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.01, 0);
    noOutline(ring);
    this.group.add(ring);

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
  }

  rebuildModel() {
    if (this.currentModelRoot) {
      this.group.remove(this.currentModelRoot);
      this.currentModelRoot = null;
    }

    this.modelInstance = buildCustomDweebModel(this.config);
    this.currentModelRoot = this.modelInstance.root;
    this.group.add(this.currentModelRoot);

    // DNA mutation → live fighter sync: refresh the attached fighter's
    // bounding-box collider and appendage gameplay synchronously so a
    // mutation never needs a scene reload to take effect physically.
    if (this.attachedFighter) {
      this.modelInstance.root.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(this.modelInstance.root);
      refreshDweebCollider(this.attachedFighter, this.config, bounds);
      installAppendageGameplay(this.attachedFighter, this.config);
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
    this.config = {
      ...this.config,
      ...patch,
      stats: { ...this.config.stats, ...(patch.stats || {}) },
      dna: { ...this.config.dna, ...(patch.dna || {}) },
    };
    this.rebuildModel();
    this.saveConfig();
  }

  applyPreset(presetKey) {
    const preset = ARCHETYPE_PRESETS[presetKey];
    if (!preset) return null;
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
    return this.config;
  }

  mutateRandom() {
    const randomHex = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const randRange = (min, max) => Number((min + Math.random() * (max - min)).toFixed(2));

    const titles = ['Mecha', 'Giga', 'Hyper', 'Turbo', 'Shadow', 'Cosmic', 'Pixel', 'Savage', 'Bouncy', 'Dr.'];
    const names = ['Goblin', 'Brawler', 'Pugilist', 'Titan', 'Gremlin', 'Crusher', 'Slugger', 'Menace', 'Bean'];

    const newConfig = {
      name: `${pick(titles)} ${pick(names)}`,
      shape: pick(BODY_SHAPES),
      width: randRange(0.6, 1.6),
      height: randRange(0.6, 1.5),
      depth: randRange(0.7, 1.4),
      primaryColor: randomHex(),
      accentColor: randomHex(),
      eyeColor: '#14101c',
      eyeCount: pick([1, 2, 2, 2, 3, 4]),
      eyeSize: randRange(0.6, 1.5),
      eyeSpacing: randRange(0.7, 1.4),
      brows: pick(BROW_STYLES),
      mouth: pick(MOUTH_STYLES),
      appendage: pick(APPENDAGES),
      feet: pick(FEET_TYPES),
      stats: {
        speed: randRange(0.7, 1.3),
        mass: randRange(2.0, 4.2),
        jump: randRange(0.8, 1.3),
        armor: randRange(0.8, 1.2),
      },
      dna: {
        confidence: randRange(0.2, 1.0),
        aimAccuracy: randRange(0.2, 0.95),
        scavenge: randRange(0.1, 0.9),
        agility: randRange(0.4, 0.95),
      },
    };

    this.config = newConfig;
    this.rebuildModel();
    this.saveConfig();
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
      if (saved) return { ...DEFAULT_BUILD_CONFIG, ...JSON.parse(saved) };
    } catch { /* fallback */ }
    return { ...DEFAULT_BUILD_CONFIG };
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
