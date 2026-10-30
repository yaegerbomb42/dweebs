// Arena.js — Dweeb Stadium: a floating toy island in the middle of a lagoon stadium.
// Knock rivals off the edge into the water! In sudden death the outer ring crumbles away.
//
// Layout (top of stage is y = 0):
//   - Solid core disc (r = 11) with painted target rings
//   - 16 outer ring tiles (r 11 → 16) that wobble then fall during sudden death
//   - Two floating platforms, a sweeping spinner bar, and two giant wrecking cubes
//   - Four pinball bumpers (r = 8.2) and two trampolines beside the platforms
//   - Lagoon water at y = -5 with bobbing giant toys + D-W-E-E-B-S letter blocks,
//     grandstands + DWEEB STADIUM arch + mountains as scenery

import * as THREE from 'three';
import { InteractiveObject } from './InteractiveObject.js';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';
import { createModel } from './ObjectModels.js';
import { OBJECT_DEFS } from './ObjectRegistry.js';
import { StageHazards } from './StageHazards.js';
import { BALANCE } from '../game/Balance.js';
import { CollisionGroups } from '../physics/PhysicsWorld.js';
import { DEFAULT_ARENA, arenaById } from '../game/Arenas.js';
import * as S from '../render/Stickers.js';

export const CORE_RADIUS = 11;
export const STAGE_RADIUS = 16;
export const WATER_LEVEL = -5;
const SEGMENTS = 16;
const TILE_COLORS = [PALETTE.red, PALETTE.yellow, PALETTE.blue, PALETTE.green];

const START_ITEMS = [
  ['giantHammer', -4, 1, 3],
  ['bowlingBall', 5, 1, -4],
  ['beachBall', 0, 1, 5.5],
  ['spikyBall', -5.5, 1, -1],
  ['crate', 8.5, 1, -1],
  ['explosiveBarrel', -8, 1, 5],
  ['watermelon', 1.5, 1, 9],
  ['bananaPeel', 2.7, 1, 8.1],
  ['bananaPeel', -2.7, 1, 8.1],
  ['toyRocket', -1, 1, -9],
  ['giantDie', 6, 1, 6],
  ['rubberChicken', -6.5, 1, -6.5],
  ['pinata', 9, 1, -5],
  ['freezeRay', 3.5, 1, 4.5],
  ['magnet', -3.5, 1, -4.5],
  ['boxingGlove', 2.1, 1, -2.2],
  ['grappleGlove', -2.1, 1, 2.2],
];
// Sky drops, weighted: comedy props are common, KO-power items are rare (and capped, see RARE)
export const DROP_ITEMS = [
  // common comedy / light throwables
  { key: 'beachBall', w: 8 }, { key: 'rubberChicken', w: 8 }, { key: 'watermelon', w: 7 }, { key: 'cake', w: 6 },
  { key: 'giantRubberDuck', w: 6 }, { key: 'trafficCone', w: 6 }, { key: 'box', w: 6 }, { key: 'poolRing', w: 5 },
  { key: 'teddyBear', w: 5 }, { key: 'pinata', w: 5 }, { key: 'piggyBank', w: 4 }, { key: 'gumballMachine', w: 4 },
  { key: 'fishBowl', w: 4 }, { key: 'boombox', w: 4 }, { key: 'lamp', w: 4 }, { key: 'giantDie', w: 4 },
  { key: 'bananaPeel', w: 4 },
  // mid: solid throwables and furniture
  { key: 'crate', w: 5 }, { key: 'tire', w: 4 }, { key: 'tv', w: 3 }, { key: 'ladder', w: 3 }, { key: 'mattress', w: 3 },
  { key: 'shoppingCart', w: 3 }, { key: 'couch', w: 2 }, { key: 'bowlingBall', w: 3 }, { key: 'spikyBall', w: 3 },
  // rare: the KO makers
  { key: 'giantHammer', w: 1.5 }, { key: 'toyRocket', w: 1.5 }, { key: 'explosiveBarrel', w: 1.5 }, { key: 'anvil', w: 1 },
  // gadget weapons: uncommon, capped by the live-item guard rather than RARE
  { key: 'freezeRay', w: 2 }, { key: 'magnet', w: 2 }, { key: 'grappleGlove', w: 2 },
  // fast hands: low launch, huge cadence
  { key: 'boxingGlove', w: 3 },
  // element props: combine them (water + tesla = shock, oil + pepper = inferno, snow twice = frozen)
  { key: 'waterBalloon', w: 4 }, { key: 'oilDrum', w: 3 }, { key: 'honeyJar', w: 3 }, { key: 'snowGlobe', w: 3 },
  { key: 'pepperBomb', w: 3 }, { key: 'staticCoil', w: 2.5 },
];
// Rare items: at most `max` live at once, and at least `cd` seconds between drops of the same key
const RARE = {
  giantHammer: { max: 1, cd: 45 },
  anvil: { max: 1, cd: 45 },
  toyRocket: { max: 1, cd: 30 },
  explosiveBarrel: { max: 2, cd: 25 },
};
// Pinball bumpers sit between spawn points, clear of the wrecking-cube swing lines (x = ±5.5)
const BUMPERS = [0, 1, 2, 3].map(i => {
  const a = Math.PI / 8 + i * Math.PI / 2;
  return { x: Math.cos(a) * 8.2, z: Math.sin(a) * 8.2, color: [PALETTE.red, PALETTE.blue, PALETTE.yellow, PALETTE.purple][i] };
});
// Trampolines beside the floating platforms: bounce up, drift sideways, land on top
const TRAMPOLINES = [
  { x: Math.cos(Math.PI * 3 / 8) * 8.2, z: Math.sin(Math.PI * 3 / 8) * 8.2, color: PALETTE.blue },
  { x: -Math.cos(Math.PI * 3 / 8) * 8.2, z: -Math.sin(Math.PI * 3 / 8) * 8.2, color: PALETTE.pink },
];
export const BUMPER_RADIUS = 0.7;
export const TRAMPOLINE_RADIUS = 1.05;
export const TRAMPOLINE_TOP = 0.25;
const BOUNCE = BALANCE.bounce;
export const TRAMPOLINE_VEL = BOUNCE.trampolineVel;
export const TRAMPOLINE_ITEM_VEL = BOUNCE.trampolineItemVel;

/** Pinball bounce off a bumper: reflect about the contact normal, never slower than bumperMinSpeed across the floor (Balance.bounce). */
export function bumperBounce(v, dx, dz) {
  const d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
  const vn = v.x * nx + v.z * nz;
  let x = v.x, z = v.z;
  if (vn < 0) { x -= 2 * vn * nx; z -= 2 * vn * nz; } // still coming in (else physics already reflected it)
  let h = Math.hypot(x, z);
  if (h < 0.5) { x = nx; z = nz; h = 1; }
  const s = Math.max(BOUNCE.bumperMinSpeed, h * BOUNCE.bumperGain) / h;
  return { x: x * s, y: Math.max(v.y, BOUNCE.bumperLoft), z: z * s };
}
const POWERUPS = {
  mega: { color: PALETTE.red, icon: '★', label: 'MEGA' },
  zoom: { color: PALETTE.blue, icon: '⚡', label: 'ZOOM' },
  bubble: { color: PALETTE.teal, icon: '●', label: 'BUBBLE' },
  freeze: { color: 0x8fe9ff, icon: '❄', label: 'DEEP FREEZE' },
  magnet: { color: 0xff9a3c, icon: '◎', label: 'MAGNET' },
  sugar: { color: 0xff8fc0, icon: '🍬', label: 'SUGAR RUSH' },
  shield: { color: 0xffd23f, icon: '🛡', label: 'SHIELD' },
  swap: { color: 0xb07cff, icon: '⇄', label: 'SWAP' },
};

/**
 * The mega-stadium ball-pit plastic. Kept as a named factory (instead of an
 * inline toonMat call) so the toon-material property regression test can
 * instantiate exactly what the theme builder uses. NOTE: MeshToonMaterial has
 * no `roughness` property — passing it logs a THREE.Material warning.
 */
export function ballPitMaterial() {
  return toonMat({ color: 0xffffff });
}

import { CrowdClaw } from './CrowdClaw.js';
const CLAW_ARENAS = new Set(['stadium', 'colosseum', 'megastadium']);

export class Arena {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.objects = [];        // InteractiveObject instances (and debris)
    this.segments = [];       // crumbling outer ring tiles
    this.platforms = [];      // { x, z, hw, hd, top }
    this.pendulums = [];
    this.spinners = [];
    this.bumpers = [];
    this.trampolines = [];
    this.floaters = [];      // bobbing lagoon toys
    this.powerups = [];
    this.crowd = null;
    this.cheer = 0;
    this.time = 0;
    this.itemTimer = 6;
    this.powerupTimer = 10;
    this.suddenDeath = false;
    this.crumbleQueue = [];
    this.crumbleTimer = 0;
    this.sdPace = 1;          // sudden-death escalation knobs, driven from main.js
    this.sdWarnScale = 1;
    this.sdPendulumAmp = 0.9;
    this.lastRareDrop = {};
    this.isOccupied = null;   // (segment) => bool, set by main.js

