// Meadowlands.js — Region 01 of the Dweebs Living Civilization & Open World
//
// A single, seamless low-poly adventure landscape featuring:
//   1. The Starter Settlement Clearing (Village Hub, Campfire, Totem of Knowledge, Resource Grooves)
//   2. The Winding Babbling River with shallow stepping stones and wooden footbridge
//   3. The Lookout Bluff overlooking the valley
//   4. The Ancient Meadowland Ruin (Handcrafted Escape-Room style puzzle gate into Hollow Mountains)
//   5. Accurate Rapier3D static trimesh physics collider for seamless traversal

import * as THREE from 'three';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';
import { CollisionGroups } from '../physics/PhysicsWorld.js';
import { ToyTown } from './ToyBuildings.js';
import { TOY_TOWN_LAYOUT } from './ObjectRegistry.js';
import { CITIZEN_STATES } from '../adventure/citizen.js';

/** Cosmetic hats a treasure vault can hold. */
export const HAT_POOL = ['🍓 Berry Beret', '👑 Tin Crown', '🎩 Top Hat', '🧢 Moss Cap', '⛑️ Acorn Helm'];
/** Special tools a treasure vault can hold. */
export const TOOL_POOL = ['🔧 Wobbly Wrench', '🔨 Plush Hammer', '✂️ Snip-Snips', '🧲 Magnet Mitt'];
/** Cap on torch PointLights so 30+ structures stay at 60 fps. */
export const MAX_TORCHLIGHTS = 12;
/** Locust swarm tuning: a short, hungry weather event with a feel-good payoff. */
export const LOCUST_TUNING = {
  durationMin: 15,
  durationMax: 20,
  driftSpeed: 2.4,
  eatPerSecond: 0.85,
  grace: 2.5,
  stuntScareRadius: 7,
  torchScareRadius: 9,
  towerScareRadius: 22,
  bonusBerries: 3,
};
/** Seasons: one every 4 days (starting in summer so new villages open in long,
 *  lazy days). Spring regrows berries 1.5x, summer tires Dweebs more slowly,
 *  autumn merchants pay +1 gold per trade, winter halves regrowth. */
export const SEASONS = ['summer', 'autumn', 'winter', 'spring'];
/** Mischief critter kinds: berry thieves, night gold-stealers, structure gnawers. */
export const CRITTER_KINDS = {
  mischief: { name: 'Mischief Critter', color: 0x475569, eye: 0xef4444, hp: 2, speed: 2.2, size: 0.7, hostile: true },
  thief: { name: 'Nocturnal Thief', color: 0x232a3a, eye: 0xffd23f, hp: 2, speed: 3.0, size: 0.6, hostile: true },
  beetle: { name: 'Gatherer Beetle', color: 0x2dd4bf, eye: 0x0f172a, hp: 1, speed: 1.6, size: 0.45, hostile: false },
  gobbler: { name: 'Shadow Gobbler', color: 0x6d28d9, eye: 0xfacc15, hp: 3, speed: 3.4, size: 0.7, hostile: true },
  gnawer: { name: 'Plank Gnawer', color: 0x92400e, eye: 0xef4444, hp: 4, speed: 1.6, size: 0.7, hostile: true },
};
export const MAX_CRITTERS = 5;
/** What the traveling merchant offers at the Trading Post (autumn: +1 gold each). */
export const TRADE_OFFERS = [
  { give: { berries: 8 }, get: { gold: 3 }, text: '8 🍓 → 3 🪙' },
  { give: { wood: 6 }, get: { gold: 2 }, text: '6 🪵 → 2 🪙' },
  { give: { stone: 5 }, get: { gold: 2 }, text: '5 🪨 → 2 🪙' },
];

import { River } from './River.js';

/** Village goat tuning: a slow, telegraphed charge that sends Dweebs flying. */
export const GOAT = {
  hp: 3,
  speed: 2.6,
  size: 0.8,
  color: 0xf3ead7,
  eye: 0x1f2937,
  spawnInterval: 50,
  maxGoats: 1,
  targetRange: 26,
  headbuttRange: 1.4,
  lungeReach: 1.4,      // extra reach the lunge covers if the Dweeb backs off during the windup
  windupTime: 0.5,
  headbuttTime: 0.22,
  fleeTime: 4.5,
  lungeSpeedMult: 3.4,
  fleeSpeedMult: 2.2,
  launchSpeed: 14,
  launchUp: 6.2,
  hitDamage: 8,
  hitBase: 13,
  hitGrowth: 3.5,
};

export class Meadowlands {
  constructor(physicsWorld, scene, options = {}) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.colliders = [];
    this.interactiveObjects = [];
    this.berryBushes = [];
    this.springPads = [];
    this.pressurePlates = [];
    this.gateState = { isOpen: false, progress: 0, targetY: 5.5, currentY: 0 };
    this.gateMesh = null;
    this.gateBody = null;

    this.campfireLight = null;
    this.steamVents = [];
    this.crystals = [];
    this.waterwheel = null;
    this.elevator = null;
    this.clock = 0;

    // ── Expedition & Dynasty: day/night, ruins, critters, torchlight ──
    this.trees = [];          // exposed tree coordinates for lumber gathering
    this.rockNodes = [];      // exposed stone/rock coordinates for mining
    this.ziplines = [];       // registered by watchtower structures
    this.looseProps = [];     // { body } physics props launchpads can fling
    this.stuntFeed = [];      // recent physics stunts citizens react to
    this.haulProps = [];      // pooled visual berry/log/stone props dropped by haulers
    this.supplyPiles = [];    // village stockpile triggers near the fire and silos
    this.maxHaulProps = 20;   // hard cap on live dropped prop meshes
    this._haulGeos = {};
    this._haulMats = {};
    this.torchlights = [];    // PointLights around constructed buildings
    this.ruins = [];          // treasure-vault ruin sites (3-plate puzzles)
    this.critters = [];       // invading mischief critters
    this.critterTimer = 30;   // seconds until the first critter wanders in
    this.goatTimer = GOAT.spawnInterval; // a village goat eventually wanders in
    this.timeOfDay = 8;       // 0-24, starts at a bright morning
    this.dayLength = 240;     // seconds per full day
    this.dayCount = 0;        // full days elapsed (drives seasons + moon)
    this._lastSeason = 'summer';
    this.lightLevel = 1;      // 0 (midnight) .. 1 (noon)
    this.isNight = false;
    // ── Trade routes: a traveling merchant visits when a Trading Post stands.
    this.merchant = null;     // { x, z, state, mesh, ... } or null
    this.merchantTimer = 80 + Math.random() * 40;
    this.tradeCount = 0;
    // ── Weather: clear | rain | fog | wind. Rain triples berry regrowth and
    // hurries critters (1.5x); fog banks roll in (thicker at night) and make
    // torches the village lifeline; wind spins windmill blades 2x (2x gather).
    this.weather = 'clear';
    this.weatherTimer = 50 + Math.random() * 40;
    this.rainDrops = null;    // rain particle cloud, visible only while raining
    this._baseFog = undefined; // scene fog captured lazily before a fog event
    this.dayLight = null;     // directional sun/moon owned by this world
    this.fireflies = null;    // night firefly point cloud
    this.fx = options.fx || null;
    this.toyTown = null;      // handcrafted six-building toy district

    // ── Expedition & Dynasty upgrade: weather & wildlife ──
    this.locustSwarm = null;  // recycled locust point cloud over the berry fields
    this.locust = null;       // active swarm state while weather === 'locusts'
    this.beetleTimer = 20;    // seconds until the first friendly beetle wanders in

