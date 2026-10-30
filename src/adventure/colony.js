// colony.js — Civilization management, dynasty lineage, knowledge totem, and off-screen events
//
// Expedition & Dynasty additions: citizen roles and a build queue (Builders work
// through queued blueprints), capped resource stores with silo overflow, and the
// vault loot that citizens bring home — gold coins, cosmetic hats, special tools.

import { Citizen, PERSONALITIES, ROLES, CITIZEN_STATES, ROLE_XP_LEVELS } from './citizen.js';
import { BLUEPRINTS, SILO_CAP_BONUS } from './building.js';

/**
 * Town tiers: Hamlet → Village → Town → Citadel.
 * Each tier is a milestone — reaching the population + structure thresholds
 * unlocks rare landmark blueprints (also findable early in ruin vault chests)
 * and expands the village boundary citizens build and patrol within.
 */
export const TOWN_TIERS = [
  { id: 'hamlet', name: 'Hamlet', minCitizens: 0, minStructures: 0, boundary: 16, unlocks: [] },
  { id: 'village', name: 'Village', minCitizens: 3, minStructures: 2, boundary: 24, unlocks: ['gazebo', 'waterwheel'] },
  { id: 'town', name: 'Town', minCitizens: 6, minStructures: 5, boundary: 32, unlocks: ['windmill', 'clockwork'] },
  { id: 'citadel', name: 'Citadel', minCitizens: 10, minStructures: 9, boundary: 44, unlocks: ['watchtower', 'fort'] },
];

/** Blueprints every hamlet starts with — the core toy-construction set. */
export const CORE_BLUEPRINTS = [
  'springboard', 'ramp', 'tent', 'firepit', 'catapult',
  'launchpad', 'ziptower', 'berrymill', 'silo', 'cannon',
  'tradepost', 'bakery', 'garden',
];

export class Colony {
  constructor() {
    this.name = 'New Dweebtopia';
    this.generation = 1;
    this.citizens = [];
    this.unlockedVerbs = new Set(['carry']); // everyone starts with basic physical carrying
    this.historyLog = [];
    this.resources = {
      wood: 12,
      berries: 20,
      stone: 8,
      gold: 0,
    };
    // Soft storage caps. Gains through addResource() clamp to these; every silo
    // placed raises them by SILO_CAP_BONUS, and overflow routes into silos.
    this.storageCap = {
      wood: 99,
      berries: 99,
      stone: 99,
      gold: 999,
    };
    this.hats = [];   // cosmetic hats won from treasure vaults
    this.tools = [];  // special tools won from treasure vaults
    this.buildQueue = []; // blueprint ids waiting for a Builder
    // Transient build claims: blueprintId -> Citizen currently working on it.
    // Prevents two Builders from hammering the same blueprint into two
    // structures (and paying the cost twice). Never serialized.
    this._buildClaims = new Map();
    this.expeditionTimer = 0;
    // Berry Harvest Festival: thrown every 3rd day at dusk when the village
    // can spare 10 berries. Everyone drops work to dance; friendships form 3x
    // as fast while it lasts. Transient — never serialized.
    this.festival = { active: false, timer: 0 };
    this.lastFestivalDay = -1;

    // Town tier (Expedition & Dynasty milestone): Hamlet → Village → Town → Citadel.
    this.tierIndex = 0;
    this.unlockedBlueprints = new Set(CORE_BLUEPRINTS);
    this.villageRadius = TOWN_TIERS[0].boundary;

    this._addLog('The dawn of New Dweebtopia. The first settlement is founded in The Meadowlands.');
  }

  _addLog(message) {
    const entry = {
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      text: message,
    };
    this.historyLog.unshift(entry);
    if (this.historyLog.length > 50) this.historyLog.pop();
  }

  addCitizen(dweeb, config = {}) {
    const citizen = new Citizen(dweeb, {
      ...config,
      knownVerbs: Array.from(this.unlockedVerbs),
    });
    this.citizens.push(citizen);
    this._addLog(`${citizen.name} joined the settlement as a ${citizen.personality.name}.`);
    return citizen;
  }

  /** Assign a citizen a role (or null to clear it). Returns false on bad role id. */
  assignRole(citizen, roleId) {
    if (!citizen || typeof citizen.assignRole !== 'function') return false;
    const ok = citizen.assignRole(roleId);
    if (ok && roleId) {
      this._addLog(`${citizen.name} is now the village ${ROLES[roleId].name} ${ROLES[roleId].icon}.`);
    }
    return ok;
  }

