// WarfareModels.js — faceted low-poly toy models for Dweeb Warfare.
// Toy-box materials only: coloured plastic, wooden dowels, brass. No voxel blocks.
import * as THREE from 'three';
import { toonMat, noOutline } from '../render/Toon.js';

export const TEAM_COLORS = { blue: 0x3fa9ff, red: 0xff4d5e };

const geo = {};
const mat = {};

function shared() {
  if (geo.body) return;
  geo.body = new THREE.DodecahedronGeometry(0.55, 0);
  geo.sneak = new THREE.OctahedronGeometry(0.5, 0);
  geo.brute = new THREE.IcosahedronGeometry(0.95, 0);
  geo.boss = new THREE.DodecahedronGeometry(1.6, 0);
  geo.eye = new THREE.SphereGeometry(0.13, 6, 4);
  geo.pupil = new THREE.SphereGeometry(0.065, 5, 3);
  geo.disc = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 10);
  geo.tube = new THREE.CylinderGeometry(0.13, 0.17, 1.1, 7);
  geo.bomb = new THREE.IcosahedronGeometry(0.36, 0);
  geo.fuse = new THREE.CylinderGeometry(0.035, 0.035, 0.3, 4);
  geo.spark = new THREE.OctahedronGeometry(0.09, 0);
  geo.band = new THREE.TorusGeometry(0.46, 0.07, 4, 10);
  geo.dowel = new THREE.CylinderGeometry(0.09, 0.09, 1, 6);
  geo.club = new THREE.CylinderGeometry(0.12, 0.26, 1.5, 6);
  geo.gear = new THREE.CylinderGeometry(0.7, 0.7, 0.22, 12);
  geo.tooth = new THREE.ConeGeometry(0.16, 0.36, 4);
  geo.shadow = new THREE.CircleGeometry(0.6, 10);
  geo.pip = new THREE.SphereGeometry(0.075, 6, 4);
  geo.ring = new THREE.RingGeometry(0.75, 0.95, 16);
  mat.blue = toonMat({ color: TEAM_COLORS.blue });
  mat.red = toonMat({ color: TEAM_COLORS.red });
  mat.flash = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mat.eye = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mat.pupil = new THREE.MeshBasicMaterial({ color: 0x111111 });
  mat.plastic = toonMat({ color: 0xe8eef7 });
  mat.brass = toonMat({ color: 0xd4a73a });
  mat.wood = toonMat({ color: 0xb07a45 });
  mat.darkWood = toonMat({ color: 0x7a4a24 });
  mat.bomb = toonMat({ color: 0x2a2438 });
  mat.spark = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  mat.mask = toonMat({ color: 0x2b2b3a });
  mat.pit = toonMat({ color: 0x241a12 });
  mat.spike = toonMat({ color: 0x9a9aa8 });
  mat.shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
  mat.retreat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  mat.barrel = toonMat({ color: 0xd9432f });
  mat.crate = toonMat({ color: 0xc99a5b });
  mat.crateEdge = toonMat({ color: 0x7a4a24 });
  geo.barrel = new THREE.CylinderGeometry(0.45, 0.5, 1.1, 8);
  geo.barrelBand = new THREE.TorusGeometry(0.48, 0.055, 4, 10);
  geo.crate = new THREE.BoxGeometry(1, 0.9, 1);
  geo.crateEdge = new THREE.BoxGeometry(0.12, 0.98, 0.12);
}

export function teamMat(team) { shared(); return mat[team]; }
export function flashMat() { shared(); return mat.flash; }
export function sharedMats() { shared(); return mat; }

/** Toys read better a bit chunkier than their sim footprint. */
export const VIEW_SCALE = 1.35;
const SCALE = { shield: 1, rocket: 0.92, stealer: 0.88, kami: 0.85, sneak: 0.85, brute: 1, boss: 1, medic: 0.9 };

/**
 * Build one unit. Returns { root, body, gear, spark } where `body` is the mesh whose material
 * flips to white on hit, and `root` is positioned/rotated by the view (faces +x = forward).
 */
