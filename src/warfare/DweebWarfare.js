// DweebWarfare.js — Game 5 controller. Owns the deterministic battle (src/sim/warfareBattle.js),
// steps it at a fixed 30 Hz, feeds local commands in, and drives the view, HUD, audio and camera.
//
//   title  → attract battle (AI vs AI) behind the start screen with tutorial hints
//   playing→ defense (waves, boss every 5, win after FINAL_WAVE) or versus AI
//   paused / over → pause menu, win/lose screen with stats and restart
import * as THREE from 'three';
import { createBattle, stepBattle, WF_DT, FIELD } from '../sim/warfareBattle.js';
import { commanderDecide } from '../sim/warfareAI.js';
import { RECRUITABLE, UNIT_TYPES, COUNTER_OF } from '../sim/warfareUnits.js';
import { FINAL_WAVE } from '../sim/warfareWaves.js';
import { WarfareView } from './WarfareView.js';
import { WarfareHud } from './WarfareHud.js';
import { WarfareAudio } from './WarfareAudio.js';

export { RECRUITABLE as UNIT_ROLES };

const ENEMY_HINTS = {
  rocket: 'Enemy <b>rockets</b> lob splash shells. Walk <b>shields</b> into them.',
  stealer: 'Enemy <b>stealers</b> kidnap your dweebs! <b>Rockets</b> shred them in the open.',
  kami: '<b>Kamis</b> blow up shield walls. <b>Stealers</b> flip their fuses.',
  sneak: '<b>Sneaks</b> flank around your line to knife rockets. Keep <b>shields</b> near your gunners.',
  brute: '<b>Brutes</b> are too heavy to steal. Swarm them with <b>kamis</b>.',
  boss: 'The <b>Brass Bully</b> is here! Kamis deal bonus damage. Keep shields spread out.',
};

