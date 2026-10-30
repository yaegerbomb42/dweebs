// DweebModel.js — 26 expressive Dweeb characters crafted from design references:
// faceted low-poly clay bodies, huge googly eyes, sculpted angry brows, screaming mouths with teeth,
// and physics-reactive appendages (antennae, bunny ears, periscope stalks, spring coils, boxing gloves).
// Pure presentation: no physics simulation here. Geometry is cached per archetype and shared by every Dweeb.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMat, noOutline } from '../render/Toon.js';

const INK = 0x14101c;
const cache = new Map();
const cached = (key, make) => cache.get(key) ?? cache.set(key, make()).get(key);

// Per-type layout. Coordinates in meters.
export const LAYOUT = {
  cube: {
    eyes: [{ x: -0.15, y: 0.7, r: 0.16 }, { x: 0.165, y: 0.72, r: 0.145 }],
    mouthY: 0.5, brows: true, shoulder: { x: 0.37, y: 0.52 }, hipY: 0.3, legLen: 0.24, legX: 0.16,
    mood: 'grumpy',
  },
  spiky: {
    eyes: [{ x: -0.125, y: 0.63, r: 0.135 }, { x: 0.13, y: 0.64, r: 0.13 }],
    mouthY: 0.47, brows: false, shoulder: { x: 0.33, y: 0.48 }, hipY: 0.27, legLen: 0.21, legX: 0.12,
    mood: 'calm', center: 0.56, R: 0.34,
  },
  blob: {
    eyes: [{ x: -0.14, y: 0.62, r: 0.15 }, { x: 0.145, y: 0.63, r: 0.14 }],
    mouthY: 0.43, brows: true, shoulder: { x: 0.4, y: 0.5 }, hipY: 0.18, legLen: 0.12, legX: 0.16,
    mood: 'calm', center: 0.5, R: 0.42, zScale: 0.95,
  },
  stalky: {
    eyes: [{ x: -0.22, y: 0.96, r: 0.11 }, { x: 0.24, y: 0.88, r: 0.105 }],
    mouthY: 0.46, brows: false, shoulder: { x: 0.34, y: 0.48 }, hipY: 0.22, legLen: 0.18, legX: 0.14,
    mood: 'calm', center: 0.52, R: 0.36,
  },
  peep: {
    eyes: [{ x: 0.0, y: 0.6, r: 0.26 }],
    mouthY: 0.34, brows: false, shoulder: { x: 0.36, y: 0.5 }, hipY: 0.2, legLen: 0.14, legX: 0.18,
    mood: 'grumpy', center: 0.58, R: 0.36, fourLegs: true,
  },
  tri_cloud: {
    eyes: [{ x: -0.24, y: 0.58, r: 0.1 }, { x: 0.0, y: 0.72, r: 0.12 }, { x: 0.24, y: 0.58, r: 0.1 }],
    mouthY: 0.5, brows: false, shoulder: { x: 0.42, y: 0.55 }, hipY: 0.26, legLen: 0.16, legX: 0.15,
    mood: 'calm', center: 0.6, R: 0.36,
  },
  bunny: {
    eyes: [{ x: -0.11, y: 0.58, r: 0.12 }, { x: 0.12, y: 0.58, r: 0.12 }],
    mouthY: 0.44, brows: false, shoulder: { x: 0.32, y: 0.48 }, hipY: 0.24, legLen: 0.18, legX: 0.13,
    mood: 'calm', center: 0.55, R: 0.34,
  },
  puddle: {
    eyes: [{ x: -0.16, y: 0.44, r: 0.14 }, { x: 0.16, y: 0.44, r: 0.14 }],
    mouthY: 0.32, brows: false, shoulder: { x: 0.46, y: 0.3 }, hipY: 0.12, legLen: 0.08, legX: 0.22,
    mood: 'calm', center: 0.36, R: 0.44, zScale: 0.5,
  },
  blockhead: {
    eyes: [{ x: 0.0, y: 0.88, r: 0.15 }],
    mouthY: 0.5, brows: false, shoulder: { x: 0.38, y: 0.5 }, hipY: 0.28, legLen: 0.22, legX: 0.16,
    mood: 'calm',
  },
  gumball: {
    eyes: [{ x: -0.12, y: 0.72, r: 0.12 }, { x: 0.12, y: 0.72, r: 0.12 }],
    mouthY: 0.6, brows: true, shoulder: { x: 0.35, y: 0.55 }, hipY: 0.22, legLen: 0.16, legX: 0.14,
    mood: 'calm', center: 0.58, R: 0.38,
  },
  bumpy: {
    eyes: [{ x: -0.13, y: 0.58, r: 0.135 }, { x: 0.14, y: 0.58, r: 0.13 }],
    mouthY: 0.44, brows: false, shoulder: { x: 0.35, y: 0.5 }, hipY: 0.24, legLen: 0.18, legX: 0.14,
    mood: 'calm', center: 0.56, R: 0.36,
  },
  cyclops: {
    eyes: [{ x: 0.0, y: 0.62, r: 0.22 }],
    mouthY: 0.4, brows: false, shoulder: { x: 0.36, y: 0.5 }, hipY: 0.22, legLen: 0.16, legX: 0.14,
    mood: 'calm', center: 0.56, R: 0.36,
  },
  starry: {
    eyes: [{ x: -0.12, y: 0.58, r: 0.13 }, { x: 0.12, y: 0.58, r: 0.13 }],
    mouthY: 0.44, brows: false, shoulder: { x: 0.4, y: 0.55 }, hipY: 0.22, legLen: 0.18, legX: 0.15,
    mood: 'calm', center: 0.56, R: 0.38,
  },
  blink: {
    eyes: [{ x: -0.22, y: 0.68, r: 0.14 }, { x: 0.22, y: 0.68, r: 0.14 }],
    mouthY: 0.52, brows: false, shoulder: { x: 0.34, y: 0.52 }, hipY: 0.24, legLen: 0.2, legX: 0.14,
    mood: 'smug', center: 0.58, R: 0.32, zScale: 0.9,
  },
  bean: {
    eyes: [{ x: -0.16, y: 0.66, r: 0.16 }, { x: 0.14, y: 0.46, r: 0.11 }],
    mouthY: 0.42, brows: false, shoulder: { x: 0.36, y: 0.5 }, hipY: 0.22, legLen: 0.16, legX: 0.14,
    mood: 'calm', center: 0.56, R: 0.36,
  },
  tadpole: {
    eyes: [{ x: -0.12, y: 0.6, r: 0.13 }, { x: 0.12, y: 0.6, r: 0.13 }],
    mouthY: 0.46, brows: false, shoulder: { x: 0.34, y: 0.5 }, hipY: 0.22, legLen: 0.16, legX: 0.13,
    mood: 'calm', center: 0.56, R: 0.35, hasTail: true,
  },
  floppy: {
    eyes: [{ x: -0.09, y: 0.54, r: 0.11 }, { x: 0.09, y: 0.54, r: 0.11 }],
    mouthY: 0.42, brows: false, shoulder: { x: 0.32, y: 0.46 }, hipY: 0.22, legLen: 0.16, legX: 0.12,
    mood: 'calm', center: 0.54, R: 0.32,
  },
  chonk: {
    eyes: [{ x: -0.18, y: 0.58, r: 0.14 }, { x: 0.18, y: 0.58, r: 0.14 }],
    mouthY: 0.42, brows: true, shoulder: { x: 0.44, y: 0.48 }, hipY: 0.2, legLen: 0.14, legX: 0.22,
    mood: 'grumpy', fourLegs: true,
  },
  ghosty: {
    eyes: [{ x: -0.12, y: 0.64, r: 0.12 }, { x: 0.12, y: 0.64, r: 0.12 }],
    mouthY: 0.52, brows: false, shoulder: { x: 0.35, y: 0.52 }, hipY: 0.2, legLen: 0.12, legX: 0.14,
    mood: 'calm', center: 0.56, R: 0.34, isGhost: true,
  },
  triclops: {
    eyes: [{ x: -0.16, y: 0.48, r: 0.12 }, { x: 0.0, y: 0.66, r: 0.14 }, { x: 0.16, y: 0.48, r: 0.1 }],
    mouthY: 0.38, brows: false, shoulder: { x: 0.36, y: 0.48 }, hipY: 0.2, legLen: 0.16, legX: 0.15,
    mood: 'calm', center: 0.54, R: 0.36,
  },
  rolling_eye: {
    eyes: [{ x: -0.16, y: 0.64, r: 0.15 }, { x: 0.15, y: 0.72, r: 0.11 }],
    mouthY: 0.44, brows: false, shoulder: { x: 0.36, y: 0.52 }, hipY: 0.22, legLen: 0.16, legX: 0.14,
    mood: 'smug', center: 0.56, R: 0.36,
  },
  sherbet: {
    eyes: [{ x: -0.12, y: 0.6, r: 0.13 }, { x: 0.12, y: 0.6, r: 0.13 }],
    mouthY: 0.46, brows: true, shoulder: { x: 0.36, y: 0.52 }, hipY: 0.22, legLen: 0.16, legX: 0.14,
    mood: 'smug', center: 0.56, R: 0.36, hasHorns: true,
  },
  antenna: {
    eyes: [{ x: 0.0, y: 0.62, r: 0.22 }],
    mouthY: 0.42, brows: false, shoulder: { x: 0.32, y: 0.48 }, hipY: 0.22, legLen: 0.16, legX: 0.13,
    mood: 'calm', center: 0.56, R: 0.34, hasAntenna: true,
  },
  boing: {
    eyes: [{ x: -0.12, y: 0.7, r: 0.13 }, { x: 0.12, y: 0.7, r: 0.13 }],
    mouthY: 0.54, brows: true, shoulder: { x: 0.36, y: 0.62 }, hipY: 0.38, legLen: 0.36, legX: 0.16,
    mood: 'grumpy', center: 0.68, R: 0.34, springLegs: true,
  },
  boxer: {
    eyes: [{ x: -0.13, y: 0.64, r: 0.13 }, { x: 0.13, y: 0.64, r: 0.13 }],
    mouthY: 0.48, brows: true, shoulder: { x: 0.38, y: 0.54 }, hipY: 0.24, legLen: 0.18, legX: 0.15,
    mood: 'grumpy', center: 0.58, R: 0.36, boxingGloves: true,
  },
  plunger: {
    eyes: [{ x: -0.13, y: 0.68, r: 0.13 }, { x: 0.13, y: 0.68, r: 0.13 }],
    mouthY: 0.5, brows: true, shoulder: { x: 0.38, y: 0.54 }, hipY: 0.28, legLen: 0.22, legX: 0.15,
    mood: 'grumpy', plungerArms: true,
  },
};

