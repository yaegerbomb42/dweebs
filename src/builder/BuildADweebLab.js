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
  refreshDweebCollider,
  installAppendageGameplay,
} from './CustomDweebModel.js';
import { TournamentBracket, gauntletOpponent } from './Tournament.js';

const STORAGE_KEY = 'dweebs-custom-build';
const TOURNAMENT_KEY = 'dweebs-tournament-v1';
const GAUNTLET_KEY = 'dweebs-gauntlet-v1';

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
    this.gauntlet = this.loadGauntlet();

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

  // ─── Endless Gauntlet: wave survival ──────────────────────────────────────────
  // State lives in localStorage (see gauntlet* helpers below) because the lab is disposed while
  // the arena bout runs; main.js records the bout result straight into storage at match end.

  /** Start a new endless gauntlet run with the lab's current build. */
  startGauntlet() {
    this.gauntlet = { wave: 1, best: gauntletBest(), alive: true, opponent: gauntletOpponent(1), lastCleared: 0 };
    saveGauntletState(this.gauntlet);
    return this.gauntletState();
  }

  /** Champion config for the current wave (null when no gauntlet active). */
  gauntletOpponent() {
    if (!this.gauntlet?.alive) return null;
    if (!this.gauntlet.opponent) { this.gauntlet.opponent = gauntletOpponent(this.gauntlet.wave); saveGauntletState(this.gauntlet); }
    return this.gauntlet.opponent;
  }

  /** Plain gauntlet summary for the HUD (null when no gauntlet active). */
  gauntletState() {
    return this.gauntlet ? { ...this.gauntlet, best: Math.max(this.gauntlet.best || 0, gauntletBest()) } : null;
  }

  abandonGauntlet() {
    this.gauntlet = null;
    saveGauntletState(null);
  }

  loadGauntlet() {
    return loadGauntletState();
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

// ─── Endless Gauntlet persistence (module level so main.js can record results) ───
const GAUNTLET_BEST_KEY = 'dweebs-gauntlet-best';

export function loadGauntletState() {
  try {
    const g = JSON.parse(localStorage.getItem(GAUNTLET_KEY) || 'null');
    return g && typeof g.wave === 'number' ? g : null;
  } catch { return null; } // corrupted / private mode
}

export function saveGauntletState(g) {
  try {
    if (g) localStorage.setItem(GAUNTLET_KEY, JSON.stringify(g));
    else localStorage.removeItem(GAUNTLET_KEY);
  } catch { /* private mode */ }
}

export function gauntletBest() {
  try { return Number(localStorage.getItem(GAUNTLET_BEST_KEY)) || 0; } catch { return 0; }
}

/**
 * Record a finished gauntlet bout. Win: bank the wave, roll a tougher champion for the next one.
 * Loss: the run ends (kept in storage, flagged dead, so the lab can show where you fell).
 * Returns the new state, or null when no run is active.
 */
export function recordGauntletBout(playerWon) {
  const g = loadGauntletState();
  if (!g?.alive) return null;
  if (playerWon) {
    g.lastCleared = g.wave;
    g.wave += 1;
    g.opponent = gauntletOpponent(g.wave);
  } else {
    g.alive = false;
  }
  const cleared = playerWon ? g.lastCleared : g.wave - 1;
  g.best = Math.max(g.best || 0, cleared, gauntletBest());
  try { localStorage.setItem(GAUNTLET_BEST_KEY, String(g.best)); } catch { /* private mode */ }
  saveGauntletState(g);
  return g;
}
