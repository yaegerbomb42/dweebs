// ObjectModels.js — "Googly Toybox" procedural models for every interactive object.
// Each model is built once from faceted toy parts, merged per material (few draw calls), cached as a
// template, and cloned per spawn (geometry + materials shared). Models fit the def's visualScale,
// centred on the physics body. Tagged children drive per-instance life in InteractiveObject:
//   userData.pupil  — googly-eye pupil { c, n, u, v, r } (eye centre, normal, in-plane basis, eye radius)
//   userData.flicker — fuse spark that flickers
//   userData.screen — TV screen whose face texture changes with mood

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMat, noOutline } from '../render/Toon.js';
import * as S from '../render/Stickers.js';

const PI = Math.PI;
const W = 0xfff8ee, INK = 0x1b1030, CHROME = 0xc9d3e6;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);

// ─── Shared resources ───

const matCache = new Map();
function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    const m = color === 'vc'
      ? toonMat({ color: 0xffffff, vertexColors: true, ...opts })
      : toonMat({ color, ...opts });
    // Faceted shading from screen-space derivatives, while the geometry keeps smooth welded
    // normals so the OutlineEffect shell stays continuous (no cracks at hard edges)
    m.defines = { ...m.defines, FLAT_SHADED: '' };
    matCache.set(key, m);
  }
  return matCache.get(key);
}

const stickerMats = new Map();
function stickerMat(map) {
  if (!stickerMats.has(map)) {
    const m = toonMat({ map, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.userData.outlineParameters = { visible: false };
    stickerMats.set(map, m);
  }
  return stickerMats.get(map);
}

const pupilGeo = new THREE.SphereGeometry(1, 10, 8);
const shineGeo = new THREE.SphereGeometry(1, 6, 4);
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x14101c });
const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
pupilMat.userData.outlineParameters = { visible: false };
shineMat.userData.outlineParameters = { visible: false };

// ─── Geometry shorthands ───

const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const B = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
const Cyl = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const Ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const Tor = (R, r, rs = 5, ts = 12, arc = PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);
const Cone = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const Lathe = (pts, seg = 10) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

