// ToyBuildings.js — the handcrafted toy-set landmarks of New Dweebtopia.
//
// Six modular structures, each a ToyStructure with an atomic dispose():
//   Windmill of Whirls   — rotating cloth sails that scoop Dweebs skyward
//   Lookout Watchtower   — stilts, ladder, crow's nest, rope swing and physics zipline
//   Bouncy Gazebo        — striped trampoline canopy and a plush-ball pressure button
//   Clockwork Tower      — exposed cogs, rotating clock-hand platforms, counterweight lift
//   Waterwheel Chute     — banking conveyor slide into a soft pool, with a direction lever
//   Breakable Toy Fort   — merged destructible ramparts that workers can rebuild
//
// Static decoration is merged per material by ToyKit; animated pieces stay separate. The fort's
// blocks are a single rebuilt merged mesh, so even a fully destructible castle is one draw call.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ToyStructure, makeStripedCone, makeCog, impactScore, shouldShatter, sampleTrack, nearestOnTrack, damp } from './ToyKit.js';
import {
  HingedDoor, Trapdoor, Lever, CrankWheel, PressureButton,
  BounceSurface, LadderZone, RopeSwing, Zipline, Drawbridge, RisingGate, PropSpawner,
} from './SetPieces.js';
import { getStructureDef } from './ObjectRegistry.js';

const WOOD = 0x8a5a2b;
const WOOD_LIGHT = 0xd4a86a;
const WOOD_DARK = 0x6b3f1d;
const CREAM = 0xfff8ee;
const STONE = 0x8293a4;
const STONE_DARK = 0x475569;
const METAL = 0x64748b;
const RED = 0xff4d5e;
const YELLOW = 0xffd23f;
const TEAL = 0x3ee6d0;
const BLUE = 0x3fa9ff;
const PURPLE = 0xb56cff;
const PINK = 0xff6fb5;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function tint(hex, amount) {
  return new THREE.Color(hex).offsetHSL(0, 0, amount).getHex();
}

function blockMatrix(x, y, z, rotY) {
  _e.set(0, rotY, 0);
  _q.setFromEuler(_e);
  return _m4.compose(_v.set(x, y, z), _q, _v2.set(1, 1, 1)).clone();
}

// ─── 1. Windmill of Whirls ───

export class Windmill extends ToyStructure {
  constructor(physics, scene, opts = {}) {
    super(physics, scene, { ...opts, id: 'windmill', name: 'Windmill of Whirls' });
    this.build();
    this.flush();
  }

  build() {
    // Stone footing and the chunky timber tower.
    this._batchCyl(2.7, 3.3, 2.2, 10, STONE_DARK, { p: [0, -0.9, 0] });
    this._batchCyl(2.9, 3.2, 0.9, 10, STONE, { p: [0, 0.45, 0] });
    this.staticCylinder(0, 0.45, 0, 3.0, 0.45, 'stone');
    this._batchCyl(2.05, 2.55, 6.0, 10, WOOD, { p: [0, 3.8, 0] });
    this.staticCylinder(0, 3.8, 0, 2.3, 3.0, 'wood');

    // Vertical plank ribs and two hoop bands.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this._batchRBox(0.16, 5.8, 0.12, 0.03, i % 2 ? WOOD_LIGHT : WOOD_DARK, {
        p: [Math.cos(a) * 2.3, 3.8, Math.sin(a) * 2.3],
        r: [0, -a, 0],
      });
    }
    for (const y of [2.4, 5.4]) {
      this._batchTorus(2.35, 0.11, 5, 16, WOOD_DARK, { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
    }

    // Lit little windows around the mill.
    for (const a of [-1.1, 0.4, 2.4]) {
      const wx = Math.cos(a) * 2.28, wz = Math.sin(a) * 2.28;
      this._batchBox(0.55, 0.7, 0.12, 0xffd98a, { p: [wx, 4.8, wz], r: [0, -a, 0] });
      this._batchBox(0.7, 0.85, 0.08, WOOD_DARK, { p: [wx, 4.8, wz], r: [0, -a, 0], s: [1, 1, 0.4] });
      this._batchBox(0.08, 0.85, 0.1, WOOD_DARK, { p: [wx, 4.8, wz], r: [0, -a, 0] });
    }

    // Balcony deck with a rail.
    this._batchCyl(3.0, 3.0, 0.24, 12, WOOD_LIGHT, { p: [0, 6.75, 0] });
    this.staticCylinder(0, 6.75, 0, 3.0, 0.14, 'wood');
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this._batchRBox(0.12, 0.75, 0.12, 0.02, WOOD_DARK, {
        p: [Math.cos(a) * 2.9, 7.2, Math.sin(a) * 2.9], r: [0, -a, 0],
      });
    }
    this._batchTorus(2.92, 0.08, 4, 20, WOOD_DARK, { p: [0, 7.55, 0], r: [Math.PI / 2, 0, 0] });

    // Cap and finial.
    this._batchCone(3.1, 2.2, 10, RED, { p: [0, 8.9, 0] });
    this._batchSphere(0.22, 8, YELLOW, { p: [0, 10.1, 0] });

    // The sails: four lattice arms with cloth panels, spinning on the front hub.
    this.sailPivot = new THREE.Group();
    this.sailPivot.position.set(0, 7.7, 3.05);
    this.group.add(this.sailPivot);
    this._meshCyl(0.42, 0.42, 0.55, 10, WOOD_DARK, { r: [Math.PI / 2, 0, 0] }, {}, this.sailPivot);
    this._meshCyl(0.16, 0.16, 1.1, 8, METAL, { r: [Math.PI / 2, 0, 0] }, {}, this.sailPivot);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2;
      this.sailPivot.add(arm);
      this._meshBox(0.16, 4.0, 0.12, WOOD_DARK, { p: [0, 2.0, 0] }, {}, arm);
      this._meshBox(1.65, 0.12, 0.1, WOOD_DARK, { p: [0.75, 3.75, 0] }, {}, arm);
      this._meshBox(1.65, 0.12, 0.1, WOOD_DARK, { p: [0.75, 1.2, 0] }, {}, arm);
      // Fabric sail panels alternate warm cream / strawberry.
      this._meshBox(1.5, 2.45, 0.05, i % 2 ? CREAM : RED, { p: [0.82, 2.48, 0.01] }, {}, arm);
      for (let k = 0; k < 3; k++) {
        this._meshBox(0.08, 2.45, 0.07, WOOD_DARK, { p: [0.12 + k * 0.7, 2.48, 0.05] }, {}, arm);
      }
    }
    this.sailSpeed = 0.62;
    this.sailBoost = 15.5;

    // Saloon door at the base — barging through gives a satisfying THWACK.
    this.door = new HingedDoor(this, {
      x: 0, y: 0.9, z: 2.55, rotY: 0, width: 1.55, height: 1.8,
      color: WOOD_LIGHT, accent: YELLOW, swing: 1,
    });
  }

  update(dt, ctx) {
    super.update(dt);
    if (this.sailPivot) this.sailPivot.rotation.z += dt * this.sailSpeed;
    this.door?.update(dt, ctx);

    // Sails are a soft moving platform: catch a jumping Dweeb and fling them up/outward.
    this._dweebs(ctx, d => {
      const p = d.body.translation();
      const dx = p.x - this.position.x, dz = p.z - this.position.z;
      const radius = Math.hypot(dx, dz);
      if (radius > 4.5 || radius < 0.6) return;
      if (p.y < this.position.y + 4.1 || p.y > this.position.y + 11.2) return;
      const v = d.body.linvel();
      if (v.y > 2) return;
      if (!this._cool(d, 'windmillSail', dt, 1.25)) return;
      const nx = dx / (radius || 1), nz = dz / (radius || 1);
      d.body.setLinvel({
        x: v.x * 0.4 + nx * 4.6,
        y: this.sailBoost,
        z: v.z * 0.4 + nz * 4.6,
      }, true);
      this._fx('sailLaunch', { x: p.x, y: p.y, z: p.z });
      if (d.onBounce) d.onBounce();
    });
  }
}

