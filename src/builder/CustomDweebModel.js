// CustomDweebModel.js — Procedural 3D Low-Poly Mesh Generator for Build-A-Dweeb
//
// Dynamically constructs low-poly faceted cartoon bodies, custom eye layouts,
// expressive eyebrows, mouths, physics-reactive appendages and stylized limbs.
// Designed to render both in the interactive 3D workshop turntable and in the arena.

import * as THREE from 'three';
import { toonMat, noOutline } from '../render/Toon.js';

export const BODY_SHAPES = ['blob', 'cube', 'spiky', 'star', 'chonk', 'capsule'];
export const APPENDAGES = ['none', 'horns', 'antennae', 'bunny_ears', 'boxing_gloves', 'plungers', 'spikes', 'tail',
  'dragon_wings', 'anvil_tail', 'magnet_eyes', 'spring_stompers', 'bouncy_belly'];
export const FEET_TYPES = ['pegs', 'coils', 'stompers'];
export const BROW_STYLES = ['angry', 'derpy', 'confident', 'none'];
export const MOUTH_STYLES = ['grin', 'teeth', 'open'];

// Elemental color palettes — unlocked through tournament / combat progression.
// Each entry carries its unlock condition as data (see paletteUnlocked below).
export const ELEMENTAL_PALETTES = {
  ember: {
    name: 'Ember', primaryColor: '#ff4d00', accentColor: '#ffd23f', eyeColor: '#fff3d6',
    unlock: 'Enter the tournament ladder', unlockKey: 'tournament_entered',
  },
  frost: {
    name: 'Frost', primaryColor: '#7dd3fc', accentColor: '#e0f2fe', eyeColor: '#0c4a6e',
    unlock: 'Win a quarterfinal bout', unlockKey: 'qf_win',
  },
  storm: {
    name: 'Storm', primaryColor: '#7b2cbf', accentColor: '#00f5d4', eyeColor: '#ffffff',
    unlock: 'Reach the grand final', unlockKey: 'final_reached',
  },
  terra: {
    name: 'Terra', primaryColor: '#65a30d', accentColor: '#a16207', eyeColor: '#1a2e05',
    unlock: 'Win a semifinal bout', unlockKey: 'sf_win',
  },
  void: {
    name: 'Void', primaryColor: '#1e1b4b', accentColor: '#c026d3', eyeColor: '#f5d0fe',
    unlock: 'Win the tournament', unlockKey: 'tournament_win',
  },
  solar: {
    name: 'Solar', primaryColor: '#fbbf24', accentColor: '#fff7ed', eyeColor: '#7c2d12',
    unlock: 'Deal 500 total damage in the arena', unlockKey: 'damage_500',
  },
};

/** Apply an elemental palette's colors onto a build config (pure — returns a new config). */
export function applyElementalPalette(config = {}, paletteId) {
  const p = ELEMENTAL_PALETTES[paletteId];
  if (!p) return { ...config };
  return {
    ...config,
    primaryColor: p.primaryColor,
    accentColor: p.accentColor,
    eyeColor: p.eyeColor,
    palette: paletteId,
  };
}

/**
 * Whether an elemental palette is unlocked given the player's progression.
 * progress: { tournamentsEntered, roundsWon, finalsReached, tournamentsWon, totalDamageDealt }
 * Collected from tournament state + combat telemetry — never fabricated.
 */
export function paletteUnlocked(paletteId, progress = {}) {
  const p = ELEMENTAL_PALETTES[paletteId];
  if (!p) return false;
  switch (p.unlockKey) {
    case 'tournament_entered': return !!progress.tournamentsEntered;
    case 'qf_win': return (progress.roundsWon ?? 0) >= 1;
    case 'sf_win': return (progress.roundsWon ?? 0) >= 2;
    case 'final_reached': return !!progress.finalsReached;
    case 'tournament_win': return !!progress.tournamentsWon;
    case 'damage_500': return (progress.totalDamageDealt ?? 0) >= 500;
    default: return true;
  }
}

// ─── Appendage gameplay ──────────────────────────────────────────────────────
// Every appendage carries a gameplay descriptor. The four tournament appendages
// (dragon_wings, anvil_tail, magnet_eyes, spring_stompers) have real per-frame
// effects implemented in updateAppendageGameplay(); the legacy set is cosmetic.
export const APPENDAGE_GAMEPLAY = {
  none:          { label: 'None', desc: 'No appendage.' },
  horns:         { label: 'Horns', desc: 'Cosmetic.' },
  antennae:      { label: 'Antennae', desc: 'Cosmetic.' },
  bunny_ears:    { label: 'Bunny Ears', desc: 'Cosmetic.' },
  boxing_gloves: { label: 'Boxing Gloves', desc: 'Cosmetic.' },
  plungers:      { label: 'Plungers', desc: 'Cosmetic.' },
  spikes:        { label: 'Spikes', desc: 'Cosmetic.' },
  tail:          { label: 'Tail', desc: 'Cosmetic.' },
  dragon_wings: {
    label: 'Dragon Wings',
    desc: 'Glide recovery: capped sink rate + one bonus air jump per flight.',
    glideMaxFall: 6.5,
    speedMul: 1.05,
  },
  anvil_tail: {
    label: 'Anvil Tail',
    desc: 'Stun slams: hard landings stun nearby rivals.',
    stunRadius: 4.5,
    stunDuration: 1.2,
    stunPop: 4,
    slamMinFall: 8,
  },
  magnet_eyes: {
    label: 'Magnet Eyes',
    desc: 'Pulls nearby loose items toward you.',
    magnetRadius: 6,
    magnetPull: 2.2,
  },
  spring_stompers: {
    label: 'Spring Stompers',
    desc: '+35% jump power; hard landings bounce you back up.',
    jumpMul: 1.35,
    bounceMinFall: 4,
    bounceReturn: 0.45,
    bounceMax: 9,
  },
  bouncy_belly: {
    label: 'Bouncy Belly',
    desc: 'Compresses on hard landings, boings you up and knocks nearby rivals away.',
    bounceMinFall: 5,
    bounceReturn: 0.55,
    bounceMax: 10,
    bellyRadius: 3.4,
    bellyKnock: 6,
  },
};

