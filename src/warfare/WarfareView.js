// WarfareView.js — draws a warfare battle state with three.js. Reads the sim, never writes it.
// Interpolates unit positions between 30 Hz sim ticks, swaps team plastic on conversion, and
// turns sim events into juice via WarfareFx.
import * as THREE from 'three';
import { counterMult } from '../sim/warfareUnits.js';
import { buildBoard } from './WarfareBoard.js';
import { buildUnit, buildShell, buildRing, teamMat, flashMat, TEAM_COLORS, sharedMats } from './WarfareModels.js';
import { WarfareFx } from './WarfareFx.js';

const lerp = (a, b, t) => a + (b - a) * t;

export class WarfareView {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.name = 'warfare';
    scene.add(this.group);
    this.board = buildBoard();
    this.group.add(this.board.group);
    this.dyn = new THREE.Group();
    this.group.add(this.dyn);
    this.fx = new WarfareFx(this.group, camera);
    this.entries = new Map();   // unit id → entry
    this.shells = new Map();    // shell obj → mesh
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

  reset() {
    for (const e of this.entries.values()) this.dyn.remove(e.m.root);
    this.entries.clear();
    for (const m of this.shells.values()) this.dyn.remove(m);
    this.shells.clear();
    this.fx.clear();
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
        e = { m, px: u.x, pz: u.z, x: u.x, z: u.z, team: u.team, yaw: u.team === 'blue' ? 0 : Math.PI, flash: 0, leanX: 0, leanZ: 0, spawnT: 0, type: u.type, flag: null };
        this.entries.set(u.id, e);
      }
      e.px = e.x; e.pz = e.z;
      e.x = u.x; e.z = u.z;
      e.vx = u.vx; e.vz = u.vz;
      e.carried = !!u.carriedBy;
      e.carrying = !!u.carrying;
      e.retreat = u.state === 'retreat';
      e.hpFrac = u.hp / u.maxHp;
      if (e.team !== u.team) {
        e.team = u.team;
        e.m.body.material = teamMat(u.team);
      }
    }
    this._events(st.events);
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) { this.dyn.remove(e.m.root); this.entries.delete(id); }
    }
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
    for (const team of ['blue', 'red']) {
      const r = st.rally[team];
      const show = team === this.localTeam || st.mode === 'versus';
      this.rally[team].g.visible = show && !!r && !(st.mode === 'defense' && team === 'red');
      if (r) this.rally[team].g.position.set(r.x, 0.05, r.z);
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
            root.position.set(e.x, 0, e.z);
            e.m.body.material = teamMat(e.team);
            fx.deathPop(root, e.team, ev.kx, ev.kz, ev.unit === 'boss' || ev.unit === 'brute');
            if (ev.unit === 'boss') { fx.addShake(1.2); fx.explosion(e.x, e.z, 6, true); }
          }
          break;
        }
        case 'explode': fx.explosion(ev.x, ev.z, ev.r, !!ev.big); break;
        case 'slam': fx.shockwave(ev.x, ev.z, ev.r * 1.3, 0xd4a73a); fx.addShake(ev.unit === 'boss' ? 0.7 : 0.25); fx.puff(ev.x, ev.z); break;
        case 'fire': if (e) { fx.puff(ev.x, ev.z); fx.muzzle(ev.x, ev.z); e.leanX -= (ev.tx - ev.x) * 0.01; e.leanZ -= (ev.tz - ev.z) * 0.01; } break;
        case 'grab': fx.number(ev.x, 2.6, ev.z, 'GRAB!', 'word'); break;
        case 'convert': fx.number(ev.x, 2.8, ev.z, ev.flip ? 'FUSE FLIP!' : 'CONVERTED!', 'word'); fx.shockwave(ev.x, ev.z, 3, TEAM_COLORS[ev.team]); break;
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
        case 'rally': this.rally[ev.team].pulse = 0.5; break;
        default: break;
      }
    }
  }

  /** Render-rate update: interpolate, animate and run fx. alpha ∈ [0,1) between ticks. */
  frame(st, alpha, dt) {
    this.time += dt;
    const t = this.time;
    for (const [, e] of this.entries) {
      const root = e.m.root;
      const x = lerp(e.px, e.x, alpha), z = lerp(e.pz, e.z, alpha);
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
        root.position.y = 1.5;
        tilt.rotation.x = Math.sin(t * 14 + e.x) * 0.5;
        tilt.rotation.z = Math.PI * 0.45;
      } else {
        const bob = sp > 0.5 ? Math.abs(Math.sin(t * (8 + sp))) * 0.14 : 0;
        root.position.y = bob;
        e.leanX *= Math.max(0, 1 - dt * 6); e.leanZ *= Math.max(0, 1 - dt * 6);
        tilt.rotation.z = (sp > 0.5 ? Math.sin(t * (8 + sp)) * 0.12 : 0) - e.leanX * 0.5;
        tilt.rotation.x = e.leanZ * 0.5;
      }
      // squash on spawn, flash on hit
      if (e.spawnT > 0) { e.spawnT -= dt; const p = 1 - Math.max(0, e.spawnT) / 0.35; tilt.scale.set(1 + (1 - p) * 0.4, p, 1 + (1 - p) * 0.4); }
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
      // retreat flag: a little white plastic flag on a dowel
      if (e.retreat && !e.flag) {
        const f = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4), sharedMats().wood);
        pole.position.y = 0.45;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), sharedMats().retreat);
        cloth.position.set(0.22, 0.75, 0);
        f.add(pole, cloth);
        f.position.set(-0.3, e.m.height + 0.1, 0);
        tilt.add(f);
        e.flag = f;
      } else if (!e.retreat && e.flag) { tilt.remove(e.flag); e.flag = null; }
      if (e.flag) e.flag.rotation.y = Math.sin(t * 9) * 0.4;
    }
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
    this.fx.dispose();
    this.scene.remove(this.group);
  }
}