// ─── 2. Lookout Watchtower & Zipline ───

export class Watchtower extends ToyStructure {
  constructor(physics, scene, opts = {}) {
    super(physics, scene, { ...opts, id: 'watchtower', name: 'Lookout Watchtower' });
    this.build();
    this.flush();
  }

  build() {
    this._batchCyl(2.4, 3.1, 2.2, 10, STONE_DARK, { p: [0, -0.85, 0] });
    this._batchCyl(2.7, 3.0, 0.7, 10, STONE, { p: [0, 0.35, 0] });
    this.staticCylinder(0, 0.35, 0, 2.8, 0.35, 'stone');

    // Four chunky stilts.
    const legs = [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]];
    for (const [x, z] of legs) {
      this._batchRBox(0.34, 7.3, 0.34, 0.05, WOOD, { p: [x, 3.65, z] });
      this.staticCylinder(x, 3.65, z, 0.3, 3.65, 'wood');
      this._batchRBox(0.7, 0.16, 0.7, 0.03, WOOD_DARK, { p: [x, 0.1, z] });
    }
    // X braces at three heights.
    for (const y of [1.8, 3.9, 6.0]) {
      this._batchBeam([-1.9, y, -1.9], [1.9, y + 0.4, -1.9], 0.16, 0.16, WOOD_LIGHT);
      this._batchBeam([1.9, y, 1.9], [-1.9, y + 0.4, 1.9], 0.16, 0.16, WOOD_LIGHT);
      this._batchBeam([-1.9, y, 1.9], [-1.9, y + 0.4, -1.9], 0.16, 0.16, WOOD_LIGHT);
      this._batchBeam([1.9, y, -1.9], [1.9, y + 0.4, 1.9], 0.16, 0.16, WOOD_LIGHT);
    }

    // Deck + railing.
    this._batchRBox(5.4, 0.36, 5.4, 0.05, WOOD_LIGHT, { p: [0, 7.3, 0] });
    this.staticBox(0, 7.3, 0, 2.7, 0.18, 2.7, 'wood');
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this._batchRBox(0.13, 1.05, 0.13, 0.02, WOOD_DARK, {
        p: [Math.cos(a) * 2.55, 8.35, Math.sin(a) * 2.55], r: [0, -a, 0],
      });
    }
    this._batchTorus(2.55, 0.07, 4, 20, WOOD_DARK, { p: [0, 8.9, 0], r: [Math.PI / 2, 0, 0] });
    this._batchBox(5.4, 0.1, 0.1, WOOD_DARK, { p: [0, 8.9, -2.55] });

    // Ladder up the south face.
    const lz = 2.85;
    this._batchRBox(0.14, 7.4, 0.14, 0.02, WOOD_DARK, { p: [-0.52, 3.7, lz] });
    this._batchRBox(0.14, 7.4, 0.14, 0.02, WOOD_DARK, { p: [0.52, 3.7, lz] });
    for (let i = 0; i < 13; i++) {
      this._batchRBox(1.0, 0.12, 0.16, 0.02, i % 2 ? WOOD_LIGHT : 0xc98d4a, {
        p: [0, 0.45 + i * 0.55, lz],
      });
    }
    this.ladder = new LadderZone(this, {
      x: 0, y: 0.2, z: lz, width: 1.15, height: 7.2, depth: 0.9,
    });

    // Crow's nest flag.
    this._batchCyl(0.08, 0.1, 2.4, 6, METAL, { p: [1.9, 10.1, -1.7] });
    this.flag = this._meshBox(1.5, 0.8, 0.06, TEAL, { p: [1.15, 10.9, -1.7] });
    this._meshBox(0.3, 0.3, 0.07, CREAM, { p: [1.55, 10.9, -1.67] }, {}, this.group);

    // Zipline from the deck rail out over the meadow.
    this.zipline = new Zipline(this, {
      a: { x: 1.7, y: 8.6, z: 1.5 },
      b: { x: 8.6, y: 1.0, z: 7.6 },
      sag: 0.55,
      speed: 14,
    });

    // A rope swing hung beneath the deck.
    this.swing = new RopeSwing(this, { x: 0, y: 7.1, z: 0, length: 2.5, radius: 1.8 });
  }

  update(dt, ctx) {
    super.update(dt);
    this.ladder?.update(dt, ctx);
    this.zipline?.update(dt, ctx);
    this.swing?.update(dt, ctx);
    if (this.flag) this.flag.rotation.y = Math.sin(this._time * 2.2) * 0.12;
  }
}

// ─── 3. Bouncy Gazebo / Canopy Tent ───

export class BouncyGazebo extends ToyStructure {
  constructor(physics, scene, opts = {}) {
    super(physics, scene, { ...opts, id: 'gazebo', name: 'Bouncy Gazebo' });
    this.build();
    this.flush();
  }