// Mood → brow anger (-1 worried … +1 furious) and mouth curve (+1 frown … -1 grin)
const MOODS = {
  grumpy:  { brow: 0.75, mouth: 1 },
  calm:    { brow: 0.1,  mouth: 0.35 },
  smug:    { brow: 0.45, mouth: -0.8 },
  worried: { brow: -0.8, mouth: 0.9 },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h) - 0.5;
}

function weld(geo) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-4);
  g.computeVertexNormals();
  return g;
}

function cubeBody(w = 0.64, h = 0.76, d = 0.66) {
  const geo = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const pos = geo.attributes.position, v = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    s.copy(v).normalize().multiplyScalar(r * 1.2);
    v.lerp(s, 0.16);
    const j = 0.034;
    v.x += hash3(v.x, v.y, v.z) * j;
    v.y += hash3(v.y, v.z, v.x) * j;
    v.z += hash3(v.z, v.x, v.y) * j * 0.5;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return weld(geo);
}

function roundBody(radius, detail, sy = 1, sz = 1) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  geo.scale(1, sy, sz);
  return weld(geo);
}

function starBody(r = 0.4, depth = 0.28) {
  const shape = new THREE.Shape();
  const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.48;
    const x = Math.cos(angle) * rad;
    const y = Math.sin(angle) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const ext = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.05,
    bevelThickness: 0.05,
  });
  ext.center();
  return weld(ext);
}

