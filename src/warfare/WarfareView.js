// WarfareView.js — draws a warfare battle state with three.js. Reads the sim, never writes it.
// Interpolates unit positions between 30 Hz sim ticks, swaps team plastic on conversion, and
// turns sim events into juice via WarfareFx.
import * as THREE from 'three';
import { counterMult } from '../sim/warfareUnits.js';
import { buildBoard, buildBarricades } from './WarfareBoard.js';
import { getBattleground } from './Battlegrounds.js';
import { buildUnit, buildShell, buildRing, buildBarrel, buildCrate, buildTrap, teamMat, flashMat, TEAM_COLORS, sharedMats } from './WarfareModels.js';
import { WarfareFx } from './WarfareFx.js';

const lerp = (a, b, t) => a + (b - a) * t;
const TETHER_POINTS = 10;

export class WarfareView {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.name = 'warfare';
    scene.add(this.group);
    this.board = buildBoard(getBattleground('meadow'));
    this.group.add(this.board.group);
    this.dyn = new THREE.Group();
    this.group.add(this.dyn);
    this.fx = new WarfareFx(this.group, camera);
    this.entries = new Map();   // unit id → entry
    this.shells = new Map();    // shell obj → mesh
    this.props = new Map();     // prop id → { m, x, z, type }
    this.tethers = new Map();   // `${carrierId}>${victimId}` → tether
    this._tetherPool = [];
    this._tetherMats = {
      blue: new THREE.LineBasicMaterial({ color: TEAM_COLORS.blue, transparent: true, opacity: 0.95, depthWrite: false }),
      red: new THREE.LineBasicMaterial({ color: TEAM_COLORS.red, transparent: true, opacity: 0.95, depthWrite: false }),
    };
    this.traps = new Map();     // trap obj → mesh
    this.rally = {};
    for (const team of ['blue', 'red']) {
      const g = new THREE.Group();
      const ring = buildRing(TEAM_COLORS[team]);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5), sharedMats().brass);
      pole.position.y = 1.2;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 3), teamMat(team));
      flag.rotation.z = -Math.PI / 2;
      flag.scale.z = 0.25;
      flag.position.set(0.5, 2.1, 0);
      g.add(ring, pole, flag);
      g.visible = false;
      this.dyn.add(g);
      this.rally[team] = { g, ring, flag };
    }
    this.time = 0;
    this.localTeam = 'blue';
  }

  get pickMesh() { return this.board.pick; }

  /** Swap the battleground board (units and fx are cleared by reset()). */
  setMap(map) {
    this.group.remove(this.board.group);
    this.board = buildBoard(map || getBattleground('meadow'));
    this.group.add(this.board.group);
  }

  /** Swap the barricade set (per-battle map layout). Safe to call with [] or undefined.
   *  Also refreshes the tracked meshes so barricadeDown keeps hiding the right bundle. */
  setBarricades(list) {
    if (this.board.barr) this.board.group.remove(this.board.barr);
    const barr = buildBarricades(list || []);
    this.board.barr = barr.group;
    this.board.barricades = barr.meshes;
    this.board.group.add(this.board.barr);
  }

  reset() {
    this._clearTethers();
    for (const e of this.entries.values()) this.dyn.remove(e.m.root);
    this.entries.clear();
    for (const m of this.shells.values()) this.dyn.remove(m);
    this.shells.clear();
    for (const e of this.props.values()) this.dyn.remove(e.m);
    this.props.clear();
    for (const m of this.traps.values()) this.dyn.remove(m);
    this.traps.clear();
    this.fx.clear();
  }

  _acquireTether() {
    let t = this._tetherPool.pop();
    if (!t) {
      const positions = new Float32Array(TETHER_POINTS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, this._tetherMats.blue);
      line.frustumCulled = false;
      line.renderOrder = 2;
      t = { line, geo, positions };
    }
    t.line.visible = true;
    this.dyn.add(t.line);
    return t;
  }

  _releaseTether(t) {
    this.dyn.remove(t.line);
    t.line.visible = false;
    this._tetherPool.push(t);
  }

  _clearTethers() {
    for (const t of this.tethers.values()) this._releaseTether(t);
    this.tethers.clear();
  }

  /** Keeps pooled capture tethers in sync with the sim's carrier → victim pairs. */
  _syncTethers(st, events = null, allowEnd = false) {
    if (!st || !st.units) return;
    const converted = new Set();
    if (events) for (const ev of events) if (ev.type === 'convert') converted.add(ev.id);
    const live = new Map();
    const byId = st.byId || new Map(st.units.map(u => [u.id, u]));
    for (const u of st.units) {
      if (!u.alive || !u.carrying) continue;
      const v = byId.get(u.carrying);
      if (!v || !v.alive || v.carriedBy !== u.id) continue;
      live.set(`${u.id}>${v.id}`, { carrierId: u.id, victimId: v.id, team: u.team });
    }
    if (allowEnd) {
      for (const [key, t] of this.tethers) {
        if (live.has(key)) continue;
        if (!converted.has(t.victimId)) {
          const ve = this.entries.get(t.victimId);
          if (ve) this.fx.number(ve.x, 2.7, ve.z, 'SNAP!', 'word');
        }
        this._releaseTether(t);
        this.tethers.delete(key);
      }
    }
    for (const [key, info] of live) {
      let t = this.tethers.get(key);
      if (!t) {
        t = { ...this._acquireTether(), ...info, key, phase: (info.carrierId * 1.7 + info.victimId * 0.9) % (Math.PI * 2) };
        this.tethers.set(key, t);
      } else {
        t.team = info.team;
      }
      t.line.material = this._tetherMats[t.team] || this._tetherMats.blue;
    }
  }

  /** Redraws every tether as a sagging, wobbling elastic curve between both unit roots. */
  _updateTethers(t) {
    for (const th of this.tethers.values()) {
      const ce = this.entries.get(th.carrierId);
      const ve = this.entries.get(th.victimId);
      if (!ce || !ve) { th.line.visible = false; continue; }
      th.line.visible = true;
      const a = ce.m.root.position, b = ve.m.root.position;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      const dh = Math.hypot(dx, dz);
      const nx = dh > 0.001 ? -dz / dh : 1;
      const nz = dh > 0.001 ? dx / dh : 0;
      const taut = Math.min(1, dist / 8);
      const sag = (1 - taut) * 0.9 + 0.05;
      const pts = th.positions;
      for (let i = 0; i < TETHER_POINTS; i++) {
        const f = i / (TETHER_POINTS - 1);
        const arc = Math.sin(Math.PI * f);
        const wob = Math.sin(t * 9 + f * 7 + th.phase) * 0.1 * (1 - taut * 0.6);
        const bulge = arc * (sag + wob);
        const o = i * 3;
        pts[o] = a.x + dx * f + nx * bulge;
        pts[o + 1] = a.y + dy * f - bulge * 0.35;
        pts[o + 2] = a.z + dz * f + nz * bulge;
      }
      th.geo.attributes.position.needsUpdate = true;
    }
  }

  /** Call after every sim step: roll interpolation buffers and react to events. */
  afterStep(st) {
    const seen = new Set();
    for (const u of st.units) {
      seen.add(u.id);
      let e = this.entries.get(u.id);
      if (!e) {
        const m = buildUnit(u.type, u.team);
        m.root.position.set(u.x, 0, u.z);
        this.dyn.add(m.root);
        e = { m, px: u.x, pz: u.z, x: u.x, z: u.z, team: u.team, yaw: u.team === 'blue' ? 0 : Math.PI, flash: 0, leanX: 0, leanZ: 0, spawnT: 0, type: u.type, flag: null, rank: 0, name: '' };
        this.entries.set(u.id, e);
      }
      e.px = e.x; e.pz = e.z;
      e.x = u.x; e.z = u.z;
      e.vx = u.vx; e.vz = u.vz;
      e.carried = !!u.carriedBy;
      e.carrying = !!u.carrying;
      e.retreat = u.state === 'retreat';
      e.rout = u.state === 'rout';
      e.hpFrac = u.hp / u.maxHp;
      e.rank = u.rank || 0;
      e.name = u.name || '';
      if (e.team !== u.team) {
        e.team = u.team;
        e.m.body.material = teamMat(u.team);
      }
    }
    this._events(st.events);
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) { this.dyn.remove(e.m.root); this.entries.delete(id); }
    }
    this._syncTethers(st, st.events, true);
    // shells
    const live = new Set(st.shells);
    for (const sh of st.shells) {
      if (!this.shells.has(sh)) {
        const m = buildShell(sh.team);
        this.dyn.add(m);
        this.shells.set(sh, m);
      }
    }
    for (const [sh, m] of this.shells) if (!live.has(sh)) { this.dyn.remove(m); this.shells.delete(sh); }
    this._syncProps(st);
    // spike pits
    const liveTraps = new Set(st.traps);
    for (const t of st.traps) {
      if (!this.traps.has(t)) {
        const m = buildTrap(t.r);
        m.position.set(t.x, 0, t.z);
        this.dyn.add(m);
        this.traps.set(t, m);
      }
    }
    for (const [t, m] of this.traps) if (!liveTraps.has(t)) { this.dyn.remove(m); this.traps.delete(t); }
    for (const team of ['blue', 'red']) {
      const r = st.rally[team];
      const show = team === this.localTeam || st.mode === 'versus';
      this.rally[team].g.visible = show && !!r && !(st.mode === 'defense' && team === 'red');
      if (r) this.rally[team].g.position.set(r.x, 0.05, r.z);
    }
  }

  /** Keep battlefield props in sync with the sim. Props are static, so no interpolation. */
  _syncProps(st) {
    const list = Array.isArray(st?.props) ? st.props : [];
    const seen = new Set();
    for (const p of list) {
      if (!p) continue;
      seen.add(p.id);
      if (this.props.has(p.id)) continue;
      const m = p.type === 'crate' ? buildCrate() : buildBarrel();
      m.position.set(p.x, 0, p.z);
      this.dyn.add(m);
      this.props.set(p.id, { m, x: p.x, z: p.z, type: p.type });
    }
    for (const [id, e] of this.props) {
      if (!seen.has(id)) { this.dyn.remove(e.m); this.props.delete(id); }
    }
  }

  _events(events) {
    const fx = this.fx;
    for (const ev of events) {
      const e = ev.id ? this.entries.get(ev.id) : null;
      switch (ev.type) {
        case 'hit': {
          if (e) {
            e.flash = 0.1;
            e.leanX += ev.kx * 0.08; e.leanZ += ev.kz * 0.08;
          }
          const mult = counterMult(ev.src, ev.unit);
          fx.number(ev.x, 2.2, ev.z, String(Math.max(1, Math.round(ev.dmg))), mult > 1.05 ? 'crit' : mult < 0.95 ? 'weak' : '');
          break;
        }
        case 'death': {
          if (e) {
            this.entries.delete(ev.id);
            this.dyn.remove(e.m.root);
            const root = e.m.root;
            root.position.set(e.x, e.y ?? 0, e.z);
            e.m.body.material = teamMat(e.team);
            fx.deathPop(root, e.team, ev.kx, ev.kz, ev.unit === 'boss' || ev.unit === 'brute');
            if (ev.unit === 'boss') { fx.addShake(1.2); fx.explosion(e.x, e.z, 6, true); }
          }
          break;
        }
        case 'explode': fx.explosion(ev.x, ev.z, ev.r, !!ev.big); break;
        case 'artillery': {
          const r = ev.radius || 8.5;
          fx.explosion(ev.x, ev.z, r, true);
          fx.crater(ev.x, ev.z, r);
          fx.dustCloud(ev.x, ev.z, r);
          break;
        }
        case 'barricadeDown': {
          const bm = this.board.barricades.find(b => Math.hypot(b.x - ev.x, b.z - ev.z) < 0.6);
          if (bm) bm.g.visible = false;
          fx.dustCloud(ev.x, ev.z, ev.r || 3);
          fx.addShake(0.25);
          break;
        }
        case 'propBoom': {
          const pm = this.props.get(ev.id);
          if (pm) { this.dyn.remove(pm.m); this.props.delete(ev.id); }
          if (ev.prop === 'barrel') fx.explosion(ev.x, ev.z, ev.r || 4, true);
          else { fx.dustCloud(ev.x, ev.z, ev.r || 2.5); fx.puff(ev.x, ev.z); }
          break;
        }
        case 'slam': fx.shockwave(ev.x, ev.z, ev.r * 1.3, 0xd4a73a); fx.addShake(ev.unit === 'boss' ? 0.7 : 0.25); fx.puff(ev.x, ev.z); break;
        case 'fire': if (e) { fx.puff(ev.x, ev.z); fx.muzzle(ev.x, ev.z); e.leanX -= (ev.tx - ev.x) * 0.01; e.leanZ -= (ev.tz - ev.z) * 0.01; } break;
        case 'grab': {
          fx.number(ev.x, 2.6, ev.z, 'GRAB!', 'word');
          fx.shockwave(ev.x, ev.z, 2.6, TEAM_COLORS[ev.team] || 0xffffff);
          fx.dustCloud(ev.x, ev.z, 2.4);
          fx.addShake(0.08);
          const victim = ev.victim ? this.entries.get(ev.victim) : null;
          if (victim) victim.flash = 0.12;
          break;
        }
        case 'convert': {
          const ve = this.entries.get(ev.id);
          if (ve) {
            ve.team = ev.team;
            ve.m.body.material = teamMat(ev.team);
            ve.flash = 0.18;
          }
          fx.number(ev.x, 2.8, ev.z, ev.flip ? 'FUSE FLIP!' : 'CONVERTED!', 'word');
          fx.shockwave(ev.x, ev.z, 4, TEAM_COLORS[ev.team]);
          fx.shockwave(ev.x, ev.z, 2.2, 0xffffff);
          fx.addShake(0.12);
          break;
        }
        case 'retreat': fx.number(ev.x, 2.4, ev.z, 'RETREAT!', 'weak'); break;
        case 'fortHit': {
          const f = this.board.forts[ev.team];
          f.hit = 0.25;
          if (ev.team === this.localTeam) fx.addShake(0.12);
          break;
        }
        case 'spawn': if (e) e.spawnT = 0.35; break;
        case 'charge': fx.number(ev.x, 3, ev.z, 'CHARGE!', 'weak'); fx.puff(ev.x, ev.z); if (e) e.leanX -= 1.5; break;
        case 'backstab': fx.number(ev.x, 2.9, ev.z, 'BACKSTAB!', 'crit'); break;
        case 'enrage': fx.shockwave(ev.x, ev.z, 7, 0xff4d5e); fx.addShake(0.8); fx.number(ev.x, 4.5, ev.z, 'ENRAGED!', 'crit'); if (e) e.enraged = true; break;
        case 'promote': {
          if (e) { e.rank = ev.rank; e.name = ev.name || ''; }
          const label = ev.rank >= 3 && ev.name ? `${ev.name} ★★★` : `RANK ${ev.rank}!`;
          fx.number(ev.x, 3.2, ev.z, label, 'crit');
          fx.shockwave(ev.x, ev.z, 2.4, 0xd4a73a);
          break;
        }
        case 'rally': {
          const r = this.rally[ev.team];
          if (r) r.pulse = 0.5;
          if (ev.recovered) {
            const color = TEAM_COLORS[ev.team] ?? 0xffffff;
            fx.shockwave(ev.x, ev.z, 7, color);
            fx.number(ev.x, 4.2, ev.z, 'RALLY!', 'word');
          }
          break;
        }
        case 'rout': {
          fx.shockwave(ev.x, ev.z, 6, 0xffffff);
          fx.number(ev.x, 4.2, ev.z, 'ROUT!', 'weak');
          break;
        }
        case 'warhorn': fx.shockwave(ev.x, ev.z, 12, 0xffd23f); fx.number(ev.x, 3.4, ev.z, 'WAR HORN!', 'word'); fx.addShake(0.3); break;
        case 'repair': fx.number(ev.x, 3.2, ev.z, `+${ev.amount} FORT`, 'word'); fx.shockwave(ev.x, ev.z, 6, 0x5ee06a); break;
        case 'trap': fx.puff(ev.x, ev.z); break;
        default: break;
      }
    }
  }

  /** Render-rate update: interpolate, animate and run fx. alpha ∈ [0,1) between ticks. */
  frame(st, alpha, dt) {
    this.time += dt;
    const t = this.time;
    const hg = st && st.highGround;
    const groundY = (x, z) => {
      if (hg) for (const r of hg) if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.h / 2) return 0.74;
      return 0;
    };
    for (const [, e] of this.entries) {
      const root = e.m.root;
      const x = lerp(e.px, e.x, alpha), z = lerp(e.pz, e.z, alpha);
      e.y = lerp(e.y ?? 0, groundY(x, z), Math.min(1, dt * 8));
      const sp = Math.hypot(e.vx || 0, e.vz || 0);
      if (sp > 0.3) {
        const want = Math.atan2(-(e.vz || 0), e.vx || 0);
        let d = want - e.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        e.yaw += d * Math.min(1, dt * 10);
      }
      root.position.set(x, 0, z);
      root.rotation.y = e.yaw;
      const tilt = e.m.tilt;
      if (e.carried) {
        root.position.y = 1.5 + e.y;
        const struggle = Math.sin(t * 16 + e.x * 2.3);
        e.struggle = struggle;
        tilt.rotation.x = Math.sin(t * 14 + e.x) * 0.5 + struggle * 0.12;
        tilt.rotation.z = Math.PI * 0.45 + Math.sin(t * 12 + e.z) * 0.18;
      } else {
        e.struggle = 0;
        const bob = sp > 0.5 ? Math.abs(Math.sin(t * (8 + sp))) * 0.14 : 0;
        root.position.y = e.y + bob;
        e.leanX *= Math.max(0, 1 - dt * 6); e.leanZ *= Math.max(0, 1 - dt * 6);
        tilt.rotation.z = (sp > 0.5 ? Math.sin(t * (8 + sp)) * 0.12 : 0) - e.leanX * 0.5;
        tilt.rotation.x = e.leanZ * 0.5;
      }
      // squash on spawn, flash on hit, struggle squash while carried
      if (e.spawnT > 0) { e.spawnT -= dt; const p = 1 - Math.max(0, e.spawnT) / 0.35; tilt.scale.set(1 + (1 - p) * 0.4, p, 1 + (1 - p) * 0.4); }
      else if (e.carried) { const s = e.struggle || 0; tilt.scale.set(1 + s * 0.07, 1 - s * 0.09, 1 + s * 0.07); }
      else tilt.scale.set(1, 1, 1);
      if (e.flash > 0) { e.flash -= dt; e.m.body.material = flashMat(); tilt.scale.multiplyScalar(1.12); }
      else if (e.m.body.material !== teamMat(e.team)) e.m.body.material = teamMat(e.team);
      if (e.m.spark) e.m.spark.scale.setScalar(0.7 + Math.abs(Math.sin(t * 30 + e.x)) * 0.8);
      if (e.type === 'boss') {
        const back = tilt.getObjectByName('backGear');
        if (back) back.rotation.y += dt * (e.enraged ? 9 : 3);
        if (e.enraged) tilt.scale.multiplyScalar(1 + Math.abs(Math.sin(t * 10)) * 0.06);
        if (e.m.gear) e.m.gear.rotation.y += dt * 1.5;
      }
      // veteran rank pips (1–3 gold dots above the body)
      if (e.m.rank) {
        const rk = Math.max(0, Math.min(3, e.rank || 0));
        e.m.rank.visible = rk > 0;
        for (let i = 0; i < e.m.rank.children.length; i++) e.m.rank.children[i].visible = i < rk;
        if (rk > 0) e.m.rank.scale.setScalar(1 + Math.sin(t * 4 + e.x) * 0.06);
      }
      // retreat/rout flag: a little white plastic flag on a dowel
      if ((e.retreat || e.rout) && !e.flag) {
        const f = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4), sharedMats().wood);
        pole.position.y = 0.45;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), sharedMats().retreat);
        cloth.position.set(0.22, 0.75, 0);
        f.add(pole, cloth);
        f.position.set(-0.3, e.m.height + 0.1, 0);
        tilt.add(f);
        e.flag = f;
      } else if (!e.retreat && !e.rout && e.flag) { tilt.remove(e.flag); e.flag = null; }
      if (e.flag) e.flag.rotation.y = Math.sin(t * 9) * 0.4;
    }
    this._syncTethers(st, null, false);
    this._updateTethers(t);
    for (const [sh, m] of this.shells) {
      const p = Math.min(1, (sh.t + alpha) / sh.T);
      const dx = sh.x1 - sh.x0, dz = sh.z1 - sh.z0;
      const d = Math.hypot(dx, dz);
      const h = 1.5 + d * 0.22;
      m.position.set(sh.x0 + dx * p, 1 + h * 4 * p * (1 - p), sh.z0 + dz * p);
      const vy = h * 4 * (1 - 2 * p);
      m.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(vy, d || 1));
    }
    for (const team of ['blue', 'red']) {
      const r = this.rally[team];
      r.pulse = Math.max(0, (r.pulse || 0) - dt);
      r.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08 + r.pulse * 2);
      r.flag.rotation.y = Math.sin(t * 3) * 0.3;
    }
    for (const team of ['blue', 'red']) {
      const f = this.board.forts[team];
      f.gear.rotation.y += dt * (team === 'blue' ? 0.6 : -0.6);
      f.hit = Math.max(0, (f.hit || 0) - dt);
      f.group.scale.set(1 + f.hit * 0.25, 1 - f.hit * 0.2, 1 + f.hit * 0.25);
      const fort = st && st.forts[team];
      f.group.visible = !fort || fort.hp > 0 || fort.invulnerable;
      f.flag.rotation.y = Math.sin(t * 2 + (team === 'red' ? 1 : 0)) * 0.4;
    }
    this.fx.update(dt);
  }

  dispose() {
    this.reset();
    for (const t of this._tetherPool) t.geo.dispose();
    this._tetherPool.length = 0;
    for (const m of Object.values(this._tetherMats)) m.dispose();
    this.fx.dispose();
    this.scene.remove(this.group);
  }
}