  build() {
    this._batchCyl(3.8, 4.7, 2.0, 14, STONE_DARK, { p: [0, -0.75, 0] });
    this._batchCyl(4.4, 4.6, 0.4, 14, STONE, { p: [0, 0.2, 0] });
    this.staticCylinder(0, 0.2, 0, 4.5, 0.2, 'stone');

    // Hexagonal posts and ring beam.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = Math.cos(a) * 3.55, z = Math.sin(a) * 3.55;
      this._batchRBox(0.28, 3.7, 0.28, 0.04, WOOD, { p: [x, 2.05, z], r: [0, -a, 0] });
      this.staticCylinder(x, 2.05, z, 0.24, 1.85, 'wood');
      this._batchTorus(0.46, 0.06, 4, 10, YELLOW, { p: [x, 3.85, z], r: [Math.PI / 2, 0, 0] });
    }
    this._batchTorus(3.6, 0.13, 5, 18, WOOD_DARK, { p: [0, 3.9, 0], r: [Math.PI / 2, 0, 0] });

    // Striped trampoline canopy — one vertex-coloured cone, so one draw call.
    const roofGeo = this._ownGeom(makeStripedCone(4.55, 2.7, 12, [RED, CREAM, YELLOW, CREAM, TEAL, CREAM]));
    this.roof = new THREE.Mesh(roofGeo, this._mat(0xffffff, { vertexColors: true }));
    this.roof.position.set(0, 4.95, 0);
    this.roof.castShadow = true;
    this.roof.receiveShadow = true;
    this.group.add(this.roof);
    this.staticCone(0, 4.95, 0, 4.55, 1.35, 'fabric');

    // Scalloped canopy edge.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this._batchSphere(0.36, 7, i % 2 ? CREAM : RED, { p: [Math.cos(a) * 4.35, 4.4, Math.sin(a) * 4.35] });
    }
    this._batchSphere(0.34, 8, YELLOW, { p: [0, 6.45, 0] });

    // Picnic table under the tent.
    this._batchRBox(3.0, 0.18, 1.0, 0.04, WOOD_LIGHT, { p: [0, 0.9, -0.9] });
    this._batchRBox(0.2, 0.8, 0.8, 0.03, WOOD_DARK, { p: [-1.0, 0.5, -0.9] });
    this._batchRBox(0.2, 0.8, 0.8, 0.03, WOOD_DARK, { p: [1.0, 0.5, -0.9] });
    this.staticBox(0, 0.9, -0.9, 1.5, 0.12, 0.5, 'wood');

    // Trampoline roof surface.
    this.bounce = new BounceSurface(this, {
      x: 0, y: 4.15, z: 0, radius: 4.25, boost: 20.5,
      color: PINK, label: 'gazeboRoof', visual: this.roof,
    });

    // Floor button launches plush balls from the canopy peak.
    this.spawner = new PropSpawner(this, {
      x: 0, y: 5.3, z: -1.6, kind: 'plush', color: PINK,
      launch: { x: 0, y: 2.4, z: 5.4 }, interval: 0.8,
    });
    this.button = new PressureButton(this, {
      x: 0, y: 0.4, z: 0.6, radius: 1.1, color: YELLOW, accent: RED,
      onPress: () => this.spawner.fire(),
    });

    // Party bunting.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this._batchSphere(0.1, 5, [RED, YELLOW, TEAL, PURPLE][i % 4], {
        p: [Math.cos(a) * 4.0, 3.55, Math.sin(a) * 4.0],
      });
    }
  }

  update(dt, ctx) {
    super.update(dt);
    this.bounce?.update(dt, ctx);
    this.button?.update(dt, ctx);
    this.spawner?.update(dt);
  }

  dispose() {
    // Plush balls live in world space, so the gazebo has to hand them back.
    this.spawner?.dispose?.();
    this.button?.dispose?.();
    super.dispose();
  }
}

// ─── 4. Toy Clockwork Tower ───

export class ClockworkTower extends ToyStructure {
  constructor(physics, scene, opts = {}) {
    super(physics, scene, { ...opts, id: 'clockwork', name: 'Toy Clockwork Tower' });
    this.build();
    this.flush();
  }