export const ARCHETYPE_PRESETS = {
  titan_chonk: {
    name: 'Titan Chonk',
    shape: 'chonk',
    appendage: 'horns',
    appendages: 'horns',
    feet: 'stompers',
    brow: 'angry',
    brows: 'angry',
    mouth: 'teeth',
    mass: 4.5,
    armor: 1.4,
    speed: 0.9,
    jump: 0.9,
    stats: { mass: 4.5, armor: 1.4, speed: 0.9, jump: 0.9 },
    DNA: { confidence: 0.95, aimAccuracy: 0.6, scavenge: 0.2, agility: 0.4 },
    dna: { confidence: 0.95, aimAccuracy: 0.6, scavenge: 0.2, agility: 0.4 },
    badge: '🦏 TITAN CHONK',
    primaryColor: '#4a306d',
    accentColor: '#ff9f1c',
    eyeColor: '#14101c',
    eyeCount: 1,
    eyeSize: 1.3,
    eyeSpacing: 1.0,
    width: 1.3,
    height: 1.2,
    depth: 1.2,
  },
  speed_gremlin: {
    name: 'Speed Gremlin',
    shape: 'spiky',
    appendage: 'antennae',
    appendages: 'antennae',
    feet: 'coils',
    brow: 'derpy',
    brows: 'derpy',
    mouth: 'grin',
    mass: 2.0,
    speed: 1.35,
    armor: 0.8,
    jump: 1.3,
    stats: { mass: 2.0, speed: 1.35, armor: 0.8, jump: 1.3 },
    DNA: { confidence: 0.35, aimAccuracy: 0.7, scavenge: 0.5, agility: 0.95 },
    dna: { confidence: 0.35, aimAccuracy: 0.7, scavenge: 0.5, agility: 0.95 },
    badge: '⚡ SPEED GREMLIN',
    primaryColor: '#00f5d4',
    accentColor: '#7b2cbf',
    eyeColor: '#14101c',
    eyeCount: 3,
    eyeSize: 0.8,
    eyeSpacing: 0.8,
    width: 0.8,
    height: 0.8,
    depth: 0.8,
  },
  sniper_bean: {
    name: 'Sniper Bean',
    shape: 'capsule',
    appendage: 'antennae',
    appendages: 'antennae',
    feet: 'pegs',
    brow: 'confident',
    brows: 'confident',
    mouth: 'open',
    mass: 2.5,
    speed: 1.05,
    armor: 1.0,
    jump: 1.0,
    stats: { mass: 2.5, speed: 1.05, armor: 1.0, jump: 1.0 },
    DNA: { confidence: 0.5, aimAccuracy: 0.95, scavenge: 0.9, agility: 0.7 },
    dna: { confidence: 0.5, aimAccuracy: 0.95, scavenge: 0.9, agility: 0.7 },
    badge: '🎯 SNIPER BEAN',
    primaryColor: '#3a86ff',
    accentColor: '#ff006e',
    eyeColor: '#14101c',
    eyeCount: 1,
    eyeSize: 1.4,
    eyeSpacing: 1.0,
    width: 0.85,
    height: 1.35,
    depth: 0.85,
  },
  pugilist_champ: {
    name: 'Pugilist Champ',
    shape: 'blob',
    appendage: 'boxing_gloves',
    appendages: 'boxing_gloves',
    feet: 'stompers',
    brow: 'confident',
    brows: 'confident',
    mouth: 'grin',
    mass: 3.4,
    speed: 1.1,
    armor: 1.2,
    jump: 1.0,
    stats: { mass: 3.4, speed: 1.1, armor: 1.2, jump: 1.0 },
    DNA: { confidence: 0.9, aimAccuracy: 0.65, scavenge: 0.3, agility: 0.8 },
    dna: { confidence: 0.9, aimAccuracy: 0.65, scavenge: 0.3, agility: 0.8 },
    badge: '🥊 PUGILIST CHAMP',
    primaryColor: '#ff4d5e',
    accentColor: '#ffd23f',
    eyeColor: '#14101c',
    eyeCount: 2,
    eyeSize: 1.0,
    eyeSpacing: 1.0,
    width: 1.1,
    height: 1.0,
    depth: 1.1,
  },
};

export const DEFAULT_BUILD_CONFIG = {
  name: 'Robo-Brawler',
  shape: 'blob',
  width: 1.0,
  height: 1.0,
  depth: 1.0,
  primaryColor: '#ff4d5e',
  accentColor: '#ffd23f',
  eyeColor: '#14101c',
  eyeCount: 2,
  eyeSize: 1.0,
  eyeSpacing: 1.0,
  brows: 'angry',
  mouth: 'grin',
  appendage: 'boxing_gloves',
  feet: 'pegs',
  stats: {
    speed: 1.0,
    mass: 3.0,
    jump: 1.0,
    armor: 1.0,
  },
  dna: {
    confidence: 0.8,
    aimAccuracy: 0.7,
    scavenge: 0.6,
    agility: 0.7,
  },
};

const INK = 0x14101c;
const WHITE = 0xffffff;

function hexNumber(val, fallback = 0xff4d5e) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const s = val.replace('#', '');
    const n = parseInt(s, 16);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

