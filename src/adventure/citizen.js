// citizen.js — Autonomous Dweeb Citizen Simulation
//
// Governs personality, needs (hunger, energy, curiosity, social), daily routines,
// physics experimentation, peer-to-peer knowledge spread, and autonomous expeditions.
//
// Expedition & Dynasty additions: assignable roles (Forager / Builder / Defender /
// Tinkerer), time-of-day routines (morning gathering, evening singing, night rest),
// mood states with speech-bubble emoticons, friendships, and comic reactions to
// player physics stunts (bounces, zipline rides, vault openings).

import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';

export const PERSONALITIES = [
  { id: 'adventurer', name: 'Fearless Explorer', curiosityBias: 1.5, bravery: 1.4, quirk: 'Always wanders near ruins and high bluffs' },
  { id: 'inventor', name: 'Curious Tinkerer', curiosityBias: 1.3, buildingBias: 1.6, quirk: 'Drags boulders & items together to build things' },
  { id: 'cozy', name: 'Cozy Dreamer', energyDecay: 1.3, socialBias: 1.2, quirk: 'Loves campfires, naps, and snacks' },
  { id: 'social', name: 'Chit-Chatter', socialBias: 1.8, learningSpeed: 1.4, quirk: 'Quickly spreads discovered tricks to other citizens' },
  { id: 'builder', name: 'Master Mason', buildingBias: 1.8, bravery: 1.0, quirk: 'Focuses on bridges, structures, and resource piles' },
];

/** Assignable citizen roles. A role steers the daily routine; needs still win. */
export const ROLES = {
  forager: { id: 'forager', name: 'Forager', icon: '🍓', desc: 'Gathers berries into the village stores' },
  builder: { id: 'builder', name: 'Builder', icon: '🔨', desc: 'Constructs queued blueprints, one hammer at a time' },
  defender: { id: 'defender', name: 'Defender', icon: '🛡️', desc: 'Guards the village and bonks invading critters' },
  tinkerer: { id: 'tinkerer', name: 'Tinkerer', icon: '🔧', desc: 'Plays with contraptions and learns tricks faster' },
};

/** Mood states, each with the emoticon shown in the speech bubble. */
export const MOODS = {
  happy: { id: 'happy', icon: '😊', text: 'Feeling great!' },
  tired: { id: 'tired', icon: '😴', text: 'So sleepy…' },
  excited: { id: 'excited', icon: '🤩', text: 'WOW! Did you see that?!' },
  hungry: { id: 'hungry', icon: '😋', text: 'My tummy is rumbling…' },
};

export const CITIZEN_STATES = {
  IDLE: 'IDLE',
  WANDER: 'WANDER',
  FORAGE: 'FORAGE',
  REST: 'REST',
  SOCIALIZE: 'SOCIALIZE',
  TINKER: 'TINKER',
  OBSERVE: 'OBSERVE',
  EXPEDITION: 'EXPEDITION',
  BUILD: 'BUILD',
  GUARD: 'GUARD',
  SING: 'SING',
  REPAIR: 'REPAIR',
  TRY_STUNT: 'TRY_STUNT',
};

/** Copyable stunt types, with the verb learned on success and the comedy lines. */
const COPYCAT_STUNTS = {
  bounce: {
    verb: 'bounce',
    win: 'I bounced! Did everyone see that?! 🤩',
    fail: 'I bounced straight onto my face. Worth it! 😵',
  },
  launch: {
    verb: 'launch',
    win: 'Launch successful! I am a flying Dweeb! 🚀',
    fail: 'The launchpad laughed at me. Ouch. 😵',
  },
  zipline: {
    verb: 'zipline',
    win: 'Wheee! I rode the zipline all by myself! 🎉',
    fail: 'I ran at the zipline and hugged the pole instead. 😵',
  },
  vault: {
    verb: 'vault',
    win: 'I found the vault trick! Treasure, here I come! 🤩',
    fail: 'I tripped over my own feet at the vault door. 😵',
  },
};

/** Seconds a citizen remembers a stunt and keeps trying to copy it. */
const COPYCAT_MEMORY = 9;
/** Seconds before a citizen can be inspired by another stunt. */
const COPYCAT_COOLDOWN = 22;