  /**
   * Add resources, respecting the storage cap. Overflow goes into silos
   * (first with room); whatever is left over is lost to the meadow.
   * Returns { added, overflowStored, overflowLost }.
   */
  addResource(res, n, silos = []) {
    if (n <= 0) return { added: 0, overflowStored: 0, overflowLost: 0 };
    const cap = this.storageCap[res] ?? Infinity;
    const room = Math.max(0, cap - (this.resources[res] || 0));
    const added = Math.min(n, room);
    this.resources[res] = (this.resources[res] || 0) + added;
    let overflow = n - added;
    let overflowStored = 0;
    for (const silo of silos) {
      if (overflow <= 0) break;
      if (typeof silo.deposit !== 'function') continue;
      const moved = silo.deposit(res, overflow);
      overflow -= moved;
      overflowStored += moved;
    }
    return { added, overflowStored, overflowLost: overflow };
  }

  /** Queue a blueprint for the Builders. Returns false for unknown / locked / dupe ids. */
  queueBuild(blueprintId) {
    if (!BLUEPRINTS.some(b => b.id === blueprintId)) return false;
    if (!this.isBlueprintUnlocked(blueprintId)) return false;
    if (this.buildQueue.includes(blueprintId)) return false;
    this.buildQueue.push(blueprintId);
    this._addLog(`📋 The ${blueprintId} blueprint was added to the build queue.`);
    return true;
  }

  cancelBuild(blueprintId) {
    const idx = this.buildQueue.indexOf(blueprintId);
    if (idx === -1) return false;
    this.buildQueue.splice(idx, 1);
    return true;
  }

  /** Current town tier id: 'hamlet' → 'village' → 'town' → 'citadel'. */
  get tier() {
    return TOWN_TIERS[this.tierIndex].id;
  }

  /** True when a blueprint may be queued / placed (core set, tier unlocks, vault chests). */
  isBlueprintUnlocked(blueprintId) {
    return this.unlockedBlueprints.has(blueprintId);
  }

  /**
   * Unlock a blueprint (tier milestone or a ruin-vault treasure chest).
   * Returns true when it was newly unlocked.
   */
  unlockBlueprint(blueprintId) {
    if (!blueprintId || this.unlockedBlueprints.has(blueprintId)) return false;
    this.unlockedBlueprints.add(blueprintId);
    const bp = BLUEPRINTS.find(b => b.id === blueprintId);
    this._addLog(`🔓 New blueprint unlocked: ${bp ? bp.name : blueprintId}!`);
    return true;
  }

  /**
   * Advance the town tier when the population + structure milestones are met.
   * Unlocks the tier's landmark blueprints and expands the village boundary.
   * Returns the current tier id. Safe to call every tick; logs only on change.
   */
  recalculateTier(world = null) {
    const citizens = this.citizens.length;
    const structures = world && world.buildingManager
      ? world.buildingManager.placedStructures.length
      : 0;
    while (this.tierIndex < TOWN_TIERS.length - 1) {
      const next = TOWN_TIERS[this.tierIndex + 1];
      if (citizens < next.minCitizens || structures < next.minStructures) break;
      this.tierIndex += 1;
      this.villageRadius = next.boundary;
      for (const id of next.unlocks) this.unlockBlueprint(id);
      this._addLog(
        `🏰 ${this.name} grew into a ${next.name}! ` +
        `New blueprints: ${next.unlocks.join(', ') || '—'}. Village boundary expanded to ${next.boundary}m.`
      );
    }
    return this.tier;
  }

  /** True when a point lies inside the current village boundary. */
  withinBounds(x, z) {
    return Math.hypot(x, z) <= this.villageRadius;
  }

  /**
   * Claim the next queued blueprint a Builder can actually afford, for that
   * Builder. Returns the blueprint id, or null when nothing is claimable
   * (empty queue, everything already claimed, or nothing affordable).
   * Any previous claim held by this citizen is released first.
   */
  claimBuild(citizen) {
    this.releaseBuild(citizen);
    for (const id of this.buildQueue) {
      if (this._buildClaims.has(id)) continue;
      const bp = BLUEPRINTS.find(b => b.id === id);
      if (!bp) continue;
      let affordable = true;
      for (const [res, count] of Object.entries(bp.cost || {})) {
        if ((this.resources[res] || 0) < count) { affordable = false; break; }
      }
      if (!affordable) continue;
      this._buildClaims.set(id, citizen);
      return id;
    }
    return null;
  }