  build() {
    this._batchCyl(2.5, 3.1, 2.2, 12, STONE_DARK, { p: [0, -0.85, 0] });
    this._batchCyl(2.75, 3.0, 0.9, 12, STONE, { p: [0, 0.45, 0] });
    this.staticCylinder(0, 0.45, 0, 2.85, 0.45, 'stone');
    this._batchCyl(1.75, 2.15, 6.8, 12, WOOD, { p: [0, 3.85, 0] });
    this.staticCylinder(0, 3.85, 0, 2.0, 3.4, 'wood');
    // Horizontal bands and bolts.
    for (const y of [1.4, 3.3, 5.2, 6.9]) {
      this._batchTorus(2.0, 0.09, 4, 18, METAL, { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this._batchCyl(0.06, 0.06, 0.06, 5, YELLOW, {
        p: [Math.cos(a) * 2.02, i % 3 === 0 ? 3.3 : 5.2, Math.sin(a) * 2.02],
        r: [Math.PI / 2, 0, 0],
      });
    }

    // Exposed cog bank on the front face.
    this.cogs = [];
    const cogSpecs = [
      { x: -0.6, y: 4.7, r: 0.95, teeth: 10, color: YELLOW, accent: RED, spin: 1 },
      { x: 0.75, y: 3.6, r: 0.65, teeth: 8, color: TEAL, accent: WOOD_DARK, spin: -1.4 },
      { x: 1.35, y: 5.4, r: 0.48, teeth: 6, color: PURPLE, accent: CREAM, spin: 2.1 },
    ];
    for (const spec of cogSpecs) {
      const mount = new THREE.Group();
      mount.position.set(spec.x, spec.y, 1.95);
      mount.rotation.x = Math.PI / 2;
      this.group.add(mount);
      const cog = makeCog(this, spec.r, 0.24, spec.teeth, spec.color, spec.accent);
      mount.add(cog);
      this.cogs.push({ mount, cog, spin: spec.spin });
    }

    // Clock face and the two stepping-stone hands.
    this._batchCyl(1.2, 1.2, 0.18, 16, CREAM, { p: [0, 7.0, 1.86], r: [Math.PI / 2, 0, 0] });
    this._batchTorus(1.16, 0.1, 5, 20, WOOD_DARK, { p: [0, 7.0, 1.97], r: [Math.PI / 2, 0, 0] });
    this._batchBox(0.08, 0.6, 0.06, WOOD_DARK, { p: [0, 7.0, 1.98] });
    this._batchBox(0.4, 0.08, 0.06, WOOD_DARK, { p: [0.15, 7.0, 1.98] });

    this.hands = [];
    for (const spec of [
      { y: 4.95, len: 3.5, width: 0.32, speed: 0.32, color: YELLOW },
      { y: 6.35, len: 4.4, width: 0.22, speed: 1.1, color: TEAL },
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, spec.y, 0);
      this.group.add(pivot);
      this._meshRBox(spec.len, spec.width, 0.72, 0.04, spec.color, {
        p: [spec.len * 0.5, 0, 0],
      }, {}, pivot);
      this._meshSphere(0.32, 8, WOOD_DARK, { p: [spec.len - 0.22, 0, 0] }, {}, pivot);
      const kin = this.kinematicBox(0, spec.y, 0, spec.len * 0.5, spec.width * 0.5, 0.36, {
        x: spec.len * 0.5, y: 0, z: 0,
      }, 'wood');
      this.hands.push({ ...spec, pivot, kin, angle: Math.random() * Math.PI * 2 });
    }

    // Counterweight lift on the east face, stone on the west.
    this._batchCyl(0.1, 0.1, 7.6, 6, METAL, { p: [2.85, 4.0, 0] });
    this._batchCyl(0.1, 0.1, 7.6, 6, METAL, { p: [-2.85, 4.0, 0] });
    this._batchTorus(0.55, 0.09, 4, 12, METAL, { p: [0, 8.4, 0], r: [Math.PI / 2, 0, 0] });
    this._meshCyl(0.5, 0.5, 0.24, 10, YELLOW, { p: [0, 8.4, 0], r: [Math.PI / 2, 0, 0] });

    this.basketGroup = new THREE.Group();
    this.group.add(this.basketGroup);
    this._meshRBox(2.0, 0.22, 2.0, 0.04, WOOD_LIGHT, { p: [2.85, 0, 0] }, {}, this.basketGroup);
    for (const [dx, dz, rot] of [[0, -0.95, 0], [0, 0.95, 0], [-0.95, 0, Math.PI / 2], [0.95, 0, Math.PI / 2]]) {
      this._meshRBox(2.0, 0.5, 0.1, 0.03, WOOD, {
        p: [2.85 + dx, 0.28, dz], r: [0, rot, 0],
      }, {}, this.basketGroup);
    }
    this.basketY = 6.3;
    this.basketKin = this.kinematicBox(2.85, this.basketY, 0, 1.0, 0.12, 1.0, null, 'wood');

    this.stoneGroup = new THREE.Group();
    this.group.add(this.stoneGroup);
    this.stoneMesh = this._meshRBox(0.95, 0.8, 0.8, 0.08, STONE_DARK, { p: [-2.85, 0, 0] }, {}, this.stoneGroup);
    this.stoneY = 2.1;
    this.stoneKin = this.kinematicBox(-2.85, this.stoneY, 0, 0.48, 0.4, 0.4, null, 'stone');

    // Ropes driven by the two pulleys.
    this.basketRope = this._meshCyl(0.035, 0.035, 1, 5, 0x2d2a3a, { p: [2.85, 5, 0] }, {}, this.group);
    this.stoneRope = this._meshCyl(0.035, 0.035, 1, 5, 0x2d2a3a, { p: [-2.85, 5, 0] }, {}, this.group);

    this.crank = new CrankWheel(this, {
      x: 0, y: 0, z: 2.75, rotY: 0, radius: 0.75, label: 'clockwork',
      onPower: p => { this.crankPower = p; },
    });
    this.crankPower = 0;

    // Trapdoor in the base reveals the counterweight pit.
    this.trapdoor = new Trapdoor(this, {
      x: -1.0, y: 0.95, z: -1.4, rotY: 0.2, width: 1.5, depth: 1.5,
      color: WOOD_LIGHT, accent: YELLOW,
    });
  }

  update(dt, ctx) {
    super.update(dt);
    for (const c of this.cogs) c.cog.rotation.y += dt * c.spin * (1.2 + this.crankPower * 3.2);

    // Clock hands sweep; the collider is a kinematic box offset from the pivot.
    for (const h of this.hands) {
      h.angle -= dt * h.speed * (1 + this.crankPower * 1.5);
      h.pivot.rotation.y = h.angle;
      _e.set(0, h.angle, 0);
      _q.setFromEuler(_e);
      const wq = this.worldQuat(_q);
      h.kin.body.setNextKinematicRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w });
    }

    // Elevator: a Dweeb in the basket wins the counterweight tug-of-war.
    let occupied = false;
    const basketWorld = this.worldPoint(2.85, this.basketY, 0);
    this._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.hypot(p.x - basketWorld.x, p.z - basketWorld.z) < 1.35 &&
          Math.abs(p.y - basketWorld.y) < 1.6) occupied = true;
    });
    const target = occupied ? 1.25 : 6.3;
    this.basketY = damp(this.basketY, target, 2.6, dt);
    this.basketGroup.position.y = this.basketY;
    const bw = this.worldPoint(2.85, this.basketY, 0);
    this.basketKin.body.setNextKinematicTranslation({ x: bw.x, y: bw.y, z: bw.z });
    this.stoneY = 9.45 - this.basketY;
    this.stoneGroup.position.y = this.stoneY;
    const sw = this.worldPoint(-2.85, this.stoneY, 0);
    this.stoneKin.body.setNextKinematicTranslation({ x: sw.x, y: sw.y, z: sw.z });

    // Rope lengths follow their loads.
    const topY = this.position.y + 8.4;
    this.basketRope.position.y = (topY + bw.y) * 0.5 - this.position.y;
    this.basketRope.scale.y = Math.max(0.2, topY - bw.y);
    this.stoneRope.position.y = (topY + sw.y) * 0.5 - this.position.y;
    this.stoneRope.scale.y = Math.max(0.2, topY - sw.y);

    // Carry Dweebs standing on a sweeping hand (and on the basket floor).
    for (const h of this.hands) {
      this._carryOnHand(ctx, h, dt);
    }
    this._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.hypot(p.x - bw.x, p.z - bw.z) < 1.1 && Math.abs(p.y - bw.y) < 0.75) {
        d.body.setTranslation({ x: p.x, y: this.basketY + this.position.y + 0.28, z: p.z }, true);
      }
    });

    this.trapdoor?.update(dt, ctx);
    this.crank?.update(dt, ctx);
  }

  _carryOnHand(ctx, hand, dt) {
    const y = this.position.y + hand.y;
    const len = hand.len;
    const dirX = Math.cos(hand.angle), dirZ = -Math.sin(hand.angle);
    this._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.abs(p.y - y) > 0.75) return;
      const rx = p.x - this.position.x, rz = p.z - this.position.z;
      const dist = Math.hypot(rx, rz);
      if (dist > len + 0.3 || dist < 0.4) return;
      const dot = (rx * dirX + rz * dirZ) / dist;
      if (dot < 0.72) return;
      const tangentX = -rz / dist, tangentZ = rx / dist;
      const speed = hand.speed * 2.0 * dist;
      d.body.setTranslation({ x: p.x + tangentX * speed * dt, y: p.y, z: p.z + tangentZ * speed * dt }, true);
      const v = d.body.linvel();
      d.body.setLinvel({ x: v.x + tangentX * speed * dt * 3, y: v.y, z: v.z + tangentZ * speed * dt * 3 }, true);
    });
  }
}