function coilSpringGeo(r = 0.065, height = 0.36, turns = 5) {
  const points = [];
  const segments = turns * 16;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * turns * Math.PI * 2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = -t * height;
    points.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, segments, 0.015, 6, false);
}

function tentacleGeos() {
  const rand = rng(1337);
  const n = 34, bundles = [[], []];
  const dir = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const phi = Math.acos(-1 + (2 * (i + 0.5)) / n);
    const theta = Math.sqrt(n * Math.PI) * phi;
    dir.set(Math.cos(theta) * Math.sin(phi), Math.cos(phi), Math.sin(theta) * Math.sin(phi));
    if (dir.z > 0.45 && Math.abs(dir.x) < 0.7 && dir.y > -0.5 && dir.y < 0.75) continue;
    if (dir.y < -0.72) continue;
    const len = 0.22 + rand() * 0.22;
    side.crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize()
      .applyAxisAngle(dir, rand() * Math.PI * 2);
    const bend = 0.05 + rand() * 0.09;
    const p0 = dir.clone().multiplyScalar(0.29);
    const p1 = dir.clone().multiplyScalar(0.29 + len * 0.55).addScaledVector(side, bend * 0.4);
    const p2 = dir.clone().multiplyScalar(0.29 + len).addScaledVector(side, bend).add(new THREE.Vector3(0, -0.03, 0));
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const r = 0.03 + rand() * 0.012;
    const tube = new THREE.TubeGeometry(curve, 5, r, 5, false).toNonIndexed();
    const tip = new THREE.IcosahedronGeometry(r * 1.05, 0);
    tip.translate(p2.x, p2.y, p2.z);
    bundles[i % 2].push(tube, tip);
  }
  return bundles.map(list => {
    const g = mergeGeometries(list);
    list.forEach(x => x.dispose());
    return g;
  });
}

function handGeo() {
  const parts = [];
  const palm = new THREE.SphereGeometry(0.052, 8, 6);
  palm.scale(1, 1.1, 0.62);
  parts.push(palm);
  for (let i = -1; i <= 1; i++) {
    const f = new THREE.CapsuleGeometry(0.016, 0.045, 2, 6);
    f.rotateZ(i * 0.28);
    f.translate(i * 0.028, -0.068, 0);
    parts.push(f);
  }
  const thumb = new THREE.CapsuleGeometry(0.016, 0.035, 2, 6);
  thumb.rotateZ(-0.9);
  thumb.translate(0.055, -0.02, 0.01);
  parts.push(thumb);
  return mergeGeometries(parts.map(p => p.toNonIndexed()));
}

function boxingGloveGeo() {
  const parts = [];
  const mitt = new THREE.SphereGeometry(0.12, 10, 8);
  mitt.scale(1, 1.15, 0.85);
  parts.push(mitt);
  const thumb = new THREE.SphereGeometry(0.055, 8, 6);
  thumb.scale(1.2, 0.8, 0.8);
  // Geometry has no transform properties: bake the placement in (this used to throw on `boxer`).
  thumb.rotateZ(-0.4);
  thumb.translate(0.08, -0.02, 0.04);
  parts.push(thumb);
  const cuff = new THREE.CylinderGeometry(0.08, 0.09, 0.07, 8);
  cuff.translate(0, 0.12, 0);
  parts.push(cuff);
  return mergeGeometries(parts.map(p => p.toNonIndexed()));
}

