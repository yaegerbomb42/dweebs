// ObjectRegistry.js — Data-driven definitions for all interactive objects
// Each object defines its physical properties, visual geometry, and behavior

import { getMaterial } from '../physics/Materials.js';

/**
 * Object definition schema:
 * {
 *   name: string,
 *   shape: 'box' | 'sphere' | 'cylinder' | 'capsule',
 *   dims: { hx, hy, hz } | { radius } | { halfHeight, radius },
 *   visualScale: [x, y, z],    // scale for the visual mesh
 *   material: string,          // material name from Materials.js
 *   mass: number,              // game-mass (a Dweeb weighs 3): sets throw speed, spin and hit weight
 *   grabbable: boolean,
 *   throwable: boolean,
 *   breakable: boolean,
 *   breakForce: number,        // hit points: impacts deal speed² × mass × 12, punches 1000–4000
 *   damage: number,            // damage multiplier on impact
 *   color: hex,                // override color
 *   meshType: 'box' | 'sphere' | 'cylinder' | 'custom',
 * }
 */

export const OBJECT_DEFS = {
  melonCannon: {
    name: 'Melon Blaster',
    shape: 'cylinder', dims: { halfHeight: 0.45, radius: 0.22 },
    visualScale: [0.5, 0.9, 0.5],
    material: 'plastic', mass: 2.2, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 2.8, color: 0x3fa9ff,
    weapon: 'hammer',
    isShooter: true,
  },
  explodingMelon: {
    name: 'Juicy Melon',
    shape: 'sphere', dims: { radius: 0.32 },
    visualScale: [0.65, 0.65, 0.65],
    material: 'rubber', mass: 1.4, grabbable: true, throwable: true,
    breakable: true, breakForce: 1200, damage: 3.5, color: 0x5ee06a,
    explosive: true, explosionRadius: 4.5,
  },
  powerBattery: {
    name: 'Power Cell',
    shape: 'cylinder', dims: { halfHeight: 0.45, radius: 0.35 },
    visualScale: [0.7, 0.9, 0.7],
    material: 'metal', mass: 3.8, grabbable: true, throwable: true,
    breakable: false, breakForce: 99999, damage: 1.8, color: 0x5ee06a,
    meshType: 'cylinder',
  },
  chair: {
    name: 'Chair',
    shape: 'box', dims: { hx: 0.35, hy: 0.5, hz: 0.35 },
    visualScale: [0.7, 1.0, 0.7],
    material: 'wood', mass: 1.6, grabbable: true, throwable: true,
    breakable: true, breakForce: 2500, damage: 1.2, color: 0xb8864e,
  },
  table: {
    name: 'Table',
    shape: 'box', dims: { hx: 0.7, hy: 0.35, hz: 0.45 },
    visualScale: [1.4, 0.7, 0.9],
    material: 'wood', mass: 3.5, grabbable: true, throwable: true,
    breakable: true, breakForce: 4000, damage: 1.5, color: 0xa0724e,
  },
  crate: {
    name: 'Crate',
    shape: 'box', dims: { hx: 0.35, hy: 0.35, hz: 0.35 },
    visualScale: [0.7, 0.7, 0.7],
    material: 'wood', mass: 2, grabbable: true, throwable: true,
    breakable: true, breakForce: 2000, damage: 1.0, color: 0xc4a06a,
  },
  barrel: {
    name: 'Barrel',
    shape: 'cylinder', dims: { halfHeight: 0.45, radius: 0.3 },
    visualScale: [0.6, 0.9, 0.6],
    material: 'metal', mass: 3.5, grabbable: true, throwable: true,
    breakable: false, breakForce: 8000, damage: 1.8, color: 0x667788,
  },
  explosiveBarrel: {
    name: 'Explosive Barrel',
    shape: 'cylinder', dims: { halfHeight: 0.45, radius: 0.3 },
    visualScale: [0.6, 0.9, 0.6],
    material: 'metal', mass: 3, grabbable: true, throwable: true,
    breakable: true, breakForce: 1500, damage: 3.0, color: 0xdd3333,
    explosive: true, explosionForce: 20, explosionRadius: 6,
  },
  brick: {
    name: 'Brick',
    shape: 'box', dims: { hx: 0.15, hy: 0.1, hz: 0.08 },
    visualScale: [0.3, 0.2, 0.16],
    material: 'stone', mass: 1, grabbable: true, throwable: true,
    breakable: false, breakForce: 5000, damage: 1.3, color: 0xaa5533,
  },
  cinderBlock: {
    name: 'Cinder Block',
    shape: 'box', dims: { hx: 0.2, hy: 0.15, hz: 0.15 },
    visualScale: [0.4, 0.3, 0.3],
    material: 'stone', mass: 2.5, grabbable: true, throwable: true,
    breakable: true, breakForce: 3500, damage: 1.6, color: 0x888888,
  },
  plank: {
    name: 'Plank',
    shape: 'box', dims: { hx: 0.6, hy: 0.04, hz: 0.12 },
    visualScale: [1.2, 0.08, 0.24],
    material: 'wood', mass: 0.9, grabbable: true, throwable: true,
    breakable: true, breakForce: 1500, damage: 0.8, color: 0xd4a86a,
  },
  tire: {
    name: 'Tire',
    shape: 'cylinder', dims: { halfHeight: 0.12, radius: 0.35 },
    visualScale: [0.7, 0.24, 0.7],
    material: 'rubber', mass: 1.8, grabbable: true, throwable: true,
    breakable: false, breakForce: 10000, damage: 0.7, color: 0x333333,
  },
  trafficCone: {
    name: 'Traffic Cone',
    shape: 'cylinder', dims: { halfHeight: 0.3, radius: 0.15 },
    visualScale: [0.3, 0.6, 0.3],
    material: 'plastic', mass: 0.5, grabbable: true, throwable: true,
    breakable: false, breakForce: 2000, damage: 0.3, color: 0xff6600,
  },
  bucket: {
    name: 'Bucket',
    shape: 'cylinder', dims: { halfHeight: 0.2, radius: 0.18 },
    visualScale: [0.36, 0.4, 0.36],
    material: 'plastic', mass: 0.4, grabbable: true, throwable: true,
    breakable: false, breakForce: 1500, damage: 0.3, color: 0x4488cc,
  },
  shoppingCart: {
    name: 'Shopping Cart',
    shape: 'box', dims: { hx: 0.35, hy: 0.45, hz: 0.5 },
    visualScale: [0.7, 0.9, 1.0],
    material: 'metal', mass: 3, grabbable: true, throwable: true,
    breakable: false, breakForce: 5000, damage: 1.4, color: 0xaaaaaa,
  },
  trashCan: {
    name: 'Trash Can',
    shape: 'cylinder', dims: { halfHeight: 0.35, radius: 0.22 },
    visualScale: [0.44, 0.7, 0.44],
    material: 'metal', mass: 1.5, grabbable: true, throwable: true,
    breakable: false, breakForce: 3000, damage: 0.8, color: 0x556655,
  },
  rock: {
    name: 'Rock',
    shape: 'sphere', dims: { radius: 0.2 },
    visualScale: [0.4, 0.35, 0.4],
    material: 'stone', mass: 2, grabbable: true, throwable: true,
    breakable: false, breakForce: 8000, damage: 1.5, color: 0x777777,
  },
  watermelon: {
    name: 'Watermelon',
    shape: 'sphere', dims: { radius: 0.2 },
    visualScale: [0.4, 0.35, 0.4],
    material: 'fruit', mass: 1.4, grabbable: true, throwable: true,
    breakable: true, breakForce: 600, damage: 0.6, color: 0x337733,
  },
  beachBall: {
    name: 'Beach Ball',
    shape: 'sphere', dims: { radius: 0.3 },
    visualScale: [0.6, 0.6, 0.6],
    material: 'rubber', mass: 0.15, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 0.05, color: 0xff4488,
  },
  bowlingBall: {
    name: 'Bowling Ball',
    shape: 'sphere', dims: { radius: 0.15 },
    visualScale: [0.3, 0.3, 0.3],
    material: 'stone', mass: 2.2, grabbable: true, throwable: true,
    breakable: false, breakForce: 20000, damage: 2.0, color: 0x222244,
    roll: true, multiHit: true,   // thrown low: rolls through a crowd, re-arming after each bounce
  },
  sign: {
    name: 'Sign',
    shape: 'box', dims: { hx: 0.4, hy: 0.3, hz: 0.04 },
    visualScale: [0.8, 0.6, 0.08],
    material: 'wood', mass: 1, grabbable: true, throwable: true,
    breakable: true, breakForce: 1200, damage: 0.6, color: 0xeecc44,
  },
  ladder: {
    name: 'Ladder',
    shape: 'box', dims: { hx: 0.25, hy: 0.9, hz: 0.08 },
    visualScale: [0.5, 1.8, 0.16],
    material: 'metal', mass: 2, grabbable: true, throwable: true,
    breakable: false, breakForce: 6000, damage: 1.3, color: 0x999999,
  },
  couch: {
    name: 'Couch',
    shape: 'box', dims: { hx: 0.8, hy: 0.35, hz: 0.4 },
    visualScale: [1.6, 0.7, 0.8],
    material: 'fabric', mass: 5, grabbable: true, throwable: true,
    breakable: false, breakForce: 5000, damage: 0.8, color: 0x5566aa,
  },
  mattress: {
    name: 'Mattress',
    shape: 'box', dims: { hx: 0.6, hy: 0.12, hz: 0.9 },
    visualScale: [1.2, 0.24, 1.8],
    material: 'fabric', mass: 3, grabbable: true, throwable: true,
    breakable: false, breakForce: 10000, damage: 0.2, color: 0xddddd0,
  },
  flowerPot: {
    name: 'Flower Pot',
    shape: 'cylinder', dims: { halfHeight: 0.15, radius: 0.12 },
    visualScale: [0.24, 0.3, 0.24],
    material: 'ceramic', mass: 0.8, grabbable: true, throwable: true,
    breakable: true, breakForce: 400, damage: 0.7, color: 0xcc6644,
  },
  box: {
    name: 'Box',
    shape: 'box', dims: { hx: 0.25, hy: 0.25, hz: 0.25 },
    visualScale: [0.5, 0.5, 0.5],
    material: 'cardboard', mass: 0.5, grabbable: true, throwable: true,
    breakable: true, breakForce: 300, damage: 0.2, color: 0xc4a060,
  },
  bottle: {
    name: 'Bottle',
    shape: 'cylinder', dims: { halfHeight: 0.15, radius: 0.04 },
    visualScale: [0.08, 0.3, 0.08],
    material: 'glass', mass: 0.25, grabbable: true, throwable: true,
    breakable: true, breakForce: 200, damage: 0.5, color: 0x88ccaa,
  },
  giantRubberDuck: {
    name: 'Giant Rubber Duck',
    shape: 'sphere', dims: { radius: 0.4 },
    visualScale: [0.8, 0.8, 0.8],
    material: 'rubber', mass: 0.4, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 0.1, color: 0xffdd00,
  },
  tv: {
    name: 'Television',
    shape: 'box', dims: { hx: 0.4, hy: 0.3, hz: 0.06 },
    visualScale: [0.8, 0.6, 0.12],
    material: 'plastic', mass: 2, grabbable: true, throwable: true,
    breakable: true, breakForce: 800, damage: 1.0, color: 0x222222,
  },
  lamp: {
    name: 'Lamp',
    shape: 'cylinder', dims: { halfHeight: 0.4, radius: 0.06 },
    visualScale: [0.12, 0.8, 0.12],
    material: 'metal', mass: 0.8, grabbable: true, throwable: true,
    breakable: true, breakForce: 600, damage: 0.6, color: 0xddcc88,
  },
  giantHammer: {
    name: 'Dweeb Smash Hammer',
    shape: 'box', dims: { hx: 0.45, hy: 0.4, hz: 0.65 },
    visualScale: [0.9, 0.8, 1.3],
    material: 'rubber', mass: 3, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 3.5, color: 0xee2222,
    weapon: 'hammer',
  },
  boxingGlove: {
    name: 'Giant Boxing Glove',
    shape: 'box', dims: { hx: 0.26, hy: 0.24, hz: 0.26 },
    visualScale: [0.52, 0.48, 0.52],
    material: 'rubber', mass: 1.7, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 2.0, color: 0xff2f4f,
    weapon: 'glove',
  },
  freezeRay: {
    name: 'Freeze Ray',
    shape: 'cylinder', dims: { halfHeight: 0.32, radius: 0.16 },
    visualScale: [0.32, 0.64, 0.32],
    material: 'metal', mass: 1.4, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 0.6, color: 0x8fe9ff,
    gadget: 'freezeRay',
  },
  magnet: {
    name: 'Mega Magnet',
    shape: 'box', dims: { hx: 0.24, hy: 0.2, hz: 0.3 },
    visualScale: [0.48, 0.4, 0.6],
    material: 'metal', mass: 1.8, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 0.8, color: 0xff9a3c,
    gadget: 'magnet',
  },
  spikyBall: {
    name: 'Spiky Bouncy Blob',
    shape: 'sphere', dims: { radius: 0.35 },
    visualScale: [0.7, 0.7, 0.7],
    material: 'rubber', mass: 1.2, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 2.0, color: 0xee4444,
    weapon: 'spiky', multiHit: true,   // wide swipes; thrown it pinballs and can hit again after bouncing
  },
  toolbox: {
    name: 'Toolbox',
    shape: 'box', dims: { hx: 0.2, hy: 0.15, hz: 0.12 },
    visualScale: [0.4, 0.3, 0.24],
    material: 'metal', mass: 1.8, grabbable: true, throwable: true,
    breakable: false, breakForce: 5000, damage: 1.2, color: 0xcc2222,
  },

  // ─── Toybox Island additions ───
  // Optional extras: breakWord (comic popup), breakColors (particle + debris palette),
  // splat (ground decal colour on break), rocket (flies under thrust when thrown).
  rubberChicken: {
    name: 'Rubber Chicken',
    shape: 'box', dims: { hx: 0.14, hy: 0.16, hz: 0.3 },
    visualScale: [0.28, 0.32, 0.6],
    material: 'rubber', mass: 0.6, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 0.8, color: 0xffe14d,
  },
  giantDie: {
    name: 'Giant Die',
    shape: 'box', dims: { hx: 0.3, hy: 0.3, hz: 0.3 },
    visualScale: [0.6, 0.6, 0.6],
    material: 'plastic', mass: 1.2, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 1.0, color: 0xff4d5e,
  },
  // ─── Element props (game/StatusEffects.js): break them to spill a zone, or hit people with them ───
  oilDrum: {
    name: 'Oil Drum',
    shape: 'cylinder', dims: { halfHeight: 0.4, radius: 0.3 },
    visualScale: [0.6, 0.8, 0.6],
    material: 'metal', mass: 2.6, grabbable: true, throwable: true,
    breakable: true, breakForce: 2600, damage: 1.6, color: 0x2d2a3a,
    breakWord: 'GLUG!', breakColors: [0x2a2018, 0x2d2a3a, 0xffd23f], status: 'oil', statusOnHit: 'oily',
  },
  waterBalloon: {
    name: 'Water Balloon',
    shape: 'sphere', dims: { radius: 0.24 },
    visualScale: [0.48, 0.52, 0.48],
    material: 'rubber', mass: 0.7, grabbable: true, throwable: true,
    breakable: true, breakForce: 250, damage: 0.4, color: 0x3fa9ff,
    breakWord: 'SPLOOSH!', splat: 0x3fa9ff, breakColors: [0x3fa9ff, 0x8fe9ff, 0xffffff], status: 'water', statusOnHit: 'wet',
  },
  honeyJar: {
    name: 'Honey Pot',
    shape: 'cylinder', dims: { halfHeight: 0.22, radius: 0.2 },
    visualScale: [0.4, 0.44, 0.4],
    material: 'ceramic', mass: 1.2, grabbable: true, throwable: true,
    breakable: true, breakForce: 600, damage: 0.8, color: 0xffb02e,
    breakWord: 'SPLORCH!', breakColors: [0xffb02e, 0xffd23f, 0xf3e6cf], status: 'honey', statusOnHit: 'sticky',
  },
  snowGlobe: {
    name: 'Snow Globe',
    shape: 'sphere', dims: { radius: 0.26 },
    visualScale: [0.52, 0.6, 0.52],
    material: 'glass', mass: 1.3, grabbable: true, throwable: true,
    breakable: true, breakForce: 500, damage: 0.9, color: 0xbff4ff,
    breakWord: 'BRRR!', breakColors: [0xffffff, 0xbff4ff, 0x8fe9ff], status: 'frost', statusOnHit: 'chill',
  },
  pepperBomb: {
    name: 'Ghost Pepper',
    shape: 'capsule', dims: { halfHeight: 0.14, radius: 0.13 },
    visualScale: [0.3, 0.5, 0.3],
    material: 'fruit', mass: 0.6, grabbable: true, throwable: true,
    breakable: true, breakForce: 350, damage: 0.6, color: 0xff3b2f,
    breakWord: 'SPICY!', breakColors: [0xff3b2f, 0xff9a3c, 0x2f8f3a], status: 'pepper', statusOnHit: 'burn',
  },
  staticCoil: {
    name: 'Tesla Toy',
    shape: 'cylinder', dims: { halfHeight: 0.3, radius: 0.18 },
    visualScale: [0.36, 0.6, 0.36],
    material: 'metal', mass: 1.5, grabbable: true, throwable: true,
    breakable: true, breakForce: 3000, damage: 1.0, color: 0x6f7cff,
    breakWord: 'KZZZT!', breakColors: [0xfff35a, 0x6f7cff, 0xc9d3e6], status: 'spark', statusOnHit: 'static',
  },
  pinata: {
    name: 'Piñata',
    shape: 'box', dims: { hx: 0.34, hy: 0.3, hz: 0.14 },
    visualScale: [0.8, 0.7, 0.28],
    material: 'cardboard', mass: 0.8, grabbable: true, throwable: true,
    breakable: true, breakForce: 700, damage: 0.7, color: 0xff6fb5,
    breakWord: 'CANDY!', breakColors: [0xff4d5e, 0xffd23f, 0x3fa9ff, 0x5ee06a, 0xb56cff, 0xff9a3c],
  },
  boombox: {
    name: 'Boombox',
    shape: 'box', dims: { hx: 0.34, hy: 0.19, hz: 0.11 },
    visualScale: [0.68, 0.38, 0.22],
    material: 'plastic', mass: 1.6, grabbable: true, throwable: true,
    breakable: true, breakForce: 1500, damage: 1.1, color: 0x6f7cff,
    breakWord: 'BZZRT!', breakColors: [0x6f7cff, 0x2d2a3a, 0xffd23f],
  },
  fishBowl: {
    name: 'Fish Bowl',
    shape: 'sphere', dims: { radius: 0.24 },
    visualScale: [0.48, 0.44, 0.48],
    material: 'glass', mass: 1.3, grabbable: true, throwable: true,
    breakable: true, breakForce: 500, damage: 0.9, color: 0x8fe3ff,
    breakWord: 'SPLOOSH!', splat: 0x3fa9ff, breakColors: [0xbff4ff, 0xffffff, 0xff9a3c],
  },
  teddyBear: {
    name: 'Teddy Bear',
    shape: 'capsule', dims: { halfHeight: 0.14, radius: 0.22 },
    visualScale: [0.5, 0.74, 0.4],
    material: 'fabric', mass: 0.7, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 0.4, color: 0xc98a4b,
  },
  poolRing: {
    name: 'Flamingo Pool Ring',
    shape: 'cylinder', dims: { halfHeight: 0.1, radius: 0.42 },
    visualScale: [0.84, 0.2, 0.84],
    material: 'rubber', mass: 0.5, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 0.3, color: 0xff6fb5,
  },
  anvil: {
    name: 'Cartoon Anvil',
    shape: 'box', dims: { hx: 0.3, hy: 0.2, hz: 0.15 },
    visualScale: [0.6, 0.4, 0.3],
    material: 'metal', mass: 6, grabbable: true, throwable: true,
    breakable: false, breakForce: 50000, damage: 3.2, color: 0x4b4a66,
    weapon: 'anvil',   // point-blank, enormous
  },
  gumballMachine: {
    name: 'Gumball Machine',
    shape: 'cylinder', dims: { halfHeight: 0.35, radius: 0.2 },
    visualScale: [0.4, 0.7, 0.4],
    material: 'glass', mass: 1.8, grabbable: true, throwable: true,
    breakable: true, breakForce: 900, damage: 1.1, color: 0xff4d5e,
    breakWord: 'GUMBALLS!', breakColors: [0xff4d5e, 0xffd23f, 0x3fa9ff, 0x5ee06a, 0xff6fb5, 0xffffff],
  },
  toyRocket: {
    name: 'Toy Rocket',
    shape: 'capsule', dims: { halfHeight: 0.28, radius: 0.13 },
    visualScale: [0.26, 0.84, 0.26],
    material: 'plastic', mass: 1.5, grabbable: true, throwable: true,
    breakable: true, breakForce: 1000, damage: 2.5, color: 0xfff8ee,
    explosive: true, explosionForce: 16, explosionRadius: 5, rocket: true,
  },
  cake: {
    name: 'Party Cake',
    shape: 'cylinder', dims: { halfHeight: 0.15, radius: 0.28 },
    visualScale: [0.56, 0.3, 0.56],
    material: 'fruit', mass: 1.2, grabbable: true, throwable: true,
    breakable: true, breakForce: 500, damage: 0.6, color: 0xffb3d9,
    breakWord: 'SPLAT!', splat: 0xffb3d9, breakColors: [0xffb3d9, 0xfff8ee, 0x8a4a2e, 0xff4d5e],
  },
  piggyBank: {
    name: 'Piggy Bank',
    shape: 'box', dims: { hx: 0.2, hy: 0.19, hz: 0.28 },
    visualScale: [0.4, 0.38, 0.56],
    material: 'ceramic', mass: 1.4, grabbable: true, throwable: true,
    breakable: true, breakForce: 900, damage: 1.0, color: 0xff8fc0,
    breakWord: 'CHA-CHING!', breakColors: [0xffd23f, 0xffc21f, 0xff8fc0],
  },
};

