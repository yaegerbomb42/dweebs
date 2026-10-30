// DweebWarfare.js — Game 5 controller. Owns the deterministic battle (src/sim/warfareBattle.js),
// steps it at a fixed 30 Hz, feeds local commands in, and drives the view, HUD, audio and camera.
//
//   title  → attract battle (AI vs AI) behind the start screen with tutorial hints
//   playing→ defense (waves, boss every 5, win after FINAL_WAVE) or versus AI
//   paused / over → pause menu, win/lose screen with stats and restart
import * as THREE from 'three';
import { createBattle, stepBattle, battleHash, WF_DT, FIELD } from '../sim/warfareBattle.js';
import { commanderTurn, createCommanderBrain, personalityOf } from './WarfareCommander.js';
import { RECRUITABLE, UNIT_TYPES, COUNTER_OF } from '../sim/warfareUnits.js';
import { DIFFICULTY, FINAL_WAVE } from '../sim/warfareWaves.js';
import { CAMPAIGN, missionById, loadCampaign, saveCampaign, recordWin, missionStars, collectVeterans } from './WarfareCampaign.js';
import { WarfareView } from './WarfareView.js';
import { WarfareHud, bestKey } from './WarfareHud.js';
import { WarfareAudio } from './WarfareAudio.js';
import { WarfareNet } from './WarfareNet.js';
import { getBattleground } from './Battlegrounds.js';

export { RECRUITABLE as UNIT_ROLES };

export const POWER_COOLDOWNS = {
  artillery: 10.0,
  supply: 8.0,
  stance: 4.0,
  warhorn: 18.0,
  repair: 25.0,
  trap: 15.0,
};

/** Coin costs mirror the sim-side costs in src/sim/warfareBattle.js. */
export const POWER_COSTS = {
  artillery: 25, supply: 15, stance: 0, warhorn: 20, repair: 30, trap: 20,
};

/** Versus AI income handicap by defense difficulty. */
const AI_LEVEL = { easy: 0.8, normal: 1, hard: 1.2 };

const ENEMY_HINTS = {
  rocket: 'Enemy <b>rockets</b> lob splash shells. Walk <b>shields</b> into them.',
  stealer: 'Enemy <b>stealers</b> kidnap your dweebs! <b>Rockets</b> shred them in the open.',
  kami: '<b>Kamis</b> blow up shield walls. <b>Stealers</b> flip their fuses.',
  sneak: '<b>Sneaks</b> flank around your line to knife rockets. Keep <b>shields</b> near your gunners.',
  brute: '<b>Brutes</b> are too heavy to steal. Swarm them with <b>kamis</b>.',
  boss: 'The <b>Brass Bully</b> is here! Kamis deal bonus damage. Keep shields spread out.',
};