export function buildCustomDweebModel(config = {}) {
  const cfg = { ...DEFAULT_BUILD_CONFIG, ...config };
  if (config.brow && !config.brows) cfg.brows = config.brow;
  if (config.appendages && !config.appendage) cfg.appendage = config.appendages;
  const root = new THREE.Group();
  root.name = 'CustomDweeb';

  const pColor = hexNumber(cfg.primaryColor, 0xff4d5e);
  const aColor = hexNumber(cfg.accentColor, 0xffd23f);
  const eColor = hexNumber(cfg.eyeColor, INK);

  const bodyMat = toonMat({ color: pColor, flatShading: true });
  const accentMat = toonMat({ color: aColor, flatShading: true });
  const eyeWhiteMat = toonMat({ color: WHITE, flatShading: true });
  const pupilMat = toonMat({ color: eColor, flatShading: true });
  const darkMat = toonMat({ color: INK, flatShading: true });

  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'Body';
  root.add(bodyGroup);

  // 1. Core Body Mesh
  const sx = Math.max(0.4, Math.min(2.0, cfg.width || 1.0));
  const sy = Math.max(0.4, Math.min(2.0, cfg.height || 1.0));
  const sz = Math.max(0.4, Math.min(2.0, cfg.depth || 1.0));

  let bodyGeo;
  switch (cfg.shape) {
    case 'cube':
      bodyGeo = new THREE.BoxGeometry(0.72, 0.72, 0.72);
      break;
    case 'spiky':
      bodyGeo = new THREE.IcosahedronGeometry(0.42, 1);
      break;
    case 'star':
      bodyGeo = new THREE.DodecahedronGeometry(0.44, 0);
      break;
    case 'chonk':
      bodyGeo = new THREE.BoxGeometry(0.85, 0.55, 0.75);
      break;
    case 'capsule':
      bodyGeo = new THREE.CapsuleGeometry(0.32, 0.36, 4, 12);
      break;
    case 'blob':
    default:
      bodyGeo = new THREE.SphereGeometry(0.42, 16, 12);
      break;
  }

  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.scale.set(sx, sy, sz);
  bodyMesh.position.y = 0.52 * sy;
  bodyMesh.castShadow = true;
  bodyGroup.add(bodyMesh);

  // 2. Eyes
  const eyesGroup = new THREE.Group();
  eyesGroup.name = 'Eyes';
  root.add(eyesGroup);

  const eyeCount = Math.max(1, Math.min(4, cfg.eyeCount ?? 2));
  const eyeScale = Math.max(0.4, Math.min(2.2, cfg.eyeSize ?? 1.0));
  const eyeSpacing = Math.max(0.4, Math.min(2.0, cfg.eyeSpacing ?? 1.0));
  const eyeR = 0.12 * eyeScale;

  const eyePositions = [];
  const bodyTopY = bodyMesh.position.y;
  const frontZ = (0.36 * sz) + eyeR * 0.4;

  if (eyeCount === 1) {
    eyePositions.push({ x: 0, y: bodyTopY + 0.06, r: eyeR * 1.5 });
  } else if (eyeCount === 2) {
    const offX = 0.14 * eyeSpacing * sx;
    eyePositions.push({ x: -offX, y: bodyTopY + 0.05, r: eyeR });
    eyePositions.push({ x: offX, y: bodyTopY + 0.06, r: eyeR * 0.95 }); // subtle asymmetric cuteness
  } else if (eyeCount === 3) {
    const offX = 0.18 * eyeSpacing * sx;
    eyePositions.push({ x: -offX, y: bodyTopY + 0.02, r: eyeR * 0.85 });
    eyePositions.push({ x: 0, y: bodyTopY + 0.15, r: eyeR * 1.05 });
    eyePositions.push({ x: offX, y: bodyTopY + 0.02, r: eyeR * 0.85 });
  } else if (eyeCount === 4) {
    const offX = 0.15 * eyeSpacing * sx;
    eyePositions.push({ x: -offX, y: bodyTopY + 0.12, r: eyeR * 0.85 });
    eyePositions.push({ x: offX, y: bodyTopY + 0.12, r: eyeR * 0.85 });
    eyePositions.push({ x: -offX * 1.3, y: bodyTopY - 0.05, r: eyeR * 0.7 });
    eyePositions.push({ x: offX * 1.3, y: bodyTopY - 0.05, r: eyeR * 0.7 });
  }

  const eyeMeshes = [];
  for (const pos of eyePositions) {
    const eyeWh = new THREE.Mesh(new THREE.SphereGeometry(pos.r, 12, 10), eyeWhiteMat);
    eyeWh.position.set(pos.x, pos.y, frontZ);
    eyeWh.scale.z = 0.7; // slight pancake
    eyesGroup.add(eyeWh);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(pos.r * 0.52, 10, 8), pupilMat);
    pupil.position.set(pos.x, pos.y, frontZ + pos.r * 0.65);
    pupil.scale.z = 0.4;
    eyesGroup.add(pupil);

    eyeMeshes.push({ white: eyeWh, pupil, basePos: { ...pos, frontZ } });
  }

  // 3. Eyebrows
  const browsGroup = new THREE.Group();
  browsGroup.name = 'Brows';
  root.add(browsGroup);

  if (cfg.brows && cfg.brows !== 'none') {
    const browAngle = cfg.brows === 'angry' ? 0.35 : cfg.brows === 'derpy' ? -0.25 : 0.05;
    const browY = bodyTopY + (eyeCount === 3 ? 0.26 : 0.16 * sy);
    const browOffX = Math.max(0.12, 0.16 * eyeSpacing * sx);

    const leftBrow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.06), darkMat);
    leftBrow.position.set(-browOffX, browY, frontZ + 0.04);
    leftBrow.rotation.z = -browAngle;
    browsGroup.add(leftBrow);

    const rightBrow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.06), darkMat);
    rightBrow.position.set(browOffX, browY, frontZ + 0.04);
    rightBrow.rotation.z = browAngle;
    browsGroup.add(rightBrow);
  }

  // 4. Mouth
  const mouthGroup = new THREE.Group();
  mouthGroup.name = 'Mouth';
  root.add(mouthGroup);

  const mouthY = bodyTopY - 0.14 * sy;
  if (cfg.mouth === 'teeth') {
    const teethBacking = new THREE.Mesh(new THREE.BoxGeometry(0.24 * sx, 0.08, 0.04), darkMat);
    teethBacking.position.set(0, mouthY, frontZ + 0.01);
    mouthGroup.add(teethBacking);

    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.05), eyeWhiteMat);
    t1.position.set(-0.05, mouthY + 0.02, frontZ + 0.02);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.05), eyeWhiteMat);
    t2.position.set(0.05, mouthY + 0.02, frontZ + 0.02);
    mouthGroup.add(t1, t2);
  } else if (cfg.mouth === 'open') {
    const openMouth = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * sx, 0.08 * sx, 0.05, 12), darkMat);
    openMouth.rotation.x = Math.PI / 2;
    openMouth.position.set(0, mouthY, frontZ + 0.01);
    mouthGroup.add(openMouth);
  } else {
    // Classic curved smirk / grin
    const grin = new THREE.Mesh(new THREE.BoxGeometry(0.22 * sx, 0.045, 0.04), darkMat);
    grin.position.set(0, mouthY, frontZ + 0.01);
    mouthGroup.add(grin);
  }

  // 5. Appendages & Accessories
  const appGroup = new THREE.Group();
  appGroup.name = 'Appendages';
  root.add(appGroup);

  const topY = bodyTopY + (0.36 * sy);
  switch (cfg.appendage) {
    case 'horns': {
      const hornGeo = new THREE.ConeGeometry(0.1, 0.32, 8);
      const hornL = new THREE.Mesh(hornGeo, accentMat);
      hornL.position.set(-0.24 * sx, topY + 0.08, 0);
      hornL.rotation.z = 0.35;
      const hornR = new THREE.Mesh(hornGeo, accentMat);
      hornR.position.set(0.24 * sx, topY + 0.08, 0);
      hornR.rotation.z = -0.35;
      appGroup.add(hornL, hornR);
      break;
    }
    case 'antennae': {
      const stemL = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6), darkMat);
      stemL.position.set(0, topY + 0.16, 0);
      const bobble = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), accentMat);
      bobble.position.set(0, topY + 0.35, 0);
      appGroup.add(stemL, bobble);
      break;
    }
    case 'bunny_ears': {
      const earGeo = new THREE.CapsuleGeometry(0.09, 0.36, 4, 8);
      const earL = new THREE.Mesh(earGeo, accentMat);
      earL.position.set(-0.2 * sx, topY + 0.22, 0);
      earL.rotation.z = 0.22;
      const earR = new THREE.Mesh(earGeo, accentMat);
      earR.position.set(0.2 * sx, topY + 0.22, 0);
      earR.rotation.z = -0.22;
      appGroup.add(earL, earR);
      break;
    }
    case 'boxing_gloves': {
      const gloveGeo = new THREE.SphereGeometry(0.18, 12, 10);
      const gloveL = new THREE.Mesh(gloveGeo, accentMat);
      gloveL.position.set(-0.46 * sx, bodyTopY, 0.18);
      const gloveR = new THREE.Mesh(gloveGeo, accentMat);
      gloveR.position.set(0.46 * sx, bodyTopY, 0.18);
      appGroup.add(gloveL, gloveR);
      break;
    }
    case 'plungers': {
      const cupGeo = new THREE.CylinderGeometry(0.18, 0.08, 0.14, 10);
      const cupL = new THREE.Mesh(cupGeo, darkMat);
      cupL.rotation.z = Math.PI / 2;
      cupL.position.set(-0.48 * sx, bodyTopY, 0.12);
      const cupR = new THREE.Mesh(cupGeo, darkMat);
      cupR.rotation.z = -Math.PI / 2;
      cupR.position.set(0.48 * sx, bodyTopY, 0.12);
      appGroup.add(cupL, cupR);
      break;
    }
    case 'spikes': {
      for (let i = 0; i < 7; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 6), accentMat);
        const ang = (i / 7) * Math.PI * 2;
        spike.position.set(Math.cos(ang) * 0.42 * sx, bodyTopY + Math.sin(ang) * 0.22, -0.15);
        spike.rotation.z = -ang + Math.PI / 2;
        appGroup.add(spike);
      }
      break;
    }
    case 'tail': {
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 6), accentMat);
      tail.rotation.x = -Math.PI / 3;
      tail.position.set(0, bodyTopY - 0.2 * sy, -0.42 * sz);
      appGroup.add(tail);
      break;
    }
    case 'dragon_wings': {
      // Broad leathery wings sprouting from the shoulder blades; flap refs drive the glide read.
      const wingGeo = new THREE.BoxGeometry(0.62, 0.08, 0.4);
      const wingL = new THREE.Mesh(wingGeo, accentMat);
      wingL.position.set(-0.52 * sx, topY - 0.02, -0.12);
      wingL.rotation.y = 0.5;
      wingL.rotation.z = 0.28;
      const wingR = new THREE.Mesh(wingGeo, accentMat);
      wingR.position.set(0.52 * sx, topY - 0.02, -0.12);
      wingR.rotation.y = -0.5;
      wingR.rotation.z = -0.28;
      // Dark membrane insets
      const memGeo = new THREE.BoxGeometry(0.5, 0.05, 0.3);
      const memL = new THREE.Mesh(memGeo, bodyMat);
      memL.position.set(-0.52 * sx, topY, -0.12);
      memL.rotation.y = 0.5;
      memL.rotation.z = 0.28;
      const memR = new THREE.Mesh(memGeo, bodyMat);
      memR.position.set(0.52 * sx, topY, -0.12);
      memR.rotation.y = -0.5;
      memR.rotation.z = -0.28;
      appGroup.add(wingL, wingR, memL, memR);
      appGroup.userData.fx = { ...(appGroup.userData.fx || {}), wings: [wingL, wingR, memL, memR] };
      break;
    }
    case 'anvil_tail': {
      // Segmented tail ending in a heavy little anvil — the stun-slam business end.
      const segGeo = new THREE.ConeGeometry(0.08, 0.3, 6);
      const seg1 = new THREE.Mesh(segGeo, accentMat);
      seg1.rotation.x = -Math.PI / 2.6;
      seg1.position.set(0, bodyTopY - 0.18 * sy, -0.4 * sz);
      const seg2 = new THREE.Mesh(segGeo, accentMat);
      seg2.rotation.x = -Math.PI / 2.1;
      seg2.position.set(0, bodyTopY - 0.3 * sy, -0.62 * sz);
      const anvilTop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.2), darkMat);
      anvilTop.position.set(0, bodyTopY - 0.34 * sy, -0.82 * sz);
      const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), darkMat);
      anvilBase.position.set(0, bodyTopY - 0.46 * sy, -0.82 * sz);
      appGroup.add(seg1, seg2, anvilTop, anvilBase);
      appGroup.userData.fx = { ...(appGroup.userData.fx || {}), tailTip: anvilTop };
      break;
    }
    case 'magnet_eyes': {
      // Classic red/white horseshoe magnets flanking the noggin — always "on".
      const mkMagnet = side => {
        const g = new THREE.Group();
        const red = toonMat({ color: 0xef2d2d, flatShading: true });
        const white = toonMat({ color: 0xf8fafc, flatShading: true });
        const arm = new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8);
        const aL = new THREE.Mesh(arm, red);
        aL.position.set(-0.09, 0, 0);
        const aR = new THREE.Mesh(arm, red);
        aR.position.set(0.09, 0, 0);
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.11), white);
        bridge.position.set(0, 0.18, 0);
        const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.11), white);
        tipL.position.set(-0.09, -0.17, 0);
        const tipR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.11), white);
        tipR.position.set(0.09, -0.17, 0);
        g.add(aL, aR, bridge, tipL, tipR);
        g.position.set(side * 0.42 * sx, topY + 0.12, 0);
        g.rotation.z = side * -0.35;
        return g;
      };
      const magL = mkMagnet(-1);
      const magR = mkMagnet(1);
      appGroup.add(magL, magR);
      appGroup.userData.fx = { ...(appGroup.userData.fx || {}), magnets: [magL, magR] };
      break;
    }
    case 'spring_stompers': {
      // Coil-spring stilts under the body — boing comes standard.
      const mkSpring = side => {
        const g = new THREE.Group();
        const coilGeo = new THREE.TorusGeometry(0.11, 0.035, 6, 12);
        for (let i = 0; i < 3; i++) {
          const coil = new THREE.Mesh(coilGeo, darkMat);
          coil.rotation.x = Math.PI / 2;
          coil.position.y = 0.1 + i * 0.12;
          g.add(coil);
        }
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.28), accentMat);
        pad.position.y = 0.04;
        g.add(pad);
        g.position.set(side * 0.22 * sx, 0, 0.02);
        return g;
      };
      const sprL = mkSpring(-1);
      const sprR = mkSpring(1);
      appGroup.add(sprL, sprR);
      appGroup.userData.fx = { ...(appGroup.userData.fx || {}), springs: [sprL, sprR] };
      break;
    }
    case 'bouncy_belly': {
      // A big inflatable belly sphere on the torso with a darker seam.
      const bellyGeo = new THREE.SphereGeometry(0.38 * Math.max(sx, sz), 16, 12);
      const bellyMesh = new THREE.Mesh(bellyGeo, accentMat);
      bellyMesh.position.set(0, bodyTopY - 0.12 * sy, 0.28 * sz);
      bellyMesh.scale.set(1, 0.85, 1.15); // slightly squashed sphere
      appGroup.add(bellyMesh);
      // Darker seam ring around the equator
      const seamGeo = new THREE.TorusGeometry(0.38 * Math.max(sx, sz) * 1.02, 0.018, 8, 32);
      const seamMesh = new THREE.Mesh(seamGeo, darkMat);
      seamMesh.position.set(0, bodyTopY - 0.12 * sy, 0.28 * sz);
      seamMesh.rotation.x = Math.PI / 2;
      appGroup.add(seamMesh);
      // Store for squash animation
      appGroup.userData.fx = { ...(appGroup.userData.fx || {}), belly: bellyMesh, bellySeam: seamMesh };
      break;
    }
    case 'none':
    default:
      break;
  }

  // 6. Feet & Limbs
  const feetGroup = new THREE.Group();
  feetGroup.name = 'Feet';
  root.add(feetGroup);

  const footX = 0.22 * sx;
  const footY = 0.08;
  switch (cfg.feet) {
    case 'coils': {
      const coilGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8);
      const coilL = new THREE.Mesh(coilGeo, darkMat);
      coilL.position.set(-footX, footY, 0);
      const coilR = new THREE.Mesh(coilGeo, darkMat);
      coilR.position.set(footX, footY, 0);
      feetGroup.add(coilL, coilR);
      break;
    }
    case 'stompers': {
      const stomperGeo = new THREE.BoxGeometry(0.24, 0.14, 0.32);
      const footL = new THREE.Mesh(stomperGeo, accentMat);
      footL.position.set(-footX, footY, 0.05);
      const footR = new THREE.Mesh(stomperGeo, accentMat);
      footR.position.set(footX, footY, 0.05);
      feetGroup.add(footL, footR);
      break;
    }
    case 'pegs':
    default: {
      const pegGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8);
      const pegL = new THREE.Mesh(pegGeo, darkMat);
      pegL.position.set(-footX, footY, 0);
      const pegR = new THREE.Mesh(pegGeo, darkMat);
      pegR.position.set(footX, footY, 0);
      feetGroup.add(pegL, pegR);
      break;
    }
  }

  // Outline tags for custom renderer
  root.traverse(child => {
    if (child.isMesh) {
      noOutline(child);
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  const gpType = cfg.appendage || 'none';
  const model = {
    root,
    config: cfg,
    bodyMesh,
    eyeMeshes,
    appGroup,
    feetGroup,
    // Appendage gameplay state. bindFighter(dweeb, ctxProvider) attaches a live
    // fighter so animate() also drives per-frame gameplay (glide, stun slams,
    // magnet pull, spring bounce) — no main-loop changes needed: the game
    // already calls customModel.animate(time, mood) every frame.
    gameplay: {
      type: gpType,
      params: APPENDAGE_GAMEPLAY[gpType] || APPENDAGE_GAMEPLAY.none,
      st: freshAppendageState(),
      dweeb: null,
      ctxProvider: null,
    },
    bindFighter(dweeb, ctxProvider = null) {
      // Make sure the dweeb carries matching gameplay state (install is a
      // no-op when it already does — no recursion: install with bindModel=false).
      if (dweeb && (!dweeb.appendageGameplay || dweeb.appendageGameplay.type !== this.gameplay.type)) {
        installAppendageGameplay(dweeb, this.config, false);
      }
      this.gameplay.dweeb = dweeb || null;
      this.gameplay.ctxProvider = ctxProvider || null;
      return this;
    },
    animate(time, mood = 'happy') {
      // Idle breathing squish & subtle head bob
      const breath = Math.sin(time * 3.5) * 0.04;
      bodyMesh.scale.y = sy * (1 + breath);
      bodyMesh.scale.x = sx * (1 - breath * 0.5);

      // Appendage jiggle
      if (appGroup.children.length) {
        appGroup.rotation.z = Math.sin(time * 4) * 0.05;
        appGroup.rotation.x = Math.cos(time * 3) * 0.03;
      }

      // Eye pupil wandering
      const lookX = Math.sin(time * 1.5) * 0.02;
      const lookY = Math.cos(time * 2.2) * 0.02;
      for (const e of eyeMeshes) {
        e.pupil.position.x = e.basePos.x + lookX;
        e.pupil.position.y = e.basePos.y + lookY;
      }

      // Bound-fighter gameplay tick (dt derived from the frame clock)
      const gp = this.gameplay;
      if (gp && gp.dweeb) {
        const prev = this._gpLastT ?? time;
        const dt = Math.min(0.1, Math.max(0, time - prev));
        this._gpLastT = time;
        if (dt > 0) {
          updateAppendageGameplay(gp.dweeb, dt, gp.ctxProvider ? gp.ctxProvider() : {});
        }
        animateAppendageFx(this, gp, time);
      }
    },
  };
  return model;
}

/** Fresh per-fighter appendage effect state. */
export function freshAppendageState() {
  return {
    flapPhase: 0,        // dragon_wings: wing flap oscillator
    glideUsedThisAir: false, // dragon_wings: bonus air jump consumed this flight
    prevGrounded: true,
    prevVy: 0,
    slamDone: false,     // anvil_tail: slam triggered, re-arms when airborne
    magnetPulse: 0,      // magnet_eyes: visual pulse oscillator
    springSquash: 0,     // spring_stompers: landing compression 0..1 (decays)
    bellySquash: 0,      // bouncy_belly: landing compression 0..1 (decays)
  };
}

/**
 * Install appendage gameplay onto a live fighter dweeb. Applies stat modifiers
 * from the fighter's BASE stats (captured on first install — re-installing after
 * a mutation never compounds multipliers) and stores effect state on
 * dweeb.appendageGameplay. Also binds the dweeb's custom model (if present) so
 * the per-frame update runs inside the existing animate() call.
 * bindModel=false skips the model bind (used by bindFighter itself).
 */
export function installAppendageGameplay(dweeb, config = {}, bindModel = true) {
  if (!dweeb) return null;
  const type = config.appendage || config.appendages || 'none';
  const params = APPENDAGE_GAMEPLAY[type] || APPENDAGE_GAMEPLAY.none;
  const prev = dweeb.appendageGameplay;
  const base = prev?.base ?? {
    speed: dweeb.stats?.speed ?? 1,
    jump: dweeb.stats?.jump ?? 1,
  };
  if (dweeb.stats) {
    const cfgMul = config.stats || {};
    dweeb.stats.speed = base.speed * (cfgMul.speed ?? 1) * (params.speedMul ?? 1);
    dweeb.stats.jump = base.jump * (cfgMul.jump ?? 1) * (params.jumpMul ?? 1);
  }
  dweeb.appendageGameplay = {
    type,
    params,
    base,
    st: prev && prev.type === type ? prev.st : freshAppendageState(),
  };
  if (dweeb.customModel && typeof dweeb.customModel.bindFighter === 'function' && bindModel) {
    dweeb.customModel.bindFighter(dweeb);
  }
  return dweeb.appendageGameplay;
}

/**
 * Per-frame appendage gameplay update. Reads real fighter physics state
 * (body velocity, grounded, jumpsLeft) and applies real effects:
 *   dragon_wings:    caps sink rate while airborne (glide) + one bonus air jump per flight
 *   anvil_tail:      hard landings / ground slams stun nearby rivals
 *   magnet_eyes:     pulls loose nearby items toward the fighter
 *   spring_stompers: hard landings bounce the fighter back up (jumpMul applied at install)
 * ctx: { rivals: [...], objects: [...] } — rivals need getPosition()/hitstun/active;
 * objects need { body, mesh, isGrabbed }.
 */
export function updateAppendageGameplay(dweeb, dt, ctx = {}) {
  const gp = dweeb.appendageGameplay;
  if (!gp || gp.type === 'none' || !dweeb.body || typeof dweeb.body.linvel !== 'function') return;
  const st = gp.st;
  const P = gp.params;
  const v = dweeb.body.linvel();
  const grounded = !!dweeb.grounded;
  const landed = !st.prevGrounded && grounded;
  const fallSpeed = -st.prevVy;

  switch (gp.type) {
    case 'dragon_wings': {
      if (!grounded && v.y < -P.glideMaxFall && typeof dweeb.body.setLinvel === 'function') {
        dweeb.body.setLinvel({ x: v.x, y: -P.glideMaxFall, z: v.z }, true);
      }
      if (grounded) {
        st.glideUsedThisAir = false;
      } else if (!st.glideUsedThisAir && (dweeb.jumpsLeft ?? 0) <= 0) {
        dweeb.jumpsLeft = 1; // glide recovery: one bonus air jump per flight
        st.glideUsedThisAir = true;
      }
      st.flapPhase += dt * (grounded ? 2 : 14);
      break;
    }
    case 'anvil_tail': {
      const slamming = !!dweeb.groundSlamming && grounded;
      if ((landed && fallSpeed > P.slamMinFall) || (slamming && !st.slamDone)) {
        const pos = typeof dweeb.getPosition === 'function' ? dweeb.getPosition() : { x: 0, y: 0, z: 0 };
        for (const r of ctx.rivals || []) {
          if (!r || r === dweeb || r.active === false || r.eliminated) continue;
          if (typeof r.getPosition !== 'function') continue;
          const rp = r.getPosition();
          if (Math.hypot(rp.x - pos.x, rp.z - pos.z) > P.stunRadius) continue;
          r.hitstun = Math.max(r.hitstun || 0, P.stunDuration);
          if (r.body && typeof r.body.linvel === 'function' && typeof r.body.setLinvel === 'function') {
            const rv = r.body.linvel();
            r.body.setLinvel({ x: rv.x, y: Math.max(rv.y, P.stunPop), z: rv.z }, true);
          }
        }
        st.slamDone = true;
      }
      if (!grounded) st.slamDone = false; // re-arm once airborne again
      break;
    }
    case 'magnet_eyes': {
      const pos = typeof dweeb.getPosition === 'function' ? dweeb.getPosition() : null;
      if (pos) {
        for (const o of ctx.objects || []) {
          if (!o || !o.body || o.isGrabbed || o.held) continue;
          const mp = o.mesh?.position;
          if (!mp || typeof o.body.applyImpulse !== 'function') continue;
          const dx = pos.x - mp.x, dy = (pos.y + 0.5) - mp.y, dz = pos.z - mp.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist > P.magnetRadius || dist < 0.5) continue;
          const pull = P.magnetPull * (1 - dist / P.magnetRadius);
          const inv = 1 / (dist || 1);
          o.body.applyImpulse({ x: dx * inv * pull, y: dy * inv * pull, z: dz * inv * pull }, true);
        }
      }
      st.magnetPulse += dt * 6;
      break;
    }
    case 'spring_stompers': {
      if (landed && fallSpeed > P.bounceMinFall && typeof dweeb.body.setLinvel === 'function') {
        const bounce = Math.min(fallSpeed * P.bounceReturn, P.bounceMax);
        dweeb.body.setLinvel({ x: v.x, y: bounce, z: v.z }, true);
        st.springSquash = Math.min(1, fallSpeed / 12);
      }
      st.springSquash = Math.max(0, st.springSquash - dt * 4);
      break;
    }
    case 'bouncy_belly': {
      if (landed && fallSpeed > P.bounceMinFall && typeof dweeb.body.setLinvel === 'function') {
        const bounce = Math.min(fallSpeed * P.bounceReturn, P.bounceMax);
        dweeb.body.setLinvel({ x: v.x, y: bounce, z: v.z }, true);
        st.bellySquash = Math.min(1, fallSpeed / 12);
        // Knock nearby rivals away (crowd-control)
        const pos = typeof dweeb.getPosition === 'function' ? dweeb.getPosition() : { x: 0, y: 0, z: 0 };
        for (const r of ctx.rivals || []) {
          if (!r || r === dweeb || r.active === false || r.eliminated) continue;
          if (typeof r.getPosition !== 'function') continue;
          const rp = r.getPosition();
          const dx = rp.x - pos.x;
          const dz = rp.z - pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist > P.bellyRadius || dist < 0.3) continue;
          // Small hitstun
          r.hitstun = Math.max(r.hitstun || 0, 0.35);
          // Outward knockback
          if (r.body && typeof r.body.linvel === 'function' && typeof r.body.setLinvel === 'function') {
            const rv = r.body.linvel();
            const inv = 1 / (dist || 1);
            const knock = P.bellyKnock * (1 - dist / P.bellyRadius);
            r.body.setLinvel({ x: rv.x + dx * inv * knock, y: Math.max(rv.y, 2.5), z: rv.z + dz * inv * knock }, true);
          }
        }
      }
      st.bellySquash = Math.max(0, st.bellySquash - dt * 5);
      break;
    }
    default:
      break;
  }

  st.prevGrounded = grounded;
  st.prevVy = v.y;
}

