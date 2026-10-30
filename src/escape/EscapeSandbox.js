// EscapeSandbox.js — Dweebscape: a physical escape room with four ways out.
//
// The vault sits on its own little island out on the lake (offset from the stadium so none of
// the stadium hazards leak in). Every exit is a physics problem, not a key-and-lock:
//   💥 DEMOLITION   — blow the door hinges with explosive barrels (explosions are reported by
//                     CombatSystem.onExplode → onExplosion()).
//   ⚖️ PULLEY       — load the counterweight basket (props and dweebs both count, by mass);
//                     the basket sinks and the door lifts in proportion — squeeze under early.
//   🔋 CIRCUIT      — knock the power cell off its high ledge and carry it into the socket.
//   🪜 ROOF RUNNER  — stack crates under the high shelf, climb up and dive through the vent.
// The props are ordinary arena items, so grab / carry / throw / explode all work as usual.

import * as THREE from 'three';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';

export const ESCAPE_ORIGIN = { x: 90, z: 0 };
export const EXITS = [
  { id: 'demolition', icon: '💥', name: 'DEMOLITION EXPERT', hint: 'Those door hinges look… flammable.' },
  { id: 'pulley', icon: '⚖️', name: 'PULLEY MASTER', hint: 'The basket wants weight. Any weight.' },
  { id: 'circuit', icon: '🔋', name: 'CIRCUIT BREAKER', hint: 'The socket is hungry. Look up.' },
  { id: 'vent', icon: '🪜', name: 'ROOF RUNNER', hint: 'There’s a draft up high.' },
];
const STORE_KEY = 'dweebs.escape.v1';

const DOOR = { hx: 3.9, hy: 3.4, hz: 0.35, y: 3.4, z: -16, lift: 6.8 };
const HINGES = [{ x: -3.7, y: 3.4, z: -15.5 }, { x: 3.7, y: 3.4, z: -15.5 }];
const BASKET = { x: -8, z: 6, r: 1.9, top: 1.2, sink: 1.0, target: 10 };
const SOCKET = { x: 6.5, y: 1.2, z: -14.6 };
const VENT = { x0: -9, x1: -6, y0: 5.6, y1: 8.2 };