export function buildUnit(type, team) {
  shared();
  const root = new THREE.Group();
  const tilt = new THREE.Group();     // knockback lean + waddle live here
  root.add(tilt);
  const bodyGeo = type === 'sneak' ? geo.sneak : type === 'brute' ? geo.brute : type === 'boss' ? geo.boss : geo.body;
  const r = type === 'brute' ? 0.95 : type === 'boss' ? 1.6 : type === 'sneak' ? 0.5 : 0.55;
  const body = new THREE.Mesh(bodyGeo, mat[team]);
  body.position.y = r;
  body.castShadow = true;
  tilt.add(body);

  // googly eyes on the forward (+x) face
  const eyeScale = type === 'boss' ? 2.4 : type === 'brute' ? 1.6 : 1;
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(geo.eye, mat.eye);
    eye.scale.setScalar(eyeScale);
    eye.position.set(r * 0.82, r * 1.25, side * r * 0.32);
    const pupil = new THREE.Mesh(geo.pupil, mat.pupil);
    pupil.position.set(0.1, 0, 0);
    eye.add(pupil);
    tilt.add(eye);
  }

  let gear = null, spark = null;
  if (type === 'shield') {
    gear = new THREE.Group();
    const disc = new THREE.Mesh(geo.disc, mat.plastic);
    disc.rotation.z = Math.PI / 2;
    const boss = new THREE.Mesh(geo.bomb, mat.brass);
    boss.scale.setScalar(0.35);
    boss.position.x = 0.07;
    gear.add(disc, boss);
    gear.position.set(0.72, 0.6, 0);
  } else if (type === 'rocket') {
    gear = new THREE.Mesh(geo.tube, mat.brass);
    gear.rotation.z = -Math.PI / 2.6;
    gear.position.set(0.1, 1.15, 0.32);
  } else if (type === 'stealer') {
    gear = new THREE.Mesh(geo.band, mat.darkWood);
    gear.rotation.x = Math.PI / 2;
    gear.position.y = r * 1.35;
    gear.scale.set(1.05, 1.05, 1);
  } else if (type === 'kami') {
    gear = new THREE.Group();
    const b = new THREE.Mesh(geo.bomb, mat.bomb);
    const f = new THREE.Mesh(geo.fuse, mat.wood);
    f.position.y = 0.42;
    spark = new THREE.Mesh(geo.spark, mat.spark);
    spark.position.y = 0.6;
    noOutline(spark);
    gear.add(b, f, spark);
    gear.position.set(0, 1.35, 0);
  } else if (type === 'sneak') {
    gear = new THREE.Group();
    const m = new THREE.Mesh(geo.band, mat.mask);
    m.rotation.x = Math.PI / 2;
    m.position.y = 0.62;
    m.scale.set(1.05, 1.05, 1.4);
    const knife = new THREE.Mesh(geo.dowel, mat.brass);
    knife.scale.set(0.7, 0.55, 0.7);
    knife.rotation.z = -Math.PI / 2.2;
    knife.position.set(0.55, 0.45, -0.35);
    gear.add(m, knife);
  } else if (type === 'brute') {
    gear = new THREE.Mesh(geo.club, mat.wood);
    gear.rotation.z = -Math.PI / 4;
    gear.position.set(0.7, 1.4, -0.7);
  } else if (type === 'boss') {
    gear = new THREE.Group();
    const crown = new THREE.Mesh(geo.gear, mat.brass);
    crown.scale.set(1.4, 1, 1.4);
    gear.add(crown);
    for (let i = 0; i < 10; i++) {
      const t = new THREE.Mesh(geo.tooth, mat.brass);
      const a = (i / 10) * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.95, 0.25, Math.sin(a) * 0.95);
      gear.add(t);
    }
    gear.position.y = 3.25;
    const back = new THREE.Mesh(geo.gear, mat.brass);
    back.rotation.z = Math.PI / 2;
    back.position.set(-1.55, 1.7, 0);
    back.name = 'backGear';
    tilt.add(back);
  } else if (type === 'medic') {
    gear = new THREE.Group();
    // Red cross backpack
    const pack = new THREE.Mesh(geo.dowel, mat.wood);
    pack.scale.set(0.6, 0.8, 0.4);
    pack.position.set(-0.35, 0.9, 0);
    pack.rotation.x = Math.PI / 6;
    gear.add(pack);
    const crossV = new THREE.Mesh(geo.dowel, mat.red);
    crossV.scale.set(0.12, 0.45, 0.12);
    crossV.position.set(-0.35, 1.1, 0.05);
    gear.add(crossV);
    const crossH = new THREE.Mesh(geo.dowel, mat.red);
    crossH.scale.set(0.35, 0.12, 0.12);
    crossH.position.set(-0.35, 1.1, 0.05);
    crossH.rotation.z = Math.PI / 2;
    gear.add(crossH);
    // Small med pouch on hip
    const pouch = new THREE.Mesh(geo.dowel, mat.darkWood);
    pouch.scale.set(0.25, 0.3, 0.2);
    pouch.position.set(0.4, 0.55, -0.35);
    pouch.rotation.z = -Math.PI / 4;
    gear.add(pouch);
    gear.position.set(0, 0, 0);
  }
  if (gear) tilt.add(gear);

  // Veteran rank pips: three small gold dots above the body, toggled by the view from u.rank.
  const rank = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const pip = new THREE.Mesh(geo.pip, mat.brass);
    pip.position.set((i - 1) * 0.2, 0, 0);
    pip.visible = false;
    rank.add(pip);
  }
  rank.position.set(0, r * 2 + 0.35, 0);
  rank.visible = false;
  tilt.add(rank);

  const shadow = new THREE.Mesh(geo.shadow, mat.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.scale.setScalar(r / 0.55);
  noOutline(shadow);
  root.add(shadow);

  root.scale.setScalar((SCALE[type] || 1) * VIEW_SCALE);
  return { root, tilt, body, gear, spark, rank, height: r * 2 };
}

