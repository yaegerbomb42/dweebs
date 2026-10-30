// Battlegrounds.js — Dweeb Warfare campaign maps. Pure data (no three.js), so the battle sim,
// the board renderer and the unit tests all read the same definitions.
//
// Each battleground:
//   barricades: circles units slide around. {x, z, r} is solid dowel; {x, z, r, hp} is a
//               destructible bundle — artillery and big blasts chew through `hp`, and when it
//               breaks it stops blocking (the board hides the mesh, the sim drops the circle).
//   highGround: rects of raised plastic. Units standing on one deal HIGH_GROUND_MULT damage.
//   bridges / gullies: painted cracks in the play-mat with plank bridges over them — visual
//               landmarks that shape where armies meet. Choke points come from barricade walls
//               with narrow gaps; the sim's collision does the rest.

/** The stock meadow layout, byte-for-byte the classic barricade ring (keeps old battles identical). */
const MEADOW_BARRICADES = [
  { x: -2, z: -13, r: 1.5 }, { x: 2, z: -4.5, r: 1.5 },
  { x: -2, z: 4.5, r: 1.5 }, { x: 2, z: 13, r: 1.5 },
];

export const BATTLEGROUNDS = Object.freeze([
  Object.freeze({
    id: 'meadow',
    name: 'Dowel Meadow',
    blurb: 'The classic open field. Four dowel bundles dot no-man\u2019s land.',
    barricades: Object.freeze(MEADOW_BARRICADES.map(b => Object.freeze({ ...b }))),
    highGround: Object.freeze([]),
    bridges: Object.freeze([]),
    gullies: Object.freeze([]),
  }),
  Object.freeze({
    id: 'narrows',
    name: 'The Narrows',
    blurb: 'Two choke gaps through a dowel wall. One is plugged by a breakable bundle.',
    barricades: Object.freeze([
      // a ragged wall across midfield with gaps at z=-6 and z=8
      { x: 0, z: -18, r: 1.5 }, { x: 0, z: -12, r: 1.5 },
      { x: 0, z: 0, r: 1.5 }, { x: 0, z: 2.5, r: 1.5, hp: 220 },
      { x: 0, z: 14, r: 1.5 }, { x: 0, z: 19, r: 1.5 },
    ].map(b => Object.freeze({ ...b }))),
    highGround: Object.freeze([
      { x: -24, z: -14, w: 14, h: 8, label: 'west ridge' },
      { x: 24, z: 14, w: 14, h: 8, label: 'east ridge' },
    ].map(b => Object.freeze({ ...b }))),
    bridges: Object.freeze([]),
    gullies: Object.freeze([]),
  }),
  Object.freeze({
    id: 'highlands',
    name: 'Brass Highlands',
    blurb: 'Raised plateaus by each fort and one at mid. Hold the high plastic.',
    barricades: Object.freeze([
      { x: -10, z: -10, r: 1.5 }, { x: 10, z: 10, r: 1.5 },
      { x: -10, z: 10, r: 1.5 }, { x: 10, z: -10, r: 1.5 },
    ].map(b => Object.freeze({ ...b }))),
    highGround: Object.freeze([
      { x: -26, z: 0, w: 12, h: 16, label: 'blue plateau' },
      { x: 26, z: 0, w: 12, h: 16, label: 'red plateau' },
      { x: 0, z: 0, w: 10, h: 10, label: 'crown hill' },
    ].map(b => Object.freeze({ ...b }))),
    bridges: Object.freeze([
      { x: 0, z: -13, rot: 0, len: 7, label: 'north bridge' },
    ].map(b => Object.freeze({ ...b }))),
    gullies: Object.freeze([
      { x: 0, z: -13, w: 7, h: 3, rot: 0 },
    ].map(b => Object.freeze({ ...b }))),
  }),
  Object.freeze({
    id: 'crossroads',
    name: 'Crossroads',
    blurb: 'Four breakable bundles guard the center. Bridges cross the gullies north and south.',
    barricades: Object.freeze([
      { x: -3, z: -3, r: 1.5, hp: 160 }, { x: 3, z: -3, r: 1.5, hp: 160 },
      { x: -3, z: 3, r: 1.5, hp: 160 }, { x: 3, z: 3, r: 1.5, hp: 160 },
      { x: -16, z: 0, r: 1.5 }, { x: 16, z: 0, r: 1.5 },
    ].map(b => Object.freeze({ ...b }))),
    highGround: Object.freeze([]),
    bridges: Object.freeze([
      { x: -8, z: -16, rot: 0, len: 7, label: 'north-west bridge' },
      { x: 8, z: 16, rot: 0, len: 7, label: 'south-east bridge' },
    ].map(b => Object.freeze({ ...b }))),
    gullies: Object.freeze([
      { x: -8, z: -16, w: 7, h: 3, rot: 0 },
      { x: 8, z: 16, w: 7, h: 3, rot: 0 },
    ].map(b => Object.freeze({ ...b }))),
  }),
  Object.freeze({
    id: 'siegeworks',
    name: 'Siegeworks',
    blurb: 'Layered breakable works in front of each fort. Crack them, then the fort.',
    barricades: Object.freeze([
      { x: -28, z: -6, r: 1.5, hp: 200 }, { x: -28, z: 6, r: 1.5, hp: 200 },
      { x: -24, z: 0, r: 1.5, hp: 200 },
      { x: 28, z: -6, r: 1.5, hp: 200 }, { x: 28, z: 6, r: 1.5, hp: 200 },
      { x: 24, z: 0, r: 1.5, hp: 200 },
      { x: 0, z: -8, r: 1.5 }, { x: 0, z: 8, r: 1.5 },
    ].map(b => Object.freeze({ ...b }))),
    highGround: Object.freeze([
      { x: -14, z: -17, w: 10, h: 6, label: 'north-west knoll' },
      { x: 14, z: 17, w: 10, h: 6, label: 'south-east knoll' },
    ].map(b => Object.freeze({ ...b }))),
    bridges: Object.freeze([]),
    gullies: Object.freeze([]),
  }),
]);

export const BATTLEGROUND_IDS = Object.freeze(BATTLEGROUNDS.map(b => b.id));

/** Look up a battleground by id; unknown ids fall back to the meadow (never throws). */
export function getBattleground(id) {
  return BATTLEGROUNDS.find(b => b.id === id) || BATTLEGROUNDS[0];
}