/** Colour every triangle by its centroid: fn(centroid) → hex. Returns a vertex-coloured geometry. */
function paint(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const cen = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    cen.set(
      (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
      (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
      (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3,
    );
    _c.set(fn(cen));
    for (let k = 0; k < 3; k++) col.set([_c.r, _c.g, _c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Lumpy deterministic vertex jitter (shared vertices move together so the mesh stays closed). */
function jitter(geo, amt, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 17.3) * 43758.5453;
    const k = 1 + ((h - Math.floor(h)) - 0.5) * 2 * amt / Math.hypot(x, y, z);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  return g;
}

/** Evenly spread directions on a sphere. */
function fibonacci(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return out;
}

// ─── Kit: collects parts, merges them per material ───

class Kit {
  constructor() {
    this.root = new THREE.Group();
    this.buckets = new Map();
  }

  /** t: { p:[x,y,z], r:[euler], s:[x,y,z], q:Quaternion, n:Vector3 (align +Y to n) } */
  _xf(t) {
    if (t.q) _q.copy(t.q);
    else if (t.n) _q.setFromUnitVectors(UP, _p.copy(t.n).normalize());
    else _q.setFromEuler(_e.set(...(t.r || [0, 0, 0])));
    _s.set(...(t.s || [1, 1, 1]));
    _p.set(...(t.p || [0, 0, 0]));
    return _m.compose(_p, _q, _s);
  }

  add(geo, color, t = {}, opts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    g.applyMatrix4(this._xf(t));
    const key = `${color}|${JSON.stringify(opts)}`;
    if (!this.buckets.has(key)) this.buckets.set(key, { color, opts, geos: [] });
    this.buckets.get(key).geos.push(g);
    geo.dispose();
    return this;
  }

  /** Flat die-cut sticker (plane facing +Z before the transform). */
  sticker(map, w, h, t = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), stickerMat(map));
    this._place(m, t);
    return m;
  }

  /** Curved label wrapped around a Y-axis cylinder (theta 0 faces +Z). */
  band(map, r, h, t = {}, thetaStart = 0, thetaLen = PI * 2, rep = 1) {
    const geo = new THREE.CylinderGeometry(r, r, h, 24, 1, true, thetaStart, thetaLen);
    if (rep !== 1) {
      map.wrapS = THREE.RepeatWrapping;
      map.needsUpdate = true;
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
    }
    const m = new THREE.Mesh(geo, stickerMat(map));
    this._place(m, t);
    return m;
  }

  _place(m, t) {
    this._xf(t).decompose(m.position, m.quaternion, m.scale);
    this.root.add(m);
  }

  /** Googly eye: white dome merged into the model + a free pupil the runtime rattles around. */
  eye(c, n, r) {
    const C = new THREE.Vector3(...c), N = new THREE.Vector3(...n).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(FWD, N);
    this.add(Ico(r, 1), 0xffffff, { p: c, q, s: [1, 1, 0.62] });
    this.add(Tor(r * 0.98, r * 0.09, 3, 14), INK, { p: C.clone().addScaledVector(N, -r * 0.1).toArray(), q });
    const U = new THREE.Vector3().crossVectors(UP, N);
    if (U.lengthSq() < 1e-4) U.set(1, 0, 0);
    U.normalize();
    const V = new THREE.Vector3().crossVectors(N, U);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.scale.set(r * 0.5, r * 0.5, r * 0.22);
    pupil.quaternion.copy(q);
    pupil.position.copy(C).addScaledVector(N, r * 0.52).addScaledVector(V, -r * 0.3);
    const shine = new THREE.Mesh(shineGeo, shineMat);
    shine.scale.setScalar(0.28);
    shine.position.set(0.38, 0.38, 0.8);
    pupil.add(shine);
    pupil.userData.pupil = { c, n: N.toArray(), u: U.toArray(), v: V.toArray(), r };
    this.root.add(pupil);
  }

  build() {
    for (const { color, opts, geos } of this.buckets.values()) {
      const merged = mergeVertices(mergeGeometries(geos), 1e-4);
      merged.computeVertexNormals();
      geos.forEach(g => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat(color, opts));
      mesh.castShadow = !opts.transparent;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    return this.root;
  }
}

// ─── The toy box ───

function barrelBody(k, color) {
  k.add(Lathe([[0, -0.45], [0.25, -0.45], [0.28, -0.41], [0.3, -0.2], [0.31, 0], [0.3, 0.2], [0.28, 0.41], [0.25, 0.45], [0, 0.45]], 12), color);
  for (const y of [-0.3, 0.3]) k.add(Tor(0.298, 0.024, 4, 16), INK, { p: [0, y, 0], r: [PI / 2, 0, 0] });
  for (const y of [-0.44, 0.44]) k.add(Tor(0.255, 0.02, 4, 16), INK, { p: [0, y, 0], r: [PI / 2, 0, 0] });
}

const BUILDERS = {
  chair(k) {
    const wood = 0xc98a4b, dark = 0x9a6232;
    k.add(B(0.66, 0.1, 0.62), wood, { p: [0, -0.02, 0] });
    k.add(B(0.56, 0.07, 0.5, 0.03), 0xff4d5e, { p: [0, 0.06, 0.03] });
    for (const x of [-0.26, 0.26]) for (const z of [-0.24, 0.24]) k.add(Cyl(0.045, 0.035, 0.46, 6), dark, { p: [x, -0.27, z] });
    for (const x of [-0.26, 0.26]) k.add(B(0.08, 0.54, 0.07, 0.02), dark, { p: [x, 0.24, -0.27] });
    for (const y of [0.12, 0.26, 0.4]) k.add(B(0.5, 0.08, 0.05, 0.02), wood, { p: [0, y, -0.27] });
    k.add(B(0.2, 0.05, 0.06, 0.02), 0xffd23f, { p: [0.12, 0.33, -0.23], r: [0, 0, 0.4] }); // gum-stuck patch
  },

  table(k) {
    const top = 0xb5773f, leg = 0x8a5a2e;
    k.add(B(1.4, 0.12, 0.9, 0.04), top, { p: [0, 0.29, 0] });
    k.add(B(1.22, 0.07, 0.72, 0.02), leg, { p: [0, 0.2, 0] });
    for (const x of [-0.58, 0.58]) for (const z of [-0.34, 0.34]) k.add(Cyl(0.08, 0.055, 0.58, 7), leg, { p: [x, -0.06, z] });
    for (const x of [-0.58, 0.58]) for (const z of [-0.34, 0.34]) k.add(Cyl(0.07, 0.07, 0.04, 7), 0xffd23f, { p: [x, -0.33, z] });
    k.sticker(S.checker(), 1.18, 0.72, { p: [0, 0.353, 0], r: [-PI / 2, 0, 0.06] });
  },

  crate(k) {
    const wood = 0xe0ad62, frame = 0xa8743a;
    k.add(Box(0.62, 0.62, 0.62), wood);
    const e = 0.31, t = 0.1;
    for (const a of [-e, e]) for (const b of [-e, e]) {
      k.add(B(0.72, t, t, 0.02), frame, { p: [0, a, b] });
      k.add(B(t, 0.72, t, 0.02), frame, { p: [a, 0, b] });
      k.add(B(t, t, 0.72, 0.02), frame, { p: [a, b, 0] });
    }
    for (const z of [-0.315, 0.315]) k.add(B(0.78, 0.09, 0.04, 0.015), frame, { p: [0, 0, z], r: [0, 0, PI / 4] });
    for (const x of [-e, e]) for (const y of [-e, e]) for (const z of [-e, e]) k.add(Box(0.12, 0.12, 0.12), 0x7d8db5, { p: [x, y, z] });
    const st = S.textSticker('DWEEB\nCO.', { bg: '#fff8ee', w: 256, h: 180, tilt: -0.06 });
    k.sticker(st, 0.38, 0.27, { p: [0.316, 0, 0], r: [0, PI / 2, 0] });
    k.sticker(st, 0.38, 0.27, { p: [-0.316, 0, 0], r: [0, -PI / 2, 0] });
  },

  barrel(k) {
    barrelBody(k, 0x3f8fd6);
    k.add(Cyl(0.045, 0.045, 0.04, 6), CHROME, { p: [0.14, 0.45, 0] });
    k.band(S.textSticker('100%\nMYSTERY', { bg: '#fff8ee', w: 256, h: 160 }), 0.316, 0.26, {}, -0.6, 1.2);
  },

  explosiveBarrel(k) {
    barrelBody(k, 0xff3b3b);
    k.band(S.stripes(), 0.316, 0.14, { p: [0, -0.16, 0] }, 0, PI * 2, 5);
    k.band(S.textSticker('BOOM', { bg: '#ffd23f', w: 256, h: 128, shape: 'burst' }), 0.316, 0.26, { p: [0, 0.1, 0] }, PI - 0.6, 1.2);
    k.eye([-0.085, 0.14, 0.285], [-0.28, 0.05, 1], 0.075);
    k.eye([0.085, 0.14, 0.285], [0.28, 0.05, 1], 0.075);
    k.add(Cyl(0.014, 0.014, 0.12, 4), INK, { p: [0.03, 0.5, 0], r: [0, 0, -0.35] });
    const spark = new THREE.Mesh(Ico(0.045, 0), toonMat({ color: 0xffd23f, emissive: 0xff9a3c, emissiveIntensity: 1 }));
    spark.position.set(0.055, 0.56, 0);
    spark.userData.flicker = true;
    noOutline(spark);
    k.root.add(spark);
  },

  brick(k) {
    k.add(B(0.3, 0.2, 0.16, 0.025), 0xd4583a);
    for (const x of [-0.09, 0, 0.09]) k.add(Cyl(0.03, 0.03, 0.02, 8), 0x6a2418, { p: [x, 0.093, 0] });
  },

  cinderBlock(k) {
    k.add(B(0.4, 0.3, 0.3, 0.02), 0xa9a4c4);
    for (const x of [-0.095, 0.095]) for (const y of [-0.143, 0.143]) k.add(B(0.14, 0.02, 0.19, 0.008), 0x4a4668, { p: [x, y, 0] });
    k.add(Box(0.3, 0.006, 0.02), 0x8783a6, { p: [0.02, 0.152, 0.12], r: [0, 0.2, 0] }); // crack
  },

  plank(k) {
    k.add(B(1.2, 0.08, 0.24, 0.02), 0xe0ab66);
    for (const [x, z, l] of [[-0.1, -0.06, 0.8], [0.15, 0.02, 0.7], [-0.05, 0.08, 0.9]]) k.add(Box(l, 0.006, 0.012), 0xb98040, { p: [x, 0.041, z] });
    for (const x of [-0.52, 0.52]) for (const z of [-0.06, 0.06]) k.add(Cyl(0.018, 0.018, 0.012, 6), CHROME, { p: [x, 0.046, z] });
    k.add(Cyl(0.008, 0.008, 0.12, 4), CHROME, { p: [0.3, 0.08, 0.05], r: [0, 0, 0.6] }); // bent nail
  },

  tire(k) {
    k.add(Tor(0.24, 0.115, 6, 14), 0x2d2a3a, { r: [PI / 2, 0, 0] });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * PI * 2;
      k.add(Box(0.06, 0.2, 0.06), 0x3d3a4d, { p: [Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35], r: [0, -a, 0] });
    }
    k.add(Cyl(0.15, 0.15, 0.16, 10), CHROME);
    k.add(Cyl(0.06, 0.06, 0.18, 6), 0xffd23f);
  },

  trafficCone(k) {
    const o = 0xff7a1a, r = y => 0.13 - (y + 0.25) / 0.54 * 0.105;
    k.add(B(0.3, 0.05, 0.3, 0.015), o, { p: [0, -0.275, 0] });
    k.add(Cyl(0.025, 0.13, 0.54, 10), o, { p: [0, 0.02, 0] });
    for (const y of [-0.1, 0.13]) k.add(Cyl(r(y + 0.035) + 0.006, r(y - 0.035) + 0.006, 0.07, 10), W, { p: [0, y, 0] });
    k.eye([-0.04, 0.015, 0.075], [-0.45, 0.2, 0.87], 0.04);
    k.eye([0.04, 0.015, 0.075], [0.45, 0.2, 0.87], 0.04);
  },

  bucket(k) {
    const b = 0x3fa9ff;
    k.add(Cyl(0.18, 0.14, 0.38, 12, true), b, {}, { side: THREE.DoubleSide });
    k.add(Cyl(0.14, 0.14, 0.01, 12), b, { p: [0, -0.19, 0] });
    k.add(Tor(0.18, 0.018, 4, 16), 0x2f7fd6, { p: [0, 0.19, 0], r: [PI / 2, 0, 0] });
    k.add(Cyl(0.168, 0.168, 0.01, 12), 0x8ff5ff, { p: [0, 0.1, 0] });
    k.add(Tor(0.17, 0.01, 4, 12, PI), CHROME, { p: [0, 0.19, 0], r: [-0.9, 0, 0] });
  },

  shoppingCart(k) {
    const c = CHROME;
    k.add(Box(0.62, 0.03, 0.86), c, { p: [0, -0.1, 0] });
    for (const y of [-0.1, 0.08, 0.25, 0.4]) {
      for (const x of [-0.31, 0.31]) k.add(Box(0.025, 0.025, 0.9), c, { p: [x, y, 0] });
      for (const z of [-0.44, 0.44]) k.add(Box(0.64, 0.025, 0.025), c, { p: [0, y, z] });
    }
    for (const z of [-0.44, -0.26, -0.08, 0.1, 0.28, 0.44]) for (const x of [-0.31, 0.31]) k.add(Box(0.022, 0.5, 0.022), c, { p: [x, 0.15, z] });
    for (const x of [-0.15, 0, 0.15]) for (const z of [-0.44, 0.44]) k.add(Box(0.022, 0.5, 0.022), c, { p: [x, 0.15, z] });
    k.add(Cyl(0.035, 0.035, 0.7, 8), 0xff4d5e, { p: [0, 0.45, -0.52], r: [0, 0, PI / 2] });
    for (const x of [-0.3, 0.3]) k.add(Box(0.025, 0.12, 0.08), c, { p: [x, 0.42, -0.48] });
    for (const x of [-0.2, 0.2]) k.add(Box(0.05, 0.05, 0.8), c, { p: [x, -0.3, 0] });
    for (const x of [-0.25, 0.25]) for (const z of [-0.38, 0.38]) {
      k.add(Box(0.03, 0.22, 0.03), c, { p: [x, -0.21, z] });
      k.add(Cyl(0.07, 0.07, 0.05, 8), INK, { p: [x, -0.38, z], r: [0, 0, PI / 2] });
    }
    k.add(Box(0.5, 0.02, 0.18), 0xff4d5e, { p: [0, 0.3, -0.35], r: [0.5, 0, 0] });
  },

  trashCan(k) {
    const g = 0x5bbf6a, dg = 0x3f9a52;
    k.add(Cyl(0.215, 0.18, 0.6, 12), g, { p: [0, -0.05, 0] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2 + 0.2;
      k.add(Box(0.035, 0.5, 0.035), dg, { p: [Math.cos(a) * 0.2, -0.05, Math.sin(a) * 0.2] });
    }
    k.add(Tor(0.215, 0.022, 4, 16), dg, { p: [0, 0.25, 0], r: [PI / 2, 0, 0] });
    k.add(Cyl(0.2, 0.2, 0.01, 12), INK, { p: [0, 0.255, 0] });
    k.add(Cyl(0.235, 0.235, 0.05, 12), g, { p: [0, 0.37, -0.05], r: [-0.34, 0, 0] });
    k.add(B(0.14, 0.04, 0.05, 0.015), dg, { p: [0, 0.405, -0.06], r: [-0.34, 0, 0] });
    for (const x of [-0.22, 0.22]) k.add(Tor(0.05, 0.014, 4, 8, PI), dg, { p: [x, 0.08, 0], r: [0, PI / 2, 0] });
    k.eye([-0.07, 0.3, 0.17], [-0.2, 0.1, 1], 0.055);
    k.eye([0.07, 0.3, 0.17], [0.2, 0.1, 1], 0.055);
  },

  rock(k) {
    k.add(jitter(Ico(0.2, 1), 0.04, 3), 0x8d8aa8, { s: [1, 0.87, 1] });
    k.add(jitter(Ico(0.14, 1), 0.02, 7), 0x6fcf5a, { p: [0.02, 0.1, -0.01], s: [1, 0.35, 1] });
  },

  watermelon(k) {
    k.add(paint(new THREE.SphereGeometry(0.2, 16, 10), c => Math.sin(Math.atan2(c.z, c.x) * 8 + Math.sin(c.y * 30) * 0.5) > 0.2 ? 0x7fd35a : 0x2f8f3a), 'vc', { s: [1.02, 0.87, 0.98] });
    k.add(Cyl(0.012, 0.018, 0.05, 5), 0x6a4a2a, { p: [0, 0.18, 0] });
    k.add(Ico(0.05, 0), 0x5ee06a, { p: [0.04, 0.185, 0], s: [1, 0.2, 0.6], r: [0, 0, 0.3] });
    k.eye([-0.065, 0.05, 0.17], [-0.35, 0.2, 1], 0.048);
    k.eye([0.065, 0.05, 0.17], [0.35, 0.2, 1], 0.048);
  },

  whoopeeCushion(k) {
    const pink = 0xff5fa2, dark = 0xd93d82;
    k.add(Ico(0.26, 2), pink, { p: [0, 0.01, -0.02], s: [1, 0.26, 1] });
    k.add(Cyl(0.05, 0.065, 0.12, 8), dark, { p: [0, 0.0, 0.27], r: [PI / 2, 0, 0] });
    k.add(Tor(0.055, 0.018, 5, 10), dark, { p: [0, 0.0, 0.335] });
    k.eye([-0.07, 0.065, 0.06], [-0.2, 1, 0.35], 0.04);
    k.eye([0.07, 0.065, 0.06], [0.2, 1, 0.35], 0.04);
  },
  bananaPeel(k) {
    const skin = 0xffd93b, flesh = 0xfff1b8, tip = 0x6a4a2a;
    const flap = (a, len, lift, r) => {
      const pts = [
        new THREE.Vector3(0, 0.02, 0),
        new THREE.Vector3(Math.cos(a) * len * 0.35, lift, Math.sin(a) * len * 0.35),
        new THREE.Vector3(Math.cos(a) * len * 0.72, lift * 0.85, Math.sin(a) * len * 0.72),
        new THREE.Vector3(Math.cos(a) * len, lift * 0.25, Math.sin(a) * len),
      ];
      return paint(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, r, 5, false),
        c => (c.y > lift * 0.55 ? flesh : skin),
      );
    };
    const flaps = [
      [0.35, 0.25, 0.075, 0.054],
      [PI * 0.78, 0.23, 0.065, 0.05],
      [PI * 1.28, 0.255, 0.08, 0.055],
      [PI * 1.74, 0.19, 0.05, 0.043],
    ];
    for (const [a, len, lift, r] of flaps) k.add(flap(a, len, lift, r), 'vc');
    k.add(Ico(0.095, 1), flesh, { p: [0, 0.045, 0], s: [1.25, 0.5, 1.1] });
    for (const [a, len, lift] of [[0.35, 0.25, 0.075], [PI * 1.28, 0.255, 0.08]]) {
      k.add(Ico(0.035, 0), tip, { p: [Math.cos(a) * len, lift * 0.25, Math.sin(a) * len], s: [1, 0.7, 1] });
    }
    k.eye([-0.042, 0.095, 0.072], [-0.25, 0.35, 1], 0.038);
    k.eye([0.042, 0.095, 0.072], [0.25, 0.35, 1], 0.038);
  },

  beachBall(k) {
    const cols = [0xff4d5e, W, 0x3fa9ff, W, 0xffd23f, W];
    k.add(paint(new THREE.SphereGeometry(0.3, 12, 9), c => Math.abs(c.y) > 0.25 ? W : cols[Math.floor(((Math.atan2(c.z, c.x) + PI) / (PI * 2)) * 6 + 0.001) % 6]), 'vc');
    k.add(Cyl(0.025, 0.025, 0.03, 6), W, { p: [0, 0.3, 0] });
  },

  partyBalloon(k) {
    const pink = 0xff4d8d, dark = 0xc21b38;
    // Balloon body floats above the grab point; the string curls down below it.
    k.add(new THREE.SphereGeometry(0.3, 16, 12), pink, { p: [0, 0.48, 0], s: [1, 1.08, 1] });
    k.add(Ico(0.07, 1), 0xffb3d9, { p: [-0.1, 0.63, 0.16], s: [1, 0.55, 0.45] });
    k.add(Cone(0.05, 0.07, 6), dark, { p: [0, 0.17, 0], r: [PI, 0, 0] });
    for (let i = 0; i < 6; i++) {
      const y = 0.12 - i * 0.075;
      k.add(Cyl(0.008, 0.008, 0.085, 4), W, {
        p: [Math.sin(i * 1.35) * 0.035, y, Math.cos(i * 1.1) * 0.03],
        r: [Math.sin(i * 1.7) * 0.4, 0, Math.cos(i * 1.3) * 0.5],
      });
    }
    k.eye([-0.09, 0.53, 0.27], [-0.32, 0.12, 1], 0.055);
    k.eye([0.09, 0.53, 0.27], [0.32, 0.12, 1], 0.055);
  },

  bowlingBall(k) {
    k.add(paint(Ico(0.15, 2), c => Math.sin(c.x * 34 + Math.sin(c.y * 28) * 2.4 + c.z * 12) > 0.55 ? 0xb56cff : 0x4b2fa8), 'vc');
    for (const d of [[0, 0.8, 0.6], [-0.2, 0.62, 0.76], [0.2, 0.62, 0.76]]) {
      const n = new THREE.Vector3(...d).normalize();
      k.add(Cyl(0.024, 0.024, 0.02, 8), INK, { p: n.clone().multiplyScalar(0.146).toArray(), n });
    }
  },

  sign(k) {
    k.add(B(0.8, 0.46, 0.06, 0.02), 0xffd23f, { p: [0, 0.07, 0] });
    for (const x of [-0.25, 0.25]) k.add(B(0.06, 0.18, 0.05, 0.01), 0x8a5a2e, { p: [x, -0.22, 0] });
    k.sticker(S.textSticker('BONK\nZONE', { bg: '#ff4d5e', fg: '#fff8ee', w: 256, h: 150 }), 0.72, 0.42, { p: [0, 0.07, 0.032] });
    k.sticker(S.textSticker('NO\nYEETING', { bg: '#3fa9ff', fg: '#fff8ee', w: 256, h: 150, tilt: 0.04 }), 0.72, 0.42, { p: [0, 0.07, -0.032], r: [0, PI, 0] });
  },

  ladder(k) {
    for (const x of [-0.21, 0.21]) {
      k.add(B(0.07, 1.8, 0.09, 0.02), 0xff9a3c, { p: [x, 0, 0] });
      k.add(Box(0.09, 0.05, 0.12), INK, { p: [x, -0.88, 0] });
    }
    for (let i = 0; i < 6; i++) k.add(Cyl(0.028, 0.028, 0.42, 6), 0xffd23f, { p: [0, -0.75 + i * 0.3, 0], r: [0, 0, PI / 2] });
  },

  pogoStick(k) {
    const pole = 0xff8a1f, grip = 0x2d2a3a, spring = 0xc9d3e6, rubber = 0x333333;
    k.add(Cyl(0.045, 0.055, 1.0, 8), pole);
    // T-handle bar
    k.add(Cyl(0.04, 0.04, 0.34, 8), grip, { p: [0, 0.48, 0], r: [0, 0, PI / 2] });
    for (const x of [-0.16, 0.16]) k.add(Cyl(0.055, 0.055, 0.08, 8), 0xffd23f, { p: [x, 0.48, 0], r: [0, 0, PI / 2] });
    // Chunky coil spring above the foot
    for (let i = 0; i < 5; i++) {
      k.add(Tor(0.085, 0.022, 4, 12), spring, { p: [0, -0.3 + i * 0.06, 0], r: [PI / 2, 0, 0] });
    }
    // Foot pegs
    for (const x of [-0.1, 0.1]) {
      k.add(Cyl(0.026, 0.026, 0.14, 6), grip, { p: [x, -0.28, 0], r: [0, 0, PI / 2] });
    }
    // Rubber foot tip
    k.add(Cyl(0.07, 0.09, 0.09, 10), rubber, { p: [0, -0.46, 0] });
    k.add(Ico(0.07, 0), rubber, { p: [0, -0.5, 0], s: [1, 0.45, 1] });
    // Googly eyes on the handle
    k.eye([-0.07, 0.5, 0.05], [-0.25, 0.15, 1], 0.045);
    k.eye([0.07, 0.5, 0.05], [0.25, 0.15, 1], 0.045);
  },

  couch(k) {
    const c = 0x6f7cff, l = 0x8f9bff, d = 0x4f5ad6;
    k.add(B(1.46, 0.26, 0.76, 0.05), c, { p: [0, -0.16, 0] });
    for (const x of [-0.68, 0.68]) for (const z of [-0.32, 0.32]) k.add(Cyl(0.04, 0.03, 0.07, 6), 0x8a5a2e, { p: [x, -0.315, z] });
    for (const x of [-0.36, 0.36]) {
      k.add(B(0.7, 0.14, 0.58, 0.05), l, { p: [x, 0.03, 0.07] });
      k.add(B(0.68, 0.3, 0.1, 0.045), l, { p: [x, 0.13, -0.17] });
      k.add(Ico(0.022, 0), d, { p: [x, 0.16, -0.115] });
    }
    k.add(B(1.44, 0.4, 0.2, 0.06), c, { p: [0, 0.13, -0.29] });
    for (const x of [-0.73, 0.73]) k.add(B(0.16, 0.44, 0.78, 0.06), d, { p: [x, -0.05, 0] });
    for (const r of [0.7, -0.7]) k.add(Box(0.05, 0.012, 0.24), 0xe9e2c8, { p: [0.73, 0.175, 0.12], r: [0, r, 0] }); // tape X
  },

  mattress(k) {
    k.add(B(1.2, 0.24, 1.8, 0.08), 0xf3efe2);
    for (const x of [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42]) k.add(Box(0.03, 0.004, 1.62), 0x9fc7ff, { p: [x, 0.121, 0] });
    for (const x of [-0.3, 0, 0.3]) for (const z of [-0.6, -0.3, 0, 0.3]) k.add(Ico(0.028, 0), 0xd8d2c0, { p: [x, 0.121, z], s: [1, 0.4, 1] });
    k.add(B(0.8, 0.1, 0.34, 0.05), 0xbfe3ff, { p: [0, 0.16, 0.66] });
    k.sticker(S.textSticker('DO NOT\nREMOVE', { bg: '#fff8ee', w: 200, h: 140 }), 0.16, 0.11, { p: [0.603, -0.02, 0.7], r: [0, PI / 2, 0] });
  },

  flowerPot(k) {
    k.add(Cyl(0.11, 0.08, 0.22, 8), 0xd96a3c, { p: [0, -0.04, 0] });
    k.add(Cyl(0.125, 0.12, 0.06, 8), 0xe8845a, { p: [0, 0.09, 0] });
    k.add(Cyl(0.11, 0.11, 0.01, 8), 0x5a3a2a, { p: [0, 0.115, 0] });
    k.add(Cyl(0.01, 0.01, 0.2, 4), 0x3faa4a, { p: [0, 0.21, 0] });
    k.add(Ico(0.045, 0), 0x5ee06a, { p: [0.045, 0.18, 0], s: [1, 0.3, 0.5], r: [0, 0, 0.5] });
    k.add(Ico(0.045, 0), 0x5ee06a, { p: [-0.045, 0.23, 0], s: [1, 0.3, 0.5], r: [0, 0, -0.5] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      k.add(Ico(0.036, 0), 0xff6fb5, { p: [Math.cos(a) * 0.045, 0.32, Math.sin(a) * 0.045], s: [1, 0.5, 1] });
    }
    k.add(Ico(0.028, 1), 0xffd23f, { p: [0, 0.325, 0] });
  },

  box(k) {
    k.add(B(0.5, 0.5, 0.5, 0.015), 0xd9a866);
    const tape = 0xefdfb0;
    k.add(Box(0.52, 0.006, 0.12), tape, { p: [0, 0.252, 0] });
    for (const x of [-0.252, 0.252]) k.add(Box(0.006, 0.16, 0.12), tape, { p: [x, 0.17, 0] });
    k.add(Box(0.5, 0.004, 0.006), 0xa8834a, { p: [0, 0.256, 0] });
    k.sticker(S.textSticker('FRAGILE', { bg: '#fff8ee', fg: '#e8283f', w: 256, h: 96, tilt: -0.08 }), 0.36, 0.135, { p: [0, -0.11, 0.252] });
    k.sticker(S.textSticker('UP!', { bg: '#ffd23f', w: 128, h: 128, shape: 'circle' }), 0.16, 0.16, { p: [0.252, 0, 0.1], r: [0, PI / 2, 0] });
    k.eye([-0.085, 0.07, 0.25], [0, 0, 1], 0.065);
    k.eye([0.085, 0.07, 0.25], [0, 0, 1], 0.065);
  },

  bottle(k) {
    k.add(Lathe([[0, -0.15], [0.036, -0.15], [0.04, -0.13], [0.04, 0.02], [0.03, 0.06], [0.016, 0.085], [0.016, 0.125], [0.02, 0.13], [0, 0.13]], 8),
      0x5fe0a0, {}, { transparent: true, opacity: 0.78 });
    k.add(Cyl(0.015, 0.013, 0.035, 6), 0xc98a4b, { p: [0, 0.14, 0] });
    k.band(S.label('FIZZ'), 0.0415, 0.07, { p: [0, -0.05, 0] });
  },

  giantRubberDuck(k) {
    const y = 0xffd23f, o = 0xff9a3c;
    k.add(Ico(0.33, 1), y, { p: [0, -0.12, -0.02], s: [1, 0.78, 1.15] });
    k.add(Ico(0.2, 1), y, { p: [0, 0.18, 0.16] });
    k.add(Ico(0.1, 1), o, { p: [0, 0.14, 0.36], s: [1.15, 0.42, 1.1] });
    k.add(Cone(0.1, 0.2, 6), y, { p: [0, 0.03, -0.38], r: [-2.0, 0, 0] });
    for (const x of [-0.3, 0.3]) k.add(Ico(0.12, 1), 0xffc21f, { p: [x, -0.07, -0.02], s: [0.35, 0.7, 1.1], r: [0, 0, x > 0 ? -0.3 : 0.3] });
    k.eye([-0.085, 0.25, 0.32], [-0.4, 0.35, 0.85], 0.065);
    k.eye([0.085, 0.25, 0.32], [0.4, 0.35, 0.85], 0.065);
  },

  tv(k) {
    k.add(B(0.8, 0.5, 0.12, 0.04), 0xff6fb5, { p: [0, -0.04, 0] });
    k.add(B(0.56, 0.38, 0.02, 0.01), INK, { p: [-0.07, -0.04, 0.058] });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.34), toonMat({ map: S.tvFace('happy'), emissive: 0xffffff, emissiveIntensity: 0.35, emissiveMap: S.tvFace('happy') }));
    screen.position.set(-0.07, -0.04, 0.07);
    screen.userData.screen = true;
    noOutline(screen);
    k.root.add(screen);
    for (const y of [0.07, -0.05]) k.add(Cyl(0.032, 0.032, 0.03, 8), W, { p: [0.3, y, 0.065], r: [PI / 2, 0, 0] });
    for (let i = 0; i < 3; i++) k.add(Box(0.1, 0.012, 0.01), 0xd94f95, { p: [0.3, -0.15 - i * 0.03, 0.062] });
    for (const s of [-1, 1]) {
      k.add(Cyl(0.008, 0.008, 0.24, 4), CHROME, { p: [0.058 * s, 0.315, 0], r: [0, 0, -0.5 * s] });
      k.add(Ico(0.024, 0), 0xffd23f, { p: [0.115 * s, 0.42, 0] });
    }
    for (const x of [-0.28, 0.28]) k.add(Box(0.1, 0.02, 0.08), INK, { p: [x, -0.3, 0] });
  },

  lamp(k) {
    k.add(Cyl(0.09, 0.11, 0.05, 8), 0x3fa9ff, { p: [0, -0.375, 0] });
    k.add(Cyl(0.015, 0.015, 0.6, 5), CHROME, { p: [0, -0.06, 0] });
    k.add(Cyl(0.07, 0.15, 0.2, 8, true), 0xffd23f, { p: [0, 0.28, 0] }, { side: THREE.DoubleSide });
    k.add(Ico(0.045, 1), 0xfff3a0, { p: [0, 0.22, 0] }, { emissive: 0xfff3a0, emissiveIntensity: 0.9 });
    k.add(Cyl(0.004, 0.004, 0.1, 3), CHROME, { p: [0.045, 0.14, 0] });
    k.add(Ico(0.014, 0), 0xff4d5e, { p: [0.045, 0.085, 0] });
  },

  giantHammer(k) {
    // Reference: images/Giant_wobbly_hammer_knocking_dweebs — stitched foam head, taped bendy handle.
    // Head axis is local Y, head sits at +Z (the swinging end), handle runs back toward the holder.
    const hz = 0.28;
    k.add(Lathe([[0, -0.36], [0.3, -0.36], [0.36, -0.3], [0.39, -0.12], [0.4, 0], [0.39, 0.12], [0.36, 0.3], [0.3, 0.36], [0, 0.36]], 14), 0xff3b3b, { p: [0, 0, hz] });
    for (const y of [-0.22, 0.22]) k.add(Tor(0.388, 0.028, 4, 18), INK, { p: [0, y, hz], r: [PI / 2, 0, 0] });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * PI * 2;
      k.add(Box(0.022, 0.1, 0.022), INK, { p: [Math.cos(a) * 0.392, -0.08, hz + Math.sin(a) * 0.392] }); // stitches
    }
    for (const y of [-0.37, 0.37]) k.add(Cyl(0.3, 0.3, 0.03, 14), 0xd92a3a, { p: [0, y, hz] });
    const a = new THREE.CatmullRomCurve3([[0, 0, -0.1], [0, -0.03, -0.3], [0.05, -0.08, -0.42]].map(p => new THREE.Vector3(...p)));
    const b = new THREE.CatmullRomCurve3([[0.05, -0.08, -0.42], [0.08, -0.14, -0.54], [0.03, -0.24, -0.64]].map(p => new THREE.Vector3(...p)));
    k.add(new THREE.TubeGeometry(a, 8, 0.06, 7), 0xffd23f);
    k.add(new THREE.TubeGeometry(b, 8, 0.06, 7), 0xff9a3c);
    for (const [curve, t] of [[a, 0.05], [a, 0.6], [b, 0.1], [b, 0.65]]) {
      k.add(Tor(0.064, 0.02, 4, 10), INK, { p: curve.getPoint(t).toArray(), q: new THREE.Quaternion().setFromUnitVectors(FWD, curve.getTangent(t)) });
    }
    k.add(Tor(0.045, 0.013, 4, 10), 0xff9a3c, { p: [0.03, -0.29, -0.66], r: [0, PI / 2, 0] });
    const smash = S.textSticker('DWEEB\nSMASH!', { bg: '#ffd23f', w: 256, h: 190, tilt: -0.05 });
    k.band(smash, 0.405, 0.3, { p: [0, 0.02, hz] }, PI / 2 - 0.62, 1.24);
    k.band(smash, 0.405, 0.3, { p: [0, 0.02, hz] }, PI * 1.5 - 0.62, 1.24);
    k.sticker(S.textSticker('POW!', { bg: '#ffd23f', w: 256, h: 256, shape: 'burst' }), 0.48, 0.48, { p: [0, -0.388, hz], r: [PI / 2, 0, 0] });
    k.sticker(S.textSticker('★', { bg: '#3fa9ff', fg: '#fff8ee', w: 128, h: 128, shape: 'circle' }), 0.3, 0.3, { p: [0, 0.388, hz], r: [-PI / 2, 0, 0] });
  },

  boxingGlove(k) {
    // Oversized cartoon mitt: fist forward (+Z), laced cuff toward the holder.
    const red = 0xff3355, dark = 0xc21b38, cream = 0xfff8ee;
    k.add(B(0.52, 0.46, 0.48, 0.16), red, { p: [0, 0, 0.12] });
    k.add(B(0.34, 0.3, 0.3, 0.12), red, { p: [0.03, -0.12, 0.28] });
    k.add(B(0.18, 0.16, 0.2, 0.07), red, { p: [-0.26, -0.05, 0.12] }); // thumb
    for (let i = 0; i < 6; i++) k.add(Box(0.02, 0.08, 0.02), dark, { p: [-0.18 + i * 0.072, 0.235, 0.12] }); // knuckle stitch
    k.add(Cyl(0.23, 0.25, 0.22, 14), cream, { p: [0, 0, -0.22], r: [PI / 2, 0, 0] });
    k.add(Tor(0.24, 0.03, 4, 16), dark, { p: [0, 0, -0.11], r: [PI / 2, 0, 0] });
    for (const z of [-0.3, -0.24, -0.18]) k.add(Box(0.3, 0.018, 0.018), dark, { p: [0, 0.24, z] }); // laces
    k.add(Cyl(0.055, 0.055, 0.16, 8), 0xffd23f, { p: [0.22, 0.05, -0.06], r: [0, 0, PI / 2] }); // bell
    k.sticker(S.textSticker('POW!', { bg: '#ffd23f', w: 256, h: 256, shape: 'burst' }), 0.34, 0.34, { p: [0, 0.02, 0.37] });
    k.sticker(S.textSticker('★', { bg: '#3fa9ff', fg: '#fff8ee', w: 128, h: 128, shape: 'circle' }), 0.2, 0.2, { p: [-0.27, 0.05, 0.05], r: [0, -PI / 2, 0] });
  },

  boomerangBass(k) {
    // A bigmouth bass bent into a boomerang: two fishy wings, a gaping mouth at the elbow.
    const blue = 0x3fa9ff, belly = 0xfff1c7;
    for (const s of [-1, 1]) {
      k.add(Box(0.42, 0.09, 0.15), blue, { p: [s * 0.19, 0, -s * 0.0 + 0.05], r: [0, s * 0.45, 0] });
      k.add(Box(0.34, 0.03, 0.08), belly, { p: [s * 0.19, -0.05, 0.05], r: [0, s * 0.45, 0] });
    }
    k.add(Tor(0.07, 0.025, 6, 10), 0xff4d6d, { p: [0, 0, -0.13], r: [0, 0, 0] });
    k.add(Box(0.08, 0.06, 0.04), INK, { p: [-0.36, 0.06, -0.06] });
    k.add(Box(0.08, 0.06, 0.04), INK, { p: [0.36, 0.06, -0.06] });
  },
  spikyBall(k) {
    // Reference: images/Spiky_blob_bouncing_off_walls — red blob, bendy tentacle spikes, big googly eyes.
    const red = 0xff4d5e;
    k.add(Ico(0.27, 1), red);
    let seed = 3;
    const rnd = () => ((seed = Math.sin(seed * 78.233 + 1.7) * 43758.5453) - Math.floor(seed));
    for (const d of fibonacci(34)) {
      if (d.z > 0.62 && Math.abs(d.y) < 0.55 && Math.abs(d.x) < 0.6) continue; // keep the face clear
      const side = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(d).normalize();
      const len = 0.16 + rnd() * 0.08;
      const curve = new THREE.CatmullRomCurve3([
        d.clone().multiplyScalar(0.22),
        d.clone().multiplyScalar(0.27 + len * 0.5).addScaledVector(side, 0.03),
        d.clone().multiplyScalar(0.27 + len).addScaledVector(side, 0.08),
      ]);
      k.add(new THREE.TubeGeometry(curve, 4, 0.028, 4), red);
      k.add(Ico(0.034, 0), 0xe03a4c, { p: curve.getPoint(1).toArray() });
    }
    k.eye([-0.1, 0.07, 0.23], [-0.38, 0.22, 0.9], 0.1);
    k.eye([0.1, 0.07, 0.23], [0.38, 0.22, 0.9], 0.1);
    k.add(Ico(0.035, 0), INK, { p: [0, -0.08, 0.262], s: [1.5, 0.7, 0.4] });
  },

  freezeRay(k) {
    const cyan = 0x8fe9ff, blue = 0x3fa9ff, dark = 0x2d2a3a;
    // Frosty blaster: chunky body, glass coolant tank, wide muzzle.
    k.add(B(0.26, 0.2, 0.34, 0.05), blue, { p: [0, 0.02, 0] });
    k.add(Cyl(0.11, 0.13, 0.5, 12), cyan, { p: [0, 0.04, 0.38], r: [PI / 2, 0, 0] });
    k.add(Tor(0.13, 0.025, 5, 16), dark, { p: [0, 0.04, 0.62] });
    k.add(Cyl(0.09, 0.09, 0.04, 12), W, { p: [0, 0.04, 0.635], r: [PI / 2, 0, 0] });
    k.add(Ico(0.11, 1), 0xd8fbff, { p: [0, 0.16, -0.02], s: [0.8, 1, 0.8] }, { transparent: true, opacity: 0.75 });
    k.add(B(0.1, 0.16, 0.12, 0.03), dark, { p: [0, -0.13, -0.08], r: [0.25, 0, 0] });
    k.add(B(0.07, 0.05, 0.16, 0.02), 0xffd23f, { p: [0, -0.13, -0.18], r: [0.25, 0, 0] });
    for (const x of [-0.09, 0.09]) k.add(Cyl(0.025, 0.025, 0.06, 6), 0xff4d5e, { p: [x, 0.14, -0.08], r: [PI / 2, 0, 0] });
    k.sticker(S.textSticker('❄', { bg: '#8fe9ff', w: 128, h: 128, shape: 'circle' }), 0.13, 0.13, { p: [0.135, 0.02, 0.06], r: [0, PI / 2, 0] });
  },

  magnet(k) {
    const red = 0xff4d5e, blue = 0x3fa9ff, metal = 0xc9d3e6;
    // Horseshoe magnet with two candy-striped poles.
    k.add(Tor(0.19, 0.06, 6, 18, PI), metal, { r: [0, 0, -PI / 2] });
    k.add(Cyl(0.07, 0.07, 0.16, 10), red, { p: [-0.19, 0.08, 0] });
    k.add(Cyl(0.07, 0.07, 0.16, 10), blue, { p: [0.19, 0.08, 0] });
    k.add(Cyl(0.075, 0.075, 0.03, 10), W, { p: [-0.19, 0.165, 0] });
    k.add(Cyl(0.075, 0.075, 0.03, 10), W, { p: [0.19, 0.165, 0] });
    for (const x of [-0.19, 0.19]) k.add(Tor(0.072, 0.015, 3, 10), 0x1b1030, { p: [x, 0.12, 0], r: [PI / 2, 0, 0] });
    k.add(B(0.12, 0.08, 0.16, 0.03), 0x1b1030, { p: [0, -0.24, 0] });
    k.add(Cyl(0.03, 0.03, 0.1, 6), 0xffd23f, { p: [0, -0.15, 0] });
    k.eye([-0.06, 0.0, 0.12], [-0.4, 0.2, 1], 0.035);
    k.eye([0.06, 0.0, 0.12], [0.4, 0.2, 1], 0.035);
  },

  leafBlower(k) {
    const orange = 0xff8a1f, dark = 0x2d2a3a, green = 0x5ee06a;
    // Chunky motor housing, a fat blower tube with a flared nozzle, a pull-cord and a big trigger.
    k.add(B(0.3, 0.26, 0.3, 0.06), orange, { p: [0, 0.02, -0.12] });
    k.add(Cyl(0.15, 0.15, 0.06, 14), dark, { p: [0.16, 0.02, -0.12], r: [0, 0, PI / 2] });
    for (let i = 0; i < 6; i++) k.add(B(0.02, 0.2, 0.03, 0.008), 0x4a4560, { p: [0.19, 0.02, -0.12], r: [i * PI / 6, 0, 0] });
    k.add(Cyl(0.075, 0.09, 0.46, 12), green, { p: [0, 0.0, 0.24], r: [PI / 2, 0, 0] });
    k.add(Cyl(0.13, 0.08, 0.12, 12), green, { p: [0, 0.0, 0.5], r: [PI / 2, 0, 0] });
    k.add(Tor(0.12, 0.022, 5, 16), dark, { p: [0, 0.0, 0.56] });
    k.add(Tor(0.1, 0.018, 5, 14), W, { p: [0, 0.0, 0.3] });
    k.add(B(0.06, 0.18, 0.06, 0.02), dark, { p: [0, 0.22, -0.12] });
    k.add(B(0.18, 0.05, 0.06, 0.02), dark, { p: [0, 0.31, -0.12] });
    k.add(B(0.05, 0.08, 0.06, 0.02), 0xff4d5e, { p: [0, 0.2, -0.02] });
    k.add(Ico(0.03, 0), 0xffd23f, { p: [-0.17, 0.08, -0.22] });
    k.eye([-0.07, 0.1, 0.035], [-0.3, 0.2, 1], 0.045);
    k.eye([0.07, 0.1, 0.035], [0.3, 0.2, 1], 0.045);
    k.sticker(S.textSticker('TURBO', { bg: '#ffd23f', w: 256, h: 96 }), 0.2, 0.075, { p: [-0.152, 0.0, -0.12], r: [0, -PI / 2, 0] });
  },
  grappleGlove(k) {
    const red = 0xff4d5e, metal = 0xc9d3e6, dark = 0x1b1030, yellow = 0xffd23f;
    // Fist-sized glove with a coiled spring launcher on the back
    k.add(B(0.44, 0.36, 0.4, 0.1), red, { p: [0, -0.02, 0.08] }); // fist
    k.add(B(0.3, 0.22, 0.28, 0.08), red, { p: [0, -0.02, -0.12] }); // forearm cuff
    k.add(Cyl(0.07, 0.07, 0.14, 8), yellow, { p: [0, 0.06, -0.18], r: [PI / 2, 0, 0] }); // spring barrel
    k.add(Tor(0.075, 0.012, 4, 12), dark, { p: [0, 0.06, -0.11], r: [PI / 2, 0, 0] });
    k.add(Tor(0.075, 0.012, 4, 12), dark, { p: [0, 0.06, -0.25], r: [PI / 2, 0, 0] });
    // Coil visual
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      k.add(Tor(0.06, 0.01, 3, 8), yellow, {
        p: [0, 0.06, -0.11 - t * 0.14],
        r: [PI / 2, 0, 0]
      });
    }
    // Trigger
    k.add(B(0.08, 0.06, 0.12, 0.02), metal, { p: [0.2, -0.08, 0.02] });
    // Hook muzzle
    k.add(Cyl(0.035, 0.035, 0.06, 8), metal, { p: [0, 0.02, 0.28], r: [PI / 2, 0, 0] });
    k.add(Cone(0.04, 0.07, 6), metal, { p: [0, 0.02, 0.31], r: [PI / 2, 0, 0] });
    // Knuckle accents
    for (const x of [-0.12, 0, 0.12]) k.add(Cyl(0.02, 0.02, 0.03, 6), dark, { p: [x, 0.13, 0.2] });
    k.eye([-0.05, 0.08, 0.2], [-0.3, 0.2, 1], 0.03);
    k.eye([0.05, 0.08, 0.2], [0.3, 0.2, 1], 0.03);
  },

  toolbox(k) {
    k.add(B(0.4, 0.2, 0.24, 0.02), 0xff4d5e, { p: [0, -0.05, 0] });
    k.add(B(0.42, 0.07, 0.26, 0.02), 0xd92a3a, { p: [0, 0.085, 0] });
    k.add(Tor(0.08, 0.016, 4, 10, PI), 0x2d2a3a, { p: [0, 0.12, 0] });
    for (const x of [-0.12, 0.12]) k.add(Box(0.04, 0.05, 0.02), CHROME, { p: [x, 0.05, 0.125] });
    k.sticker(S.textSticker('FIX-IT', { bg: '#ffd23f', w: 256, h: 110, tilt: 0.05 }), 0.24, 0.1, { p: [0, -0.06, 0.121] });
  },

  // ─── Toybox Island additions ───

  rubberChicken(k) {
    const y = 0xffe14d, o = 0xff9a3c, r = 0xff4d5e;
    k.add(Ico(0.13, 1), y, { p: [0, -0.01, -0.07], s: [0.95, 0.85, 1.5] });
    const neck = new THREE.CatmullRomCurve3([[0, 0.03, 0.08], [0, 0.1, 0.15], [0, 0.12, 0.2]].map(p => new THREE.Vector3(...p)));
    k.add(new THREE.TubeGeometry(neck, 5, 0.045, 6), y);
    k.add(Ico(0.07, 1), y, { p: [0, 0.13, 0.21] });
    k.add(Cone(0.03, 0.09, 5), o, { p: [0, 0.12, 0.3], r: [PI / 2, 0, 0] });
    for (let i = 0; i < 3; i++) k.add(Ico(0.026, 0), r, { p: [0, 0.2 + (i === 1 ? 0.012 : 0), 0.18 + i * 0.03] });
    k.add(Ico(0.022, 0), r, { p: [0, 0.075, 0.26], s: [0.7, 1.4, 0.7] }); // wattle
    for (const x of [-0.05, 0.05]) {
      k.add(Cyl(0.012, 0.012, 0.14, 4), o, { p: [x, -0.1, -0.19], r: [0.9, 0, 0] });
      for (const a of [-0.5, 0, 0.5]) k.add(Box(0.012, 0.012, 0.06), o, { p: [x + Math.sin(a) * 0.02, -0.14, -0.27], r: [0, a, 0] });
    }
    k.add(Cone(0.08, 0.12, 5), 0xfff3a0, { p: [0, 0.03, -0.28], r: [-2.1, 0, 0] }); // tail fluff
    k.eye([-0.045, 0.16, 0.245], [-0.8, 0.3, 0.6], 0.03);
    k.eye([0.045, 0.16, 0.245], [0.8, 0.3, 0.6], 0.03);
  },

  giantDie(k) {
    k.add(B(0.6, 0.6, 0.6, 0.09), 0xff4d5e);
    const faces = [ // [normal, u, v, value]
      [[0, 1, 0], [1, 0, 0], [0, 0, 1], 1], [[0, -1, 0], [1, 0, 0], [0, 0, 1], 6],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0], 2], [[0, 0, -1], [1, 0, 0], [0, 1, 0], 5],
      [[1, 0, 0], [0, 0, 1], [0, 1, 0], 3], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], 4],
    ];
    const PIPS = {
      1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    };
    for (const [n, u, v, val] of faces) {
      for (const [a, b] of PIPS[val]) {
        const p = [0, 1, 2].map(i => n[i] * 0.3 + u[i] * a * 0.15 + v[i] * b * 0.15);
        k.add(Cyl(0.058, 0.058, 0.02, 10), W, { p, n: new THREE.Vector3(...n) });
      }
    }
  },

  pinata(k) {
    const cols = [0xff6fb5, 0xffd23f, 0x3fa9ff, 0x5ee06a, 0xff9a3c];
    const band = c => cols[Math.floor((c.x + 0.4) * 22) % cols.length];
    const dx = -0.08;
    k.add(paint(new THREE.BoxGeometry(0.5, 0.26, 0.24, 11, 1, 1), band), 'vc', { p: [dx, -0.02, 0] });
    k.add(paint(new THREE.BoxGeometry(0.12, 0.26, 0.13, 1, 6, 1), c => cols[Math.floor((c.y + 0.2) * 22) % cols.length]), 'vc', { p: [dx + 0.26, 0.15, 0], r: [0, 0, -0.35] });
    k.add(B(0.24, 0.13, 0.13, 0.03), 0xff6fb5, { p: [dx + 0.38, 0.27, 0] });
    k.add(B(0.06, 0.08, 0.1, 0.02), 0xffd0e4, { p: [dx + 0.5, 0.25, 0] }); // muzzle
    for (const z of [-0.04, 0.04]) k.add(Cone(0.03, 0.12, 4), 0xffd23f, { p: [dx + 0.32, 0.38, z], r: [0, 0, 0.3] });
    for (const x of [-0.18, 0.14]) for (const z of [-0.08, 0.08]) k.add(Box(0.07, 0.22, 0.07), cols[(x > 0 ? 2 : 3)], { p: [dx + x, -0.24, z] });
    for (let i = 0; i < 4; i++) k.add(Box(0.012, 0.14, 0.012), cols[i], { p: [dx - 0.26, -0.02 - i * 0.012, -0.03 + i * 0.02], r: [0, 0, 0.5] });
    k.add(Tor(0.04, 0.008, 3, 8), W, { p: [dx, 0.15, 0] });
    k.eye([dx + 0.4, 0.31, 0.068], [0.2, 0.2, 1], 0.035);
    k.eye([dx + 0.4, 0.31, -0.068], [0.2, 0.2, -1], 0.035);
  },

  boombox(k) {
    k.add(B(0.68, 0.28, 0.2, 0.05), 0x6f7cff, { p: [0, -0.05, 0] });
    k.add(Tor(0.16, 0.022, 4, 12, PI), CHROME, { p: [0, 0.09, 0] });
    for (const x of [-0.2, 0.2]) {
      k.add(Cyl(0.105, 0.105, 0.03, 12), INK, { p: [x, -0.05, 0.095], r: [PI / 2, 0, 0] });
      k.add(Cyl(0.08, 0.05, 0.03, 12), 0x9aa3c9, { p: [x, -0.05, 0.1], r: [PI / 2, 0, 0] });
      k.add(Ico(0.03, 1), CHROME, { p: [x, -0.05, 0.115] });
    }
    k.add(B(0.14, 0.11, 0.02, 0.01), INK, { p: [0, -0.06, 0.1] });
    k.sticker(S.textSticker('MIX\nTAPE', { bg: '#ffd23f', w: 160, h: 128 }), 0.11, 0.085, { p: [0, -0.06, 0.112] });
    [0xff4d5e, 0xffd23f, 0x5ee06a, 0x3fa9ff].forEach((c, i) => k.add(B(0.05, 0.03, 0.05, 0.01), c, { p: [-0.1 + i * 0.066, 0.1, 0.03] }));
    k.add(Cyl(0.008, 0.008, 0.3, 4), CHROME, { p: [0.27, 0.19, -0.05], r: [0, 0, -0.5] });
  },

  // ─── Element props ───
  oilDrum(k) {
    k.add(Cyl(0.3, 0.3, 0.8, 14), 0x2d2a3a);
    for (const y of [-0.26, 0, 0.26]) k.add(Tor(0.302, 0.02, 4, 16), 0x4a4660, { p: [0, y, 0], r: [PI / 2, 0, 0] });
    k.add(Cyl(0.06, 0.06, 0.04, 8), CHROME, { p: [0.14, 0.41, 0.05] });
    k.sticker(S.textSticker('OIL', { bg: '#ffd23f', w: 160, h: 96 }), 0.3, 0.18, { p: [0, 0.08, 0.305] });
    k.add(Ico(0.07, 1), 0x1b140c, { p: [-0.12, 0.4, -0.08], s: [1.6, 0.25, 1.2] }); // drip on the lid
  },

  waterBalloon(k) {
    k.add(Ico(0.24, 2), 0x3fa9ff, { s: [1, 1.08, 1] }, { transparent: true, opacity: 0.85 });
    k.add(Cone(0.05, 0.07, 6), 0x2f8ae0, { p: [0, 0.27, 0], r: [PI, 0, 0] });
    k.add(Tor(0.03, 0.012, 4, 8), 0x2f8ae0, { p: [0, 0.3, 0], r: [PI / 2, 0, 0] });
    k.add(Ico(0.05, 1), 0xffffff, { p: [-0.09, 0.1, 0.17], s: [1, 1.4, 0.4] }, { transparent: true, opacity: 0.6 }); // shine
  },

  honeyJar(k) {
    k.add(Lathe([[0, -0.22], [0.16, -0.22], [0.2, -0.1], [0.2, 0.08], [0.14, 0.17], [0.15, 0.2], [0, 0.2]], 12), 0xffb02e);
    k.add(Cyl(0.16, 0.16, 0.05, 12), 0xd4a86a, { p: [0, 0.22, 0] });
    for (let i = 0; i < 3; i++) k.add(Ico(0.035, 1), 0xffb02e, { p: [Math.cos(i * 2.1) * 0.15, 0.17 - i * 0.05, Math.sin(i * 2.1) * 0.15], s: [0.8, 1.6, 0.8] }); // drips
    k.sticker(S.textSticker('HUNNY', { bg: '#f3e6cf', w: 192, h: 96 }), 0.24, 0.12, { p: [0, -0.04, 0.2] });
  },

  snowGlobe(k) {
    k.add(Cyl(0.2, 0.24, 0.12, 12), 0xb56cff, { p: [0, -0.22, 0] });
    k.add(Ico(0.24, 2), 0xcff6ff, { p: [0, 0.05, 0] }, { transparent: true, opacity: 0.35 });
    k.add(Cone(0.09, 0.2, 6), 0x2f8f3a, { p: [0, 0.0, 0] }); // tiny tree
    k.add(Ico(0.05, 1), 0xffffff, { p: [0.08, -0.08, 0.05] }); // snowman
    k.add(Ico(0.035, 1), 0xffffff, { p: [0.08, -0.01, 0.05] });
    for (let i = 0; i < 9; i++) k.add(Ico(0.012, 0), 0xffffff, { p: [Math.cos(i * 1.9) * 0.15, 0.05 + Math.sin(i * 3.1) * 0.12, Math.sin(i * 1.9) * 0.15] });
  },

  pepperBomb(k) {
    k.add(Ico(0.13, 2), 0xff3b2f, { p: [0, -0.02, 0], s: [1, 1.9, 1] });
    k.add(Cyl(0.03, 0.04, 0.1, 6), 0x2f8f3a, { p: [0, 0.27, 0], r: [0, 0, 0.4] });
    k.add(Cone(0.08, 0.05, 6), 0x2f8f3a, { p: [0, 0.22, 0], r: [PI, 0, 0] });
    k.eye([0.05, 0.05, 0.1], [0.4, 0.1, 1], 0.025);
    k.eye([-0.05, 0.05, 0.1], [-0.4, 0.1, 1], 0.025);
  },

  staticCoil(k) {
    k.add(Cyl(0.18, 0.2, 0.1, 12), 0x2d2a3a, { p: [0, -0.25, 0] });
    k.add(Cyl(0.05, 0.05, 0.4, 8), CHROME, { p: [0, 0, 0] });
    for (let i = 0; i < 5; i++) k.add(Tor(0.09, 0.015, 4, 12), 0xd98b3a, { p: [0, -0.14 + i * 0.07, 0], r: [PI / 2, 0, 0] }); // copper coil
    k.add(Ico(0.1, 1), CHROME, { p: [0, 0.25, 0] });
    k.add(Ico(0.05, 1), 0xfff35a, { p: [0, 0.25, 0] }, { transparent: true, opacity: 0.9 });
  },

  fishBowl(k) {
    k.add(Lathe([[0, -0.2], [0.12, -0.2], [0.2, -0.13], [0.24, -0.01], [0.21, 0.13], [0.14, 0.2], [0.155, 0.215], [0, 0.215]], 12),
      0xcff6ff, {}, { transparent: true, opacity: 0.4 });
    k.add(Lathe([[0, -0.19], [0.115, -0.19], [0.19, -0.12], [0.225, 0], [0.215, 0.07], [0, 0.07]], 12), 0x3fa9ff, {}, { transparent: true, opacity: 0.55 });
    for (let i = 0; i < 7; i++) k.add(Ico(0.03, 0), [0xff6fb5, 0xffd23f, 0x5ee06a][i % 3], { p: [Math.cos(i * 2.3) * 0.09, -0.17, Math.sin(i * 2.3) * 0.09] });
    k.add(Ico(0.06, 1), 0xff9a3c, { p: [0.02, -0.02, 0.02], s: [1.3, 0.9, 0.7] });
    k.add(Cone(0.045, 0.07, 4), 0xff7a1a, { p: [-0.075, -0.02, 0.02], r: [0, 0, PI / 2] });
    k.add(Tor(0.15, 0.018, 4, 14), 0x9fe8ff, { p: [0, 0.215, 0], r: [PI / 2, 0, 0] });
    k.eye([0.06, 0.0, 0.06], [0.4, 0.1, 1], 0.025);
  },

  teddyBear(k) {
    const f = 0xc98a4b, l = 0xf0c48c;
    k.add(Ico(0.19, 1), f, { p: [0, -0.12, 0], s: [1, 1.1, 0.85] });
    k.add(Ico(0.1, 1), l, { p: [0, -0.1, 0.12], s: [1, 1.1, 0.4] }); // tummy
    k.add(Ico(0.15, 1), f, { p: [0, 0.17, 0] });
    for (const x of [-0.11, 0.11]) {
      k.add(Ico(0.06, 1), f, { p: [x, 0.29, -0.01], s: [1, 1, 0.6] });
      k.add(Ico(0.035, 0), l, { p: [x, 0.29, 0.02], s: [1, 1, 0.4] });
      k.add(Ico(0.07, 1), f, { p: [x * 1.9, -0.06, 0.03], s: [0.8, 1.5, 0.8], r: [0, 0, x > 0 ? 0.6 : -0.6] });
      k.add(Ico(0.08, 1), f, { p: [x, -0.3, 0.08], s: [0.9, 0.8, 1.3] });
      k.add(Ico(0.05, 0), l, { p: [x, -0.3, 0.18], s: [1, 1, 0.3] });
    }
    k.add(Ico(0.065, 1), l, { p: [0, 0.13, 0.13], s: [1, 0.75, 0.7] });
    k.add(Ico(0.025, 0), INK, { p: [0, 0.155, 0.175], s: [1.3, 0.8, 0.8] });
    for (const x of [-0.035, 0.035]) k.add(Cone(0.03, 0.05, 4), 0xff4d5e, { p: [x, 0.04, 0.13], r: [0, 0, x > 0 ? PI / 2 : -PI / 2] }); // bow tie
    for (const r of [0.7, -0.7]) k.add(Box(0.07, 0.012, 0.01), 0xe9e2c8, { p: [-0.09, -0.18, 0.155], r: [0, 0, r] }); // stitch X
    k.eye([-0.055, 0.21, 0.12], [-0.3, 0.15, 1], 0.04);
    k.eye([0.055, 0.21, 0.12], [0.3, 0.15, 1], 0.04);
  },

  poolRing(k) {
    const pink = 0xff6fb5;
    k.add(paint(Tor(0.3, 0.1, 8, 20), c => Math.floor(((Math.atan2(c.y, c.x) + PI) / (PI * 2)) * 8) % 2 ? pink : W), 'vc', { r: [PI / 2, 0, 0] });
    const neck = new THREE.CatmullRomCurve3([[0, 0.05, 0.3], [0, 0.22, 0.4], [0, 0.34, 0.32], [0, 0.3, 0.22]].map(p => new THREE.Vector3(...p)));
    k.add(new THREE.TubeGeometry(neck, 10, 0.035, 6), pink);
    k.add(Ico(0.06, 1), pink, { p: [0, 0.32, 0.22] });
    k.add(Cone(0.03, 0.09, 5), W, { p: [0, 0.28, 0.16], r: [-2.4, 0, 0] });
    k.add(Cone(0.02, 0.035, 5), INK, { p: [0, 0.25, 0.13], r: [-2.4, 0, 0] });
    k.eye([-0.035, 0.345, 0.25], [-0.8, 0.3, 0.4], 0.025);
    k.eye([0.035, 0.345, 0.25], [0.8, 0.3, 0.4], 0.025);
    k.add(Cone(0.09, 0.12, 4), pink, { p: [0, 0.06, -0.33], r: [-1.2, 0, 0] }); // tail feathers
  },

  anvil(k) {
    const s = 0x4b4a66, t = 0x6a6a8e, dx = -0.07;
    k.add(B(0.36, 0.08, 0.28, 0.02), s, { p: [dx, -0.16, 0] });
    k.add(B(0.2, 0.14, 0.16, 0.02), s, { p: [dx, -0.06, 0] });
    k.add(B(0.42, 0.12, 0.28, 0.02), s, { p: [dx, 0.07, 0] });
    k.add(B(0.4, 0.02, 0.26, 0.008), t, { p: [dx, 0.135, 0] });
    k.add(Cone(0.08, 0.24, 6), s, { p: [dx + 0.32, 0.08, 0], r: [0, 0, -PI / 2], s: [1, 1, 0.9] });
    k.sticker(S.textSticker('10 TON', { bg: '#ffd23f', w: 256, h: 100, tilt: -0.05 }), 0.22, 0.086, { p: [dx, 0.07, 0.142] });
    k.sticker(S.textSticker('10 TON', { bg: '#ffd23f', w: 256, h: 100, tilt: -0.05 }), 0.22, 0.086, { p: [dx, 0.07, -0.142], r: [0, PI, 0] });
  },

  gumballMachine(k) {
    const r = 0xff4d5e;
    k.add(Cyl(0.15, 0.19, 0.2, 10), r, { p: [0, -0.25, 0] });
    k.add(Cyl(0.13, 0.15, 0.06, 10), 0xd92a3a, { p: [0, -0.12, 0] });
    k.add(B(0.1, 0.1, 0.04, 0.01), CHROME, { p: [0, -0.24, 0.17] });
    k.add(Cyl(0.03, 0.03, 0.03, 8), INK, { p: [0, -0.24, 0.195], r: [PI / 2, 0, 0] });
    k.add(Box(0.05, 0.03, 0.04), INK, { p: [0, -0.31, 0.17] }); // chute
    k.add(Ico(0.19, 2), 0xe8fbff, { p: [0, 0.1, 0] }, { transparent: true, opacity: 0.35 });
    const cols = [0xff4d5e, 0xffd23f, 0x3fa9ff, 0x5ee06a, 0xff6fb5, W];
    let i = 0;
    for (const d of fibonacci(26)) {
      if (d.y > 0.35) continue;
      k.add(Ico(0.045, 1), cols[i++ % cols.length], { p: [d.x * 0.12, 0.1 + d.y * 0.12, d.z * 0.12] });
    }
    k.add(Cyl(0.08, 0.1, 0.06, 10), r, { p: [0, 0.3, 0] });
    k.add(Ico(0.035, 1), 0xffd23f, { p: [0, 0.35, 0] });
    k.sticker(S.textSticker('1¢', { bg: '#fff8ee', w: 128, h: 128, shape: 'circle' }), 0.08, 0.08, { p: [0.12, -0.25, 0.12], r: [0, PI / 4, 0] });
  },

  toyRocket(k) {
    const r = 0xff4d5e;
    k.add(paint(new THREE.CylinderGeometry(0.11, 0.11, 0.46, 12, 12), c => Math.abs(c.y + 0.12) < 0.035 || c.y > 0.19 ? r : W), 'vc', { p: [0, -0.02, 0] });
    k.add(Cone(0.11, 0.2, 12), r, { p: [0, 0.31, 0] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + PI / 4;
      k.add(B(0.02, 0.18, 0.1, 0.008), r, { p: [Math.sin(a) * 0.14, -0.2, Math.cos(a) * 0.14], r: [0, a, 0] });
    }
    k.add(Cyl(0.07, 0.09, 0.08, 10), CHROME, { p: [0, -0.29, 0] });
    k.add(Tor(0.058, 0.014, 4, 12), CHROME, { p: [0, 0.1, 0.105] });
    k.eye([0, 0.1, 0.1], [0, 0, 1], 0.05);
    k.band(S.textSticker('DWEEB-1', { bg: '#3fa9ff', fg: '#fff8ee', w: 256, h: 90 }), 0.113, 0.07, { p: [0, -0.07, 0] }, PI / 2 - 0.9, 1.8);
    const flame = new THREE.Mesh(Cone(0.075, 0.26, 6), toonMat({ color: 0xffd23f, emissive: 0xff7a1a, emissiveIntensity: 1 }));
    flame.rotation.x = PI;
    flame.position.y = -0.46;
    flame.visible = false;
    flame.userData.flame = true;
    noOutline(flame);
    k.root.add(flame);
  },

  cake(k) {
    const pink = 0xffb3d9;
    k.add(Cyl(0.28, 0.28, 0.16, 16), pink, { p: [0, -0.07, 0] });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      k.add(Ico(0.04, 0), W, { p: [Math.cos(a) * 0.275, 0.0 - (i % 3) * 0.02, Math.sin(a) * 0.275], s: [1, 1.5 + (i % 2), 0.6], r: [0, -a, 0] });
    }
    k.add(Cyl(0.285, 0.285, 0.02, 16), W, { p: [0, 0.01, 0] });
    k.add(Cyl(0.17, 0.17, 0.1, 14), W, { p: [0, 0.07, 0] });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      k.add(Box(0.03, 0.01, 0.01), [0xff4d5e, 0x3fa9ff, 0xffd23f, 0x5ee06a][i % 4], { p: [Math.cos(a) * 0.23, 0.022, Math.sin(a) * 0.23], r: [0, a * 3, 0] });
    }
    [[-0.07, 0x3fa9ff], [0, 0xffd23f], [0.07, 0x5ee06a]].forEach(([x, c]) => {
      k.add(Cyl(0.012, 0.012, 0.09, 5), c, { p: [x, 0.165, 0.02] });
      const flame = new THREE.Mesh(Ico(0.018, 0), toonMat({ color: 0xffd23f, emissive: 0xff9a3c, emissiveIntensity: 1 }));
      flame.position.set(x, 0.22, 0.02);
      flame.scale.set(1, 1.5, 1);
      flame.userData.flicker = true;
      noOutline(flame);
      k.root.add(flame);
    });
    k.add(Ico(0.03, 1), 0xd9203a, { p: [0.1, 0.13, -0.08] });
  },

  piggyBank(k) {
    const p = 0xff8fc0, d = 0xf06aa6;
    k.add(Ico(0.2, 1), p, { p: [0, 0.01, -0.01], s: [0.95, 0.88, 1.3] });
    k.add(Cyl(0.07, 0.075, 0.06, 10), d, { p: [0, 0.0, 0.265], r: [PI / 2, 0, 0] });
    for (const x of [-0.025, 0.025]) k.add(Cyl(0.014, 0.014, 0.01, 6), INK, { p: [x, 0.0, 0.296], r: [PI / 2, 0, 0] });
    for (const x of [-0.1, 0.1]) {
      k.add(Cone(0.05, 0.08, 4), d, { p: [x, 0.17, 0.12], r: [0.3, 0, x > 0 ? -0.4 : 0.4] });
      for (const z of [-0.14, 0.12]) k.add(Cyl(0.04, 0.045, 0.08, 7), d, { p: [x, -0.15, z] });
    }
    k.add(B(0.1, 0.012, 0.02, 0.004), INK, { p: [0, 0.178, -0.02] });
    k.add(Cyl(0.035, 0.035, 0.01, 10), 0xffd23f, { p: [0, 0.2, -0.02], r: [PI / 2, 0, 0] }); // coin in the slot
    k.add(Tor(0.03, 0.01, 3, 8, PI * 1.5), d, { p: [0, 0.05, -0.28], r: [0, PI / 2, 0] });
    k.eye([-0.07, 0.08, 0.22], [-0.3, 0.2, 1], 0.04);
    k.eye([0.07, 0.08, 0.22], [0.3, 0.2, 1], 0.04);
  },

  jackInBox(k) {
    const wood = 0xc98a4b, dark = 0x8a5a2e, red = 0xff3355, cream = 0xfff8ee, gold = 0xffd23f;
    // Box base
    k.add(B(0.44, 0.5, 0.44, 0.03), wood);
    // Moving parts are built as their own merged sub-kits so InteractiveObject can find them
    // by name on each clone (userData refs don't survive Object3D.clone).
    // Lid (separate so it can rattle/pop)
    const lidK = new Kit();
    lidK.add(B(0.48, 0.06, 0.48, 0.02), wood, { p: [0, 0, 0] });
    lidK.add(B(0.38, 0.03, 0.38, 0.015), dark, { p: [0, 0.03, 0] });
    const lid = lidK.build();
    lid.position.y = 0.28;
    lid.name = 'jackLid';
    k.root.add(lid);
    // Crank handle on the side (spins about its own X axle)
    const crankK = new Kit();
    crankK.add(Cyl(0.018, 0.018, 0.12, 6), CHROME, { p: [0.06, 0, 0], r: [0, 0, PI / 2] });
    crankK.add(B(0.03, 0.12, 0.03, 0.01), CHROME, { p: [0.12, 0.05, 0] });
    crankK.add(Cyl(0.025, 0.025, 0.06, 6), red, { p: [0.15, 0.1, 0], r: [0, 0, PI / 2] });
    const crank = crankK.build();
    crank.position.set(0.22, 0.05, 0);
    crank.name = 'jackCrank';
    k.root.add(crank);
    // Spring-loaded boxing glove inside (hidden until pop)
    const gloveK = new Kit();
    gloveK.add(B(0.22, 0.2, 0.35, 0.08), red, { p: [0, -0.05, 0.15] });
    gloveK.add(B(0.14, 0.12, 0.18, 0.06), red, { p: [0.02, -0.13, 0.22] });
    gloveK.add(B(0.07, 0.06, 0.1, 0.04), red, { p: [-0.18, -0.08, 0.12] }); // thumb
    gloveK.add(Cyl(0.12, 0.13, 0.15, 10), cream, { p: [0, -0.18, -0.12], r: [PI / 2, 0, 0] }); // cuff
    const glove = gloveK.build();
    // Spring coil (visual, stretches on pop)
    const springK = new Kit();
    for (let i = 0; i < 6; i++) springK.add(Tor(0.09, 0.012, 6, 10), CHROME, { p: [0, -0.25 + i * 0.06, -0.22], r: [PI / 2, 0, 0] });
    const spring = springK.build();
    spring.name = 'jackSpring';
    glove.add(spring);
    glove.name = 'jackGlove';
    glove.visible = false;
    k.root.add(glove);
    // Decorative sticker
    k.sticker(S.textSticker('JACK\nIN\nTHE\nBOX', { bg: '#ff4d5e', fg: '#fff8ee', w: 256, h: 220, tilt: -0.04 }), 0.28, 0.24, { p: [0, 0.05, 0.23] });
    k.eye([-0.07, 0.18, 0.2], [-0.3, 0.2, 1], 0.045);
    k.eye([0.07, 0.18, 0.2], [0.3, 0.2, 1], 0.045);
  },
  hoverboard(k) {
    // Sleek low-profile board with glowing underside
    const deck = 0x1b1030;
    const glow = 0x3fa9ff;
    const accent = 0xffd23f;
    const chrome = 0xc9d3e6;

    // Main deck - thin rounded box
    k.add(B(1.3, 0.08, 0.44, 0.04), deck, { p: [0, 0, 0] });

    // Glowing underside strip (center channel)
    k.add(B(1.1, 0.02, 0.12, 0.01), glow, { p: [0, -0.05, 0] }, { emissive: glow, emissiveIntensity: 0.8 });

    // Side glow strips
    for (const x of [-0.35, 0.35]) {
      k.add(B(0.1, 0.03, 0.38, 0.02), glow, { p: [x, -0.04, 0] }, { emissive: glow, emissiveIntensity: 0.6 });
    }

    // Front nose light
    k.add(Cyl(0.06, 0.04, 0.02, 8), glow, { p: [0, -0.03, 0.21], r: [PI / 2, 0, 0] }, { emissive: glow, emissiveIntensity: 1 });
    k.add(B(0.12, 0.02, 0.04, 0.01), accent, { p: [0, 0.03, 0.2] });

    // Rear thrust vents
    for (const x of [-0.15, 0, 0.15]) {
      k.add(Cyl(0.03, 0.03, 0.02, 6), chrome, { p: [x, -0.04, -0.2], r: [PI / 2, 0, 0] });
    }

    // Top grip tape pattern
    k.add(B(1.2, 0.008, 0.38, 0.01), 0x0a0812, { p: [0, 0.045, 0] });
    for (const z of [-0.15, -0.05, 0.05, 0.15]) {
      k.add(B(1.0, 0.004, 0.02, 0.005), 0x2a2442, { p: [0, 0.047, z] });
    }

    // Center logo strip
    k.add(B(0.4, 0.01, 0.08, 0.01), accent, { p: [0, 0.049, 0] });
    k.add(B(0.08, 0.01, 0.3, 0.005), accent, { p: [0, 0.049, 0] });

    // Googly eyes on the nose
    k.eye([-0.08, 0.07, 0.18], [0, 0.1, 1], 0.04);
    k.eye([0.08, 0.07, 0.18], [0, 0.1, 1], 0.04);
  },
  chatteringTeeth(k) {
    const W = 0xfff8ee, gum = 0xd94a5a, tongue = 0xff7a9a, key = 0xc9d3e6;
    // Upper jaw, teeth and little skittering feet
    k.add(B(0.4, 0.1, 0.3, 0.045), gum, { p: [0, 0.05, 0] });
    for (let i = -2; i <= 2; i++) {
      k.add(B(0.062, 0.075, 0.065, 0.012), W, { p: [i * 0.074, 0, 0.145] });
    }
    for (const x of [-0.185, 0.185]) for (let i = -1; i <= 1; i++) {
      k.add(B(0.06, 0.065, 0.07, 0.012), W, { p: [x, 0, i * 0.085] });
    }
    for (const x of [-0.13, 0.13]) k.add(B(0.09, 0.045, 0.13, 0.018), W, { p: [x, -0.115, 0.01] });
    // Googly eyes make it read as a tiny angry pet
    k.eye([-0.11, 0.13, 0.1], [-0.25, 0.5, 1], 0.045);
    k.eye([0.11, 0.13, 0.1], [0.25, 0.5, 1], 0.045);
    // Wind-up key
    k.add(Cyl(0.012, 0.012, 0.07, 6), key, { p: [0, 0.14, -0.11] });
    for (const x of [-0.038, 0.038]) {
      k.add(Tor(0.038, 0.011, 3, 10), key, { p: [x, 0.185, -0.11], r: [PI / 2, 0, 0], s: [1, 1, 0.55] });
    }
    // Lower jaw is its own pivot so the runtime can snap it open and shut
    const jaw = new Kit();
    jaw.add(B(0.36, 0.08, 0.26, 0.04), gum, { p: [0, 0, 0.13] });
    for (let i = -2; i <= 2; i++) {
      jaw.add(B(0.058, 0.07, 0.06, 0.012), W, { p: [i * 0.07, 0.055, 0.265] });
    }
    for (const x of [-0.165, 0.165]) for (let i = -1; i <= 1; i++) {
      jaw.add(B(0.055, 0.06, 0.065, 0.012), W, { p: [x, 0.055, 0.13 + i * 0.075] });
    }
    jaw.add(Ico(0.08, 1), tongue, { p: [0, 0.025, 0.2], s: [1.3, 0.32, 1.5] });
    const jawModel = jaw.build();
    jawModel.name = 'jaw';
    jawModel.userData.jaw = true;
    jawModel.position.set(0, -0.06, -0.13);
    k.root.add(jawModel);
  },
  // ─── Piñata Loot Burst ───
  candy(k) {
    const wrapper = 0xfff8ee, twist = 0xff4d5e;
    k.add(Ico(0.1, 0), 0xff4d5e); // candy core
    k.add(Tor(0.12, 0.025, 6, 10), twist, { p: [0, -0.11, 0], r: [PI / 2, 0, 0] }); // bottom twist
    k.add(Tor(0.12, 0.025, 6, 10), twist, { p: [0, 0.11, 0], r: [PI / 2, 0, 0] }); // top twist
    k.add(B(0.24, 0.04, 0.24, 0.02), wrapper, { p: [0, -0.12, 0] }); // bottom wrapper
    k.add(B(0.24, 0.04, 0.24, 0.02), wrapper, { p: [0, 0.12, 0] }); // top wrapper
  },
};

// ─── Public API ───

const templates = new Map();

/** A fresh instance of an object's model (shares geometry/materials with every other instance). */
export function createModel(key, def) {
  if (!templates.has(key)) {
    const k = new Kit();
    if (BUILDERS[key]) BUILDERS[key](k);
    else k.add(B(...def.visualScale, 0.04), def.color ?? 0xcccccc);
    templates.set(key, k.build());
  }
  return templates.get(key).clone(true);
}

/** Pre-build every template (avoids a hitch the first time an item drops). */
export function warmModels(defs) {
  for (const [key, def] of Object.entries(defs)) createModel(key, def);
}

export const TV_FACES = { happy: () => S.tvFace('happy'), hurt: () => S.tvFace('hurt'), dizzy: () => S.tvFace('dizzy') };
