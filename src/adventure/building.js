// building.js — Toy Construction & Blueprint System for Dweeb Civilization
//
// Allows the player (and master builder Dweebs) to place physical contraptions
// in the living world: Springboard Pads, Wooden Ramps, Play Tents, Firepits, Catapults,
// plus the Expedition & Dynasty set — Bouncy Launchpads, Watchtower Ziplines,
// Berry Windmills, Storage Silos and Plush Cannon Barricades.
//
// Structures are data-first: every placed structure is a plain object
// { id, pos, group, colliders, update?, serialize? } so the colony sim,
// persistence and headless tests can drive them without a renderer.

import * as THREE from 'three';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';
import { STRUCTURE_CATALOG, getStructureDef } from '../world/ObjectRegistry.js';
import { createToyStructure } from '../world/ToyBuildings.js';

export const BLUEPRINTS = [
  {
    id: 'springboard',
    name: 'Mushroom Springpad',
    icon: '🍄',
    cost: { wood: 1, stone: 1 },
    desc: 'Bounces Dweebs and loose physics props high into the air.',
  },
  {
    id: 'ramp',
    name: 'Wooden Plank Ramp',
    icon: '🪵',
    cost: { wood: 2, stone: 0 },
    desc: 'Sloped wooden ramp to bridge streams and reach high bluffs.',
  },
  {
    id: 'tent',
    name: 'Bouncy Play Tent',
    icon: '🎪',
    cost: { wood: 3, berries: 2 },
    desc: 'Cozy shelter for Dweeb napping with a bouncy roof.',
  },
  {
    id: 'firepit',
    name: 'Campfire Gathering Circle',
    icon: '🔥',
    cost: { wood: 1, stone: 2 },
    desc: 'Warm social circle that recharges citizen energy and morale.',
  },
  {
    id: 'catapult',
    name: 'Toy Catapult Cup',
    icon: '🎯',
    cost: { wood: 4, stone: 2 },
    desc: 'Launches boulders, watermelons, and volunteer Dweebs!',
  },
  {
    id: 'launchpad',
    name: 'Bouncy Launchpad',
    icon: '🚀',
    cost: { wood: 2, stone: 2 },
    desc: 'Super springpad — launches Dweebs AND loose props sky-high.',
  },
  {
    id: 'ziptower',
    name: 'Watchtower Zipline',
    icon: '🗼',
    cost: { wood: 5, stone: 2 },
    desc: 'Tall vantage tower. Climb the steps, grab the wire, slide home.',
  },
  {
    id: 'berrymill',
    name: 'Berry Windmill',
    icon: '🌾',
    cost: { wood: 4, stone: 2 },
    desc: 'Spinning blades auto-gather berries from nearby bushes.',
  },
  {
    id: 'silo',
    name: 'Storage Silo',
    icon: '🛢️',
    cost: { wood: 3, stone: 3 },
    desc: 'Safely stores timber, berries and stone. Raises storage caps.',
  },
  {
    id: 'cannon',
    name: 'Plush Cannon Barricade',
    icon: '💥',
    cost: { wood: 3, stone: 3 },
    desc: 'Barricade that lobs plush toy balls at invading critters.',
  },
  {
    id: 'tradepost',
    name: 'Trading Post',
    icon: '🏪',
    cost: { wood: 6, stone: 2 },
    desc: 'A merchant stall. Traveling caravans stop here to trade goods for gold.',
  },
  {
    id: 'bakery',
    name: 'Berry Bakery',
    icon: '🥧',
    cost: { wood: 4, stone: 4 },
    desc: 'Bakes 3 berries into a pie worth 1 gold every 25 seconds.',
  },
  {
    id: 'garden',
    name: 'Berry Garden',
    icon: '🌱',
    cost: { wood: 2, berries: 4 },
    desc: 'A fenced garden plot that sprouts 3 fresh berry bushes.',
  },
];

// Every handcrafted landmark is also a placeable blueprint. The toolbar can grow without the
// construction engine needing another special case.
BLUEPRINTS.push(...STRUCTURE_CATALOG.map(def => ({ ...def, kind: 'landmark' })));

// How much one silo raises every colony storage cap.
export const SILO_CAP_BONUS = 50;
// One silo holds this many resource units in total.
export const SILO_CAPACITY = 60;

export class BuildingManager {
  constructor(scene, physicsWorld, options = {}) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.fx = options.fx || null;
    this.placedStructures = [];
    this.activeBlueprint = null;
    this.ghostMesh = null;
    this.placementPos = new THREE.Vector3();
    this.isValidPlacement = false;
    this.clock = 0;