// ─── 5. Waterwheel & Conveyor Chute ───

export class WaterwheelChute extends ToyStructure {
  constructor(physics, scene, opts = {}) {
    super(physics, scene, { ...opts, id: 'waterwheel', name: 'Waterwheel Conveyor Chute' });
    this.build();
    this.flush();
  }

  build() {
    // Stair-side platform and support legs.
    this._batchCyl(2.8, 3.5, 2.2, 10, STONE_DARK, { p: [0, -0.85, 0] });
    this._batchCyl(3.2, 3.4, 0.4, 10, STONE, { p: [0, 0.2, 0] });
    this.staticCylinder(0, 0.2, 0, 3.3, 0.2, 'stone');
    for (const [x, z] of [[-1.5, 1.2], [1.5, 1.2], [-1.5, -1.0], [1.5, -1.0]]) {
      this._batchRBox(0.28, 5.0, 0.28, 0.04, WOOD, { p: [x, 2.7, z] });
      this.staticCylinder(x, 2.7, z, 0.24, 2.5, 'wood');
    }
    this._batchRBox(3.6, 0.3, 3.0, 0.05, WOOD_LIGHT, { p: [0, 5.25, 0.5] });
    this.staticBox(0, 5.25, 0.5, 1.8, 0.15, 1.5, 'wood');
    for (let i = 0; i < 8; i++) {
      this._batchRBox(0.12, 0.8, 0.12, 0.02, WOOD_DARK, { p: [-1.7 + i * 0.49, 5.75, -0.95] });
    }
    this._batchBox(3.6, 0.08, 0.08, WOOD_DARK, { p: [0, 6.1, -0.95] });

    // Ladder up to the chute launch.
    this._batchRBox(0.14, 5.4, 0.14, 0.02, WOOD_DARK, { p: [-0.52, 2.7, 2.55] });
    this._batchRBox(0.14, 5.4, 0.14, 0.02, WOOD_DARK, { p: [0.52, 2.7, 2.55] });
    for (let i = 0; i < 10; i++) {
      this._batchRBox(1.0, 0.12, 0.16, 0.02, i % 2 ? WOOD_LIGHT : WOOD_DARK, {
        p: [0, 0.4 + i * 0.52, 2.55],
      });
    }
    this.ladder = new LadderZone(this, { x: 0, y: 0.2, z: 2.55, width: 1.15, height: 5.1, depth: 0.9 });

    // Waterwheel on the upstream side.
    this.wheel = new THREE.Group();
    this.wheel.position.set(-3.1, 2.9, 0.6);
    this.group.add(this.wheel);
    this._meshCyl(0.55, 0.55, 1.1, 10, WOOD_DARK, { r: [Math.PI / 2, 0, 0] }, {}, this.wheel);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this._meshBox(0.24, 2.6, 0.9, i % 2 ? WOOD_LIGHT : TEAL, {
        p: [Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0], r: [0, 0, a],
      }, {}, this.wheel);
    }
    this._batchTorus(2.7, 0.1, 4, 20, METAL, { p: [-3.1, 2.9, 0.62], r: [Math.PI / 2, 0, 0] });
    this.staticCylinder(-3.1, 2.9, 0.6, 0.6, 0.6, 'wood');

    // Water channel under the wheel.
    this._batchBox(5.0, 0.08, 2.2, 0x38bdf8, { p: [-1.4, 0.18, 0.6] }, { transparent: true, opacity: 0.8 });

    // The pool follows the riverbank rather than the tower's centre height.
    const poolGround = this.groundLocal(6.3, 2.75);
    this.poolBaseY = Math.max(-1.4, poolGround + 0.12);
    this.poolEndY = Math.max(0.5, this.poolBaseY + 0.55);

