// src/sim/warfareUnits.js — Dweeb Warfare unit roster: stats, costs and the counter triangle.
//
// Pure data. The battle sim (warfareBattle.js), the AI (warfareAI.js) and the HUD all read from
// here, so a balance change is one edit. Tests in test/warfare-balance.test.js run real duels
// through the sim to prove every unit has a counter and none dominates.
//
// The counter cycle (attacker → victim it beats, cost for cost):
//   SHIELD  ▶ ROCKET   plastic shields shrug off rocket splash and walk up to the gunners
//   ROCKET  ▶ STEALER  stealers sprint across open ground straight into the shells
//   STEALER ▶ KAMI     a grabbed kami cannot detonate; stealers haul it home and convert it
//   KAMI    ▶ SHIELD   shaped charges ignore plastic and shred slow phalanx clumps

export const TEAMS = Object.freeze(['blue', 'red']);
export const otherTeam = t => (t === 'blue' ? 'red' : 'blue');

/** Units a commander can buy. Order = hotkeys 1..7. */
export const RECRUITABLE = Object.freeze(['shield', 'rocket', 'stealer', 'kami', 'medic', 'netter', 'sapper']);

/** Enemy-only specials that show up in later waves. */
export const SPECIALS = Object.freeze(['sneak', 'brute', 'boss']);

/**
 * attack kinds:
 *   melee  — hit the target in reach
 *   rocket — lob an arcing shell with splash; keeps a minimum range
 *   grab   — tackle; grabbable targets are carried home and converted, others take tackle damage
 *   blast  — run in and detonate (unit dies)
 *   slam   — melee that also splashes everyone around the attacker
 */
export const UNIT_TYPES = Object.freeze({
  shield: {
    name: 'Shield', blurb: 'Plastic-disc tank. Too bulky to steal. Blocks rocket splash for nearby allies.',
    hp: 190, speed: 3.6, radius: 0.6, mass: 3,
    attack: 'melee', range: 1.0, dmg: 22, cooldown: 30,
    cost: 30, retreatAt: 0.15, flanker: false, grabbable: false, aggro: 14,
  },
  rocket: {
    name: 'Rocket', blurb: 'Brass-tube artillery. Splash wrecks fast light units.',
    hp: 70, speed: 3.4, radius: 0.55, mass: 1.5,
    attack: 'rocket', range: 19, minRange: 5, dmg: 42, splash: 3.4, cooldown: 75,
    cost: 40, retreatAt: 0.35, flanker: false, grabbable: true, aggro: 22,
  },
  stealer: {
    name: 'Stealer', blurb: 'Bandana sprinter. Kidnaps enemies and converts them at your fort.',
    hp: 90, speed: 6.3, radius: 0.5, mass: 1.2,
    attack: 'grab', range: 2.0, dmg: 10, cooldown: 24, carrySpeed: 4.6,
    cost: 35, retreatAt: 0.35, flanker: true, grabbable: true, aggro: 20,
  },
  kami: {
    name: 'Kami', blurb: 'Cartoon TNT runner. Detonates on contact. Wrecks shield walls.',
    hp: 55, speed: 6.6, radius: 0.5, mass: 1,
    attack: 'blast', range: 1.4, dmg: 80, splash: 3.6, cooldown: 0,
    cost: 25, retreatAt: 0, flanker: false, grabbable: true, aggro: 18,
  },
  sapper: {
    name: 'Sapper', blurb: 'Tunnel-rat with a cone drill. Burrows under barricades to pop up behind the enemy back line.',
    hp: 100, speed: 4.8, radius: 0.5, mass: 1.2,
    attack: 'melee', range: 1.0, dmg: 22, cooldown: 22,
    cost: 30, retreatAt: 0.2, flanker: true, grabbable: true, aggro: 24, tunnels: true,
  },
  netter: {
    name: 'Netter', blurb: 'Carries a rolled net hoop. Pins enemies under a cartoon net — zero damage, total lockdown.',
    hp: 80, speed: 4.2, radius: 0.55, mass: 1.5,
    attack: 'net', range: 6.5, dmg: 4, cooldown: 95,
    cost: 30, retreatAt: 0.35, flanker: false, grabbable: true, aggro: 16,
  },
  sneak: {
    name: 'Sneak', blurb: 'Masked flanker. Circles the front line to knife your rockets.',
    hp: 65, speed: 5.8, radius: 0.45, mass: 1,
    attack: 'melee', range: 0.9, dmg: 14, cooldown: 18,
    cost: 30, retreatAt: 0.4, flanker: true, grabbable: true, aggro: 22,
  },
  brute: {
    name: 'Brute', blurb: 'Dowel-club bruiser. Too heavy to steal. Swings knock lines apart.',
    hp: 420, speed: 2.7, radius: 0.95, mass: 7,
    attack: 'slam', range: 1.2, dmg: 30, splash: 2.4, cooldown: 42,
    cost: 80, retreatAt: 0, flanker: false, grabbable: false, aggro: 14,
  },
  boss: {
    name: 'Brass Bully', blurb: 'Clockwork boss with a gear crown. Ground slams shake the board.',
    hp: 1200, speed: 2.1, radius: 1.6, mass: 30,
    attack: 'slam', range: 1.6, dmg: 55, splash: 4.2, cooldown: 54,
    cost: 400, retreatAt: 0, flanker: false, grabbable: false, aggro: 16,
  },
  // Commander power only, never purchasable: a giant balloon Dweeb that soaks enemy attention
  // until its fuse runs out or someone pops it.
  decoy: {
    name: 'Inflatable Decoy', blurb: 'Giant balloon Dweeb. Draws fire, then pops.',
    hp: 220, speed: 0, radius: 1.2, mass: 0.5,
    attack: 'none', range: 0, dmg: 0, cooldown: 1,
    cost: 0, retreatAt: 0, flanker: false, grabbable: false, aggro: 0,
  },
  medic: {
    name: 'Patch', blurb: 'Combat medic. Pulses a healing wave to the most wounded ally in range.',
    hp: 110, speed: 4.0, radius: 0.5, mass: 1.4,
    attack: 'heal', range: 4.5, heal: 14, cooldown: 36, dmg: 6,
    cost: 35, retreatAt: 0.3, grabbable: true, aggro: 18,
  },
});