/** Seconds without a lockstep turn before an online battle is given up. */
const STALL_GIVE_UP = 12;

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
    this.mapId = this.hud.mapId;
    this.team = 'blue';
    this.mode = 'defense';
    this.difficulty = 'normal';
    try { const d = localStorage.getItem('dweebs-warfare-diff'); if (DIFFICULTY[d]) this.difficulty = d; } catch { /* private mode */ }
    this.phase = 'title';
    this.powerCooldowns = { artillery: 0, supply: 0, stance: 0 };
    this.brain = createCommanderBrain();
    this.aiming = null; // { kind: 'artillery'|'trap', team } while the player picks a target
    this.campaignRun = null; // { idx, veterans } while playing the campaign
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
    this.st = createBattle({ seed: (Date.now() & 0xffff) + 1, mode: 'versus', map: 'random' });
    this.attract = true;
    this.view.setMap(getBattleground('meadow'));
    this.brain = createCommanderBrain();
    this._cancelAim();
    this.view.reset();
    this.view.setBarricades(this.st.barricades);
    this.view.localTeam = this.team;
    this.hud.setDifficulty(this.difficulty);
    this.hud.screen('title');
    this.cam.tx = 0; this.cam.tz = 2; this.cam.tdist = 56;
  }

  /** Drop any in-progress power targeting (Esc, new battle, mode switch). */
  _cancelAim() {
    this.aiming = null;
    if (this.canvas) this.canvas.style.cursor = '';
  }

  start(mode = 'defense', mapId) {
    this._leaveOnline();
    this.campaignRun = null;
    this.setMap(mapId || this.hud.mapId);
    this._begin(mode, (Date.now() & 0x7fffffff) | 1, 'blue', this.difficulty, {
      mapId: this.mapId, personality: 'random', aiLevel: AI_LEVEL[this.difficulty] ?? 1,
    });
    const mapTag = ` · ${this.st.mapName} MAP`;
    if (mode === 'defense') {
      this.hud.banner('DEFEND THE FORT', `Survive ${this.st.finalWave} waves · boss every 5 · ${DIFFICULTY[this.difficulty].label}${mapTag}`, '', 2.6);
      this.hud.toast('Click the board to move your <b>rally flag</b>. Press <b>1–4</b> to recruit.', 8);
    } else if (this.isLocalPvp) {
      this.hud.banner('VERSUS', `Smash the red fort before they smash yours${mapTag}`, '', 2.6);
      this.hud.toast('Two commanders, one board. Player 2 uses <b>7–0</b>, <b>[</b> and <b>]</b>.', 8);
    } else {
      const foe = this.team === 'blue' ? 'red' : 'blue';
      const P = personalityOf(this.st.aiPersonality[foe]);
      this.hud.banner('VERSUS', `${P.title} commands the enemy — ${P.desc}${mapTag}`, '', 3.2);
      this.hud.toast('The AI buys counters to your army — and shells your clumps. Mix it up!', 8);
    }
  }

  /** Pick the campaign battleground (title-screen map buttons). */
  setMap(mapId) {
    const bg = this.hud.setMap(mapId || this.hud.mapId);
    this.mapId = bg.id;
    return bg;
  }

  _begin(mode, seed, team, difficulty = 'normal', opts = {}) {
    this.mode = mode;
    this.attract = false;
    this.team = team;
    // 5th arg: an opts object (campaign/skirmish) or a battleground id string (the online
    // handshake and the legacy map-picker path). A battleground feeds explicit
    // barricades/highGround; a named wave-2 layout goes through `map`. Both peers see the
    // same seed, so lockstep agrees on whichever is used.
    const o = typeof opts === 'string' ? { mapId: opts } : opts;
    this.campaignIdx = o.campaignIdx ?? null;
    const bg = o.mapId ? getBattleground(o.mapId) : null;
    if (bg) this.mapId = bg.id;
    this.st = createBattle({
      seed, mode, difficulty,
      map: o.map ?? 'random', waves: o.waves, personality: o.personality ?? 'random',
      aiLevel: o.aiLevel ?? 1, veterans: o.veterans,
      barricades: bg?.barricades, highGround: bg?.highGround,
    });
    if (bg) this.st.mapName = bg.name.toUpperCase();
    this.powerCooldowns = Object.fromEntries(Object.keys(POWER_COOLDOWNS).map(k => [k, 0]));
    this.brain = createCommanderBrain();
    this._cancelAim();
    this.pending = [];
    this.outbox = [];
    this.seen = new Set();
    this.acc = 0;
    this.endTimer = 0;
    this.overlay = false;
    this.view.setMap(bg);
    this.view.reset();
    this.view.setBarricades(this.st.barricades);
    this.view.localTeam = team;
    this.phase = 'playing';
    this.hud.last = {};
    this.hud.screen('game');
    const side = team === 'blue' ? -1 : 1;
    this.cam.tx = 16 * side; this.cam.tz = 3; this.cam.tdist = 40;
    this.audio?.unlock();
  }

  /** Start a campaign mission by id (from the campaign screen). */
  startCampaign(id) {
    const idx = CAMPAIGN.findIndex(m => m.id === id);
    if (idx < 0) return;
    if (idx > loadCampaign().unlocked) { this.audio?.deny(); return; }
    this._leaveOnline();
    this.isLocalPvp = false;
    this.campaignRun = { idx, veterans: [] };
    this._beginCampaignMission();
  }

  _beginCampaignMission() {
    const m = CAMPAIGN[this.campaignRun.idx];
    this._begin(m.mode, m.seed, 'blue', m.difficulty, {
      map: m.map, waves: m.waves, personality: m.personality ?? 'random',
      aiLevel: m.aiLevel ?? 1, veterans: this.campaignRun.veterans, campaignIdx: this.campaignRun.idx,
    });
    const vets = this.campaignRun.veterans.length;
    this.hud.banner(`MISSION ${this.campaignRun.idx + 1}/${CAMPAIGN.length}: ${m.name.toUpperCase()}`, `${m.briefing}${vets ? ` · ${vets} veteran${vets === 1 ? '' : 's'} return!` : ''}`, '', 3.4);
    if (m.mode === 'versus') {
      const P = personalityOf(this.st.aiPersonality.red);
      this.hud.toast(`Enemy commander: <b>${P.title}</b> — ${P.desc}`, 8);
    } else {
      this.hud.toast('Click the board to move your <b>rally flag</b>. Press <b>1–4</b> to recruit.', 8);
    }
  }

  _nextMission() {
    if (!this.campaignRun) return;
    if (this.campaignRun.idx + 1 >= CAMPAIGN.length) {
      this.campaignRun = null;
      this._startAttract();
      return;
    }
    this.campaignRun.idx++;
    this._beginCampaignMission();
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
    this.net.queue(kind, { code, name: commanderName(), difficulty: this.difficulty, map: this.mapId });
  }

  _wireNet(net) {
    net.on('queued', m => this.hud.onlineStatus({ status: m.mode === 'coop' ? 'Waiting for a co-op partner…' : 'Waiting for an opponent…', code: m.code }))
      .on('start', m => this._startOnline(m))
      .on('error', m => { if (this.phase === 'playing') this.hud.toast(m.message, 4); else this.hud.onlineStatus({ status: m.message }); })
      .on('desync', () => this.hud.toast('<b>Desync</b> detected: the two battles drifted apart. Finish this one for fun!', 8))
      .on('peerLeft', () => this._peerLeft())
      .on('peerBack', m => { if (this.phase === 'playing') this.hud.toast(`${m.name || 'Your partner'} reconnected.`, 4); })
      .on('verifyHash', () => {
        // Tightened post-reconnect check: hash the newest fully-applied turn right now.
        if (this.online && this.phase === 'playing' && this.net) {
          const t = Math.floor(this.st.tick / this.online.turnTicks);
          this.net.sendHash(t, battleHash(this.st));
        }
      })
      .on('close', () => {
        const dead = this.net === net ? net : null;
        this.net = null;
        if (this.online && this.phase === 'playing' && dead?.match?.token) this._tryRejoin(dead);
        else {
          if (this.online && this.phase === 'playing') this._forfeitEnd(false, 'Lost the connection to the server.');
          this.online = null;
          this.hud.setNet('');
        }
      });
  }

  /** A socket blip mid-battle: resume the same match instead of forfeiting. */
  async _tryRejoin(dead) {
    this.hud.setNet('ONLINE · reconnecting…');
    const net = new WarfareNet(this.serverUrl);
    net.nextTurn = dead.nextTurn;
    net.match = dead.match;
    let ok = true;
    try { await net.rejoin(8000); } catch { ok = false; }
    if (!ok || this.phase !== 'playing' || !this.online) {
      try { net.close(); } catch { /* already closed */ }
      if (this.online && this.phase === 'playing') this._forfeitEnd(false, 'Lost the connection to the server.');
      this.online = null;
      this.hud.setNet('');
      return;
    }
    this.net = net;
    this._wireNet(net);
    this.online.stallT = 0;
    this.hud.setNet(`ONLINE · ${this.online.kind === 'coop' ? 'co-op with' : 'vs'} ${this.online.partner} · reconnected`);
    this.hud.toast('Reconnected — the battle resumes where it left off.', 4);
  }

  _startOnline(m) {
    const mode = m.mode === 'versus' ? 'versus' : 'defense';
    this.online = { kind: m.mode, partner: m.partner, turnTicks: m.turnTicks, stallT: 0 };
    this._begin(mode, m.seed, m.team, m.difficulty, m.map);
    this.hud.setNet(`ONLINE · ${m.mode === 'coop' ? 'co-op with' : 'vs'} ${m.partner}`);
    if (mode === 'defense') {
      this.hud.banner('ONLINE CO-OP', `Hold the fort together · shared coins & rally flag · ${this.st.diff.label}`, '', 2.6);
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
    const secs = Math.round(this.st.tick * WF_DT);
    const time = `${(secs / 60) | 0}:${String(secs % 60).padStart(2, '0')}`;
    const wavesDefended = this.st.stats?.wavesCleared || (won ? 1 : 0);
    const wavesStr = this.mode === 'defense' ? `${wavesDefended} / ${FINAL_WAVE}` : (won ? 'VICTORY' : 'FORFEIT');
    const totalScore = (wavesDefended * 500) + (s.kills * 25) + (won ? 2000 : 0);
    this.hud.showEnd({
      won, title: won ? 'VICTORY!' : 'DISCONNECTED', sub,
      waves: wavesStr, kills: s.kills, time, score: totalScore,
      stats: [['enemies popped', s.kills], ['dweebs lost', s.lost], ['kidnapped & converted', s.converted], ['coins earned', s.coinsEarned], ['damage dealt', Math.round(s.dmgDealt)], ['time', `${secs}s`]]
    });
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
    if (this.online.stallT > STALL_GIVE_UP) { this._forfeitEnd(false, 'The server stopped sending turns.'); return; }
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

  recruit(type, team = this.team) {
    if (this.phase !== 'playing' || !RECRUITABLE.includes(type)) return;
    if (this.st.coins[team] < UNIT_TYPES[type].cost) { this.audio?.deny(); this.hud.toast(`Need 🪙 ${UNIT_TYPES[type].cost} for a ${UNIT_TYPES[type].name}`, 2.5); return; }
    this._cmd({ type: 'recruit', team, unit: type });
  }

  callArtillery(team = this.team) {
    if (this.phase !== 'playing') return;
    if (this.powerCooldowns.artillery > 0) {
      this.audio?.deny();
      this.hud.toast(`Artillery recharging (${this.powerCooldowns.artillery.toFixed(1)}s)`, 1.5);
      return;
    }
    if (this.st.coins[team] < 25) {
      this.audio?.deny();
      this.hud.toast('Need 🪙 25 for Artillery Barrage', 2.0);
      return;
    }
    // Arm the barrage: the next board tap picks the impact point (Esc cancels).
    this.aiming = { kind: 'artillery', team };
    if (this.canvas) this.canvas.style.cursor = 'crosshair';
    this.audio?.click();
    this.hud.toast('🎯 <b>Click the board</b> to call the barrage — <b>Esc</b> cancels', 6);
  }

  _fireArtillery(x, z, team) {
    this._cancelAim();
    if (this.phase !== 'playing') return;
    if (this.st.coins[team] < 25) {
      this.audio?.deny();
      this.hud.toast('Need 🪙 25 for Artillery Barrage', 2.0);
      return;
    }
    this.powerCooldowns.artillery = POWER_COOLDOWNS.artillery;
    this._cmd({ type: 'artillery', team, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  }

  callSupply(team = this.team) {
    if (this.phase !== 'playing') return;
    if (this.powerCooldowns.supply > 0) {
      this.audio?.deny();
      this.hud.toast(`Supplies recharging (${this.powerCooldowns.supply.toFixed(1)}s)`, 1.5);
      return;
    }
    if (this.st.coins[team] < 15) {
      this.audio?.deny();
      this.hud.toast('Need 🪙 15 for Emergency Supplies', 2.0);
      return;
    }
    this.powerCooldowns.supply = POWER_COOLDOWNS.supply;
    this._cmd({ type: 'supply', team });
  }

  callWarhorn(team = this.team) {
    if (this.phase !== 'playing') return;
    if (this.powerCooldowns.warhorn > 0) {
      this.audio?.deny();
      this.hud.toast(`War horn recharging (${this.powerCooldowns.warhorn.toFixed(1)}s)`, 1.5);
      return;
    }
    if (this.st.coins[team] < POWER_COSTS.warhorn) {
      this.audio?.deny();
      this.hud.toast(`Need 🪙 ${POWER_COSTS.warhorn} for War Horn`, 2.0);
      return;
    }
    this.powerCooldowns.warhorn = POWER_COOLDOWNS.warhorn;
    this._cmd({ type: 'warhorn', team });
  }

  callRepair(team = this.team) {
    if (this.phase !== 'playing') return;
    if (this.powerCooldowns.repair > 0) {
      this.audio?.deny();
      this.hud.toast(`Fortify recharging (${this.powerCooldowns.repair.toFixed(1)}s)`, 1.5);
      return;
    }
    if (this.st.coins[team] < POWER_COSTS.repair) {
      this.audio?.deny();
      this.hud.toast(`Need 🪙 ${POWER_COSTS.repair} to Fortify`, 2.0);
      return;
    }
    const f = this.st.forts[team];
    if (f.hp >= f.maxHp) {
      this.audio?.deny();
      this.hud.toast('Your fort is already at full HP', 2.0);
      return;
    }
    this.powerCooldowns.repair = POWER_COOLDOWNS.repair;
    this._cmd({ type: 'repair', team });
  }

  callTrap(team = this.team) {
    if (this.phase !== 'playing') return;
    if (this.powerCooldowns.trap > 0) {
      this.audio?.deny();
      this.hud.toast(`Spike pit recharging (${this.powerCooldowns.trap.toFixed(1)}s)`, 1.5);
      return;
    }
    if (this.st.coins[team] < POWER_COSTS.trap) {
      this.audio?.deny();
      this.hud.toast(`Need 🪙 ${POWER_COSTS.trap} for Spike Pit`, 2.0);
      return;
    }
    // Arm the pit: the next board tap buries it (Esc cancels).
    this.aiming = { kind: 'trap', team };
    if (this.canvas) this.canvas.style.cursor = 'crosshair';
    this.audio?.click();
    this.hud.toast('🕳️ <b>Click the board</b> to bury the spike pit — <b>Esc</b> cancels', 6);
  }

  _fireTrap(x, z, team) {
    this._cancelAim();
    if (this.phase !== 'playing') return;
    if (this.st.coins[team] < POWER_COSTS.trap) {
      this.audio?.deny();
      this.hud.toast(`Need 🪙 ${POWER_COSTS.trap} for Spike Pit`, 2.0);
      return;
    }
    this.powerCooldowns.trap = POWER_COOLDOWNS.trap;
    this._cmd({ type: 'trap', team, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  }

  toggleFormation(team = this.team) {
    if (this.phase !== 'playing') return;
    if (this.powerCooldowns.stance > 0) {
      this.audio?.deny();
      this.hud.toast(`Stance shift cooling down (${this.powerCooldowns.stance.toFixed(1)}s)`, 1.5);
      return;
    }
    this.powerCooldowns.stance = POWER_COOLDOWNS.stance;
    this.currentStance = this.currentStance === 'charge' ? 'defense' : 'charge';
    this._cmd({ type: 'stance', team, stance: this.currentStance });
  }

  _action(a) {
    this.audio?.unlock();
    this.audio?.click();
    if (a === 'defense' || a === 'versus') { this.isLocalPvp = false; this.start(a); }
    else if (a === 'pvp-local') { this.isLocalPvp = true; this.start('versus'); }
    else if (a === 'artillery') this.callArtillery();
    else if (a === 'supply') this.callSupply();
    else if (a === 'stance') this.toggleFormation();
    else if (a === 'warhorn') this.callWarhorn();
    else if (a === 'repair') this.callRepair();
    else if (a === 'trap') this.callTrap();
    else if (a === 'campaign') { this.hud.setCampaign(loadCampaign(), CAMPAIGN); this.hud.screen('campaign'); }
    else if (a === 'campaignBack') this.hud.screen('title');
    else if (a === 'nextMission') this._nextMission();
    else if (a.startsWith('mission-')) { const m = missionById(a.slice(8)); if (m) this.startCampaign(m.id); }
    else if (a.startsWith('diff-') && DIFFICULTY[a.slice(5)]) {
      this.difficulty = a.slice(5);
      try { localStorage.setItem('dweebs-warfare-diff', this.difficulty); } catch { /* private mode */ }
      this.hud.setDifficulty(this.difficulty);
    }
    else if (a === 'startWave') this._cmd({ type: 'startWave' });
    else if (a.startsWith('map-')) { this.setMap(a.slice(4)); this.audio?.click(); }
    else if (a === 'pause') this.setPaused(true);
    else if (a === 'resume') this.setPaused(false);
    else if (a === 'restart') {
      if (this.campaignRun) this._beginCampaignMission();
      else if (this.onlineKind && (this.online || this.lastWasOnline)) this._goOnline(this.onlineKind);
      else this.start(this.mode, this.mapId);
    }
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
      if (k === 'escape') {
        if (this.aiming) { this._cancelAim(); this.hud.toast('Targeting cancelled', 1.5); e.preventDefault(); return; }
        if (this.phase === 'playing' && !this.overlay) this.setPaused(true);
        else if (this.phase === 'paused' || this.overlay) this.setPaused(false);
        e.preventDefault(); return;
      }
      if (k === 'm') { this.toggleMute(); return; }
      if (this.phase !== 'playing') return;
      const n = '1234'.indexOf(e.key);
      if (n >= 0) { this.recruit(RECRUITABLE[n]); e.preventDefault(); }
      else if (k === 'q') { this.callArtillery(); e.preventDefault(); }
      else if (k === 'e') { this.callSupply(); e.preventDefault(); }
      else if (k === 'r') { this.toggleFormation(); e.preventDefault(); }
      else if (k === 't') { this.callWarhorn(); e.preventDefault(); }
      else if (k === 'f') { this.callRepair(); e.preventDefault(); }
      else if (k === 'y') { this.callTrap(); e.preventDefault(); }
      else if (k === ' ') { this._cmd({ type: 'startWave' }); e.preventDefault(); }
      // Player 2 local PvP controls (keys 7, 8, 9, 0, and [)
      else if (this.isLocalPvp) {
        const p2n = '7890'.indexOf(e.key);
        if (p2n >= 0) { this.recruit(RECRUITABLE[p2n], 'red'); e.preventDefault(); }
        else if (k === '[') { this.callArtillery('red'); e.preventDefault(); }
        else if (k === ']') { this.callSupply('red'); e.preventDefault(); }
      }
    };
    // Pointer: a tap/click moves the rally flag; a drag pans the camera (touch-friendly); two fingers pinch-zoom.
    this._ptrs = new Map();
    this._onPointer = e => {
      if (this.phase !== 'playing' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
      if (this._ptrs.size === 2) { const [a, b] = [...this._ptrs.values()]; this._pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.cam.tdist }; }
    };
    this._onPointerMove = e => {
      const p = this._ptrs.get(e.pointerId);
      if (!p || this.phase !== 'playing') return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) p.moved = true;
      if (this._ptrs.size >= 2 && this._pinch) {
        const [a, b] = [...this._ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 10) this.cam.tdist = Math.max(22, Math.min(70, this._pinch.dist * this._pinch.d / d));
      } else if (p.moved) {
        const k = this.cam.dist / Math.max(320, window.innerHeight) * 1.6;
        this.cam.tx = Math.max(-FIELD.halfX, Math.min(FIELD.halfX, this.cam.tx - dx * k));
        this.cam.tz = Math.max(-FIELD.halfZ, Math.min(FIELD.halfZ, this.cam.tz - dy * k));
      }
    };
    this._onPointerUp = e => {
      const p = this._ptrs.get(e.pointerId);
      if (!p) return;
      const wasMulti = this._ptrs.size > 1 || this._pinch;
      this._ptrs.delete(e.pointerId);
      if (this._ptrs.size < 2) this._pinch = this._ptrs.size ? this._pinch : null;
      if (e.type === 'pointerup' && !p.moved && !wasMulti && this.phase === 'playing') {
        const hit = this._pick(e.clientX, e.clientY);
        if (hit) {
          if (this.aiming?.kind === 'artillery') this._fireArtillery(hit.x, hit.z, this.aiming.team);
          else if (this.aiming?.kind === 'trap') this._fireTrap(hit.x, hit.z, this.aiming.team);
          else { this.setRallyPoint(hit.x, hit.z); this.audio?.click(); }
        }
      }
      if (!this._ptrs.size) this._pinch = null;
    };
    this._onWheel = e => {
      if (this.phase === 'title') return;
      this.cam.tdist = Math.max(22, Math.min(70, this.cam.tdist + Math.sign(e.deltaY) * 3));
      e.preventDefault();
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    this.canvas?.addEventListener('pointerdown', this._onPointer);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
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
    const blueP = st.aiPersonality?.blue || 'tactician';
    const redP = st.aiPersonality?.red || 'tactician';
    let cmds;
    if (this.attract) cmds = [...commanderTurn(st, this.brain, 'blue', blueP), ...commanderTurn(st, this.brain, 'red', redP)];
    else {
      cmds = this.pending.splice(0);
      if (st.mode === 'versus' && !this.isLocalPvp) cmds.push(...commanderTurn(st, this.brain, 'red', redP));
    }
    if (!this.attract) { this._stepWith(cmds); return; }
    stepBattle(st, cmds);
    this.view.afterStep(st);
  }

  _react(events) {
    const hud = this.hud, st = this.st;
    for (const ev of events) {
      if (ev.type === 'artillery') {
        hud.toast(`🎯 Artillery strike impact at X:${Math.round(ev.x)}!`, 2.5);
      } else if (ev.type === 'supply') {
        this.view?.fx?.shockwave?.(ev.x, ev.z, 10, 0x5ee06a);
        hud.toast(`📦 Supplies air-dropped! Nearby units healed!`, 2.5);
      } else if (ev.type === 'stance') {
        hud.toast(ev.stance === 'charge' ? `⚔️ CHARGE! Speed boosted!` : `🛡️ DEFENSIVE WALL! Holding ground!`, 2.0);
      } else if (ev.type === 'warhorn') {
        hud.toast(ev.team === this.team ? `📯 <b>WAR HORN!</b> Your army hits +30% harder!` : `📯 Enemy war horn! Brace for a push.`, 2.5);
      } else if (ev.type === 'repair') {
        hud.toast(ev.team === this.team ? `🛠️ Fort patched <b>+${ev.amount} HP</b>!` : `🛠️ The enemy is repairing their fort!`, 2.5);
      } else if (ev.type === 'trap' && ev.team !== this.team && !this.seen.has('foeTrap')) {
        this.seen.add('foeTrap');
        hud.toast(`🕳️ The enemy buried a <b>spike pit</b>! Steer around the spikes.`, 5);
      } else if (ev.type === 'veteran' && !this.seen.has('veteran')) {
        this.seen.add('veteran');
        hud.toast(`⭐ <b>Veterans</b> return to the field (+15% HP)!`, 5);
      } else if (ev.type === 'waveStart') {
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
    const fw = st.finalWave || FINAL_WAVE;
    this.phase = 'over';
    if (this.mode === 'defense' && this.campaignIdx == null) {
      const reached = won ? fw : st.wave;
      try {
        const key = bestKey(st.difficulty);
        const best = +localStorage.getItem(key) || 0;
        if (reached > best) localStorage.setItem(key, String(reached));
      } catch { /* private mode */ }
    }
    // Campaign: bank the win, carry survivors forward as veterans.
    let nextMission = false;
    if (this.campaignIdx != null && this.campaignRun) {
      const m = CAMPAIGN[this.campaignIdx];
      if (won && m) {
        const stars = missionStars(m, st);
        saveCampaign(recordWin(loadCampaign(), this.campaignIdx, stars));
        this.campaignRun.veterans = collectVeterans(st);
        nextMission = this.campaignIdx + 1 < CAMPAIGN.length;
      }
    }
    const secs = Math.round(st.tick * WF_DT);
    const time = `${(secs / 60) | 0}:${String(secs % 60).padStart(2, '0')}`;
    const wavesDefended = this.mode === 'defense' ? (won ? fw : Math.max(0, st.wave - 1)) : (won ? 1 : 0);
    const wavesStr = this.mode === 'defense' ? `${wavesDefended} / ${fw}` : (won ? 'VICTORY' : 'DEFEAT');
    const totalScore = ((this.mode === 'defense' ? wavesDefended : (won ? 10 : 2)) * 500) + (s.kills * 25) + Math.round((s.dmgDealt || 0) * 0.5) + (won ? 2000 : 0);
    let sub = this.mode === 'defense'
      ? (won ? `The fort held through all ${fw} waves on ${st.diff.label}!` : `The fort fell on wave ${st.wave} (${st.diff.label}).`)
      : (won ? `The ${this.team === 'blue' ? 'red' : 'blue'} fort is rubble.` : 'Your fort got flattened.');
    if (this.campaignIdx != null && won) {
      const vets = this.campaignRun?.veterans.length || 0;
      sub = nextMission
        ? `${sub} ${vets} veteran${vets === 1 ? '' : 's'} will fight on in the next mission.`
        : `🏆 CAMPAIGN COMPLETE! ${sub}`;
    }
    this.hud.showEnd({
      won, sub,
      waves: wavesStr,
      kills: s.kills,
      time,
      score: totalScore,
      nextMission,
      stats: [
        [this.mode === 'defense' ? 'waves cleared' : 'time', this.mode === 'defense' ? `${wavesDefended}/${fw}` : time],
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
    for (const k of Object.keys(POWER_COOLDOWNS)) {
      if (this.powerCooldowns[k] > 0) {
        this.powerCooldowns[k] = Math.max(0, this.powerCooldowns[k] - dt);
      }
    }
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
    if (this.phase !== 'title') {
      this.hud.update(this.st, this.team, dt, this.powerCooldowns);
      this.hud.render(this.st, this.team, this.powerCooldowns);
    }
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
    this._cancelAim();
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
    this.canvas?.removeEventListener('pointerdown', this._onPointer);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    this.canvas?.removeEventListener('wheel', this._onWheel);
    this._leaveOnline();
    this.audio?.dispose?.();
    this.view.dispose();
    this.hud.dispose();
    document.body.classList.remove('warfare-active');
  }
}

export { COUNTER_OF };