    // Curved chute: a sampled catmull-ish polyline with a physical floor and rails.
    this.trackLocal = sampleTrack([
      new THREE.Vector3(0, 5.2, 1.55),
      new THREE.Vector3(1.9, 4.55, 2.0),
      new THREE.Vector3(3.9, 2.9, 2.5),
      new THREE.Vector3(5.6, this.poolEndY + 0.55, 2.7),
      new THREE.Vector3(6.3, this.poolEndY, 2.75),
    ], 16, 0.12);
    const FWD = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < this.trackLocal.length - 1; i++) {
      const a = this.trackLocal[i], b = this.trackLocal[i + 1];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(FWD, dir.normalize());
      // Floor segment (wood planks alternate).
      this._meshBox(2.15, 0.16, len + 0.03, i % 2 ? WOOD_LIGHT : 0xc98d4a, { p: mid.toArray(), q }, {}, this.group);
      this.staticBox(mid.x, mid.y, mid.z, 1.075, 0.08, len * 0.5, 'wood', null, q);
      // Rails: right vector from the segment tangent.
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      for (const side of [-1, 1]) {
        const railPos = mid.clone().addScaledVector(right, side * 1.02).add(new THREE.Vector3(0, 0.16, 0));
        this._meshBox(0.1, 0.3, len + 0.02, YELLOW, { p: railPos.toArray(), q }, {}, this.group);
      }
    }
    // Support trestle under the middle of the chute.
    for (const t of [0.35, 0.65]) {
      const p = this.trackLocal[Math.floor(t * (this.trackLocal.length - 1))];
      this._batchRBox(0.22, p.y, 0.22, 0.03, WOOD_DARK, { p: [p.x, p.y * 0.5, p.z] });
      this.staticCylinder(p.x, p.y * 0.5, p.z, 0.2, p.y * 0.5, 'wood');
    }

    // Soft pool at the chute mouth, with a stone skirt down to the riverbank.
    this.pool = this.worldPoint(6.3, this.poolBaseY, 2.75);
    this.poolRadius = 2.7;
    this._batchCyl(2.85, 3.0, 0.3, 12, STONE, { p: [6.3, this.poolBaseY + 0.15, 2.75] });
    this._batchCyl(2.7, 3.0, Math.max(0.4, this.poolBaseY - this.groundLocal(6.3, 2.75) + 0.4), 12, STONE_DARK, {
      p: [6.3, (this.poolBaseY + this.groundLocal(6.3, 2.75)) * 0.5 - 0.15, 2.75],
    });
    this._batchTorus(2.75, 0.16, 5, 16, STONE_DARK, { p: [6.3, this.poolBaseY + 0.32, 2.75], r: [Math.PI / 2, 0, 0] });
    const waterGeo = this._ownGeom(new THREE.CircleGeometry(2.6, 16));
    waterGeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterGeo, this._mat(0x38bdf8, { transparent: true, opacity: 0.82 }));
    this.water.position.set(6.3, this.poolBaseY + 0.36, 2.75);
    this.group.add(this.water);
    this._batchSphere(0.3, 6, CREAM, { p: [5.1, 0.55, 2.2] });
    this._batchSphere(0.2, 6, PINK, { p: [6.9, 0.5, 3.2] });

    // The direction lever at the top of the chute.
    this.lever = new Lever(this, {
      x: 1.3, y: 5.4, z: 0.6, rotY: 0,
      label: 'chuteDirection', value: 1, radius: 2.2,
      onToggle: value => { this.chuteDir = value; },
    });
    this.chuteDir = 1;

    // World-space chute samples for the conveyor/boarding logic.
    this.trackWorld = this.trackLocal.map(p => this.worldPoint(p.x, p.y, p.z));
    this.splashCd = 0;
  }

  update(dt, ctx) {
    super.update(dt);
    this.splashCd = Math.max(0, this.splashCd - dt);
    if (this.wheel) this.wheel.rotation.z += dt * (0.7 + (this.chuteDir > 0 ? 0.5 : -0.25));
    this.ladder?.update(dt, ctx);
    this.lever?.update(dt, ctx);

    // Conveyor chute: follow the tangent, bank through the curve, then splash into the pool.
    this._dweebs(ctx, d => {
      const p = d.body.translation();
      const pp = _v.set(p.x, p.y, p.z);
      const hit = nearestOnTrack(this.trackWorld, pp);
      if (!hit || hit.distance > 1.55) return;
      const v = d.body.linvel();
      const dir = this.chuteDir;
      const tangent = _v2.copy(hit.tangent);
      // Banking force toward the outside of the curve keeps riders inside the rails.
      const rx = p.x - this.position.x, rz = p.z - this.position.z;
      const outward = _v.set(rx, 0, rz).normalize();
      const speed = 7.5 * dir;
      d.body.setLinvel({
        x: tangent.x * speed + outward.x * 1.4,
        y: Math.min(v.y, 0) + (dir < 0 ? 3.4 : -0.4),
        z: tangent.z * speed + outward.z * 1.4,
      }, true);
      d.body.setTranslation({
        x: p.x + tangent.x * speed * dt * 0.35,
        y: p.y,
        z: p.z + tangent.z * speed * dt * 0.35,
      }, true);
    });

    // Pool: soft landing, a little bounce, splash feedback.
    this._dweebs(ctx, d => {
      const p = d.body.translation();
      if (Math.hypot(p.x - this.pool.x, p.z - this.pool.z) > this.poolRadius) return;
      if (p.y > this.pool.y + 2.0 || p.y < this.pool.y - 1.0) return;
      const v = d.body.linvel();
      if (this.splashCd <= 0 || v.y < -2) {
        d.body.setLinvel({ x: v.x * 0.45, y: 5.6, z: v.z * 0.45 }, true);
        if (this._cool(d, 'poolSplash', dt, 0.5)) {
          this._fx('poolSplash', { x: p.x, y: this.pool.y + 0.4, z: p.z }, BLUE);
          this.splashCd = 0.35;
        }
      }
    });
  }
}

// ─── 6. Breakable Toy Fort ───

export class ToyFort extends ToyStructure {
  constructor(physics, scene, opts = {}) {
    super(physics, scene, { ...opts, id: 'fort', name: 'Breakable Toy Fort' });
    this.blocks = [];
    this.debris = [];
    this.blockColors = [WOOD_LIGHT, 0xe7c79c, CREAM, 0xc98d4a, 0xd9b07a];
    this.build();
    this.rebuildBlockMesh();
    this.flush();
  }

  build() {
    this._batchCyl(5.0, 5.9, 2.2, 12, STONE_DARK, { p: [0, -0.9, 0] });
    this._batchCyl(5.4, 5.8, 0.35, 12, STONE, { p: [0, 0.17, 0] });
    this.staticCylinder(0, 0.17, 0, 5.6, 0.17, 'stone');

    // Four rampart walls. Front and back leave an opening for the gates.
    this._buildWall(0, 4.0, 0, 7.0, { gate: true });
    this._buildWall(0, -4.0, 0, 7.0, { gate: true });
    this._buildWall(-4.0, 0, Math.PI / 2, 7.0, {});
    this._buildWall(4.0, 0, Math.PI / 2, 7.0, {});

    // Corner towers (two stacked block courses each).
    for (const [x, z] of [[-4.1, -4.1], [4.1, -4.1], [-4.1, 4.1], [4.1, 4.1]]) {
      for (let level = 0; level < 2; level++) {
        for (let i = 0; i < 2; i++) {
          this._block(x + (i - 0.5) * 0.82, 0.45 + level * 0.9, z + (level % 2 ? 0.2 : -0.2), 1.0, 0.92, 0.62, 0, tint(WOOD_LIGHT, (i % 2 ? 0.04 : -0.04)));
        }
      }
    }

    // Gate doors + the drawbridge beyond them.
    this.door = new HingedDoor(this, {
      x: 0, y: 0.35, z: 4.22, rotY: 0, width: 1.7, height: 1.95,
      color: WOOD_LIGHT, accent: YELLOW, swing: 1, burstSpeed: 7,
    });
    this.bridge = new Drawbridge(this, {
      x: 0, y: 0.4, z: 4.35, rotY: 0, length: 3.9, width: 2.6,
      color: WOOD, accent: STONE_DARK, raised: false,
    });
    this.bridgeLever = new Lever(this, {
      x: 2.1, y: 0.35, z: 3.4, rotY: Math.PI, label: 'drawbridge', value: 1, radius: 1.9,
      onToggle: () => this.bridge.toggle(),
    });

    // A sneaky trapdoor in the courtyard floor.
    this.trapdoor = new Trapdoor(this, {
      x: -2.2, y: 0.42, z: 0.4, rotY: 0.15, width: 1.7, depth: 1.7,
      color: WOOD, accent: YELLOW,
    });

    // Interior dressing: barrels, a table, a banner and a secret crate stash.
    this._batchCyl(0.42, 0.46, 0.9, 8, 0x9a6a3a, { p: [1.5, 0.55, -1.8] });
    this._batchTorus(0.43, 0.04, 4, 10, METAL, { p: [1.5, 0.75, -1.8], r: [Math.PI / 2, 0, 0] });
    this._batchCyl(0.42, 0.46, 0.9, 8, 0x9a6a3a, { p: [1.6, 0.55, 0.2] });
    this._batchRBox(2.1, 0.16, 1.0, 0.04, WOOD_LIGHT, { p: [-0.6, 0.85, -2.2] });
    this._batchRBox(0.18, 0.8, 0.8, 0.03, WOOD_DARK, { p: [-1.35, 0.45, -2.2] });
    this._batchRBox(0.18, 0.8, 0.8, 0.03, WOOD_DARK, { p: [0.15, 0.45, -2.2] });
    this._batchBox(2.0, 1.0, 0.06, RED, { p: [0, 2.2, -3.7] });
    this._batchCyl(1.0, 1.0, 0.08, 10, YELLOW, { p: [0, 2.2, -3.72], r: [Math.PI / 2, 0, 0] });
    this._batchCyl(0.9, 0.9, 0.09, 10, RED, { p: [0, 2.2, -3.73], r: [Math.PI / 2, 0, 0] });

    // Flag on the back tower.
    this._batchCyl(0.07, 0.09, 9.0, 6, METAL, { p: [-4.1, 4.5, -4.1] });
    this.flag = this._meshBox(1.25, 0.7, 0.06, PINK, { p: [-3.5, 8.55, -4.1] });

    // Secret gate under the back wall — a rising iron portcullis.
    this.secretGate = new RisingGate(this, {
      x: 0, y: 1.55, z: -3.95, rotY: 0, width: 2.2, height: 2.4,
      color: STONE_DARK, accent: TEAL, openOffset: 2.6,
    });
    // A hidden button behind the table raises it.
    this.secretButton = new PressureButton(this, {
      x: -0.6, y: 0.42, z: -2.7, radius: 0.85, color: TEAL, accent: CREAM,
      onPress: () => this.secretGate.setOpen(true),
      onRelease: () => this.secretGate.setOpen(false),
    });

    this.repairPoint = this.worldPoint(0, 1.5, 4.6);
    this.repairProgress = 0;
  }