function loadStore() {
  try { return { found: {}, best: null, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { found: {}, best: null }; }
}
function saveStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export class EscapeSandbox {
  /**
   * @param {object} physicsWorld PhysicsWorld
   * @param {THREE.Scene} scene
   * @param {{ arena?: object, fx?: object, hud?: object, audio?: object }} opts
   */
  constructor(physicsWorld, scene, opts = {}) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.arena = opts.arena || null;
    this.fx = opts.fx || null;
    this.hud = opts.hud || null;
    this.audio = opts.audio || null;
    this.O = new THREE.Vector3(ESCAPE_ORIGIN.x, 0, ESCAPE_ORIGIN.z);

    this.group = new THREE.Group();
    this.group.position.copy(this.O);
    this.scene.add(this.group);

    this.bodyIds = [];        // every physics body we created (static, kinematic, dynamic)
    this.items = [];          // arena InteractiveObjects we spawned
    this.wallSides = {};      // side -> { mat, meshes } for the camera cutaway
    this.clock = 0;
    this.escaped = false;
    this.escapeMethod = null;
    this.store = loadStore();

    this.hingeHp = [100, 100];
    this.doorBlown = false;
    this.doorLift = 0;
    this.basketWeight = 0;
    this.pulleyLift = 0;
    this.batterySocketed = false;
    this._flash = 0;

    this._buildRoom();
    this._buildDoor();
    this._buildBasket();
    this._buildCircuit();
    this._buildVentShelf();
    this._spawnProps();
    this._buildHintPanel();
  }

  // ─── helpers ───

  _static(x, y, z, hx, hy, hz, mat = 'stone') {
    const r = this.physicsWorld?.createStaticBox(this.O.x + x, y, this.O.z + z, hx, hy, hz, mat);
    if (r) this.bodyIds.push(r.id);
    return r;
  }

  _box(x, y, z, hx, hy, hz, material, parent = this.group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), material);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** A solid wall piece: mesh + collider, tagged with a side for the camera cutaway. */
  _wall(side, x, y, z, hx, hy, hz) {
    if (!this.wallSides[side]) {
      const mat = toonMat({ color: side === 'front' ? 0x56657a : 0x475569, transparent: true, opacity: 1 });
      this.wallSides[side] = { mat, meshes: [], fade: 1 };
    }
    const s = this.wallSides[side];
    s.meshes.push(this._box(x, y, z, hx, hy, hz, s.mat));
    this._static(x, y, z, hx, hy, hz, 'stone');
  }

  /** World position of a room-local point. */
  w(x, y, z) { return { x: this.O.x + x, y, z: this.O.z + z }; }

  // ─── construction ───

  _buildRoom() {
    // Island base + chamber floor (24 × 32) + courtyard beyond the exit wall
    const isle = new THREE.Mesh(new THREE.CylinderGeometry(27, 30, 3, 20), toonMat({ color: 0xd8c38f }));
    isle.position.set(0, -1.6, -6);
    isle.receiveShadow = true;
    this.group.add(isle);
    this._box(0, -0.5, 0, 12, 0.5, 16, toonMat({ color: 0x64748b }));
    this._static(0, -0.5, 0, 12, 0.5, 16, 'stone');
    // floor tiles for a little readability
    const tileMat = toonMat({ color: 0x5b6b80 });
    for (let i = -5; i <= 5; i += 2) for (let j = -7; j <= 7; j += 2) {
      if ((i + j) % 4 === 0) { const t = this._box(i * 1.1, 0.01, j * 1.1, 0.5, 0.01, 0.5, tileMat); t.castShadow = false; noOutline(t); }
    }
    this._box(0, -0.4, -24.6, 15, 0.4, 8.6, toonMat({ color: 0x5ee06a }));
    this._static(0, -0.4, -24.6, 15, 0.4, 8.6, 'stone');
    // Freedom arch + flags in the courtyard
    const archMat = toonMat({ color: PALETTE.yellow ?? 0xffd23f });
    this._box(-4.2, 2.2, -27, 0.35, 2.2, 0.35, archMat);
    this._box(4.2, 2.2, -27, 0.35, 2.2, 0.35, archMat);
    this._box(0, 4.6, -27, 4.6, 0.35, 0.35, archMat);

    // Side + back walls (12 m tall)
    this._wall('left', -12, 6, 0, 0.6, 6, 16);
    this._wall('right', 12, 6, 0, 0.6, 6, 16);
    this._wall('back', 0, 6, 16, 12.6, 6, 0.6);
    // Exit wall (z = -16): doorway x ∈ [-4, 4] up to the lintel, plus a vent hole up on the left
    this._wall('front', -8, VENT.y0 / 2, -16, 4, VENT.y0 / 2, 0.6);                              // below the vent
    this._wall('front', -8, (VENT.y1 + 12) / 2, -16, 4, (12 - VENT.y1) / 2, 0.6);                // above the vent
    this._wall('front', (-12 + VENT.x0) / 2, (VENT.y0 + VENT.y1) / 2, -16, (VENT.x0 + 12) / 2, (VENT.y1 - VENT.y0) / 2, 0.6);
    this._wall('front', (VENT.x1 - 4) / 2, (VENT.y0 + VENT.y1) / 2, -16, (-4 - VENT.x1) / 2, (VENT.y1 - VENT.y0) / 2, 0.6);
    this._wall('front', 8, 6, -16, 4, 6, 0.6);
    this._wall('front', 0, 9.4, -16, 4, 2.6, 0.6);                                                // lintel

    // Vent grate frame + sunbeam pouring through it
    const grateMat = toonMat({ color: 0x334155 });
    for (let k = 0; k < 4; k++) this._box(VENT.x0 + 0.4 + k * 0.75, (VENT.y0 + VENT.y1) / 2, -16.75, 0.06, (VENT.y1 - VENT.y0) / 2, 0.06, grateMat);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.6, 7, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    beam.rotation.x = -Math.PI / 5;
    beam.position.set((VENT.x0 + VENT.x1) / 2, 4.6, -13.6);
    noOutline(beam);
    this.group.add(beam);

    const light = new THREE.PointLight(0xfff3c4, 2.4, 34);
    light.position.set(0, 9, 0);
    this.group.add(light);
  }

  _buildDoor() {
    this.doorMesh = this._box(0, DOOR.y, DOOR.z, DOOR.hx, DOOR.hy, DOOR.hz, toonMat({ color: 0x78350f }));
    // planks + rivets so it reads as a vault door
    const plankMat = toonMat({ color: 0x92400e });
    for (let k = -1; k <= 1; k++) this._box(0, k * 2, 0.37, DOOR.hx - 0.2, 0.18, 0.03, plankMat, this.doorMesh);
    const hingeMat = toonMat({ color: 0xd97706, emissive: 0x000000 });
    this.hingeMeshes = HINGES.map(h => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 2.2, 10), hingeMat.clone());
      m.position.set(h.x, h.y, h.z);
      this.group.add(m);
      return m;
    });
    const r = this.physicsWorld?.createKinematicBox(this.O.x, DOOR.y, this.O.z + DOOR.z, DOOR.hx, DOOR.hy, DOOR.hz, 'wood');
    if (r) { this.doorBody = r; this.bodyIds.push(r.id); }
  }

  _buildBasket() {
    const g = new THREE.Group();
    g.position.set(BASKET.x, BASKET.top - 0.2, BASKET.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(BASKET.r, BASKET.r - 0.2, 0.4, 14), toonMat({ color: 0xb45309 }));
    g.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(BASKET.r, 0.14, 6, 18), toonMat({ color: 0x78350f }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.35;
    g.add(rim);
    this.group.add(g);
    this.basketMesh = g;
    const r = this.physicsWorld?.createKinematicShape(this.O.x + BASKET.x, BASKET.top - 0.2, this.O.z + BASKET.z, 'cylinder',
      { radius: BASKET.r, halfHeight: 0.2 }, 0.05, 'wood');
    if (r) { this.basketBody = r; this.bodyIds.push(r.id); }

    // Pulley wheel on a beam over the left wall, rope basket → wheel → door
    const beamMat = toonMat({ color: 0x3f2a1a });
    this._box(-9, 12.3, -5, 0.3, 0.3, 11.5, beamMat);
    this.wheel = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.16, 6, 16), toonMat({ color: 0x9ca3af }));
    this.wheel.position.set(-8, 12.3, 6);
    this.wheel.rotation.y = Math.PI / 2;
    this.group.add(this.wheel);
    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    this.rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x1e293b }));
    this.group.add(this.rope);

    // Weight gauge sign
    this.gauge = this._box(BASKET.x + 2.8, 2.2, BASKET.z, 0.08, 1.4, 0.2, toonMat({ color: 0x1e293b }));
    this.gaugeFill = this._box(BASKET.x + 2.7, 0.8, BASKET.z, 0.06, 0.01, 0.16, new THREE.MeshBasicMaterial({ color: 0x5ee06a }));
    noOutline(this.gaugeFill);
  }

  _buildCircuit() {
    this._box(SOCKET.x, 0.6, SOCKET.z, 1.1, 0.6, 0.6, toonMat({ color: 0x334155 }));
    this._static(SOCKET.x, 0.6, SOCKET.z, 1.1, 0.6, 0.6, 'metal');
    this.socketMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0369a1, emissiveIntensity: 0.4 });
    const slot = this._box(SOCKET.x, 1.25, SOCKET.z, 0.42, 0.06, 0.42, this.socketMat);
    noOutline(slot);
    // Conduit from the socket to the door lock
    this.conduitMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, emissive: 0x0284c7, emissiveIntensity: 0.1 });
    const c = this._box((SOCKET.x + 3.9) / 2, 0.15, -15.25, (SOCKET.x - 3.9) / 2, 0.08, 0.08, this.conduitMat);
    noOutline(c);
    // The power cell sits on a high ledge in the back-right corner: knock it down (throw stuff!) or climb
    this._box(9.7, 4.2, 13.7, 1.7, 0.2, 1.7, toonMat({ color: 0x4b5563 }));
    this._static(9.7, 4.2, 13.7, 1.7, 0.2, 1.7, 'metal');
    this._box(8.3, 2.1, 12.3, 0.15, 2.1, 0.15, toonMat({ color: 0x374151 }));
  }

  _buildVentShelf() {
    // A shelf under the vent: too high to jump to, stack crates (or crate on a table) to reach it
    this._box(-9, 4.8, -14.6, 2.6, 0.2, 0.8, toonMat({ color: 0x8b5a2b }));
    this._static(-9, 4.8, -14.6, 2.6, 0.2, 0.8, 'wood');
  }

  _spawnProps() {
    if (!this.arena) return;
    const put = (key, x, y, z) => {
      try { const o = this.arena.spawnItem(key, this.w(x, y, z)); if (o) this.items.push(o); return o; } catch { return null; }
    };
    for (const [x, z] of [[-4, 9], [-2.5, 10.5], [3, 8], [5, 11], [-6, -4], [0, 4]]) put('crate', x, 1, z);
    put('table', 2, 1, -6);
    put('explosiveBarrel', -10, 1.2, 14);
    put('explosiveBarrel', 10.5, 1.2, -2);
    put('explosiveBarrel', -3, 1.2, 13.5);
    put('anvil', 7, 1, 4);
    put('bowlingBall', -6, 1, 1);
    put('tire', 4, 1, -2);
    put('powerBattery', 9.7, 5.2, 13.7);
  }

  _buildHintPanel() {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'escape-hint';
    el.style.cssText = 'position:fixed;left:14px;top:84px;z-index:40;pointer-events:none;background:#fff6e0;border:3px solid #1b1030;'
      + 'border-radius:14px;box-shadow:0 4px 0 #1b1030;padding:8px 12px;font:800 13px/1.35 Nunito,system-ui,sans-serif;color:#1b1030;min-width:200px';
    document.body.appendChild(el);
    this.hintEl = el;
    this._paintHints(true);
  }

  _paintHints(force = false) {
    if (!this.hintEl) return;
    const t = Math.floor(this.clock);
    const key = `${t}|${Math.round(this.basketWeight * 2)}|${this.hingeHp.map(h => Math.ceil(h / 10)).join()}|${this.batterySocketed}|${this.escaped}`;
    if (!force && key === this._hintKey) return;
    this._hintKey = key;
    const found = this.store.found;
    const n = EXITS.filter(e => found[e.id]).length;
    const rows = EXITS.map(e => found[e.id]
      ? `<div>✅ ${e.icon} <b>${e.name}</b></div>`
      : `<div style="opacity:.75">⬜ ${e.icon} <i>${e.hint}</i></div>`).join('');
    const mm = String(Math.floor(t / 60)), ss = String(t % 60).padStart(2, '0');
    const best = this.store.best != null ? ` · best ${this.store.best.toFixed(1)}s` : '';
    const hinge = Math.max(0, Math.round((this.hingeHp[0] + this.hingeHp[1]) / 2));
    this.hintEl.innerHTML = `<div style="font-size:15px;letter-spacing:.04em">🔐 ESCAPE THE VAULT · ${mm}:${ss}${best}</div>`
      + `<div style="margin:2px 0 4px">Exits found: <b>${n}/4</b></div>${rows}`
      + `<div style="margin-top:4px;opacity:.8">⚖️ ${this.basketWeight.toFixed(1)}/${BASKET.target} · 🚪 hinges ${hinge}%${this.batterySocketed ? ' · 🔋 ON' : ''}</div>`;
  }

  // ─── events ───

  /** CombatSystem reports every explosion; ones near the door chew through the hinges. */
  onExplosion(pos) {
    if (this.doorBlown || !pos) return;
    let hit = false;
    HINGES.forEach((h, i) => {
      const d = Math.hypot(pos.x - (this.O.x + h.x), pos.y - h.y, pos.z - (this.O.z + h.z));
      if (d < 6.5 && this.hingeHp[i] > 0) {
        this.hingeHp[i] -= 120 * (1 - d / 6.5) + 15;
        hit = true;
        const m = this.hingeMeshes[i];
        if (m) { m.rotation.z = (i ? -1 : 1) * Math.min(1, (100 - this.hingeHp[i]) / 100) * 0.9; m.material.emissive?.setHex(0xff5a1f); }
      }
    });
    if (!hit) return;
    this._flash = 0.5;
    if (this.hingeHp[0] <= 0 && this.hingeHp[1] <= 0) this._blowDoor();
    else this.hud?.announce?.('HINGES CRACKING!', 'small', 1.0);
    this._paintHints(true);
  }

  _blowDoor() {
    this.doorBlown = true;
    if (this.doorBody) {
      this.physicsWorld.removeBody(this.doorBody.id);
      this.doorBody = null;
    }
    const y = DOOR.y + this.doorLift * DOOR.lift;
    const dyn = this.physicsWorld?.createDynamicBody(this.O.x, y, this.O.z + DOOR.z - 0.4, 'box',
      { hx: DOOR.hx, hy: DOOR.hy, hz: DOOR.hz }, { material: 'wood', mass: 12 });
    if (dyn) {
      this.bodyIds.push(dyn.id);
      this.doorDyn = dyn;
      dyn.body.applyImpulse({ x: (Math.random() - 0.5) * 6, y: 8, z: -40 }, true);
      dyn.body.applyTorqueImpulse?.({ x: -12, y: (Math.random() - 0.5) * 6, z: 0 }, true);
    }
    for (const m of this.hingeMeshes) m.visible = false;
    const p = this.w(0, 3.4, -16);
    this.fx?.particles?.confetti(p, 50);
    this.fx?.particles?.dust(p, 18);
    this.audio?.playWoodBreak?.(0);
    this.hud?.announce?.('KA-BLAM! THE DOOR IS OFF!', 'ko', 1.4);
  }

  _socket(obj) {
    this.batterySocketed = true;
    this.arena?.removeObject(obj);
    this.items = this.items.filter(o => o !== obj);
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 10),
      new THREE.MeshStandardMaterial({ color: 0x5ee06a, emissive: 0x38bdf8, emissiveIntensity: 0.9 }));
    cell.position.set(SOCKET.x, 1.7, SOCKET.z);
    this.group.add(cell);
    this.socketMat.emissive.setHex(0x38bdf8); this.socketMat.emissiveIntensity = 1.4;
    this.conduitMat.emissiveIntensity = 1.2;
    const p = this.w(SOCKET.x, 1.7, SOCKET.z);
    this.fx?.particles?.ring(p, { color: 0x38bdf8, size: 3.5, life: 0.5 });
    this.fx?.particles?.sparkle?.(p, 0x38bdf8);
    this.audio?.playSuperReady?.();
    this.hud?.announce?.('POWER ON! THE VAULT UNLOCKS', 'go', 1.4);
  }

  // ─── per-frame ───

  update(dt, dweebs = [], camera = null) {
    this.clock += this.escaped ? 0 : dt;
    const O = this.O;
    const held = new Set();
    for (const d of dweebs) if (d.held?.kind === 'object') held.add(d.held.ref);

    // Drop stale references (items can break or explode)
    if (this.arena) this.items = this.items.filter(o => this.arena.objects.includes(o));

    // 🔋 Power cell into the socket (dropped or thrown in — not while someone still holds it)
    if (!this.batterySocketed) {
      for (const o of this.items) {
        if (o.key !== 'powerBattery' || held.has(o) || !o.body) continue;
        const p = o.getPosition();
        if (Math.hypot(p.x - (O.x + SOCKET.x), p.z - (O.z + SOCKET.z)) < 1.25 && p.y < SOCKET.y + 1.6) { this._socket(o); break; }
      }
    }

    // ⚖️ Counterweight: everything resting in the basket, by mass
    const top = BASKET.top - this.pulleyLift * BASKET.sink;
    const inBasket = (p) => Math.hypot(p.x - (O.x + BASKET.x), p.z - (O.z + BASKET.z)) < BASKET.r + 0.1 && p.y > top - 0.3 && p.y < top + 2.6;
    let w = 0;
    for (const d of dweebs) {
      if (!d.body || !d.active || d.grabbedBy) continue;
      if (inBasket(d.getPosition())) w += d.stats?.mass ?? 3;
    }
    for (const o of this.items) {
      if (!o.body || held.has(o)) continue;
      if (inBasket(o.getPosition())) w += o.def?.mass ?? 2;
    }
    this.basketWeight = THREE.MathUtils.lerp(this.basketWeight, w, Math.min(1, dt * 3));
    const pullTarget = Math.min(1, this.basketWeight / BASKET.target);
    this.pulleyLift = THREE.MathUtils.lerp(this.pulleyLift, pullTarget, Math.min(1, dt * 1.6));
    const newTop = BASKET.top - this.pulleyLift * BASKET.sink;
    this.basketMesh.position.y = newTop - 0.2;
    this.basketBody?.body.setNextKinematicTranslation({ x: O.x + BASKET.x, y: newTop - 0.2, z: O.z + BASKET.z });
    this.wheel.rotation.x += (pullTarget - this.pulleyLift) * dt * 8;
    if (this.gaugeFill) {
      const h = Math.max(0.01, pullTarget * 1.3);
      this.gaugeFill.scale.y = h / 0.01 * 0.5; this.gaugeFill.position.y = 0.8 + h / 2;
      this.gaugeFill.material.color.setHex(pullTarget >= 1 ? 0xffd23f : 0x5ee06a);
    }

    // 🚪 Door: the socket opens it fully, the pulley proportionally
    if (!this.doorBlown) {
      const target = this.batterySocketed ? 1 : this.pulleyLift >= 0.98 ? 1 : this.pulleyLift * 0.85;
      this.doorLift = THREE.MathUtils.lerp(this.doorLift, target, Math.min(1, dt * (this.batterySocketed ? 1.2 : 2)));
      const y = DOOR.y + this.doorLift * DOOR.lift;
      this.doorMesh.position.y = y;
      this.doorBody?.body.setNextKinematicTranslation({ x: O.x, y, z: O.z + DOOR.z });
      if (this._flash > 0) this.doorMesh.position.x = Math.sin(this.clock * 70) * 0.06 * this._flash;
    } else if (this.doorDyn) {
      const t = this.doorDyn.body.translation(), r = this.doorDyn.body.rotation();
      this.doorMesh.position.set(t.x - O.x, t.y, t.z - O.z);
      this.doorMesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    this._flash = Math.max(0, this._flash - dt);

    // Rope: basket → wheel → over the beam → door top
    const pos = this.rope.geometry.attributes.position;
    pos.setXYZ(0, BASKET.x, newTop + 0.35, BASKET.z);
    pos.setXYZ(1, BASKET.x, 12.3, BASKET.z);
    pos.setXYZ(2, -8, 12.3, -15);
    pos.setXYZ(3, this.doorBlown ? -8 : -3.6, this.doorBlown ? 11 : this.doorMesh.position.y + DOOR.hy, -15.4);
    pos.needsUpdate = true;

    // 🏁 Freedom check + fall rescue
    for (const d of dweebs) {
      if (!d.body) continue;
      const p = d.getPosition();
      const lx = p.x - O.x, lz = p.z - O.z;
      if (p.y < -7) { this.rescue(d); continue; }
      if (!d.isPlayer || this.escaped) continue;
      if (lz < -16.8 && p.y > VENT.y0 - 1.2 && lx > VENT.x0 - 0.6 && lx < VENT.x1 + 0.6) this._win(d, 'vent');
      else if (lz < -17.6 && Math.abs(lx) < 15) {
        this._win(d, this.doorBlown ? 'demolition' : this.batterySocketed ? 'circuit' : this.pulleyLift > 0.12 ? 'pulley' : null);
      }
    }

    if (camera) this._cutaway(camera, dt);
    this._paintHints();
  }

  /** Walls between the camera and the room fade out so you can always see your dweeb. */
  _cutaway(camera, dt) {
    const cx = camera.position.x - this.O.x, cz = camera.position.z - this.O.z;
    const want = { left: cx < -11.5, right: cx > 11.5, back: cz > 15.5, front: cz < -15.5 };
    for (const [side, s] of Object.entries(this.wallSides)) {
      const target = want[side] ? 0.18 : 1;
      s.fade += (target - s.fade) * Math.min(1, dt * 8);
      s.mat.opacity = s.fade;
      s.mat.depthWrite = s.fade > 0.95;
      s.mat.userData.outlineParameters = { visible: s.fade > 0.6 };
    }
  }

  /** Spawn point inside the vault for dweeb i of n. */
  spawnPoint(i = 0, n = 1) {
    if (i === 0) return this.w(0, 1.3, 10);
    const a = (i / Math.max(2, n)) * Math.PI;
    return this.w(Math.cos(a) * 5, 1.3, 11 + Math.sin(a) * 2);
  }

  rescue(d) {
    const p = this.spawnPoint(d.isPlayer ? 0 : 1, 2);
    d.body.setTranslation(p, true);
    d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    if (d.isPlayer) this.hud?.popup?.('BACK IN THE VAULT!', p, 'small', 0xffd23f);
  }

  _win(d, method) {
    this.escaped = true;
    const exit = EXITS.find(e => e.id === method);
    const fresh = exit && !this.store.found[method];
    if (exit) this.store.found[method] = true;
    const secs = this.clock;
    const best = this.store.best == null || secs < this.store.best;
    if (best) this.store.best = secs;
    saveStore(this.store);
    this.escapeMethod = exit ? exit.name : 'GLITCH IN THE VAULT';
    const n = EXITS.filter(e => this.store.found[e.id]).length;
    const sub = `${exit ? exit.icon + ' ' : ''}${this.escapeMethod} · ${secs.toFixed(1)}s${best ? ' · NEW BEST!' : ''}${fresh ? ` · NEW EXIT ${n}/4` : ''}`;
    this.hud?.announce?.(`FREEDOM!<small>${sub}</small>`, 'go', 3.2);
    const p = d.getPosition();
    this.fx?.particles?.confetti(p, 90);
    this.audio?.playCheer?.(1);
    this.audio?.playAirHorn?.();
    this._paintHints(true);
    this.onEscaped?.({ method, secs, fresh, best, found: n });
  }

  dispose() {
    this.scene.remove(this.group);
    for (const id of this.bodyIds) this.physicsWorld?.removeBody(id);
    this.bodyIds = [];
    if (this.arena) for (const o of this.items) if (this.arena.objects.includes(o)) this.arena.removeObject(o);
    this.items = [];
    this.group.traverse(o => { o.geometry?.dispose?.(); });
    this.hintEl?.remove();
    this.hintEl = null;
  }
}
