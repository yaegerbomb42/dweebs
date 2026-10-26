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

export class Meadowlands {
  constructor(physicsWorld, scene) {
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

    this._buildWorld();
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
      roughness: 0.9,
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
      { x: -12, z: -8 },
    ];
    for (const pos of bushPositions) {
      this._createBerryBush(pos.x, this._getHeight(pos.x, pos.z), pos.z);
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
    this.berryBushes.push({ x, y, z, berries, available: 5 });

    if (this.physicsWorld) {
      this.physicsWorld.createFixedCylinder(x, y + 0.8, z, 1.0, 0.8, 'wood');
    }
  }

  // ─── 6. Flora & Landscape Details ───

  _createFloraAndLandmarks() {
    // Pine & Deciduous Trees scattered naturally
    const treeCoords = [
      { x: -22, z: 15, type: 'pine', s: 1.4 },
      { x: -26, z: 5, type: 'pine', s: 1.2 },
      { x: 18, z: -18, type: 'broad', s: 1.3 },
      { x: 24, z: -10, type: 'broad', s: 1.5 },
      { x: -14, z: -28, type: 'pine', s: 1.6 },
      { x: 16, z: 22, type: 'broad', s: 1.1 },
      { x: 28, z: 18, type: 'pine', s: 1.3 },
      { x: -32, z: -15, type: 'pine', s: 1.7 },
      { x: 8, z: -25, type: 'broad', s: 1.2 },
    ];

    for (const tc of treeCoords) {
      const y = this._getHeight(tc.x, tc.z);
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

  // ─── 7. Simulation & Animation Loop ───

  update(dt, dweebs = []) {
    this.clock += dt;

    // Flicker Campfire Light
    if (this.campfireLight) {
      this.campfireLight.intensity = 2.6 + Math.sin(this.clock * 12) * 0.3 + Math.cos(this.clock * 19) * 0.2;
    }

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
    this.scene.remove(this.group);
    for (const c of this.colliders) {
      if (this.physicsWorld && c.body) {
        this.physicsWorld.world.removeRigidBody(c.body);
      }
    }
  }
}
