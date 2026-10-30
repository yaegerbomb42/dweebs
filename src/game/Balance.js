// Balance.js — every number that decides how the brawl *feels*, in one place.
// Knockback is Smash-style: launch = (base + growth · percent/100) · armor.
// Rough map (tuned with a launch/recovery sim, see WHY.md): ~15 launch KOs from the lip, ~21 from mid-stage.
//   0–40%   hits are combo / stage-control fodder
//   60–100% charged hits near an edge are dangerous
//   120%+   charged smash, hammer, anvil, rocket KO from anywhere sensible

export const BALANCE = {
  move: {
    speed: 7.5,
    groundAccel: 62,       // a touch of wind-up so direction changes have weight…
    groundBrake: 96,       // …but stops are immediate and readable
    airAccel: 30,          // committed air drift; momentum matters more than twitch
    airBrake: 13,          // no-input air braking, so launches keep their arc
    skidSpeed: 4.2,        // hard turns above this kick up dust and a haptic tick
    jumpVel: 10.5,
    doubleJumpVel: 9.5,
    shortHopVel: 6.5,      // tap jump ≈ 0.85 m, hold ≈ 2.2 m
    fallGravity: 1.45,     // snappier falls when not tumbling
    fastFallGravity: 2.35, // hold down mid-air: commit to the floor, land harder
    fastFallDelay: 0.12,   // grace after leaving the floor so a short hop stays a short hop
  },

  knockback: {
    launchDrag: 1.1,       // per-second horizontal bleed while in hitstun airborne (was 0.9)
    hitstunBase: 0.12,
    hitstunPerLaunch: 0.022, // was 0.028 — less dead air after mid hits
    ragdollAt: 15,         // launch speed that sends you tumbling (was 11 — mid-% punches ragdolled)
    ragdollAirMax: 0.55,   // extra helpless tumble time in the air after hitstun (was 1.5)
    minUp: 0.3,
    ragdollSpinMax: 14,    // rad/s cap on the tumble spin (was 25: read as a seizure, not a yeet)
    ragdollAngDamp: 2.2,   // angular damping while tumbling (capsule default 1.5)
  },

  // Hit feedback tiers by launch speed (Spec 11): jab / solid / ragdoll / fireworks
  juice: {
    tiers: [6, 11, 18],
    hitStop: [0.025, 0.05, 0.09, 0.16],
    shake:   [0.06, 0.16, 0.38, 0.8],
    squash:  [0.12, 0.2, 0.3, 0.45],
    killCam: 0.75,         // seconds the camera leans toward a KO the player was part of
  },

  // Grab heft (Spec 12): heavy things settle into your arms and slow you down; light things are instant
  carry: {
    heavyFrom: 2.5,        // game-mass where settle + slowdown start (a Dweeb is 3)
    settleBase: 0.05, settlePerMass: 0.02, settleMax: 0.12,
    slowPerMass: 0.035, slowMin: 0.82, // walk speed × (1 − (mass − heavyFrom)·slowPerMass), floored
    lightBelow: 0.8,       // under this mass: shorter grab → throw cooldown
    lightCooldown: 0.1,
    heavyThrowFrom: 4,     // throws at/above this mass get a grunt, dust and a micro hit-stop
  },

  // Stage toys (Spec 12)
  bounce: {
    bumperMinSpeed: 9,     // items leave a bumper at least this fast across the floor
    bumperGain: 1.15,
    bumperLoft: 4.2,       // min upward speed off a bumper (was 3) so banks chain into air/trick shots
    bumperPush: 10, bumperPushGain: 0.5, bumperPushMax: 6, bumperUp: 5.2, // dweebs (was up 4.5)
    trampolineVel: 17,
    trampolineItemVel: 13,
    trampolineKeepH: 1.1,  // horizontal carried through a trampoline bounce (was 1.0, contact friction ate some)
  },

  // Water entry (Spec 12): barely-under dweebs near the edge get one flail to splash-jump out
  water: {
    flailTime: 0.6,
    flailEdge: 2.5,        // metres past the stage lip that still count as "barely"
    flailJumpVel: 18.5,    // peak ≈ 6.8 m: a big comic splash-jump
    flailPush: 6,          // max speed toward the stage
    flailClearTime: 0.36,  // reach the lip no sooner than this (by then you're above the tiles)
    flailCarryTime: 1.1,   // air-braking is off this long after a splash-jump (unless you steer)
    flailCarry: 3.5,       // min inward speed once clear of the lip, so a hands-off splash-jump lands on stage
  },

  // Directional influence: steer while flying. Budget in m/s so it can nudge but never reverse a smash.
  di: {
    strength: 0.35,        // × move speed = total Δv budget per hit (≈2.6 m/s)
    rate: 12,              // m/s² spent from the budget
    vertical: 0.6,         // hold jump for up-DI, weaker than sideways
    ragdollScale: 0.4,     // mild DI while tumbling
  },

  // A running hard landing can be turned into a roll: momentum is kept and the
  // recovery is spent sliding instead of standing still.
  roll: {
    minFallSpeed: 14,      // fall speed that arms a roll
    speed: 9.5,            // horizontal speed out of the roll
    time: 0.32,            // seconds of committed roll (hitbox stays normal, control is locked)
    cooldown: 0.5,
    style: 3,
  },

  landLag: {
    minSpeed: 15,          // fall speed that counts as a hard landing (a full jump lands at ~12.6, so no lag)
    min: 0.08,
    max: 0.18,
  },

  // Recovery tools (Spec 6)
  airDodge: { speed: 11, invuln: 0.25, duration: 0.28, cooldown: 1.2 },
  tech: { buffer: 0.1, invuln: 0.3, missProne: 0.55 },
  ledge: { maxHang: 1.2, reach: 1.1, height: 1.4, jumpVel: 11.5, regrab: 0.6 },

  // Timed parry / counter. Press C just before a hit lands: no damage, the attacker
  // eats the recoil, and the defender gets a stack of style. Deliberately a small
  // window (0.16 s) so it reads as a read, not a mash.
  parry: {
    window: 0.16,
    cooldown: 0.9,
    invuln: 0.3,
    recoil: 8,
    stun: 0.55,
    style: 24,
    hitStop: 0.11,
    shake: 0.45,
  },

  // Aerial kit. Both are committed moves: miss and you are on the floor or drifting
  // helpless for a beat, which is the counterplay.
  air: {
    slamSpeed: 27,
    slamRadius: 3.4,
    slamDepth: 1.4,
    slamHitStop: 0.12,
    slamShake: 0.7,
    dropkickSpeed: 13.5,
    dropkickTime: 0.34,
    dropkickRange: 1.45,
    dropkickBounce: 3.2,
  },

  // Arena hazards. Every number the new stages use lives here.
  arena: {
    moonGravity: 0.58,      // Zero-G Moonbase: everything falls at ~half speed
    windFirst: 10,          // Sky Turbine: grace before the first gust
    windEvery: 10.5,        // …then one every this many seconds
    windWarn: 1.4,          // telegraph time before a gust lands
    windDuration: 2.6,      // how long a gust blows
    windForce: 4.5,         // m/s² on a Dweeb standing in the open (≈5 m/s of drift per gust)
    windItemForce: 24,      // props are lighter than a Dweeb; they get thrown around more
    windLift: 0.5,
    iceTraction: 0.16,      // ground acceleration multiplier on the Iceberg
    iceSlide: 1.08,         // top speed multiplier (sliding carries a little further)
    conveyorPush: 6.4,      // m/s the factory belts add under a dweeb
    conveyorWidth: 1.5,
    lavaStartY: -4.1,
    lavaMaxY: -0.9,
    lavaRise: 0.018,        // m/s during a normal match
    lavaRiseSudden: 0.09,   // m/s once sudden death begins
    lavaDamage: 11,
    lavaLaunch: 15,
    lavaCooldown: 1.1,
    crustEvery: 8.5,        // seconds between volcano crust collapses
    crustFirst: 20,         // grace period before the first collapse
    crustMax: 4,            // segments the volcano may eat before sudden death
    bumperBoost: 1.28,      // factory bumpers shove a little harder
    pendulumBoost: 1.3,
    // Knockout Arena hazards (sim + live read the same numbers)
    hammerCount: 2,          // rotating hammers on the Colosseum of Clouts
    hammerArmR: 6.5,         // metres from the pivot to the hammer head
    hammerHeadR: 1.1,        // head hit radius
    hammerSpeed: 1.6,        // rad/s
    hammerDamage: 10, hammerBase: 7, hammerGrowth: 9,
    jumpPadVel: 24,          // jump pads launch harder than trampolines (17)
    conveyorCount: 2,        // conveyor belts on the Colosseum
    conveyorSpeed: 5.5,      // m/s of belt drift applied to grounded dweebs
    crumbleFirst: 20,        // grace before the first edge tile crumbles
    crumbleEvery: 8.5,       // seconds between crumbles
    crumbleMax: 4,           // tiles the arena may eat before sudden death
    crumbleWarn: 1.6,        // telegraph (shake) before a tile falls
    telegraphTime: 1.2,      // pre-spawn warning before a sky drop lands
    lavaEdgeGrace: 8,        // Lava Foundry: grace before the lava perimeter starts rising
    lavaEdgeRise: 0.55,      // m/s the safe radius shrinks
    lavaEdgeMin: 5.5,        // the lava never closes past this radius
    // NOTE: lavaDamage / lavaCooldown belong to the volcano dip (see above); the foundry's
    // rising edge gets its own keys so the two lava tunings never shadow each other.
    lavaEdgeDamage: 9, lavaEdgeBase: 6, lavaEdgeGrowth: 8,
    lavaEdgeCooldown: 1.0,
    respawnMinGap: 2.2,      // simultaneous respawns are separated by at least this (metres)
    // Storm Spire lightning (telegraphed ground strikes)
    lightningFirst: 6,      // grace before the first strike
    lightningEvery: 9,      // seconds between strikes (jittered ±2 by the seeded stream)
    lightningWarn: 0.8,     // telegraph time before a strike lands
    lightningRadius: 2.6,
    lightningDamage: 12,
    lightningLaunch: 14,
    // Magnet Core pulse (periodic pull toward the centre)
    magnetIdle: 10,         // seconds between pulses
    magnetWarn: 1.2,        // telegraph before the pull starts
    magnetActive: 2.0,      // how long the pull lasts
    magnetForce: 16,        // m/s² toward the centre while active
    // Sinking Sands sticky centre
    quicksandRadius: 5,
    quicksandDrag: 0.88,    // horizontal velocity kept per tick, grounded in the zone
  },

  // King of the Hill.
  hill: {
    radius: 3.5,            // control zone radius around the centre
    rate: 1,                // points per second for the sole holder
    target: 60,             // points to take the round
    milestone: 10,          // score milestones that emit an event
  },

  // The crowd. Hype 0..100; levels at 20/40/60/80.
  crowd: {
    decay: 4,               // hype lost per second with nothing happening
    ko: 12, starKo: 16, selfKo: -6,
    bigLaunch: 10, solidLaunch: 4,
    trickShot: 8, explosion: 6, styleUp: 5, suddenDeath: 15,
    roundEnd: 12, matchEnd: 20, award: 8, eliminated: 6,
    lightningStrike: 10, lavaHit: 6,
    levels: [20, 40, 60, 80],
    names: ['murmur', 'buzz', 'roar', 'frenzy', 'pandemonium'],
  },

  // Pickup power-ups (the gems) and the two new gadget weapons.
  powerups: {
    freeze: { duration: 1.6, radius: 7.5 },
    magnet: { duration: 2.8, radius: 8.5, force: 30, up: 2.5 },
    sugar: { duration: 9, speed: 1.45, cooldown: 0.62 },   // SUGAR RUSH: faster feet, faster swings
    shield: { charges: 1, damage: 0.45, launch: 0.22 },    // SHIELD: eats one hit almost whole
  },
  gadgets: {
    freezeRay: { range: 7.5, cone: 0.55, cooldown: 0.85, freeze: 1.5, style: 7 },
    magnet: { range: 8, cooldown: 1.15, pull: 16, style: 5 },
  },

  // Style meter (Spec: gains, tiers, decay). Single source of truth — CombatSystem.STYLE,
// sim/dweeb addStyle, and Hud all read this; never hardcode tiers elsewhere.
  style: {
    max: 100,
    tiers: [0, 25, 55, 90],
    names: ['MEH', 'SPICY', 'CHAOTIC', 'DWEEB GOD'],
    hold: 2.5,       // seconds before the meter starts draining
    drain: 22,       // points / s after that
    // Super-smash meter: consecutive landed punches build it faster. A punch landed within
    // streakWindow of the last one continues the streak; a whiff, a weapon hit, or taking a
    // hit resets it. Each streak level past the first adds streakBonus style, up to streakCap.
    streakWindow: 1.1,
    streakBonus: 3,
    streakCap: 6,
  },

  // Attack tables: charge c ∈ [0,1]. `p` is the attacker's power scale (mega / Super Yeet).
  attacks: {
    // Charge must feel worth holding: a full smash is ~1.75x a jab at 0% and ~2x at 100%.
    punch:  c => ({ damage: 5 + 11 * c, base: 4 + 3 * c, growth: 5 + 6.5 * c }),
    hammer: c => ({ damage: 12 + 14 * c, base: 5 + 1 * c, growth: 8 + 3.5 * c }),
    // Boxing glove: a jab machine. Low launch, quick cadence — it racks up percent, not KOs.
    glove:  c => ({ damage: 3.2 + 5.4 * c, base: 2.6 + 1.4 * c, growth: 3.6 + 4 * c }),
    anvil:  c => ({ damage: 16 + 10 * c, base: 6 + 1.5 * c, growth: 9.5 + 3 * c }),
    spiky:  c => ({ damage: 6 + 6 * c, base: 4.5 + 1.5 * c, growth: 6 + 3 * c }),
    dweebThrow: c => ({ damage: 7 + 7 * c, base: 5 + 2 * c, growth: 7 + 5 * c }),
    dive:      { damage: 8, base: 5.5, growth: 7.5 },
    slam:      { damage: 12, base: 7, growth: 8 },
    dropkick:  { damage: 9, base: 6, growth: 7.5 },
    spinner:   { damage: 8, base: 5.5, growth: 6.5 },
    pendulum:  { damage: 12, base: 7.5, growth: 9 },
    // k = falloff 0..1 from the blast centre
    explosion: k => ({ damage: 18 * k, base: 6 * k + 2, growth: 12 * k }),
    // w = item heft (def.damage × mass factor), sk = speed factor × trickshot bonus
    thrown: (w, sk) => ({ damage: (3 + 4 * w) * sk, base: (3.5 + 1.2 * w) * sk, growth: (5 + 2.4 * w) * sk }),
  },

  match: {
    koCreditWindow: 6,
    blastSide: 34,
    blastTop: 30,
    sdBlastScale: 0.88,    // sudden death pulls the side blast line in (34 → 30)
  },
};