function plungerHeadGeo() {
  const parts = [];
  const cup = new THREE.ConeGeometry(0.12, 0.1, 12, 1, true);
  cup.rotateX(Math.PI);
  parts.push(cup);
  const rim = new THREE.TorusGeometry(0.115, 0.02, 6, 12);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, -0.05, 0);
  parts.push(rim);
  return mergeGeometries(parts.map(p => p.toNonIndexed()));
}

function frownGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.075, 0);
  s.quadraticCurveTo(0, 0.034, 0.075, 0);
  s.quadraticCurveTo(0.08, 0.012, 0.07, 0.018);
  s.quadraticCurveTo(0, 0.07, -0.07, 0.018);
  s.quadraticCurveTo(-0.08, 0.012, -0.075, 0);
  const g = new THREE.ShapeGeometry(s, 6);
  g.translate(0, -0.025, 0);
  return g;
}

function screamMouth() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.095, -0.02);
  shape.quadraticCurveTo(0, 0.1, 0.095, -0.02);
  shape.quadraticCurveTo(0.085, -0.15, 0, -0.15);
  shape.quadraticCurveTo(-0.085, -0.15, -0.095, -0.02);
  const hole = new THREE.Mesh(cached('scream', () => new THREE.ShapeGeometry(shape, 8)),
    new THREE.MeshBasicMaterial({ color: 0x3a0a18, side: THREE.DoubleSide }));
  group.add(hole);
  const toothMat = new THREE.MeshBasicMaterial({ color: 0xfffdf4, side: THREE.DoubleSide });
  const teeth = new THREE.Shape();
  teeth.moveTo(-0.075, 0.0);
  teeth.quadraticCurveTo(0, 0.086, 0.075, 0.0);
  teeth.lineTo(0.068, -0.02);
  teeth.quadraticCurveTo(0, 0.05, -0.068, -0.02);
  teeth.closePath();
  const top = new THREE.Mesh(cached('teethTop', () => new THREE.ShapeGeometry(teeth, 6)), toothMat);
  top.position.z = 0.002;
  const bottom = new THREE.Mesh(cached('teethBot', () => new THREE.PlaneGeometry(0.06, 0.022)), toothMat);
  bottom.position.set(0.012, -0.128, 0.002);
  const tongue = new THREE.Mesh(cached('tongue', () => new THREE.CircleGeometry(0.038, 10)),
    new THREE.MeshBasicMaterial({ color: 0xff6f91 }));
  tongue.scale.set(1.3, 0.75, 1);
  tongue.position.set(0.015, -0.1, 0.001);
  group.add(top, bottom, tongue);
  noOutline(group);
  return group;
}