export class DweebWarfare {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Camera} o.camera
   * @param {HTMLCanvasElement} o.canvas
   * @param {() => void} [o.onExit] leave Warfare (back to the mall)
   */
  constructor({ scene, camera, canvas, onExit, soundOn = true } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.onExit = onExit;
    this.view = new WarfareView(scene, camera);
    this.hud = new WarfareHud({ onAction: a => this._action(a), onRecruit: u => this.recruit(u) });
    this.hud.setModeButtons({ online: false });
    this.team = 'blue';
    this.mode = 'defense';
    this.phase = 'title';
    this.pending = [];
    this.acc = 0;
    this.seen = new Set();
    this.cam = { x: 0, z: 2, dist: 52, tx: 0, tz: 2, tdist: 52 };
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this.audio = new WarfareAudio({ enabled: soundOn });
    this.hud.setMute(this.audio.muted);
    this._wire();
    document.body.classList.add('warfare-active');
    this._startAttract();
    if (/[?&]wfdebug\b/.test(location.search)) window.__wf = this;
  }

  // Legacy surface main.js used before the rewrite
  get gameOver() { return this.phase === 'over'; }
  get blueCount() { return this.st ? this.st.units.filter(u => u.team === 'blue').length : 0; }
  get redCount() { return this.st ? this.st.units.filter(u => u.team === 'red').length : 0; }
  get terrainMesh() { return this.view.pickMesh; }
  setRallyPoint(x, z) { this.pending.push({ type: 'rally', team: this.team, x, z }); }

  _startAttract() {
    this.phase = 'title';
    this.st = createBattle({ seed: (Date.now() & 0xffff) + 1, mode: 'versus' });
    this.attract = true;
    this.view.reset();
    this.view.localTeam = this.team;
    this.hud.refreshBest();
    this.hud.screen('title');
    this.cam.tx = 0; this.cam.tz = 2; this.cam.tdist = 56;
  }

  start(mode = 'defense') {
    this.mode = mode;
    this.attract = false;
    this.team = 'blue';
    this.st = createBattle({ seed: (Date.now() & 0x7fffffff) | 1, mode });
    this.pending = [];
    this.seen = new Set();
    this.acc = 0;
    this.endTimer = 0;
    this.view.reset();
    this.view.localTeam = this.team;
    this.phase = 'playing';
    this.hud.last = {};
    this.hud.screen('game');
    this.cam.tx = -16; this.cam.tz = 3; this.cam.tdist = 40;
    this.audio?.unlock();
    if (mode === 'defense') {
      this.hud.banner('DEFEND THE FORT', `Survive ${FINAL_WAVE} waves · boss every 5`, '', 2.6);
      this.hud.toast('Click the board to move your <b>rally flag</b>. Press <b>1–4</b> to recruit.', 8);
    } else {
      this.hud.banner('VERSUS', 'Smash the red fort before they smash yours', '', 2.6);
      this.hud.toast('The AI buys counters to your army. Mix it up!', 8);
    }
  }

  recruit(type) {
    if (this.phase !== 'playing' || !RECRUITABLE.includes(type)) return;
    if (this.st.coins[this.team] < UNIT_TYPES[type].cost) { this.audio?.deny(); this.hud.toast(`Need 🪙 ${UNIT_TYPES[type].cost} for a ${UNIT_TYPES[type].name}`, 2.5); return; }
    this.pending.push({ type: 'recruit', team: this.team, unit: type });
  }

  _action(a) {
    this.audio?.unlock();
    this.audio?.click();
    if (a === 'defense' || a === 'versus') this.start(a);
    else if (a === 'startWave') this.pending.push({ type: 'startWave' });
    else if (a === 'pause') this.setPaused(true);
    else if (a === 'resume') this.setPaused(false);
    else if (a === 'restart') this.start(this.mode);
    else if (a === 'quit') this._startAttract();
    else if (a === 'exit') this.onExit?.();
    else if (a === 'mute') this.toggleMute();
    else if (a === 'online-coop' || a === 'online-versus') this.hud.toast('Online Warfare needs the dweebs server.', 3);
  }

  toggleMute() {
    if (!this.audio) return;
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    this.hud.setMute(this.audio.muted);
  }

  setPaused(on) {
    if (on && this.phase === 'playing') { this.phase = 'paused'; this.hud.screen('pause'); }
    else if (!on && this.phase === 'paused') { this.phase = 'playing'; this.hud.screen('game'); this.acc = 0; }
  }

  _wire() {
    this._onKey = e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (e.type === 'keyup') { this.keys.delete(k); return; }
      this.keys.add(k);
      if (k === 'escape') { if (this.phase === 'playing') this.setPaused(true); else if (this.phase === 'paused') this.setPaused(false); e.preventDefault(); return; }
      if (k === 'm') { this.toggleMute(); return; }
      if (this.phase !== 'playing') return;
      const n = '1234'.indexOf(e.key);
      if (n >= 0) { this.recruit(RECRUITABLE[n]); e.preventDefault(); }
      else if (k === ' ') { this.pending.push({ type: 'startWave' }); e.preventDefault(); }
    };
    this._onPointer = e => {
      if (this.phase !== 'playing' || e.button !== 0) return;
      const p = this._pick(e.clientX, e.clientY);
      if (p) { this.setRallyPoint(p.x, p.z); this.audio?.click(); }
    };
    this._onWheel = e => {
      if (this.phase === 'title') return;
      this.cam.tdist = Math.max(22, Math.min(70, this.cam.tdist + Math.sign(e.deltaY) * 3));
      e.preventDefault();
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    this.canvas?.addEventListener('pointerdown', this._onPointer);
    this.canvas?.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _pick(cx, cy) {
    this._ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.view.pickMesh)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  _stepOnce() {
    const st = this.st;
    let cmds;
    if (this.attract) cmds = [...commanderDecide(st, 'blue'), ...commanderDecide(st, 'red')];
    else {
      cmds = this.pending.splice(0);
      if (st.mode === 'versus') cmds.push(...commanderDecide(st, 'red'));
    }
    stepBattle(st, cmds);
    this.view.afterStep(st);
    if (!this.attract) this._react(st.events);
    if (!this.attract && this.audio) { this.audio.listenerX = this.cam.x; this.audio.events(st.events, this.team); }
  }

  _react(events) {
    const hud = this.hud, st = this.st;
    for (const ev of events) {
      if (ev.type === 'waveStart') {
        hud.banner(ev.boss ? 'BOSS WAVE!' : `WAVE ${ev.wave}`, ev.boss ? 'The Brass Bully rolls in' : `${ev.count} enemies incoming`, ev.boss ? 'boss' : '');
      } else if (ev.type === 'waveClear') {
        hud.banner('WAVE CLEARED', `+🪙 ${ev.reward} · your army patches up`, 'good');
      } else if (ev.type === 'spawn' && ev.team !== this.team && !this.seen.has(ev.unit)) {
        this.seen.add(ev.unit);
        if (ENEMY_HINTS[ev.unit] && (st.wave > 1 || ev.unit !== 'shield')) hud.toast(ENEMY_HINTS[ev.unit], 7);
      } else if (ev.type === 'recruit' && ev.team === this.team) {
        hud.pop(ev.unit);
      } else if (ev.type === 'convert' && ev.from === this.team && !this.seen.has('lostConvert')) {
        this.seen.add('lostConvert');
        hud.toast('One of yours got <b>kidnapped</b>! Protect your line with <b>rockets</b>.', 6);
      } else if (ev.type === 'fortHit' && ev.team === this.team && st.forts[this.team].hp < st.forts[this.team].maxHp * 0.35 && !this.seen.has('lowFort')) {
        this.seen.add('lowFort');
        hud.toast('Your fort is <b>cracking</b>! Pull the rally flag back home.', 6);
      } else if (ev.type === 'enrage' && ev.team !== this.team) {
        hud.banner('ENRAGED!', 'The Brass Bully calls in kamis', 'boss', 1.8);
      } else if (ev.type === 'charge' && ev.team !== this.team && !this.seen.has('charge')) {
        this.seen.add('charge');
        hud.toast('Brutes <b>charge</b> from mid range. Spread out or bait them with a shield.', 6);
      } else if (ev.type === 'backstab' && ev.team !== this.team && !this.seen.has('backstab')) {
        this.seen.add('backstab');
        hud.toast('<b>Backstab!</b> Sneaks hit units that are busy fighting. Guard your flanks.', 6);
      } else if (ev.type === 'win' || ev.type === 'lose') {
        this.endTimer = 1.6;
      }
    }
  }

  _end() {
    const st = this.st, s = st.stats[this.team];
    const won = st.winner === this.team;
    this.phase = 'over';
    if (this.mode === 'defense') {
      const reached = won ? FINAL_WAVE : st.wave;
      const best = +localStorage.getItem('dweebs-warfare-best') || 0;
      if (reached > best) localStorage.setItem('dweebs-warfare-best', String(reached));
    }
    const secs = Math.round(st.tick * WF_DT);
    const time = `${(secs / 60) | 0}:${String(secs % 60).padStart(2, '0')}`;
    const sub = this.mode === 'defense'
      ? (won ? `The fort held through all ${FINAL_WAVE} waves!` : `The fort fell on wave ${st.wave}.`)
      : (won ? 'The red fort is rubble.' : 'Your fort got flattened.');
    this.hud.showEnd({
      won, sub,
      stats: [
        [this.mode === 'defense' ? 'waves cleared' : 'time', this.mode === 'defense' ? `${st.stats.wavesCleared}/${FINAL_WAVE}` : time],
        ['enemies popped', s.kills],
        ['dweebs lost', s.lost],
        ['kidnapped & converted', s.converted],
        ['coins earned', s.coinsEarned],
        ['damage dealt', Math.round(s.dmgDealt)],
      ],
    });
    this.audio?.[won ? 'win' : 'lose']();
  }

  update(rawDt) {
    const dt = Math.min(rawDt, 0.1);
    if (this.phase === 'playing' || this.phase === 'title') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= WF_DT && n < 5) { this.acc -= WF_DT; this._stepOnce(); n++; }
      if (n === 5) this.acc = 0;
      if (this.attract && this.st.winner) this.st = createBattle({ seed: (this.st.seed * 7 + 3) & 0xffff, mode: 'versus' });
    }
    if (this.endTimer > 0 && this.phase === 'playing') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this._end();
    }
    const alpha = this.phase === 'playing' || this.phase === 'title' ? this.acc / WF_DT : 1;
    this.view.frame(this.st, alpha, this.phase === 'paused' ? 0 : dt);
    if (this.phase !== 'title') this.hud.update(this.st, this.team, dt);
    this._camera(dt);
  }

  _camera(dt) {
    const c = this.cam;
    if (this.phase === 'playing' || this.phase === 'paused') {
      const pan = 26 * dt * (c.dist / 46);
      if (this.keys.has('a') || this.keys.has('arrowleft')) c.tx -= pan;
      if (this.keys.has('d') || this.keys.has('arrowright')) c.tx += pan;
      if (this.keys.has('w') || this.keys.has('arrowup')) c.tz -= pan;
      if (this.keys.has('s') || this.keys.has('arrowdown')) c.tz += pan;
      c.tx = Math.max(-FIELD.halfX, Math.min(FIELD.halfX, c.tx));
      c.tz = Math.max(-FIELD.halfZ, Math.min(FIELD.halfZ, c.tz));
    } else if (this.phase === 'title') {
      c.tx = Math.sin(this.view.time * 0.12) * 14;
    }
    const k = Math.min(1, dt * 5);
    c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.dist += (c.tdist - c.dist) * k;
    const pitch = 0.98;
    const kick = this.view.fx.kick || 0;
    const sh = this.view.fx.shake;
    const jx = (Math.random() - 0.5) * sh, jy = (Math.random() - 0.5) * sh, jz = (Math.random() - 0.5) * sh;
    const dist = c.dist - kick * 3;
    this.camera.position.set(c.x + jx, Math.sin(pitch) * dist + jy, c.z + Math.cos(pitch) * dist + jz);
    this.camera.lookAt(c.x + jx * 0.5, 0, c.z + jz * 0.5);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
    this.canvas?.removeEventListener('pointerdown', this._onPointer);
    this.canvas?.removeEventListener('wheel', this._onWheel);
    this.audio?.dispose?.();
    this.view.dispose();
    this.hud.dispose();
    document.body.classList.remove('warfare-active');
  }
}

export { COUNTER_OF };