  /** Release any build claim held by a citizen (interrupted, done, re-picking). */
  releaseBuild(citizen) {
    for (const [id, c] of this._buildClaims) {
      if (c === citizen) this._buildClaims.delete(id);
    }
  }

  /**
   * A Builder finished hammering: pay the cost and raise the structure.
   * Called with the world so the structure can register its physics hooks.
   * sitePos (optional) is where the Builder actually hammered — the structure
   * rises there instead of the auto-picked clearing. builder (optional)
   * releases that citizen's build claim.
   * Returns true when the build completed.
   */
  _completeBuild(blueprintId, world, sitePos = null, builder = null) {
    if (builder) this.releaseBuild(builder);
    const bp = BLUEPRINTS.find(b => b.id === blueprintId);
    if (!bp) {
      this.cancelBuild(blueprintId);
      return false;
    }
    if (!world || !world.buildingManager) {
      this._addLog(`⚠️ No building manager — the ${bp.name} could not be raised.`);
      return false;
    }
    for (const [res, count] of Object.entries(bp.cost)) {
      if ((this.resources[res] || 0) < count) {
        this._addLog(`⚠️ Not enough ${res} to build the ${bp.name} — it stays on the queue.`);
        return false;
      }
    }
    for (const [res, count] of Object.entries(bp.cost)) {
      this.resources[res] -= count;
    }
    // The structure rises where the Builder hammered (sitePos), or at the
    // auto-picked clearing when the build was triggered without a worker.
    const pos = sitePos
      ? { x: sitePos.x, y: sitePos.y, z: sitePos.z }
      : this._nextBuildSite(world);
    const structure = world.buildingManager._instantiateStructure(bp.id, pos, world);
    // Builder mastery L3: structures raised by a master builder are 25% tougher.
    if (builder && builder.roleLevel >= 3 && typeof structure.maxHp === 'number') {
      structure.maxHp = Math.round(structure.maxHp * 1.25);
      structure.hp = structure.maxHp;
    }
    if (bp.id === 'silo' && this.storageCap) {
      for (const res of ['wood', 'berries', 'stone']) {
        this.storageCap[res] = (this.storageCap[res] || 0) + SILO_CAP_BONUS;
      }
    }
    world.buildingManager.placedStructures.push(structure);
    this.cancelBuild(blueprintId);
    this._addLog(`🔨 A Builder raised the ${bp.name}!`);
    return true;
  }

  /** Where the next Builder-built structure goes: a clearing off the campfire. */
  _nextBuildSite(world) {
    const placed = world.buildingManager ? world.buildingManager.placedStructures.length : 0;
    const ang = (placed * 2.4) % (Math.PI * 2);
    const r = Math.min(8 + (placed % 3) * 3, this.villageRadius - 2);
    return { x: Math.cos(ang) * r, y: 0, z: Math.sin(ang) * r };
  }

  /** Silo structures from a world, for addResource() overflow routing. */
  _silosFrom(world) {
    if (!world || !world.buildingManager) return [];
    return world.buildingManager.placedStructures.filter(s => s.id === 'silo');
  }

  unlockVerb(verbId, discovererName = 'The Pioneer') {
    if (this.unlockedVerbs.has(verbId)) return false;
    this.unlockedVerbs.add(verbId);
    this._addLog(`✨ BREAKTHROUGH: ${discovererName} inscribed the ${verbId.toUpperCase()} verb onto the Totem of Knowledge!`);

    // Discovered verb spreads to active citizens
    for (const c of this.citizens) {
      if (Math.random() > 0.4) {
        c.learnVerb(verbId);
      }
    }
    return true;
  }

