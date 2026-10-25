// Toon.js — shared cel-shaded material factory for the bright toy look

import * as THREE from 'three';

let gradientMap = null;

function getGradientMap() {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 170, 235, 255]);
  gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

/** Drop-in replacement for MeshLambertMaterial params. */
export function toonMat(params = {}) {
  const { flatShading, ...rest } = params;
  return new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), ...rest });
}

/** Hide a mesh (and its children) from the OutlineEffect pass. */
export function noOutline(object) {
  object.traverse(o => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.userData.outlineParameters = { visible: false };
  });
  return object;
}

export function setOutline(object, thickness = 0.004, color = [0.08, 0.05, 0.12]) {
  object.traverse(o => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.userData.outlineParameters = { thickness, color, alpha: 1, visible: true };
  });
  return object;
}

export const PALETTE = {
  red: 0xff4d5e,
  orange: 0xff9a3c,
  yellow: 0xffd23f,
  green: 0x5ee06a,
  teal: 0x3ee6d0,
  blue: 0x3fa9ff,
  purple: 0xb56cff,
  pink: 0xff6fb5,
  white: 0xfff8ee,
  ink: 0x1b1030,
};