/** Damage multiplier attacker → defender. Missing entries are 1. */
export const COUNTERS = Object.freeze({
  shield: { rocket: 1.6, kami: 0.7, netter: 1.5 },
  rocket: { shield: 0.4, stealer: 1.6, sneak: 1.5, kami: 1.3, brute: 0.8, medic: 1.4, netter: 1.4, sapper: 0.5 },
  stealer: { kami: 2.5, rocket: 1.1, shield: 0.6, medic: 1.8, netter: 0.6 },
  kami: { shield: 2.0, brute: 1.6, boss: 1.8, stealer: 0.7, medic: 0.5, netter: 0.5 },
  sneak: { rocket: 1.8, shield: 0.5, medic: 1.7 },
  brute: { shield: 1.3 },
  boss: {},
  medic: { kami: 0.6, brute: 0.7 },
  netter: { stealer: 1.6, kami: 1.6, rocket: 0.5, shield: 0.6 },
  sapper: { rocket: 2.2, stealer: 1.5, shield: 0.5 },
});

export function counterMult(att, def) {
  const row = COUNTERS[att];
  return (row && row[def]) || 1;
}

/** Bounty in coins for destroying a unit of this type. */
export const bounty = type => Math.round(UNIT_TYPES[type].cost * BOUNTY_RATE);
export const BOUNTY_RATE = 0.6;

/** Which recruitable unit beats `type` (for HUD hints and the AI commander). */
export const COUNTER_OF = Object.freeze({
  rocket: 'shield', stealer: 'rocket', kami: 'stealer', shield: 'kami',
  sneak: 'shield', brute: 'kami', boss: 'kami', medic: 'stealer', netter: 'rocket', sapper: 'shield',
});

export function stats(type) {
  const s = UNIT_TYPES[type];
  if (!s) throw new Error(`unknown warfare unit: ${type}`);
  return s;
}
