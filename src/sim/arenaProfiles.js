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

const DEFAULTS = Object.freeze({
  traction: 1, slide: 1, gravity: 1, bumperBoost: 1,
  wind: false, conveyors: false, lava: false, crust: false,
  lightning: false, stickyCenter: false, magnetPulse: false,
});

const PROFILES = {
  meadowlands: { traction: 1.05, slide: 0.95 },
  stadium: {},
  iceberg:    { traction: 0.16, slide: 1.08 },
  volcano:    { lava: true, crust: true },
  pinball:    { conveyors: true, bumperBoost: 1.28 },
  moon:       { gravity: 0.58, traction: 0.92, bumperBoost: 1.12 },
  gale:       { wind: true, traction: 1.04 },
  megastadium:{ traction: 1.1, slide: 1.05, bumperBoost: 1.4 },
  stormspire: { lightning: true },
  quicksand:  { stickyCenter: true },
  magnetcore: { magnetPulse: true },
};

export const ARENA_IDS = Object.freeze(Object.keys(PROFILES));

/** Mechanic profile for an arena id; unknown ids play as the stadium. */
export function profileFor(id) {
  return { ...DEFAULTS, ...(PROFILES[id] ?? {}) };
}