    // Raycaster for snapping to terrain
    this.raycaster = new THREE.Raycaster();
    this.rayDown = new THREE.Vector3(0, -1, 0);
  }

  startPlacing(blueprintId) {
    this.cancelPlacing();
    const bp = BLUEPRINTS.find(b => b.id === blueprintId);
    if (!bp) return false;

    this.activeBlueprint = bp;
    this.ghostMesh = this._createGhostMesh(bp.id);
    this.ghostMesh.visible = true;
    this.scene.add(this.ghostMesh);
    return true;
  }

  cancelPlacing() {
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
    this.activeBlueprint = null;
  }

  /**
   * Per-frame update.
   * @param {number} dt seconds since last frame
   * @param {object} player the player Dweeb (needs .body)
   * @param {object} terrainMesh mesh to raycast placement against
   * @param {object} [ctx] optional live context { dweebs, colony, world }
   *   (world = the Meadowlands instance). Without ctx only the placement
   *   ghost is updated, exactly like before.
   */
  update(dt, player, terrainMesh, ctx = null) {
    this.clock += dt;
    if (this.activeBlueprint && this.ghostMesh && player && player.body) {
      // Calculate placement target 4 meters in front of player
      const p = player.body.translation();
      const forward = player.facing ? player.facing.clone() : new THREE.Vector3(0, 0, -1);
      forward.y = 0;
      forward.normalize();

      const targetX = p.x + forward.x * 4.2;
      const targetZ = p.z + forward.z * 4.2;

      // Raycast down onto terrain to find exact height
      let targetY = p.y;
      if (terrainMesh) {
        this.raycaster.set(new THREE.Vector3(targetX, 40, targetZ), this.rayDown);
        const hits = this.raycaster.intersectObject(terrainMesh, false);
        if (hits.length > 0) {
          targetY = hits[0].point.y;
          this.isValidPlacement = true;
        } else {
          this.isValidPlacement = false;
        }
      }

      this.placementPos.set(targetX, targetY, targetZ);
      this.ghostMesh.position.copy(this.placementPos);

      // Subtle floating breathing animation for hologram
      const breathe = 1.0 + Math.sin(this.clock * 5) * 0.04;
      this.ghostMesh.scale.set(breathe, breathe, breathe);
    }

    if (!ctx) return;
    const dweebs = ctx.dweebs || [];
    // The player rides ziplines and triggers pads like any other Dweeb.
    const riders = player ? [player, ...dweebs] : dweebs;

    for (const s of this.placedStructures) {
      if (typeof s.update === 'function') s.update(dt, ctx);
    }
    this._updateZiplineRides(dt, riders, ctx.world);
  }

  /** Advance every player-placed landmark (sails, doors, cranes, destructible blocks). */
  updatePlaced(dt, dweebs = []) {
    for (const s of this.placedStructures) {
      if (s.toy) s.toy.update(dt, { dweebs, fx: this.fx, town: null });
    }
  }

  dispose() {
    this.cancelPlacing();
    for (const s of this.placedStructures) s.toy?.dispose?.();
    this.placedStructures.length = 0;
  }

  /** Move Dweebs along zipline wires. A Dweeb standing on a ziptower platform
   *  grabs the wire and slides down to the village anchor. */
  _updateZiplineRides(dt, riders, world) {
    if (!world || !world.ziplines || world.ziplines.length === 0) return;
    for (const d of riders) {
      if (!d || !d.body) continue;
      const ride = d._ziplineRide;
      if (ride) {
        const line = ride.line;
        ride.t += (line.speed * dt) / line.length;
        if (ride.t >= 1) {
          // Hop off the end with a little forward momentum.
          d._ziplineRide = null;
          if (d.body.setLinvel) {
            d.body.setLinvel({ x: line.dir.x * 6, y: 2.5, z: line.dir.z * 6 }, true);
          }
          if (world._pushStunt) world._pushStunt('zipline', line.to.x, line.to.z);
          continue;
        }
        const x = line.from.x + (line.to.x - line.from.x) * ride.t;
        const y = line.from.y + (line.to.y - line.from.y) * ride.t;
        const z = line.from.z + (line.to.z - line.from.z) * ride.t;
        if (d.body.setTranslation) d.body.setTranslation({ x, y, z }, true);
        if (d.body.setLinvel) {
          d.body.setLinvel({ x: line.dir.x * line.speed, y: line.dir.y * line.speed, z: line.dir.z * line.speed }, true);
        }
        continue;
      }
      // Not riding: standing on a tower platform grabs the wire.
      const p = d.body.translation();
      for (const line of world.ziplines) {
        const dx = p.x - line.from.x;
        const dy = p.y - line.from.y;
        const dz = p.z - line.from.z;
        if (dx * dx + dz * dz < 1.8 * 1.8 && Math.abs(dy) < 1.6) {
          d._ziplineRide = { line, t: 0 };
          break;
        }
      }
    }
  }

  /**
   * Confirm placement of the active blueprint.
   * @param {Colony} colony - The colony managing resources and build queue
   * @param {object} world - The Meadowlands world instance
   * @param {object} [options] - Options: { queue: boolean }
   *   queue=true: add to colony.buildQueue; a Builder raises it at the next build site and pays then
   *   queue=false (default): build instantly (player places it themselves)
   * @returns {object|null} Result object with success status
   */
  confirmPlacement(colony, world, options = {}) {
    const { queue = false } = options;
    if (!this.activeBlueprint || !this.isValidPlacement) return null;
    const bp = this.activeBlueprint;
    // Remember the world so destroyStructure() can unregister the structure's
    // hooks (ziplines, spring pads) when it is demolished.
    if (world) this._world = world;

    // Locked blueprints need a town-tier milestone or a ruin-vault chest first.
    if (colony && typeof colony.isBlueprintUnlocked === 'function' && !colony.isBlueprintUnlocked(bp.id)) {
      return { success: false, reason: `🔒 The ${bp.name} blueprint is locked — grow your town or find it in a ruin vault!` };
    }

    if (queue) {
      // Queue for Builders. Colony._completeBuild() charges the cost when a Builder
      // actually raises it (and waits on the queue until you can afford it), so
      // nothing is deducted here and cancelling needs no refund.
      if (!colony?.queueBuild?.(bp.id)) {
        return { success: false, reason: `Could not queue the ${bp.name} (already queued or locked).` };
      }
      this.cancelPlacing();
      return { success: true, queued: true, blueprintId: bp.id };
    }

    // Check colony resource costs
    if (colony) {
      for (const [res, count] of Object.entries(bp.cost)) {
        if ((colony.resources[res] || 0) < count) {
          return { success: false, reason: `Not enough ${res}! Need ${count}.` };
        }
      }
      // Deduct resources
      for (const [res, count] of Object.entries(bp.cost)) {
        colony.resources[res] -= count;
      }
    }

    // Instant placement (default): build it right now at the ghost position
    const pos = this.placementPos.clone();
    const structure = this._instantiateStructure(bp.id, pos, world);

    // A silo raises the colony's storage caps the moment it lands.
    if (bp.id === 'silo' && colony && colony.storageCap) {
      for (const res of ['wood', 'berries', 'stone']) {
        colony.storageCap[res] = (colony.storageCap[res] || 0) + SILO_CAP_BONUS;
      }
    }

    this.placedStructures.push(structure);

    if (colony) {
      colony._addLog(`🔨 Constructed ${bp.name} in the settlement!`);
    }

    this.cancelPlacing();
    return { success: true, structure };
  }

  /**
   * Cancel the last queued build (nothing was charged yet, so there is nothing to refund).
   * @param {Colony} colony - The colony with the build queue
   * @returns {object} Result with success status and the unqueued blueprint
   */
  cancelLastQueuedBuild(colony) {
    if (!colony || !colony.buildQueue || colony.buildQueue.length === 0) {
      return { success: false, reason: 'No builds in the queue to cancel.' };
    }
    const blueprintId = colony.buildQueue[colony.buildQueue.length - 1];
    const bp = BLUEPRINTS.find(b => b.id === blueprintId);
    if (!bp) {
      // Clean up invalid entry
      colony.buildQueue.pop();
      return { success: false, reason: 'Unknown blueprint removed from queue.' };
    }
    colony.cancelBuild(blueprintId);
    colony._addLog(`❌ The ${bp.name} was taken off the build queue.`);
    return { success: true, blueprintId, name: bp.name };
  }

  /** Place a structure without charging costs (save restore). */
  placeSaved(data, world, colony = null) {
    if (!data || !data.id) return null;
    if (world) this._world = world;
    const pos = new THREE.Vector3(data.x || 0, data.y || 0, data.z || 0);
    const structure = this._instantiateStructure(data.id, pos, world, true);
    if (data.stored && structure.stored) {
      structure.stored = { ...structure.stored, ...data.stored };
      if (typeof structure._refreshFill === 'function') structure._refreshFill();
    }
    if (typeof data.hp === 'number' && typeof structure.hp === 'number') {
      structure.hp = data.hp;
    }
    if (data.id === 'silo' && colony && colony.storageCap) {
      for (const res of ['wood', 'berries', 'stone']) {
        colony.storageCap[res] = (colony.storageCap[res] || 0) + SILO_CAP_BONUS;
      }
    }
    this.placedStructures.push(structure);
    return structure;
  }

  /** Remove a structure (destroyed barricade, demolished building). */
  destroyStructure(structure, colony = null) {
    const idx = this.placedStructures.indexOf(structure);
    if (idx === -1) return false;
    this.placedStructures.splice(idx, 1);
    // Unregister the structure's world hooks so a demolished springboard
    // doesn't bounce Dweebs off thin air and a demolished tower doesn't
    // leave a ghost zipline wire behind.
    const w = this._world;
    if (w) {
      if (structure.zipline && Array.isArray(w.ziplines)) {
        const zi = w.ziplines.indexOf(structure.zipline);
        if (zi !== -1) w.ziplines.splice(zi, 1);
      }
      if (structure.springPad && Array.isArray(w.springPads)) {
        const pi = w.springPads.indexOf(structure.springPad);
        if (pi !== -1) w.springPads.splice(pi, 1);
      }
    }
    if (structure.toy) structure.toy.dispose?.();
    if (structure.group && this.scene) this.scene.remove(structure.group);
    if (structure.projectiles) {
      for (const ball of structure.projectiles) {
        if (ball.mesh && this.scene) this.scene.remove(ball.mesh);
      }
    }
    if (colony) colony._addLog(`💥 The ${structure.id} was destroyed!`);
    return true;
  }

  _createGhostMesh(id) {
    const group = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      wireframe: true,
    });

    // Handcrafted toy-set landmarks get a footprint + tower ghost.
    const structureDef = getStructureDef(id);
    if (structureDef) {
      const r = (structureDef.footprint || 8) * 0.5;
      const footprint = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.0, 12), ghostMat);
      footprint.position.y = 0.5;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.32, r * 0.44, r * 0.9, 8), ghostMat);
      tower.position.y = r * 0.45;
      group.add(footprint, tower);
      noOutline(group);
      return group;
    }

    if (id === 'springboard') {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.4, 12), ghostMat);
      pad.position.y = 0.2;
      group.add(pad);
    } else if (id === 'ramp') {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 4.5), ghostMat);
      ramp.rotation.x = -Math.PI / 8;
      ramp.position.set(0, 0.8, 0);
      group.add(ramp);
    } else if (id === 'tent') {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 8), ghostMat);
      cone.position.y = 1.1;
      group.add(cone);
    } else if (id === 'firepit') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.3, 6, 10), ghostMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.15;
      group.add(ring);
    } else if (id === 'catapult') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 3.0), ghostMat);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.8, 6), ghostMat);
      arm.rotation.x = Math.PI / 4;
      arm.position.set(0, 1.2, -0.4);
      group.add(base, arm);
    } else if (id === 'launchpad') {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.2, 0.5, 12), ghostMat);
      pad.position.y = 0.25;
      group.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.25, 6, 12), ghostMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.6;
      group.add(ring);
    } else if (id === 'ziptower') {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6, 2.2), ghostMat);
      tower.position.y = 3;
      group.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.6, 4), ghostMat);
      roof.position.y = 6.8;
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
    } else if (id === 'berrymill') {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 5, 8), ghostMat);
      tower.position.y = 2.5;
      group.add(tower);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.5, 0.2), ghostMat);
      blade.position.y = 5.6;
      group.add(blade);
    } else if (id === 'silo') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 3.6, 10), ghostMat);
      body.position.y = 1.8;
      group.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.4, 10), ghostMat);
      roof.position.y = 4.3;
      group.add(roof);
    } else if (id === 'cannon') {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.0, 0.8), ghostMat);
      wall.position.y = 1.0;
      group.add(wall);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.2, 8), ghostMat);
      barrel.rotation.x = Math.PI / 3;
      barrel.position.set(0, 2.4, 0.4);
      group.add(barrel);
    } else if (id === 'tradepost') {
      const stall = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 2.0), ghostMat);
      stall.position.y = 0.55;
      group.add(stall);
      const awning = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.15, 2.6), ghostMat);
      awning.position.y = 2.6;
      awning.rotation.x = -0.15;
      group.add(awning);
    } else if (id === 'bakery') {
      const hut = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 2.6, 10), ghostMat);
      hut.position.y = 1.3;
      group.add(hut);
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 6), ghostMat);
      chimney.position.set(0.9, 3.4, 0);
      group.add(chimney);
    } else if (id === 'garden') {
      const plot = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.2, 5.0), ghostMat);
      plot.position.y = 0.1;
      group.add(plot);
      for (const [fx, fz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 5), ghostMat);
        post.position.set(fx, 0.6, fz);
        group.add(post);
      }
    }

    noOutline(group);
    return group;
  }

  _instantiateStructure(id, pos, world, fromSave = false) {
    // Remember the world for destroyStructure() hook cleanup (any entry path).
    if (world) this._world = world;
    // Handcrafted toy-set landmarks are built by the ToyBuildings engine.
    const structureDef = getStructureDef(id);
    if (structureDef) {
      const toy = createToyStructure(id, this.physicsWorld, this.scene, {
        x: pos.x, y: pos.y, z: pos.z, rotationY: 0, fx: this.fx,
        groundAt: world?._getHeight ? (x, z) => world._getHeight(x, z) : null,
      });
      const landmark = { id, pos, group: toy.group, colliders: toy.colliders, toy };
      landmark.serialize = () => ({ id, x: pos.x, y: pos.y, z: pos.z });
      return landmark;
    }

    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);

    const result = { id, pos, group, colliders: [], scene: this.scene };
    result.serialize = () => {
      const data = { id, x: pos.x, y: pos.y, z: pos.z };
      if (result.stored) data.stored = { ...result.stored };
      if (typeof result.hp === 'number') data.hp = result.hp;
      return data;
    };

    if (id === 'springboard') {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.7, 0.2, 10),
        toonMat({ color: 0x475569, flatShading: true })
      );
      base.position.y = 0.1;
      group.add(base);

      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.3, 1.4, 0.35, 12),
        new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.6, flatShading: true })
      );
      pad.position.y = 0.3;
      group.add(pad);
      noOutline(pad);

      // Register with world springpads so any Dweeb stepping on it bounces high!
      if (world && world.springPads) {
        const padEntry = {
          x: pos.x, y: pos.y, z: pos.z,
          radius: 1.6,
          boostVelocity: 18.0,
          mesh: pad,
          rebound: 0,
        };
        world.springPads.push(padEntry);
        result.springPad = padEntry; // destroyStructure() unregisters this
      }

      if (this.physicsWorld) {
        const c = this.physicsWorld.createFixedCylinder(pos.x, pos.y + 0.15, pos.z, 1.5, 0.15, 'stone');
        result.colliders.push(c);
      }
    } else if (id === 'ramp') {
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 0.25, 4.5),
        toonMat({ color: 0xb45309, flatShading: true })
      );
      ramp.rotation.x = -Math.PI / 9;
      ramp.position.set(0, 0.8, 0);
      group.add(ramp);

      if (this.physicsWorld) {
        // Physical inclined box collider
        const c = this.physicsWorld.createStaticBox(pos.x, pos.y + 0.8, pos.z, 1.25, 0.15, 2.25, 'wood');
        result.colliders.push(c);
      }
    } else if (id === 'tent') {
      const tent = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 2.4, 8),
        toonMat({ color: PALETTE.orange, flatShading: true })
      );
      tent.position.y = 1.2;
      group.add(tent);

      if (this.physicsWorld) {
        const c = this.physicsWorld.createFixedCylinder(pos.x, pos.y + 1.2, pos.z, 2.0, 1.2, 'wood');
        result.colliders.push(c);
      }
    } else if (id === 'firepit') {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(1.3, 1.5, 0.25, 8),
        toonMat({ color: 0x334155, flatShading: true })
      );
      ring.position.y = 0.12;
      group.add(ring);

      const fire = new THREE.PointLight(0xff8811, 2.5, 10);
      fire.position.set(0, 0.8, 0);
      group.add(fire);

      if (this.physicsWorld) {
        const c = this.physicsWorld.createFixedCylinder(pos.x, pos.y + 0.12, pos.z, 1.3, 0.12, 'stone');
        result.colliders.push(c);
      }
    } else if (id === 'catapult') {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.35, 3.2),
        toonMat({ color: 0x78350f, flatShading: true })
      );
      base.position.y = 0.18;
      group.add(base);

      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.22, 2.8, 6),
        toonMat({ color: 0xd97706, flatShading: true })
      );
      arm.rotation.x = Math.PI / 4;
      arm.position.set(0, 1.1, -0.3);
      group.add(arm);

      // Launch cup
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.4, 0.5, 8),
        toonMat({ color: PALETTE.red, flatShading: true })
      );
      cup.position.set(0, 2.1, 0.7);
      group.add(cup);

      if (this.physicsWorld) {
        const c = this.physicsWorld.createStaticBox(pos.x, pos.y + 0.2, pos.z, 1.1, 0.2, 1.6, 'wood');
        result.colliders.push(c);
      }
    } else if (id === 'launchpad') {
      // ── Bouncy Launchpad: a bigger, hotter springpad that also flings props.
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(2.1, 2.3, 0.25, 12),
        toonMat({ color: 0x475569, flatShading: true })
      );
      base.position.y = 0.12;
      group.add(base);

      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.9, 2.0, 0.45, 12),
        new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xbe123c, emissiveIntensity: 0.7, flatShading: true })
      );
      pad.position.y = 0.38;
      group.add(pad);
      noOutline(pad);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.0, 0.18, 6, 14),
        toonMat({ color: PALETTE.yellow, flatShading: true })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.65;
      group.add(ring);

      if (world && world.springPads) {
        const padEntry = {
          x: pos.x, y: pos.y, z: pos.z,
          radius: 2.0,
          boostVelocity: 22.0,
          mesh: pad,
          rebound: 0,
          launchesItems: true,
        };
        world.springPads.push(padEntry);
        result.springPad = padEntry; // destroyStructure() unregisters this
      }

      if (this.physicsWorld) {
        const c = this.physicsWorld.createFixedCylinder(pos.x, pos.y + 0.2, pos.z, 2.0, 0.2, 'stone');
        result.colliders.push(c);
      }
    } else if (id === 'ziptower') {
      // ── Watchtower / Zipline Anchor: 6 m tower, spiral steps up, wire home.
      const woodMat = toonMat({ color: 0x78350f, flatShading: true });
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(2.0, 6.0, 2.0), woodMat);
      trunk.position.y = 3.0;
      group.add(trunk);

      const platform = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.3, 3.2),
        toonMat({ color: 0xb45309, flatShading: true })
      );
      platform.position.y = 6.1;
      group.add(platform);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(2.4, 1.6, 4),
        toonMat({ color: PALETTE.red, flatShading: true })
      );
      roof.position.y = 7.2;
      roof.rotation.y = Math.PI / 4;
      group.add(roof);

      const railMat = toonMat({ color: 0x92400e, flatShading: true });
      for (const [rx, rz] of [[0, 1.5], [0, -1.5], [1.5, 0], [-1.5, 0]]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(rx === 0 ? 3.2 : 0.15, 0.7, rz === 0 ? 3.2 : 0.15), railMat);
        rail.position.set(rx, 6.6, rz);
        group.add(rail);
      }

      // Spiral steps so Dweebs can actually climb to the platform.
      const stepAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
      const stepHeights = [1.5, 3.0, 4.5, 6.0];
      for (let i = 0; i < 4; i++) {
        const a = stepAngles[i];
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, 0.25, 1.3),
          toonMat({ color: 0xd97706, flatShading: true })
        );
        step.position.set(Math.cos(a) * 2.1, stepHeights[i], Math.sin(a) * 2.1);
        group.add(step);
        if (this.physicsWorld) {
          const c = this.physicsWorld.createStaticBox(
            pos.x + Math.cos(a) * 2.1, pos.y + stepHeights[i], pos.z + Math.sin(a) * 2.1,
            0.65, 0.12, 0.65, 'wood'
          );
          result.colliders.push(c);
        }
      }

      if (this.physicsWorld) {
        const c = this.physicsWorld.createFixedCylinder(pos.x, pos.y + 3.0, pos.z, 1.1, 3.0, 'wood');
        result.colliders.push(c);
        const pc = this.physicsWorld.createStaticBox(pos.x, pos.y + 6.1, pos.z, 1.6, 0.15, 1.6, 'wood');
        result.colliders.push(pc);
      }

      // The zipline wire: tower top down toward the village centre.
      const from = { x: pos.x, y: pos.y + 6.4, z: pos.z };
      let dirX = 0 - pos.x;
      let dirZ = 0 - pos.z;
      const dirLen = Math.hypot(dirX, dirZ) || 1;
      if (Math.hypot(pos.x, pos.z) < 0.5) { dirX = 0; dirZ = 1; }
      else { dirX /= dirLen; dirZ /= dirLen; }
      const wireLen = 13;
      const to = { x: pos.x + dirX * wireLen, y: pos.y + 0.4, z: pos.z + dirZ * wireLen };
      const wireDist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      const wireDir = {
        x: (to.x - from.x) / wireDist,
        y: (to.y - from.y) / wireDist,
        z: (to.z - from.z) / wireDist,
      };
      const wire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, wireDist, 5),
        toonMat({ color: 0x334155, flatShading: true })
      );
      wire.position.set((from.x + to.x) / 2 - pos.x, (from.y + to.y) / 2 - pos.y, (from.z + to.z) / 2 - pos.z);
      wire.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(wireDir.x, wireDir.y, wireDir.z)
      );
      group.add(wire);
      noOutline(wire);

      const anchor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.7, 0.9, 6),
        toonMat({ color: 0x475569, flatShading: true })
      );
      anchor.position.set(to.x - pos.x, 0.45, to.z - pos.z);
      group.add(anchor);

      const zipline = { from, to, dir: wireDir, length: wireDist, speed: 14 };
      result.zipline = zipline;
      if (world) {
        world.ziplines = world.ziplines || [];
        world.ziplines.push(zipline);
      }

      // ── Watchtower defense: the crow's nest spots nocturnal thieves and
      // pelts them with plush darts. Friendly beetles are never targeted.
      result.dartTimer = 0;
      result.dartInterval = 2.2;
      result.dartRange = 16;
      result.projectiles = [];
      result.update = (dt, ctx) => {
        const { world: w, colony } = ctx || {};
        result.dartTimer += dt;
        // Fly the darts already in the air.
        for (let i = result.projectiles.length - 1; i >= 0; i--) {
          const dart = result.projectiles[i];
          dart.life -= dt;
          dart.vel.y -= 10 * dt;
          dart.mesh.position.x += dart.vel.x * dt;
          dart.mesh.position.y += dart.vel.y * dt;
          dart.mesh.position.z += dart.vel.z * dt;
          let dead = dart.life <= 0 || dart.mesh.position.y < 0;
          if (!dead && w && w.critters) {
            for (let j = w.critters.length - 1; j >= 0; j--) {
              const c = w.critters[j];
              if (c.kind !== 'thief') continue; // watchtowers hunt thieves
              const d = Math.hypot(
                dart.mesh.position.x - c.x,
                dart.mesh.position.y - (c.y + 0.5),
                dart.mesh.position.z - c.z
              );
              if (d < 1.1) {
                c.hp -= 1;
                // Knock the thief back away from the tower.
                const kx = c.x - pos.x;
                const kz = c.z - pos.z;
                const kl = Math.hypot(kx, kz) || 1;
                c.x += (kx / kl) * 1.5;
                c.z += (kz / kl) * 1.5;
                dead = true;
                if (c.hp <= 0) {
                  if (w.removeCritter) w.removeCritter(c);
                  if (colony) {
                    colony.resources.gold = (colony.resources.gold || 0) + 1;
                    colony._addLog('🗼 The watchtower pelted a sneaky thief! +1 🪙');
                  }
                }
                break;
              }
            }
          }
          if (dead) {
            if (dart.mesh.parent) dart.mesh.parent.remove(dart.mesh);
            result.projectiles.splice(i, 1);
          }
        }
        // Look for a thief to pelt.
        if (!w || !w.critters || result.dartTimer < result.dartInterval) return;
        let target = null;
        let best = Infinity;
        for (const c of w.critters) {
          if (c.kind !== 'thief') continue;
          const d = Math.hypot(c.x - pos.x, c.z - pos.z);
          if (d < result.dartRange && d < best) { best = d; target = c; }
        }
        if (!target) return;
        result.dartTimer = 0;
        const fromT = { x: pos.x, y: pos.y + 6.4, z: pos.z };
        const dx = target.x - fromT.x;
        const dy = (target.y + 0.5) - fromT.y;
        const dz = target.z - fromT.z;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const speed = 20;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 6, 6),
          toonMat({ color: PALETTE.yellow, flatShading: true })
        );
        mesh.position.set(fromT.x, fromT.y, fromT.z);
        noOutline(mesh);
        if (result.scene) result.scene.add(mesh);
        result.projectiles.push({
          mesh,
          vel: { x: (dx / dist) * speed, y: (dy / dist) * speed + 4, z: (dz / dist) * speed },
          life: 2.5,
        });
      };
    } else if (id === 'berrymill') {
      // ── Automated Berry Gatherer / Windmill: blades spin, berries roll in.
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.6, 5.0, 8),
        toonMat({ color: 0xf1f5f9, flatShading: true })
      );
      tower.position.y = 2.5;
      group.add(tower);

      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, 1.2, 8),
        toonMat({ color: PALETTE.red, flatShading: true })
      );
      cap.position.y = 5.6;
      group.add(cap);

      const blades = new THREE.Group();
      blades.position.set(0, 5.2, 1.2);
      const bladeMat = toonMat({ color: 0xfde68a, flatShading: true });
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.12), bladeMat);
        blade.position.y = 1.5;
        const holder = new THREE.Group();
        holder.rotation.z = (i / 4) * Math.PI * 2;
        holder.add(blade);
        blades.add(holder);
      }
      group.add(blades);
      result.blades = blades;

      const basket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.6, 0.7, 8),
        toonMat({ color: 0x78350f, flatShading: true })
      );
      basket.position.set(1.8, 0.35, 0);
      group.add(basket);

      result.gatherTimer = 0;
      result.gatheredTotal = 0;
      result.update = (dt, ctx) => {
        const { world, colony } = ctx || {};
        // Wind spins the blades twice as fast — and doubles the gather rate.
        const windy = !!(world && world.weather === 'wind');
        if (result.blades) result.blades.rotation.z += dt * (windy ? 3.0 : 1.5);
        if (!world || !world.berryBushes) return;
        result.gatherTimer += dt * (windy ? 2 : 1);
        if (result.gatherTimer < 4) return;
        result.gatherTimer = 0;
        let took = 0;
        for (const bush of world.berryBushes) {
          const d = Math.hypot(bush.x - pos.x, bush.z - pos.z);
          if (d <= 14 && bush.available > 0) {
            bush.available -= 1;
            took += 1;
          }
        }
        if (took > 0) {
          result.gatheredTotal += took;
          if (colony) {
            const silos = world.buildingManager
              ? world.buildingManager.placedStructures.filter(s => s.id === 'silo')
              : [];
            colony.addResource('berries', took, silos);
          }
        }
      };

      if (this.physicsWorld) {
        const c = this.physicsWorld.createFixedCylinder(pos.x, pos.y + 2.5, pos.z, 1.4, 2.5, 'wood');
        result.colliders.push(c);
      }
    } else if (id === 'silo') {
      // ── Storage Silo: safe stockpile for timber, berries and stone.
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(1.8, 1.8, 3.6, 10),
        toonMat({ color: 0xe2e8f0, flatShading: true })
      );
      body.position.y = 1.8;
      group.add(body);

      const band = new THREE.Mesh(
        new THREE.TorusGeometry(1.82, 0.12, 6, 12),
        toonMat({ color: 0x64748b, flatShading: true })
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.8;
      group.add(band);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(2.0, 1.4, 10),
        toonMat({ color: PALETTE.orange, flatShading: true })
      );
      roof.position.y = 4.3;
      group.add(roof);

      // Fill gauge: a golden core that grows with how full the silo is.
      const fill = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.5, 3.0, 10),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0x92400e, emissiveIntensity: 0.4, flatShading: true, transparent: true, opacity: 0.85 })
      );
      fill.position.y = 1.8;
      fill.scale.y = 0.02;
      group.add(fill);
      result.fillMesh = fill;

      result.stored = { wood: 0, berries: 0, stone: 0 };
      result.capacity = SILO_CAPACITY;
      result._storedTotal = () => result.stored.wood + result.stored.berries + result.stored.stone;
      result._refreshFill = () => {
        if (!result.fillMesh) return;
        const frac = Math.min(1, result._storedTotal() / result.capacity);
        result.fillMesh.scale.y = Math.max(0.02, frac);
        result.fillMesh.position.y = 1.8 - (1 - result.fillMesh.scale.y) * 1.5;
      };
      result.deposit = (res, n) => {
        if (result.stored[res] === undefined) return 0;
        const room = result.capacity - result._storedTotal();
        const moved = Math.max(0, Math.min(n, room));
        result.stored[res] += moved;
        result._refreshFill();
        return moved;
      };
      result.withdraw = (res, n) => {
        const moved = Math.max(0, Math.min(n, result.stored[res] || 0));
        result.stored[res] -= moved;
        result._refreshFill();
        return moved;
      };

      if (this.physicsWorld) {
        const c = this.physicsWorld.createFixedCylinder(pos.x, pos.y + 1.8, pos.z, 1.8, 1.8, 'wood');
        result.colliders.push(c);
      }
    } else if (id === 'cannon') {
      // ── Defensive Toy Barricade / Cannon: wall + plush-ball lobber.
      const wallMat = toonMat({ color: 0x92400e, flatShading: true });
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.0, 0.9), wallMat);
      wall.position.y = 1.0;
      group.add(wall);

      for (const sx of [-1.4, 1.4]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 0.5), toonMat({ color: 0x78350f, flatShading: true }));
        post.position.set(sx, 1.3, 0);
        group.add(post);
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), toonMat({ color: 0x475569, flatShading: true }));
        spike.position.set(sx, 2.9, 0);
        spike.rotation.y = Math.PI / 4;
        group.add(spike);
      }

      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.5, 2.4, 8),
        toonMat({ color: 0x334155, flatShading: true })
      );
      barrel.rotation.x = Math.PI / 3.2;
      barrel.position.set(0, 2.6, 0.3);
      group.add(barrel);
      result.barrel = barrel;

      result.hp = 60;
      result.maxHp = 60;
      result.fireTimer = 0;
      result.fireInterval = 1.4;
      result.range = 20;
      result.projectiles = [];

      result.update = (dt, ctx) => {
        const { world, colony } = ctx || {};
        result.fireTimer += dt;
        // Fly the plush balls already in the air.
        for (let i = result.projectiles.length - 1; i >= 0; i--) {
          const ball = result.projectiles[i];
          ball.life -= dt;
          ball.vel.y -= 18 * dt;
          ball.mesh.position.x += ball.vel.x * dt;
          ball.mesh.position.y += ball.vel.y * dt;
          ball.mesh.position.z += ball.vel.z * dt;
          let dead = ball.life <= 0 || ball.mesh.position.y < 0;
          if (!dead && world && world.critters) {
            for (let j = world.critters.length - 1; j >= 0; j--) {
              const c = world.critters[j];
              if (c.hostile === false) continue; // cannons never fire on friendly beetles
              const d = Math.hypot(
                ball.mesh.position.x - c.x,
                ball.mesh.position.y - (c.y + 0.5),
                ball.mesh.position.z - c.z
              );
              if (d < 1.3) {
                c.hp -= 1;
                // Knock the critter back away from the cannon.
                const kx = c.x - pos.x;
                const kz = c.z - pos.z;
                const kl = Math.hypot(kx, kz) || 1;
                c.x += (kx / kl) * 2;
                c.z += (kz / kl) * 2;
                dead = true;
                if (c.hp <= 0) {
                  if (world.removeCritter) world.removeCritter(c);
                  if (colony) {
                    colony.resources.gold = (colony.resources.gold || 0) + 1;
                    colony._addLog(`💥 The plush cannon popped a mischief critter! +1 🪙`);
                  }
                }
                break;
              }
            }
          }
          if (dead) {
            if (ball.mesh.parent) ball.mesh.parent.remove(ball.mesh);
            result.projectiles.splice(i, 1);
          }
        }
        // Look for something to shoot at.
        if (!world || !world.critters || world.critters.length === 0) return;
        if (result.fireTimer < result.fireInterval) return;
        let target = null;
        let best = Infinity;
        for (const c of world.critters) {
          if (c.hostile === false) continue; // friendly beetles are not targets
          const d = Math.hypot(c.x - pos.x, c.z - pos.z);
          if (d < result.range && d < best) { best = d; target = c; }
        }
        if (!target) return;
        result.fireTimer = 0;
        const from = { x: pos.x, y: pos.y + 3.0, z: pos.z };
        const dx = target.x - from.x;
        const dy = (target.y + 0.5) - from.y;
        const dz = target.z - from.z;
        const dist = Math.hypot(dx, dy, dz) || 1;
        // A lobbed arc (speed 26 + a little loft) so the ball still lands on
        // ground targets at the edge of its range instead of dropping short.
        const speed = 26;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 8, 8),
          toonMat({ color: PALETTE.pink, flatShading: true })
        );
        mesh.position.set(from.x, from.y, from.z);
        noOutline(mesh);
        if (result.scene) result.scene.add(mesh);
        result.projectiles.push({
          mesh,
          vel: { x: (dx / dist) * speed, y: (dy / dist) * speed + 6, z: (dz / dist) * speed },
          life: 3,
        });
      };

      if (this.physicsWorld) {
        const c = this.physicsWorld.createStaticBox(pos.x, pos.y + 1.0, pos.z, 1.7, 1.0, 0.45, 'wood');
        result.colliders.push(c);
      }
    } else if (id === 'tradepost') {
      // ── Trading Post: a striped merchant stall. Its presence is what
      // summons the traveling caravan (see Meadowlands._updateMerchant).
      const postMat = toonMat({ color: 0x78350f, flatShading: true });
      for (const [px, pz] of [[-1.6, -0.9], [1.6, -0.9], [-1.6, 0.9], [1.6, 0.9]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.6, 6), postMat);
        post.position.set(px, 1.3, pz);
        group.add(post);
      }
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, 0.18, 2.8),
        toonMat({ color: 0xef4444, flatShading: true })
      );
      awning.position.y = 2.7;
      awning.rotation.x = -0.12;
      group.add(awning);
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, 0.19, 0.7),
        toonMat({ color: 0xfef3c7, flatShading: true })
      );
      stripe.position.set(0, 2.7, -0.7);
      stripe.rotation.x = -0.12;
      group.add(stripe);
      const counter = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 1.0, 1.2),
        toonMat({ color: 0xb45309, flatShading: true })
      );
      counter.position.y = 0.5;
      group.add(counter);
      for (let i = 0; i < 3; i++) {
        const crate = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.7, 0.7),
          toonMat({ color: 0xd97706, flatShading: true })
        );
        crate.position.set(-1.1 + i * 1.1, 1.35, 0);
        crate.rotation.y = i * 0.4;
        group.add(crate);
      }
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.7, 0.1),
        toonMat({ color: PALETTE.yellow, flatShading: true })
      );
      sign.position.set(0, 2.1, 1.15);
      group.add(sign);

      if (this.physicsWorld) {
        const c = this.physicsWorld.createStaticBox(pos.x, pos.y + 0.5, pos.z, 1.6, 0.5, 0.6, 'wood');
        result.colliders.push(c);
      }
    } else if (id === 'bakery') {
      // ── Berry Bakery: turns 3 berries into 1 gold every 25 seconds.
      const hut = new THREE.Mesh(
        new THREE.CylinderGeometry(1.9, 2.1, 2.6, 10),
        toonMat({ color: 0xfde68a, flatShading: true })
      );
      hut.position.y = 1.3;
      group.add(hut);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(2.3, 1.4, 10),
        toonMat({ color: PALETTE.red, flatShading: true })
      );
      roof.position.y = 3.3;
      group.add(roof);
      const chimney = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.35, 1.8, 6),
        toonMat({ color: 0x78716c, flatShading: true })
      );
      chimney.position.set(0.9, 3.6, 0);
      group.add(chimney);
      // A golden pie on a stick out front — the universal sign of bakery.
      const piePole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5),
        toonMat({ color: 0x78350f, flatShading: true })
      );
      piePole.position.set(2.4, 0.8, 0);
      group.add(piePole);
      const pie = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.45, 0.25, 8),
        toonMat({ color: 0xf59e0b, flatShading: true })
      );
      pie.position.set(2.4, 1.7, 0);
      group.add(pie);

      result.bakeTimer = 0;
      result.bakes = 0;
      result.update = (dt, ctx) => {
        const { colony } = ctx || {};
        if (!colony) return;
        result.bakeTimer += dt;
        if (result.bakeTimer < 25) return;
        result.bakeTimer = 0;
        if ((colony.resources.berries || 0) >= 3) {
          colony.resources.berries -= 3;
          colony.addResource('gold', 1, []);
          result.bakes += 1;
        }
      };

      if (this.physicsWorld) {
        const c = this.physicsWorld.createFixedCylinder(pos.x, pos.y + 1.3, pos.z, 2.0, 1.3, 'wood');
        result.colliders.push(c);
      }
    } else if (id === 'garden') {
      // ── Berry Garden: a fenced plot that sprouts 3 fresh berry bushes.
      // Bushes are planted on first placement only — restoring from a save
      // must NOT plant another 3 every load (fromSave guard).
      const soil = new THREE.Mesh(
        new THREE.BoxGeometry(5.0, 0.25, 5.0),
        toonMat({ color: 0x65a30d, flatShading: true })
      );
      soil.position.y = 0.12;
      group.add(soil);
      const fenceMat = toonMat({ color: 0x92400e, flatShading: true });
      for (const [fx, fz, w, d] of [
        [0, -2.5, 5.2, 0.15], [0, 2.5, 5.2, 0.15],
        [-2.5, 0, 0.15, 5.2], [2.5, 0, 0.15, 5.2],
      ]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), fenceMat);
        rail.position.set(fx, 0.75, fz);
        group.add(rail);
      }
      for (const [fx, fz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.1, 5), fenceMat);
        post.position.set(fx, 0.55, fz);
        group.add(post);
      }
      if (!fromSave && world && typeof world._createBerryBush === 'function') {
        const gy = world._getHeight ? world._getHeight(pos.x, pos.z) : pos.y;
        world._createBerryBush(pos.x - 1.4, gy, pos.z);
        world._createBerryBush(pos.x + 1.4, gy, pos.z + 0.8);
        world._createBerryBush(pos.x, gy, pos.z - 1.5);
      }
    }

    // Torchlights flank the buildings so the village glows at night.
    if (world && typeof world.addTorchlight === 'function' &&
      ['tent', 'silo', 'ziptower', 'berrymill', 'firepit', 'tradepost', 'bakery'].includes(id)) {
      world.addTorchlight(pos.x + 2.4, pos.y, pos.z + 1.2);
      world.addTorchlight(pos.x - 2.4, pos.y, pos.z - 1.2);
    }

    return result;
  }
}