/** Drive the new appendages' visual motion from gameplay state (called inside animate()). */
function animateAppendageFx(model, gp, time) {
  const fx = model.appGroup?.userData?.fx;
  if (!fx) return;
  const st = gp.st;
  const dweeb = gp.dweeb;
  const airborne = dweeb ? !dweeb.grounded : false;
  if (fx.wings) {
    const amp = airborne ? 0.7 : 0.12;
    const flap = Math.sin(st.flapPhase) * amp;
    // wings[0..1] are the accent spars, [2..3] the membranes
    fx.wings[0].rotation.z = 0.28 + flap;
    fx.wings[1].rotation.z = -0.28 - flap;
    fx.wings[2].rotation.z = 0.28 + flap;
    fx.wings[3].rotation.z = -0.28 - flap;
  }
  if (fx.tailTip) {
    fx.tailTip.position.y += Math.sin(time * 6) * 0.002;
  }
  if (fx.magnets) {
    const s = 1 + Math.sin(st.magnetPulse) * 0.06;
    fx.magnets[0].scale.set(s, s, s);
    fx.magnets[1].scale.set(s, s, s);
  }
  if (fx.springs) {
    const squash = 1 - st.springSquash * 0.45;
    fx.springs[0].scale.set(1, squash, 1);
    fx.springs[1].scale.set(1, squash, 1);
  }
  if (fx.belly && fx.bellySeam) {
    // Squash vertically, stretch horizontally (volume-preserving-ish)
    const squash = 1 - st.bellySquash * 0.55;
    const stretch = 1 + st.bellySquash * 0.35;
    fx.belly.scale.set(stretch, squash, stretch);
    fx.bellySeam.scale.set(stretch, 1, stretch);
    // Jiggle while it springs back out (offset from the build-time rest height, never accumulated)
    fx.belly.userData.restY ??= fx.belly.position.y;
    fx.bellySeam.userData.restY ??= fx.bellySeam.position.y;
    const jiggle = st.bellySquash > 0 ? Math.sin(time * 40) * 0.02 * st.bellySquash : 0;
    fx.belly.position.y = fx.belly.userData.restY + jiggle;
    fx.bellySeam.position.y = fx.bellySeam.userData.restY + jiggle;
  }
}

