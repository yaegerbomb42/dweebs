// Materials.js — physical + acoustic properties per material.
// friction / restitution drive Rapier; `sound` drives the modal impact synth in AudioManager:
//   modes: resonant partials [ratio, decay s, gain], base: fundamental Hz (scaled down by mass),
//   noise: [lowHz, highHz, gain, decay s] click/body noise layer, bounce: adds a comic pitch-bend.

export const MATERIALS = {
  wood: {
    name: 'wood', friction: 0.65, restitution: 0.3, density: 500, breakable: true,
    color: 0xc4956a,
    sound: { base: 420, modes: [[1, 0.09, 1], [2.3, 0.05, 0.5], [3.9, 0.03, 0.25]], noise: [300, 2500, 0.5, 0.05] },
  },
  metal: {
    name: 'metal', friction: 0.35, restitution: 0.25, density: 2500, breakable: false,
    color: 0x888899,
    sound: { base: 520, modes: [[1, 0.9, 0.7], [2.76, 0.6, 0.5], [5.4, 0.35, 0.35], [8.93, 0.2, 0.2]], noise: [2000, 9000, 0.25, 0.02] },
  },
  plastic: {
    name: 'plastic', friction: 0.45, restitution: 0.45, density: 300, breakable: false,
    color: 0xe05050,
    sound: { base: 700, modes: [[1, 0.06, 0.8], [2.1, 0.04, 0.4]], noise: [800, 4000, 0.45, 0.03] },
  },
  rubber: {
    name: 'rubber', friction: 0.9, restitution: 0.82, density: 400, breakable: false,
    color: 0x3a3a3a,
    sound: { base: 180, modes: [[1, 0.14, 1], [1.5, 0.08, 0.3]], noise: [100, 600, 0.3, 0.04], bounce: 1 },
  },
  stone: {
    name: 'stone', friction: 0.75, restitution: 0.12, density: 2400, breakable: false,
    color: 0x999999,
    sound: { base: 260, modes: [[1, 0.07, 0.6], [2.7, 0.04, 0.3]], noise: [120, 1500, 0.8, 0.09] },
  },
  glass: {
    name: 'glass', friction: 0.3, restitution: 0.2, density: 1500, breakable: true,
    color: 0xaaddff,
    sound: { base: 1900, modes: [[1, 0.35, 0.6], [2.32, 0.25, 0.45], [4.25, 0.15, 0.3]], noise: [4000, 12000, 0.3, 0.02] },
  },
  cardboard: {
    name: 'cardboard', friction: 0.7, restitution: 0.12, density: 150, breakable: true,
    color: 0xb8956a,
    sound: { base: 160, modes: [[1, 0.05, 0.5]], noise: [200, 1800, 0.6, 0.07] },
  },
  fruit: {
    name: 'fruit', friction: 0.6, restitution: 0.35, density: 600, breakable: true,
    color: 0x55aa44,
    sound: { base: 140, modes: [[1, 0.08, 0.6]], noise: [150, 2500, 0.7, 0.12], splat: 1 },
  },
  ceramic: {
    name: 'ceramic', friction: 0.5, restitution: 0.15, density: 1800, breakable: true,
    color: 0xddccbb,
    sound: { base: 1100, modes: [[1, 0.2, 0.7], [2.6, 0.12, 0.4]], noise: [2000, 8000, 0.3, 0.03] },
  },
  fabric: {
    name: 'fabric', friction: 0.85, restitution: 0.08, density: 200, breakable: false,
    color: 0x6677aa,
    sound: { base: 90, modes: [[1, 0.06, 0.4]], noise: [80, 700, 0.7, 0.1] },
  },
  toy: { // stage surfaces and dweebs: a soft padded thump
    name: 'toy', friction: 0.9, restitution: 0.1, density: 400, breakable: false,
    color: 0xffffff,
    sound: { base: 150, modes: [[1, 0.07, 0.8], [2.2, 0.04, 0.3]], noise: [100, 1200, 0.5, 0.05] },
  },
};

export function getMaterial(name) {
  return MATERIALS[name] || MATERIALS.plastic;
}