  _buildWall(cx, cz, rotY, length, { gate = false } = {}) {
    const blockW = 1.55, blockH = 0.92, blockD = 0.58;
    const cols = Math.max(3, Math.floor(length / blockW));
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < cols; i++) {
        const off = -length * 0.5 + (i + 0.5) * (length / cols);
        const gateZone = gate && Math.abs(off) < 1.0;
        if (gateZone) continue;
        const x = cx + cos * off;
        const z = cz - sin * off;
        const y = 0.48 + row * blockH;
        const color = this.blockColors[(i + row * 2) % this.blockColors.length];
        this._block(x, y, z, blockW, blockH, blockD, rotY, tint(color, ((i % 3) - 1) * 0.025));
      }
    }
    // Battlement crenellations sit on the wall cap, not floating above it.
    const wallTop = 0.48 + blockH * 0.5 + blockH;
    for (let i = 0; i < cols; i += 2) {
      const off = -length * 0.5 + (i + 0.5) * (length / cols);
      if (gate && Math.abs(off) < 0.8) continue;
      const x = cx + cos * off;
      const z = cz - sin * off;
      this._block(x, wallTop + 0.4, z, blockW * 0.74, 0.8, blockD, rotY, tint(CREAM, i % 4 ? 0 : -0.04));
    }
  }

  _block(x, y, z, w, h, d, rotY, color) {
    const block = {
      x, y, z, w, h, d, rotY, color,
      hp: 150, maxHp: 150, alive: true, collider: null,
    };
    const c = this.staticBox(x, y, z, w * 0.5, h * 0.5, d * 0.5, 'wood', [0, rotY, 0]);
    block.collider = c;
    this.trackColliderRef(c.collider, block);
    this.blocks.push(block);
    return block;
  }

  rebuildBlockMesh() {
    if (this.blockMesh) {
      this.group.remove(this.blockMesh);
      if (this._ownedGeos.has(this.blockMesh.geometry)) this._ownedGeos.delete(this.blockMesh.geometry);
      this.blockMesh.geometry.dispose();
      this.blockMesh = null;
    }
    const geos = [];
    for (const b of this.blocks) {
      if (!b.alive) continue;
      const key = `fortBlock:${b.w}:${b.h}:${b.d}`;
      const base = this._geo(key, () => new THREE.BoxGeometry(b.w, b.h, b.d));
      const g = base.index ? base.toNonIndexed() : base.clone();
      if (g.attributes.uv) g.deleteAttribute('uv');
      if (g.attributes.color) g.deleteAttribute('color');
      g.applyMatrix4(blockMatrix(b.x, b.y, b.z, b.rotY));
      const col = new Float32Array(g.attributes.position.count * 3);
      _c.setHex(b.color);
      for (let i = 0; i < g.attributes.position.count; i++) {
        col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(g);
    }
    if (geos.length) {
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (merged) {
        this._ownGeom(merged);
        this.blockMesh = new THREE.Mesh(merged, this._mat(0xffffff, { vertexColors: true }));
        this.blockMesh.castShadow = true;
        this.blockMesh.receiveShadow = true;
        this.group.add(this.blockMesh);
      }
    }
  }

  smashBlock(block, dir = null, power = 1) {
    if (!block || !block.alive) return false;
    block.alive = false;
    if (block.collider) {
      this.physics?.removeBody?.(block.collider.id);
      const i = this.colliders.indexOf(block.collider);
      if (i >= 0) this.colliders.splice(i, 1);
      block.collider = null;
    }
    const wp = this.worldPoint(block.x, block.y, block.z);
    const d = dir || { x: (Math.random() - 0.5) * 2, y: 0.6, z: (Math.random() - 0.5) * 2 };
    for (let i = 0; i < 3; i++) {
      const hx = block.w * (0.16 + Math.random() * 0.1);
      const hy = block.h * (0.16 + Math.random() * 0.1);
      const hz = block.d * (0.22 + Math.random() * 0.12);
      const geo = this._geo(`debris:${hx.toFixed(2)}:${hy.toFixed(2)}:${hz.toFixed(2)}`, () => new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2));
      const mesh = new THREE.Mesh(geo, this._mat(block.color, {}));
      mesh.castShadow = true;
      mesh.position.set(wp.x, wp.y, wp.z);
      this.scene?.add(mesh);
      const result = this.physics.createDynamicBody(
        wp.x + (Math.random() - 0.5) * 0.5,
        wp.y + (Math.random() - 0.5) * 0.4,
        wp.z + (Math.random() - 0.5) * 0.5,
        'box', { hx, hy, hz },
        { material: 'wood', mass: 0.55, isDebris: true },
      );
      this.physics.applyImpulse(result.body, {
        x: d.x * (1.4 + Math.random() * 1.2) * power,
        y: (2.2 + Math.random() * 3.0) * power,
        z: d.z * (1.4 + Math.random() * 1.2) * power,
      });
      this.debris.push({ mesh, id: result.id, body: result.body, life: 6.5 });
    }
    this._fx('fortSmash', { x: wp.x, y: wp.y, z: wp.z }, block.color, power);
    this.rebuildBlockMesh();
    return true;
  }

  getDamaged() {
    return this.blocks.some(b => !b.alive);
  }

  get isRepaired() {
    return !this.getDamaged();
  }

  repairNext() {
    const block = this.blocks.find(b => !b.alive);
    if (!block) return false;
    block.alive = true;
    block.hp = block.maxHp;
    block.collider = this.staticBox(
      block.x, block.y, block.z,
      block.w * 0.5, block.h * 0.5, block.d * 0.5,
      'wood', [0, block.rotY, 0],
    );
    this.trackColliderRef(block.collider.collider, block);
    this.rebuildBlockMesh();
    const wp = this.worldPoint(block.x, block.y, block.z);
    this._fx('fortRepair', { x: wp.x, y: wp.y, z: wp.z });
    return true;
  }

  /** Called by autonomous workers: repair one block per beat. */
  repairStep(dt) {
    if (!this.getDamaged()) {
      this.repairProgress = 0;
      return false;
    }
    this.repairProgress += dt;
    if (this.repairProgress >= 0.55) {
      this.repairProgress = 0;
      this.repairNext();
    }
    return this.getDamaged();
  }

  update(dt, ctx) {
    super.update(dt);
    this.repairProgress = Math.max(0, this.repairProgress);
    this.door?.update(dt, ctx);
    this.bridge?.update(dt, ctx);
    this.bridgeLever?.update(dt, ctx);
    this.trapdoor?.update(dt, ctx);
    this.secretButton?.update(dt, ctx);
    this.secretGate?.update(dt);
    if (this.flag) this.flag.rotation.y = Math.sin(this._time * 2.6) * 0.16;

    // Impact-driven damage from thrown props, boulders and Dweeb collisions.
    const impacts = this.physics?.getImpacts?.() || [];
    for (const imp of impacts) {
      this._testImpact(imp.a, imp.b, imp.speed);
      this._testImpact(imp.b, imp.a, imp.speed);
    }
    // A fast Dweeb body-check is a reliable fallback when contact events are quiet.
    this._dweebs(ctx, d => {
      const v = d.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < 7.2) return;
      const p = d.body.translation();
      for (const b of this.blocks) {
        if (!b.alive) continue;
        const wp = this.worldPoint(b.x, b.y, b.z);
        if (Math.hypot(p.x - wp.x, p.y - wp.y, p.z - wp.z) > 1.45) continue;
        this.smashBlock(b, { x: v.x, y: v.y, z: v.z }, Math.min(1.6, speed / 8));
        break;
      }
    });

    // Debris lifetime + visual sync.
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.body) {
        const t = d.body.translation();
        const r = d.body.rotation();
        d.mesh.position.set(t.x, t.y, t.z);
        d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        if (d.life < 0.5) d.mesh.scale.setScalar(Math.max(0.01, d.life / 0.5));
      }
      if (d.life <= 0 || !d.body || d.body.translation().y < -14) {
        this.physics?.removeBody?.(d.id);
        this.scene?.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  _testImpact(info, other, speed) {
    const block = info?.ref;
    if (!block || !block.alive) return;
    const mass = other?.mass ?? 2;
    if (!shouldShatter(impactScore(speed, mass), block.hp)) return;
    let dir = null;
    if (other?.rigid) {
      const v = other.rigid.linvel();
      const len = Math.hypot(v.x, v.y, v.z);
      if (len > 0.2) dir = { x: v.x / len, y: v.y / len, z: v.z / len };
    }
    this.smashBlock(block, dir, 1);
  }

  dispose() {
    this.door?.dispose?.();
    this.trapdoor?.dispose?.();
    this.bridgeLever?.dispose?.();
    this.secretButton?.dispose?.();
    this.bridge?.dispose?.();
    this.secretGate?.dispose?.();
    for (const d of this.debris) {
      this.physics?.removeBody?.(d.id);
      this.scene?.remove(d.mesh);
    }
    this.debris.length = 0;
    super.dispose();
  }
}