/** Get a random set of objects for arena spawning */
export function getArenaObjects() {
  return Object.keys(OBJECT_DEFS);
}

/** Get object def by key */
export function getObjectDef(key) {
  return OBJECT_DEFS[key];
}

/**
 * STRUCTURE_CATALOG — the handcrafted toy-set architecture of New Dweebtopia.
 * These are set pieces, not throwable props: each one is built by ToyBuildings.js and owns its
 * colliders, moving mechanisms and a destructible/repairable state.
 */
export const STRUCTURE_CATALOG = [
  {
    id: 'windmill',
    name: 'Windmill of Whirls',
    icon: '🌬️',
    cost: { wood: 8, stone: 3 },
    desc: 'A multi-level mill whose cloth sails scoop Dweebs into the sky.',
    footprint: 9,
    verb: 'ride',
  },
  {
    id: 'watchtower',
    name: 'Lookout Watchtower',
    icon: '🗼',
    cost: { wood: 9, stone: 2 },
    desc: 'Stilt tower, climbable ladder, crow’s nest and a physics zipline down.',
    footprint: 8,
    verb: 'climb',
  },
  {
    id: 'gazebo',
    name: 'Bouncy Gazebo',
    icon: '🎪',
    cost: { wood: 5, berries: 2 },
    desc: 'A striped canopy with a high-velocity trampoline roof and plush-ball button.',
    footprint: 8,
    verb: 'bounce',
  },
  {
    id: 'clockwork',
    name: 'Toy Clockwork Tower',
    icon: '⚙️',
    cost: { wood: 7, stone: 4 },
    desc: 'Exposed cogs, rotating clock-hand stepping stones and a counterweight lift.',
    footprint: 8,
    verb: 'tinker',
  },
  {
    id: 'waterwheel',
    name: 'Waterwheel Conveyor Chute',
    icon: '💧',
    cost: { wood: 8, stone: 3 },
    desc: 'A curved banking chute that spills into a soft pool, driven by a waterwheel.',
    footprint: 11,
    verb: 'slide',
  },
  {
    id: 'fort',
    name: 'Breakable Toy Fort',
    icon: '🏰',
    cost: { wood: 12, stone: 6 },
    desc: 'Stacked block ramparts that shatter under charged smashes and get rebuilt by workers.',
    footprint: 11,
    verb: 'smash',
  },
];

export function getStructureDef(id) {
  return STRUCTURE_CATALOG.find(s => s.id === id) || null;
}

/** A balanced set of pre-placed landmarks for the Meadowlands adventure map. */
export const TOY_TOWN_LAYOUT = [
  { id: 'windmill', x: -17, z: 13.5, rotationY: 0.55 },
  { id: 'watchtower', x: 27.5, z: 5, rotationY: -0.72 },
  { id: 'gazebo', x: 10, z: 10.5, rotationY: 0.22 },
  { id: 'clockwork', x: -11.5, z: -9, rotationY: -0.35 },
  { id: 'waterwheel', x: 12.5, z: 18.5, rotationY: 0.95 },
  { id: 'fort', x: 17.5, z: -13.5, rotationY: 0.3 },
];
