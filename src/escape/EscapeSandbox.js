// EscapeSandbox.js — Physical Escape Room Without One Solution
//
// Every puzzle is a physical sandbox with 4 distinct, simultaneously valid ways out:
//   1. Demolition: Breakable door hinges (blow off with explosive barrels / anvils)
//   2. Acrobatics: High open ceiling vent (stack crates / bounce off Dweeb heads)
//   3. Counterbalance: Heavy pulley basket (load boulders / heavy props to hoist gate)
//   4. Circuit: Carry magnetic power core into the generator socket

import * as THREE from 'three';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';

export class EscapeSandbox {
  constructor(physicsWorld, scene) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.colliders = [];
    this.interactiveObjects = [];
    this.clock = 0;
    this.escaped = false;
    this.escapeMethod = null;

    // Door State
    this.doorHp = { hingeL: 75, hingeR: 75 };
    this.doorBlown = false;
    this.doorMesh = null;
    this.doorBody = null;

    // Counterweight State
    this.basketMesh = null;
    this.basketWeight = 0;
    this.basketTargetWeight = 8.5; // requires ~3 heavy props or 2 Dweebs + props
    this.pulleyGateProgress = 0;

    // Battery / Power Circuit State
    this.batterySocketed = false;
    this.batteryMesh = null;
    this.batteryBody = null;
    this.conduitGlow = null;