export class Citizen {
  constructor(dweeb, config = {}) {
    this.dweeb = dweeb;
    this.name = dweeb.name || config.name || 'Dweeb';
    this.personality = config.personality || PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

    // Vitals (0 - 100)
    this.hunger = 40 + Math.random() * 30;     // >75 means hungry, wants berries
    this.energy = 60 + Math.random() * 40;     // <25 means tired, wants campfire or hut
    this.curiosity = 30 + Math.random() * 40;  // >70 means wants to explore ruins or tinker
    this.social = 40 + Math.random() * 40;     // >70 means wants to chat with peers

    // Learned verbs & knowledge (verbatim skills: 'bounce', 'carry', 'build', 'burrow', etc.)
    this.knownVerbs = new Set(config.knownVerbs || ['carry']);
    this.learningProgress = {}; // verbId -> progress (0 to 1)

    // Role (null = unassigned villager, follows needs only)
    this.role = config.role || null;
    // Mood + speech bubble
    this.mood = 'happy';
    this.moodTimer = 0; // seconds of forced excitement left
    this.bubble = null; // { icon, text, until } in citizen clock seconds
    this.clock = 0;
    // Friendships: peer name -> bond (0..100)
    this.friends = new Map();
    this._bondLogged = new Set();

    // AI state
    this.state = CITIZEN_STATES.WANDER;
    this.stateTimer = 2 + Math.random() * 3;
    this.activityText = 'Enjoying the fresh meadow breeze';
    this.targetPos = new THREE.Vector3();
    this.targetEntity = null;

    // Movement speeds & steering
    this.moveSpeed = 4.2;
    this.arrivalDist = 1.6;
    this.stuckTimer = 0;
    this.lastPos = new THREE.Vector3();
    // Corner-unstick: a perpendicular sidestep engaged while a sharp building
    // corner blocks the straight-line heading (see _executeGoal).
    this._sidestep = null; // { until, dx, dz } in citizen clock seconds
    this.unstuckCount = 0; // how many times the sidestep fired (test hook)

    // Role work accumulators
    this._eatAcc = 0;
    this._buildAcc = 0;
    this._bonkAcc = 0;
    this._lastStuntAt = -1;

    // Village copycat: a fresh stunt this citizen wants to imitate.
    this.copycat = null;         // { type, x, z, until, verb, stunt, attempted }
    this._copycatCooldown = 0;   // seconds before another imitation

    // Toy-hammer repair duty (landmarks from the ToyTown district).
    this._repairSwing = 0;
    this.repairHammer = null;
  }