  /**
   * Send a citizen out on an expedition to a real point of interest. The haul
   * is NOT granted up front — the citizen carries a pending haul and the
   * colony collects it when they actually arrive (see Citizen._executeGoal
   * EXPEDITION). Expeditions feel earned instead of free.
   */
  launchExpedition(world) {
    if (!this.citizens.length) return;
    const actor = this.citizens[Math.floor(Math.random() * this.citizens.length)];
    // Same landmarks the curiosity-driven expeditions walk to.
    const pois = [
      { x: 0, z: -32, y: 1.2, label: 'the Ancient Ruin' },
      { x: 28, z: 5, y: 3.5, label: 'the Lookout Bluff' },
      { x: -2, z: -62, y: 2.0, label: 'the Crystal Hollow' },
      { x: 1, z: -63, y: 2.0, label: 'the Geyser Gorge' },
      { x: -17, z: -14, y: 1.5, label: 'the Old Wooden Bridge' },
      { x: -36, z: -22, y: 1.0, label: 'the Gauntlet of Springs' },
      { x: 26, z: 24, y: 1.0, label: 'the Sentry Vault Ruin' },
    ];
    const poi = pois[Math.floor(Math.random() * pois.length)];
    actor.state = CITIZEN_STATES.EXPEDITION;
    actor.targetPos.set(
      poi.x + (Math.random() - 0.5) * 4, poi.y, poi.z + (Math.random() - 0.5) * 4,
    );
    actor.stateTimer = 30;
    actor._expeditionHaul = {
      poi: poi.label,
      dest: { x: poi.x, y: poi.y, z: poi.z },
      items: { berries: 4, wood: 2, stone: 2, gold: 1 },
    };
    actor.activityText = `Heading out on an expedition to ${poi.label}! 🧭`;
    actor.say?.('Heading out on an expedition! 🧭', '🧭', 3);
    this._addLog(`🧭 ${actor.name} set out on an expedition to ${poi.label}…`);
  }

  update(dt, world) {
    // 1. Update all autonomous citizens
    for (const citizen of this.citizens) {
      citizen.update(dt, world, this.citizens, this);
    }

    // 2. Town-tier milestones: population + structures unlock blueprints & land.
    this.recalculateTier(world);

    // 3. Berry Harvest Festival: every 3rd day at dusk, when the village can
    // spare 10 berries for the feast. Lasts 60 seconds of pure mingling.
    this._updateFestival(dt, world);

    // 4. Periodic off-screen emergent civilization adventures (every ~25 seconds)
    this.expeditionTimer += dt;
    if (this.expeditionTimer >= 25) {
      this.expeditionTimer = 0;
      this._simulateEmergentEvent(world);
    }
  }

  _updateFestival(dt, world) {
    if (this.festival.active) {
      this.festival.timer -= dt;
      if (this.festival.timer <= 0) {
        this.festival.active = false;
        this._addLog('🎉 The festival winds down — full bellies, happy hearts, new best buds.');
      }
      return;
    }
    if (!world || this.citizens.length < 2) return;
    const dayCount = world.dayCount || 0;
    const tod = world.timeOfDay;
    if (dayCount % 3 === 2 && dayCount !== this.lastFestivalDay &&
        tod >= 17 && tod < 20 && this.resources.berries >= 10) {
      this.resources.berries -= 10;
      this.festival.active = true;
      this.festival.timer = 60;
      this.lastFestivalDay = dayCount;
      this._addLog('🎉 The Berry Harvest Festival begins! 10 berries for the feast — everyone dance!');
    }
  }

  _simulateEmergentEvent(world) {
    if (this.citizens.length === 0) return;
    const actor = this.citizens[Math.floor(Math.random() * this.citizens.length)];
    const silos = this._silosFrom(world);

    const events = [
      () => {
        this.addResource('berries', 5, silos);
        this._addLog(`🍓 ${actor.name} returned from the riverbank with a basket of fresh wild berries.`);
      },
      () => {
        this.addResource('wood', 3, silos);
        this._addLog(`🪵 ${actor.name} dragged a sturdy fallen timber branch back to the workshop.`);
      },
      () => {
        if (!this.unlockedVerbs.has('bounce')) {
          this._addLog(`🔍 ${actor.name} surveyed the Ancient Ruin and spotted spring mechanisms near the gate.`);
        } else {
          this._addLog(`🚀 ${actor.name} demonstrated high-altitude bouncing from the Lookout Bluff!`);
        }
      },
      () => {
        this.addResource('stone', 2, silos);
        this._addLog(`🪨 ${actor.name} unearthed strange mineral quartz near the cavern entrance.`);
      },
      () => {
        const friend = this.citizens[Math.floor(Math.random() * this.citizens.length)];
        if (friend !== actor) {
          this._addLog(`💬 ${actor.name} and ${friend.name} stayed up late by the fire discussing future expeditions.`);
        }
      },
    ];

    const pick = events[Math.floor(Math.random() * events.length)];
    pick();
  }

