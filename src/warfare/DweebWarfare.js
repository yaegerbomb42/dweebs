// DweebWarfare.js — 100 vs 100 Mass Physics Battle Simulator (Game 5)
//
// Features:
//   - Rocket Launchers with explosive recoil
//   - Stealers (Kidnappers) who tackle enemies and haul them back to the Conversion Pen
//   - Kamis (Bomb Runners) who sprint into battle lines with cartoon TNT and detonate
//   - Shield Phalanx that blocks incoming rockets and pushes frontlines
//   - Commander RTS point-and-click rally orders

import * as THREE from 'three';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';

export const UNIT_ROLES = {
  SHIELD: 'shield',
  ROCKET: 'rocket',
  STEALER: 'stealer',
  KAMI: 'kami',
};

export class DweebWarfare {
  constructor(physicsWorld, scene) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.colliders = [];
    this.blueUnits = [];
    this.redUnits = [];
    this.projectiles = [];
    this.particles = [];
    this.clock = 0;
    this.gameOver = false;
    this.convertedCount = 0;

    // Commander beacon
    this.rallyBeacon = null;
    this.rallyPos = new THREE.Vector3(0, 0, 0);

    // Reusable geometries & materials for high-count efficiency
    this._initSharedMeshes();
    this._buildBattlefield();
    this._spawnArmies(45); // 45 vs 45 = 90 high-performance chaotic physics combatants
  }

  get blueCount() {
    return this.blueUnits.length;
  }

  get redCount() {
    return this.redUnits.length;
  }

  _initSharedMeshes() {
    this.geoBody = new THREE.DodecahedronGeometry(0.55, 1);
    this.geoShield = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 8);
    this.geoRocket = new THREE.CylinderGeometry(0.12, 0.16, 1.1, 6);
    this.geoBomb = new THREE.SphereGeometry(0.38, 8, 8);

    this.matBlue = toonMat({ color: 0x3b82f6, flatShading: true });
    this.matRed = toonMat({ color: 0xef4444, flatShading: true });
    this.matShield = toonMat({ color: 0x64748b, flatShading: true });
    this.matRocket = toonMat({ color: 0xf59e0b, flatShading: true });
    this.matBomb = toonMat({ color: 0x1e293b, flatShading: true });
    this.matWood = toonMat({ color: 0x78350f, flatShading: true });
  }

  _buildBattlefield() {
    // 80m x 45m Battlefield Arena
    const groundGeo = new THREE.BoxGeometry(84, 1.0, 48);
    const groundMat = toonMat({ color: 0xe2e8f0, flatShading: true });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -0.5, 0);
    this.terrainMesh = ground;
    this.group.add(ground);
    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(0, -0.5, 0, 42, 0.5, 24, 'stone');
    }

    // Outer Boundary Walls
    const wallNorth = new THREE.Mesh(new THREE.BoxGeometry(84, 4, 1), this.matWood);
    wallNorth.position.set(0, 2, -24);
    const wallSouth = new THREE.Mesh(new THREE.BoxGeometry(84, 4, 1), this.matWood);
    wallSouth.position.set(0, 2, 24);
    this.group.add(wallNorth, wallSouth);

    if (this.physicsWorld) {
      this.physicsWorld.createStaticBox(0, 2, -24, 42, 2, 0.5, 'wood');
      this.physicsWorld.createStaticBox(0, 2, 24, 42, 2, 0.5, 'wood');
      this.physicsWorld.createStaticBox(-42, 2, 0, 0.5, 2, 24, 'wood');
      this.physicsWorld.createStaticBox(42, 2, 0, 0.5, 2, 24, 'wood');
    }

    // Central No-Man's Land Barricades
    for (let i = -16; i <= 16; i += 8) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 4), this.matWood);
      bar.position.set((Math.random() - 0.5) * 6, 0.7, i);
      bar.rotation.y = (Math.random() - 0.5) * 0.4;
      this.group.add(bar);
      if (this.physicsWorld) {
        this.physicsWorld.createStaticBox(bar.position.x, 0.7, bar.position.z, 0.8, 0.7, 2, 'wood');
      }
    }

    // Blue Conversion Pen (West: x = -34)
    this.bluePen = this._createConversionPen(-34, 0, 0x3b82f6);
    // Red Conversion Pen (East: x = 34)
    this.redPen = this._createConversionPen(34, 0, 0xef4444);

    // Rally Beacon Marker
    const beaconGeo = new THREE.ConeGeometry(0.8, 2.5, 6);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, wireframe: true });
    this.rallyBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.rallyBeacon.rotation.x = Math.PI;
    this.rallyBeacon.position.set(0, 3.5, 0);
    this.group.add(this.rallyBeacon);
    noOutline(this.rallyBeacon);
  }

  _createConversionPen(x, z, color) {
    const pen = new THREE.Group();
    pen.position.set(x, 0, z);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 4.8, 0.3, 12),
      toonMat({ color, flatShading: true })
    );
    pad.position.y = 0.15;
    pen.add(pad);

    const light = new THREE.PointLight(color, 2.5, 12);
    light.position.set(0, 2, 0);
    pen.add(light);

    this.group.add(pen);
    return { x, z, radius: 4.5 };
  }

  _spawnArmies(countPerTeam) {
    const roles = [
      UNIT_ROLES.SHIELD, UNIT_ROLES.SHIELD,
      UNIT_ROLES.ROCKET,
      UNIT_ROLES.STEALER,
      UNIT_ROLES.KAMI,
    ];

    // Spawn Blue Army (West side: x = -26 to -14)
    for (let i = 0; i < countPerTeam; i++) {
      const role = roles[i % roles.length];
      const x = -24 + (Math.random() - 0.5) * 12;
      const z = (Math.random() - 0.5) * 36;
      const unit = this._createUnit('blue', role, x, 0.6, z);
      this.blueUnits.push(unit);
    }

    // Spawn Red Army (East side: x = 14 to 26)
    for (let i = 0; i < countPerTeam; i++) {
      const role = roles[i % roles.length];
      const x = 24 + (Math.random() - 0.5) * 12;
      const z = (Math.random() - 0.5) * 36;
      const unit = this._createUnit('red', role, x, 0.6, z);
      this.redUnits.push(unit);
    }
  }

  _createUnit(team, role, x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const matTeam = team === 'blue' ? this.matBlue : this.matRed;
    const bodyMesh = new THREE.Mesh(this.geoBody, matTeam);
    bodyMesh.position.y = 0.55;
    group.add(bodyMesh);

    // Googly Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), eyeMat);
    eyeL.position.set(team === 'blue' ? 0.45 : -0.45, 0.7, -0.16);
    const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), pupilMat);
    pupilL.position.set(team === 'blue' ? 0.54 : -0.54, 0.7, -0.16);
    group.add(eyeL, pupilL);

    // Role-specific Gear
    let gearMesh = null;
    if (role === UNIT_ROLES.SHIELD) {
      gearMesh = new THREE.Mesh(this.geoShield, this.matShield);
      gearMesh.rotation.z = Math.PI / 2;
      gearMesh.position.set(team === 'blue' ? 0.65 : -0.65, 0.55, 0);
      group.add(gearMesh);
    } else if (role === UNIT_ROLES.ROCKET) {
      gearMesh = new THREE.Mesh(this.geoRocket, this.matRocket);
      gearMesh.rotation.z = Math.PI / 3;
      gearMesh.position.set(0, 1.1, 0);
      group.add(gearMesh);
    } else if (role === UNIT_ROLES.KAMI) {
      gearMesh = new THREE.Mesh(this.geoBomb, this.matBomb);
      gearMesh.position.set(0, 1.25, 0);
      group.add(gearMesh);
    } else if (role === UNIT_ROLES.STEALER) {
      // Sleek bandit mask headband
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.2, 8), this.matWood);
      band.position.y = 0.7;
      group.add(band);
    }

    this.group.add(group);

    return {
      team,
      role,
      mesh: group,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2),
      hp: role === UNIT_ROLES.SHIELD ? 140 : 80,
      alive: true,
      attackCooldown: Math.random() * 2.5,
      carryingTarget: null, // for Stealers hauling enemies!
      carriedBy: null,
    };
  }

  setRallyPoint(x, z) {
    this.rallyPos.set(x, 0, z);
    if (this.rallyBeacon) {
      this.rallyBeacon.position.set(x, 3.5, z);
    }
  }

  update(dt) {
    this.clock += dt;
    if (this.gameOver) return;

    if (this.rallyBeacon) {
      this.rallyBeacon.rotation.y += dt * 3.0;
      this.rallyBeacon.position.y = 3.2 + Math.sin(this.clock * 4) * 0.4;
    }

    // Update Projectiles
    this._updateProjectiles(dt);

    // Update Blue and Red Armies
    this._updateArmy(this.blueUnits, this.redUnits, this.bluePen, dt);
    this._updateArmy(this.redUnits, this.blueUnits, this.redPen, dt);

    // Clean up dead units
    this.blueUnits = this.blueUnits.filter(u => u.alive);
    this.redUnits = this.redUnits.filter(u => u.alive);

    // Check Victory Condition
    if (this.blueUnits.length === 0 || this.redUnits.length === 0) {
      this.gameOver = true;
      const winner = this.blueUnits.length > 0 ? 'BLUE ARMY' : 'RED ARMY';
      const announcer = document.getElementById('announcer');
      if (announcer) {
        announcer.className = 'show go';
        announcer.innerHTML = `${winner} VICTORY!<small>Warfare Concluded · ${this.convertedCount} Dweebs Kidnapped &amp; Converted</small>`;
      }
    }
  }

  _updateArmy(army, enemyArmy, homePen, dt) {
    for (const u of army) {
      if (!u.alive) continue;

      // If being carried by a Stealer, pin to the stealer's hands
      if (u.carriedBy) {
        if (!u.carriedBy.alive) {
          u.carriedBy = null;
        } else {
          u.pos.copy(u.carriedBy.pos);
          u.pos.y = 1.6;
          u.mesh.position.copy(u.pos);
          u.mesh.rotation.z = Math.sin(this.clock * 12) * 0.4;
          continue;
        }
      }

      u.attackCooldown = Math.max(0, u.attackCooldown - dt);

      // Find nearest living enemy
      let nearestDist = Infinity;
      let target = null;
      for (const e of enemyArmy) {
        if (!e.alive || e.carriedBy) continue;
        const d = u.pos.distanceTo(e.pos);
        if (d < nearestDist) {
          nearestDist = d;
          target = e;
        }
      }

      // ── Role Behaviors ──

      // 1. STEALER: Infiltrate, tackle, carry back to conversion pen
      if (u.role === UNIT_ROLES.STEALER) {
        if (u.carryingTarget) {
          // Sprint back to Home Conversion Pen!
          const dx = homePen.x - u.pos.x;
          const dz = homePen.z - u.pos.z;
          const dist = Math.hypot(dx, dz) || 1;
          u.vel.x = (dx / dist) * 7.5;
          u.vel.z = (dz / dist) * 7.5;

          if (dist < homePen.radius) {
            // CONVERT ENEMY!
            const victim = u.carryingTarget;
            victim.team = u.team;
            victim.carriedBy = null;
            victim.mesh.children[0].material = u.team === 'blue' ? this.matBlue : this.matRed;
            enemyArmy.splice(enemyArmy.indexOf(victim), 1);
            army.push(victim);
            u.carryingTarget = null;
            this.convertedCount++;

            const announcer = document.getElementById('announcer');
            if (announcer && Math.random() < 0.25) {
              announcer.className = 'show trick';
              announcer.innerHTML = `CONVERTED!<small>${u.team.toUpperCase()} Stealer captured an enemy Dweeb!</small>`;
            }
          }
        } else if (target && nearestDist < 1.4) {
          // Tackle and grab target overhead!
          u.carryingTarget = target;
          target.carriedBy = u;
        } else if (target) {
          // Sprint toward nearest enemy
          const dx = target.pos.x - u.pos.x;
          const dz = target.pos.z - u.pos.z;
          const dist = Math.hypot(dx, dz) || 1;
          u.vel.x = (dx / dist) * 6.2;
          u.vel.z = (dz / dist) * 6.2;
        }
      }

      // 2. KAMI: Fast sprint toward enemy and detonate!
      else if (u.role === UNIT_ROLES.KAMI) {
        if (target && nearestDist < 2.2) {
          // BOOM!
          u.alive = false;
          this.group.remove(u.mesh);
          this._createExplosion(u.pos.x, u.pos.y, u.pos.z, 5.0, 75, enemyArmy);
        } else if (target) {
          const dx = target.pos.x - u.pos.x;
          const dz = target.pos.z - u.pos.z;
          const dist = Math.hypot(dx, dz) || 1;
          u.vel.x = (dx / dist) * 6.8;
          u.vel.z = (dz / dist) * 6.8;
        }
      }

      // 3. ROCKET LAUNCHER: Range artillery
      else if (u.role === UNIT_ROLES.ROCKET) {
        if (target && nearestDist < 24 && nearestDist > 8) {
          u.vel.set(0, 0, 0);
          if (u.attackCooldown <= 0) {
            u.attackCooldown = 3.2;
            this._fireRocket(u.pos, target.pos, u.team, enemyArmy);
            // Recoil kickback!
            const dx = u.pos.x - target.pos.x;
            const dz = u.pos.z - target.pos.z;
            const d = Math.hypot(dx, dz) || 1;
            u.vel.x = (dx / d) * 5.0;
            u.vel.z = (dz / d) * 5.0;
          }
        } else if (target) {
          const dx = target.pos.x - u.pos.x;
          const dz = target.pos.z - u.pos.z;
          const dist = Math.hypot(dx, dz) || 1;
          const sign = nearestDist <= 8 ? -1 : 1;
          u.vel.x = (dx / dist) * 4.0 * sign;
          u.vel.z = (dz / dist) * 4.0 * sign;
        }
      }

      // 4. SHIELD PHALANX: Frontline tanks
      else {
        if (target && nearestDist < 1.4) {
          u.vel.set(0, 0, 0);
          if (u.attackCooldown <= 0) {
            u.attackCooldown = 1.0;
            target.hp -= 22;
            if (target.hp <= 0) {
              target.alive = false;
              this.group.remove(target.mesh);
            }
          }
        } else if (target) {
          const dx = target.pos.x - u.pos.x;
          const dz = target.pos.z - u.pos.z;
          const dist = Math.hypot(dx, dz) || 1;
          u.vel.x = (dx / dist) * 4.4;
          u.vel.z = (dz / dist) * 4.4;
        }
      }

      // Move unit
      u.pos.x += u.vel.x * dt;
      u.pos.z += u.vel.z * dt;
      u.vel.multiplyScalar(0.92);

      // Clamp to battlefield bounds
      u.pos.x = THREE.MathUtils.clamp(u.pos.x, -40, 40);
      u.pos.z = THREE.MathUtils.clamp(u.pos.z, -22, 22);

      u.mesh.position.copy(u.pos);
    }
  }

  _fireRocket(fromPos, toPos, team, enemyArmy) {
    const geo = new THREE.CylinderGeometry(0.14, 0.18, 0.9, 6);
    const mat = new THREE.MeshBasicMaterial({ color: team === 'blue' ? 0x38bdf8 : 0xf87171 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(fromPos);
    mesh.position.y += 0.8;
    this.group.add(mesh);
    noOutline(mesh);

    const dir = toPos.clone().sub(fromPos);
    dir.y = 0;
    const dist = dir.length();
    dir.normalize();

    this.projectiles.push({
      mesh,
      pos: mesh.position.clone(),
      vel: dir.multiplyScalar(16.0).setY(7.0 + dist * 0.25),
      team,
      enemyArmy,
      lifetime: 3.5,
    });
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= 18.0 * dt; // gravity
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      p.lifetime -= dt;

      // Hit ground or target
      if (p.pos.y <= 0.4 || p.lifetime <= 0) {
        this.group.remove(p.mesh);
        this.projectiles.splice(i, 1);
        this._createExplosion(p.pos.x, 0.5, p.pos.z, 4.2, 55, p.enemyArmy);
      }
    }
  }

  _createExplosion(x, y, z, radius, damage, targetArmy) {
    // Blast visual flash
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.8, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8 })
    );
    flash.position.set(x, y, z);
    this.group.add(flash);
    noOutline(flash);
    setTimeout(() => this.group.remove(flash), 180);

    // Apply blast damage & knockback to nearby enemies
    for (const u of targetArmy) {
      if (!u.alive) continue;
      const d = Math.hypot(u.pos.x - x, u.pos.z - z);
      if (d < radius) {
        u.hp -= damage * (1 - d / radius);
        const knock = 8.0 * (1 - d / radius);
        u.vel.x += ((u.pos.x - x) / (d || 1)) * knock;
        u.vel.z += ((u.pos.z - z) / (d || 1)) * knock;

        if (u.hp <= 0) {
          u.alive = false;
          this.group.remove(u.mesh);
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
