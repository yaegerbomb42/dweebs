// MimicLab.js — First-Person Toy Lab & Mutation Sandbox (Game 4)
//
// In first-person, you demonstrate physical antics (throwing, stacking, jumping, kicking).
// Crowds of googly-eyed Dweeb pupils watch you, take notes, and enthusiastically try to copy
// and hilariously mutate that action.

import * as THREE from 'three';
import { toonMat, noOutline } from '../render/Toon.js';

export const MUTATION_TYPES = [
  { id: 'overachiever', name: 'OVER-ACHIEVER', blurb: 'Winds up 300% too hard and spins like a tornado!' },
  { id: 'clumsy', name: 'CLUMSY SLAPSTICK', blurb: 'Stumbles on air, drops the prop on their foot, and squashes flat!' },
  { id: 'substitute', name: 'MAD SCIENTIST', blurb: 'Substituted the item with an explosive barrel or anvil!' },
  { id: 'swarm', name: 'CHAOS SWARM', blurb: 'Multiple Dweebs try to do it simultaneously and yeet each other!' },
];

export class MimicLab {
  constructor(physicsWorld, scene, options = {}) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.hud = options.hud || null;
    this.fx = options.fx || null;
    this.audio = options.audio || null;
    this.arena = options.arena || null;   // props are real arena items: grab / throw / explode all work
    this.combat = null;
    this.items = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.colliders = [];
    this.bodyIds = [];
    this.props = [];
    this.clock = 0;
    this.lastAction = null;
    this.activeMutation = null;
    this.mutationCooldown = 0;
    this.chain = 0;
    this.chainTimer = 0;
    this.hintEl = null;
    this.hintTimer = null;

    // Edge-detection state for real player demonstrations.
    this._wasJumpRising = false;
    this._wasDiving = false;
    this._wasRagdolling = false;
    this._prevHitstun = 0;
    this._prevHeld = null;