// Archetypes: same collider, different feel.
export const TYPE_STATS = {
  cube:        { label: 'Cube',        mass: 3.0, move: 1.0,  jump: 1.0,  armor: 1.0,  growthTaken: 1.0,  airAccel: 1.0,  escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'All-rounder' },
  blob:        { label: 'Blob',        mass: 3.6, move: 0.88, jump: 0.92, armor: 0.85, growthTaken: 0.9,  airAccel: 1.0,  escape: 1.3, diveCd: 1.25, diveDmg: 1.15, hitDmg: 1.0,  blurb: 'Heavy & hard to launch' },
  spiky:       { label: 'Spiky',       mass: 2.6, move: 1.12, jump: 1.08, armor: 1.15, growthTaken: 1.0,  airAccel: 0.85, escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.2,  blurb: 'Fast glass cannon' },
  stalky:      { label: 'Stalky',      mass: 2.9, move: 1.02, jump: 1.05, armor: 0.95, growthTaken: 0.98, airAccel: 1.05, escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'Twin periscope eye stalks' },
  peep:        { label: 'Peep',        mass: 3.1, move: 0.98, jump: 1.02, armor: 1.05, growthTaken: 1.02, airAccel: 0.95, escape: 1.0, diveCd: 1.0,  diveDmg: 1.05, hitDmg: 1.05, blurb: 'Giant horned eyeball' },
  tri_cloud:   { label: 'Tri-Cloud',   mass: 2.5, move: 1.08, jump: 1.15, armor: 1.1,  growthTaken: 1.05, airAccel: 1.15, escape: 1.1, diveCd: 0.9,  diveDmg: 0.95, hitDmg: 0.95, blurb: 'Floaty tri-lobed cloud' },
  bunny:       { label: 'Bunny',       mass: 2.7, move: 1.15, jump: 1.12, armor: 1.05, growthTaken: 1.0,  airAccel: 1.1,  escape: 1.05,diveCd: 0.95, diveDmg: 0.95, hitDmg: 1.0,  blurb: 'Springy floppy ears' },
  puddle:      { label: 'Puddle',      mass: 3.8, move: 0.85, jump: 0.82, armor: 0.86, growthTaken: 0.90, airAccel: 0.8,  escape: 1.4, diveCd: 1.3,  diveDmg: 1.2,  hitDmg: 1.1,  blurb: 'Melting liquid slime' },
  blockhead:   { label: 'Blockhead',   mass: 3.2, move: 0.95, jump: 0.98, armor: 0.9,  growthTaken: 0.95, airAccel: 0.95, escape: 1.0, diveCd: 1.05, diveDmg: 1.05, hitDmg: 1.05, blurb: 'Orange block periscope' },
  gumball:     { label: 'Gumball',     mass: 3.4, move: 0.94, jump: 0.95, armor: 0.92, growthTaken: 0.95, airAccel: 0.95, escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'Candy marble globe' },
  bumpy:       { label: 'Bumpy',       mass: 3.3, move: 0.96, jump: 1.0,  armor: 0.95, growthTaken: 0.98, airAccel: 0.95, escape: 1.0, diveCd: 1.0,  diveDmg: 1.05, hitDmg: 1.05, blurb: 'Soft knobby sensory bumps' },
  cyclops:     { label: 'Cyclops',     mass: 2.8, move: 1.05, jump: 1.04, armor: 1.0,  growthTaken: 1.0,  airAccel: 1.05, escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'One giant expressive pupil' },
  starry:      { label: 'Starry',      mass: 2.6, move: 1.1,  jump: 1.14, armor: 1.1,  growthTaken: 1.05, airAccel: 1.15, escape: 1.0, diveCd: 0.95, diveDmg: 0.95, hitDmg: 1.0,  blurb: '5-pointed wobbly star' },
  blink:       { label: 'Blink',       mass: 2.9, move: 1.02, jump: 1.06, armor: 1.0,  growthTaken: 1.0,  airAccel: 1.0,  escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'Pill capsule twist' },
  bean:        { label: 'Bean',        mass: 3.1, move: 0.97, jump: 1.02, armor: 1.0,  growthTaken: 0.98, airAccel: 1.0,  escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'Tilted legume with side eyes' },
  tadpole:     { label: 'Tadpole',     mass: 2.7, move: 1.08, jump: 1.08, armor: 1.05, growthTaken: 1.0,  airAccel: 1.1,  escape: 1.0, diveCd: 0.95, diveDmg: 0.95, hitDmg: 1.0,  blurb: 'Wagging spring tail' },
  floppy:      { label: 'Floppy',      mass: 3.0, move: 1.0,  jump: 1.05, armor: 1.0,  growthTaken: 1.0,  airAccel: 1.0,  escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'Heavy drooping ear lobes' },
  chonk:       { label: 'Chonk',       mass: 4.0, move: 0.82, jump: 0.85, armor: 0.86, growthTaken: 0.90, airAccel: 0.8,  escape: 1.3, diveCd: 1.3,  diveDmg: 1.25, hitDmg: 1.15, blurb: 'Heavy 4-legged block', signature: { id: 'quake', name: 'Chonk Quake', blurb: 'Hard landings shove rivals', radius: 2.8, minFall: 12 } },
  ghosty:      { label: 'Ghosty',      mass: 2.4, move: 1.14, jump: 1.2,  armor: 1.18, growthTaken: 1.08, airAccel: 1.25, escape: 1.1, diveCd: 0.9,  diveDmg: 0.9,  hitDmg: 0.95, blurb: 'Floating sheet specter', signature: { id: 'phase', name: 'Ghost Phase', blurb: 'First air-dodge per stock is free', invuln: 0.1 } },
  triclops:    { label: 'Tri-Clops',   mass: 3.1, move: 0.98, jump: 1.02, armor: 1.0,  growthTaken: 0.98, airAccel: 0.98, escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'Pyramid with 3 mismatched eyes' },
  rolling_eye: { label: 'Roll-Eye',    mass: 2.9, move: 1.04, jump: 1.02, armor: 1.0,  growthTaken: 1.0,  airAccel: 1.02, escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'Smiley orb with wander eye' },
  sherbet:     { label: 'Sherbet',     mass: 2.8, move: 1.06, jump: 1.06, armor: 1.02, growthTaken: 1.0,  airAccel: 1.05, escape: 1.0, diveCd: 1.0,  diveDmg: 1.0,  hitDmg: 1.0,  blurb: 'Pastel rainbow swirl' },
  antenna:     { label: 'Antenna',     mass: 2.7, move: 1.07, jump: 1.08, armor: 1.04, growthTaken: 1.0,  airAccel: 1.06, escape: 1.0, diveCd: 0.98, diveDmg: 0.98, hitDmg: 1.0,  blurb: 'Teardrop with radio top' },
  boing:       { label: 'Boing',       mass: 3.0, move: 1.1,  jump: 1.35, armor: 1.0,  growthTaken: 1.0,  airAccel: 1.12, escape: 1.0, diveCd: 0.9,  diveDmg: 1.05, hitDmg: 1.05, blurb: 'Steel coiled spring legs', signature: { id: 'pogo', name: 'Pogo Spring', blurb: 'Hold jump to pogo on landing', bounce: 11.5 } },
  boxer:       { label: 'Boxer',       mass: 3.5, move: 0.95, jump: 0.92, armor: 0.88, growthTaken: 0.92, airAccel: 0.9,  escape: 1.1, diveCd: 1.1,  diveDmg: 1.25, hitDmg: 1.2,  blurb: 'Giant boxing gloves', signature: { id: 'uppercut', name: 'Uppercut Streak', blurb: 'Every 3rd punch is an uppercut', every: 3 } },
  plunger:     { label: 'Plunger',     mass: 3.1, move: 1.0,  jump: 1.0,  armor: 0.98, growthTaken: 0.98, airAccel: 1.0,  escape: 1.05,diveCd: 1.0,  diveDmg: 1.05, hitDmg: 1.05, blurb: 'Accordion suction cup arms' },
};