    this._buildChamber();
  }

  _buildChamber() {
    this._createRoomShell();
    this._createVaultDoorAndHinges();
    this._createHighVentilationExit();
    this._createCounterweightPulley();
    this._createPowerCircuit();
    this._spawnPhysicsSandboxProps();
  }

  _createRoomShell() {
    const wallMat = toonMat({ color: 0x475569, flatShading: true });
    const floorMat = toonMat({ color: 0x64748b, flatShading: true });

    // Chamber Floor (24m x 32m)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 1.0, 32), floorMat);
    floor.position.set(0, -0.5, 0);
    this.group.add(floor);
    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(0, -0.5, 0, 12, 0.5, 16, 'stone');
    }

    // Left & Right Walls
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 32), wallMat);
    wallL.position.set(-12, 6, 0);
    const wallR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 32), wallMat);
    wallR.position.set(12, 6, 0);
    this.group.add(wallL, wallR);
    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(-12, 6, 0, 0.6, 6, 16, 'stone');
      this.physicsWorld.createStaticBox(12, 6, 0, 0.6, 6, 16, 'stone');
    }

    // Back Wall (z = 16)
    const wallBack = new THREE.Mesh(new THREE.BoxGeometry(24, 12, 1.2), wallMat);
    wallBack.position.set(0, 6, 16);
    this.group.add(wallBack);
    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(0, 6, 16, 12, 6, 0.6, 'stone');
    }

    // Front Exit Wall (z = -16) with doorway arch
    const wallFrontL = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 1.2), wallMat);
    wallFrontL.position.set(-8, 6, -16);
    const wallFrontR = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 1.2), wallMat);
    wallFrontR.position.set(8, 6, -16);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 1.2), wallMat);
    lintel.position.set(0, 10.4, -16);
    this.group.add(wallFrontL, wallFrontR, lintel);

    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(-8, 6, -16, 4, 6, 0.6, 'stone');
      this.physicsWorld.createStaticBox(8, 6, -16, 4, 6, 0.6, 'stone');
      this.physicsWorld.createStaticBox(0, 10.4, -16, 4, 1.6, 0.6, 'stone');
    }

    // Outside Sunny Courtyard beyond the door (Freedom Zone at z < -18)
    const yardMat = toonMat({ color: 0x5ee06a, flatShading: true });
    const yard = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 16), yardMat);
    yard.position.set(0, -0.4, -24);
    this.group.add(yard);
    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(0, -0.4, -24, 15, 0.4, 8, 'stone');
    }

    // Warm Chamber Chandelier Light
    const light = new THREE.PointLight(0xfff3c4, 3.2, 30);
    light.position.set(0, 8, 0);
    this.group.add(light);
  }

  // ─── 1. The Vault Door & Destructible Hinges (Demolition Path) ───

  _createVaultDoorAndHinges() {
    const doorGeo = new THREE.BoxGeometry(7.6, 6.8, 0.6);
    const doorMat = toonMat({ color: 0x78350f, flatShading: true });
    const doorMesh = new THREE.Mesh(doorGeo, doorMat);
    doorMesh.position.set(0, 3.4, -16);
    this.group.add(doorMesh);
    this.doorMesh = doorMesh;

    // Destructible Hinges (Left & Right)
    const hingeMat = toonMat({ color: 0xd97706, flatShading: true });
    const hingeL = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 8), hingeMat);
    hingeL.position.set(-3.7, 4.5, -15.6);
    const hingeR = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 8), hingeMat);
    hingeR.position.set(3.7, 4.5, -15.6);
    this.group.add(hingeL, hingeR);
    this.hingeMeshes = { L: hingeL, R: hingeR };

    if (this.physicsWorld) {
      // Kinematic door collider initially; breaks into dynamic ragdoll when hinges blow!
      this.doorBody = this.physicsWorld.createKinematicShape(0, 3.4, -16, 'box', {
        hx: 3.8, hy: 3.4, hz: 0.3
      }, 0.2, 'wood');
    }
  }

  // ─── 2. High Ventilation Skylight (Stacking / Acrobatics Path) ───

  _createHighVentilationExit() {
    // Open grate at y = 7.8 above the door
    const ventFrame = new THREE.Mesh(
      new THREE.BoxGeometry(6.0, 0.4, 1.4),
      toonMat({ color: 0x334155, flatShading: true })
    );
    ventFrame.position.set(0, 7.2, -16);
    this.group.add(ventFrame);

    // Green outdoor sunlight pouring through the high grate
    const sunbeam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 4.2, 8, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    sunbeam.rotation.x = Math.PI / 6;
    sunbeam.position.set(0, 5.0, -12);
    this.group.add(sunbeam);
    noOutline(sunbeam);
  }

  // ─── 3. Counterweight Pulley Basket (Weight Path) ───

  _createCounterweightPulley() {
    const basketX = -8.0;
    const basketZ = 6.0;

    const basketGroup = new THREE.Group();
    basketGroup.position.set(basketX, 3.8, basketZ);

    // Woven Wooden Basket Platform
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 1.8, 0.4, 10),
      toonMat({ color: 0xb45309, flatShading: true })
    );
    basketGroup.add(base);

    // Side railing
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.25, 6, 12),
      toonMat({ color: 0x78350f, flatShading: true })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.5;
    basketGroup.add(rim);

    // Cable reaching up to the ceiling pulley
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 8, 6),
      toonMat({ color: 0x1e293b, flatShading: true })
    );
    cable.position.y = 4.2;
    basketGroup.add(cable);

    this.group.add(basketGroup);
    this.basketMesh = basketGroup;

    if (this.physicsWorld) {
      this.basketBody = this.physicsWorld.createKinematicShape(basketX, 3.8, basketZ, 'cylinder', {
        radius: 2.0, halfHeight: 0.2
      }, 0.1, 'wood');
    }
  }

  // ─── 4. Power Circuit Socket & Magnetic Core (Circuit Path) ───

  _createPowerCircuit() {
    const socketX = 6.5;
    const socketZ = -15.2;

    const socket = new THREE.Group();
    socket.position.set(socketX, 0.6, socketZ);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.2, 1.2),
      toonMat({ color: 0x334155, flatShading: true })
    );
    socket.add(base);

    // Glowing core slot
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0369a1, emissiveIntensity: 0.4, flatShading: true })
    );
    slot.position.y = 0.5;
    socket.add(slot);
    noOutline(slot);
    this.socketMesh = slot;

    // Glowing conduit wire leading to the door lock
    const conduit = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.15, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.6, flatShading: true })
    );
    conduit.position.set(-2.2, 0.6, 0);
    socket.add(conduit);
    this.conduitGlow = conduit;

    this.group.add(socket);
    this.socketPos = new THREE.Vector3(socketX, 1.1, socketZ);

    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(socketX, 0.6, socketZ, 1.1, 0.6, 0.6, 'stone');
    }
  }

  // ─── 5. Spawn Physics Props in Chamber ───

  _spawnPhysicsSandboxProps() {
    // 1. Heavy Power Core Battery (For Circuit Path)
    this._spawnPowerBattery(0, 1.2, 8);

    // 2. Heavy Boulders & Anvils (For Counterweight or Throwing)
    if (this.physicsWorld) {
      // Stackable Wooden Crates for Climbing
      this._spawnCrate(-3, 1, -8);
      this._spawnCrate(-1, 1, -8);
      this._spawnCrate(-2, 2.2, -8);
      this._spawnCrate(2, 1, -6);
      this._spawnCrate(2, 2.2, -6);

      // Explosive Barrels for Demolition Path
      this._spawnExplosiveBarrel(6, 1, 4);
      this._spawnExplosiveBarrel(-7, 1, 2);

      // Heavy Boulder for Counterweight
      this._spawnBoulder(-6, 1, 8);
      this._spawnBoulder(4, 1, 10);
    }
  }

  _spawnPowerBattery(x, y, z) {
    const battery = new THREE.Group();
    battery.position.set(x, y, z);

    const casing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 1.0, 8),
      toonMat({ color: 0xf59e0b, flatShading: true })
    );
    battery.add(casing);

    const glowCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.8, flatShading: true })
    );
    battery.add(glowCore);
    noOutline(glowCore);

    this.group.add(battery);
    this.batteryMesh = battery;

    if (this.physicsWorld) {
      const b = this.physicsWorld.createDynamicBody(x, y, z, 'cylinder', {
        radius: 0.45, halfHeight: 0.5
      }, { material: 'metal', mass: 4.5, ref: this });
      this.batteryBody = b.body;
      this.batteryBodyRef = b;
    }
  }

  _spawnCrate(x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), toonMat({ color: 0xca8a04, flatShading: true }));
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const b = this.physicsWorld.createDynamicBody(x, y, z, 'box', {
      hx: 0.7, hy: 0.6, hz: 0.7
    }, { material: 'wood', mass: 3.0 });
    this.interactiveObjects.push({ mesh, body: b.body });
  }

  _spawnExplosiveBarrel(x, y, z) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 1.4, 8), toonMat({ color: PALETTE.red, flatShading: true }));
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const b = this.physicsWorld.createDynamicBody(x, y, z, 'cylinder', {
      radius: 0.65, halfHeight: 0.7
    }, { material: 'toy', mass: 2.5 });
    mesh.userData.isExplosive = true;
    this.interactiveObjects.push({ mesh, body: b.body, explosive: true });
  }

  _spawnBoulder(x, y, z) {
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 1), toonMat({ color: 0x64748b, flatShading: true }));
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const b = this.physicsWorld.createDynamicBody(x, y, z, 'sphere', {
      radius: 0.8
    }, { material: 'stone', mass: 7.0 });
    this.interactiveObjects.push({ mesh, body: b.body });
  }

  // ─── Simulation & Multi-Solution Evaluation ───

  update(dt, dweebs = [], combat = null) {
    this.clock += dt;

    // Sync spawned dynamic physics props with meshes
    for (const obj of this.interactiveObjects) {
      if (obj.body && obj.mesh) {
        const t = obj.body.translation();
        const r = obj.body.rotation();
        obj.mesh.position.set(t.x, t.y, t.z);
        obj.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }

    // Sync Battery position
    if (this.batteryBody && this.batteryMesh) {
      const t = this.batteryBody.translation();
      const r = this.batteryBody.rotation();
      this.batteryMesh.position.set(t.x, t.y, t.z);
      this.batteryMesh.quaternion.set(r.x, r.y, r.z, r.w);

      // Check if battery is socketed into the generator slot!
      const distToSocket = Math.hypot(t.x - this.socketPos.x, t.z - this.socketPos.z);
      if (distToSocket < 1.3 && Math.abs(t.y - this.socketPos.y) < 1.0 && !this.batterySocketed) {
        this.batterySocketed = true;
        this.socketMesh.material.emissive.setHex(0x38bdf8);
        this.socketMesh.material.emissiveIntensity = 1.2;
        this.escapeMethod = 'CIRCUIT BREAKER: Powered the Magnetic Lock!';
      }
    }

    // Evaluate Counterweight Basket
    if (this.basketMesh && this.basketBody) {
      let totalMass = 0;
      const bPos = this.basketMesh.position;
      for (const d of dweebs) {
        if (!d.body) continue;
        const p = d.body.translation();
        if (Math.hypot(p.x - bPos.x, p.z - bPos.z) < 2.0 && Math.abs(p.y - bPos.y) < 1.2) {
          totalMass += 3.5;
        }
      }
      for (const obj of this.interactiveObjects) {
        if (!obj.body) continue;
        const p = obj.body.translation();
        if (Math.hypot(p.x - bPos.x, p.z - bPos.z) < 2.0 && Math.abs(p.y - bPos.y) < 1.2) {
          totalMass += 4.0;
        }
      }
      this.basketWeight = THREE.MathUtils.lerp(this.basketWeight, totalMass, dt * 4);

      if (this.basketWeight >= this.basketTargetWeight) {
        this.pulleyGateProgress = Math.min(1.0, this.pulleyGateProgress + dt * 0.8);
        this.escapeMethod = 'PULLEY MASTER: Counterbalanced the Heavy Vault!';
      }
    }

    // Apply Door Movement if Pulley or Circuit Solved
    const doorOpenAmount = Math.max(this.batterySocketed ? 1.0 : 0, this.pulleyGateProgress);
    if (doorOpenAmount > 0 && !this.doorBlown) {
      const doorY = 3.4 + doorOpenAmount * 6.5;
      if (this.doorMesh) this.doorMesh.position.y = doorY;
      if (this.doorBody && this.doorBody.body) {
        this.doorBody.body.setNextKinematicTranslation({ x: 0, y: doorY, z: -16 });
      }
    }

    // Check Demolition Damage against Door Hinges
    // If an explosive barrel explodes near z = -16, damage the hinges!
    if (!this.doorBlown) {
      for (const obj of this.interactiveObjects) {
        if (obj.explosive && obj.body) {
          const t = obj.body.translation();
          if (Math.abs(t.z - (-16)) < 4.0 && Math.abs(t.x) < 4.0 && obj.exploded) {
            this.doorHp.hingeL -= 60;
            this.doorHp.hingeR -= 60;
          }
        }
      }
      if (this.doorHp.hingeL <= 0 && this.doorHp.hingeR <= 0) {
        this._blowDoorHinges();
      }
    }

    // ── Check Win / Escape Condition ──
    for (const d of dweebs) {
      if (!d.body) continue;
      const p = d.body.translation();

      // Exit 1: Walking through the doorway (z < -17.5, y < 4.0)
      if (p.z < -17.5 && p.y < 4.0 && !this.escaped) {
        this.escaped = true;
        if (!this.escapeMethod) {
          this.escapeMethod = this.doorBlown
            ? 'DEMOLITION EXPERT: Blew Door Off Its Hinges!'
            : 'SQUEEZE MASTER: Slipped under the vault opening!';
        }
        this._triggerVictory(d);
        break;
      }

      // Exit 2: Climbing through High Ventilation Grate (z < -17.0, y > 7.0)
      if (p.z < -17.0 && p.y > 6.8 && !this.escaped) {
        this.escaped = true;
        this.escapeMethod = 'ROOF RUNNER: Bypassed via High Ceiling Grate!';
        this._triggerVictory(d);
        break;
      }
    }
  }

  _blowDoorHinges() {
    this.doorBlown = true;
    this.escapeMethod = 'DEMOLITION EXPERT: Blew Door Off Its Hinges!';
    if (this.hingeMeshes.L) this.hingeMeshes.L.rotation.z = Math.PI / 3;
    if (this.hingeMeshes.R) this.hingeMeshes.R.rotation.z = -Math.PI / 3;

    // Convert kinematic door to dynamic ragdoll so it crashes down!
    if (this.doorBody && this.doorBody.body && this.physicsWorld) {
      this.physicsWorld.world.removeRigidBody(this.doorBody.body);
      const dyn = this.physicsWorld.createDynamicBody(0, 3.4, -16, 'box', {
        hx: 3.8, hy: 3.4, hz: 0.3
      }, { material: 'wood', mass: 12.0 });
      this.doorBody = dyn;
      // Kick it with an impulse forward
      dyn.body.applyImpulse({ x: 0, y: 5, z: -25 }, true);
    }
  }

  _triggerVictory(dweeb) {
    const announcer = document.getElementById('announcer');
    if (announcer) {
      announcer.className = 'show go';
      announcer.innerHTML = `FREEDOM!<small>${this.escapeMethod}</small>`;
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
