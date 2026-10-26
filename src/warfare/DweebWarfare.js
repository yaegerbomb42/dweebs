// DweebWarfare.js — Game 5 controller. Owns the deterministic battle (src/sim/warfareBattle.js),
// steps it at a fixed 30 Hz, feeds local commands in, and drives the view, HUD, audio and camera.
//
//   title  → attract battle (AI vs AI) behind the start screen with tutorial hints
//   playing→ defense (waves, boss every 5, win after FINAL_WAVE) or versus AI
//   paused / over → pause menu, win/lose screen with stats and restart
import * as THREE from 'three';
import { createBattle, stepBattle, battleHash, WF_DT, FIELD } from '../sim/warfareBattle.js';
import { commanderDecide } from '../sim/warfareAI.js';
import { RECRUITABLE, UNIT_TYPES, COUNTER_OF } from '../sim/warfareUnits.js';
import { FINAL_WAVE } from '../sim/warfareWaves.js';
import { WarfareView } from './WarfareView.js';
import { WarfareHud } from './WarfareHud.js';
import { WarfareAudio } from './WarfareAudio.js';
import { WarfareNet } from './WarfareNet.js';

export { RECRUITABLE as UNIT_ROLES };

const ENEMY_HINTS = {
  rocket: 'Enemy <b>rockets</b> lob splash shells. Walk <b>shields</b> into them.',
  stealer: 'Enemy <b>stealers</b> kidnap your dweebs! <b>Rockets</b> shred them in the open.',
  kami: '<b>Kamis</b> blow up shield walls. <b>Stealers</b> flip their fuses.',
  sneak: '<b>Sneaks</b> flank around your line to knife rockets. Keep <b>shields</b> near your gunners.',
  brute: '<b>Brutes</b> are too heavy to steal. Swarm them with <b>kamis</b>.',
  boss: 'The <b>Brass Bully</b> is here! Kamis deal bonus damage. Keep shields spread out.',
};

const NAME_A = ['Captain', 'General', 'Major', 'Sergeant', 'Admiral', 'Corporal'];
const NAME_B = ['Dowel', 'Gizmo', 'Sprocket', 'Noodle', 'Widget', 'Pickle', 'Bolt', 'Waffle'];
/** A goofy commander name, picked once per browser so a friend sees the same one each match. */
function commanderName() {
  try {
    let n = localStorage.getItem('dweebs-warfare-name');
    if (!n) {
      n = `${NAME_A[Math.floor(Math.random() * NAME_A.length)]} ${NAME_B[Math.floor(Math.random() * NAME_B.length)]}`;
      localStorage.setItem('dweebs-warfare-name', n);
    }
    return n;
  } catch { return 'Dweeb'; }
}

