// MimicLab.js — First-Person Toy Lab & Mutation Sandbox (Game 4)
//
// In first-person, you demonstrate physical antics (throwing, stacking, jumping, kicking).
// Crowds of googly-eyed Dweeb pupils watch you, take notes, and enthusiastically try to copy
// and hilariously mutate that action.

import * as THREE from 'three';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';

export const MUTATION_TYPES = [
  { id: 'overachiever', name: 'OVER-ACHIEVER', blurb: 'Winds up 300% too hard and spins like a tornado!' },
  { id: 'clumsy', name: 'CLUMSY SLAPSTICK', blurb: 'Stumbles on air, drops the prop on their foot, and squashes flat!' },
  { id: 'substitute', name: 'MAD SCIENTIST', blurb: 'Substituted the item with an explosive barrel or anvil!' },
  { id: 'swarm', name: 'CHAOS SWARM', blurb: 'Multiple Dweebs try to do it simultaneously and yeet each other!' },
];

export class MimicLab {
  constructor(physicsWorld, scene) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.colliders = [];
    this.props = [];
    this.clock = 0;
    this.lastAction = null;
    this.activeMutation = null;
    this.mutationCooldown = 0;

    this._buildAmphitheater();
    this._spawnToyTrunk();
  }

  _buildAmphitheater() {
    const floorMat = toonMat({ color: 0xfef08a, flatShading: true });
    const woodMat = toonMat({ color: 0x78350f, flatShading: true });

    // Central circular arena floor (r = 18)
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(18, 18.5, 0.8, 24), floorMat);
    floor.position.y = -0.4;
    this.group.add(floor);
    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(0, -0.4, 0, 18, 0.4, 'toy');
    }

    // Checkered center testing rug
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(6, 16),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.5, flatShading: true })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.02;
    this.group.add(rug);
    noOutline(rug);

    // Tiered wooden bleachers encircling the lab
    for (let tier = 0; tier < 3; tier++) {
      const radius = 17 + tier * 1.8;
      const height = 0.6 + tier * 0.7;
      const bleacher = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.6, 6, 24),
        woodMat
      );
      bleacher.rotation.x = Math.PI / 2;
      bleacher.position.y = height;
      this.group.add(bleacher);

      if (this.physicsWorld) {
        this.physicsWorld.createFixedCylinder(0, height, 0, radius, 0.35, 'wood');
      }
    }

    // Sunny overhead lab lighting
    const light = new THREE.DirectionalLight(0xfffaed, 2.8);
    light.position.set(12, 22, 10);
    this.group.add(light);
  }

  _spawnToyTrunk() {
    // The Toy Trunk where props replenish
    const trunkX = 0, trunkZ = -10;
    const trunk = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 1.4, 2.2),
      toonMat({ color: 0xb45309, flatShading: true })
    );
    trunk.position.set(trunkX, 0.7, trunkZ);
    this.group.add(trunk);
    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(trunkX, 0.7, trunkZ, 2.1, 0.7, 1.1, 'wood');
    }

    // Spawn starting fun physics sandbox props
    this._spawnProp('watermelon', 0, 1.5, -8, 'fruit', 2.0);
    this._spawnProp('bowlingBall', -2.5, 1.5, -7, 'metal', 4.5);
    this._spawnProp('crate', 2.5, 1.5, -7, 'wood', 3.0);
    this._spawnProp('rubberChicken', -1.2, 1.5, -6, 'rubber', 0.8);
    this._spawnProp('explosiveBarrel', 1.5, 1.5, -6, 'toy', 2.5, true);
    this._spawnProp('giantDie', -3.5, 1.5, -5, 'toy', 2.0);
  }

  _spawnProp(name, x, y, z, material, mass, isExplosive = false) {
    let geo;
    let mat = toonMat({ color: PALETTE.red, flatShading: true });
    if (name === 'watermelon') {
      geo = new THREE.SphereGeometry(0.65, 8, 8);
      mat = toonMat({ color: 0x16a34a, flatShading: true });
    } else if (name === 'bowlingBall') {
      geo = new THREE.SphereGeometry(0.6, 12, 12);
      mat = toonMat({ color: 0x1e293b, flatShading: true });
    } else if (name === 'crate' || name === 'giantDie') {
      geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
      mat = toonMat({ color: name === 'giantDie' ? 0xffffff : 0xca8a04, flatShading: true });
    } else if (name === 'rubberChicken') {
      geo = new THREE.CylinderGeometry(0.2, 0.35, 1.2, 6);
      mat = toonMat({ color: PALETTE.yellow, flatShading: true });
    } else {
      geo = new THREE.CylinderGeometry(0.55, 0.55, 1.3, 8);
      mat = toonMat({ color: PALETTE.red, flatShading: true });
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.group.add(mesh);

    let body = null;
    if (this.physicsWorld) {
      const b = this.physicsWorld.createDynamicBody(x, y, z, 'sphere', { radius: 0.6 }, { material, mass });
      body = b.body;
    }

    this.props.push({ name, mesh, body, isExplosive });
  }

  update(dt, player, dweebs = [], combat = null) {
    this.clock += dt;
    this.mutationCooldown = Math.max(0, this.mutationCooldown - dt);

    // Sync props physics
    for (const p of this.props) {
      if (p.body && p.mesh) {
        const t = p.body.translation();
        const r = p.body.rotation();
        p.mesh.position.set(t.x, t.y, t.z);
        p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }

    if (!player || !player.body) return;

    // Detect Player Actions
    const playerVel = player.body.linvel();
    const speed = Math.hypot(playerVel.x, playerVel.z);

    // 1. High Jump Action Detected
    if (playerVel.y > 9.0 && this.mutationCooldown <= 0) {
      this.triggerDemonstration('HIGH JUMP / DIVE', dweebs);
    }

    // 2. Heavy Throw Action Detected (checked via any prop moving fast away from player)
    for (const p of this.props) {
      if (p.body) {
        const pv = p.body.linvel();
        const pSpeed = Math.hypot(pv.x, pv.y, pv.z);
        if (pSpeed > 14.0 && this.mutationCooldown <= 0) {
          this.triggerDemonstration(`MEGA THROW (${p.name.toUpperCase()})`, dweebs);
          break;
        }
      }
    }

    // 3. Punch / Attack Action Detected
    if (player.punchTime !== undefined && player.punchTime < 0.15 && this.mutationCooldown <= 0) {
      this.triggerDemonstration('MEGA BONK / PUNCH', dweebs);
    }

    // 4. Drop Kick / Slam Action Detected
    if ((player.dropKicking || player.groundSlamming) && this.mutationCooldown <= 0) {
      this.triggerDemonstration('FLYING DROP-KICK', dweebs);
    }
  }

  triggerDemonstration(actionName, dweebs) {
    this.lastAction = actionName;
    this.mutationCooldown = 6.0;

    // Pick random mutation archetype
    const mut = MUTATION_TYPES[Math.floor(Math.random() * MUTATION_TYPES.length)];
    this.activeMutation = mut;

    // Show on Announcer HUD
    const announcer = document.getElementById('announcer');
    if (announcer) {
      announcer.className = 'show trick';
      announcer.innerHTML = `MIMIC: ${mut.name}!<small>${mut.blurb}</small>`;
    }

    // Choose 1 or 2 Dweeb pupils to execute the mutated copycat action
    const pupils = dweebs.filter(d => !d.isPlayer);
    if (pupils.length === 0) return;

    const pupil = pupils[Math.floor(Math.random() * pupils.length)];
    if (!pupil.body) return;

    if (mut.id === 'overachiever') {
      // Wind up and blast upward into the stratosphere!
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 8, y: 28.0, z: (Math.random() - 0.5) * 8 }, true);
      if (pupil.onBounce) pupil.onBounce();
    } else if (mut.id === 'clumsy') {
      // Trip, tumble, and ragdoll
      pupil.body.setLinvel({ x: 0, y: 4.0, z: 0 }, true);
      pupil.ragdolling = true;
      pupil.hitstun = 2.5;
    } else if (mut.id === 'substitute') {
      // Blast forward carrying an explosive
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 16, y: 8.0, z: (Math.random() - 0.5) * 16 }, true);
    } else if (mut.id === 'swarm') {
      // Launch all pupils in a comedic fountain burst!
      for (const p of pupils) {
        if (p.body) {
          p.body.setLinvel({
            x: (Math.random() - 0.5) * 12,
            y: 16 + Math.random() * 8,
            z: (Math.random() - 0.5) * 12,
          }, true);
        }
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const c of this.colliders) {
      if (this.physicsWorld && c.body) {
        this.physicsWorld.world.removeRigidBody(c.body);
      }
    }
  }
}