/** Arcing shell: a little brass rocket with a plastic nose. */
export function buildShell(team) {
  shared();
  const g = new THREE.Group();
  const tube = new THREE.Mesh(geo.tube, mat.brass);
  tube.scale.set(0.9, 0.6, 0.9);
  tube.rotation.z = Math.PI / 2;
  const nose = new THREE.Mesh(geo.tooth, mat[team]);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 0.42;
  g.add(tube, nose);
  return g;
}

/** Explosive barrel prop: red plastic drum with brass hoops. */
export function buildBarrel() {
  shared();
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo.barrel, mat.barrel);
  body.position.y = 0.55;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  for (const y of [0.28, 0.82]) {
    const band = new THREE.Mesh(geo.barrelBand, mat.brass);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 8), mat.brass);
  cap.position.y = 1.14;
  g.add(cap);
  return g;
}

/** Supply crate prop: a chunky wooden box with darker corner posts. */
export function buildCrate() {
  shared();
  const g = new THREE.Group();
  const box = new THREE.Mesh(geo.crate, mat.crate);
  box.position.y = 0.45;
  box.castShadow = true;
  box.receiveShadow = true;
  g.add(box);
  for (const sx of [-0.5, 0.5]) {
    for (const sz of [-0.5, 0.5]) {
      const post = new THREE.Mesh(geo.crateEdge, mat.crateEdge);
      post.position.set(sx, 0.49, sz);
      g.add(post);
    }
  }
  return g;
}

/** Ground ring used for the rally flag and selection pings. */
export function buildRing(color) {
  shared();
  const m = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  noOutline(m);
  return m;
}

/** Spike pit trap: a dark toy pit ringed with plastic spikes. */
export function buildTrap(r) {
  shared();
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 18), mat.pit);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  noOutline(disc);
  g.add(disc);
  const rim = new THREE.Mesh(new THREE.RingGeometry(r - 0.18, r + 0.12, 18), mat.spike);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.04;
  noOutline(rim);
  g.add(rim);
  const spikeGeo = new THREE.ConeGeometry(0.14, 0.7, 5);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = new THREE.Mesh(spikeGeo, mat.spike);
    s.position.set(Math.cos(a) * (r - 0.35), 0.3, Math.sin(a) * (r - 0.35));
    s.rotation.z = -Math.cos(a) * 0.35;
    s.rotation.x = Math.sin(a) * 0.35;
    g.add(s);
  }
  return g;
}

export function sharedGeo() { shared(); return geo; }