// ─── Factory + town manager ───

const CLASSES = {
  windmill: Windmill,
  watchtower: Watchtower,
  gazebo: BouncyGazebo,
  clockwork: ClockworkTower,
  waterwheel: WaterwheelChute,
  fort: ToyFort,
};

export function createToyStructure(id, physics, scene, opts = {}) {
  const Def = CLASSES[id];
  if (!Def) throw new Error(`Unknown toy structure: ${id}`);
  return new Def(physics, scene, opts);
}

/**
 * ToyTown owns the six landmarks and the shared update/dispose lifecycle. The Meadowlands creates
 * one of these; tests can create one against a stub physics world.
 */
export class ToyTown {
  constructor(physicsWorld, scene, { layout = [], groundAt = () => 0, fx = null, autoBuild = true } = {}) {
    this.physics = physicsWorld;
    this.scene = scene;
    this.fx = fx;
    this.groundAt = groundAt;
    this.structures = [];
    this.byId = new Map();
    this.debug = false;
    if (autoBuild) {
      for (const spot of layout) this.add(spot.id, spot);
    }
  }

  add(id, spot = {}) {
    const def = getStructureDef(id);
    if (!def) return null;
    const x = spot.x ?? 0;
    const z = spot.z ?? 0;
    const y = spot.y ?? this.groundAt(x, z);
    const s = createToyStructure(id, this.physics, this.scene, {
      x, y, z, rotationY: spot.rotationY ?? 0, fx: this.fx, groundAt: this.groundAt,
    });
    this.structures.push(s);
    this.byId.set(id, s);
    if (this.debug) s.setDebugWireframes(true);
    return s;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  /** Structures currently missing blocks (for worker-repair AI). */
  getDamaged() {
    return this.structures.filter(s => s.getDamaged?.());
  }

  getRepairTargets() {
    return this.getDamaged().map(s => ({ structure: s, point: s.repairPoint }));
  }

  update(dt, dweebs = []) {
    const ctx = { dweebs, fx: this.fx, town: this };
    for (const s of this.structures) s.update(dt, ctx);
  }

  setDebugWireframes(on) {
    this.debug = !!on;
    for (const s of this.structures) s.setDebugWireframes(this.debug);
  }

  dispose() {
    for (const s of this.structures) s.dispose();
    this.structures.length = 0;
    this.byId.clear();
  }
}
