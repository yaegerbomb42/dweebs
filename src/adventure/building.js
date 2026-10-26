// building.js — Toy Construction & Blueprint System for Dweeb Civilization
//
// Allows the player (and master builder Dweebs) to place physical contraptions
// in the living world: Springboard Pads, Wooden Ramps, Play Tents, Firepits, and Catapults.

import * as THREE from 'three';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';

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
];

export class BuildingManager {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
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

  update(dt, player, terrainMesh) {
    this.clock += dt;
    if (!this.activeBlueprint || !this.ghostMesh || !player || !player.body) return;

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

  confirmPlacement(colony, world) {
    if (!this.activeBlueprint || !this.isValidPlacement) return null;
    const bp = this.activeBlueprint;

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

    const pos = this.placementPos.clone();
    const structure = this._instantiateStructure(bp.id, pos, world);
    this.placedStructures.push(structure);

    if (colony) {
      colony._addLog(`🔨 Constructed ${bp.name} in the settlement!`);
    }

    this.cancelPlacing();
    return { success: true, structure };
  }

  _createGhostMesh(id) {
    const group = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      wireframe: true,
    });

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
    }

    noOutline(group);
    return group;
  }

  _instantiateStructure(id, pos, world) {
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);

    const result = { id, pos, group, colliders: [] };

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
        world.springPads.push({
          x: pos.x, y: pos.y, z: pos.z,
          radius: 1.6,
          boostVelocity: 18.0,
          mesh: pad,
          rebound: 0,
        });
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
    }

    return result;
  }
}