// ─── Collider sync (DNA mutation → physics, no reload) ───────────────────────

/**
 * Compute the world-space bounding box of a build config by constructing the
 * model off-scene. Geometries/materials of the throwaway model are disposed.
 */
export function computeBuildBounds(config = {}) {
  const model = buildCustomDweebModel(config);
  model.root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model.root);
  model.root.traverse(child => {
    if (child.isMesh) {
      child.geometry?.dispose?.();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) m?.dispose?.();
    }
  });
  return box;
}

/**
 * Synchronously refresh a fighter's physics collider to match a mutated build
 * config's bounding box. Maps the box onto the dweeb's capsule collider
 * (radius from XZ extents, halfHeight from Y) via rapier's in-place shape
 * setters — no scene reload, no body recreation. Also syncs mass.
 * Returns the applied { radius, halfHeight, size } for verification.
 */
export function refreshDweebCollider(dweeb, config = {}, bounds = null) {
  const box = bounds || computeBuildBounds(config);
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(0.15, Math.min(size.x, size.z) / 2);
  const halfHeight = Math.max(0.1, size.y / 2 - radius);
  const c = dweeb?.collider;
  if (c) {
    if (typeof c.setRadius === 'function') c.setRadius(radius);
    if (typeof c.setHalfHeight === 'function') c.setHalfHeight(halfHeight);
    const mass = config.stats?.mass ?? config.mass;
    if (mass !== undefined && typeof c.setMass === 'function') c.setMass(mass);
  }
  return { radius, halfHeight, size: { x: size.x, y: size.y, z: size.z } };
}

