// src/sim/tables.js — data tables the sim needs, restated from the presentation modules.
//
// These mirror src/world/ObjectRegistry.js and the DROP_ITEMS / RARE tables at the top of
// src/world/Arena.js. They are duplicated rather than imported for one concrete reason: those
// modules import three.js, so importing them from a bare Node process fails the moment the bundle
// touches a document. The sim must load in Node, so it carries its own copy and leaves the
// originals alone for the view.
//
// PARITY IS ENFORCED BY test/tables-parity.test.js (T6): DROP_ITEMS weights, RARE caps/cooldowns,
// WEAPONS range/cone/cd, and ITEM_DEFS mass/explosive/blast must match OBJECT_DEFS + Arena.js.
// KEYS MUST MATCH OBJECT_DEFS. If the Lead renames an item, this file needs the same rename or a
// held item becomes an unrenderable id on the client. Physics shapes are here; the visuals are
// the Lead's and are not duplicated at all.

/** Weighted sky drops: comedy props are common, KO-power items are rare. Values are the live ones. */
export const DROP_ITEMS = [
  // common comedy / light throwables
  { key: 'beachBall', w: 8 }, { key: 'rubberChicken', w: 8 }, { key: 'watermelon', w: 7 }, { key: 'cake', w: 6 },
  { key: 'giantRubberDuck', w: 6 }, { key: 'trafficCone', w: 6 }, { key: 'box', w: 6 }, { key: 'poolRing', w: 5 },
  { key: 'teddyBear', w: 5 }, { key: 'pinata', w: 5 }, { key: 'piggyBank', w: 4 }, { key: 'gumballMachine', w: 4 },
  { key: 'fishBowl', w: 4 }, { key: 'boombox', w: 4 }, { key: 'lamp', w: 4 }, { key: 'giantDie', w: 4 },
  // mid: solid throwables and furniture
  { key: 'crate', w: 5 }, { key: 'tire', w: 4 }, { key: 'tv', w: 3 }, { key: 'ladder', w: 3 }, { key: 'mattress', w: 3 },
  { key: 'shoppingCart', w: 3 }, { key: 'couch', w: 2 }, { key: 'bowlingBall', w: 3 }, { key: 'spikyBall', w: 3 },
  // rare: the KO makers
  { key: 'giantHammer', w: 1.5 }, { key: 'toyRocket', w: 1.5 }, { key: 'explosiveBarrel', w: 1.5 }, { key: 'anvil', w: 1 },
  // gadget weapons: uncommon
  { key: 'freezeRay', w: 2 }, { key: 'magnet', w: 2 },
  // fast hands
  { key: 'boxingGlove', w: 3 },
];

/** Rare items: at most `max` live at once, and at least `cd` seconds between drops of the key. */
export const RARE = {
  giantHammer: { max: 1, cd: 45 },
  anvil: { max: 1, cd: 45 },
  toyRocket: { max: 1, cd: 30 },
  explosiveBarrel: { max: 2, cd: 25 },
};

/** Melee weapon identity, mirroring CombatSystem.WEAPONS: range, cone half-angle, cooldown. */
export const WEAPONS = {
  giantHammer: { name: 'hammer', range: 2.5, cone: 0.1, cd: 0.5 },
  anvil: { name: 'anvil', range: 1.45, cone: 0.45, cd: 0.8 },
  spikyBall: { name: 'spiky', range: 2.1, cone: -0.25, cd: 0.38 },
  boxingGlove: { name: 'glove', range: 1.8, cone: 0.5, cd: 0.19 },
};

/**
 * Collision shape, game-mass and damage weight per item key. Mass is game-mass, never a density:
 * the live PhysicsWorld learned that lesson — items are sized by setMass, not by box width.
 */
