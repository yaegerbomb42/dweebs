// src/sim/arenaProfiles.js — mechanic profiles for every arena, as pure data.
//
// This mirrors the mechanic flags in src/game/Arenas.js (which owns the theme layer: names,
// blurbs, icons, colours). Arenas.js imports three.js via render/Toon.js, so the sim cannot
// import it in Node — the same split as src/sim/tables.js, enforced by the same kind of parity
// test (test/arena-wave3.test.js asserts the flags agree).
//
// Fields:
//   traction / slide / gravity / bumperBoost — movement & bounce multipliers (1 = stadium)
//   wind        — Sky Turbine gust scheduler runs
//   conveyors   — Pinball Factory belt zones push grounded dweebs and items
//   lava        — volcano lagoon: first dip spits you back out, second dip dunks you
//   crust       — volcano rim collapses inward on a timer (edgeRadius shrinks)
//   lightning   — Storm Spire telegraphed ground strikes
//   stickyCenter— Sinking Sands: the middle of the stage drags you down
//   magnetPulse — Magnet Core: periodic pulls toward the centre
//   floorFriction / bumpers / trampolines / jumpPads / hammers / conveyorCount /
//   spinner / crumbly / lavaRising — the kinematic hazard layout, built by SimArena.build()
//     (conveyors is the boolean the parity test checks; conveyorCount is how many belts)

const DEFAULTS = Object.freeze({
  traction: 1, slide: 1, gravity: 1, bumperBoost: 1,
  wind: false, conveyors: false, lava: false, crust: false,
  lightning: false, stickyCenter: false, magnetPulse: false,
  floorFriction: 0.7, bumpers: 0, trampolines: 0, jumpPads: 0, hammers: 0,
  conveyorCount: 0, spinner: false, crumbly: false, lavaRising: false,
});

const PROFILES = {
  meadowlands: { traction: 1.05, slide: 0.95, bumpers: 4, trampolines: 2, spinner: true },
  stadium: { bumpers: 4, trampolines: 2, spinner: true },
  iceberg:    { traction: 0.16, slide: 1.08, bumpers: 4, trampolines: 2, spinner: true },
  volcano:    { lava: true, crust: true, bumpers: 4, trampolines: 2, spinner: true },
  pinball:    { conveyors: true, conveyorCount: 2, bumperBoost: 1.28,
                bumpers: 4, trampolines: 2, spinner: true },
  moon:       { gravity: 0.58, traction: 0.92, bumperBoost: 1.12,
                bumpers: 4, trampolines: 2, spinner: true },
  gale:       { wind: true, traction: 1.04, bumpers: 4, trampolines: 2, spinner: true },
  megastadium:{ traction: 1.1, slide: 1.05, bumperBoost: 1.4,
                bumpers: 4, trampolines: 2, spinner: true },
  stormspire: { lightning: true, bumpers: 4, trampolines: 2, spinner: true },
  quicksand:  { stickyCenter: true, bumpers: 4, trampolines: 2, spinner: true },
  magnetcore: { magnetPulse: true, bumpers: 4, trampolines: 2, spinner: true },
  // Knockout Arena milestone stages (mechanic flags must match src/game/Arenas.js —
  // enforced by test/arena-wave3.test.js).
  colosseum:   { conveyors: true, conveyorCount: 2, hammers: 2, jumpPads: 2, bumpers: 4 },
  icepeak:     { traction: 0.12, slide: 1.1, floorFriction: 0.08,
                 jumpPads: 1, crumbly: true, crust: true, bumpers: 2 },
  lavafoundry: { lava: true, lavaRising: true, hammers: 1, jumpPads: 1, bumpers: 2 },
};

export const ARENA_IDS = Object.freeze(Object.keys(PROFILES));

/** Mechanic profile for an arena id; unknown ids play as the stadium. */
export function profileFor(id) {
  return { ...DEFAULTS, ...(PROFILES[id] ?? PROFILES.stadium) };
}