    this._buildAmphitheater();
    this._spawnToyTrunk();
    this._showHint();
  }

  _trackBody(result) {
    if (result?.id != null) this.bodyIds.push(result.id);
    return result;
  }

  _showHint() {
    if (typeof document === 'undefined' || !document.body) return;
    const el = document.createElement('div');
    el.textContent = "Do something dumb. They'll copy it... badly.";
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:118px',
      'transform:translateX(-50%)',
      'z-index:35',
      'padding:8px 16px',
      'border-radius:999px',
      'background:rgba(23,23,23,.78)',
      'border:2px solid rgba(250,204,21,.75)',
      'color:#fef9c3',
      'font:700 14px/1.3 "Nunito",system-ui,sans-serif',
      'letter-spacing:.02em',
      'text-align:center',
      'pointer-events:none',
      'text-shadow:0 2px 0 rgba(0,0,0,.45)',
      'box-shadow:0 6px 18px rgba(0,0,0,.28)',
    ].join(';');
    document.body.appendChild(el);
    this.hintEl = el;
    this.hintTimer = setTimeout(() => {
      this.hintEl?.remove();
      this.hintEl = null;
      this.hintTimer = null;
    }, 7000);
  }

  _announce(text, style = 'trick', duration = 1.8) {
    if (this.hud?.announce) {
      this.hud.announce(text, style, duration);
      return;
    }
    const announcer = document.getElementById('announcer');
    if (announcer) {
      announcer.className = `show ${style}`;
      announcer.innerHTML = text;
    }
  }

  _buildAmphitheater() {
    const floorMat = toonMat({ color: 0xfef08a, flatShading: true });
    const woodMat = toonMat({ color: 0x78350f, flatShading: true });

    // The stadium stage is the lab floor; everything here is decoration on top of it.
    // Checkered center testing rug
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(6, 16),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.5, flatShading: true })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.03;
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
      this._trackBody(this.physicsWorld.createStaticBox(trunkX, 0.7, trunkZ, 2.1, 0.7, 1.1, 'wood'));
    }

    // Starting toys, as real arena items so the player can grab, throw and blow them up
    for (const [key, x, z] of [['watermelon', 0, -8], ['bowlingBall', -2.5, -7], ['crate', 2.5, -7],
      ['rubberChicken', -1.2, -6], ['explosiveBarrel', 1.5, -6], ['giantDie', -3.5, -5]]) this._spawnItem(key, x, 1.6, z);
  }

  _spawnItem(key, x, y, z) {
    if (!this.arena) return null;
    try {
      const o = this.arena.spawnItem(key, { x, y, z });
      if (o) this.items.push(o);
      return o;
    } catch { return null; }
  }

  update(dt, player, dweebs = [], combat = null) {
    this.clock += dt;
    if (combat) this.combat = combat;
    if (this.arena) this.items = this.items.filter(o => this.arena.objects.includes(o));
    this.mutationCooldown = Math.max(0, this.mutationCooldown - dt);
    if (this.chainTimer > 0) {
      this.chainTimer = Math.max(0, this.chainTimer - dt);
      if (this.chainTimer <= 0) this.chain = 0;
    }

    if (!player || !player.body || !player.active) return;

    // Jump (the Dweeb sets jumpRising for both ground jumps and double jumps).
    if (player.jumpRising && !this._wasJumpRising) {
      this.triggerDemonstration(player.jumpsLeft === 0 ? 'DOUBLE JUMP' : 'BIG JUMP', dweebs);
    }
    this._wasJumpRising = !!player.jumpRising;

    // Ground dive.
    const diving = player.diveTimer > 0;
    if (diving && !this._wasDiving) this.triggerDemonstration('FLYING DIVE', dweebs);
    this._wasDiving = diving;

    // Getting launched: a fresh hit bumps hitstun; big ones also start a ragdoll.
    const launched = player.hitstun > this._prevHitstun + 0.05;
    if (launched || (player.ragdolling && !this._wasRagdolling)) {
      this.triggerDemonstration('GETTING LAUNCHED', dweebs);
    }
    this._prevHitstun = player.hitstun || 0;
    this._wasRagdolling = !!player.ragdolling;

    // Grab / throw transitions. A drop (Q) throws nothing, so only count fast releases.
    const held = player.held;
    if (held && !this._prevHeld) {
      this.triggerDemonstration(`GRAB (${held.kind === 'dweeb' ? 'A PUPIL' : 'A TOY'})`, dweebs);
    } else if (!held && this._prevHeld) {
      const ref = this._prevHeld.ref;
      if (ref?.body) {
        const v = ref.body.linvel();
        if (Math.hypot(v.x, v.y, v.z) > 7) {
          this.triggerDemonstration(`MEGA THROW (${this._prevHeld.kind === 'dweeb' ? 'PUPIL' : 'TOY'})`, dweebs);
        }
      }
    }
    this._prevHeld = held ? { kind: held.kind, ref: held.ref } : null;
  }

  triggerDemonstration(actionName, dweebs = []) {
    if (this.mutationCooldown > 0) return false;

    this.lastAction = actionName;
    this.mutationCooldown = 2.5;

    // Chain hype: repeated demos inside the 7s window build a bigger MIMIC combo.
    this.chain = this.chainTimer > 0 ? Math.min(9, this.chain + 1) : 1;
    this.chainTimer = 7.0;

    // At chain 3+, the pupils attempt the spectacular mutations only.
    const pool = this.chain >= 3
      ? MUTATION_TYPES.filter(m => m.id === 'swarm' || m.id === 'substitute')
      : MUTATION_TYPES;
    const mut = pool[Math.floor(Math.random() * pool.length)] || MUTATION_TYPES[0];
    this.activeMutation = mut;

    const style = this.chain >= 3 ? 'danger' : 'trick';
    this._announce(
      `MIMIC x${this.chain}!<small>${actionName} → ${mut.name}: ${mut.blurb}</small>`,
      style,
      2.0
    );
    this.audio?.playCheer?.(Math.min(1, 0.3 + this.chain * 0.12));

    // Choose a Dweeb pupil to execute the mutated copycat action.
    const pupils = dweebs.filter(d => !d.isPlayer && d.active && d.body);
    if (pupils.length === 0) return true;

    const pupil = pupils[Math.floor(Math.random() * pupils.length)];

    if (mut.id === 'overachiever') {
      // Wind up and blast upward into the stratosphere!
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 8, y: 28.0, z: (Math.random() - 0.5) * 8 }, true);
      if (pupil.onBounce) pupil.onBounce();
    } else if (mut.id === 'clumsy') {
      // Trip, tumble, and ragdoll
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 3, y: 5.0, z: (Math.random() - 0.5) * 3 }, true);
      pupil.startRagdoll?.(1.8, 10);
    } else if (mut.id === 'substitute') {
      // Swapped the prop for an explosive barrel… with the fuse already lit
      const pp = pupil.getPosition();
      const barrel = this._spawnItem('explosiveBarrel', pp.x, pp.y + 1.6, pp.z);
      if (barrel?.body) {
        barrel.body.setLinvel({ x: (Math.random() - 0.5) * 6, y: 6, z: (Math.random() - 0.5) * 6 }, true);
        this.combat?.lightFuse?.(barrel, pupil, 1.4);
      }
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 10, y: 7.0, z: (Math.random() - 0.5) * 10 }, true);
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
    return true;
  }

  dispose() {
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    if (this.hintEl) {
      this.hintEl.remove();
      this.hintEl = null;
    }

    // Remove every body this lab created, not just the dynamic props.
    if (this.physicsWorld) {
      for (const id of this.bodyIds) this.physicsWorld.removeBody(id);
    }
    this.bodyIds.length = 0;

    // Legacy collider entries (if any code pushed them manually).
    for (const c of this.colliders) {
      if (!this.physicsWorld || !c?.body) continue;
      if (c.id) this.physicsWorld.removeBody(c.id);
      else this.physicsWorld.world.removeRigidBody(c.body);
    }
    this.colliders.length = 0;
    this.props.length = 0;
    if (this.arena) for (const o of this.items) if (this.arena.objects.includes(o)) this.arena.removeObject(o);
    this.items = [];

    this.group.traverse(obj => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m?.dispose?.();
    });
    this.group.clear();
    this.scene.remove(this.group);
  }
}