export const ITEM_DEFS = {
  beachBall: { shape: 'ball', r: 0.42, mass: 0.8, heft: 0.1 },
  rubberChicken: { shape: 'box', hx: 0.3, hy: 0.34, hz: 0.3, mass: 1.2, heft: 0.15 },
  watermelon: { shape: 'ball', r: 0.4, mass: 2.2, heft: 0.3 },
  cake: { shape: 'cylinder', r: 0.4, hy: 0.22, mass: 1.4, heft: 0.18 },
  giantRubberDuck: { shape: 'ball', r: 0.55, mass: 2.4, heft: 0.32 },
  trafficCone: { shape: 'cone', r: 0.26, hy: 0.34, mass: 0.7, heft: 0.1 },
  box: { shape: 'box', hx: 0.38, hy: 0.38, hz: 0.38, mass: 1.6, heft: 0.2 },
  poolRing: { shape: 'cylinder', r: 0.5, hy: 0.16, mass: 0.9, heft: 0.12 },
  teddyBear: { shape: 'ball', r: 0.36, mass: 1.1, heft: 0.14 },
  pinata: { shape: 'box', hx: 0.34, hy: 0.46, hz: 0.34, mass: 2.0, heft: 0.26 },
  piggyBank: { shape: 'box', hx: 0.3, hy: 0.28, hz: 0.22, mass: 1.8, heft: 0.22 },
  gumballMachine: { shape: 'cylinder', r: 0.36, hy: 0.42, mass: 2.6, heft: 0.34 },
  fishBowl: { shape: 'sphere', r: 0.36, mass: 1.5, heft: 0.2 },
  boombox: { shape: 'box', hx: 0.36, hy: 0.24, hz: 0.18, mass: 1.7, heft: 0.21 },
  lamp: { shape: 'cylinder', r: 0.3, hy: 0.3, mass: 1.4, heft: 0.18 },
  giantDie: { shape: 'box', hx: 0.34, hy: 0.34, hz: 0.34, mass: 2.2, heft: 0.28 },
  crate: { shape: 'box', hx: 0.42, hy: 0.42, hz: 0.42, mass: 3.0, heft: 0.35 },
  tire: { shape: 'cylinder', r: 0.42, hy: 0.2, mass: 2.4, heft: 0.3 },
  tv: { shape: 'box', hx: 0.4, hy: 0.28, hz: 0.14, mass: 2.6, heft: 0.32 },
  ladder: { shape: 'box', hx: 0.22, hy: 0.9, hz: 0.1, mass: 2.8, heft: 0.34 },
  mattress: { shape: 'box', hx: 0.7, hy: 0.16, hz: 0.5, mass: 2.8, heft: 0.34 },
  shoppingCart: { shape: 'box', hx: 0.36, hy: 0.5, hz: 0.3, mass: 3.0, heft: 0.36 },
  couch: { shape: 'box', hx: 0.7, hy: 0.4, hz: 0.4, mass: 3.4, heft: 0.4 },
  bowlingBall: { shape: 'ball', r: 0.36, mass: 3.6, heft: 0.45 },
  boxingGlove: { shape: 'box', hx: 0.26, hy: 0.24, hz: 0.26, mass: 1.7, heft: 0.22, weapon: true },
  spikyBall: { shape: 'ball', r: 0.38, mass: 2.6, heft: 0.5, weapon: true },
  giantHammer: { shape: 'box', hx: 0.5, hy: 0.5, hz: 0.22, mass: 5.0, heft: 0.8, weapon: true },
  toyRocket: { shape: 'cylinder', r: 0.26, hy: 0.44, mass: 3.2, heft: 0.7, explosive: true, blast: 5 },
  explosiveBarrel: { shape: 'cylinder', r: 0.42, hy: 0.5, mass: 4.0, heft: 0.75, explosive: true, blast: 6 },
  anvil: { shape: 'box', hx: 0.36, hy: 0.24, hz: 0.2, mass: 5.5, heft: 0.9, weapon: true },
  freezeRay: { shape: 'cylinder', r: 0.26, hy: 0.5, mass: 2.0, heft: 0.3 },
  magnet: { shape: 'box', hx: 0.32, hy: 0.26, hz: 0.36, mass: 2.4, heft: 0.36 },
};

/** Fallback for an unknown key, so a stale id simulates as a light crate rather than as NaN. */
export const DEFAULT_ITEM_DEF = { shape: 'box', hx: 0.3, hy: 0.3, hz: 0.3, mass: 1.5, heft: 0.2 };

/** Stable ItemKindId per key, assigned in DROP_ITEMS order. This is the number that goes on the
 *  wire; the key stays in the tables for readability. Computed at module load, so it is
 *  identical on client and server. */
export const ITEM_KIND_IDS = Object.freeze(
  DROP_ITEMS.reduce((m, it, i) => { m[it.key] = i; return m; }, Object.create(null)),
);

export const itemKindId = key => (ITEM_KIND_IDS[key] ?? 0);
export const itemDef = key => ITEM_DEFS[key] || DEFAULT_ITEM_DEF;

/** Power-ups. The sim tracks the timers; the view owns the icons. */
export const POWERUPS = {
  mega: { label: 'MEGA', time: 12, speedMul: 0.9, power: 1.35 },
  zoom: { label: 'ZOOM', time: 8, speedMul: 1.5 },
  bubble: { label: 'BUBBLE', time: 10, invuln: true },
  freeze: { label: 'DEEP FREEZE', time: 8, freeze: true },
  magnet: { label: 'MAGNET', time: 8, pull: true },
  sugar: { label: 'SUGAR RUSH', time: 9, speedMul: 1.45 },
  shield: { label: 'SHIELD', time: 0, invuln: false },
};

export const POWERUP_KEYS = Object.freeze(Object.keys(POWERUPS));