  passGeneration() {
    this.generation++;
    this._addLog(`📜 A new era begins! Generation ${this.generation} takes the helm of ${this.name}.`);
    // Heirs inherit knowledge and traits
    for (const c of this.citizens) {
      for (const v of this.unlockedVerbs) {
        c.learnVerb(v);
      }
    }
  }

  /** Plain-data snapshot for save files. */
  serialize() {
    return {
      name: this.name,
      generation: this.generation,
      resources: { ...this.resources },
      storageCap: { ...this.storageCap },
      unlockedVerbs: Array.from(this.unlockedVerbs),
      hats: [...this.hats],
      tools: [...this.tools],
      buildQueue: [...this.buildQueue],
      tierIndex: this.tierIndex,
      unlockedBlueprints: Array.from(this.unlockedBlueprints),
      villageRadius: this.villageRadius,
      citizens: this.citizens.map(c => ({
        name: c.name,
        personalityId: c.personality.id,
        role: c.role,
        roleXp: c.roleXp,
        roleLevel: c.roleLevel,
        hunger: c.hunger,
        energy: c.energy,
        curiosity: c.curiosity,
        social: c.social,
        knownVerbs: Array.from(c.knownVerbs),
        friends: Array.from(c.friends.entries()),
      })),
    };
  }

  /** Restore a snapshot produced by serialize(). Citizens are matched by index.
   *  Tolerates malformed entries — a corrupt save restores what it can. */
  restore(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof data.name === 'string') this.name = data.name;
    if (typeof data.generation === 'number') this.generation = data.generation;
    if (data.resources) this.resources = { ...this.resources, ...data.resources };
    // Storage caps are intentionally NOT restored from the save: every placed
    // silo re-applies SILO_CAP_BONUS through placeSaved(), so restoring the
    // saved caps on top would double-count every silo (199 instead of 149
    // after one load with one silo). Caps rebuild from the structures list.
    if (Array.isArray(data.unlockedVerbs)) this.unlockedVerbs = new Set(data.unlockedVerbs);
    if (Array.isArray(data.hats)) this.hats = [...data.hats];
    if (Array.isArray(data.tools)) this.tools = [...data.tools];
    if (Array.isArray(data.buildQueue)) this.buildQueue = [...data.buildQueue];
    if (typeof data.tierIndex === 'number') {
      this.tierIndex = Math.max(0, Math.min(TOWN_TIERS.length - 1, Math.floor(data.tierIndex)));
    }
    if (Array.isArray(data.unlockedBlueprints)) {
      this.unlockedBlueprints = new Set([...CORE_BLUEPRINTS, ...data.unlockedBlueprints.filter(id => typeof id === 'string')]);
    }
    if (typeof data.villageRadius === 'number' && data.villageRadius > 0) {
      this.villageRadius = data.villageRadius;
    }
    if (Array.isArray(data.citizens)) {
      data.citizens.forEach((saved, i) => {
        const c = this.citizens[i];
        if (!c || !saved || typeof saved !== 'object') return;
        if (saved.name) c.name = saved.name;
        if (saved.personalityId) {
          const p = PERSONALITIES.find(pp => pp.id === saved.personalityId);
          if (p) c.personality = p;
        }
        if (saved.role !== undefined) c.role = saved.role;
        if (typeof saved.roleXp === 'number') {
          c.roleXp = saved.roleXp;
          c.roleLevel = 1 + ROLE_XP_LEVELS.filter(t => t > 0 && c.roleXp >= t).length;
        } else if (typeof saved.roleLevel === 'number') {
          c.roleLevel = Math.min(3, Math.max(1, saved.roleLevel));
        }
        if (typeof saved.hunger === 'number') c.hunger = saved.hunger;
        if (typeof saved.energy === 'number') c.energy = saved.energy;
        if (typeof saved.curiosity === 'number') c.curiosity = saved.curiosity;
        if (typeof saved.social === 'number') c.social = saved.social;
        if (Array.isArray(saved.knownVerbs)) c.knownVerbs = new Set(saved.knownVerbs);
        if (Array.isArray(saved.friends)) {
          try {
            c.friends = new Map(saved.friends);
          } catch {
            // keep the citizen's existing friendships
          }
        }
      });
    }
  }
}