/**
 * Apply a full custom build to a live fighter: rebuild the visual model onto
 * the dweeb's rig, apply stats (from base — never compounding), install
 * appendage gameplay, and synchronously refresh the physics collider to the
 * new bounding box. ctxProvider supplies { rivals, objects } for per-frame
 * appendage effects.
 */
export function applyBuildToFighter(dweeb, config = {}, ctxProvider = null) {
  if (!dweeb) return null;
  if (dweeb.customModel?.root && dweeb.rig) {
    dweeb.rig.remove(dweeb.customModel.root);
  }
  const custom = buildCustomDweebModel(config);
  dweeb.customModel = custom;
  if (dweeb.rig) {
    for (const c of dweeb.rig.children) {
      if (c !== dweeb.playerRing && c !== dweeb.bubbleMesh && c !== dweeb.freezeMesh && c !== dweeb.parryMesh) {
        c.visible = false;
      }
    }
    dweeb.rig.add(custom.root);
    if (Array.isArray(dweeb.flashMats)) {
      custom.root.traverse(child => {
        if (child.isMesh && child.material && !dweeb.flashMats.includes(child.material)) {
          dweeb.flashMats.push(child.material);
        }
      });
    }
  }
  if (config.stats?.mass !== undefined) {
    if (dweeb.stats) dweeb.stats.mass = config.stats.mass;
    if (dweeb.collider && typeof dweeb.collider.setMass === 'function') {
      dweeb.collider.setMass(config.stats.mass);
    }
  }
  if (config.name) dweeb.name = config.name;
  custom.root.updateWorldMatrix(true, true);
  refreshDweebCollider(dweeb, config, new THREE.Box3().setFromObject(custom.root));
  installAppendageGameplay(dweeb, config);
  custom.bindFighter(dweeb, ctxProvider);
  return custom;
}