    // ─── Arena personality (see game/Arenas.js) ───
    this.arenaId = DEFAULT_ARENA;
    this.traction = 1;        // ground acceleration multiplier for Dweebs
    this.slide = 1;           // top-speed multiplier for Dweebs
    this.bumperBoost = 1;
    this.pendulumBoost = 1;
    this.gravity = 1;         // world gravity multiplier (Zero-G Moonbase)
    this.wind = false;        // Sky Turbine gusts
    this.windTimer = BALANCE.arena.windFirst;
    this.gustLeft = 0;
    this.gustWarned = false;
    this.gustDir = 1;
    this.windStreaks = null;
    this.hazardsActive = false; // main.js flips this on at "BRAWL!"
    this.themeGroup = null;
    this.coreMat = null;
    this.playmat = null;
    this.lava = null;
    this.conveyors = [];
    this.crustTimer = 0;
    this.crusts = 0;
  }

  build() {
    const beforeCount = this.scene.children.length;
    this._createIsland();
    this._createPlatforms();
    this._createSpinner();
    this._createDeathContraptions();
    this._createWallDropGate();
    this._createDestructibleCover();
    this._createEscapeIslandPuzzles();
    this._createPendulums();
    this._createBumpers();
    this._createTrampolines();
    this._createStadium();
    this._createLagoonToys();
    this._createScenery();
    this._createLava();
    this._createArenaTheme();
    this._spawnStartItems();
    this._stadiumNodes = this.scene.children.slice(beforeCount);
  }

  setStadiumVisible(visible) {
    if (this._stadiumNodes) {
      for (const node of this._stadiumNodes) {
        if (node) node.visible = visible;
      }
    }
    if (this.themeGroup) this.themeGroup.visible = visible;
  }

  // ─── Arena personality ───

  /** Switch the stage theme without touching physics. Safe to call between matches. */
  setArena(id) {
    const def = arenaById(id);
    this.arenaId = def.id;
    this.traction = def.traction ?? 1;
    this.slide = def.slide ?? 1;
    this.bumperBoost = def.bumpers ?? 1;
    this.pendulumBoost = def.pendulums ?? 1;
    this.gravity = def.gravity ?? 1;
    this.wind = !!def.wind;
    this.physicsWorld.setGravityScale?.(this.gravity);

    if (this.coreMat) {
      const tint = { volcano: 0x4a3b46, iceberg: 0xbfeaff, pinball: 0x3a3550 }[def.id] ?? 0x6fdc5a;
      this.coreMat.color.setHex(tint);
    }
    if (this.playmat) this.playmat.visible = def.id === 'stadium';
    if (this.lava) this.lava.mesh.visible = !!def.lava;
    this._clearTheme();
    this._createArenaTheme();
    this._resetArenaHazards();
  }

  _clearTheme() {
    this.stageHazards?.dispose();
    this.stageHazards = null;
    if (!this.themeGroup) return;
    this.scene.remove(this.themeGroup);
    this.themeGroup.traverse(o => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose?.();
    });
    this.themeGroup = null;
    this.conveyors = [];
    this.windStreaks = null;
    this._fanBlades = null;
    this.megaPinwheels = [];
    this.ballPitZones = [];
  }

  _createArenaTheme() {
    const def = arenaById(this.arenaId);
    const g = new THREE.Group();
    this.themeGroup = g;
    this.scene.add(g);
    if (def.id === 'iceberg') this._themeIceberg(g);
    else if (def.id === 'volcano') this._themeVolcano(g);
    else if (def.id === 'pinball') this._themePinball(g);
    else if (def.id === 'moon') this._themeMoon(g);
    else if (def.id === 'gale') this._themeGale(g);
    else if (def.id === 'megastadium') this._themeMegaStadium(g);
    this.stageHazards = StageHazards.wants(def) ? new StageHazards(this, def, g) : null;
  }

  _themeIceberg(g) {
    // A glassy sheet over the whole island…
    const sheet = new THREE.Mesh(
      new THREE.CircleGeometry(CORE_RADIUS - 0.08, 64),
      new THREE.MeshBasicMaterial({ color: 0xd8fbff, transparent: true, opacity: 0.38, depthWrite: false })
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = 0.02;
    noOutline(sheet);
    g.add(sheet);

    // …and ice shards and snowballs around the rim.
    const shardMat = toonMat({ color: 0xbfeaff, transparent: true, opacity: 0.85, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = 9.6 + (i % 3) * 0.55;
      const h = 0.45 + (i % 4) * 0.28;
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.22 + (i % 3) * 0.07, h, 5), shardMat);
      shard.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      shard.rotation.y = a * 1.7;
      shard.rotation.z = (i % 2 ? 1 : -1) * 0.12;
      shard.castShadow = true;
      g.add(shard);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const r = 13.4 + (i % 2) * 1.4;
      const snow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + (i % 3) * 0.08, 1), toonMat({ color: 0xffffff }));
      snow.position.set(Math.cos(a) * r, 0.24, Math.sin(a) * r);
      snow.castShadow = true;
      g.add(snow);
    }
  }

  _themeVolcano(g) {
    // Glowing cracks across the basalt floor.
    const crackMat = new THREE.MeshBasicMaterial({ color: 0xff6a3c });
    for (const [r, tube] of [[5.2, 0.075], [8.1, 0.06], [10.4, 0.05]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 4, 48), crackMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.026;
      noOutline(ring);
      g.add(ring);
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 3 + (i % 5) * 1.55;
      const crack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 1.1 + (i % 3) * 0.6), crackMat);
      crack.position.set(Math.cos(a) * r, 0.028, Math.sin(a) * r);
      crack.rotation.y = a + 0.4;
      noOutline(crack);
      g.add(crack);
    }
    // Charred rocks and a warm under-glow.
    const rockMat = toonMat({ color: 0x3b2d3a, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      const r = 9.8 + (i % 3) * 0.7;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + (i % 2) * 0.2, 0), rockMat);
      rock.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
      rock.rotation.set(i, i * 2, i * 0.7);
      rock.castShadow = true;
      g.add(rock);
    }
    const glow = new THREE.PointLight(0xff5a1f, 2.4, 32, 2);
    glow.position.y = 1.4;
    g.add(glow);
  }

  _themePinball(g) {
    // Two opposing conveyor belts. They push dweebs (and props) sideways.
    const belts = [
      { z: -4.2, dx: 1, color: 0xffd23f, alt: 0x1b1030 },
      { z: 4.2, dx: -1, color: 0x3fa9ff, alt: 0xfff8ee },
    ];
    for (const b of belts) {
      const hw = 6.4, hd = 1.25;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.35, 0.12, hd * 2 + 0.28), toonMat({ color: 0x1b1030 }));
      frame.position.set(0, 0.055, b.z);
      frame.receiveShadow = true;
      g.add(frame);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.09, hd * 2), toonMat({ color: 0x2d2a3a }));
      belt.position.set(0, 0.115, b.z);
      belt.receiveShadow = true;
      g.add(belt);
      // Chevrons show which way the floor is moving.
      const chevMat = new THREE.MeshBasicMaterial({ color: b.color });
      for (let i = 0; i < 10; i++) {
        const x = (i - 4.5) * 1.22;
        const chev = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 3), chevMat);
        chev.rotation.x = -Math.PI / 2;
        chev.rotation.z = b.dx > 0 ? -Math.PI / 2 : Math.PI / 2;
        chev.position.set(x, 0.165, b.z);
        noOutline(chev);
        g.add(chev);
      }
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.6, 0.22, 0.16), toonMat({ color: b.alt }));
        rail.position.set(0, 0.13, b.z + side * (hd + 0.18));
        g.add(rail);
      }
      this.conveyors.push({ x: 0, z: b.z, hw, hd, dx: b.dx, dz: 0 });
    }
    // A candy rail around the play field.
    for (const [r, c] of [[11.1, 0xff6fb5], [15.4, 0x5ee06a]]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 6, 64), toonMat({ color: c }));
      rail.rotation.x = Math.PI / 2;
      rail.position.y = 0.14;
      g.add(rail);
    }
  }

  _themeMoon(g) {
    // Grey regolith over the playmat, ringed with craters and boulders.
    const sheet = new THREE.Mesh(
      new THREE.CircleGeometry(CORE_RADIUS - 0.06, 64),
      new THREE.MeshBasicMaterial({ color: 0xd7d9e8, transparent: true, opacity: 0.5, depthWrite: false })
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = 0.022;
    noOutline(sheet);
    g.add(sheet);

    const dustMat = toonMat({ color: 0xb9bdd2, flatShading: true });
    const darkMat = toonMat({ color: 0x8d93ab, flatShading: true });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + 0.35;
      const r = 3.2 + (i % 4) * 1.7;
      const cr = 0.55 + (i % 3) * 0.24;
      const crater = new THREE.Mesh(new THREE.CylinderGeometry(cr, cr * 0.86, 0.05, 14), darkMat);
      crater.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r);
      g.add(crater);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(cr * 1.02, 0.045, 4, 20), dustMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(crater.position.x, 0.05, crater.position.z);
      noOutline(rim);
      g.add(rim);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.1;
      const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24 + (i % 3) * 0.12, 0), dustMat);
      boulder.position.set(Math.cos(a) * (9.6 + (i % 2) * 0.6), 0.18, Math.sin(a) * (9.6 + (i % 2) * 0.6));
      boulder.rotation.set(i, i * 1.7, i * 0.6);
      boulder.castShadow = true;
      g.add(boulder);
    }
    // Flag: a claim on the rock, and a very small leap for dweeb-kind.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), toonMat({ color: 0xd8dcea }));
    pole.position.set(0, 1.2, 0);
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.62), new THREE.MeshBasicMaterial({ map: S.textSticker('DWEEB\nBASE', { bg: '#ff4d8d', fg: '#fff8ee', w: 256, h: 160 }), side: THREE.DoubleSide }));
    flag.position.set(0.56, 2.0, 0);
    noOutline(flag);
    g.add(flag);
    // Earth, hanging in the black. No fog, so it reads from behind the lagoon.
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(11, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0x3fa9ff, fog: false })
    );
    earth.position.set(-62, 44, -96);
    noOutline(earth);
    g.add(earth);
    const land = new THREE.Mesh(new THREE.SphereGeometry(11.05, 16, 12), new THREE.MeshBasicMaterial({ color: 0x5ee06a, transparent: true, opacity: 0.6, fog: false }));
    land.position.copy(earth.position);
    land.scale.set(0.55, 0.8, 0.35);
    noOutline(land);
    g.add(land);
  }

  _themeGale(g) {
    // Rooftop dressing: fan turbines on the rim and a pair of ventilation stacks.
    const metal = toonMat({ color: 0x8fa3b8 });
    const dark = toonMat({ color: 0x2d2a3a });
    const spinning = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 12.4, z = Math.sin(a) * 12.4;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.66, 0.5, 12), dark);
      base.position.set(x, 0.25, z);
      g.add(base);
      const housing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.13, 6, 18), metal);
      housing.position.set(x, 1.55, z);
      housing.rotation.y = a;
      g.add(housing);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.5, 8), metal);
      mast.position.set(x, 0.85, z);
      g.add(mast);
      const blades = new THREE.Group();
      blades.position.set(x, 1.55, z);
      blades.rotation.y = a;
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.05), toonMat({ color: 0xffd23f }));
        blade.position.y = 0.34;
        blade.rotation.z = (b / 3) * Math.PI * 2;
        blade.position.set(Math.sin((b / 3) * Math.PI * 2) * 0.34, Math.cos((b / 3) * Math.PI * 2) * 0.34, 0);
        blades.add(blade);
      }
      g.add(blades);
      spinning.push(blades);
    }
    this._fanBlades = spinning;

    for (const [x, z, h] of [[7.4, -8.4, 1.5], [-8.6, 7.2, 1.1]]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, h, 10), metal);
      stack.position.set(x, h / 2, z);
      stack.castShadow = true;
      g.add(stack);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.42, 0.25, 10), dark);
      lid.position.set(x, h + 0.12, z);
      g.add(lid);
    }

    // Wind ribbons: hidden until a gust, then they stream along the gust axis.
    const streaks = new THREE.Group();
    streaks.visible = false;
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthWrite: false });
    const items = [];
    for (let i = 0; i < 26; i++) {
      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(1.6 + Math.random() * 1.8, 0.045, 0.045), streakMat);
      ribbon.position.set((Math.random() - 0.5) * 34, 0.4 + Math.random() * 5.6, (Math.random() - 0.5) * 26);
      noOutline(ribbon);
      streaks.add(ribbon);
      items.push({ mesh: ribbon, speed: 12 + Math.random() * 16 });
    }
    g.add(streaks);
    this.windStreaks = { group: streaks, items };
  }

  _themeMegaStadium(g) {
    this.megaPinwheels = [];
    this.ballPitZones = [];

    // 1. Two Giant Sunken Ball Pits with Colorful Balls (Northwest & Southeast)
    const pitDefs = [
      { x: -6.5, z: 6.5, w: 4.8, d: 4.8, rimColor: PALETTE.red },
      { x: 6.5, z: -6.5, w: 4.8, d: 4.8, rimColor: PALETTE.yellow },
    ];

    for (const pit of pitDefs) {
      // Basin Floor
      const basin = new THREE.Mesh(
        new THREE.BoxGeometry(pit.w, 0.1, pit.d),
        toonMat({ color: 0x1a2130 })
      );
      basin.position.set(pit.x, 0.05, pit.z);
      basin.receiveShadow = true;
      g.add(basin);

      // Padded Curbs / Rails
      const curbThickness = 0.35;
      const curbHeight = 0.45;
      const curbMat = toonMat({ color: pit.rimColor });

      const northCurb = new THREE.Mesh(new THREE.BoxGeometry(pit.w + curbThickness * 2, curbHeight, curbThickness), curbMat);
      northCurb.position.set(pit.x, curbHeight / 2, pit.z + pit.d / 2 + curbThickness / 2);
      const southCurb = new THREE.Mesh(new THREE.BoxGeometry(pit.w + curbThickness * 2, curbHeight, curbThickness), curbMat);
      southCurb.position.set(pit.x, curbHeight / 2, pit.z - pit.d / 2 - curbThickness / 2);
      const eastCurb = new THREE.Mesh(new THREE.BoxGeometry(curbThickness, curbHeight, pit.d), curbMat);
      eastCurb.position.set(pit.x + pit.w / 2 + curbThickness / 2, curbHeight / 2, pit.z);
      const westCurb = new THREE.Mesh(new THREE.BoxGeometry(curbThickness, curbHeight, pit.d), curbMat);
      westCurb.position.set(pit.x - pit.w / 2 - curbThickness / 2, curbHeight / 2, pit.z);

      g.add(northCurb, southCurb, eastCurb, westCurb);

      // Instanced Plastic Ball Pit Spheres
      const ballCount = 140;
      const ballGeo = new THREE.SphereGeometry(0.18, 10, 8);
      const ballMat = ballPitMaterial();
      const ballMesh = new THREE.InstancedMesh(ballGeo, ballMat, ballCount);
      const ballColors = [PALETTE.red, PALETTE.yellow, PALETTE.blue, PALETTE.green, 0xff70a6, 0x00f0ff, 0xff9900];
      const dummy = new THREE.Object3D();
      const col = new THREE.Color();

      for (let b = 0; b < ballCount; b++) {
        const bx = pit.x + (Math.random() - 0.5) * (pit.w - 0.6);
        const bz = pit.z + (Math.random() - 0.5) * (pit.d - 0.6);
        const by = 0.12 + Math.random() * 0.32;
        dummy.position.set(bx, by, bz);
        dummy.scale.setScalar(0.85 + Math.random() * 0.3);
        dummy.updateMatrix();
        ballMesh.setMatrixAt(b, dummy.matrix);
        ballMesh.setColorAt(b, col.set(ballColors[Math.floor(Math.random() * ballColors.length)]));
      }
      ballMesh.castShadow = true;
      ballMesh.receiveShadow = true;
      noOutline(ballMesh);
      g.add(ballMesh);

      this.ballPitZones.push({
        x: pit.x,
        z: pit.z,
        hw: pit.w / 2,
        hd: pit.d / 2,
      });
    }

    // 2. Play Slides & Incline Ramp Chutes
    const slideDefs = [
      { x: -9.5, z: -3.5, rotY: 0.4, color: PALETTE.blue },
      { x: 9.5, z: 3.5, rotY: Math.PI + 0.4, color: PALETTE.red },
    ];
    for (const s of slideDefs) {
      const slideGroup = new THREE.Group();
      slideGroup.position.set(s.x, 0, s.z);
      slideGroup.rotation.y = s.rotY;

      // Incline Ramp
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.25, 4.2),
        toonMat({ color: s.color })
      );
      ramp.position.set(0, 0.9, 0);
      ramp.rotation.x = -0.38;
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      slideGroup.add(ramp);

      // Side Guard Rails
      for (const side of [-1.2, 1.2]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.5, 4.2),
          toonMat({ color: PALETTE.yellow })
        );
        rail.position.set(side, 1.1, 0);
        rail.rotation.x = -0.38;
        slideGroup.add(rail);
      }
      g.add(slideGroup);
    }

    // 3. Rotating 4-Blade Obstacle Pinwheels (Floor sweepers)
    const pinwheelDefs = [
      { x: 0, z: 6.8, speed: 2.2 },
      { x: 0, z: -6.8, speed: -2.2 },
    ];
    for (const pw of pinwheelDefs) {
      const pwGroup = new THREE.Group();
      pwGroup.position.set(pw.x, 0.08, pw.z);

      // Central Hub
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.85, 0.95, 0.28, 16),
        toonMat({ color: PALETTE.blue })
      );
      pwGroup.add(hub);

      // 4 Sweeping Color Blades
      const bladeColors = [PALETTE.yellow, PALETTE.green, PALETTE.red, 0x00f0ff];
      const bladeGroup = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.26, 2.5),
          toonMat({ color: bladeColors[i] })
        );
        blade.position.set(0, 0.12, 1.35);
        const pivot = new THREE.Group();
        pivot.rotation.y = (i * Math.PI) / 2;
        pivot.add(blade);
        bladeGroup.add(pivot);
      }
      pwGroup.add(bladeGroup);
      g.add(pwGroup);

      this.megaPinwheels.push({
        group: pwGroup,
        bladeGroup,
        x: pw.x,
        z: pw.z,
        radius: 2.6,
        speed: pw.speed,
      });
    }

    // 4. Multi-tier Stadium Signs ("BATTLE AREA", "START")
    for (const [x, z, label, bg] of [
      [-13.5, 9.5, 'BATTLE\nAREA', '#ffdd00'],
      [13.5, -9.5, 'START', '#e31e24'],
    ]) {
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 1.6),
        new THREE.MeshBasicMaterial({
          map: S.textSticker(label, { bg, fg: '#111111', w: 256, h: 128 }),
          side: THREE.DoubleSide,
        })
      );
      banner.position.set(x, 2.4, z);
      banner.rotation.y = Math.atan2(-x, -z);
      noOutline(banner);
      g.add(banner);

      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8),
        toonMat({ color: 0x8a9ba8 })
      );
      post.position.set(x, 1.2, z);
      g.add(post);
    }
  }

  _createLava() {
    const A = BALANCE.arena;
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.92 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = A.lavaStartY;
    mesh.visible = false;
    noOutline(mesh);
    this.scene.add(mesh);
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(15.5, 30, 64),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.24, depthWrite: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    mesh.add(glow);
    this.lava = { mesh, y: A.lavaStartY, glow };
  }

  _resetArenaHazards() {
    this.claw?.reset();
    const A = BALANCE.arena;
    this.stageHazards?.reset();
    this.physicsWorld.setGravityScale?.(this.gravity);
    this.windTimer = A.windFirst;
    this.gustLeft = 0;
    this.gustWarned = false;
    this.gustDir = 1;
    if (this.windStreaks) this.windStreaks.group.visible = false;
    for (const p of this.platforms) {
      if (p.dropUntil && p.collider) p.collider.setCollisionGroups(p.solids);
      p.dropUntil = 0;
    }
    if (this.lava) {
      this.lava.y = A.lavaStartY;
      this.lava.mesh.position.y = A.lavaStartY;
      this.lava.mesh.visible = arenaById(this.arenaId).lava;
    }
    this.crustTimer = A.crustFirst;
    this.crusts = 0;
  }

  /** The floating platform a Dweeb is standing on, if any. */
  platformUnder(pos) {
    for (const p of this.platforms) {
      if (Math.abs(pos.x - p.x) > p.hw + 0.35 || Math.abs(pos.z - p.z) > p.hd + 0.35) continue;
      if (pos.y < p.top - 0.12 || pos.y > p.top + 1.15) continue;
      return p;
    }
    return null;
  }

  /** Down + jump on a floating platform: let the owner fall through it for a beat. */
  dropThroughUnder(d) {
    const p = this.platformUnder(d.getPosition());
    if (!p || !p.collider) return false;
    p.dropUntil = this.time + 0.32;
    p.collider.setCollisionGroups(this.physicsWorld.makeGroups(CollisionGroups.WALL, CollisionGroups.ALL & ~CollisionGroups.PLAYER));
    d.dropGrace = 0.22;
    d.grounded = false;
    const v = d.body.linvel();
    d.body.setLinvel({ x: v.x, y: Math.min(v.y, -2.5), z: v.z }, true);
    return true;
  }

  _updatePlatforms() {
    for (const p of this.platforms) {
      if (p.dropUntil && this.time > p.dropUntil) {
        if (p.collider) p.collider.setCollisionGroups(p.solids);
        p.dropUntil = 0;
      }
    }
  }

  /** Rising lava + periodic crust collapses on the volcano. */
  _updateVolcano(dt) {
    const A = BALANCE.arena;
    const lava = this.lava;
    if (!lava) return;
    const rate = this.suddenDeath ? A.lavaRiseSudden : A.lavaRise;
    lava.y = Math.min(A.lavaMaxY, lava.y + rate * dt);
    lava.mesh.position.y = lava.y;
    lava.glow.material.opacity = 0.18 + Math.sin(this.time * 3) * 0.08;

    if (!this.suddenDeath && this.dweebs) {
      for (const d of this.dweebs) {
        if (!d.active || d.grabbedBy || (d.hazardCd || 0) > 0) continue;
        const p = d.getPosition();
        if (this.isOverGround(p.x, p.z, 0.2)) continue;
        if (p.y > lava.y + 0.45) continue;
        const dx = p.x || 0.1, dz = p.z || 0.1;
        const launch = d.receiveHit({
          dir: { x: dx * 0.08, y: 0.9, z: dz * 0.08 },
          damage: A.lavaDamage, base: A.lavaLaunch * 0.55, growth: 9,
          attacker: null, time: this.time,
        });
        d.hazardCd = A.lavaCooldown;
        if (launch > 0) this.onLavaHit?.(d, launch);
      }
    }

    // Crust collapses before sudden death: a slow nibble instead of the full ring.
    if (this.hazardsActive && !this.suddenDeath && this.crusts < A.crustMax) {
      this.crustTimer -= dt;
      if (this.crustTimer <= 0) {
        this.crustTimer = A.crustEvery;
        const solid = this.segments.filter(s => s.state === 'solid' && !(this.isOccupied?.(s)));
        if (solid.length) {
          const seg = solid[Math.floor(Math.random() * solid.length)];
          this._warnSegment(seg);
          this.crusts++;
          this.onCrustWarn?.(seg);
        }
      }
    }
  }

  /** Sky Turbine: telegraph, then shove the whole stage sideways for a few seconds. */
  _updateWind(dt) {
    const A = BALANCE.arena;
    if (!this.wind) return;
    if (this.gustLeft <= 0) {
      this.windTimer -= dt;
      if (!this.gustWarned && this.windTimer <= A.windWarn) {
        this.gustWarned = true;
        this.gustDir = -this.gustDir;
        this.onGustWarn?.(this.gustDir);
      }
      if (this.windTimer <= 0) {
        this.gustLeft = A.windDuration;
        this.gustWarned = false;
        this.windTimer = A.windEvery;
        this.onGust?.(this.gustDir);
      }
    } else {
      this.gustLeft = Math.max(0, this.gustLeft - dt);
    }

    const active = this.gustLeft > 0;
    if (this.windStreaks) {
      this.windStreaks.group.visible = active || this.gustWarned;
      if (this.windStreaks.group.visible) {
        for (const s of this.windStreaks.items) {
          s.mesh.position.x += this.gustDir * s.speed * dt * (active ? 1 : 0.22);
          if (s.mesh.position.x * this.gustDir > 19) s.mesh.position.x = -this.gustDir * 19;
        }
      }
    }
    if (this._fanBlades) for (const f of this._fanBlades) f.rotation.z += dt * (active ? 26 : 7);
    if (!active) return;

    const dir = this.gustDir;
    for (const d of this.dweebs ?? []) {
      if (!d.active || d.grabbedBy) continue;
      const v = d.body.linvel();
      const k = d.grounded ? 0.35 : 1; // planted feet take a fraction of the shove
      d.body.setLinvel({ x: v.x + dir * A.windForce * k * dt, y: v.y + A.windLift * dt, z: v.z }, true);
      d.windShoved = (d.windShoved || 0) + dt;
    }
    for (const obj of this.objects) {
      if (obj.isDebris || obj.isGrabbed || !obj.body) continue;
      const m = obj.body.mass();
      this.physicsWorld.applyImpulse(obj.body, {
        x: dir * A.windItemForce * dt * m,
        y: A.windLift * dt * m,
        z: 0,
      });
    }
  }

  /** Factory belts: nudge anything standing on them sideways. */
  _updateConveyors(dt) {
    const push = BALANCE.arena.conveyorPush;
    for (const c of this.conveyors) {
      for (const d of this.dweebs ?? []) {
        if (!d.active || d.grabbedBy || d.ledge) continue;
        const p = d.getPosition();
        if (p.y > 1.6 || p.y < -1.2) continue;
        if (Math.abs(p.z - c.z) > c.hd + 0.25 || Math.abs(p.x - c.x) > c.hw) continue;
        if (!d.grounded) continue;
        const v = d.body.linvel();
        d.body.setLinvel({ x: v.x + c.dx * push * dt, y: v.y, z: v.z + c.dz * push * dt }, true);
      }
      for (const obj of this.objects) {
        if (obj.isDebris || obj.isGrabbed || !obj.body) continue;
        const p = obj.getPosition();
        if (p.y > 1.5 || Math.abs(p.z - c.z) > c.hd + 0.4 || Math.abs(p.x - c.x) > c.hw) continue;
        const v = obj.body.linvel();
        obj.body.setLinvel({ x: v.x + c.dx * push * 0.55 * dt, y: v.y, z: v.z + c.dz * push * 0.55 * dt }, true);
      }
    }
  }

  /** Mega Obstacle Stadium: Rotate 4-blade pinwheels and apply ball pit physics */
  _updateMegaStadium(dt) {
    // 1. Rotate Obstacle Pinwheels and sweep Dweebs
    for (const pw of this.megaPinwheels ?? []) {
      pw.bladeGroup.rotation.y += pw.speed * dt;

      for (const d of this.dweebs ?? []) {
        if (!d.active || d.grabbedBy || (d.hazardCd || 0) > 0) continue;
        const p = d.getPosition();
        if (p.y > 1.2 || p.y < -0.2) continue;
        const dist = Math.hypot(p.x - pw.x, p.z - pw.z);
        if (dist < pw.radius) {
          // Tangential sweep velocity
          const angle = Math.atan2(p.z - pw.z, p.x - pw.x);
          const tangentAngle = angle + (pw.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
          const force = 12.0;

          d.receiveHit({
            dir: {
              x: Math.cos(tangentAngle) * 0.9,
              y: 0.45,
              z: Math.sin(tangentAngle) * 0.9,
            },
            damage: 18,
            base: force,
            growth: 4,
            attacker: null,
            time: this.time,
          });
          d.hazardCd = 0.45;
          this.onContraptionHit?.(pw, d, 'OBSTACLE PINWHEEL');
        }
      }
    }

    // 2. Ball Pit physics: extra bounce & cushioned flotation
    for (const pit of this.ballPitZones ?? []) {
      for (const d of this.dweebs ?? []) {
        if (!d.active || d.grabbedBy) continue;
        const p = d.getPosition();
        if (
          Math.abs(p.x - pit.x) < pit.hw &&
          Math.abs(p.z - pit.z) < pit.hd &&
          p.y < 0.6
        ) {
          // Cushioned bounce pop
          const v = d.body.linvel();
          if (v.y < -1.0) {
            d.body.setLinvel({ x: v.x * 0.85, y: -v.y * 0.9 + 2.5, z: v.z * 0.85 }, true);
          }
        }
      }
    }
  }

  // ─── Stage ───

  _createIsland() {
    // Core disc
    const coreMat = toonMat({ color: 0x6fdc5a });
    this.coreMat = coreMat;
    const sideMat = toonMat({ color: 0xf2c37a });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(CORE_RADIUS, CORE_RADIUS, 2, 64, 1), [sideMat, coreMat, sideMat]);
    core.position.y = -1;
    core.receiveShadow = true;
    core.castShadow = true;
    this.scene.add(core);
    this.physicsWorld.createFixedCylinder(0, -1, 0, CORE_RADIUS, 1);

    // Printed play-mat on the core
    const mat = new THREE.Mesh(new THREE.CircleGeometry(CORE_RADIUS - 0.05, 64), toonMat({ map: S.playmatTexture() }));
    mat.rotation.x = -Math.PI / 2;
    mat.rotation.z = Math.PI / 16;
    mat.position.y = 0.012;
    mat.receiveShadow = true;
    noOutline(mat);
    this.scene.add(mat);
    this.playmat = mat;

    // Rocky underside tapering to the water
    const rockGeo = new THREE.CylinderGeometry(STAGE_RADIUS - 0.4, 5, 6, 14, 3);
    jitter(rockGeo, 0.5);
    const rock = new THREE.Mesh(rockGeo, toonMat({ color: 0xb08a66, flatShading: true }));
    rock.position.y = -5;
    this.scene.add(rock);
    const rock2 = new THREE.Mesh(new THREE.CylinderGeometry(CORE_RADIUS + 0.3, CORE_RADIUS - 1, 1.6, 40), toonMat({ color: 0x9e7a58 }));
    rock2.position.y = -2.7;
    this.scene.add(rock2);

    // Outer ring tiles
    const step = (Math.PI * 2) / SEGMENTS;
    const lipMatA = toonMat({ color: 0xfff8ee });
    const lipMatB = toonMat({ color: 0x1b1030 });
    const chevShape = new THREE.Shape();
    chevShape.moveTo(0.7, 0); chevShape.lineTo(-0.3, -0.75); chevShape.lineTo(-0.3, -0.35);
    chevShape.lineTo(0.15, 0); chevShape.lineTo(-0.3, 0.35); chevShape.lineTo(-0.3, 0.75); chevShape.closePath();
    const chevGeo = new THREE.ShapeGeometry(chevShape);
    const chevMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = i * step + 0.012;
      const a1 = (i + 1) * step - 0.012;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, STAGE_RADIUS, a0, a1, false);
      shape.absarc(0, 0, CORE_RADIUS + 0.02, a1, a0, true);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false, curveSegments: 6 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -1.6, 0);

      // Centre the geometry on its centroid so it can tumble nicely
      const mid = (a0 + a1) / 2;
      const cr = (CORE_RADIUS + STAGE_RADIUS) / 2;
      const cx = Math.cos(mid) * cr, cz = -Math.sin(mid) * cr;
      geo.translate(-cx, 0, -cz);

      const topMat = toonMat({ color: TILE_COLORS[i % TILE_COLORS.length] });
      const sideMat2 = toonMat({ color: 0xfff3d6 });
      const mesh = new THREE.Mesh(geo, [topMat, sideMat2]);
      mesh.position.set(cx, 0, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      // Lip + hazard chevron along the drop edge (children, so they fall with the tile)
      const lip = new THREE.Shape();
      lip.absarc(0, 0, STAGE_RADIUS, a0, a1, false);
      lip.absarc(0, 0, STAGE_RADIUS - 0.45, a1, a0, true);
      const lipGeo = new THREE.ExtrudeGeometry(lip, { depth: 0.1, bevelEnabled: false, curveSegments: 6 });
      lipGeo.rotateX(-Math.PI / 2);
      lipGeo.translate(-cx, 0, -cz);
      const lipMesh = new THREE.Mesh(lipGeo, i % 2 ? lipMatA : lipMatB);
      lipMesh.receiveShadow = true;
      mesh.add(lipMesh);
      const chev = new THREE.Mesh(chevGeo, chevMat);
      const cr2 = STAGE_RADIUS - 1.6;
      chev.position.set(Math.cos(mid) * cr2 - cx, 0.015, -Math.sin(mid) * cr2 - cz);
      chev.rotation.set(-Math.PI / 2, 0, mid);
      noOutline(chev);
      mesh.add(chev);

      const hull = this.physicsWorld.createFixedHull(cx, 0, cz, new Float32Array(geo.attributes.position.array));
      this.segments.push({
        index: i, mesh, topMat, baseColor: topMat.color.getHex(), body: hull.body, collider: hull.collider,
        home: new THREE.Vector3(cx, 0, cz), a0: i * step, a1: (i + 1) * step,
        state: 'solid', timer: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(),
      });
    }
  }

  _createPlatforms() {
    const defs = [
      { x: 0, y: 3.4, z: 7.5, color: PALETTE.purple },
      { x: 0, y: 3.4, z: -7.5, color: PALETTE.orange },
    ];
    for (const d of defs) {
      const hw = 2.2, hh = 0.3, hd = 1.4;
      const g = new THREE.Group();
      const slab = new THREE.Mesh(roundedBox(hw * 2, hh * 2, hd * 2, 0.18), toonMat({ color: d.color }));
      slab.castShadow = true;
      slab.receiveShadow = true;
      g.add(slab);
      // Little propeller-balloon underneath to explain the float
      const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), toonMat({ color: 0xffffff }));
      balloon.position.y = -0.9;
      balloon.scale.y = 0.8;
      g.add(balloon);
      g.position.set(d.x, d.y, d.z);
      this.scene.add(g);
      const box = this.physicsWorld.createStaticBox(d.x, d.y, d.z, hw, hh, hd, 'plastic');
      this.platforms.push({
        x: d.x, z: d.z, hw, hd, top: d.y + hh, group: g, baseY: d.y,
        collider: box.collider, body: box.body,
        solids: box.collider.collisionGroups(),
        dropUntil: 0,
      });
    }
  }

  _createSpinner() {
    const g = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.7, 24), toonMat({ color: PALETTE.blue }));
    hub.position.y = 0.35;
    hub.castShadow = true;
    g.add(hub);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), toonMat({ color: PALETTE.yellow }));
    cap.position.y = 0.7;
    g.add(cap);
    const length = 8.6;
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, length, 6, 12), toonMat({ color: PALETTE.red }));
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 0.45;
    bar.castShadow = true;
    g.add(bar);
    // Candy stripes
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12), toonMat({ color: 0xffffff }));
      s.rotation.z = Math.PI / 2;
      s.position.set(i * 0.95, 0.45, 0);
      g.add(s);
    }
    this.scene.add(g);

    const body = this.physicsWorld.createKinematicShape(0, 0.45, 0, 'box', { hx: length / 2 + 0.2, hy: 0.24, hz: 0.24 }, 0.6).body;
    this.spinners.push({ group: g, body, angle: 0, speed: 0.9, half: length / 2 + 0.25, y: 0.45 });
  }

  _createPendulums() {
    const frameMat = toonMat({ color: PALETTE.yellow });
    const anchorY = 14;
    // Gantry rising out of the water on either side of the island
    for (const x of [-18, 18]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, anchorY + 6, 12), frameMat);
      post.position.set(x, anchorY / 2 - 3, 0);
      post.castShadow = true;
      this.scene.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 1, 12), toonMat({ color: PALETTE.red }));
      foot.position.set(x, WATER_LEVEL + 0.2, 0);
      this.scene.add(foot);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(37, 0.9, 0.9), toonMat({ color: PALETTE.red }));
    beam.position.set(0, anchorY + 0.2, 0);
    beam.castShadow = true;
    this.scene.add(beam);

    [[-5.5, 0, 1.0], [5.5, Math.PI, 1.0]].forEach(([x, phase, speed]) => {
      const cord = anchorY - 1.1;
      const anchor = new THREE.Vector3(x, anchorY, 0);
      const group = new THREE.Group();
      group.position.copy(anchor);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, cord, 6), toonMat({ color: 0xf5f0e6 }));
      rope.position.y = -cord / 2;
      group.add(rope);
      const cube = new THREE.Mesh(roundedBox(1.7, 1.7, 1.7, 0.2), toonMat({ color: 0xd99a55 }));
      cube.position.y = -cord;
      cube.castShadow = true;
      group.add(cube);
      // Grumpy face on the cube
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: faceTexture(), transparent: true }));
      face.position.set(0, -cord, 0.86);
      noOutline(face);
      group.add(face);
      const face2 = face.clone();
      face2.position.z = -0.86;
      face2.rotation.y = Math.PI;
      group.add(face2);
      this.scene.add(group);
      const body = this.physicsWorld.createKinematicShape(anchor.x, anchor.y - cord, anchor.z, 'box', { hx: 0.85, hy: 0.85, hz: 0.85 }, 0.8).body;
      this.pendulums.push({ group, anchor, cordLength: cord, body, phase, speed, amp: 0.9, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    });
  }

  _createBumpers() {
    const baseMat = toonMat({ color: 0x1b1030 });
    const white = toonMat({ color: 0xfff8ee });
    const starMap = S.textSticker('★', { bg: '#ffd23f', w: 128, h: 128, shape: 'circle' });
    for (const b of BUMPERS) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_RADIUS + 0.12, BUMPER_RADIUS + 0.2, 0.2, 20), baseMat);
      base.position.y = 0.1;
      g.add(base);
      const body = new THREE.Group(); // squashes on hit
      const col = toonMat({ color: b.color, emissive: b.color, emissiveIntensity: 0 });
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_RADIUS, BUMPER_RADIUS, 0.75, 20), col);
      drum.position.y = 0.375;
      drum.castShadow = true;
      body.add(drum);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_RADIUS + 0.03, BUMPER_RADIUS + 0.03, 0.16, 20), white);
      band.position.y = 0.4;
      body.add(band);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(BUMPER_RADIUS * 0.8, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
      cap.scale.y = 0.45;
      cap.position.y = 0.75;
      body.add(cap);
      const star = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ map: starMap, transparent: true, alphaTest: 0.5 }));
      star.rotation.x = -Math.PI / 2;
      star.position.y = 1.0;
      noOutline(star);
      body.add(star);
      body.position.y = 0.2;
      g.add(body);
      g.position.set(b.x, 0, b.z);
      this.scene.add(g);
      const { collider } = this.physicsWorld.createFixedCylinder(b.x, 0.55, b.z, BUMPER_RADIUS, 0.55, 'rubber');
      this.bumpers.push({ ...b, group: g, body, mat: col, flash: 0, handle: collider.handle });
    }
  }

  _createTrampolines() {
    const legMat = toonMat({ color: 0xc9d3e6 });
    const matMat = toonMat({ color: 0x1b1030 });
    const starMap = S.textSticker('JUMP!', { bg: '#ffd23f', w: 256, h: 256, shape: 'burst' });
    for (const t of TRAMPOLINES) {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.TorusGeometry(TRAMPOLINE_RADIUS, 0.13, 8, 28), toonMat({ color: t.color }));
      frame.rotation.x = Math.PI / 2;
      frame.position.y = TRAMPOLINE_TOP;
      frame.castShadow = true;
      g.add(frame);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, TRAMPOLINE_TOP, 6), legMat);
        leg.position.set(Math.cos(a) * TRAMPOLINE_RADIUS, TRAMPOLINE_TOP / 2, Math.sin(a) * TRAMPOLINE_RADIUS);
        g.add(leg);
      }
      const bed = new THREE.Group(); // dips when something bounces
      const sheet = new THREE.Mesh(new THREE.CylinderGeometry(TRAMPOLINE_RADIUS - 0.06, TRAMPOLINE_RADIUS - 0.06, 0.05, 28), matMat);
      bed.add(sheet);
      const sticker = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), new THREE.MeshBasicMaterial({ map: starMap, transparent: true, alphaTest: 0.5 }));
      sticker.rotation.x = -Math.PI / 2;
      sticker.position.y = 0.03;
      noOutline(sticker);
      bed.add(sticker);
      bed.position.y = TRAMPOLINE_TOP - 0.02;
      g.add(bed);
      g.position.set(t.x, 0, t.z);
      this.scene.add(g);
      const { collider } = this.physicsWorld.createFixedCylinder(t.x, TRAMPOLINE_TOP / 2, t.z, TRAMPOLINE_RADIUS + 0.1, TRAMPOLINE_TOP / 2, 'rubber');
      this.trampolines.push({ ...t, group: g, bed, dip: 0, dipV: 0, handle: collider.handle });
    }
  }

  /** Props ricochet off bumpers and spring off trampolines too (great for trick shots). */
  _bumpObject(obj, p, dt) {
    obj.bumpCd = Math.max(0, (obj.bumpCd || 0) - dt);
    if (obj.bumpCd > 0) return;
    const r = obj.def.dims.radius ?? Math.max(obj.def.dims.hx ?? 0.3, obj.def.dims.hz ?? 0.3);
    for (const b of this.bumpers) {
      const dx = p.x - b.x, dz = p.z - b.z, dist = Math.hypot(dx, dz);
      if (dist > BUMPER_RADIUS + r + 0.15 || p.y > 1.4) continue;
      obj.body.setLinvel(bumperBounce(obj.body.linvel(), dx, dz), true);
      obj.bumpCd = 0.25;
      if (obj.thrownBy) {
        obj.thrownTime = Math.max(obj.thrownTime, 0.8); // a banked shot still counts as a hit
        obj.banked = true;
      }
      this.hitBumper(b);
      this.onBump?.(b, obj);
      return;
    }
    for (const t of this.trampolines) {
      if (Math.hypot(p.x - t.x, p.z - t.z) > TRAMPOLINE_RADIUS || p.y > TRAMPOLINE_TOP + r + 0.4) continue;
      const v = obj.body.linvel();
      if (v.y > 1) continue;
      obj.body.setLinvel({ x: v.x * BOUNCE.trampolineKeepH, y: TRAMPOLINE_ITEM_VEL, z: v.z * BOUNCE.trampolineKeepH }, true);
      obj.bumpCd = 0.25;
      if (obj.thrownBy) {
        obj.thrownTime = Math.max(obj.thrownTime, 1.2);
        obj.banked = true;
      }
      this.bounceTrampoline(t);
      this.onBounce?.(t, obj);
      return;
    }
  }

  bumperByHandle(h) {
    return this.bumpers.find(b => b.handle === h) ?? null;
  }

  trampolineByHandle(h) {
    return this.trampolines.find(t => t.handle === h) ?? null;
  }

  /** Something landed on a trampoline: animate the bed. */
  bounceTrampoline(t) {
    t.dipV = -4;
  }

  /** Something hit a bumper: flash + squash. */
  hitBumper(b) {
    b.flash = 1;
  }

  _createLagoonToys() {
    // Giant bath toys bobbing in the lagoon (visual only; shared model templates scaled up)
    const toys = [
      ['giantRubberDuck', 4.5, 24, 0.4], ['beachBall', 3.2, 29, 1.6], ['poolRing', 4, 22, 2.5],
      ['giantRubberDuck', 3, 33, 3.4], ['beachBall', 2.6, 21, 4.3], ['poolRing', 3.4, 30, 5.1],
      ['giantRubberDuck', 5.5, 27, 5.9], ['beachBall', 3.6, 35, 0.9],
    ];
    for (const [key, scale, r, a] of toys) {
      const m = createModel(key, OBJECT_DEFS[key]);
      m.scale.setScalar(scale);
      m.position.set(Math.cos(a) * r, WATER_LEVEL + 0.2 * scale, Math.sin(a) * r);
      m.rotation.y = a * 2.3;
      this.scene.add(m);
      this.floaters.push({ mesh: m, baseY: m.position.y, phase: a * 3, spin: key === 'beachBall' ? 0.3 : 0.05 });
    }
    // D-W-E-E-B-S letter blocks floating in front of the arch
    const cols = ['#ff4d5e', '#3fa9ff', '#ffd23f', '#5ee06a', '#b56cff', '#ff9a3c'];
    const blockGeo = new THREE.BoxGeometry(2.6, 2.6, 2.6);
    'DWEEBS'.split('').forEach((ch, i) => {
      const a = -Math.PI / 2 + (i - 2.5) * 0.12;
      const r = 36;
      const m = new THREE.Mesh(blockGeo, toonMat({ map: S.letterBlock(ch, cols[i]) }));
      m.position.set(Math.cos(a) * r, WATER_LEVEL + 1.1, Math.sin(a) * r);
      m.rotation.set(0, -a - Math.PI / 2, (i % 2 ? 1 : -1) * 0.08);
      m.castShadow = true;
      this.scene.add(m);
      this.floaters.push({ mesh: m, baseY: m.position.y, phase: i * 0.9, spin: 0, rock: true });
    });
  }

  // ─── Scenery ───

  _createStadium() {
    // Sand beach ring around the lagoon
    const beach = new THREE.Mesh(new THREE.RingGeometry(40, 47, 64), toonMat({ color: 0xffe2a8 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = WATER_LEVEL + 0.25;
    noOutline(beach);
    this.scene.add(beach);

    // Stepped grandstand tiers (gap at the -Z arch)
    const gap = 0.32;
    const tierColors = [PALETTE.blue, PALETTE.red, PALETTE.yellow, PALETTE.blue, PALETTE.red, PALETTE.green];
    const tiers = tierColors.length;
    const seats = [];
    for (let t = 0; t < tiers; t++) {
      const r0 = 46 + t * 2.6;
      const top = -3.5 + t * 1.8;
      const pts = [
        new THREE.Vector2(r0, WATER_LEVEL),
        new THREE.Vector2(r0, top),
        new THREE.Vector2(r0 + 2.6, top),
      ];
      const geo = new THREE.LatheGeometry(pts, 72, Math.PI + gap, Math.PI * 2 - gap * 2);
      const tier = new THREE.Mesh(geo, toonMat({ color: tierColors[t], side: THREE.DoubleSide }));
      tier.receiveShadow = true;
      this.scene.add(tier);
      const n = 70 + t * 6;
      for (let s = 0; s < n; s++) {
        const phi = Math.PI + gap + 0.03 + (s / n) * (Math.PI * 2 - gap * 2 - 0.06);
        const r = r0 + 1.1 + Math.random() * 0.5;
        seats.push({ x: Math.sin(phi) * r, y: top, z: Math.cos(phi) * r });
      }
    }
    // Outer wall
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(46 + tiers * 2.6 + 0.4, 46 + tiers * 2.6 + 0.4, 4, 72, 1, true, Math.PI + gap, Math.PI * 2 - gap * 2),
      toonMat({ color: 0xe8e2f0, side: THREE.DoubleSide })
    );
    wall.position.y = -3.5 + tiers * 1.8 + 0.5;
    this.scene.add(wall);

    // Crowd: one instanced mesh of little blocky dweebs
    const crowdGeo = roundedBox(0.9, 1.1, 0.8, 0.2);
    crowdGeo.translate(0, 0.55, 0);
    const crowdMat = toonMat({ color: 0xffffff });
    this.crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, seats.length);
    const colors = [PALETTE.red, PALETTE.yellow, PALETTE.blue, PALETTE.green, PALETTE.purple, PALETTE.pink, PALETTE.orange, PALETTE.white];
    const c = new THREE.Color();
    this.crowdSeats = seats.map((s, i) => {
      this.crowd.setColorAt(i, c.set(colors[Math.floor(Math.random() * colors.length)]));
      return { ...s, phase: Math.random() * Math.PI * 2, freq: 3 + Math.random() * 3, yaw: Math.atan2(-s.x, -s.z) };
    });
    noOutline(this.crowd);
    this.scene.add(this.crowd);
    this._updateCrowd(0);

    this._createArch();
  }

  _createArch() {
    const g = new THREE.Group();
    const pillarMat = toonMat({ color: PALETTE.red });
    const z = -50;
    for (const x of [-9, 9]) {
      const p = new THREE.Mesh(roundedBox(3, 18, 3, 0.3), pillarMat);
      p.position.set(x, 4, z);
      g.add(p);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), toonMat({ color: PALETTE.yellow }));
      cap.position.set(x, 13.6, z);
      g.add(cap);
    }
    const bar = new THREE.Mesh(roundedBox(22, 4.4, 2.6, 0.4), toonMat({ color: PALETTE.blue }));
    bar.position.set(0, 10.5, z);
    g.add(bar);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(20, 4), new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true }));
    sign.position.set(0, 10.5, z + 1.32);
    noOutline(sign);
    g.add(sign);
    // Tunnel mouth
    const tunnel = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshBasicMaterial({ color: 0x241a3a }));
    tunnel.position.set(0, -2, z - 1);
    noOutline(tunnel);
    g.add(tunnel);
    this.scene.add(g);

    // Bunting flags strung around the stadium rim
    const flagGeo = new THREE.ConeGeometry(0.5, 1.1, 3);
    flagGeo.rotateX(Math.PI);
    const flagCount = 90;
    const flags = new THREE.InstancedMesh(flagGeo, toonMat({ color: 0xffffff }), flagCount);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const R = 46 + 6 * 2.6 + 0.2;
    for (let i = 0; i < flagCount; i++) {
      const phi = (i / flagCount) * Math.PI * 2;
      m.makeRotationY(phi);
      m.setPosition(Math.sin(phi) * R, 8.4 + Math.sin(i * 1.3) * 0.15, Math.cos(phi) * R);
      flags.setMatrixAt(i, m);
      flags.setColorAt(i, col.set(TILE_COLORS[i % 4]));
    }
    noOutline(flags);
    this.scene.add(flags);
  }

  _createScenery() {
    const mountainMat = toonMat({ color: 0x9c8cc8, flatShading: true });
    const snowMat = toonMat({ color: 0xffffff, flatShading: true });
    const hillMat = toonMat({ color: 0x7fd66a });
    const pineMat = toonMat({ color: 0x2f9e5a, flatShading: true });
    const trunkMat = toonMat({ color: 0x8a5a3c });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + (i % 2) * 0.1;
      const d = 110 + (i % 3) * 14;
      const h = 30 + (i % 4) * 9;
      const w = 22 + (i % 3) * 6;
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), mountainMat);
      mtn.position.set(Math.cos(a) * d, WATER_LEVEL + h / 2 - 2, Math.sin(a) * d);
      mtn.rotation.y = i;
      noOutline(mtn);
      this.scene.add(mtn);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.34, h * 0.34, 6), snowMat);
      cap.position.set(mtn.position.x, WATER_LEVEL + h - h * 0.17 - 2.05, mtn.position.z);
      cap.rotation.y = i;
      noOutline(cap);
      this.scene.add(cap);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.25;
      const d = 78 + (i % 2) * 8;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(14 + (i % 3) * 3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
      hill.scale.y = 0.45;
      hill.position.set(Math.cos(a) * d, WATER_LEVEL, Math.sin(a) * d);
      noOutline(hill);
      this.scene.add(hill);
      for (let t = 0; t < 4; t++) {
        const ta = a + (t - 1.5) * 0.08;
        const td = d + (t % 2 ? -4 : 5);
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 2, 6), trunkMat);
        trunk.position.y = 1;
        const pine = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 7), pineMat);
        pine.position.y = 4.2;
        tree.add(trunk, pine);
        tree.position.set(Math.cos(ta) * td, WATER_LEVEL + 4.5, Math.sin(ta) * td);
        this.scene.add(tree);
      }
    }
  }

  // ─── Items ───

  _spawnStartItems() {
    const total = this.spawnCount || 4;
    for (const [key, x0, y, z0] of START_ITEMS) {
      let x = x0, z = z0;
      // Never start a rocket / barrel at someone's feet: swing it round the ring until it's clear of every spawn
      if (OBJECT_DEFS[key]?.explosive) {
        for (let k = 0; k < 16 && this._nearSpawn(x, z, total, 4); k++) {
          const c = Math.cos(Math.PI / 8), sn = Math.sin(Math.PI / 8);
          [x, z] = [x * c - z * sn, x * sn + z * c];
        }
      }
      this.spawnItem(key, { x, y, z });
    }
  }

  _nearSpawn(x, z, total, r) {
    for (let i = 0; i < total; i++) {
      const p = this.getSpawnPoint(i, total);
      if (Math.hypot(p.x - x, p.z - z) < r) return true;
    }
    return false;
  }

  /** Weighted pick from DROP_ITEMS, skipping rare items that are capped or on cooldown. */
  pickDropItem(time, bias = null) {
    const live = new Map();
    for (const o of this.objects) if (!o.isDebris && !o.broken) live.set(o.key, (live.get(o.key) || 0) + 1);
    let total = 0;
    const pool = [];
    for (const it of DROP_ITEMS) {
      if (!OBJECT_DEFS[it.key]) continue;
      const rare = RARE[it.key];
      if (rare && ((live.get(it.key) || 0) >= rare.max || time - (this.lastRareDrop[it.key] ?? -1e9) < rare.cd)) continue;
      const w = it.w * (bias?.[it.key] ?? 1);
      if (w <= 0) continue;
      total += w;
      pool.push([it.key, total]);
    }
    const r = Math.random() * total;
    const key = (pool.find(([, c]) => r < c) ?? pool[0])[0];
    if (RARE[key]) this.lastRareDrop[key] = time;
    return key;
  }

  spawnItem(key, pos) {
    const obj = new InteractiveObject(key, this.physicsWorld, this.scene, pos);
    this.objects.push(obj);
    return obj;
  }

  /** Drop a random item from the sky somewhere over solid ground. */
  dropRandomItem(time = 0, bias = null) {
    const live = this.objects.filter(o => !o.isDebris && !o.broken && !o.def?.isPickup).length;
    if (live >= 10) return null;
    const key = this.pickDropItem(time, bias);
    const p = this.randomGroundPoint(8.5);
    return this.spawnItem(key, { x: p.x, y: 14, z: p.z });
  }

  spawnPowerUp(kind = null) {
    if (this.powerups.length >= 2) return null;
    if (!kind) {
      // Weighted: common powerups appear often, swap is rare (weight 0.5 vs 2-3 for others)
      const pool = [
        { key: 'mega', w: 2 }, { key: 'zoom', w: 2 }, { key: 'bubble', w: 2 },
        { key: 'freeze', w: 1.5 }, { key: 'magnet', w: 1.5 }, { key: 'sugar', w: 2 },
        { key: 'shield', w: 1.5 }, { key: 'swap', w: 0.5 }, // rare
      ];
      let total = 0;
      for (const it of pool) total += it.w;
      const r = Math.random() * total;
      let acc = 0;
      for (const it of pool) {
        acc += it.w;
        if (r < acc) { kind = it.key; break; }
      }
    }
    const def = POWERUPS[kind];
    const g = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), toonMat({ color: def.color, emissive: def.color, emissiveIntensity: 0.25 }));
    g.add(gem);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    halo.rotation.x = Math.PI / 2;
    noOutline(halo);
    g.add(halo);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(def.icon, def.color), depthTest: false }));
    icon.scale.set(0.8, 0.8, 0.8);
    icon.position.y = 1.0;
    icon.renderOrder = 5;
    g.add(icon);
    const p = this.randomGroundPoint(8);
    g.position.set(p.x, 12, p.z);
    this.scene.add(g);
    const pu = { kind, def, group: g, gem, halo, landed: false, life: 16, x: p.x, z: p.z };
    this.powerups.push(pu);
    return pu;
  }

  removePowerUp(pu) {
    this.scene.remove(pu.group);
    pu.group.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    this.powerups = this.powerups.filter(p => p !== pu);
  }

  randomGroundPoint(maxR) {
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * maxR;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.isOverGround(x, z, 0.5)) return { x, z };
    }
    return { x: 0, z: 2 };
  }

  removeObject(obj) {
    this.objects = this.objects.filter(o => o !== obj);
    if (obj.isDebris) {
      this.scene.remove(obj.mesh); // geometry/material are shared debris resources
      this.physicsWorld.removeBody(obj.physicsId);
      this.physicsWorld.removeDebris();
    } else {
      obj.destroy();
    }
  }

  /** Material-shaped debris: wood splinters, glass/ceramic shards, fruit chunks, cardboard flaps. */
  spawnDebris(position, color = 0xc4a06a, count = 5, material = 'wood', palette = null, burst = null) {
    // burst (optional): { vel, dir, power, size } — chunks inherit the prop's motion, blow out along
    // the hit direction and scale with the prop, so a smashed crate reads as the crate coming apart.
    const bv = burst?.vel, bd = burst?.dir, pw = burst?.power ?? 0, sz = burst?.size ?? 1;
    for (let i = 0; i < count; i++) {
      if (!this.physicsWorld.addDebris()) break;
      const shape = debrisShape(material, i);
      const col = palette ? palette[i % palette.length] : material === 'fruit' ? (i % 3 === 2 ? 0x2f8f3a : 0xff4d6a) : color;
      const s = (0.7 + Math.random() * 0.6) * sz;
      const mesh = new THREE.Mesh(shape.geo, debrisMat(col, material === 'glass'));
      const dx = position.x + (Math.random() - 0.5) * 0.5;
      const dy = position.y + Math.random() * 0.3;
      const dz = position.z + (Math.random() - 0.5) * 0.5;
      mesh.position.set(dx, dy, dz);
      mesh.scale.setScalar(s);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const [hx, hy, hz] = shape.half;
      const result = this.physicsWorld.createDynamicBody(dx, dy, dz, 'box',
        { hx: hx * s, hy: hy * s, hz: hz * s }, { material: material === 'fruit' ? 'fruit' : 'wood', mass: 0.2, isDebris: true });
      if (burst) {
        // Radial spray from the centre, biased along the blow, plus whatever velocity the prop had.
        const rx = dx - position.x, rz = dz - position.z, rl = Math.hypot(rx, rz) || 1;
        const spread = 2.5 + pw * 0.25 + Math.random() * 2;
        const along = pw * (0.35 + Math.random() * 0.35);
        result.body.setLinvel({
          x: (bv?.x ?? 0) * 0.55 + (rx / rl) * spread + (bd?.x ?? 0) * along,
          y: Math.abs(bv?.y ?? 0) * 0.3 + 2.5 + Math.random() * (3 + pw * 0.15),
          z: (bv?.z ?? 0) * 0.55 + (rz / rl) * spread + (bd?.z ?? 0) * along,
        }, true);
        const sp = 8 + pw * 0.6;
        result.body.setAngvel({ x: (Math.random() - 0.5) * sp, y: (Math.random() - 0.5) * sp, z: (Math.random() - 0.5) * sp }, true);
      } else {
        this.physicsWorld.applyImpulse(result.body, { x: (Math.random() - 0.5) * 0.35, y: Math.random() * 0.3 + 0.12, z: (Math.random() - 0.5) * 0.35 });
        this.physicsWorld.applyTorqueImpulse(result.body, { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 });
      }
      this.objects.push({
        mesh, body: result.body, physicsId: result.id, isDebris: true, life: 3 + Math.random() * 2,
        getPosition() { return this.body.translation(); },
        update() {
          const p = this.body.translation(), r = this.body.rotation();
          mesh.position.set(p.x, p.y, p.z);
          mesh.quaternion.set(r.x, r.y, r.z, r.w);
          if (this.life < 0.5) mesh.scale.setScalar(s * Math.max(0.01, this.life / 0.5)); // shrink away
        },
      });
    }
  }

  // ─── Queries ───

  /** Is there solid stage beneath (x, z)? margin shrinks the usable area. */
  isOverGround(x, z, margin = 0) {
    const r = Math.hypot(x, z);
    if (r < CORE_RADIUS - margin) return true;
    if (r > STAGE_RADIUS - margin) return this._overPlatform(x, z, margin);
    const seg = this.segmentAt(x, z);
    return (seg && seg.state === 'solid') || this._overPlatform(x, z, margin);
  }

  _overPlatform(x, z, margin) {
    return this.platforms.some(p => Math.abs(x - p.x) < p.hw - margin && Math.abs(z - p.z) < p.hd - margin);
  }

  segmentAt(x, z) {
    let a = Math.atan2(-z, x);
    if (a < 0) a += Math.PI * 2;
    return this.segments[Math.floor(a / ((Math.PI * 2) / SEGMENTS)) % SEGMENTS];
  }

  /** Current radius of solid ground in the direction of (x, z). */
  edgeRadius(x, z) {
    const seg = this.segmentAt(x, z);
    return seg && seg.state === 'solid' ? STAGE_RADIUS : CORE_RADIUS;
  }

  getObjectsNear(pos, radius) {
    const results = [];
    for (const obj of this.objects) {
      if (obj.broken || obj.isDebris || obj.isGrabbed || !obj.body) continue;
      const op = obj.getPosition();
      const dist = Math.hypot(op.x - pos.x, op.y - pos.y, op.z - pos.z);
      if (dist <= radius) results.push({ obj, dist });
    }
    results.sort((a, b) => a.dist - b.dist);
    return results;
  }

  getSpawnPoint(index, total = 4, mode = 'derby') {
    if (mode === 'walldrop') {
      // Split players onto Team West (negative x) and Team East (positive x)
      const team = index % 2 === 0 ? -1 : 1;
      const slot = Math.floor(index / 2);
      const zOffset = (slot - 0.5) * 4.5;
      return { x: team * 7.5, y: 1.2, z: zOffset };
    }
    const a = (index / total) * Math.PI * 2 + Math.PI / 2;
    return { x: Math.cos(a) * 7, y: 1.2, z: Math.sin(a) * 7 };
  }

  getRespawnPoint() {
    const p = this.randomGroundPoint(5);
    return { x: p.x, y: 9, z: p.z };
  }

  // ─── Sudden death ───

  startSuddenDeath(duration = 40) {
    if (this.suddenDeath) return;
    this.suddenDeath = true;
    // Crumble in a spiralling-but-shuffled order so no side is safe for long
    const order = [...this.segments].sort(() => Math.random() - 0.5);
    this.crumbleQueue = order;
    this.crumbleInterval = duration / SEGMENTS;
    this.crumbleTimer = 1;
  }

  /** Next tile to crumble: empty tiles go first so nobody is dropped without a chance (Spec 7 fairness). */
  _nextCrumble() {
    const q = this.crumbleQueue;
    const i = this.isOccupied ? q.findIndex(seg => !this.isOccupied(seg)) : 0;
    return q.splice(Math.max(0, i), 1)[0];
  }

  _warnSegment(seg) {
    seg.state = 'warning';
    // Faster warnings early in sudden death, but never under 0.8 s when someone is standing on it
    seg.timer = Math.max(this.isOccupied?.(seg) ? 0.8 : 0.5, 2.2 * this.sdWarnScale);
    this.onSegmentWarn?.(seg);
  }

  _dropSegment(seg) {
    seg.state = 'falling';
    seg.collider.setEnabled(false);
    const out = seg.home.clone().setY(0).normalize();
    seg.vel.set(out.x * 1.5, 0, out.z * 1.5);
    seg.spin.set((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2).add(new THREE.Vector3(out.z, 0, -out.x).multiplyScalar(-1.2));
    this.onSegmentFall?.(seg);
  }

  // ─── Update ───


  _createDeathContraptions() {
    this.contraptions = [];

    // 1. Hydraulic Stomper / Tenderizer in the middle
    const stomperGroup = new THREE.Group();
    const hammerHead = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.8, 3.2),
      toonMat({ color: 0x3a3d54 })
    );
    hammerHead.castShadow = true;
    stomperGroup.add(hammerHead);
    stomperGroup.position.set(0, 7.5, 0);
    this.scene.add(stomperGroup);

    const stomperBody = this.physicsWorld.createKinematicShape(0, 7.5, 0, 'box', { hx: 1.6, hy: 0.9, hz: 1.6 }, 0.9).body;
    this.contraptions.push({
      type: 'stomper',
      group: stomperGroup,
      body: stomperBody,
      baseY: 7.5,
      crushY: 1.0,
      state: 'wait',
      timer: 2.0,
    });

    // 2. Supersonic Launchpad Catapult (launches dweebs into the stratosphere)
    const padGroup = new THREE.Group();
    const padMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.6, 0.35, 16),
      toonMat({ color: 0xffd23f })
    );
    padMesh.position.set(0, 0.18, -6.5);
    padGroup.add(padMesh);
    this.scene.add(padGroup);
    this.contraptions.push({
      type: 'catapult',
      group: padGroup,
      x: 0, z: -6.5,
      timer: 0,
    });

    // 3. Horizontal Spiked Log Roller
    const logGroup = new THREE.Group();
    const logMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 7.5, 12),
      toonMat({ color: 0xa84828 })
    );
    logMesh.rotation.z = Math.PI / 2;
    logMesh.castShadow = true;
    logGroup.add(logMesh);
    logGroup.position.set(0, 1.1, 0);
    this.scene.add(logGroup);
    const logBody = this.physicsWorld.createKinematicShape(0, 1.1, 0, 'cylinder', { halfHeight: 3.75, radius: 0.55 }, 0.8).body;
    this.contraptions.push({
      type: 'spikedLog',
      group: logGroup,
      body: logBody,
      angle: 0,
      spinSpeed: 10.0,
      sweepPhase: 0,
    });

    // 4. Dual Industrial Shredder Gears
    for (const side of [-1, 1]) {
      const gearGroup = new THREE.Group();
      const gearMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.6, 3.8, 16),
        toonMat({ color: 0xff4d5e })
      );
      gearMesh.rotation.z = Math.PI / 2;
      gearMesh.castShadow = true;
      gearGroup.add(gearMesh);
      gearGroup.position.set(side * 2.2, 0.4, 6.5);
      this.scene.add(gearGroup);

      const gearBody = this.physicsWorld.createKinematicShape(side * 2.2, 0.4, 6.5, 'cylinder', { halfHeight: 1.9, radius: 1.6 }, 0.8).body;
      this.contraptions.push({
        type: 'shredder',
        group: gearGroup,
        body: gearBody,
        side,
        angle: 0,
        speed: 8.0 * -side,
      });
    }

    // 5. Giant Swinging Spiked Wrecking Pendulum Log
    const wreckGroup = new THREE.Group();
    const wreckMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 3.5, 16),
      toonMat({ color: 0x4a2810 })
    );
    wreckMesh.castShadow = true;
    wreckGroup.add(wreckMesh);
    wreckGroup.position.set(6.5, 3.0, 0);
    this.scene.add(wreckGroup);
    const wreckBody = this.physicsWorld.createKinematicShape(6.5, 3.0, 0, 'cylinder', { halfHeight: 1.75, radius: 0.85 }, 0.9).body;
    this.contraptions.push({
      type: 'wreckingLog',
      group: wreckGroup,
      body: wreckBody,
      phase: 0,
      speed: 3.2,
      baseX: 6.5,
    });

    // 6. Rotating Laser Hazard Bar (Sweep of Doom)
    const laserGroup = new THREE.Group();
    const laserMesh = new THREE.Mesh(
      new THREE.BoxGeometry(10.0, 0.25, 0.25),
      new THREE.MeshBasicMaterial({ color: 0xff1053 })
    );
    laserGroup.add(laserMesh);
    laserGroup.position.set(-6.5, 0.75, 0);
    this.scene.add(laserGroup);
    this.contraptions.push({
      type: 'laserBar',
      group: laserGroup,
      angle: 0,
      spinSpeed: 4.5,
      x: -6.5, y: 0.75, z: 0,
      length: 10.0,
    });
  }


  _createWallDropGate() {
    // Massive monolithic dividing wall splitting the arena down the center (x = 0)
    const wallGroup = new THREE.Group();
    const wallMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 14.0, 32.0),
      toonMat({ color: 0x272b47 })
    );
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    wallGroup.add(wallMesh);
    wallGroup.position.set(0, 7.0, 0); // starts fully dividing the arena
    this.scene.add(wallGroup);

    const wallBody = this.physicsWorld.createKinematicShape(0, 7.0, 0, 'box', { hx: 0.4, hy: 7.0, hz: 16.0 }, 0.9).body;
    this.dropWall = {
      group: wallGroup,
      body: wallBody,
      dropped: false,
      dropSpeed: 18.0, // slams into the floor!
      curY: 7.0,
      targetY: -10.0,  // subterranean dropped position
    };
  }

  dropTheWall() {
    if (!this.dropWall) return;
    this.dropWall.dropped = true;
  }

  _createEscapeIslandPuzzles() {
    this.escapePuzzles = {
      batteriesInstalled: 0,
      batteriesNeeded: 2,
      doorOpen: false,
      sockets: [],
    };

    // 1. Exit Warp Gateway / Blast Portal
    const portalGroup = new THREE.Group();
    const ringMat = toonMat({ color: 0xffd23f });
    const portalRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.35, 12, 24), ringMat);
    portalRing.rotation.y = Math.PI / 2;
    portalRing.position.set(-14.5, 3.0, 0);
    portalGroup.add(portalRing);

    // Glowing energy field
    const fieldMat = new THREE.MeshBasicMaterial({ color: 0x3fa9ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const field = new THREE.Mesh(new THREE.CircleGeometry(2.3, 24), fieldMat);
    field.rotation.y = Math.PI / 2;
    field.position.set(-14.5, 3.0, 0);
    portalGroup.add(field);
    this.scene.add(portalGroup);
    this.escapePortal = { group: portalGroup, field, ring: portalRing };

    // 2. Heavy Battery Power Sockets
    for (const z of [-4, 4]) {
      const socketMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.9, 0.4, 16),
        toonMat({ color: 0x5ee06a })
      );
      socketMesh.position.set(-12.5, 0.2, z);
      this.scene.add(socketMesh);
      this.escapePuzzles.sockets.push({ x: -12.5, y: 0.4, z, filled: false, mesh: socketMesh });
    }

    // 3. Neon Power Conduit Cables linking Sockets to the Portal
    this.escapeCables = [];
    for (const z of [-4, 4]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-12.5, 0.15, z),
        new THREE.Vector3(-13.5, 0.15, z * 0.5),
        new THREE.Vector3(-14.5, 0.8, 0),
      ]);
      const cableGeo = new THREE.TubeGeometry(curve, 20, 0.08, 8, false);
      const cableMat = new THREE.MeshBasicMaterial({ color: 0x223344 });
      const cableMesh = new THREE.Mesh(cableGeo, cableMat);
      this.scene.add(cableMesh);
      this.escapeCables.push({ mesh: cableMesh, mat: cableMat, targetZ: z });
    }

    // 4. Moving Floating Diorama Stepping Stone Platforms
    this.escapePlatforms = [];
    const stonePositions = [
      { x: -9.5, z: -2.5, phase: 0 },
      { x: -9.5, z: 2.5, phase: Math.PI },
      { x: -7.0, z: 0, phase: Math.PI / 2 },
    ];
    for (const sp of stonePositions) {
      const pGroup = new THREE.Group();
      const pMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.2, 0.5, 12),
        toonMat({ color: 0x7688a2 })
      );
      pMesh.castShadow = true;
      pMesh.receiveShadow = true;
      pGroup.add(pMesh);
      pGroup.position.set(sp.x, 0.2, sp.z);
      this.scene.add(pGroup);

      const pBody = this.physicsWorld.createKinematicShape(sp.x, 0.2, sp.z, 'cylinder', { halfHeight: 0.25, radius: 1.4 }, 0.9).body;
      this.escapePlatforms.push({
        group: pGroup,
        body: pBody,
        baseX: sp.x,
        baseZ: sp.z,
        phase: sp.phase,
      });
    }
  }


  _createDestructibleCover() {
    this.coverBlocks = [];
    // Place barricade crates on both sides of the arena
    const positions = [
      { x: -5, y: 1.0, z: -3 },
      { x: -5, y: 1.0, z: 3 },
      { x: 5, y: 1.0, z: -3 },
      { x: 5, y: 1.0, z: 3 },
      { x: -8, y: 1.0, z: 0 },
      { x: 8, y: 1.0, z: 0 },
    ];

    for (const p of positions) {
      const cover = this.spawnItem('crate', p);
      if (cover) {
        cover.isCover = true;
        this.coverBlocks.push(cover);
      }
    }
  }

  update(dt) {
    this.time += dt;

    if (this.hazardsActive) {
      if (this.arenaId === 'volcano') this._updateVolcano(dt);
      if (this.arenaId === 'pinball') this._updateConveyors(dt);
      if (this.wind) this._updateWind(dt);
      if (this.arenaId === 'megastadium') this._updateMegaStadium(dt);
      if (this.clawEnabled && CLAW_ARENAS.has(this.arenaId)) {
        if (!this.claw) { this.claw = new CrowdClaw(this); this.claw.onEvent = (k, d) => this.onClaw?.(k, d); }
        this.claw.update(dt);
      }
    }
    this.stageHazards?.update(dt, this.hazardsActive);
    this._updatePlatforms();

    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      obj.update?.(dt);
      if (obj.isDebris) {
        obj.life -= dt;
        if (obj.life <= 0) this.removeObject(obj);
        continue;
      }
      const p = obj.getPosition();
      if (!obj.isGrabbed && p.y < WATER_LEVEL - 1) {
        this.onObjectSplash?.(obj, p);
        this.removeObject(obj);
        continue;
      }
      if (!obj.isGrabbed && obj.body && p.y < 2) this._bumpObject(obj, p, dt);
    }

    // Wrecking cubes
    for (const pend of this.pendulums) {
      pend.phase += dt * pend.speed;
      const amp = (this.suddenDeath ? this.sdPendulumAmp : 0.9) * this.pendulumBoost;
      pend.amp += (amp - pend.amp) * Math.min(1, dt);
      const angle = Math.sin(pend.phase) * pend.amp;
      pend.group.rotation.x = angle;
      const prev = pend.pos.clone();
      pend.pos.set(pend.anchor.x, pend.anchor.y - Math.cos(angle) * pend.cordLength, pend.anchor.z + Math.sin(angle) * pend.cordLength);
      pend.vel.copy(pend.pos).sub(prev).divideScalar(Math.max(dt, 1e-4));
      pend.body.setNextKinematicTranslation({ x: pend.pos.x, y: pend.pos.y, z: pend.pos.z });
      const h = angle / 2;
      pend.body.setNextKinematicRotation({ x: Math.sin(h), y: 0, z: 0, w: Math.cos(h) });
    }

    // Animate Drop Wall
    if (this.dropWall && this.dropWall.dropped && this.dropWall.curY > this.dropWall.targetY) {
      this.dropWall.curY = Math.max(this.dropWall.targetY, this.dropWall.curY - this.dropWall.dropSpeed * dt);
      this.dropWall.group.position.y = this.dropWall.curY;
      this.dropWall.body.setNextKinematicTranslation({ x: 0, y: this.dropWall.curY, z: 0 });
    }

    // Animate Escape Portal & Check Socket Activation
    if (this.escapePortal && this.escapePuzzles) {
      this.escapePortal.field.rotation.z += dt * 1.5;
      
      // Check if batteries are placed in sockets
      let filledCount = 0;
      for (const socket of this.escapePuzzles.sockets) {
        for (const obj of this.objects) {
          if (obj.key === 'powerBattery' && !obj.isGrabbed) {
            const p = obj.getPosition();
            const d = Math.hypot(p.x - socket.x, p.z - socket.z);
            if (d < 1.2 && Math.abs(p.y - socket.y) < 1.2) {
              if (!socket.filled) {
                socket.filled = true;
                socket.mesh.material.color.setHex(0xffd23f); // socket lights up gold!
              }
              filledCount++;
              break;
            }
          }
        }
      }

      this.escapePuzzles.batteriesInstalled = filledCount;
      if (filledCount >= this.escapePuzzles.batteriesNeeded && !this.escapePuzzles.doorOpen) {
        this.escapePuzzles.doorOpen = true;
        this.escapePortal.field.material.color.setHex(0x5ee06a);
        this.onPortalPowered?.();
      }

      // Animate neon power cables
      if (this.escapeCables) {
        for (const cable of this.escapeCables) {
          const matchSocket = this.escapePuzzles.sockets.find(s => s.z === cable.targetZ);
          if (matchSocket?.filled) {
            cable.mat.color.setHex(0x3fa9ff); // neon blue power flow
          } else {
            cable.mat.color.setHex(0x223344);
          }
        }
      }

      // Animate moving stepping stone platforms
      if (this.escapePlatforms) {
        for (const ep of this.escapePlatforms) {
          ep.phase += dt * 1.5;
          const curY = 0.2 + Math.sin(ep.phase) * 0.45;
          const curZ = ep.baseZ + Math.cos(ep.phase) * 0.75;
          ep.group.position.set(ep.baseX, curY, curZ);
          ep.body.setNextKinematicTranslation({ x: ep.baseX, y: curY, z: curZ });
        }
      }

      if (this.escapePuzzles.doorOpen) {
        this.escapePortal.field.material.opacity = 0.85 + Math.sin(this.time * 8) * 0.15;
      }
    }

    // Update Death Contraptions
    if (this.contraptions) {
      for (const c of this.contraptions) {
        if (c.type === 'shredder') {
          c.angle += c.speed * dt;
          c.group.rotation.x = c.angle;
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), c.angle);
          c.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        } else if (c.type === 'spikedLog') {
          c.angle += c.spinSpeed * dt;
          c.sweepPhase += dt * 1.2;
          const sweepZ = Math.sin(c.sweepPhase) * 3.5;
          c.group.position.set(0, 1.1, sweepZ);
          c.group.rotation.x = c.angle;
          c.body.setNextKinematicTranslation({ x: 0, y: 1.1, z: sweepZ });
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), c.angle);
          c.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        } else if (c.type === 'catapult') {
          // Check if any dweeb steps on it
          c.timer -= dt;
          if (c.timer <= 0) {
            c.group.position.y = 0.18 + Math.sin(this.time * 12) * 0.05;
          }
        } else if (c.type === 'wreckingLog') {
          c.phase += dt * c.speed;
          const swingZ = Math.sin(c.phase) * 5.0;
          const swingY = 3.0 + Math.cos(c.phase) * 1.5;
          c.group.position.set(c.baseX, swingY, swingZ);
          c.body.setNextKinematicTranslation({ x: c.baseX, y: swingY, z: swingZ });
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(c.phase) * 0.4);
          c.group.rotation.x = Math.sin(c.phase) * 0.4;
          c.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        } else if (c.type === 'laserBar') {
          c.angle += dt * c.spinSpeed;
          c.group.rotation.y = c.angle;
        } else if (c.type === 'stomper') {
          c.timer -= dt;
          if (c.timer <= 0) {
            if (c.state === 'wait') {
              c.state = 'smash';
              c.timer = 0.35;
            } else if (c.state === 'smash') {
              c.state = 'dwell';
              c.timer = 0.5;
            } else {
              c.state = 'wait';
              c.timer = 2.5;
            }
          }
          let targetY = c.baseY;
          if (c.state === 'smash' || c.state === 'dwell') targetY = c.crushY;
          const curY = c.group.position.y;
          const newY = THREE.MathUtils.lerp(curY, targetY, 1 - Math.exp(-(c.state === 'smash' ? 24 : 6) * dt));
          c.group.position.y = newY;
          c.body.setNextKinematicTranslation({ x: 0, y: newY, z: 0 });
        }
      }

      // Physics interactions between contraptions and active Dweebs
      if (this.dweebs && this.dweebs.length) {
        for (const c of this.contraptions) {
          for (const d of this.dweebs) {
            if (!d.active || d.eliminated) continue;
            const p = d.getPosition();

            if (c.type === 'catapult') {
              const dist = Math.hypot(p.x - c.x, p.z - c.z);
              if (dist < 1.4 && p.y < 1.0) {
                // Stratospheric yeet!
                d.receiveHit({
                  dir: { x: (Math.random() - 0.5) * 0.2, y: 1.0, z: (Math.random() - 0.5) * 0.2 },
                  damage: 35,
                  base: 32,
                  growth: 15,
                  attacker: null,
                  time: this.time,
                });
                c.timer = 1.0;
                this.onContraptionHit?.(c, d, 'SUPERSONIC CATAPULT');
              }
            } else if (c.type === 'stomper') {
              if (c.group.position.y < 2.0 && Math.hypot(p.x, p.z) < 2.0 && p.y < 1.8) {
                // Smashed into pancake!
                d.receiveHit({
                  dir: { x: p.x || 0.1, y: -0.2, z: p.z || 0.1 },
                  damage: 50,
                  base: 28,
                  growth: 12,
                  attacker: null,
                  time: this.time,
                });
                this.onContraptionHit?.(c, d, 'HYDRAULIC TENDERIZER');
              }
            } else if (c.type === 'shredder') {
              const dist = Math.hypot(p.x - (c.side * 2.2), p.z - 6.5);
              if (dist < 1.5 && p.y < 1.8) {
                d.receiveHit({
                  dir: { x: -c.side * 0.8, y: 0.6, z: -0.5 },
                  damage: 40,
                  base: 26,
                  growth: 14,
                  attacker: null,
                  time: this.time,
                });
                this.onContraptionHit?.(c, d, 'INDUSTRIAL SHREDDER');
              }
            } else if (c.type === 'spikedLog') {
              const curSweepZ = c.group.position.z;
              if (Math.abs(p.x) < 4.0 && Math.abs(p.z - curSweepZ) < 0.9 && p.y < 2.0) {
                d.receiveHit({
                  dir: { x: (Math.random() - 0.5) * 0.5, y: 0.7, z: Math.sin(c.sweepPhase) > 0 ? 1 : -1 },
                  damage: 30,
                  base: 22,
                  growth: 10,
                  attacker: null,
                  time: this.time,
                });
                this.onContraptionHit?.(c, d, 'SPIKED LOG ROLLER');
              }
            } else if (c.type === 'wreckingLog') {
              const wp = c.group.position;
              if (Math.hypot(p.x - wp.x, p.y - wp.y, p.z - wp.z) < 1.6) {
                d.receiveHit({
                  dir: { x: -0.8, y: 0.7, z: Math.cos(c.phase) > 0 ? 0.8 : -0.8 },
                  damage: 45,
                  base: 30,
                  growth: 15,
                  attacker: null,
                  time: this.time,
                });
                this.onContraptionHit?.(c, d, 'WRECKING LOG');
              }
            } else if (c.type === 'laserBar') {
              // Line segment distance to Dweeb
              const fx = Math.cos(c.angle) * 5.0, fz = Math.sin(c.angle) * 5.0;
              const dx = p.x - c.x, dz = p.z - c.z;
              const proj = Math.max(-5.0, Math.min(5.0, (dx * fx + dz * fz) / 5.0));
              const cx = c.x + (fx / 5.0) * proj, cz = c.z + (fz / 5.0) * proj;
              if (Math.hypot(p.x - cx, p.z - cz) < 0.8 && Math.abs(p.y - c.y) < 1.0) {
                d.receiveHit({
                  dir: { x: dx || 0.2, y: 0.8, z: dz || 0.2 },
                  damage: 35,
                  base: 25,
                  growth: 10,
                  attacker: null,
                  time: this.time,
                });
                this.onContraptionHit?.(c, d, 'ROTATING LASER GRID');
              }
            }
          }
        }
      }
    }

    // Spinner (speeds up in sudden death)
    for (const s of this.spinners) {
      s.angle += dt * s.speed * (this.suddenDeath ? 1.6 : 1);
      s.group.rotation.y = s.angle;
      s.body.setNextKinematicRotation({ x: 0, y: Math.sin(s.angle / 2), z: 0, w: Math.cos(s.angle / 2) });
    }

    // Bumpers flash + squash, trampoline beds spring back
    for (const b of this.bumpers) {
      b.flash = Math.max(0, b.flash - dt * 4);
      b.mat.emissiveIntensity = b.flash * 0.8;
      const k = 1 + Math.sin(b.flash * Math.PI * 3) * b.flash * 0.18;
      b.body.scale.set(k, 2 - k, k);
    }
    for (const t of this.trampolines) {
      t.dipV += (-280 * t.dip - 9 * t.dipV) * dt;
      t.dip += t.dipV * dt;
      t.bed.position.y = TRAMPOLINE_TOP - 0.02 + t.dip * 0.15;
    }
    for (const f of this.floaters) {
      f.mesh.position.y = f.baseY + Math.sin(this.time * 1.3 + f.phase) * 0.25;
      f.mesh.rotation.y += f.spin * dt;
      if (f.rock) f.mesh.rotation.x = Math.sin(this.time * 0.9 + f.phase) * 0.06;
    }

    // Floating platforms bob a little (visual only; colliders stay put)
    for (const p of this.platforms) p.group.position.y = p.baseY + Math.sin(this.time * 1.5 + p.z) * 0.04;

    // Crumbling ring
    if (this.suddenDeath && this.crumbleQueue.length) {
      this.crumbleTimer -= dt;
      if (this.crumbleTimer <= 0) {
        this._warnSegment(this._nextCrumble());
        this.crumbleTimer = this.crumbleInterval * this.sdPace;
      }
    }
    for (const seg of this.segments) {
      if (seg.state === 'warning') {
        seg.timer -= dt;
        const flash = Math.sin(this.time * (20 + Math.max(0, 2.2 - seg.timer) * 12)) > 0;
        seg.topMat.color.setHex(flash ? 0xffffff : seg.baseColor);
        const shake = Math.max(0, 2.2 - seg.timer) * 0.04;
        seg.mesh.position.set(seg.home.x + (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, seg.home.z + (Math.random() - 0.5) * shake);
        if (seg.timer <= 0) {
          seg.topMat.color.setHex(seg.baseColor);
          this._dropSegment(seg);
        }
      } else if (seg.state === 'falling') {
        seg.vel.y -= 22 * dt;
        seg.mesh.position.addScaledVector(seg.vel, dt);
        seg.mesh.rotation.x += seg.spin.x * dt;
        seg.mesh.rotation.z += seg.spin.z * dt;
        if (seg.mesh.position.y < WATER_LEVEL - 0.5 && !seg.splashed) {
          seg.splashed = true;
          this.onObjectSplash?.(seg, seg.mesh.position);
        }
        if (seg.mesh.position.y < WATER_LEVEL - 10) {
          seg.state = 'gone';
          seg.mesh.visible = false;
        }
      }
    }

    // Power-ups float down, then bob
    for (const pu of [...this.powerups]) {
      pu.gem.rotation.y += dt * 2;
      pu.halo.rotation.z += dt;
      const groundY = this.isOverGround(pu.x, pu.z) ? (this._overPlatform(pu.x, pu.z, 0) ? 3.7 : 0) : WATER_LEVEL - 2;
      if (!pu.landed) {
        pu.group.position.y -= dt * 4;
        if (pu.group.position.y <= groundY + 0.8) pu.landed = true;
      } else {
        pu.group.position.y = groundY + 0.8 + Math.sin(this.time * 3) * 0.12;
        pu.life -= dt;
        pu.group.visible = pu.life > 3 || Math.sin(this.time * 20) > 0;
        if (pu.life <= 0 || groundY < WATER_LEVEL) this.removePowerUp(pu);
      }
    }

    this.cheer = Math.max(0, this.cheer - dt * 0.6);
    this._updateCrowd(dt);
  }

  _updateCrowd(dt) {
    if (!this.crowd) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const amp = 0.12 + this.cheer * 0.7;
    this.crowdSeats.forEach((seat, i) => {
      seat.phase += dt * seat.freq * (1 + this.cheer);
      const bob = Math.max(0, Math.sin(seat.phase)) * amp;
      q.setFromAxisAngle(up, seat.yaw);
      p.set(seat.x, seat.y + bob, seat.z);
      s.set(1, 1 + bob * 0.4, 1);
      m.compose(p, q, s);
      this.crowd.setMatrixAt(i, m);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
  }

  /** Make the crowd go wild (0..1). */
  excite(amount = 1) {
    this.cheer = Math.min(1.5, this.cheer + amount);
  }

  reset() {
    for (const obj of [...this.objects]) this.removeObject(obj);
    this.objects = [];
    this.physicsWorld.debrisCount = 0;
    for (const pu of [...this.powerups]) this.removePowerUp(pu);
    for (const seg of this.segments) {
      seg.state = 'solid';
      seg.splashed = false;
      seg.collider.setEnabled(true);
      seg.mesh.visible = true;
      seg.mesh.position.copy(seg.home);
      seg.mesh.rotation.set(0, 0, 0);
      seg.topMat.color.setHex(seg.baseColor);
    }
    this.suddenDeath = false;
    this.sdPace = 1;
    this.sdWarnScale = 1;
    this.sdPendulumAmp = 0.9;
    this.crumbleQueue = [];
    this.itemTimer = 6;
    this.powerupTimer = 10;
    this.lastRareDrop = {};
    this._resetArenaHazards();
    this._spawnStartItems();
  }
}

// ─── helpers ───

const DEBRIS_SHAPES = {
  wood: [{ geo: () => new THREE.BoxGeometry(0.07, 0.07, 0.32), half: [0.035, 0.035, 0.16] },
    { geo: () => new THREE.BoxGeometry(0.16, 0.06, 0.12), half: [0.08, 0.03, 0.06] }],
  glass: [{ geo: () => new THREE.TetrahedronGeometry(0.1).scale(1, 0.35, 1.5), half: [0.06, 0.02, 0.09] }],
  ceramic: [{ geo: () => new THREE.CylinderGeometry(0.12, 0.12, 0.09, 5, 1, true, 0, 1.4), half: [0.06, 0.045, 0.05] }],
  fruit: [{ geo: () => new THREE.IcosahedronGeometry(0.08, 0), half: [0.06, 0.06, 0.06] }],
  cardboard: [{ geo: () => new THREE.BoxGeometry(0.22, 0.015, 0.17), half: [0.11, 0.01, 0.085] }],
  default: [{ geo: () => new THREE.DodecahedronGeometry(0.08, 0), half: [0.06, 0.06, 0.06] }],
};
const debrisGeoCache = new Map();
function debrisShape(material, i) {
  const list = DEBRIS_SHAPES[material] || DEBRIS_SHAPES.default;
  const idx = i % list.length;
  const key = `${material in DEBRIS_SHAPES ? material : 'default'}:${idx}`;
  if (!debrisGeoCache.has(key)) debrisGeoCache.set(key, { geo: list[idx].geo(), half: list[idx].half });
  return debrisGeoCache.get(key);
}
const debrisMatCache = new Map();
function debrisMat(color, glass) {
  const key = `${color}:${glass}`;
  if (!debrisMatCache.has(key)) {
    debrisMatCache.set(key, glass
      ? toonMat({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, emissive: 0x88ccff, emissiveIntensity: 0.3 })
      : toonMat({ color, side: THREE.DoubleSide }));
  }
  return debrisMatCache.get(key);
}

function roundedBox(w, h, d, r) {
  const geo = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const c = new THREE.Vector3(
      THREE.MathUtils.clamp(v.x, -inner.x, inner.x),
      THREE.MathUtils.clamp(v.y, -inner.y, inner.y),
      THREE.MathUtils.clamp(v.z, -inner.z, inner.z)
    );
    const n = v.clone().sub(c);
    if (n.lengthSq() > 0) v.copy(c).add(n.normalize().multiplyScalar(r));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function jitter(geo, amt) {
  const pos = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
    if (!seen.has(key)) seen.set(key, [(Math.random() - 0.5) * amt, (Math.random() - 0.5) * amt * 0.5, (Math.random() - 0.5) * amt]);
    const [dx, dy, dz] = seen.get(key);
    if (pos.getY(i) > 2.9) continue;
    pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
  }
  geo.computeVertexNormals();
}

function starShape(outer, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return s;
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 205;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 150px "Lilita One", "Arial Black", sans-serif';
  const word = 'DWEEB STADIUM';
  const cols = ['#ff4d5e', '#ffd23f', '#3fa9ff', '#5ee06a', '#ff9a3c', '#b56cff'];
  ctx.lineJoin = 'round';
  // Measure letters to colour them individually
  const widths = [...word].map(ch => ctx.measureText(ch).width);
  let x = c.width / 2 - widths.reduce((a, b) => a + b, 0) / 2;
  [...word].forEach((ch, i) => {
    const cx = x + widths[i] / 2;
    ctx.lineWidth = 22;
    ctx.strokeStyle = '#1b1030';
    ctx.strokeText(ch, cx, 108);
    ctx.fillStyle = cols[i % cols.length];
    ctx.fillText(ch, cx, 102);
    x += widths[i];
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1030';
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#1b1030';
  ctx.lineCap = 'round';
  // Angry brows + eyes + frown
  ctx.beginPath(); ctx.moveTo(22, 34); ctx.lineTo(54, 46); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(106, 34); ctx.lineTo(74, 46); ctx.stroke();
  ctx.beginPath(); ctx.arc(40, 62, 9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(88, 62, 9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(64, 112, 22, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function iconTexture(icon, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#1b1030';
  ctx.stroke();
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.font = 'bold 76px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