    this._buildWorld();
    // Three visible village stockpiles around the campfire. Foragers deliver
    // berries here (or to a pile beside the nearest silo when one exists).
    this._createSupplyPile(3.2, 2.2, 'berries');
    this._createSupplyPile(4.4, 1.0, 'wood');
    this._createSupplyPile(2.0, 3.4, 'stone');
    this.river = new River(this);
    this._createToyTown();
  }

  /** The handcrafted six-building toy district around the village. */
  _createToyTown() {
    if (!this.physicsWorld) return; // headless tests run without a physics world
    this.toyTown = new ToyTown(this.physicsWorld, this.scene, {
      layout: TOY_TOWN_LAYOUT,
      groundAt: (x, z) => this._getHeight(x, z),
      fx: this.fx,
    });
  }

  setFx(fx) {
    this.fx = fx;
    if (this.toyTown) {
      this.toyTown.fx = fx;
      for (const s of this.toyTown.structures) s.fx = fx;
    }
  }

  /** Current season: one of SEASONS, changing every 4 days. */
  get season() {
    return SEASONS[Math.floor(this.dayCount / 4) % 4];
  }

  /** Moon phase 0-7 (0 = new, 4 = full). Full moon boosts vault loot 50%;
   *  new moon makes critters wander in twice as often. */
  get moonPhase() {
    return this.dayCount % 8;
  }

  // ─── 1. Terrain Generation (Low-Poly Heightfield + Trimesh) ───

  _buildWorld() {
    this._createTerrain();
    this._createRiver();
    this._createSettlementHub();
    this._createAncientRuin();
    this._createHollowMountains();
    this._createFloraAndLandmarks();
    this._createResourceNodes();
    this._createToyRuins();
    this._createDayNight();
    this._createRainDrops();
    this._createLocustSwarm();
  }

  /** A cheap rain shower: one recycled Points cloud of falling drops. */
  _createRainDrops() {
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 25;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9ecfff, size: 0.18, transparent: true, opacity: 0.55 });
    this.rainDrops = new THREE.Points(geo, mat);
    this.rainDrops.visible = false;
    this.rainDrops.frustumCulled = false;
    this.group.add(this.rainDrops);
  }

  /** A hungry locust swarm: one recycled Points cloud that drifts bush to bush. */
  _createLocustSwarm() {
    const count = 220;
    const positions = new Float32Array(count * 3);
    this._locustBaseY = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 4.5;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.random() * 3.2;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      this._locustBaseY[i] = positions[i * 3 + 1];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xb7d43a, size: 0.28, transparent: true, opacity: 0.9,
      depthWrite: false,
    });
    this.locustSwarm = new THREE.Points(geo, mat);
    this.locustSwarm.visible = false;
    this.locustSwarm.frustumCulled = false;
    this.group.add(this.locustSwarm);
  }

  /**
   * Unified weather state machine: clear breaks into rain, fog, wind or locusts,
   * then clears. Rain triples berry growth and hurries critters; locusts devour
   * ripe bushes; fog banks roll in (thicker at night) and make torchlight the
   * village's lifeline; wind spins windmill blades twice as fast. Wired into the
   * day/night cycle.
   */
  _updateWeather(dt, colony) {
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) this._rollWeather(colony);
    if (this.weather === 'rain' && this.rainDrops) {
      const pos = this.rainDrops.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 28;
        if (y < 0) y = 22 + Math.random() * 3;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    if (this.weather === 'locusts') this._updateLocusts(dt, colony);
  }

  _rollWeather(colony) {
    const was = this.weather;
    if (was === 'rain' || was === 'fog' || was === 'wind' || was === 'locusts') {
      this._endWeather();
      this.weather = 'clear';
      this.weatherTimer = 50 + Math.random() * 60;
      if (was === 'locusts') {
        colony?._addLog('🦗 The locust swarm buzzes off over the hills, leaving the meadow in peace.');
      } else {
        colony?._addLog('☀️ The skies clear over New Dweebtopia.');
      }
      return;
    }
    // Clear skies: roll the next event. Fog creeps in more often at night;
    // locusts are a daytime menace.
    const r = Math.random();
    const fogChance = this.isNight ? 0.3 : 0.15;
    const locustChance = this.isNight ? 0.04 : 0.12;
    if (r < 0.35) this._startRain(colony);
    else if (r < 0.35 + fogChance) this._startFog(colony);
    else if (r < 0.35 + fogChance + locustChance) this._startLocusts(colony);
    else this._startWind(colony);
  }

  /** A rain shower rolls in: faster berry growth while it lasts. */
  _startRain(colony) {
    this.weather = 'rain';
    this.weatherTimer = 18 + Math.random() * 17;
    if (this.rainDrops) this.rainDrops.visible = true;
    colony?._addLog('🌧️ A rain shower passes over the meadow — the berry bushes drink deep!');
  }

  /** A fog bank rolls in: torches become the village's lifeline. */
  _startFog(colony) {
    this.weather = 'fog';
    this.weatherTimer = 15 + Math.random() * 15;
    if (this._baseFog === undefined) this._baseFog = this.scene ? this.scene.fog : null;
    if (this.scene) this.scene.fog = new THREE.Fog(0x9fb0c3, 8, 40);
    colony?._addLog('🌫️ Fog rolls in — the village torches are the only light to trust!');
  }

  /** A locust swarm descends on the berry fields and starts chewing. */
  _startLocusts(colony) {
    this.weather = 'locusts';
    this.weatherTimer = LOCUST_TUNING.durationMin +
      Math.random() * (LOCUST_TUNING.durationMax - LOCUST_TUNING.durationMin);
    const target = this._pickLocustBush(0, 0);
    const x = target ? target.x : 0;
    const z = target ? target.z : 0;
    this.locust = {
      x, z, target, colony,
      biteAccum: 0,
      grace: LOCUST_TUNING.grace,
    };
    if (this.rainDrops) this.rainDrops.visible = false;
    if (this.locustSwarm) {
      this.locustSwarm.visible = true;
      this.locustSwarm.position.set(x, this._getHeight(x, z) + 3.2, z);
    }
    this.fx?.audio?.playWhoosh?.(0, 0.9);
    this.fx?.cam?.shake?.(0.28);
    colony?._addLog('🦗 A locust swarm descends! It is chewing through the ripe berry bushes!');
  }

  /** A brisk wind picks up: windmill blades spin twice as fast (2x gather). */
  _startWind(colony) {
    this.weather = 'wind';
    this.weatherTimer = 35 + Math.random() * 30;
    colony?._addLog('💨 A brisk wind picks up — windmill blades spin twice as fast!');
  }

  _endWeather() {
    if (this.rainDrops) this.rainDrops.visible = false;
    if (this.locustSwarm) this.locustSwarm.visible = false;
    this.locust = null;
    if (this.scene && this._baseFog !== undefined) this.scene.fog = this._baseFog;
  }

  /** Nearest berry bush that still has ripe berries for the swarm to chew. */
  _pickLocustBush(fromX = 0, fromZ = 0) {
    let best = null;
    let bestDist = Infinity;
    for (const bush of this.berryBushes) {
      if (!bush || bush.available <= 0) continue;
      const d = Math.hypot(bush.x - fromX, bush.z - fromZ);
      if (d < bestDist) {
        bestDist = d;
        best = bush;
      }
    }
    return best;
  }

  /** True when a watchtower stands within r meters of (x, z). */
  _towerNear(x, z, r) {
    const structures = this.buildingManager?.placedStructures;
    if (!Array.isArray(structures)) return false;
    for (const s of structures) {
      if (!s || s.id !== 'ziptower' || !s.pos) continue;
      if (Math.hypot(s.pos.x - x, s.pos.z - z) < r) return true;
    }
    return false;
  }

  /** Torch/watchtower coverage or a nearby stunt scatters the swarm. */
  _scareLocusts(colony, reason = 'stunt') {
    const swarm = this.locust;
    if (this.weather !== 'locusts' || !swarm) return false;
    const col = colony || swarm.colony || null;
    const pos = { x: swarm.x, y: this._getHeight(swarm.x, swarm.z) + 1.5, z: swarm.z };
    const silos = this.buildingManager
      ? this.buildingManager.placedStructures.filter(s => s.id === 'silo')
      : [];
    if (col) {
      if (typeof col.addResource === 'function') {
        col.addResource('berries', LOCUST_TUNING.bonusBerries, silos);
      } else if (col.resources) {
        col.resources.berries = (col.resources.berries || 0) + LOCUST_TUNING.bonusBerries;
      }
    }
    const lines = {
      torch: '🔥 Torchlight drives the swarm away!',
      tower: '🗼 The watchtower spots the swarm and scares it off!',
      stunt: '🤸 A wild stunt sends the swarm scattering!',
    };
    col?._addLog(`🦗💨 ${lines[reason] || lines.stunt} The bushes are saved — +${LOCUST_TUNING.bonusBerries} 🍓 bonus!`);
    this.fx?.hud?.popup?.('SCATTER!', pos, 'big', 0xb7d43a);
    this.fx?.cam?.shake?.(0.35);
    this.fx?.audio?.playCheer?.(0.7);
    this._endWeather();
    this.weather = 'clear';
    this.weatherTimer = 50 + Math.random() * 50;
    return true;
  }

  /** Drift the swarm to a ripe bush, chew a fraction of its berries per second,
   *  and let coverage scare it away. */
  _updateLocusts(dt, colony) {
    const swarm = this.locust;
    if (!swarm) return;
    swarm.grace = Math.max(0, swarm.grace - dt);
    if (swarm.target && swarm.target.available <= 0) swarm.target = null;
    if (!swarm.target) swarm.target = this._pickLocustBush(swarm.x, swarm.z);

    if (swarm.target) {
      const dx = swarm.target.x - swarm.x;
      const dz = swarm.target.z - swarm.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.2) {
        swarm.x += (dx / dist) * LOCUST_TUNING.driftSpeed * dt;
        swarm.z += (dz / dist) * LOCUST_TUNING.driftSpeed * dt;
      } else {
        swarm.biteAccum += dt * LOCUST_TUNING.eatPerSecond;
        while (swarm.biteAccum >= 1 && swarm.target && swarm.target.available > 0) {
          swarm.biteAccum -= 1;
          const bush = swarm.target;
          const idx = bush.available - 1;
          bush.available -= 1;
          bush.regenTimer = 0;
          if (bush.berries && bush.berries[idx]) bush.berries[idx].visible = false;
          if (bush.available <= 0) {
            colony?._addLog('🦗 The locust swarm strips a berry bush bare!');
            swarm.target = null;
            break;
          }
        }
      }
    }

    if (this.locustSwarm) {
      this.locustSwarm.position.set(
        swarm.x,
        this._getHeight(swarm.x, swarm.z) + 3.2 + Math.sin(this.clock * 2) * 0.25,
        swarm.z
      );
      const pos = this.locustSwarm.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, this._locustBaseY[i] + Math.sin(this.clock * 9 + i * 1.7) * 0.22);
      }
      pos.needsUpdate = true;
      this.locustSwarm.rotation.y += dt * 0.5;
    }

    if (swarm.grace <= 0) {
      if (this._towerNear(swarm.x, swarm.z, LOCUST_TUNING.towerScareRadius)) {
        this._scareLocusts(colony, 'tower');
      } else if (this._torchNear(swarm.x, swarm.z, LOCUST_TUNING.torchScareRadius)) {
        this._scareLocusts(colony, 'torch');
      }
    }
  }

  /** True when a lit village torch stands within r meters of (x, z). */
  _torchNear(x, z, r) {
    for (const t of this.torchlights) {
      if (Math.hypot(t.x - x, t.z - z) < r) return true;
    }
    return false;
  }

  _getHeight(x, z) {
    // Distance from center settlement
    const distCenter = Math.hypot(x, z);

    // North Mountain Ridge (Ruin area at z < -35)
    let h = 0;
    if (z < -30) {
      const mz = -30 - z;
      h += Math.min(mz * 0.35 + Math.sin(x * 0.15) * 1.5, 12);
      // Carve a notch for the ruin entrance at x around 0
      if (Math.abs(x) < 8) {
        h = Math.min(h, 1.2 + (z < -50 ? ((-50 - z) * 0.4) : 0));
      }
    }

    // Lookout Bluff at East (x > 30, z between -10 and 20)
    if (x > 25 && z > -15 && z < 25) {
      const bx = (x - 25);
      const bz = 1 - Math.abs(z - 5) / 20;
      if (bz > 0) {
        h += Math.max(0, Math.min(bx * 0.28 * bz, 5.5));
      }
    }

    // River Gorge: curves from (x: -45, z: -40) down through (x: -10, z: 5) to (x: 35, z: 45)
    const riverCurveX = -10 + (z * 0.6) + Math.sin(z * 0.08) * 8;
    const distRiver = Math.abs(x - riverCurveX);
    if (distRiver < 7) {
      const riverDepth = (1 - (distRiver / 7)) * 1.4;
      h -= riverDepth;
    }

    // Gentle rolling meadows across the rest
    const rolling = Math.sin(x * 0.06) * Math.cos(z * 0.06) * 0.8 +
                    Math.sin(x * 0.12 + 1.2) * Math.cos(z * 0.1 + 0.5) * 0.4;
    h += rolling;

    // Flatten village center (radius 18)
    if (distCenter < 18) {
      const blend = Math.max(0, (distCenter - 8) / 10);
      h = h * blend;
    }

    return Math.max(h, -1.8);
  }

  _createTerrain() {
    const size = 130;
    const segs = 64; // nice low-poly faceted density
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const cGrass = new THREE.Color(0x5ee06a);
    const cGrassDark = new THREE.Color(0x42b852);
    const cDirt = new THREE.Color(0xdfaf78);
    const cRock = new THREE.Color(0x8293a4);
    const cMountain = new THREE.Color(0x606e7e);

    const vColor = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this._getHeight(x, z);
      pos.setY(i, y);

      // Vertex color blending based on elevation, slope and river
      const distCenter = Math.hypot(x, z);
      const riverCurveX = -10 + (z * 0.6) + Math.sin(z * 0.08) * 8;
      const distRiver = Math.abs(x - riverCurveX);

      if (distRiver < 4.5) {
        vColor.copy(cDirt).lerp(cRock, 0.2);
      } else if (y > 4.5) {
        vColor.copy(cRock).lerp(cMountain, Math.min(1, (y - 4.5) / 5));
      } else if (distCenter < 12) {
        // Soft worn dirt paths in village center
        const pathNoise = Math.sin(x * 0.4) * Math.cos(z * 0.4);
        vColor.copy(cGrass).lerp(cDirt, pathNoise > 0 ? 0.35 : 0.08);
      } else {
        const patchy = (Math.sin(x * 0.2) + Math.cos(z * 0.2)) * 0.5;
        vColor.copy(cGrass).lerp(cGrassDark, patchy > 0 ? 0.4 : 0);
      }

      colors[i * 3 + 0] = vColor.r;
      colors[i * 3 + 1] = vColor.g;
      colors[i * 3 + 2] = vColor.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = toonMat({
      vertexColors: true,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    this.terrainMesh = mesh;

    // Create Rapier static Trimesh Collider
    if (this.physicsWorld && this.physicsWorld.createFixedTrimesh) {
      const vertices = new Float32Array(pos.array);
      const indices = new Uint32Array(geo.index.array);
      const { id, body, collider } = this.physicsWorld.createFixedTrimesh(0, 0, 0, vertices, indices, 'stone');
      this.colliders.push({ id, body, collider });
    }
  }

  // ─── 2. The Living River ───

  _createRiver() {
    // Low-poly water surface along the river trench
    const waterGeo = new THREE.PlaneGeometry(130, 130, 24, 24);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.82,
      roughness: 0.1,
      metalness: 0.2,
      flatShading: true,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = -0.45;
    this.group.add(waterMesh);
    noOutline(waterMesh);

    // Stepping stones across the river at z = 2
    const stones = [
      { x: -11.5, z: 2, r: 1.1, h: 0.6 },
      { x: -9.5, z: 2.3, r: 1.3, h: 0.65 },
      { x: -7.5, z: 1.8, r: 1.0, h: 0.6 },
    ];
    for (const s of stones) {
      const sGeo = new THREE.CylinderGeometry(s.r, s.r * 1.15, s.h, 7);
      const sMat = toonMat({ color: 0x94a3b8, flatShading: true });
      const sm = new THREE.Mesh(sGeo, sMat);
      sm.position.set(s.x, s.h / 2 - 0.2, s.z);
      this.group.add(sm);
      if (this.physicsWorld) {
        this.physicsWorld.createFixedCylinder(s.x, sm.position.y, s.z, s.r, s.h / 2, 'stone');
      }
    }

    // Wooden Footbridge at z = -14
    this._createWoodenBridge(-17, -14, 8);
  }

  _createWoodenBridge(startX, z, length) {
    const plankMat = toonMat({ color: 0xb45309, flatShading: true });
    const count = 10;
    const step = length / count;
    for (let i = 0; i < count; i++) {
      const bx = startX + i * step;
      const bGeo = new THREE.BoxGeometry(0.7, 0.18, 2.2);
      const bMesh = new THREE.Mesh(bGeo, plankMat);
      const by = 0.2 + Math.sin((i / (count - 1)) * Math.PI) * 0.35;
      bMesh.position.set(bx, by, z);
      bMesh.rotation.y = (Math.random() - 0.5) * 0.08;
      this.group.add(bMesh);

      if (this.physicsWorld) {
        this.physicsWorld.createStaticBox(bx, by, z, 0.35, 0.09, 1.1, 'wood');
      }
    }
  }

  // ─── 3. The Starting Settlement Hub ("New Dweebtopia") ───

  _createSettlementHub() {
    const hub = new THREE.Group();
    hub.position.set(0, 0, 0);

    // Communal Campfire Center
    const fireBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.8, 0.25, 8),
      toonMat({ color: 0x475569, flatShading: true })
    );
    fireBase.position.y = 0.1;
    hub.add(fireBase);
    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(0, 0.1, 0, 1.6, 0.12, 'stone');
    }

    // Logs arranged in a teepee
    const logMat = toonMat({ color: 0x78350f, flatShading: true });
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.4, 6), logMat);
      log.position.set(Math.cos(angle) * 0.4, 0.6, Math.sin(angle) * 0.4);
      log.rotation.z = Math.cos(angle) * 0.35;
      log.rotation.x = Math.sin(angle) * 0.35;
      hub.add(log);
    }

    // Campfire Embers & Warm Light
    const embers = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff7700 })
    );
    embers.position.set(0, 0.35, 0);
    hub.add(embers);
    noOutline(embers);

    const fireLight = new THREE.PointLight(0xff9922, 2.8, 12);
    fireLight.position.set(0, 1.2, 0);
    hub.add(fireLight);
    this.campfireLight = fireLight;

    // Totem of Knowledge & Dynasty Inscription Rock
    const totem = this._createKnowledgeTotem(4.5, 0, -3);
    hub.add(totem);

    // Initial Dweeb Huts
    this._createDweebHut(-6, 0, -5, PALETTE.yellow, 0.3);
    this._createDweebHut(7, 0, 4, PALETTE.teal, -0.6);
    this._createDweebHut(-5, 0, 6, PALETTE.purple, 1.2);

    this.group.add(hub);
  }

  _createKnowledgeTotem(x, y, z) {
    const totemGroup = new THREE.Group();
    totemGroup.position.set(x, y, z);

    // Tiered carved stone pillars
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.8, 1.6),
      toonMat({ color: 0x64748b, flatShading: true })
    );
    base.position.y = 0.4;
    totemGroup.add(base);

    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 2.4, 1.1),
      toonMat({ color: 0x94a3b8, flatShading: true })
    );
    pillar.position.y = 2.0;
    totemGroup.add(pillar);

    // Floating Glyphic Orb (glows as civilization unlocks new verbs)
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 1),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.6,
        flatShading: true,
      })
    );
    orb.position.y = 3.6;
    totemGroup.add(orb);
    noOutline(orb);
    this.totemOrb = orb;

    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(x, y + 1.6, z, 0.8, 1.6, 0.8, 'stone');
    }

    return totemGroup;
  }

  _createDweebHut(x, y, z, roofColor, rotY = 0) {
    const hut = new THREE.Group();
    hut.position.set(x, y, z);
    hut.rotation.y = rotY;

    // Wooden round walls
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 2.0, 1.8, 9, 1, true),
      toonMat({ color: 0xca8a04, flatShading: true })
    );
    wall.position.y = 0.9;
    hut.add(wall);

    // Conical Thatch / Cloth Roof
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 1.8, 9),
      toonMat({ color: roofColor, flatShading: true })
    );
    roof.position.y = 2.7;
    hut.add(roof);

    // Entrance opening frame
    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.2, 0.4),
      toonMat({ color: 0x451a03, flatShading: true })
    );
    doorFrame.position.set(0, 0.6, 1.8);
    hut.add(doorFrame);

    this.group.add(hut);

    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(x, y + 1.2, z, 1.9, 1.2, 'wood');
    }
  }

  // ─── 4. The Ancient Meadowland Ruin (Escape-Room Puzzle Landmark) ───

  _createAncientRuin() {
    const ruinX = 0;
    const ruinZ = -44;
    const ruinY = 1.0;

    const ruin = new THREE.Group();
    ruin.position.set(ruinX, ruinY, ruinZ);

    const stoneMat = toonMat({ color: 0x475569, flatShading: true });
    const runeMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 0.8,
      flatShading: true,
    });

    // Colossal Entrance Pillars (Flanking the Mountain Gate)
    const pillarL = new THREE.Mesh(new THREE.BoxGeometry(2.2, 8, 2.2), stoneMat);
    pillarL.position.set(-6, 4, 0);
    ruin.add(pillarL);

    const pillarR = new THREE.Mesh(new THREE.BoxGeometry(2.2, 8, 2.2), stoneMat);
    pillarR.position.set(6, 4, 0);
    ruin.add(pillarR);

    // Massive Stone Lintel Arch
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(15, 2.2, 3), stoneMat);
    lintel.position.set(0, 8.5, 0);
    ruin.add(lintel);

    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(ruinX - 6, ruinY + 4, ruinZ, 1.1, 4, 1.1, 'stone');
      this.physicsWorld.createStaticBox(ruinX + 6, ruinY + 4, ruinZ, 1.1, 4, 1.1, 'stone');
      this.physicsWorld.createStaticBox(ruinX, ruinY + 8.5, ruinZ, 7.5, 1.1, 1.5, 'stone');
    }

    // The Massive Mountain Gate (Rises when puzzle is completed)
    const gateGeo = new THREE.BoxGeometry(9.6, 7.0, 0.6);
    const gateMesh = new THREE.Mesh(gateGeo, toonMat({ color: 0x334155, flatShading: true }));
    gateMesh.position.set(0, 3.5, 0);
    ruin.add(gateMesh);
    this.gateMesh = gateMesh;

    if (this.physicsWorld) {
      // Kinematic gate body so it can be smoothly animated upward upon puzzle unlock
      this.gateBody = this.physicsWorld.createKinematicShape(ruinX, ruinY + 3.5, ruinZ, 'box', {
        hx: 4.8, hy: 3.5, hz: 0.3
      }, 0.2, 'stone');
    }

    // ── Puzzle Mechanism 1: Dual Ancient Pressure Plates ──
    const plate1 = this._createPressurePlate(ruinX - 4, ruinY + 0.1, ruinZ + 8, 'plate_west');
    const plate2 = this._createPressurePlate(ruinX + 4, ruinY + 0.1, ruinZ + 8, 'plate_east');
    this.pressurePlates.push(plate1, plate2);

    // ── Puzzle Mechanism 2: The Ancient Elastic Bounce Altar (Teaches the Bounce Verb!) ──
    const springPad = this._createBounceAltar(ruinX, ruinY + 0.2, ruinZ + 12);
    this.springPads.push(springPad);

    // High Elevated Aqueduct / Overhead Ledge accessible via Bounce
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 4), stoneMat);
    ledge.position.set(0, 5.2, -2);
    ruin.add(ledge);
    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(ruinX, ruinY + 5.2, ruinZ - 2, 3, 0.4, 2, 'stone');
    }

    // Overhead Release Switch / Rune Crystal at the top ledge
    const switchCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), runeMat);
    switchCrystal.position.set(0, 6.8, -2);
    ruin.add(switchCrystal);
    noOutline(switchCrystal);
    this.switchCrystal = switchCrystal;

    this.group.add(ruin);
  }

  _createPressurePlate(x, y, z, id) {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.8, 0.2, 8),
      toonMat({ color: 0x475569, flatShading: true })
    );
    base.position.set(x, y, z);
    this.group.add(base);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.3, 0.25, 8),
      toonMat({ color: 0xf59e0b, flatShading: true })
    );
    pad.position.set(x, y + 0.15, z);
    this.group.add(pad);

    return {
      id,
      x, y, z,
      mesh: pad,
      pressed: false,
      depressAmount: 0,
    };
  }

  _createBounceAltar(x, y, z) {
    const altar = new THREE.Group();
    altar.position.set(x, y, z);

    // Ancient stone ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.8, 0.35, 6, 12),
      toonMat({ color: 0x334155, flatShading: true })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    altar.add(ring);

    // Glowing Springy Diaphragm / Mushroom Bloom
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.6, 0.4, 12),
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.5,
        flatShading: true,
      })
    );
    pad.position.y = 0.35;
    altar.add(pad);
    noOutline(pad);

    this.group.add(altar);

    return {
      x, y, z,
      radius: 1.8,
      boostVelocity: 19.5, // strong launch upward to reach the high aqueduct!
      mesh: pad,
      rebound: 0,
    };
  }

  // ─── Region 02: The Hollow Mountains Pass ───

  _createHollowMountains() {
    const gorge = new THREE.Group();
    this.group.add(gorge);

    // 1. Exposed Glowing Crystal Clusters along the canyon walls
    const crystalConfigs = [
      { x: -7.5, y: 1.8, z: -56, color: 0xa855f7, count: 6 }, // Amethyst cluster
      { x: 7.2, y: 2.2, z: -63, color: 0x06b6d4, count: 5 },  // Cyan Quartz cluster
      { x: -8.0, y: 2.5, z: -71, color: 0xa855f7, count: 7 },
      { x: 6.8, y: 1.6, z: -78, color: 0x38bdf8, count: 6 },
    ];

    for (const cfg of crystalConfigs) {
      const cluster = this._createCrystalCluster(cfg.x, cfg.y, cfg.z, cfg.color, cfg.count);
      gorge.add(cluster);
    }

    // 2. Geothermal Steam Vents (Updraft Physics Lifts)
    const ventConfigs = [
      { x: -2.0, z: -58, radius: 1.8, boost: 14.5 },
      { x: 3.2, z: -68, radius: 2.0, boost: 16.0 },
    ];

    for (const v of ventConfigs) {
      const vent = this._createSteamVent(v.x, this._getHeight(v.x, v.z), v.z, v.radius, v.boost);
      gorge.add(vent.group);
      this.steamVents.push(vent);
    }

    // 3. Ancient Waterwheel Elevator
    this._createWaterwheelElevator(gorge);
  }

  _createCrystalCluster(x, y, z, color, count) {
    const cluster = new THREE.Group();
    cluster.position.set(x, y, z);

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.75,
      roughness: 0.2,
      metalness: 0.1,
      flatShading: true,
    });

    for (let i = 0; i < count; i++) {
      const h = 0.8 + Math.random() * 1.2;
      const geo = new THREE.ConeGeometry(0.25 + Math.random() * 0.15, h, 5);
      const crystal = new THREE.Mesh(geo, mat);
      const angle = (i / count) * Math.PI * 2;
      crystal.position.set(Math.cos(angle) * 0.5, h * 0.4, Math.sin(angle) * 0.5);
      crystal.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * Math.PI, (Math.random() - 0.5) * 0.6);
      cluster.add(crystal);
      noOutline(crystal);
    }

    const light = new THREE.PointLight(color, 1.8, 8);
    light.position.set(0, 0.8, 0);
    cluster.add(light);

    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(x, y + 0.6, z, 0.8, 0.6, 'stone');
    }

    this.crystals.push(cluster);
    return cluster;
  }

  _createSteamVent(x, y, z, radius, boost) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    // Stone caldera ring
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.8, 0.3, 6, 10),
      toonMat({ color: 0x334155, flatShading: true })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.15;
    group.add(rim);

    // Glowing geothermal vent core
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.75, 8),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 })
    );
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.2;
    group.add(core);
    noOutline(core);

    // Steam puffs
    const steamPuffs = [];
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.5 + i * 0.15, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 - i * 0.08 })
      );
      puff.position.set(0, 0.8 + i * 1.2, 0);
      group.add(puff);
      noOutline(puff);
      steamPuffs.push(puff);
    }

    return {
      x, y, z,
      radius,
      boost,
      group,
      steamPuffs,
    };
  }

  _createWaterwheelElevator(gorge) {
    const wheelX = -6.0;
    const wheelY = 3.2;
    const wheelZ = -80.0;

    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(wheelX, wheelY, wheelZ);

    const woodMat = toonMat({ color: 0x78350f, flatShading: true });

    // Wheel axle & hub
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 8), woodMat);
    hub.rotation.x = Math.PI / 2;
    wheelGroup.add(hub);

    // 8 paddle blades
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.8), woodMat);
      spoke.position.set(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 0);
      spoke.rotation.z = angle;
      wheelGroup.add(spoke);
    }

    gorge.add(wheelGroup);
    this.waterwheel = wheelGroup;

    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(wheelX, wheelY, wheelZ, 0.8, 2.4, 0.8, 'wood');
    }

    // Moving Stone Elevator Platform at center gorge (x = 0, z = -80)
    const platGeo = new THREE.BoxGeometry(3.6, 0.4, 3.6);
    const platMesh = new THREE.Mesh(platGeo, toonMat({ color: 0x475569, flatShading: true }));
    platMesh.position.set(0, 1.0, -80);
    gorge.add(platMesh);

    let elevatorBody = null;
    if (this.physicsWorld) {
      elevatorBody = this.physicsWorld.createKinematicShape(0, 1.0, -80, 'box', {
        hx: 1.8, hy: 0.2, hz: 1.8
      }, 0.2, 'stone');
    }

    this.elevator = {
      mesh: platMesh,
      body: elevatorBody,
      minY: 1.0,
      maxY: 7.2,
      curY: 1.0,
      dir: 1,
      speed: 1.8,
    };
  }

  // ─── 5. Resource Nodes (Berries, Lumber, Stone) ───

  _createResourceNodes() {
    // Berry Bushes around village perimeter (food/hunger)
    const bushPositions = [
      { x: -9, z: 2 },
      { x: 10, z: -2 },
      { x: 3, z: 12 },
      { x: -13, z: 5 },
    ];
    for (const pos of bushPositions) {
      this._createBerryBush(pos.x, this._getHeight(pos.x, pos.z), pos.z);
    }

    // Rock / Stone Nodes scattered around meadow
    const rockCoords = [
      { x: -18, z: -10, s: 1.2 },
      { x: 18, z: 12, s: 1.4 },
      { x: 15, z: -16, s: 1.3 },
      { x: -8, z: 24, s: 1.2 },
      { x: -11.5, z: 2, s: 1.0 }, // stepping stone
      { x: -9.5, z: 2.3, s: 1.1 }, // stepping stone
      { x: -7.5, z: 1.8, s: 1.0 }, // stepping stone
    ];
    this.rockNodes = [];
    for (const rc of rockCoords) {
      const y = this._getHeight(rc.x, rc.z);
      this.rockNodes.push({ x: rc.x, y, z: rc.z, s: rc.s });
      if (Math.abs(rc.z - 2) > 0.6) {
        this._createRockNode(rc.x, y, rc.z, rc.s);
      }
    }
  }

  _createRockNode(x, y, z, scale = 1) {
    const rock = new THREE.Group();
    rock.position.set(x, y, z);
    rock.scale.setScalar(scale);

    const geo = new THREE.DodecahedronGeometry(0.9, 1);
    const mat = toonMat({ color: 0x64748b, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.6;
    mesh.rotation.set(0.3, Math.PI / 4, 0.2);
    rock.add(mesh);

    this.group.add(rock);
    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(x, y + 0.6 * scale, z, 0.8 * scale, 0.6 * scale, 'stone');
    }
  }

  _createBerryBush(x, y, z) {
    const bush = new THREE.Group();
    bush.position.set(x, y, z);

    // Foliage sphere cluster
    const foliage = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.1, 1),
      toonMat({ color: 0x15803d, flatShading: true })
    );
    foliage.position.y = 0.8;
    bush.add(foliage);

    // Pluckable berries
    const berryMat = toonMat({ color: PALETTE.red, flatShading: true });
    const berries = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), berryMat);
      const theta = (i / 5) * Math.PI * 2;
      b.position.set(Math.cos(theta) * 0.9, 0.9 + (i % 2) * 0.3, Math.sin(theta) * 0.9);
      bush.add(b);
      berries.push(b);
    }

    this.group.add(bush);
    this.berryBushes.push({ x, y, z, berries, available: 5, regenTimer: 0 });

    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(x, y + 0.8, z, 1.0, 0.8, 'wood');
    }
  }

  // ─── 5b. Physical Hauling: Baskets, Supply Piles & Loose Props ───

  /** A visible village stockpile: a shallow wicker tray plus dropped props. */
  _createSupplyPile(x, z, res = 'berries') {
    const y = this._getHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 1.0, 0.12, 8),
      toonMat({ color: 0x8a5a2b, flatShading: true }),
    );
    base.position.y = 0.06;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.07, 5, 10),
      toonMat({ color: 0xb8864e, flatShading: true }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.12;
    group.add(base, rim);
    this.group.add(group);

    const pile = {
      x, y, z, res, amount: 0, mesh: group, props: [], radius: 1.8, kickCd: 0,
    };
    // colony.addResource() calls this so only banked goods leave the pile.
    pile.consume = (count) => {
      const n = Math.max(0, Math.floor(count || 0));
      pile.amount = Math.max(0, pile.amount - n);
      let left = n;
      for (const rec of pile.props) {
        if (left <= 0) break;
        if (!rec || rec.consumed || rec.knocked) continue;
        rec.consumed = true;
        rec.shrink = 8;
        rec.shrinkTotal = 8;
        left -= 1;
      }
      return n - left;
    };
    this.supplyPiles.push(pile);
    return pile;
  }

  _pileNear(x, z, res = 'berries', maxDist = 5) {
    let best = null;
    let bestD = maxDist;
    for (const pile of this.supplyPiles) {
      if (!pile || pile.res !== res) continue;
      const d = Math.hypot(pile.x - x, pile.z - z);
      if (d <= bestD) { best = pile; bestD = d; }
    }
    return best;
  }

  _ensurePileNear(x, z, res = 'berries') {
    const existing = this._pileNear(x, z, res, 5);
    if (existing) return existing;
    const r = Math.hypot(x, z) || 1;
    return this._createSupplyPile(x + (x / r) * 2.6, z + (z / r) * 2.6, res);
  }

  /** Where a hauling citizen should walk: a pile beside the nearest silo, else the fire. */
  haulTargetFor(citizen, res = 'berries') {
    const targetRes = res || 'berries';
    let pile = null;
    let cx = 0, cz = 0;
    try {
      const p = citizen?.dweeb?.body?.translation?.();
      if (p) { cx = p.x; cz = p.z; }
    } catch {
      cx = 0; cz = 0;
    }
    try {
      const silos = this.buildingManager
        ? this.buildingManager.placedStructures.filter(s => s && s.id === 'silo' && s.pos)
        : [];
      let bestSilo = null;
      let bestD = Infinity;
      for (const silo of silos) {
        const d = Math.hypot(silo.pos.x - cx, silo.pos.z - cz);
        if (d < bestD) { bestD = d; bestSilo = silo; }
      }
      if (bestSilo) pile = this._ensurePileNear(bestSilo.pos.x, bestSilo.pos.z, targetRes);
    } catch {
      pile = null;
    }
    if (!pile) {
      pile = this.supplyPiles.find(p => p && p.res === targetRes)
        || this._createSupplyPile(3.2, 2.2, targetRes);
    }
    if (!pile) return null;
    return { x: pile.x, y: pile.y, z: pile.z, pile };
  }

  _haulPropMesh(res) {
    const key = res === 'wood' ? 'wood' : res === 'stone' ? 'stone' : 'berry';
    if (!this._haulGeos[key]) {
      if (key === 'wood') {
        this._haulGeos[key] = new THREE.BoxGeometry(0.2, 0.18, 0.2);
      } else if (key === 'stone') {
        this._haulGeos[key] = new THREE.DodecahedronGeometry(0.14, 0);
      } else {
        this._haulGeos[key] = new THREE.SphereGeometry(0.11, 6, 6);
      }
    }
    if (!this._haulMats[key]) {
      const color = key === 'wood' ? 0x8a5a2b : key === 'stone' ? 0x64748b : 0xdc2626;
      this._haulMats[key] = toonMat({ color, flatShading: true });
    }
    return new THREE.Mesh(this._haulGeos[key], this._haulMats[key]);
  }

  _addPileProp(pile, res) {
    if (!pile || !pile.mesh) return null;
    // Recycle the oldest prop once the pool is full.
    while (this.haulProps.length >= this.maxHaulProps) {
      const old = this.haulProps.shift();
      this._removeHaulProp(old);
    }
    const mesh = this._haulPropMesh(res);
    pile.mesh.add(mesh);
    const ang = Math.random() * Math.PI * 2;
    const rr = Math.random() * 0.55;
    const floorY = 0.18 + Math.min(0.28, pile.props.length * 0.012);
    mesh.position.set(Math.cos(ang) * rr, 1.25 + Math.random() * 0.5, Math.sin(ang) * rr);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const rec = {
      mesh, pile, res, floorY, vy: 0.8 + Math.random() * 2,
      falling: true, knocked: false, consumed: false,
      age: 0, spillT: 0, svx: 0, svy: 0, svz: 0,
      shrink: 0, shrinkTotal: 8,
    };
    pile.props.push(rec);
    this.haulProps.push(rec);
    return rec;
  }

  _removeHaulProp(rec) {
    if (!rec) return;
    if (rec.mesh && rec.mesh.parent) rec.mesh.parent.remove(rec.mesh);
    if (rec.pile && Array.isArray(rec.pile.props)) {
      const idx = rec.pile.props.indexOf(rec);
      if (idx !== -1) rec.pile.props.splice(idx, 1);
    }
  }

  _knockPileProp(pile) {
    if (!pile || !Array.isArray(pile.props)) return false;
    for (let i = pile.props.length - 1; i >= 0; i--) {
      const rec = pile.props[i];
      if (!rec || rec.consumed || rec.knocked || !rec.mesh) continue;
      rec.knocked = true;
      rec.spillT = 0;
      rec.svx = (Math.random() - 0.5) * 3.4;
      rec.svz = (Math.random() - 0.5) * 3.4;
      rec.svy = 2 + Math.random() * 2.2;
      return true;
    }
    return false;
  }

  /** A forager arrives: prop drops visibly into a pile, then the colony banks it. */
  dropHaul(citizen) {
    if (!citizen || !citizen.carrying) return null;
    const res = citizen.carrying.res || 'berries';
    const amount = Math.max(0, Math.floor(citizen.carrying.amount || 0));
    if (amount <= 0) return { res, amount: 0, pile: null };

    let pile = null;
    try {
      const p = citizen.dweeb?.body?.translation?.();
      if (p) {
        pile = this._pileNear(p.x, p.z, res, 5) || this._ensurePileNear(p.x, p.z, res);
      }
    } catch {
      pile = null;
    }
    if (!pile) {
      pile = this.supplyPiles.find(p => p && p.res === res)
        || this._createSupplyPile(3.2, 2.2, res);
    }
    if (pile) {
      const visualCount = Math.min(amount, 6);
      for (let i = 0; i < visualCount; i++) this._addPileProp(pile, res);
      pile.amount += amount;
    }
    return { res, amount, pile };
  }

  _updateHaulProps(dt) {
    for (let i = this.haulProps.length - 1; i >= 0; i--) {
      const rec = this.haulProps[i];
      if (!rec || !rec.mesh) { this.haulProps.splice(i, 1); continue; }
      rec.age += dt;

      if (rec.falling) {
        rec.vy -= 14 * dt;
        rec.mesh.position.y += rec.vy * dt;
        if (rec.mesh.position.y <= rec.floorY) {
          rec.mesh.position.y = rec.floorY;
          rec.falling = false;
          rec.vy = 0;
        }
      }

      if (rec.knocked) {
        rec.spillT += dt;
        rec.mesh.position.x += rec.svx * dt;
        rec.mesh.position.z += rec.svz * dt;
        rec.svy -= 12 * dt;
        rec.mesh.position.y += rec.svy * dt;
        if (rec.mesh.position.y < 0.12) {
          rec.mesh.position.y = 0.12;
          rec.svy = Math.abs(rec.svy) * 0.32;
          rec.svx *= 0.7;
          rec.svz *= 0.7;
        }
        rec.mesh.rotation.x += dt * 4;
        rec.mesh.rotation.z += dt * 3;
        if (rec.spillT > 6) {
          this._removeHaulProp(rec);
          this.haulProps.splice(i, 1);
        }
        continue;
      }

      if (rec.consumed) {
        rec.shrink -= dt;
        const s = rec.shrinkTotal > 0 ? Math.max(0, rec.shrink / rec.shrinkTotal) : 0;
        rec.mesh.scale.setScalar(s);
        if (rec.shrink <= 0) {
          this._removeHaulProp(rec);
          this.haulProps.splice(i, 1);
        }
      }
    }
  }

  /** Running through a pile knocks a few loose props away (cosmetic spill). */
  _updateSupplyPiles(dt, dweebs = []) {
    for (const pile of this.supplyPiles) {
      if (pile) pile.kickCd = Math.max(0, (pile.kickCd || 0) - dt);
    }
    for (const d of dweebs) {
      if (!d || !d.body) continue;
      let p;
      try { p = d.body.translation(); } catch { continue; }
      if (!p) continue;
      for (const pile of this.supplyPiles) {
        if (!pile || !pile.props || pile.props.length === 0) continue;
        if ((pile.kickCd || 0) > 0) continue;
        if (Math.hypot(p.x - pile.x, p.z - pile.z) > pile.radius) continue;
        let v;
        try { v = d.body.linvel(); } catch { v = null; }
        if (!v || Math.hypot(v.x || 0, v.z || 0) < 2.5) continue;
        pile.kickCd = 2.5;
        this._knockPileProp(pile);
      }
    }
  }

  // ─── 6. Flora & Landscape Details ───

  _createFloraAndLandmarks() {
    // Pine & Deciduous Trees scattered naturally
    const treeCoords = [
      { x: -24, z: 18, type: 'pine', s: 1.4 },
      { x: -26, z: 5, type: 'pine', s: 1.2 },
      { x: 22, z: -20, type: 'broad', s: 1.3 },
      { x: 24, z: -10, type: 'broad', s: 1.5 },
      { x: -14, z: -28, type: 'pine', s: 1.6 },
      { x: 22, z: 22, type: 'broad', s: 1.1 },
      { x: 28, z: 18, type: 'pine', s: 1.3 },
      { x: -32, z: -15, type: 'pine', s: 1.7 },
      { x: 8, z: -25, type: 'broad', s: 1.2 },
    ];

    this.trees = [];
    for (const tc of treeCoords) {
      const y = this._getHeight(tc.x, tc.z);
      this.trees.push({ x: tc.x, y, z: tc.z, type: tc.type, s: tc.s });
      if (tc.type === 'pine') {
        this._createPineTree(tc.x, y, tc.z, tc.s);
      } else {
        this._createBroadTree(tc.x, y, tc.z, tc.s);
      }
    }
  }

  _createPineTree(x, y, z, scale = 1) {
    const tree = new THREE.Group();
    tree.position.set(x, y, z);
    tree.scale.setScalar(scale);

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.35, 1.8, 6),
      toonMat({ color: 0x582f0e, flatShading: true })
    );
    trunk.position.y = 0.9;
    tree.add(trunk);

    const foliageMat = toonMat({ color: 0x14532d, flatShading: true });
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.6 - i * 0.35, 1.6, 6),
        foliageMat
      );
      cone.position.y = 1.9 + i * 1.0;
      tree.add(cone);
    }

    this.group.add(tree);
    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(x, y + 1.5 * scale, z, 0.4 * scale, 1.5 * scale, 'wood');
    }
  }

  _createBroadTree(x, y, z, scale = 1) {
    const tree = new THREE.Group();
    tree.position.set(x, y, z);
    tree.scale.setScalar(scale);

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.45, 2.0, 7),
      toonMat({ color: 0x78350f, flatShading: true })
    );
    trunk.position.y = 1.0;
    tree.add(trunk);

    const canopy = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.9, 1),
      toonMat({ color: 0x22c55e, flatShading: true })
    );
    canopy.position.y = 2.8;
    tree.add(canopy);

    this.group.add(tree);
    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(x, y + 1.8 * scale, z, 0.45 * scale, 1.8 * scale, 'wood');
    }
  }

  // ─── Expedition & Dynasty: Day/Night, Toy Ruins, Critters ───

  _createDayNight() {
    // One directional light owned by the world: warm sun by day, cold moon by night.
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.2);
    sun.position.set(30, 50, 20);
    this.group.add(sun);
    this.dayLight = sun;

    // Fireflies: a drifting point cloud that only shows after dark.
    const count = 60;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = 0.8 + Math.random() * 2.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd9f99d, size: 0.35, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.group.add(points);
    this.fireflies = points;
  }

  /**
   * Four ancient toy ruins, each a three-chamber vault with a different trial:
   *   1. the trial itself — 'plates' (sequential pressure plates, pressed in
   *      plate order; wrong order resets), 'bounce' (the Gauntlet of Springs —
   *      bounce on the ruin's pads 6 times within earshot), or 'guard' (the
   *      Sentry Vault — a Defender standing guard nearby for 30 cumulative
   *      seconds earns the vault's respect; night watch counts double),
   *   2. a moving stone block that grinds aside,
   *   3. a locked treasure chest holding a rare blueprint.
   * The outer vault still pays gold, a hat and a tool when the trial completes.
   */
  _createToyRuins() {
    const sites = [
      { id: 'sunken', name: 'Sunken Toy Ruin', x: -20, z: 14, kind: 'plates', blueprint: 'gazebo', coins: [15, 30] },
      { id: 'bluff', name: 'Bluff Toy Ruin', x: 30, z: -6, kind: 'plates', blueprint: 'windmill', coins: [15, 30] },
      { id: 'gauntlet', name: 'Gauntlet of Springs', x: -36, z: -22, kind: 'bounce', blueprint: 'waterwheel', coins: [20, 35] },
      { id: 'sentry', name: 'Sentry Vault Ruin', x: 26, z: 24, kind: 'guard', blueprint: 'clockwork', coins: [25, 40] },
    ];
    for (const site of sites) {
      const y = this._getHeight(site.x, site.z);
      const ruin = {
        id: site.id, name: site.name, kind: site.kind, x: site.x, y, z: site.z,
        plates: [], vault: null, opened: false, progress: 0, work: 0,
        stage: 'plates', sequence: [],
        block: null, chest: null,
        loot: {
          hat: HAT_POOL[Math.floor(Math.random() * HAT_POOL.length)],
          tool: TOOL_POOL[Math.floor(Math.random() * TOOL_POOL.length)],
          coins: site.coins[0] + Math.floor(Math.random() * (site.coins[1] - site.coins[0] + 1)),
        },
      };
      if (site.kind === 'bounce') {
        // Two spring pads flanking the vault — bounce on them (or any pad
        // nearby) to work the ancient spring mechanism.
        this._createRuinBouncePad(site.x - 4, site.z + 1);
        this._createRuinBouncePad(site.x + 4, site.z - 1);
      } else if (site.kind === 'plates') {
        // Three pressure plates in a triangle around the vault (order matters).
        const offsets = [[-3, 2], [3, 2], [0, -3.5]];
        offsets.forEach(([ox, oz], i) => {
          const plate = this._createPressurePlate(site.x + ox, y + 0.1, site.z + oz, `${site.id}_plate_${i}`);
          plate.order = i;
          ruin.plates.push(plate);
        });
      }
      ruin.vault = this._createVault(site.x, y, site.z);
      // Chamber 2: a stone slab sealing the inner sanctum behind the vault.
      ruin.block = this._createStoneBlock(site.x, y, site.z - 2.5);
      // Chamber 3: the locked treasure chest with a rare blueprint.
      ruin.chest = this._createChest(site.x, y, site.z - 5, site.blueprint);
      this.ruins.push(ruin);
    }
  }

  /** A stone slab that grinds sideways once the plate sequence completes. */
  _createStoneBlock(x, y, z) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.4, 1.2),
      toonMat({ color: 0x64748b, flatShading: true })
    );
    mesh.position.set(x, y + 1.2, z);
    this.group.add(mesh);
    return { mesh, fromX: x, toX: x + 5, progress: 0 };
  }

  /** A locked treasure chest; opening it grants a rare blueprint. */
  _createChest(x, y, z, blueprint) {
    const chest = new THREE.Group();
    chest.position.set(x, y, z);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 1.0),
      toonMat({ color: 0x78350f, flatShading: true })
    );
    box.position.y = 0.4;
    chest.add(box);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.25, 1.1),
      toonMat({ color: 0xf59e0b, flatShading: true })
    );
    lid.position.y = 0.9;
    chest.add(lid);
    const glow = new THREE.PointLight(0xffd23f, 0, 7);
    glow.position.y = 1.2;
    chest.add(glow);
    this.group.add(chest);
    return { group: chest, lid, glow, blueprint, opened: false };
  }

  /** A spring pad owned by a bounce-trial ruin (bounces feed the stunt feed). */
  _createRuinBouncePad(x, z) {
    const y = this._getHeight(x, z);
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.4, 0.35, 12),
      new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.6, flatShading: true })
    );
    pad.position.set(x, y + 0.3, z);
    noOutline(pad);
    this.group.add(pad);
    this.springPads.push({ x, y, z, radius: 1.6, boostVelocity: 15, mesh: pad, rebound: 0 });
  }

  _createVault(x, y, z) {
    const vault = new THREE.Group();
    vault.position.set(x, y, z);
    const stoneMat = toonMat({ color: 0x475569, flatShading: true });
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), stoneMat);
    box.position.y = 0.8;
    vault.add(box);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.4, 2.8),
      toonMat({ color: 0xf59e0b, flatShading: true })
    );
    lid.position.y = 1.8;
    vault.add(lid);
    // The glow inside: a little treasure light, dark until opened.
    const glow = new THREE.PointLight(0xffd23f, 0, 8);
    glow.position.y = 1.6;
    vault.add(glow);
    this.group.add(vault);
    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(x, y + 0.8, z, 1.3, 0.8, 1.3, 'stone');
    }
    return { group: vault, lid, glow, x, y, z };
  }

  /** Add a torch (mesh + PointLight) near a building. Capped so 30+ structures stay fast. */
  addTorchlight(x, y, z) {
    if (this.torchlights.length >= MAX_TORCHLIGHTS) return null;
    const torch = new THREE.Group();
    torch.position.set(x, y, z);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 1.1, 5),
      toonMat({ color: 0x78350f, flatShading: true })
    );
    post.position.y = 0.55;
    torch.add(post);
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffa733 })
    );
    flame.position.y = 1.25;
    torch.add(flame);
    noOutline(flame);
    const light = new THREE.PointLight(0xff9922, 0.6, 7);
    light.position.y = 1.3;
    torch.add(light);
    this.group.add(torch);
    const entry = { group: torch, light, flame, x, y, z };
    this.torchlights.push(entry);
    return entry;
  }

  /** Push a physics stunt event for nearby citizens to react to. */
  _pushStunt(type, x, z) {
    this.stuntFeed.push({ type, x, z, at: this.clock });
    if (this.stuntFeed.length > 12) this.stuntFeed.shift();
    if (this.weather === 'locusts' && this.locust) {
      const d = Math.hypot(x - this.locust.x, z - this.locust.z);
      if (d <= LOCUST_TUNING.stuntScareRadius) this._scareLocusts(null, 'stunt');
    }
  }

  /**
   * Spawn a critter at the map edge, wandering toward the village.
   * Kinds: 'mischief' (berry-stealing pest), 'thief' (nocturnal gold thief,
   * hunted by watchtowers), 'beetle' (friendly gatherer — never targeted),
   * 'gobbler' (night gold thief, fears torchlight), 'gnawer' (slow, tough,
   * chews structures with hp), 'goat' (headbutting village pest — slow,
   * telegraphed and very bonkable).
   */
  spawnCritter(kind = 'mischief') {
    if (this.critters.length >= MAX_CRITTERS) return null;
    const def = kind === 'goat'
      ? { hp: GOAT.hp, speed: GOAT.speed, hostile: true, color: GOAT.color, eye: GOAT.eye, size: GOAT.size }
      : (CRITTER_KINDS[kind] || CRITTER_KINDS.mischief);
    const stats = def;
    const ang = Math.random() * Math.PI * 2;
    const r = 45 + Math.random() * 10;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const y = this._getHeight(x, z);
    const bodyGeo = kind === 'goat'
      ? new THREE.BoxGeometry(stats.size * 1.15, stats.size * 0.9, stats.size * 1.65)
      : new THREE.SphereGeometry(stats.size, 8, 8);
    const body = new THREE.Mesh(
      bodyGeo,
      toonMat({ color: stats.color, flatShading: true })
    );
    let goatLegs = null;
    if (kind === 'goat') {
      const s = stats.size;
      // Four stubby legs (the front pair paws the dirt during a windup).
      const legMat = toonMat({ color: 0x6b4f2a, flatShading: true });
      const legGeo = new THREE.BoxGeometry(s * 0.16, s * 0.5, s * 0.16);
      goatLegs = [];
      for (const lx of [-s * 0.34, s * 0.34]) {
        for (const lz of [-s * 0.52, s * 0.52]) {
          const leg = new THREE.Mesh(legGeo, legMat);
          leg.position.set(lx, -s * 0.58, lz);
          body.add(leg);
          if (lz > 0) goatLegs.push(leg);
        }
      }
      // A blunt muzzle, two little horns and a scruffy beard.
      const muzzle = new THREE.Mesh(
        new THREE.BoxGeometry(s * 0.42, s * 0.4, s * 0.4),
        toonMat({ color: 0xfff8ee, flatShading: true })
      );
      muzzle.position.set(0, -s * 0.08, s * 0.92);
      body.add(muzzle);
      const hornMat = toonMat({ color: 0x8b6b43, flatShading: true });
      for (const hx of [-s * 0.22, s * 0.22]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(s * 0.09, s * 0.42, 5), hornMat);
        horn.position.set(hx, s * 0.56, s * 0.58);
        horn.rotation.x = -0.5;
        body.add(horn);
      }
      const beard = new THREE.Mesh(
        new THREE.ConeGeometry(s * 0.17, s * 0.44, 5),
        toonMat({ color: 0xd9d2c4, flatShading: true })
      );
      beard.position.set(0, -s * 0.52, s * 0.78);
      beard.rotation.x = Math.PI;
      body.add(beard);
    }
    if (kind === 'beetle') {
      // A shiny shell on the friendly gatherer's back.
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(def.size * 0.85, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        toonMat({ color: 0x0d9488, flatShading: true })
      );
      shell.position.y = def.size * 0.35;
      body.add(shell);
    }
    if (kind === 'thief') {
      // A burglar's mask stripe across the eyes.
      const mask = new THREE.Mesh(
        new THREE.BoxGeometry(def.size * 1.1, def.size * 0.35, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x0b0e14 })
      );
      mask.position.set(0, def.size * 0.35, def.size * 0.8);
      body.add(mask);
    }
    const eyeMat = new THREE.MeshBasicMaterial({ color: stats.eye });
    for (const ex of [-stats.size * 0.36, stats.size * 0.36]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(stats.size * 0.17, 6, 6), eyeMat);
      eye.position.set(ex, stats.size * 0.36, stats.size * (kind === 'goat' ? 0.92 : 0.78));
      body.add(eye);
    }
    body.position.set(x, y + def.size, z);
    noOutline(body);
    this.group.add(body);
    const critter = {
      kind, x, y, z, hp: def.hp, maxHp: def.hp, speed: def.speed,
      hostile: def.hostile, mesh: body,
      hover: def.size, state: 'approach', stealTimer: 0, gatherTimer: 0,
      chewTarget: null, homeX: x, homeZ: z,
    };
    if (kind === 'goat') {
      critter.goatLegs = goatLegs;
      critter.stateTimer = 0;
      critter.goatDirX = 0;
      critter.goatDirZ = 1;
      critter.goatTarget = null;
    }
    this.critters.push(critter);
    return critter;
  }

  /** Spawn a friendly gatherer beetle (never targeted by defenders or cannons). */
  spawnBeetle() {
    return this.spawnCritter('beetle');
  }

  removeCritter(critter) {
    const idx = this.critters.indexOf(critter);
    if (idx !== -1) this.critters.splice(idx, 1);
    if (critter.mesh) this.group.remove(critter.mesh);
  }

  _updateDayNight(dt) {
    this.timeOfDay = (this.timeOfDay + (dt * 24) / this.dayLength) % 24;
    // Daylight curve: full sun 9-15, dawn/dusk ramps, night 20-5.
    const t = this.timeOfDay;
    let level;
    if (t >= 6 && t < 9) level = (t - 6) / 3;            // dawn
    else if (t >= 9 && t < 16) level = 1;                // day
    else if (t >= 16 && t < 20) level = 1 - (t - 16) / 4; // dusk
    else level = 0;                                       // night
    this.lightLevel = level;
    this.isNight = level < 0.25;
    if (this.dayLight) {
      this.dayLight.intensity = 0.15 + level * 1.1;
      this.dayLight.color.setHex(this.isNight ? 0x93c5fd : (level < 0.7 ? 0xffb066 : 0xfff2d9));
    }
    if (this.fireflies) {
      this.fireflies.material.opacity = this.isNight ? 0.9 : 0;
      if (this.isNight) {
        const pos = this.fireflies.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          pos.setY(i, 0.8 + Math.sin(this.clock * 0.7 + i * 1.3) * 1.2 + 1.2);
          pos.setX(i, pos.getX(i) + Math.sin(this.clock * 0.3 + i) * 0.002);
        }
        pos.needsUpdate = true;
      }
    }
    // Fog banks make torchlight the village's lifeline: torches burn brighter.
    const fogBoost = this.weather === 'fog' ? 1.6 : 1;
    for (const torch of this.torchlights) {
      torch.light.intensity = (this.isNight ? 1.6 : 0.4) * fogBoost;
    }
  }

  _updateBushRegrowth(dt, colony = null) {
    // Rain triples regrowth; spring hurries it 1.5x, winter halves it; locusts
    // suppress it entirely. A level-3 forager's green thumb speeds bushes
    // within 14m by another 25%.
    let growthMult = 1;
    if (this.weather === 'rain') growthMult *= 3;
    if (this.weather === 'locusts') growthMult = 0;
    if (this.season === 'spring') growthMult *= 1.5;
    else if (this.season === 'winter') growthMult *= 0.5;
    let greenThumbs = null;
    if (colony) {
      greenThumbs = colony.citizens.filter(c => c.role === 'forager' && c.roleLevel >= 3 && c.dweeb && c.dweeb.body);
    }
    for (const bush of this.berryBushes) {
      if (bush.available >= 5) continue;
      let local = growthMult;
      if (greenThumbs && greenThumbs.length > 0) {
        for (const g of greenThumbs) {
          const p = g.dweeb.body.translation();
          if (Math.hypot(p.x - bush.x, p.z - bush.z) < 14) { local *= 1.25; break; }
        }
      }
      bush.regenTimer = (bush.regenTimer || 0) + dt * local;
      if (bush.regenTimer >= 20) {
        bush.regenTimer = 0;
        bush.available = Math.min(5, bush.available + 1);
        if (bush.berries && bush.berries[bush.available - 1]) {
          bush.berries[bush.available - 1].visible = true;
        }
      }
    }
  }

  /**
   * Trade routes: when a Trading Post stands, a traveling merchant walks in
   * from the map edge, waits at the stall, trades goods for gold, and leaves.
   * Autumn sweetens every deal by +1 gold.
   */
  _updateMerchant(dt, colony = null) {
    if (!this.merchant) {
      this.merchantTimer -= dt;
      if (this.merchantTimer > 0) return;
      this.merchantTimer = 90 + Math.random() * 60;
      const posts = this.buildingManager
        ? this.buildingManager.placedStructures.filter(s => s.id === 'tradepost')
        : [];
      if (posts.length === 0) return; // no trading post, no caravan
      const post = posts[Math.floor(Math.random() * posts.length)];
      const ang = Math.random() * Math.PI * 2;
      const hx = Math.cos(ang) * 48;
      const hz = Math.sin(ang) * 48;
      const g = new THREE.Group();
      const robe = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.1, 0.6),
        toonMat({ color: 0x7c3aed, flatShading: true })
      );
      robe.position.y = 0.9;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 8, 8),
        toonMat({ color: 0xfcd9b8, flatShading: true })
      );
      head.position.y = 1.75;
      const pack = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.7, 0.3),
        toonMat({ color: 0x92400e, flatShading: true })
      );
      pack.position.set(0, 1.0, -0.45);
      g.add(robe, head, pack);
      noOutline(g);
      g.position.set(hx, this._getHeight(hx, hz), hz);
      this.group.add(g);
      this.merchant = {
        x: hx, z: hz, homeX: hx, homeZ: hz,
        postX: post.pos.x, postZ: post.pos.z,
        state: 'arrive', waitTimer: 0, mesh: g,
      };
      if (colony) colony._addLog('🐪 A traveling merchant approaches the Trading Post!');
      return;
    }
    const m = this.merchant;
    const speed = 3;
    const stepToward = (tx, tz) => {
      const dx = tx - m.x;
      const dz = tz - m.z;
      const len = Math.hypot(dx, dz) || 1;
      m.x += (dx / len) * speed * dt;
      m.z += (dz / len) * speed * dt;
      return Math.hypot(tx - m.x, tz - m.z);
    };
    if (m.state === 'arrive') {
      if (stepToward(m.postX, m.postZ) < 2) {
        m.state = 'trade';
        m.waitTimer = 30;
        const offer = TRADE_OFFERS[this.tradeCount % TRADE_OFFERS.length];
        if (colony) colony._addLog(`🐪 The merchant offers: ${offer.text}. They wait by the stall…`);
      }
    } else if (m.state === 'trade') {
      m.waitTimer -= dt;
      if (m.waitTimer <= 0) {
        const offer = TRADE_OFFERS[this.tradeCount % TRADE_OFFERS.length];
        this.tradeCount += 1;
        let dealt = false;
        if (colony) {
          const [res, n] = Object.entries(offer.give)[0];
          if ((colony.resources[res] || 0) >= n) {
            colony.resources[res] -= n;
            const bonus = this.season === 'autumn' ? 1 : 0;
            colony.addResource('gold', offer.get.gold + bonus, []);
            colony._addLog(`🤝 Deal! Traded ${n} ${res} for ${offer.get.gold + bonus} gold.`);
            dealt = true;
          }
          if (!dealt) colony._addLog('🐪 The merchant found no goods to buy and packed up.');
        }
        m.state = 'leave';
      }
    } else if (m.state === 'leave') {
      if (stepToward(m.homeX, m.homeZ) < 3) {
        this.group.remove(m.mesh);
        this.merchant = null;
      }
    }
    if (m.mesh) m.mesh.position.set(m.x, this._getHeight(m.x, m.z), m.z);
  }

  /** Midnight bookkeeping: seasons turn, the moon waxes and wanes. */
  _onNewDay(colony = null) {
    this.dayCount += 1;
    const season = this.season;
    if (season !== this._lastSeason) {
      this._lastSeason = season;
      if (colony) {
        const msg = {
          spring: '🌸 Spring arrives — berry bushes burst back to life (regrow 1.5x)!',
          summer: '☀️ Summer heat settles in — long days tire Dweebs more slowly.',
          autumn: '🍂 Autumn colors the meadow — merchants pay +1 gold for every trade.',
          winter: '❄️ Winter settles in — berries regrow half as fast. Bundle up!',
        }[season];
        colony._addLog(msg);
      }
    }
    if (colony) {
      if (this.moonPhase === 4) {
        colony._addLog('🌕 Full moon! Vault treasure glows brighter — +50% coins tonight.');
      } else if (this.moonPhase === 0) {
        colony._addLog('🌑 New moon — critters grow bold and wander in twice as often.');
      }
    }
  }

  _updateRuins(dt, dweebs, colony) {
    for (const ruin of this.ruins) {
      // ── Chamber 1: the trial — sequential plates, bounce gauntlet, or sentry guard. ──
      if (!ruin.opened) {
        if (ruin.kind === 'bounce') this._updateBounceRuin(ruin, colony);
        else if (ruin.kind === 'guard') this._updateGuardRuin(ruin, dt, colony);
        else this._updatePlateRuin(ruin, dt, dweebs, colony);
      }
      // ── Chamber 2: the stone block grinds aside, revealing the sanctum. ──
      if (ruin.stage === 'block' && ruin.block) {
        const b = ruin.block;
        b.progress = Math.min(1, b.progress + dt / 2.5);
        b.mesh.position.x = b.fromX + (b.toX - b.fromX) * b.progress;
        if (b.progress >= 1) ruin.stage = 'chest';
      }
      // ── Chamber 3: the locked chest springs open with a rare blueprint. ──
      if (ruin.stage === 'chest' && ruin.chest && !ruin.chest.opened) {
        const chest = ruin.chest;
        chest.opened = true;
        chest.lid.position.y += 0.5;
        chest.lid.rotation.x = -0.9;
        chest.glow.intensity = 2;
        if (colony) {
          if (typeof colony.unlockBlueprint === 'function') colony.unlockBlueprint(chest.blueprint);
          else if (colony.unlockedBlueprints) colony.unlockedBlueprints.add(chest.blueprint);
          colony._addLog(`🎁 The ${ruin.name} treasure chest held a rare blueprint: ${chest.blueprint}!`);
        }
        ruin.stage = 'done';
      }
    }
    // Animate opened vault lids sliding open.
    for (const ruin of this.ruins) {
      if (!ruin.opened || ruin.progress >= 1) continue;
      ruin.progress = Math.min(1, ruin.progress + dt * 0.5);
      ruin.vault.lid.position.y = 1.8 + ruin.progress * 1.6;
      ruin.vault.glow.intensity = ruin.progress * 2.5;
    }
  }

  /** The classic trial: three pressure plates held down at once. */
  /**
   * Chamber 1 (plates trial): sequential pressure plates — they must be
   * pressed in plate order; the wrong order resets the mechanism.
   */
  _updatePlateRuin(ruin, dt, dweebs, colony) {
    for (const plate of ruin.plates) {
      let isPressed = false;
      for (const d of dweebs) {
        if (!d.body) continue;
        const p = d.body.translation();
        if (Math.hypot(p.x - plate.x, p.z - plate.z) < 1.4 && Math.abs(p.y - plate.y) < 0.8) {
          isPressed = true;
          break;
        }
      }
      plate.pressed = isPressed;
      plate.depressAmount = THREE.MathUtils.lerp(plate.depressAmount, isPressed ? 0.15 : 0, dt * 10);
      plate.mesh.position.y = plate.y + 0.15 - plate.depressAmount;
      if (isPressed) {
        if (plate.order === ruin.sequence.length) {
          ruin.sequence.push(plate.order); // next plate in the sequence
        } else if (plate.order > ruin.sequence.length) {
          ruin.sequence.length = 0; // wrong order — the mechanism resets
        }
      }
    }
    if (ruin.sequence.length >= ruin.plates.length) {
      this._openRuin(ruin, colony);
    }
  }

  /**
   * The Gauntlet of Springs: every bounce stunt within 14m of the ruin works
   * the ancient spring mechanism. Six bounces spring the vault open. Stunts
   * are tracked by identity (a WeakSet) so two bounces landing on the same
   * tick still count separately.
   */
  _updateBounceRuin(ruin, colony) {
    if (!ruin._seenStunts) ruin._seenStunts = new WeakSet();
    for (const stunt of this.stuntFeed) {
      if (stunt.type !== 'bounce' && stunt.type !== 'launch') continue;
      if (ruin._seenStunts.has(stunt)) continue;
      if (Math.hypot(stunt.x - ruin.x, stunt.z - ruin.z) > 14) continue;
      ruin._seenStunts.add(stunt);
      ruin.work += 1;
      if (ruin.work >= 6) {
        this._openRuin(ruin, colony);
        break;
      }
    }
  }

  /**
   * The Sentry Vault: a Defender standing guard within 14m accumulates
   * respect for the vault — 30 cumulative seconds opens it. Night watch
   * counts double; the old stones love moonlight.
   */
  _updateGuardRuin(ruin, dt, colony) {
    let guards = 0;
    if (colony) {
      for (const c of colony.citizens) {
        if (c.role !== 'defender' || c.state !== CITIZEN_STATES.GUARD) continue;
        if (!c.dweeb || !c.dweeb.body) continue;
        const p = c.dweeb.body.translation();
        if (Math.hypot(p.x - ruin.x, p.z - ruin.z) < 14) guards++;
      }
    }
    if (guards > 0) {
      ruin.work += dt * guards * (this.isNight ? 2 : 1);
      if (ruin.work >= 30) this._openRuin(ruin, colony);
    }
  }

  /**
   * Crack a vault open: stunt, loot, log. Full moon boosts the coin haul 50%.
   * Opens chamber 2 (the grinding stone block), which leads to the blueprint
   * chest in chamber 3.
   */
  _openRuin(ruin, colony) {
    ruin.opened = true;
    ruin.stage = 'block';
    this._pushStunt('vault', ruin.x, ruin.z);
    if (colony) {
      const coins = Math.round(ruin.loot.coins * (this.moonPhase === 4 ? 1.5 : 1));
      colony.resources.gold = (colony.resources.gold || 0) + coins;
      colony.hats.push(ruin.loot.hat);
      colony.tools.push(ruin.loot.tool);
      colony._addLog(`🏆 ${ruin.name} vault opened! Found ${ruin.loot.hat}, ${ruin.loot.tool} and ${coins} gold coins!`);
    }
  }

  _updateCritters(dt, dweebs, colony) {
    // Critters love the wet — they wander in 1.5x as often while it rains.
    // A new moon makes them twice as bold. Shadow gobblers only hunt at night.
    this.critterTimer -= dt * (this.weather === 'rain' ? 1.5 : 1) * (this.moonPhase === 0 ? 2 : 1);
    if (this.critterTimer <= 0) {
      this.critterTimer = 45;
      // Night brings the sneaky kinds: thieves and shadow gobblers slink in
      // after dark; gnawers chew by day or night.
      let kind = 'mischief';
      const r = Math.random();
      if (this.isNight) {
        if (r < 0.3) kind = 'thief';
        else if (r < 0.55) kind = 'gobbler';
        else if (r < 0.7) kind = 'gnawer';
      } else if (r < 0.2) {
        kind = 'gnawer';
      }
      this.spawnCritter(kind);
    }
    // Friendly gatherer beetles wander in on their own schedule (max 2).
    this.beetleTimer -= dt;
    if (this.beetleTimer <= 0) {
      this.beetleTimer = 55;
      if (this.critters.filter(c => c.kind === 'beetle').length < 2) this.spawnBeetle();
    }
    // One village goat at a time wanders in looking for something to bonk.
    this.goatTimer -= dt;
    if (this.goatTimer <= 0) {
      this.goatTimer = GOAT.spawnInterval;
      if (this.critters.filter(c => c.kind === 'goat').length < GOAT.maxGoats) {
        this.spawnCritter('goat');
      }
    }
    // Anything with hit points can be gnawed (cannons today, more tomorrow).
    const chewables = this.buildingManager
      ? this.buildingManager.placedStructures.filter(s => typeof s.hp === 'number')
      : [];
    const silos = this.buildingManager
      ? this.buildingManager.placedStructures.filter(s => s.id === 'silo')
      : [];
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const c = this.critters[i];
      if (c.kind === 'beetle') {
        this._updateBeetle(c, dt, colony, silos);
      } else if (c.kind === 'goat') {
        this._updateGoat(c, dt, dweebs, colony);
      } else if (c.state === 'flee') {
        // Run home and despawn at the edge.
        const dx = c.homeX - c.x;
        const dz = c.homeZ - c.z;
        const len = Math.hypot(dx, dz) || 1;
        c.x += (dx / len) * c.speed * 1.5 * dt;
        c.z += (dz / len) * c.speed * 1.5 * dt;
        if (Math.hypot(c.x - c.homeX, c.z - c.homeZ) < 2) this.removeCritter(c);
      } else {
        // Thieves only prowl at night — dawn sends them fleeing.
        if (c.kind === 'thief' && !this.isNight) c.state = 'flee';
        // Chew the nearest chewable if one is in the way (gnawers chew
        // harder; thieves are too sneaky to stop and chew).
        let target = null;
        if (c.kind !== 'thief') {
          let best = 3;
          for (const b of chewables) {
            const d = Math.hypot(b.pos.x - c.x, b.pos.z - c.z);
            if (d < best) { best = d; target = b; }
          }
        }
        if (target) {
          c.chewTarget = target;
          target.hp -= (c.kind === 'gnawer' ? 8 : 4) * dt;
          if (target.hp <= 0 && this.buildingManager) {
            this.buildingManager.destroyStructure(target, colony);
          }
          // Chewing in place — don't move.
        } else {
          c.chewTarget = null;
          // Head for the campfire — but shadow gobblers skirt torchlight.
          let mx = 0 - c.x;
          let mz = 0 - c.z;
          if (c.kind === 'gobbler' && this.torchlights.length > 0) {
            for (const t of this.torchlights) {
              const dx = c.x - t.x;
              const dz = c.z - t.z;
              const d = Math.hypot(dx, dz);
              if (d < 6 && d > 0.01) {
                mx += (dx / d) * 8;
                mz += (dz / d) * 8;
              }
            }
          }
          const len = Math.hypot(mx, mz) || 1;
          c.x += (mx / len) * c.speed * dt;
          c.z += (mz / len) * c.speed * dt;
          c.y = this._getHeight(c.x, c.z);
        }
        // Reached the campfire? Steal, then flee.
        if (Math.hypot(c.x, c.z) < 4) {
          c.stealTimer += dt;
          // Thieves strike faster; in fog they strike twice as fast again —
          // unless a village torch is watching.
          let threshold = c.kind === 'thief' ? 2.5 : 3;
          if (c.kind === 'thief' && this.weather === 'fog' && !this._torchNear(c.x, c.z, 8)) {
            threshold = 1.25;
          }
          if (c.stealTimer >= threshold) {
            c.stealTimer = 0;
            if (c.kind === 'gobbler') {
              if (colony && colony.resources.gold > 0) {
                colony.resources.gold -= 1;
                colony._addLog('👻 A shadow gobbler snatched a gold coin from the vault!');
              }
            } else if (colony && colony.resources.berries > 0) {
              colony.resources.berries -= 1;
              colony._addLog(c.kind === 'thief'
                ? '🥷 A nocturnal thief snatched a berry from the campfire!'
                : c.kind === 'gnawer'
                  ? '🦫 A plank gnawer gnawed through a berry basket and stole one!'
                  : '🦝 A mischief critter snatched a berry from the campfire!');
            }
            if (c.kind === 'thief' && colony && colony.resources.gold > 0) {
              colony.resources.gold -= 1;
              colony._addLog('🥷 The thief pocketed a gold coin and vanished into the dark!');
            }
            c.state = 'flee';
          }
        }
      }
      if (c.mesh) {
        c.mesh.position.set(c.x, c.y + (c.hover || 0.7) + Math.sin(this.clock * 6 + c.x) * 0.08, c.z);
      }
    }
  }

  /** Read a Dweeb's world position without assuming a particular implementation. */
  _dweebPosition(d) {
    if (!d) return null;
    if (typeof d.getPosition === 'function') {
      const p = d.getPosition();
      if (p) return p;
    }
    if (d.body && typeof d.body.translation === 'function') return d.body.translation();
    return null;
  }

  /** Nearest live Dweeb within the goat's attention range. */
  _nearestDweeb(c, dweebs) {
    let nearest = null;
    let best = GOAT.targetRange;
    for (const d of dweebs || []) {
      if (!d || !d.body || d.active === false || d.eliminated) continue;
      const p = this._dweebPosition(d);
      if (!p) continue;
      const dist = Math.hypot(p.x - c.x, p.z - c.z);
      if (dist < best) { best = dist; nearest = d; }
    }
    return nearest;
  }

  /** The actual impact: a comic mallet-flavoured headbutt that launches the victim. */
  _goatStrike(c, target, colony) {
    const p = this._dweebPosition(target);
    let dirX = c.goatDirX || 0;
    let dirZ = c.goatDirZ || 1;
    if (p) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const len = Math.hypot(dx, dz) || 1;
      dirX = dx / len;
      dirZ = dz / len;
    }
    c.goatDirX = dirX;
    c.goatDirZ = dirZ;
    if (c.mesh) c.mesh.rotation.y = Math.atan2(dirX, dirZ);

    // Dodged during the windup? The goat lunges into thin air and looks silly.
    if (!p || Math.hypot(p.x - c.x, p.z - c.z) > GOAT.headbuttRange + GOAT.lungeReach) {
      const pos = { x: c.x, y: c.y + (c.hover || 0.8) + 0.6, z: c.z };
      this.fx?.hud?.popup?.('WHIFF!', pos, 'small', 0xffffff);
      this.fx?.audio?.playWhoosh?.(0);
      return;
    }

    if (target) {
      const dir = { x: dirX, y: 0.45, z: dirZ };
      if (typeof target.receiveHit === 'function') {
        target.receiveHit({
          dir,
          damage: GOAT.hitDamage,
          base: GOAT.hitBase,
          growth: GOAT.hitGrowth,
          attacker: null,
          time: this.clock,
        });
      } else if (target.body && typeof target.body.setLinvel === 'function') {
        target.body.setLinvel({
          x: dirX * GOAT.launchSpeed,
          y: GOAT.launchUp,
          z: dirZ * GOAT.launchSpeed,
        }, true);
      }
    }

    const fx = this.fx;
    if (fx) {
      const pos = p
        ? { x: p.x, y: p.y + 0.8, z: p.z }
        : { x: c.x, y: c.y + (c.hover || 0.8), z: c.z };
      const pan = typeof fx._pan === 'function' ? fx._pan(pos) : 0;
      fx.particles?.ring?.(pos, { color: 0xffd23f, size: 2.6, life: 0.35 });
      fx.particles?.emit?.(pos, {
        count: 14,
        colors: [0xffd23f, 0xffffff, GOAT.color],
        speed: 6,
        up: 3,
        size: 0.14,
        life: 0.5,
      });
      fx.bursts?.spawn?.(pos, 1.4, 0xffd23f);
      fx.audio?.playComicBonk?.(pan);
      fx.audio?.playSlideWhistle?.(pan);
      fx.hud?.popup?.('BONK!', pos, 'big', 0xffd23f);
      fx.cam?.shake?.(0.2);
    }
    if (colony && !c.goatLoggedHit) {
      c.goatLoggedHit = true;
      colony._addLog?.('🐐 The village goat delivered a mighty BONK!');
    }
  }

  /** Goat brain: approach a Dweeb, paw the dirt, headbutt, then flee and return. */
  _updateGoat(c, dt, dweebs, colony) {
    if (!c.goatGreeted) {
      c.goatGreeted = true;
      colony?._addLog?.('🐐 A village goat wanders in, spoiling for a headbutt!');
    }
    const target = this._nearestDweeb(c, dweebs);
    c.stateTimer = Math.max(0, (c.stateTimer || 0) - dt);
    let moving = false;

    if (c.state === 'windup') {
      // Paw-paw-paw… keep facing the poor Dweeb.
      if (c.goatLegs && c.goatLegs.length >= 2) {
        const swing = Math.sin(this.clock * 24) * 0.65;
        c.goatLegs[0].rotation.x = swing;
        c.goatLegs[1].rotation.x = -swing;
      }
      const p = this._dweebPosition(target);
      if (p && c.mesh) {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        c.mesh.rotation.y = Math.atan2(dx, dz);
        const len = Math.hypot(dx, dz) || 1;
        c.goatDirX = dx / len;
        c.goatDirZ = dz / len;
      }
      if (c.stateTimer <= 0) {
        c.state = 'headbutt';
        c.stateTimer = GOAT.headbuttTime;
        c.goatTarget = target;
        this._goatStrike(c, target, colony);
      }
    } else if (c.state === 'headbutt') {
      const lungeSpeed = c.speed * GOAT.lungeSpeedMult;
      c.x += (c.goatDirX || 0) * lungeSpeed * dt;
      c.z += (c.goatDirZ || 1) * lungeSpeed * dt;
      c.y = this._getHeight(c.x, c.z);
      if (c.stateTimer <= 0) {
        c.state = 'flee';
        c.stateTimer = GOAT.fleeTime;
        c.goatDirX = -(c.goatDirX || 0);
        c.goatDirZ = -(c.goatDirZ || 1);
      }
    } else if (c.state === 'flee') {
      const fleeSpeed = c.speed * GOAT.fleeSpeedMult;
      c.x += (c.goatDirX || 0) * fleeSpeed * dt;
      c.z += (c.goatDirZ || 1) * fleeSpeed * dt;
      c.y = this._getHeight(c.x, c.z);
      if (c.mesh) c.mesh.rotation.y = Math.atan2(c.goatDirX || 0, c.goatDirZ || 1);
      if (c.stateTimer <= 0) {
        c.state = 'approach';
        c.stateTimer = 0;
      }
    } else {
      // Approach: lock onto the nearest Dweeb, or amble toward the village.
      c.state = 'approach';
      if (target) {
        const p = this._dweebPosition(target);
        if (p) {
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          const len = Math.hypot(dx, dz) || 1;
          c.goatDirX = dx / len;
          c.goatDirZ = dz / len;
          if (c.mesh) c.mesh.rotation.y = Math.atan2(dx, dz);
          if (len <= GOAT.headbuttRange) {
            c.state = 'windup';
            c.stateTimer = GOAT.windupTime;
          } else {
            c.x += (dx / len) * c.speed * dt;
            c.z += (dz / len) * c.speed * dt;
            c.y = this._getHeight(c.x, c.z);
            moving = true;
          }
        }
      } else {
        const dx = -c.x;
        const dz = -c.z;
        const len = Math.hypot(dx, dz) || 1;
        if (len > 4) {
          c.x += (dx / len) * c.speed * 0.45 * dt;
          c.z += (dz / len) * c.speed * 0.45 * dt;
          c.y = this._getHeight(c.x, c.z);
          if (c.mesh) c.mesh.rotation.y = Math.atan2(dx, dz);
          moving = true;
        }
      }
    }

    if (c.mesh) {
      const tilt = c.state === 'headbutt' ? -0.28 : 0;
      c.mesh.rotation.x = THREE.MathUtils.lerp(c.mesh.rotation.x || 0, tilt, Math.min(1, dt * 12));
      if (moving && c.state !== 'windup') {
        c.mesh.rotation.z = Math.sin(this.clock * 14) * 0.04;
      } else {
        c.mesh.rotation.z = THREE.MathUtils.lerp(c.mesh.rotation.z || 0, 0, Math.min(1, dt * 14));
      }
      if (c.state !== 'windup' && c.goatLegs) {
        for (const leg of c.goatLegs) {
          leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x || 0, 0, Math.min(1, dt * 14));
        }
      }
    }
  }

  /** Friendly gatherer beetle: trundles between berry bushes, banking berries. */
  _updateBeetle(c, dt, colony, silos) {
    // Pick the nearest bush that still has berries.
    let bush = null;
    let best = Infinity;
    for (const b of this.berryBushes) {
      if (b.available <= 0) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (d < best) { best = d; bush = b; }
    }
    if (!bush) {
      // Nothing to gather — amble in a lazy circle.
      c.x += Math.cos(this.clock * 0.4 + c.homeX) * c.speed * 0.3 * dt;
      c.z += Math.sin(this.clock * 0.4 + c.homeZ) * c.speed * 0.3 * dt;
      c.y = this._getHeight(c.x, c.z);
      return;
    }
    const dx = bush.x - c.x;
    const dz = bush.z - c.z;
    const len = Math.hypot(dx, dz) || 1;
    if (len > 2.5) {
      c.x += (dx / len) * c.speed * dt;
      c.z += (dz / len) * c.speed * dt;
      c.y = this._getHeight(c.x, c.z);
      c.gatherTimer = 0;
    } else {
      // Nose in the bush: every 6 seconds it hauls a berry home.
      c.gatherTimer += dt;
      if (c.gatherTimer >= 6) {
        c.gatherTimer = 0;
        bush.available -= 1;
        if (colony) {
          colony.addResource('berries', 1, silos);
          if (!c.greeted) {
            c.greeted = true;
            colony._addLog('🪲 A friendly gatherer beetle joined the harvest — free berries!');
          }
        }
      }
    }
  }

  /** Plain-data snapshot for save files (loot itself lives on the colony). */
  serialize() {
    return {
      timeOfDay: this.timeOfDay,
      dayCount: this.dayCount,
      ruinsOpened: this.ruins.filter(r => r.opened).map(r => r.id),
      weather: this.weather,
    };
  }

  /** Restore a snapshot produced by serialize(). */
  restore(data) {
    if (!data) return;
    if (typeof data.timeOfDay === 'number') this.timeOfDay = data.timeOfDay;
    if (typeof data.dayCount === 'number') this.dayCount = Math.max(0, Math.floor(data.dayCount));
    this._lastSeason = this.season;
    if (data.weather === 'clear' || data.weather === 'rain' || data.weather === 'wind' || data.weather === 'fog') {
      this.weather = data.weather;
    }
    if (Array.isArray(data.ruinsOpened)) {
      for (const ruin of this.ruins) {
        if (data.ruinsOpened.includes(ruin.id)) {
          ruin.opened = true;
          ruin.progress = 1;
          ruin.stage = 'done';
          ruin.sequence = ruin.plates.map(p => p.order ?? 0);
          if (ruin.vault) {
            ruin.vault.lid.position.y = 3.4;
            ruin.vault.glow.intensity = 2.5;
          }
          if (ruin.block) {
            ruin.block.progress = 1;
            ruin.block.mesh.position.x = ruin.block.toX;
          }
          if (ruin.chest) {
            ruin.chest.opened = true;
            ruin.chest.lid.position.y += 0.5;
            ruin.chest.lid.rotation.x = -0.9;
            ruin.chest.glow.intensity = 2;
          }
        }
      }
    }
  }

  // ─── 7. Simulation & Animation Loop ───

  update(dt, dweebs = [], colony = null) {
    this.clock += dt;

    // Day/night cycle, weather, berry regrowth, vault puzzles and critters.
    const prevTod = this.timeOfDay;
    this._updateDayNight(dt);
    if (this.timeOfDay < prevTod) this._onNewDay(colony);
    this._updateWeather(dt, colony);
    this._updateSupplyPiles(dt, dweebs);
    this._updateHaulProps(dt);
    this._updateBushRegrowth(dt, colony);
    this._updateCritters(dt, dweebs, colony);
    this.river?.update(dt, dweebs, colony);
    this._updateMerchant(dt, colony);

    // Flicker Campfire Light (brighter after dark)
    if (this.campfireLight) {
      const base = this.isNight ? 3.4 : 2.6;
      this.campfireLight.intensity = base + Math.sin(this.clock * 12) * 0.3 + Math.cos(this.clock * 19) * 0.2;
    }

    // Toy-set landmarks (six independent buildings + their moving pieces).
    this.toyTown?.update(dt, dweebs);

    // Totem floating orb bob and spin
    if (this.totemOrb) {
      this.totemOrb.position.y = 3.6 + Math.sin(this.clock * 2) * 0.15;
      this.totemOrb.rotation.y += dt * 0.8;
    }

    // Switch Crystal rotation
    if (this.switchCrystal) {
      this.switchCrystal.rotation.y += dt * 1.2;
      this.switchCrystal.rotation.x = Math.sin(this.clock * 1.5) * 0.2;
    }

    // Check Spring Pads interaction with Dweebs
    for (const pad of this.springPads) {
      for (const d of dweebs) {
        if (!d.body) continue;
        const p = d.body.translation();
        const dist = Math.hypot(p.x - pad.x, p.z - pad.z);
        if (dist < pad.radius && Math.abs(p.y - pad.y) < 1.0) {
          // Trigger big bounce!
          const curVel = d.body.linvel();
          d.body.setLinvel({ x: curVel.x, y: pad.boostVelocity, z: curVel.z }, true);
          pad.rebound = 0.35;
          if (d.onBounce) d.onBounce();
          this._pushStunt(pad.launchesItems ? 'launch' : 'bounce', pad.x, pad.z);
        }
      }
      // Launchpads fling loose physics props too, not just Dweebs.
      if (pad.launchesItems && this.looseProps) {
        for (const prop of this.looseProps) {
          if (!prop.body) continue;
          const pp = prop.body.translation();
          if (Math.hypot(pp.x - pad.x, pp.z - pad.z) < pad.radius && Math.abs(pp.y - pad.y) < 1.0) {
            const pv = prop.body.linvel();
            prop.body.setLinvel({ x: pv.x, y: pad.boostVelocity, z: pv.z }, true);
          }
        }
      }
      if (pad.rebound > 0) {
        pad.rebound = Math.max(0, pad.rebound - dt * 2);
        pad.mesh.scale.set(1 + pad.rebound, 1 - pad.rebound * 0.5, 1 + pad.rebound);
      }
    }

    // Check Pressure Plates interaction with Dweebs or items
    let bothPlatesActive = true;
    for (const plate of this.pressurePlates) {
      let isPressed = false;
      for (const d of dweebs) {
        if (!d.body) continue;
        const p = d.body.translation();
        if (Math.hypot(p.x - plate.x, p.z - plate.z) < 1.4 && Math.abs(p.y - plate.y) < 0.8) {
          isPressed = true;
          break;
        }
      }
      plate.pressed = isPressed;
      plate.depressAmount = THREE.MathUtils.lerp(plate.depressAmount, isPressed ? 0.15 : 0, dt * 10);
      plate.mesh.position.y = plate.y + 0.15 - plate.depressAmount;
      if (!isPressed) bothPlatesActive = false;
    }

    // If both pressure plates are activated or overhead switch is solved, open the Mountain Gate!
    if (bothPlatesActive && !this.gateState.isOpen) {
      this.gateState.isOpen = true;
    }

    // Toy-ruin vaults: three plates at once opens the treasure.
    this._updateRuins(dt, dweebs, colony);

    if (this.gateState.isOpen && this.gateState.progress < 1) {
      this.gateState.progress = Math.min(1, this.gateState.progress + dt * 0.4);
      const gateY = 3.5 + this.gateState.progress * 5.0;
      if (this.gateMesh) this.gateMesh.position.y = gateY;
      if (this.gateBody && this.gateBody.body) {
        this.gateBody.body.setNextKinematicTranslation({
          x: this.gateMesh.parent.position.x,
          y: this.gateMesh.parent.position.y + gateY,
          z: this.gateMesh.parent.position.z,
        });
      }
    }

    // ── Hollow Mountains Gorge Mechanics ──

    // Geothermal Steam Vents Updraft
    for (const vent of this.steamVents) {
      // Animate steam puffs rising and fading
      for (let i = 0; i < vent.steamPuffs.length; i++) {
        const puff = vent.steamPuffs[i];
        puff.position.y = 0.8 + ((this.clock * 2.5 + i * 1.2) % 4.5);
        puff.scale.setScalar(1 + (puff.position.y / 4.5) * 1.2);
      }
      // Check Dweeb contact for updraft lift
      for (const d of dweebs) {
        if (!d.body) continue;
        const p = d.body.translation();
        if (Math.hypot(p.x - vent.x, p.z - vent.z) < vent.radius && Math.abs(p.y - vent.y) < 3.0) {
          const v = d.body.linvel();
          d.body.setLinvel({ x: v.x * 0.96, y: Math.max(v.y, vent.boost), z: v.z * 0.96 }, true);
        }
      }
    }

    // Waterwheel Rotation
    if (this.waterwheel) {
      this.waterwheel.rotation.z += dt * 0.75;
    }

    // Moving Stone Elevator Platform
    if (this.elevator) {
      const el = this.elevator;
      el.curY += el.dir * el.speed * dt;
      if (el.curY >= el.maxY) {
        el.curY = el.maxY;
        el.dir = -1;
      } else if (el.curY <= el.minY) {
        el.curY = el.minY;
        el.dir = 1;
      }
      el.mesh.position.y = el.curY;
      if (el.body && el.body.body) {
        el.body.body.setNextKinematicTranslation({
          x: 0,
          y: el.curY,
          z: -80,
        });
      }
    }
  }

  dispose() {
    this.river?.dispose();
    this.river = null;
    this.toyTown?.dispose();
    this.toyTown = null;
    this.haulProps.length = 0;
    this.supplyPiles.length = 0;
    this.scene.remove(this.group);
    for (const c of this.colliders) {
      if (this.physicsWorld && c.body) {
        this.physicsWorld.world.removeRigidBody(c.body);
      }
    }
  }
}