  /** A tiny toy hammer appears while a worker is patching a broken fort. */
  _ensureHammer() {
    if (this.repairHammer) return this.repairHammer;
    const g = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.038, 0.52, 5),
      toonMat({ color: 0x8a5a2b, flatShading: true }),
    );
    handle.position.y = 0.24;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.15, 0.15),
      toonMat({ color: 0x8293a4, flatShading: true }),
    );
    head.position.y = 0.54;
    g.add(handle, head);
    g.position.set(0.42, 0.72, 0.24);
    g.rotation.z = -0.35;
    this.dweeb.mesh?.add(g);
    this.repairHammer = g;
    return g;
  }

  /** Assign (or clear with null) a role. Returns true if the role id is valid. */
  assignRole(roleId) {
    if (roleId !== null && !ROLES[roleId]) return false;
    this.role = roleId;
    if (roleId) {
      this.activityText = `${this.name} is now the village ${ROLES[roleId].name} ${ROLES[roleId].icon}`;
    }
    return true;
  }

  /** Show a speech bubble for a few seconds. */
  say(text, icon = '💬', seconds = 2.5) {
    this.bubble = { icon, text, until: this.clock + seconds };
  }

  /** Current speech bubble: an explicit say() while it lasts, else the mood. */
  bubbleText() {
    if (this.bubble && this.clock < this.bubble.until) return this.bubble;
    const m = MOODS[this.mood] || MOODS.happy;
    return { icon: m.icon, text: m.text };
  }

  get moodIcon() {
    return (MOODS[this.mood] || MOODS.happy).icon;
  }

  /** Name of the citizen this one is closest to, or null. */
  get bestFriend() {
    let best = null;
    let bestBond = 0;
    for (const [name, bond] of this.friends) {
      if (bond > bestBond) { best = name; bestBond = bond; }
    }
    return best;
  }

  learnVerb(verbId) {
    if (this.knownVerbs.has(verbId)) return false;
    this.knownVerbs.add(verbId);
    this.activityText = `Eureka! Discovered how to ${verbId.toUpperCase()}!`;
    this.moodTimer = 2;
    this.say('Eureka! I learned something new!', '💡', 2.5);
    return true;
  }

  observePeer(teacherCitizen, verbId, dt) {
    if (this.knownVerbs.has(verbId)) return;
    if (!this.learningProgress[verbId]) this.learningProgress[verbId] = 0;

    const tinkererBonus = this.role === 'tinkerer' ? 1.5 : 1.0;
    const rate = 0.25 * (this.personality.learningSpeed || 1.0) * tinkererBonus;
    this.learningProgress[verbId] += dt * rate;
    this.state = CITIZEN_STATES.OBSERVE;
    this.activityText = `Carefully watching ${teacherCitizen.name} demonstrate ${verbId}...`;

    if (this.learningProgress[verbId] >= 1.0) {
      this.learnVerb(verbId);
      this.state = CITIZEN_STATES.TINKER;
      this.activityText = `Practicing ${verbId} excitedly!`;
    }
  }

  /** React to a nearby physics stunt (bounce, zipline, vault). */
  reactToStunt(stunt, otherCitizens = []) {
    if (!stunt) return;
    const lines = {
      bounce: { text: 'Whoa! Did you SEE that bounce?!', icon: '🤩' },
      zipline: { text: 'Wheee! The zipline! Again! Again!', icon: '🤩' },
      vault: { text: 'A vault opened! TREASURE!!', icon: '🤩' },
      launch: { text: 'They went SO high! I want a turn!', icon: '😮' },
    };
    const line = lines[stunt.type] || lines.bounce;
    this.moodTimer = 3;
    this.mood = 'excited';
    this.say(line.text, line.icon, 3);
    this.activityText = line.text;

    // One nearby citizen gets the idea to imitate the stunt. The shared stunt
    // object acts as the claim, so the first inspired villager wins and the
    // rest only cheer.
    this._tryRememberStunt(stunt, otherCitizens);
  }

  /** Remember a stunt to imitate, if this citizen is free and not on cooldown. */
  _tryRememberStunt(stunt, otherCitizens = []) {
    if (!stunt || stunt.copycatClaimed) return false;
    const spec = COPYCAT_STUNTS[stunt.type];
    if (!spec) return false;
    if (!Number.isFinite(stunt.x) || !Number.isFinite(stunt.z)) return false;
    if (this.copycat || this._copycatCooldown > 0) return false;
    if (!this.dweeb || !this.dweeb.body) return false;

    this.copycat = {
      type: stunt.type,
      x: stunt.x,
      z: stunt.z,
      until: this.clock + COPYCAT_MEMORY,
      verb: spec.verb,
      stunt,
      attempted: false,
    };
    stunt.copycatClaimed = true;
    stunt.copycatName = this.name;

    // A little extra flavour: tinkerers are usually first to volunteer.
    if (this.role === 'tinkerer' && otherCitizens.length > 1) {
      this.activityText = `Ooh! A ${stunt.type} trick? I can build that!`;
    } else {
      this.activityText = `Ooh! I want to try that ${stunt.type} too!`;
    }
    this.stateTimer = 0; // decide on the copy attempt right away
    return true;
  }

  update(dt, world, otherCitizens = [], colony = null) {
    if (!this.dweeb || !this.dweeb.body) return;
    this.clock += dt;
    if (this._copycatCooldown > 0) this._copycatCooldown = Math.max(0, this._copycatCooldown - dt);

    // 1. Update internal needs
    this.hunger = Math.min(100, this.hunger + dt * 0.8);
    this.energy = Math.max(0, this.energy - dt * 0.7 * (this.personality.energyDecay || 1.0));
    this.curiosity = Math.min(100, this.curiosity + dt * 1.1 * (this.personality.curiosityBias || 1.0));
    this.social = Math.min(100, this.social + dt * 0.9 * (this.personality.socialBias || 1.0));

    // Friendships slowly cool off without contact.
    for (const [name, bond] of this.friends) {
      this.friends.set(name, Math.max(0, bond - dt * 0.05));
    }

    // Mood follows needs, unless something exciting just happened.
    if (this.moodTimer > 0) {
      this.moodTimer -= dt;
      this.mood = 'excited';
    } else if (this.energy < 25) {
      this.mood = 'tired';
    } else if (this.hunger > 70) {
      this.mood = 'hungry';
    } else {
      this.mood = 'happy';
    }

    // Comic reactions to nearby player physics stunts.
    if (world && world.stuntFeed) {
      const pos = this.dweeb.body.translation();
      for (const stunt of world.stuntFeed) {
        if (stunt.at === this._lastStuntAt) continue;
        if (this.clock - stunt.at > 2) continue;
        if (Math.hypot(stunt.x - pos.x, stunt.z - pos.z) > 14) continue;
        this._lastStuntAt = stunt.at;
        this.reactToStunt(stunt, otherCitizens);
      }
    }

    this.stateTimer -= dt;

    // Check stuck detection. Citizens working, eating, chatting or singing in
    // place are not stuck — only movers get re-evaluated.
    const stationaryStates = [
      CITIZEN_STATES.REST, CITIZEN_STATES.FORAGE, CITIZEN_STATES.SOCIALIZE,
      CITIZEN_STATES.BUILD, CITIZEN_STATES.SING, CITIZEN_STATES.REPAIR,
    ];
    const currentPos = this.dweeb.body.translation();
    if (this.lastPos.distanceTo(currentPos) < 0.1 && !stationaryStates.includes(this.state)) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.5) {
        this.stateTimer = 0; // force re-evaluate
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastPos.set(currentPos.x, currentPos.y, currentPos.z);

    // 2. State Machine Transition
    if (this.stateTimer <= 0) {
      this._selectNextGoal(world, otherCitizens, colony);
    }

    // 3. State Execution
    this._executeGoal(dt, world, otherCitizens, colony);
  }

  _selectNextGoal(world, otherCitizens, colony = null) {
    // Priority 0: A fresh stunt memory outranks chores — the village is watching!
    if (this.copycat) {
      if (this.copycat.attempted || this.clock >= this.copycat.until) {
        if (!this.copycat.attempted) this._copycatCooldown = Math.max(this._copycatCooldown, 6);
        this.copycat = null;
      } else {
        this.state = CITIZEN_STATES.TRY_STUNT;
        this.targetEntity = null;
        this.targetPos.set(this.copycat.x, 0.5, this.copycat.z);
        this.stateTimer = COPYCAT_MEMORY + 2;
        this.activityText = `Running over to copy that ${this.copycat.type} trick!`;
        return;
      }
    }

    // Priority 1: High Hunger -> Find Berry Bush (foragers go earlier)
    const hungerLine = this.role === 'forager' ? 55 : 70;
    if (this.hunger > hungerLine && world.berryBushes && world.berryBushes.length > 0) {
      const bush = world.berryBushes[Math.floor(Math.random() * world.berryBushes.length)];
      this.state = CITIZEN_STATES.FORAGE;
      this.targetEntity = bush;
      this.targetPos.set(bush.x, bush.y, bush.z);
      this.stateTimer = 8 + Math.random() * 4;
      this.activityText = 'Heading to the berry bushes for a sweet snack';
      return;
    }

    // Priority 2: Low Energy -> Rest at Campfire, Hut, or Placed Tent
    if (this.energy < 25) {
      this.state = CITIZEN_STATES.REST;
      const placedTents = world.buildingManager ? world.buildingManager.placedStructures.filter(s => s.id === 'tent' || s.id === 'firepit') : [];
      if (placedTents.length > 0 && Math.random() > 0.4) {
        const target = placedTents[Math.floor(Math.random() * placedTents.length)];
        this.targetPos.set(target.pos.x, target.pos.y, target.pos.z);
        this.activityText = `Resting cozily at the newly built ${target.id === 'tent' ? 'Play Tent' : 'Firepit'}`;
      } else {
        // Campfire is at (0, 0, 0)
        this.targetPos.set((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3);
        this.activityText = 'Sitting cozily by the central fire, recharging energy';
      }
      this.stateTimer = 6 + Math.random() * 5;
      return;
    }

    // Priority 3: Damaged toy-set landmarks need tiny hammers and big determination.
    const damaged = world.toyTown?.getDamaged?.() || [];
    if (damaged.length > 0 && this.energy > 18 && (this.personality.buildingBias || 0) >= 1.4) {
      const structure = damaged[Math.floor(Math.random() * damaged.length)];
      this.state = CITIZEN_STATES.REPAIR;
      this.targetEntity = structure;
      this.targetPos.copy(structure.repairPoint);
      this.stateTimer = 20 + Math.random() * 8;
      this.activityText = `Marching over to patch up the ${structure.name} with a tiny toy hammer`;
      return;
    }

    // Time-of-day routines (world.timeOfDay is 0-24 when the day/night cycle runs).
    const tod = world ? world.timeOfDay : undefined;
    if (tod !== undefined) {
      // Night (20:00-06:00): everyone sleeps, unless fully rested.
      if ((tod >= 20 || tod < 6) && this.energy < 90) {
        this.state = CITIZEN_STATES.REST;
        this.targetPos.set((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3);
        this.stateTimer = 6 + Math.random() * 4;
        this.activityText = 'Snuggled up by the fire for the night 🌙';
        return;
      }
      // Evening (17:00-20:00): gather round the campfire and sing.
      if (tod >= 17 && tod < 20 && this.social > 40) {
        this.state = CITIZEN_STATES.SING;
        this.targetPos.set((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3);
        this.stateTimer = 8 + Math.random() * 4;
        this.activityText = 'Gathering round the campfire for the evening song 🎵';
        return;
      }
    }

    // Role: Builder -> construct the next queued blueprint.
    if (this.role === 'builder' && colony && colony.buildQueue && colony.buildQueue.length > 0) {
      this.state = CITIZEN_STATES.BUILD;
      this.targetEntity = colony.buildQueue[0];
      // Build site: a clearing just off the campfire.
      this.targetPos.set(6 + (Math.random() - 0.5) * 3, 0.5, 6 + (Math.random() - 0.5) * 3);
      this._buildAcc = 0;
      this.stateTimer = 12;
      this.activityText = `Marching off to build the ${colony.buildQueue[0]}! 🔨`;
      return;
    }

    // Role: Defender -> patrol the barricades, or the village edge.
    if (this.role === 'defender') {
      this.state = CITIZEN_STATES.GUARD;
      const posts = world.buildingManager
        ? world.buildingManager.placedStructures.filter(s => s.id === 'cannon')
        : [];
      if (posts.length > 0) {
        const post = posts[Math.floor(Math.random() * posts.length)];
        this.targetPos.set(post.pos.x + (Math.random() - 0.5) * 3, post.pos.y, post.pos.z + (Math.random() - 0.5) * 3);
        this.activityText = 'Standing guard at the plush cannon 🛡️';
      } else {
        // Patrol the village edge.
        const ang = Math.random() * Math.PI * 2;
        this.targetPos.set(Math.cos(ang) * 12, 0.5, Math.sin(ang) * 12);
        this.activityText = 'Patrolling the village edge, watching for critters 🛡️';
      }
      this.stateTimer = 8 + Math.random() * 4;
      return;
    }

    // Priority 3: Placed Inventions (Springboard, Ramp, Catapult, Launchpad)
    const placedToys = world.buildingManager ? world.buildingManager.placedStructures.filter(s => s.id === 'springboard' || s.id === 'catapult' || s.id === 'ramp' || s.id === 'launchpad') : [];
    const toyChance = this.role === 'tinkerer' ? 0.7 : 0.35;
    if (placedToys.length > 0 && Math.random() < toyChance) {
      const toy = placedToys[Math.floor(Math.random() * placedToys.length)];
      this.state = CITIZEN_STATES.TINKER;
      this.targetPos.set(toy.pos.x + (Math.random() - 0.5) * 1.5, toy.pos.y, toy.pos.z + (Math.random() - 0.5) * 1.5);
      this.stateTimer = 5 + Math.random() * 4;
      this.activityText = `Experimenting with the ${toy.id} contraption!`;
      return;
    }

    // Priority 4: High Curiosity -> Explore Ruins or Lookout Bluff
    if (this.curiosity > 65) {
      this.state = CITIZEN_STATES.EXPEDITION;
      if (Math.random() > 0.4) {
        // Head towards the Ancient Meadowland Ruin
        this.targetPos.set((Math.random() - 0.5) * 6, 1.2, -32 + (Math.random() - 0.5) * 4);
        this.activityText = 'Surveying the mysterious Ancient Ruin';
      } else {
        // Head towards Lookout Bluff
        this.targetPos.set(28 + (Math.random() - 0.5) * 6, 3.5, 5 + (Math.random() - 0.5) * 6);
        this.activityText = 'Hiking up to the Lookout Bluff';
      }
      this.stateTimer = 10 + Math.random() * 6;
      return;
    }

    // Priority 4: Socializing -> Visit a fellow Dweeb
    if (this.social > 55 && otherCitizens.length > 0) {
      const peer = otherCitizens[Math.floor(Math.random() * otherCitizens.length)];
      if (peer !== this && peer.dweeb && peer.dweeb.body) {
        this.state = CITIZEN_STATES.SOCIALIZE;
        this.targetEntity = peer;
        const pp = peer.dweeb.body.translation();
        this.targetPos.set(pp.x + (Math.random() - 0.5) * 2, pp.y, pp.z + (Math.random() - 0.5) * 2);
        this.stateTimer = 6 + Math.random() * 4;
        this.activityText = `Visiting ${peer.name} to chat and share discoveries`;
        return;
      }
    }

    // Default: Cozy village wander & tinkering
    this.state = CITIZEN_STATES.WANDER;
    this.targetPos.set((Math.random() - 0.5) * 24, 0.5, (Math.random() - 0.5) * 24);
    this.stateTimer = 4 + Math.random() * 4;
    this.activityText = 'Wandering peacefully around New Dweebtopia';
  }

  /** Chance that this citizen pulls off the copied stunt, from role + personality. */
  _copycatSuccessChance(type) {
    let chance = 0.45;
    if (this.role === 'tinkerer') chance += 0.3;
    else if (this.role === 'defender') chance += 0.18;
    else if (this.role === 'builder') chance += 0.08;
    else if (this.role === 'forager') chance += 0.02;

    const bravery = Number(this.personality && this.personality.bravery) || 1;
    chance += (bravery - 1) * 0.28;
    const pid = this.personality && this.personality.id;
    if (pid === 'adventurer') chance += 0.06;
    else if (pid === 'inventor') chance += 0.09;
    else if (pid === 'cozy') chance -= 0.12;

    if (this.energy < 30) chance -= 0.12;
    if (type === 'zipline') chance -= 0.1;
    else if (type === 'vault') chance += 0.08;
    return Math.max(0.12, Math.min(0.92, chance));
  }

  /** Nearby villagers cheer a success or groan at a wipeout. */
  _copycatCrowd(otherCitizens, text, icon) {
    if (!Array.isArray(otherCitizens) || !this.dweeb || !this.dweeb.body) return;
    const here = this.dweeb.body.translation();
    if (!here) return;
    for (const peer of otherCitizens) {
      if (!peer || peer === this || !peer.dweeb || !peer.dweeb.body) continue;
      let pp;
      try { pp = peer.dweeb.body.translation(); } catch { continue; }
      if (!pp) continue;
      if (Math.hypot(pp.x - here.x, pp.z - here.z) > 16) continue;
      peer.moodTimer = Math.max(peer.moodTimer || 0, 2);
      peer.mood = 'excited';
      if (Math.random() < 0.55 && typeof peer.say === 'function') {
        peer.say(text, icon, 2);
      }
    }
  }

  /** Perform the remembered stunt. Success teaches the verb; failure is comedy. */
  _performCopycat(cc, otherCitizens, colony = null) {
    if (!cc || !this.dweeb || !this.dweeb.body) return;
    cc.attempted = true;
    const spec = COPYCAT_STUNTS[cc.type] || COPYCAT_STUNTS.bounce;
    const success = Math.random() < this._copycatSuccessChance(cc.type);

    if (success) {
      const learned = this.learnVerb(cc.verb);
      this.mood = 'excited';
      this.moodTimer = 4;
      this.say(spec.win, '🤩', 3);
      this.activityText = `Nailed the ${cc.type} trick all by myself!`;

      // Re-enact it physically: bounces and launches send them sky-high, the rest is a proud hop
      if (this.dweeb.body && this.dweeb.body.setLinvel) {
        const v = this.dweeb.body.linvel ? this.dweeb.body.linvel() : { x: 0, z: 0 };
        const up = cc.type === 'launch' ? 14 : cc.type === 'bounce' ? 11 : cc.type === 'zipline' ? 7 : 5;
        const fwd = cc.type === 'launch' ? 6 : cc.type === 'zipline' ? 4 : 0;
        const yaw = Number(this.dweeb.yaw) || 0;
        this.dweeb.body.setLinvel({ x: (v.x || 0) * 0.3 + Math.sin(yaw) * fwd, y: up, z: (v.z || 0) * 0.3 + Math.cos(yaw) * fwd }, true);
        if (this.dweeb.body.setAngvel && up > 8) this.dweeb.body.setAngvel({ x: 0, y: 9, z: 0 }, true);
      }

      this._copycatCrowd(otherCitizens, `Yay! ${this.name} copied the ${cc.type}!`, '🎉');
      if (learned && colony && typeof colony._addLog === 'function') {
        colony._addLog(`🌟 ${this.name} copied the player's ${cc.type} stunt and learned ${cc.verb.toUpperCase()}!`);
      }
    } else {
      // Comedic failure: a ragdoll tumble (or a plain stumble if unavailable).
      this.energy = Math.max(0, this.energy - 4);
      this.say(spec.fail, '😵', 3);
      this.activityText = `Face-planted trying to copy the ${cc.type} trick 😵`;
      if (this.dweeb.body && this.dweeb.body.setLinvel) {
        const v = this.dweeb.body.linvel ? this.dweeb.body.linvel() : { x: 0, z: 0 };
        this.dweeb.body.setLinvel({
          x: (v.x || 0) * 0.2 + (Math.random() - 0.5) * 2.5,
          y: 2.2,
          z: (v.z || 0) * 0.2 + (Math.random() - 0.5) * 2.5,
        }, true);
      }
      if (typeof this.dweeb.startRagdoll === 'function') {
        this.dweeb.startRagdoll(0.9, 5);
      }
      this._copycatCrowd(otherCitizens, `Ooooh! ${this.name} wiped out!`, '😂');
    }

    this.copycat = null;
    this._copycatCooldown = COPYCAT_COOLDOWN + Math.random() * 8;
    this.stateTimer = 1.5 + Math.random() * 1.5;
  }

  _executeGoal(dt, world, otherCitizens, colony = null) {
    const pos = this.dweeb.body.translation();
    const distToTarget = Math.hypot(this.targetPos.x - pos.x, this.targetPos.z - pos.z);

    if (this.repairHammer) this.repairHammer.visible = this.state === CITIZEN_STATES.REPAIR;

    // Repair duty: walk to the damaged landmark, then tap-tap-tap it back together.
    if (this.state === CITIZEN_STATES.REPAIR) {
      const target = this.targetEntity;
      if (!target || !target.repairStep) {
        this.stateTimer = 0;
        this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
      if (this.dweeb.moveInput) this.dweeb.moveInput.set(0, 0);
        return;
      }
      this._ensureHammer();
      if (distToTarget <= this.arrivalDist + 0.4) {
        this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
      if (this.dweeb.moveInput) this.dweeb.moveInput.set(0, 0);
        const stillDamaged = target.repairStep(dt);
        this._repairSwing += dt * 9;
        this.repairHammer.rotation.z = -0.35 + Math.abs(Math.sin(this._repairSwing)) * 0.95;
        this.activityText = `Tap-tap-tapping repairs on the ${target.name}`;
        if (!stillDamaged) {
          this.activityText = `${target.name} is all patched up!`;
          this.stateTimer = 0.2;
          this.targetEntity = null;
          this.energy = Math.max(0, this.energy - 6);
          world.onStructureRepaired?.(target);
        }
        return;
      }
      this.repairHammer.rotation.z = -0.35;
    }

    // Copycat attempt: walk to the stunt origin, then try the matching action.
    if (this.state === CITIZEN_STATES.TRY_STUNT) {
      const cc = this.copycat;
      if (!cc) {
        this.stateTimer = 0;
        this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
        if (this.dweeb.moveInput) this.dweeb.moveInput.set(0, 0);
        return;
      }
      if (!cc.attempted && this.clock >= cc.until) {
        // Too slow — the moment passed and the crowd moved on.
        this.copycat = null;
        this._copycatCooldown = Math.max(this._copycatCooldown, 6);
        this.stateTimer = 0;
        this.say('Aww, I missed my turn to try it…', '😔', 2);
        this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
        if (this.dweeb.moveInput) this.dweeb.moveInput.set(0, 0);
        return;
      }
      if (distToTarget <= this.arrivalDist + 0.6) {
        this._performCopycat(cc, otherCitizens, colony);
        this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
        if (this.dweeb.moveInput) this.dweeb.moveInput.set(0, 0);
        return;
      }
      // Still walking: fall through to the shared movement code at the bottom.
    }

    // If resting, replenish energy and sit still (night rest is twice as fast).
    if (this.state === CITIZEN_STATES.REST) {
      const tod = world ? world.timeOfDay : undefined;
      const nightBonus = tod !== undefined && (tod >= 20 || tod < 6) ? 2 : 1;
      this.energy = Math.min(100, this.energy + dt * 15 * nightBonus);
      this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
      if (this.dweeb.moveInput) this.dweeb.moveInput.set(0, 0);
      return;
    }

    // Defenders chase critters while on patrol. This runs before the arrival
    // check because the target moves — "arrived" doesn't apply to a critter.
    if (this.state === CITIZEN_STATES.GUARD && world.critters && world.critters.length > 0) {
      let nearest = null;
      let best = 10;
      for (const c of world.critters) {
        if (c.hostile === false) continue; // defenders leave friendly beetles alone
        const d = Math.hypot(c.x - pos.x, c.z - pos.z);
        if (d < best) { best = d; nearest = c; }
      }
      if (nearest) {
        this.targetPos.set(nearest.x, nearest.y, nearest.z);
        if (best < 2.5) {
          // Bonk! One plush mallet hit every 1.5 seconds.
          this._bonkAcc += dt;
          if (this._bonkAcc >= 1.5) {
            this._bonkAcc = 0;
            nearest.hp -= 1;
            this.activityText = 'Bonked a critter with a plush mallet! 💢';
            this.say('Take that, critter!', '💢', 1.5);
            if (nearest.hp <= 0) {
              if (world.removeCritter) world.removeCritter(nearest);
              if (colony) {
                colony.resources.gold = (colony.resources.gold || 0) + 1;
                colony._addLog(`🛡️ ${this.name} bonked a mischief critter! +1 🪙`);
              }
            }
          }
          this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
      if (this.dweeb.moveInput) this.dweeb.moveInput.set(0, 0);
          return;
        }
      }
    }

    // If reached target
    if (distToTarget <= this.arrivalDist) {
      if (this.state === CITIZEN_STATES.FORAGE) {
        // Eat one berry a second off the bush; foragers bank it for the village.
        this._eatAcc += dt;
        const bush = this.targetEntity;
        if (this._eatAcc >= 1) {
          this._eatAcc -= 1;
          if (bush && bush.available > 0) {
            bush.available -= 1;
            if (this.role === 'forager' && colony) {
              this.hunger = Math.max(0, this.hunger - 8);
              const silos = world.buildingManager
                ? world.buildingManager.placedStructures.filter(s => s.id === 'silo')
                : [];
              colony.addResource('berries', 1, silos);
              this.activityText = 'Picking berries for the village stores 🍓';
            } else {
              this.hunger = Math.max(0, this.hunger - 25);
              this.activityText = 'Happily munching on sweet berries';
            }
          } else {
            // Bush is picked clean — move on.
            this.stateTimer = 0;
            this.activityText = 'This bush is picked clean!';
          }
        }
      } else if (this.state === CITIZEN_STATES.SOCIALIZE && this.targetEntity) {
        this.social = Math.max(0, this.social - dt * 20);
        // Friendships grow while chatting.
        const peer = this.targetEntity;
        const bond = Math.min(100, (this.friends.get(peer.name) || 0) + dt * 3);
        this.friends.set(peer.name, bond);
        if (bond >= 50 && !this._bondLogged.has(peer.name)) {
          this._bondLogged.add(peer.name);
          if (colony) colony._addLog(`💛 ${this.name} and ${peer.name} are now best buds!`);
        }
        // Social knowledge diffusion! If I know Bounce and they don't, teach them
        if (this.knownVerbs.has('bounce')) {
          this.targetEntity.observePeer(this, 'bounce', dt);
        }
      } else if (this.state === CITIZEN_STATES.EXPEDITION) {
        this.curiosity = Math.max(0, this.curiosity - dt * 20);
      } else if (this.state === CITIZEN_STATES.SING) {
        this.social = Math.max(0, this.social - dt * 10);
        this.energy = Math.min(100, this.energy + dt * 2);
        if (Math.random() < dt * 0.3) this.say('La la la! 🎵', '🎵', 2);
        this.activityText = 'Singing the Berry Harvest song 🎵';
      } else if (this.state === CITIZEN_STATES.BUILD && colony) {
        // Hammer away; after 6 seconds of work the blueprint is done.
        this._buildAcc += dt;
        this.activityText = `Hammering away at the ${this.targetEntity}! 🔨`;
        if (this._buildAcc >= 6) {
          const done = colony._completeBuild(this.targetEntity, world);
          if (done) {
            this.say('Done! Look at it! 🔨', '🔨', 3);
            this.moodTimer = 2;
          }
          this.stateTimer = 0;
        }
      }
      this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
      if (this.dweeb.moveInput) this.dweeb.moveInput.set(0, 0);
      return;
    }

    // Move toward target
    const dx = this.targetPos.x - pos.x;
    const dz = this.targetPos.z - pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const dirX = dx / len;
    const dirZ = dz / len;

    // Check if jump needed (e.g. slope or obstacle)
    let jump = false;
    if (this.stuckTimer > 0.8 && Math.random() < 0.2) {
      jump = true;
    }

    // Corner unstick: straight-line steering wedges citizens against sharp
    // building corners (the physics body pushes into the corner while the
    // heading never changes, so the stuck detector alone just re-picks goals).
    // After ~1.2 s of no progress, sidestep perpendicular to the blocked
    // heading for a moment — sliding along the wall rounds the corner.
    if (this._sidestep && this.clock >= this._sidestep.until) this._sidestep = null;
    if (!this._sidestep && this.stuckTimer > 1.2) {
      const side = Math.random() < 0.5 ? 1 : -1;
      this._sidestep = { until: this.clock + 1.4, dx: -dirZ * side, dz: dirX * side };
      this.unstuckCount += 1;
    }
    let moveX = dirX;
    let moveZ = dirZ;
    if (this._sidestep) {
      moveX = dirX * 0.45 + this._sidestep.dx * 0.9;
      moveZ = dirZ * 0.45 + this._sidestep.dz * 0.9;
      const mlen = Math.hypot(moveX, moveZ) || 1;
      moveX /= mlen;
      moveZ /= mlen;
    }

    // If we have learned the Bounce verb and are near a spring pad, bounce!
    if (this.knownVerbs.has('bounce') && world.springPads) {
      for (const sp of world.springPads) {
        if (Math.hypot(pos.x - sp.x, pos.z - sp.z) < 2.5) {
          jump = true;
          this.activityText = 'Performing a giant bounce!';
        }
      }
    }

    // Feed movement input to Dweeb
    this.dweeb.controllerInput = {
      moveX,
      moveY: -moveZ, // Three.js forward is -Z
      jump,
    };
    if (this.dweeb.moveInput) {
      this.dweeb.moveInput.set(moveX, -moveZ);
    }
    if (jump && typeof this.dweeb.jump === 'function') {
      this.dweeb.jump();
    }
  }
}