export class DweebWarfare {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Camera} o.camera
   * @param {HTMLCanvasElement} o.canvas
   * @param {() => void} [o.onExit] leave Warfare (back to the mall)
   */
  constructor({ scene, camera, canvas, onExit, soundOn = true, serverUrl = '' } = {}) {
    this.serverUrl = serverUrl;
    this.net = null;
    this.online = null;
    this.outbox = [];
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.onExit = onExit;
    this.view = new WarfareView(scene, camera);
    this.hud = new WarfareHud({ onAction: a => this._action(a), onRecruit: u => this.recruit(u) });
    this.hud.setModeButtons({ online: !!serverUrl });
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
  setRallyPoint(x, z) { this._cmd({ type: 'rally', team: this.team, x, z }); }

  /** Local command: straight into the sim offline, to the server (lockstep) online. */
  _cmd(c) { (this.online ? this.outbox : this.pending).push(c); }

  _startAttract() {
    this.phase = 'title';
    this.overlay = false;
    this.st = createBattle({ seed: (Date.now() & 0xffff) + 1, mode: 'versus' });
    this.attract = true;
    this.view.reset();
    this.view.localTeam = this.team;
    this.hud.refreshBest();
    this.hud.screen('title');
    this.cam.tx = 0; this.cam.tz = 2; this.cam.tdist = 56;
  }

  start(mode = 'defense') {
    this._leaveOnline();
    this._begin(mode, (Date.now() & 0x7fffffff) | 1, 'blue');
    if (mode === 'defense') {
      this.hud.banner('DEFEND THE FORT', `Survive ${FINAL_WAVE} waves · boss every 5`, '', 2.6);
      this.hud.toast('Click the board to move your <b>rally flag</b>. Press <b>1–4</b> to recruit.', 8);
    } else {
      this.hud.banner('VERSUS', 'Smash the red fort before they smash yours', '', 2.6);
      this.hud.toast('The AI buys counters to your army. Mix it up!', 8);
    }
  }

  _begin(mode, seed, team) {
    this.mode = mode;
    this.attract = false;
    this.team = team;
    this.st = createBattle({ seed, mode });
    this.pending = [];
    this.outbox = [];
    this.seen = new Set();
    this.acc = 0;
    this.endTimer = 0;
    this.overlay = false;
    this.view.reset();
    this.view.localTeam = team;
    this.phase = 'playing';
    this.hud.last = {};
    this.hud.screen('game');
    const side = team === 'blue' ? -1 : 1;
    this.cam.tx = 16 * side; this.cam.tz = 3; this.cam.tdist = 40;
    this.audio?.unlock();
  }

  // ── online (lockstep over the dweebs-server WebSocket) ──

  async _goOnline(kind, code = '') {
    this.onlineKind = kind;
    this.hud.screen('online');
    this.hud.onlineStatus({ title: kind === 'coop' ? 'ONLINE CO-OP' : 'ONLINE VERSUS', status: 'Connecting to the dweebs server…', code: '' });
    if (!this.net) {
      const net = new WarfareNet(this.serverUrl);
      try { await net.connect(); } catch (e) {
        this.hud.onlineStatus({ status: `Can't reach the dweebs server (${e.message}). Solo modes still work offline.` });
        return;
      }
      this.net = net;
      this._wireNet(net);
    }
    this.hud.onlineStatus({ status: code ? `Joining ${code}…` : (kind === 'coop' ? 'Looking for a co-op partner…' : 'Looking for an opponent…') });
    this.net.queue(kind, { code, name: commanderName() });
  }

  _wireNet(net) {
    net.on('queued', m => this.hud.onlineStatus({ status: m.mode === 'coop' ? 'Waiting for a co-op partner…' : 'Waiting for an opponent…', code: m.code }))
      .on('start', m => this._startOnline(m))
      .on('error', m => { if (this.phase === 'playing') this.hud.toast(m.message, 4); else this.hud.onlineStatus({ status: m.message }); })
      .on('desync', () => this.hud.toast('<b>Desync</b> detected: the two battles drifted apart. Finish this one for fun!', 8))
      .on('peerLeft', () => this._peerLeft())
      .on('close', () => {
        this.net = null;
        if (this.online && this.phase === 'playing') this._forfeitEnd(false, 'Lost the connection to the server.');
        this.online = null;
        this.hud.setNet('');
      });
  }

  _startOnline(m) {
    const mode = m.mode === 'versus' ? 'versus' : 'defense';
    this.online = { kind: m.mode, partner: m.partner, turnTicks: m.turnTicks, stallT: 0 };
    this._begin(mode, m.seed, m.team);
    this.hud.setNet(`ONLINE · ${m.mode === 'coop' ? 'co-op with' : 'vs'} ${m.partner}`);
    if (mode === 'defense') {
      this.hud.banner('ONLINE CO-OP', `Hold the fort together · shared coins & rally flag`, '', 2.6);
      this.hud.toast('Both of you command the blue army. Talk it out: who buys what?', 8);
    } else {
      this.hud.banner('ONLINE VERSUS', `You are ${m.team.toUpperCase()} · smash the other fort`, '', 2.6);
      this.hud.toast(`You command the <b>${m.team}</b> army. Your fort is on the ${m.team === 'blue' ? 'left' : 'right'}.`, 8);
    }
  }

  _peerLeft() {
    if (!this.online || this.st.winner) return;
    if (this.online.kind === 'versus' && this.phase === 'playing') this._forfeitEnd(true, 'Your opponent left. Win by forfeit!');
    else if (this.phase === 'playing') { this.hud.toast('Your partner left. Holding the fort solo!', 6); this.hud.setNet('ONLINE · solo'); }
  }

  _forfeitEnd(won, sub) {
    const s = this.st.stats[this.team];
    this.phase = 'over';
    this.hud.showEnd({ won, title: won ? 'VICTORY!' : 'DISCONNECTED', sub, stats: [['enemies popped', s.kills], ['dweebs lost', s.lost], ['kidnapped & converted', s.converted], ['coins earned', s.coinsEarned], ['damage dealt', Math.round(s.dmgDealt)], ['time', `${Math.round(this.st.tick * WF_DT)}s`]] });
    if (won) this.audio?.win();
    this._leaveOnline();
  }

  _leaveOnline() {
    if (this.net) { if (this.st?.winner) this.net.over(); else this.net.leave(); this.net.close(); }
    this.net = null;
    this.online = null;
    this.hud.setNet('');
  }

  _updateOnline(dt) {
    if (this.outbox.length) { this.net?.sendCmds(this.outbox); this.outbox = []; }
    if (this.phase !== 'playing' || !this.net) return;
    const TT = this.online.turnTicks;
    this.acc += dt;
    const maxSteps = this.net.buffered > 3 ? 12 : 4;
    let n = 0, stalled = false;
    while (this.acc >= WF_DT && n < maxSteps && !this.st.winner) {
      let cmds = [];
      if (this.st.tick % TT === 0) {
        const c = this.net.takeTurn(this.st.tick / TT);
        if (c === null) { stalled = true; break; }
        cmds = c;
      }
      this._stepWith(cmds);
      if (this.st.tick % (TT * 30) === 0) this.net.sendHash(this.st.tick / TT, battleHash(this.st));
      this.acc -= WF_DT;
      n++;
    }
    if (stalled) { this.acc = Math.min(this.acc, WF_DT); this.online.stallT += dt; } else this.online.stallT = 0;
    const waiting = this.online.stallT > 1;
    if (waiting !== this.online.waiting) {
      this.online.waiting = waiting;
      this.hud.setNet(waiting ? 'ONLINE · waiting for partner…' : `ONLINE · ${this.online.kind === 'coop' ? 'co-op with' : 'vs'} ${this.online.partner}`);
    }
  }

  _stepWith(cmds) {
    const st = this.st;
    stepBattle(st, cmds);
    this.view.afterStep(st);
    this._react(st.events);
    if (this.audio) { this.audio.listenerX = this.cam.x; this.audio.events(st.events, this.team); }
  }

  recruit(type) {
    if (this.phase !== 'playing' || !RECRUITABLE.includes(type)) return;
    if (this.st.coins[this.team] < UNIT_TYPES[type].cost) { this.audio?.deny(); this.hud.toast(`Need 🪙 ${UNIT_TYPES[type].cost} for a ${UNIT_TYPES[type].name}`, 2.5); return; }
    this._cmd({ type: 'recruit', team: this.team, unit: type });
  }

  _action(a) {
    this.audio?.unlock();
    this.audio?.click();
    if (a === 'defense' || a === 'versus') this.start(a);
    else if (a === 'startWave') this._cmd({ type: 'startWave' });
    else if (a === 'pause') this.setPaused(true);
    else if (a === 'resume') this.setPaused(false);
    else if (a === 'restart') { if (this.onlineKind && (this.online || this.lastWasOnline)) this._goOnline(this.onlineKind); else this.start(this.mode); }
    else if (a === 'quit') { this._leaveOnline(); this._startAttract(); }
    else if (a === 'exit') { this._leaveOnline(); this.onExit?.(); }
    else if (a === 'joinCode') { const code = this.hud.codeInput; if (code.length === 4) { this.net?.cancel(); this._goOnline(this.onlineKind || 'coop', code); } }
    else if (a === 'cancelOnline') { this._leaveOnline(); this._startAttract(); }
    else if (a === 'mute') this.toggleMute();
    else if (a === 'online-coop' || a === 'online-versus') this._goOnline(a === 'online-coop' ? 'coop' : 'versus');
  }

  toggleMute() {
    if (!this.audio) return;
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    this.hud.setMute(this.audio.muted);
  }

  setPaused(on) {
    if (this.online) { // can't stop a shared battle: show the menu, keep the sim running
      this.overlay = on && this.phase === 'playing';
      this.hud.screen(this.overlay ? 'pause' : 'game');
      return;
    }
    if (on && this.phase === 'playing') { this.phase = 'paused'; this.hud.screen('pause'); }
    else if (!on && this.phase === 'paused') { this.phase = 'playing'; this.hud.screen('game'); this.acc = 0; }
  }

  _wire() {
    this._onKey = e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (e.type === 'keyup') { this.keys.delete(k); return; }
      this.keys.add(k);
      if (k === 'escape') { if (this.phase === 'playing' && !this.overlay) this.setPaused(true); else if (this.phase === 'paused' || this.overlay) this.setPaused(false); e.preventDefault(); return; }
      if (k === 'm') { this.toggleMute(); return; }
      if (this.phase !== 'playing') return;
      const n = '1234'.indexOf(e.key);
      if (n >= 0) { this.recruit(RECRUITABLE[n]); e.preventDefault(); }
      else if (k === ' ') { this._cmd({ type: 'startWave' }); e.preventDefault(); }
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
    if (!this.attract) { this._stepWith(cmds); return; }
    stepBattle(st, cmds);
    this.view.afterStep(st);
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
      : (won ? `The ${this.team === 'blue' ? 'red' : 'blue'} fort is rubble.` : 'Your fort got flattened.');
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
    if (this.online) { this.lastWasOnline = true; this._leaveOnline(); } else this.lastWasOnline = false;
  }

  update(rawDt) {
    const dt = Math.min(rawDt, 0.1);
    if (this.online) this._updateOnline(dt);
    else if (this.phase === 'playing' || this.phase === 'title') {
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
    const alpha = this.phase === 'playing' || this.phase === 'title' ? Math.min(1, this.acc / WF_DT) : 1;
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
    this._leaveOnline();
    this.audio?.dispose?.();
    this.view.dispose();
    this.hud.dispose();
    document.body.classList.remove('warfare-active');
  }
}

export { COUNTER_OF };
