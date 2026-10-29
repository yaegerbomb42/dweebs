// CustomDweebModel.js — Procedural 3D Low-Poly Mesh Generator for Build-A-Dweeb
//
// Dynamically constructs low-poly faceted cartoon bodies, custom eye layouts,
// expressive eyebrows, mouths, physics-reactive appendages and stylized limbs.
// Designed to render both in the interactive 3D workshop turntable and in the arena.

import * as THREE from 'three';
import { toonMat, noOutline } from '../render/Toon.js';

export const BODY_SHAPES = ['blob', 'cube', 'spiky', 'star', 'chonk', 'capsule'];
export const APPENDAGES = ['none', 'horns', 'antennae', 'bunny_ears', 'boxing_gloves', 'plungers', 'spikes', 'tail'];
export const FEET_TYPES = ['pegs', 'coils', 'stompers'];
export const BROW_STYLES = ['angry', 'derpy', 'confident', 'none'];
export const MOUTH_STYLES = ['grin', 'teeth', 'open'];

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

  return {
    root,
    config: cfg,
    bodyMesh,
    eyeMeshes,
    appGroup,
    feetGroup,
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
    },
  };
}