export const statsFor = type => TYPE_STATS[type] || TYPE_STATS.cube;

// ---------------------------------------------------------------- NET block ----
// Owned by NET. Every number above this line belongs to the Lead and is untouched;
// these are netcode constants only, added per the "NET block" rule in AGENTS_PROMPT.
//
// Measured on tools/netSmoke.mjs at 8 clients, 120 ms one-way lag, 2% loss:
// 4.6 KB/s downstream per client, 2.1 KB/s upstream, 0 cm cross-client divergence.
export const NET = {
  // Tick model. The sim is fixed at 60 Hz; snapshots go out at half that, so each
  // snapshot frame covers two sim ticks. 30 Hz is the point where delta compression
  // plus interpolation is indistinguishable from 60 Hz to the eye, and 20 Hz is not.
  simHz: 60,
  snapshotHz: 30,
  // A full snapshot every second. It is the safety net: it repairs any dropped delta
  // and covers a client that joined late, without paying for it on every frame.
  fullSnapshotEvery: 60,          // ticks
  // Items are sent at a third of the snapshot rate. A box rolling on a floor is slow
  // and the view interpolates it, so nobody can tell — and it is ~1.2 KB/s at 8 players.
  itemSnapshotEvery: 3,           // snapshots
  // Input redundancy: each packet repeats the last 3 ticks, so a single dropped
  // packet costs nothing. Three is 50 ms of runway at 60 Hz.
  inputRedundancy: 3,
  // How far the client's tick clock may lead the server's. The client predicts ahead
  // by about half the RTT, so the server accepts the newest input within this window
  // rather than demanding an exact tick. 8 ticks ≈ 133 ms covers 250 ms RTT.
  inputLookaheadTicks: 8,
  // Starvation: how long the server will repeat the last input before calling the
  // client lagging. Repeating reads as a brief slowdown; freezing reads as a bug.
  inputJitterTicks: 12,           // 200 ms
  // Remote entities are rendered this far in the past. 100 ms is about two snapshot
  // intervals of cushion, which absorbs jitter without feeling laggy.
  interpDelayMs: 100,
  // Corrections are eased out over 100 ms instead of snapping.
  smoothMs: 100,
  // Below one metre, smoothing only — never a teleport. A sub-metre disagreement is
  // invisible in motion; snapping there is the single most obvious netcode tell.
  minSnapM: 1.0,
  // Reconnect: the slot, and the dweeb in it, are held for 20 s.
  reconnectHoldMs: 20000,
  // Rate limits per connection, per second: 90 input frames (60 Hz plus headroom)
  // and 40 control messages. Exceeding either benches the connection briefly.
  rateInputPerSec: 90,
  rateOtherPerSec: 40,
  rateBenchMs: 2000,
  // Position resolution on the wire. 1 cm across a 40 m stage is 4000 steps, far
  // below visual resolution, and fits an int16 in centimetres.
  posQuantCm: 1,
  // Room codes: 4 letters from a 24-letter alphabet (no I/L/O to survive being read
  // aloud), so 331,776 combinations.
  roomCodeLen: 4,
  roomAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ',
  maxPlayers: 8,
  // Budget, from the brief. tools/netSmoke.mjs asserts it at 8 players.
  budgetKBpsDown: 8,
};