/** Build the mesh parts onto `d` (bodyGroup, eyes, brows, mouths, limbs…). */
export function buildDweebModel(d, darken) {
  const L = LAYOUT[d.type] ?? LAYOUT.cube;
  const bodyMat = toonMat({ color: d.color });
  bodyMat.flatShading = true;
  const limbMat = toonMat({ color: darken(d.color, 0.84) });
  const browMat = toonMat({ color: darken(d.color, 0.72) });
  browMat.flatShading = true;
  d.flashMats.push(bodyMat, limbMat, browMat);
  d.bodyGroup = new THREE.Group();
  d.rig.add(d.bodyGroup);
  d.layout = L;
  d.wiggleItems = [];

  const surfaceZ = (x, y) => {
    if (!L.R) return 0.36;
    const dx = x, dy = y - (L.center ?? 0.55);
    return Math.sqrt(Math.max(0.01, L.R * L.R - dx * dx - dy * dy)) * (L.zScale ?? 1);
  };

  // ─── Body Construction ───
  if (d.type === 'spiky') {
    const core = new THREE.Mesh(cached('spikyBody', () => roundBody(L.R, 1)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    const [a, b] = cached('tentacles', tentacleGeos);
    d.tentacles = [a, b].map((g, i) => {
      const m = new THREE.Mesh(g, bodyMat);
      m.position.y = L.center;
      m.userData.phase = i * Math.PI;
      d.bodyGroup.add(m);
      return m;
    });
  } else if (d.type === 'blob') {
    const core = new THREE.Mesh(cached('blobBody', () => roundBody(L.R, 2, 1.08, 0.95)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    const stalk = new THREE.Mesh(cached('stalk', () => new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6)), limbMat);
    stalk.position.set(0.05, 1.0, 0);
    stalk.rotation.z = -0.25;
    const bobble = new THREE.Mesh(cached('bobble', () => new THREE.IcosahedronGeometry(0.07, 1)), toonMat({ color: 0xfff1a8 }));
    bobble.position.set(0.09, 1.12, 0);
    d.bodyGroup.add(stalk, bobble);
    d.wiggleItems.push({ obj: stalk, bobble, speed: 4.5, amp: 0.15 });
  } else if (d.type === 'stalky') {
    const core = new THREE.Mesh(cached('stalkyBody', () => roundBody(L.R, 2, 1.1, 0.95)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    // Twin periscope stalks
    const stalkL = new THREE.Group();
    stalkL.position.set(-0.16, 0.72, 0);
    const stalkMeshL = new THREE.Mesh(cached('periscopeStalk', () => new THREE.CylinderGeometry(0.03, 0.035, 0.28, 6)), bodyMat);
    stalkMeshL.position.y = 0.14;
    stalkMeshL.rotation.z = 0.15;
    stalkL.add(stalkMeshL);
    d.bodyGroup.add(stalkL);

    const stalkR = new THREE.Group();
    stalkR.position.set(0.18, 0.72, 0);
    const stalkMeshR = new THREE.Mesh(cached('periscopeStalk', () => new THREE.CylinderGeometry(0.03, 0.035, 0.28, 6)), bodyMat);
    stalkMeshR.position.y = 0.14;
    stalkMeshR.rotation.z = -0.15;
    stalkR.add(stalkMeshR);
    d.bodyGroup.add(stalkR);
    d.wiggleItems.push({ obj: stalkL, speed: 5, amp: 0.12 }, { obj: stalkR, speed: 5.2, amp: -0.12 });
  } else if (d.type === 'bunny' || d.type === 'floppy') {
    const core = new THREE.Mesh(cached('bunnyBody' + d.type, () => roundBody(L.R, 2, 1.15, 0.95)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    // Floppy bouncy ears
    const earLen = d.type === 'floppy' ? 0.42 : 0.34;
    const earGeo = cached('ear' + d.type, () => {
      const g = new THREE.CapsuleGeometry(0.065, earLen, 4, 8);
      g.translate(0, -earLen * 0.4, 0);
      return weld(g);
    });
    for (const side of [-1, 1]) {
      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.18, 0.82, 0);
      const earMesh = new THREE.Mesh(earGeo, bodyMat);
      earMesh.rotation.z = side * (d.type === 'floppy' ? 0.75 : 0.35);
      earPivot.add(earMesh);
      d.bodyGroup.add(earPivot);
      d.wiggleItems.push({ obj: earPivot, speed: 6, amp: 0.25 * side, axis: 'z' });
    }
  } else if (d.type === 'puddle') {
    const core = new THREE.Mesh(cached('puddleBody', () => {
      const g = new THREE.CylinderGeometry(0.48, 0.6, 0.2, 14);
      return weld(g);
    }), bodyMat);
    core.position.y = 0.25;
    d.bodyGroup.add(core);
  } else if (d.type === 'blockhead') {
    const core = new THREE.Mesh(cached('blockheadCore', () => cubeBody(0.62, 0.62, 0.62)), bodyMat);
    core.position.y = 0.52;
    d.bodyGroup.add(core);
    const topStalk = new THREE.Mesh(cached('blockTopStalk', () => new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8)), limbMat);
    topStalk.position.set(0, 0.88, 0.1);
    d.bodyGroup.add(topStalk);
  } else if (d.type === 'gumball') {
    const core = new THREE.Mesh(cached('gumballBody', () => roundBody(L.R, 2)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    // Translucent belly globe with colored marbles
    const globeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.6,
    });
    const globe = new THREE.Mesh(cached('globe', () => new THREE.SphereGeometry(0.24, 12, 10)), globeMat);
    globe.position.set(0, 0.48, 0.2);
    d.bodyGroup.add(globe);
    const marbleColors = [0xff4d5e, 0x3fa9ff, 0xffd23f, 0x5ee06a, 0xff6fb5];
    for (let i = 0; i < 5; i++) {
      const mb = new THREE.Mesh(cached('mb' + i, () => new THREE.SphereGeometry(0.055, 8, 8)), toonMat({ color: marbleColors[i] }));
      mb.position.set((i % 2 === 0 ? 1 : -1) * 0.08, 0.44 + (i * 0.03), 0.2 + (i % 3) * 0.04);
      d.bodyGroup.add(mb);
    }
  } else if (d.type === 'starry') {
    const core = new THREE.Mesh(cached('starryBody', starBody), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
  } else if (d.type === 'bumpy') {
    const core = new THREE.Mesh(cached('bumpyBody', () => roundBody(L.R, 2)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const bump = new THREE.Mesh(cached('bump', () => new THREE.SphereGeometry(0.065, 8, 6)), bodyMat);
      bump.position.set(Math.cos(angle) * 0.35, L.center + Math.sin(angle * 2) * 0.18, Math.sin(angle) * 0.35);
      d.bodyGroup.add(bump);
    }
  } else if (d.type === 'tri_cloud') {
    const cloudGroup = new THREE.Group();
    const l1 = new THREE.Mesh(cached('cloudLobe1', () => roundBody(0.24, 1)), bodyMat);
    l1.position.set(-0.25, 0.56, 0);
    const l2 = new THREE.Mesh(cached('cloudLobe2', () => roundBody(0.28, 1)), bodyMat);
    l2.position.set(0, 0.65, 0);
    const l3 = new THREE.Mesh(cached('cloudLobe3', () => roundBody(0.24, 1)), bodyMat);
    l3.position.set(0.25, 0.56, 0);
    cloudGroup.add(l1, l2, l3);
    d.bodyGroup.add(cloudGroup);
  } else if (d.type === 'ghosty') {
    const core = new THREE.Mesh(cached('ghostCore', () => {
      const g = new THREE.CapsuleGeometry(0.3, 0.38, 4, 12);
      g.translate(0, 0.1, 0);
      return weld(g);
    }), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    // Ruffled skirt hem
    for (let i = 0; i < 6; i++) {
      const hem = new THREE.Mesh(cached('hem', () => new THREE.SphereGeometry(0.08, 6, 6)), bodyMat);
      const a = (i / 6) * Math.PI * 2;
      hem.position.set(Math.cos(a) * 0.26, 0.26, Math.sin(a) * 0.26);
      d.bodyGroup.add(hem);
    }
  } else if (d.type === 'peep') {
    const core = new THREE.Mesh(cached('peepCore', () => roundBody(L.R, 2)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    // Horns on head
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(cached('horn', () => new THREE.ConeGeometry(0.065, 0.16, 6)), limbMat);
      horn.position.set(side * 0.18, 0.88, 0);
      horn.rotation.z = -side * 0.4;
      d.bodyGroup.add(horn);
    }
  } else if (d.type === 'antenna') {
    const core = new THREE.Mesh(cached('antennaCore', () => roundBody(L.R, 2, 1.18, 0.95)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    const stalk = new THREE.Mesh(cached('antStalk', () => new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6)), limbMat);
    stalk.position.set(0, 0.98, 0);
    const tip = new THREE.Mesh(cached('antTip', () => new THREE.SphereGeometry(0.065, 8, 6)), toonMat({ color: 0xffd23f }));
    tip.position.set(0, 1.1, 0);
    d.bodyGroup.add(stalk, tip);
    d.wiggleItems.push({ obj: stalk, speed: 7, amp: 0.15, axis: 'z' });
  } else if (d.type === 'sherbet') {
    const core = new THREE.Mesh(cached('sherbetCore', () => roundBody(L.R, 2)), bodyMat);
    core.position.y = L.center;
    d.bodyGroup.add(core);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(cached('shHorn', () => new THREE.ConeGeometry(0.05, 0.14, 6)), toonMat({ color: 0xff6fb5 }));
      horn.position.set(side * 0.16, 0.88, 0);
      horn.rotation.z = -side * 0.35;
      d.bodyGroup.add(horn);
    }
  } else if (d.type === 'chonk') {
    const core = new THREE.Mesh(cached('chonkCore', () => cubeBody(0.72, 0.72, 0.72)), bodyMat);
    core.position.y = 0.54;
    d.bodyGroup.add(core);
  } else {
    // Default Cube / Pill / Round
    const isPill = d.type === 'blink';
    const core = new THREE.Mesh(
      cached(d.type + 'Core', () => isPill ? roundBody(L.R ?? 0.34, 2, 1.35, 0.9) : cubeBody()),
      bodyMat
    );
    core.position.y = L.center ?? 0.6;
    d.bodyGroup.add(core);
  }

  // Wagging tail for Tadpole
  if (L.hasTail) {
    const tailGroup = new THREE.Group();
    tailGroup.position.set(0, 0.45, -0.32);
    const tailMesh = new THREE.Mesh(cached('tailMesh', () => {
      const g = new THREE.ConeGeometry(0.08, 0.32, 6);
      g.rotateX(-Math.PI / 2);
      return g;
    }), bodyMat);
    tailGroup.add(tailMesh);
    d.bodyGroup.add(tailGroup);
    d.wiggleItems.push({ obj: tailGroup, speed: 8, amp: 0.3, axis: 'y' });
  }

  // ─── Eyes ───
  const eyeMat = toonMat({ color: 0xffffff });
  eyeMat.flatShading = true;
  const pupilMat = new THREE.MeshBasicMaterial({ color: INK });
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const creaseMat = new THREE.MeshBasicMaterial({ color: darken(d.color, 0.45) });
  d.eyes = [];
  d.brows = [];

  for (const e of L.eyes) {
    const side = Math.sign(e.x) || 1;
    const z = surfaceZ(e.x, e.y) - e.r * 0.15;
    const g = new THREE.Group();
    g.position.set(e.x, e.y, z);

    const white = new THREE.Mesh(cached('eye' + e.r, () => new THREE.IcosahedronGeometry(1, 1)), eyeMat);
    white.scale.set(e.r, e.r, e.r * 0.62);
    g.add(white);

    const pupil = new THREE.Mesh(cached('pupil' + e.r, () => new THREE.SphereGeometry(1, 12, 10)), pupilMat);
    pupil.scale.set(e.r * 0.4, e.r * 0.4, e.r * 0.2);
    pupil.position.z = e.r * 0.5;

    const shine = new THREE.Mesh(cached('shine', () => new THREE.SphereGeometry(1, 8, 6)), shineMat);
    shine.scale.setScalar(0.32);
    shine.position.set(0.35, 0.4, 0.8);
    pupil.add(shine);
    noOutline(pupil);
    g.add(pupil);
    d.bodyGroup.add(g);

    // Squeezed shut lid
    const lid = new THREE.Group();
    lid.position.copy(g.position);
    const cap = new THREE.Mesh(cached('eye' + e.r, () => new THREE.IcosahedronGeometry(1, 1)), bodyMat);
    cap.scale.set(e.r * 1.02, e.r * 0.8, e.r * 0.6);
    const crease = new THREE.Mesh(cached('crease', () => new THREE.PlaneGeometry(1, 1)), creaseMat);
    crease.scale.set(e.r * 1.5, 0.018, 1);
    crease.position.z = e.r * 0.61;
    crease.rotation.z = side * 0.12;
    noOutline(crease);
    lid.add(cap, crease);
    lid.visible = false;
    d.bodyGroup.add(lid);

    // X-eye
    const xg = new THREE.Group();
    xg.position.set(e.x, e.y, z + e.r * 0.5);
    const barGeo = cached('xbar' + e.r, () => new THREE.BoxGeometry(e.r * 1.5, 0.035, 0.03));
    const b1 = new THREE.Mesh(barGeo, pupilMat);
    b1.rotation.z = Math.PI / 4;
    const b2 = new THREE.Mesh(barGeo, pupilMat);
    b2.rotation.z = -Math.PI / 4;
    xg.add(b1, b2);
    xg.visible = false;
    noOutline(xg);
    d.bodyGroup.add(xg);

    d.eyes.push({ group: g, pupil, lid, xEye: xg, r: e.r });

    if (L.brows) {
      const brow = new THREE.Mesh(cached('brow', () => {
        const b = new THREE.BoxGeometry(1, 1, 1, 2, 1, 1);
        const p = b.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + (Math.abs(p.getX(i)) < 0.1 ? 0.12 : 0));
        return weld(b);
      }), browMat);
      brow.scale.set(e.r * 1.25, 0.05, 0.07);
      brow.userData.base = new THREE.Vector3(e.x, e.y + e.r + 0.035, z + e.r * 0.45);
      brow.userData.side = side;
      brow.position.copy(brow.userData.base);
      d.bodyGroup.add(brow);
      d.brows.push(brow);
    }
  }

  // ─── Mouths ───
  const mz = surfaceZ(0.02, L.mouthY) + 0.012;
  d.mouth = new THREE.Mesh(cached('frown', frownGeo), new THREE.MeshBasicMaterial({ color: 0x2a0c1c, side: THREE.DoubleSide }));
  d.mouth.position.set(0.015, L.mouthY, mz);
  noOutline(d.mouth);
  d.bodyGroup.add(d.mouth);
  d.screamMouth = screamMouth();
  d.screamMouth.position.set(0.015, L.mouthY + 0.01, mz + 0.004);
  d.screamMouth.visible = false;
  d.bodyGroup.add(d.screamMouth);

  // ─── Limbs & Arms ───
  const armLen = 0.32;
  const armGeo = cached('arm', () => {
    const g = new THREE.CylinderGeometry(0.026, 0.022, armLen, 6);
    g.translate(0, -armLen / 2, 0);
    return g;
  });
  const hand = cached('hand', handGeo);
  const glove = cached('glove', boxingGloveGeo);
  const plungerHead = cached('plungerHead', plungerHeadGeo);

  d.arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * L.shoulder.x, L.shoulder.y, 0);

    let endPart;
    if (L.boxingGloves) {
      endPart = new THREE.Mesh(glove, toonMat({ color: 0xff384b }));
      endPart.position.y = -armLen - 0.06;
      endPart.scale.set(side, 1, 1);
    } else if (L.plungerArms) {
      endPart = new THREE.Mesh(plungerHead, toonMat({ color: 0xff4d8d }));
      endPart.position.y = -armLen - 0.04;
      endPart.scale.set(side, 1, 1);
    } else {
      endPart = new THREE.Mesh(hand, limbMat);
      endPart.position.y = -armLen - 0.03;
      endPart.scale.x = side;
      endPart.rotation.y = side * 0.4;
    }

    const arm = new THREE.Mesh(armGeo, limbMat);
    pivot.add(arm, endPart);
    pivot.rotation.z = side * 0.35;
    d.rig.add(pivot);
    d.arms.push({ pivot, side });
  }

  // ─── Legs & Springs ───
  d.legs = [];
  if (L.springLegs) {
    const springGeo = cached('springLeg', () => coilSpringGeo(0.07, L.legLen, 4.5));
    const shoeGeo = cached('springShoe', () => new THREE.CylinderGeometry(0.08, 0.09, 0.04, 10));
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * L.legX, L.hipY, 0);
      const spring = new THREE.Mesh(springGeo, toonMat({ color: 0x8894a8 }));
      const shoe = new THREE.Mesh(shoeGeo, limbMat);
      shoe.position.set(0, -L.legLen - 0.02, 0);
      pivot.add(spring, shoe);
      d.rig.add(pivot);
      d.legs.push({ pivot, side, isSpring: true });
    }
  } else if (L.fourLegs) {
    const legGeo = cached('fourLeg' + d.type, () => {
      const g = new THREE.CylinderGeometry(0.034, 0.03, L.legLen, 6);
      g.translate(0, -L.legLen / 2, 0);
      return g;
    });
    const footGeo = cached('fourFoot', () => new THREE.SphereGeometry(0.06, 8, 6));
    for (const side of [-1, 1]) {
      for (const zOff of [-0.14, 0.14]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * L.legX, L.hipY, zOff);
        const leg = new THREE.Mesh(legGeo, limbMat);
        const foot = new THREE.Mesh(footGeo, limbMat);
        foot.position.set(0, -L.legLen - 0.02, 0.02);
        pivot.add(leg, foot);
        d.rig.add(pivot);
        d.legs.push({ pivot, side });
      }
    }
  } else {
    const legGeo = cached('leg' + d.type, () => {
      const g = new THREE.CylinderGeometry(0.03, 0.027, L.legLen, 6);
      g.translate(0, -L.legLen / 2, 0);
      return g;
    });
    const footGeo = cached('foot', () => {
      const g = new THREE.SphereGeometry(0.065, 10, 8);
      g.scale(1, 0.55, 1.5);
      return g;
    });
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * L.legX, L.hipY, 0);
      const leg = new THREE.Mesh(legGeo, limbMat);
      const foot = new THREE.Mesh(footGeo, limbMat);
      foot.position.set(0, -L.legLen - 0.02, 0.035);
      pivot.add(leg, foot);
      d.rig.add(pivot);
      d.legs.push({ pivot, side });
    }
  }

  d.mood = d.idleMood = L.mood;
  d.moodTimer = 2 + Math.random() * 4;
  d.gloatTimer = 0;
  d._seenKOs = 0;
  d._browAnger = MOODS[d.mood].brow;
  d._mouthCurve = MOODS[d.mood].mouth;
}

const lerpK = (dt, rate) => 1 - Math.exp(-rate * dt);

/** Face, appendages & physics-reacting ears/tentacles. Once per frame. */
export function animateDweebFace(d, dt, time) {
  const L = d.layout;
  const knocked = d.ragdolling;
  const screaming = knocked || d.hitstun > 0.15 || !!d.grabbedBy || d.swimFlail > 0;
  const gritting = !screaming && d.charging > 0;

  if (d.kos > d._seenKOs) { d._seenKOs = d.kos; d.gloatTimer = 2.5; }
  d.gloatTimer -= dt;
  d.moodTimer -= dt;
  if (d.moodTimer < 0) {
    d.moodTimer = 2.5 + Math.random() * 5;
    const r = Math.random();
    d.idleMood = r < 0.6 ? L.mood : r < 0.85 ? (L.mood === 'grumpy' ? 'calm' : 'grumpy') : 'smug';
  }
  d.mood = d.gloatTimer > 0 ? 'smug' : d.percent >= 100 ? 'worried' : d.idleMood;
  if (d.emoteT > 0 && d.emoteMood) d.mood = d.emoteMood;
  const m = MOODS[d.mood];
  const browTarget = screaming || gritting ? 1.15 : m.brow;
  d._browAnger += (browTarget - d._browAnger) * lerpK(dt, 14);
  d._mouthCurve += (m.mouth - d._mouthCurve) * lerpK(dt, 10);

  // Eyes: tracking, blinking, scream squint, X-eyes
  d.blinkTimer -= dt;
  let blink = 1;
  if (d.blinkTimer < 0) {
    blink = 0.1;
    if (d.blinkTimer < -0.1) d.blinkTimer = 1.5 + Math.random() * 3.5;
  }
  const lookX = Math.max(-0.35, Math.min(0.35, d.velocity.x * 0.04)) + Math.sin(time * 1.7 + d.index) * 0.12;
  const lookY = Math.max(-0.3, Math.min(0.3, d.velocity.y * 0.03));
  const squeeze = screaming && !knocked;

  for (const eye of d.eyes) {
    eye.group.visible = !screaming;
    eye.lid.visible = squeeze;
    eye.xEye.visible = knocked;
    eye.group.scale.y = blink * (gritting ? 0.8 : 1);
    eye.pupil.position.x = lookX * eye.r;
    eye.pupil.position.y = lookY * eye.r;
  }

  for (const b of d.brows) {
    const a = d._browAnger, base = b.userData.base;
    b.rotation.z = b.userData.side * 0.42 * a;
    b.position.set(base.x, base.y - 0.03 * a + (squeeze ? -0.02 : 0), base.z);
  }

  // Mouths
  d.mouth.visible = !screaming && !gritting;
  d.mouth.scale.y = d._mouthCurve;
  d.screamMouth.visible = screaming || gritting;
  if (d.screamMouth.visible) {
    const open = gritting ? 0.35 + d.charging * 0.15 : 1.3 + Math.sin(time * 38) * 0.1;
    d.screamMouth.scale.set(gritting ? 1.3 : 1.45, open, 1);
  }

  // Appendage dynamic physics wobble (ears, stalks, tails, antenna)
  if (d.wiggleItems) {
    const speedMult = screaming ? 2.5 : 1.0;
    for (const item of d.wiggleItems) {
      const axis = item.axis || 'z';
      const rot = Math.sin(time * item.speed * speedMult) * item.amp * (screaming ? 1.8 : 1.0);
      item.obj.rotation[axis] = rot;
    }
  }

  // Tentacles
  if (d.tentacles) {
    const amp = screaming ? 0.16 : 0.05, spd = screaming ? 14 : 3.2;
    for (const t of d.tentacles) {
      const p = time * spd + t.userData.phase;
      t.rotation.set(Math.sin(p) * amp, Math.sin(p * 0.7) * amp, Math.cos(p * 1.1) * amp);
    }
  }
}
