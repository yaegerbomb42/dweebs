// citizen.js — Autonomous Dweeb Citizen Simulation
//
// Governs personality, needs (hunger, energy, curiosity, social), daily routines,
// physics experimentation, peer-to-peer knowledge spread, and autonomous expeditions.

import * as THREE from 'three';

export const PERSONALITIES = [
  { id: 'adventurer', name: 'Fearless Explorer', curiosityBias: 1.5, bravery: 1.4, quirk: 'Always wanders near ruins and high bluffs' },
  { id: 'inventor', name: 'Curious Tinkerer', curiosityBias: 1.3, buildingBias: 1.6, quirk: 'Drags boulders & items together to build things' },
  { id: 'cozy', name: 'Cozy Dreamer', energyDecay: 1.3, socialBias: 1.2, quirk: 'Loves campfires, naps, and snacks' },
  { id: 'social', name: 'Chit-Chatter', socialBias: 1.8, learningSpeed: 1.4, quirk: 'Quickly spreads discovered tricks to other citizens' },
  { id: 'builder', name: 'Master Mason', buildingBias: 1.8, bravery: 1.0, quirk: 'Focuses on bridges, structures, and resource piles' },
];

export const CITIZEN_STATES = {
  IDLE: 'IDLE',
  WANDER: 'WANDER',
  FORAGE: 'FORAGE',
  REST: 'REST',
  SOCIALIZE: 'SOCIALIZE',
  TINKER: 'TINKER',
  OBSERVE: 'OBSERVE',
  EXPEDITION: 'EXPEDITION',
};

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
  }

  learnVerb(verbId) {
    if (this.knownVerbs.has(verbId)) return false;
    this.knownVerbs.add(verbId);
    this.activityText = `Eureka! Discovered how to ${verbId.toUpperCase()}!`;
    return true;
  }

  observePeer(teacherCitizen, verbId, dt) {
    if (this.knownVerbs.has(verbId)) return;
    if (!this.learningProgress[verbId]) this.learningProgress[verbId] = 0;

    const rate = 0.25 * (this.personality.learningSpeed || 1.0);
    this.learningProgress[verbId] += dt * rate;
    this.state = CITIZEN_STATES.OBSERVE;
    this.activityText = `Carefully watching ${teacherCitizen.name} demonstrate ${verbId}...`;

    if (this.learningProgress[verbId] >= 1.0) {
      this.learnVerb(verbId);
      this.state = CITIZEN_STATES.TINKER;
      this.activityText = `Practicing ${verbId} excitedly!`;
    }
  }

  update(dt, world, otherCitizens = []) {
    if (!this.dweeb || !this.dweeb.body) return;

    // 1. Update internal needs
    this.hunger = Math.min(100, this.hunger + dt * 0.8);
    this.energy = Math.max(0, this.energy - dt * 0.7 * (this.personality.energyDecay || 1.0));
    this.curiosity = Math.min(100, this.curiosity + dt * 1.1 * (this.personality.curiosityBias || 1.0));
    this.social = Math.min(100, this.social + dt * 0.9 * (this.personality.socialBias || 1.0));

    this.stateTimer -= dt;

    // Check stuck detection
    const currentPos = this.dweeb.body.translation();
    if (this.lastPos.distanceTo(currentPos) < 0.1 && this.state !== CITIZEN_STATES.REST) {
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
      this._selectNextGoal(world, otherCitizens);
    }

    // 3. State Execution
    this._executeGoal(dt, world, otherCitizens);
  }

  _selectNextGoal(world, otherCitizens) {
    // Priority 1: High Hunger -> Find Berry Bush
    if (this.hunger > 70 && world.berryBushes && world.berryBushes.length > 0) {
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

    // Priority 3: Placed Inventions (Springboard, Ramp, Catapult)
    const placedToys = world.buildingManager ? world.buildingManager.placedStructures.filter(s => s.id === 'springboard' || s.id === 'catapult' || s.id === 'ramp') : [];
    if (placedToys.length > 0 && Math.random() < 0.35) {
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

  _executeGoal(dt, world, otherCitizens) {
    const pos = this.dweeb.body.translation();
    const distToTarget = Math.hypot(this.targetPos.x - pos.x, this.targetPos.z - pos.z);

    // If resting, replenish energy and sit still
    if (this.state === CITIZEN_STATES.REST) {
      this.energy = Math.min(100, this.energy + dt * 15);
      this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
      return;
    }

    // If reached target
    if (distToTarget <= this.arrivalDist) {
      if (this.state === CITIZEN_STATES.FORAGE) {
        this.hunger = Math.max(0, this.hunger - dt * 25);
        this.activityText = 'Happily munching on sweet berries';
      } else if (this.state === CITIZEN_STATES.SOCIALIZE && this.targetEntity) {
        this.social = Math.max(0, this.social - dt * 20);
        // Social knowledge diffusion! If I know Bounce and they don't, teach them
        if (this.knownVerbs.has('bounce')) {
          this.targetEntity.observePeer(this, 'bounce', dt);
        }
      } else if (this.state === CITIZEN_STATES.EXPEDITION) {
        this.curiosity = Math.max(0, this.curiosity - dt * 20);
      }
      this.dweeb.controllerInput = { moveX: 0, moveY: 0, jump: false };
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
      moveX: dirX,
      moveY: -dirZ, // Three.js forward is -Z
      jump,
    };
  }
}
