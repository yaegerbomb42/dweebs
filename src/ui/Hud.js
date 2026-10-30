// Hud.js — cartoon HUD: Smash-style damage cards, floating nameplates, comic popups, kill feed, announcer.

import * as THREE from 'three';
import { STYLE } from '../combat/CombatSystem.js';
import { statsFor } from '../game/Balance.js';
import { accessColor, getShapeBadge } from '../render/ColorAccess.js';

const _p = new THREE.Vector3();
const PCT_PUNCH = [50, 100, 150]; // the damage number punch-scales as it crosses these
const CONFETTI = 70;
const CONFETTI_COLORS = ['#ff4d8d', '#ffd23f', '#3fb8ff', '#5ad65a', '#ff8a3c', '#a86bff', '#fff8ee'];
const hex = c => '#' + c.toString(16).padStart(6, '0');

export class Hud {
  constructor(root) {
    this.root = root;
    this.timerEl = root.querySelector('#hud-timer');
    this.roundEl = root.querySelector('#hud-round');
    this.cardsEl = root.querySelector('#hud-cards');
    this.feedEl = root.querySelector('#hud-feed');
    this.announcerEl = root.querySelector('#announcer');
    this.popupsEl = root.querySelector('#popups');
    this.platesEl = root.querySelector('#nameplates');
    this.chargeEl = root.querySelector('#charge');
    this.chargeFill = root.querySelector('#charge-fill');
    this.holdEl = root.querySelector('#hold-hint');
    this.lockEl = root.querySelector('#lock-tag');
    this.lockText = '';
    this.focusEl = root.querySelector('#focus-tag');
    this.focusText = '';
    this.focusKind = '';
    this.styleEl = root.querySelector('#style');
    this.styleFill = root.querySelector('#style-fill');
    this.styleTierEl = root.querySelector('#style-tier');
    this.sdEl = root.querySelector('#sd-tag');
    this.sdText = '';
    this.spectatorEl = root.querySelector('#spectator-tag');
    this.spectatorText = '';
    this.flashEl = root.querySelector('#impact-flash');
    // Pooled DOM confetti for the podium (spans are reused, only their animation restarts)
    this.confettiEls = [];
    const layer = document.getElementById('confetti-layer');
    if (layer) for (let i = 0; i < CONFETTI; i++) {
      const el = document.createElement('i');
      el.className = 'cf';
      layer.appendChild(el);
      this.confettiEls.push(el);
    }
    this.styleState = '';
    this.popups = [];
    this.cards = new Map();
    this.plates = new Map();
    this.announceTimer = 0;
    this.colorblindMode = 'off';
  }

  setup(dweebs) {
    this.root.appendChild(this.styleEl); // rescue it before the old cards go
    this.styleState = '';
    this.cardsEl.innerHTML = '';
    this.platesEl.innerHTML = '';
    this.cards.clear();
    this.plates.clear();
    for (let i = 0; i < dweebs.length; i++) {
      const d = dweebs[i];
      const displayColor = this.colorblindMode !== 'off' ? accessColor(d.color, this.colorblindMode) : d.color;
      const card = document.createElement('div');
      card.className = 'card' + (d.isPlayer ? ' you' : '');
      card.style.setProperty('--c', hex(displayColor));
      const shapeBadge = getShapeBadge(i);
      const nameHtml = d.isPlayer ? 'YOU' : `${d.name} <span class="shape-badge" aria-hidden="true">${shapeBadge}</span>`;
      card.innerHTML = `
        <div class="portrait"><span class="shape ${d.type}"><i class="brow"></i><i class="mouth"></i></span></div>
        <div class="card-body">
          <div class="card-name">${nameHtml}</div>
          <div class="pct"><span class="pct-num">0</span><span class="pct-sign">%</span></div>
          <div class="stocks"></div>
          <div class="buffs"></div>
        </div>`;
      card.title = statsFor(d.type).label;
      this.cardsEl.appendChild(card);
      if (d.isPlayer) card.querySelector('.card-body').appendChild(this.styleEl);
      this.cards.set(d, {
        el: card, num: card.querySelector('.pct-num'), pct: card.querySelector('.pct'),
        stocks: card.querySelector('.stocks'), buffs: card.querySelector('.buffs'), shape: card.querySelector('.shape'), mood: '',
        lastPct: -1, lastStocks: -1, lastBuffs: '', shake: 0,
      });

      const plate = document.createElement('div');
      plate.className = 'plate' + (d.isPlayer ? ' you' : '');
      plate.style.setProperty('--c', hex(displayColor));
      const plateName = d.isPlayer ? 'YOU' : `${d.name} ${shapeBadge}`;
      plate.textContent = plateName;
      this.platesEl.appendChild(plate);
      this.plates.set(d, plate);
    }
  }

  setRound(round, wins) {
    this.roundEl.innerHTML = `ROUND ${round}` + (wins ? ` <span class="wins">${wins}</span>` : '');
  }

  // ─── Transient text ───

  popup(text, pos, size = 'small', color = 0xffffff) {
    const el = document.createElement('div');
    el.className = `popup ${size}`;
    el.textContent = text;
    el.style.setProperty('--c', hex(color));
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 24}deg`);
    this.popupsEl.appendChild(el);
    this.popups.push({ el, pos: new THREE.Vector3(pos.x, pos.y + 1, pos.z), life: size === 'big' ? 1.1 : 0.8, max: size === 'big' ? 1.1 : 0.8 });
    if (this.popups.length > 14) this._removePopup(this.popups[0]);
  }

  _removePopup(p) {
    p.el.remove();
    this.popups = this.popups.filter(x => x !== p);
  }

  /** Throw aim readout under the crosshair: "LOCK · 12m" on a rival, plain distance otherwise. */
  setAim(dist, locked) {
    const text = dist == null ? '' : locked ? `LOCK · ${Math.round(dist)}m` : `${Math.round(dist)}m`;
    if (text === this.lockText) return;
    this.lockText = text;
    this.lockEl.textContent = text;
    this.lockEl.classList.toggle('show', !!text);
    this.lockEl.classList.toggle('aim', !locked);
  }

  /** Aim focus: the pick-up or swing the reticle is currently selecting. */
  setFocus(text, kind = '') {
    const next = text || '';
    if (next === this.focusText && kind === this.focusKind) return;
    this.focusText = next;
    this.focusKind = kind;
    this.focusEl.textContent = next;
    this.focusEl.dataset.kind = kind;
    this.focusEl.classList.toggle('show', !!next);
  }

  /** Style line in the feed: "STYLE x3 · BANK SHOT" */
  styleFeed(d, text) {
    this.feed(`${Hud.nameTag(d)} ${text}`, 'style');
  }

  styleTier(tier) {
    this.styleEl.classList.remove('bump');
    void this.styleEl.offsetWidth;
    this.styleEl.classList.add('bump');
  }

  /** Sudden-death banner under the timer ('' hides it) */
  setSuddenDeath(text) {
    if (text === this.sdText) return;
    this.sdText = text;
    this.sdEl.textContent = text;
    this.sdEl.classList.toggle('show', !!text);
  }

  /** Spectator tag while the player is out: who the camera is following. */
  setSpectator(name) {
    const text = name ? `SPECTATING · ${name}  [←/→]` : '';
    if (text === this.spectatorText) return;
    this.spectatorText = text;
    this.spectatorEl.textContent = text;
    this.spectatorEl.classList.toggle('show', !!text);
  }

  /** Toybox impact frame: a quick pink/yellow edge pulse for fireworks-tier hits and KOs. */
  flashImpact() {
    if (!this.flashEl) return;
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  /** Confetti rain over the round/results screens. */
  confetti(n = CONFETTI) {
    for (let i = 0; i < Math.min(n, this.confettiEls.length); i++) {
      const el = this.confettiEls[i];
      el.classList.remove('go');
      el.style.left = `${Math.random() * 100}%`;
      el.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      el.style.setProperty('--x', `${(Math.random() - 0.5) * 240}px`);
      el.style.setProperty('--r', `${(Math.random() - 0.5) * 1440}deg`);
      el.style.setProperty('--t', `${1.8 + Math.random() * 1.6}s`);
      el.style.setProperty('--d', `${Math.random() * 0.6}s`);
      void el.offsetWidth;
      el.classList.add('go');
    }
  }

  /** Card reaction when a Dweeb loses a stock. */
  cardKO(d) {
    const c = this.cards.get(d);
    if (!c) return;
    c.el.classList.remove('ko-flash');
    void c.el.offsetWidth;
    c.el.classList.add('ko-flash');
  }

  feed(html, cls = '') {
    const el = document.createElement('div');
    el.className = 'feed-item' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
    this.feedEl.prepend(el);
    setTimeout(() => el.classList.add('fade'), 4200);
    setTimeout(() => el.remove(), 5000);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild.remove();
  }

  announce(text, style = '', duration = 1.2) {
    const el = this.announcerEl;
    el.className = '';
    el.innerHTML = text;
    void el.offsetWidth; // restart the pop-in animation
    el.className = `show ${style}`;
    this.announceTimer = duration;
  }

  static nameTag(d) {
    return `<b style="color:${hex(d.color)}">${d.isPlayer ? 'YOU' : d.name}</b>`;
  }

  // ─── Per-frame ───

  update(dt, match, camera, player) {
    this.timerEl.textContent = match.timerString();
    this.timerEl.classList.toggle('danger', match.suddenDeath);

    if (this.announceTimer > 0) {
      this.announceTimer -= dt;
      if (this.announceTimer <= 0) this.announcerEl.className = 'hide';
    }

    const w = window.innerWidth, h = window.innerHeight;
    for (const [d, c] of this.cards) {
      const pct = Math.floor(d.percent);
      if (pct !== c.lastPct) {
        if (pct > c.lastPct && c.lastPct >= 0) {
          c.shake = 0.3;
          if (PCT_PUNCH.some(t => c.lastPct < t && pct >= t)) {
            c.num.classList.remove('punch');
            void c.num.offsetWidth;
            c.num.classList.add('punch');
          }
        }
        c.lastPct = pct;
        c.num.textContent = pct;
        c.pct.style.color = percentColor(pct);
      }
      if (c.shake > 0) {
        c.shake -= dt;
        c.pct.style.transform = `translate(${(Math.random() - 0.5) * 8}px, ${(Math.random() - 0.5) * 8}px) scale(${1 + c.shake})`;
      } else c.pct.style.transform = '';
      // Portrait face mirrors the Dweeb's mood: yelling while launched, worried at 100%+
      const mood = d.ragdolling || d.hitstun > 0.15 ? 'yell' : pct >= 100 ? 'worried' : '';
      if (mood !== c.mood) {
        c.mood = mood;
        c.shape.className = `shape ${d.type} ${mood}`;
      }
      const stocks = d.eliminated ? 0 : d.stocks;
      if (stocks !== c.lastStocks) {
        // A lost stock pops off (the extra icon plays its pop animation and stays invisible)
        const lost = c.lastStocks > stocks ? c.lastStocks - stocks : 0;
        c.lastStocks = stocks;
        c.stocks.innerHTML = '<i></i>'.repeat(Math.max(0, stocks)) + '<i class="lost"></i>'.repeat(lost);
      }
      const buffs = (d.megaTimer > 0 ? '★' : '') + (d.zoomTimer > 0 ? '⚡' : '') + (d.bubble ? '●' : '') +
        (d.magnetTimer > 0 ? '🧲' : '') + (d.freezeTimer > 0 ? '❄' : '') +
        (d.shieldCharges > 0 ? '🛡' : '') + (d.sugarTimer > 0 ? '🍬' : '');
      if (buffs !== c.lastBuffs) {
        c.lastBuffs = buffs;
        c.buffs.textContent = buffs;
      }
      c.el.classList.toggle('out', d.eliminated);
      c.el.classList.toggle('respawning', d.out && !d.eliminated);

      // Nameplate
      const plate = this.plates.get(d);
      if (!d.active) { plate.style.display = 'none'; continue; }
      const pos = d.getPosition();
      _p.set(pos.x, pos.y + 1.25 * (d.megaTimer > 0 ? 1.4 : 1), pos.z).project(camera);
      if (_p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1) { plate.style.display = 'none'; continue; }
      plate.style.display = 'block';
      plate.style.transform = `translate(-50%, -100%) translate(${(_p.x * 0.5 + 0.5) * w}px, ${(-_p.y * 0.5 + 0.5) * h}px)`;
      plate.dataset.pct = `${pct}%`;
    }

    // Style meter (player): only touch the DOM when something visible changes
    if (player) {
      const pctW = Math.round((player.superArmed ? 100 : player.styleScore / STYLE.max * 100) / 2) * 2;
      const state = `${pctW}|${player.styleTier}|${player.superReady}|${player.superArmed}`;
      if (state !== this.styleState) {
        this.styleState = state;
        this.styleFill.style.width = pctW + '%';
        this.styleTierEl.textContent = player.superArmed ? 'SUPER YEET ARMED' : player.superReady ? 'SUPER YEET READY [F]' : STYLE.names[player.styleTier];
        this.styleEl.className = `t${player.styleTier}` + (player.styleScore > 0 || player.superArmed ? ' on' : '') +
          (player.superReady ? ' ready' : '') + (player.superArmed ? ' armed' : '');
      }
    }

    // Charge meter (player)
    if (player && player.active && player.charging > 0) {
      this.chargeEl.classList.add('show');
      this.chargeFill.style.width = `${Math.round(player.charging * 100)}%`;
      this.chargeEl.classList.toggle('full', player.charging >= 1);
    } else this.chargeEl.classList.remove('show');
    this.holdEl.classList.toggle('show', !!player?.held);
    if (player?.held) {
      const gadget = player.held.ref.def?.gadget;
      if (gadget === 'freezeRay') this.holdEl.innerHTML = '<kbd>LMB</kbd> FREEZE RAY · <kbd>RMB</kbd>/<kbd>E</kbd> throw · <kbd>Q</kbd> drop';
      else if (gadget === 'magnet') this.holdEl.innerHTML = '<kbd>LMB</kbd> MAGNET PULL · <kbd>RMB</kbd>/<kbd>E</kbd> throw · <kbd>Q</kbd> drop';
      else if (player.held.ref.isWeapon) {
        const wname = { spiky: 'spiky ball', glove: 'boxing glove' }[player.held.ref.def.weapon] || player.held.ref.def.weapon;
        this.holdEl.innerHTML = `<kbd>LMB</kbd> swing ${wname} · <kbd>RMB</kbd> throw · <kbd>Q</kbd> drop`;
      }
      else this.holdEl.innerHTML = '<kbd>LMB</kbd>/<kbd>RMB</kbd> throw (hold to charge) · <kbd>Q</kbd> drop';
    }

    // Popups rise and fade
    for (const p of [...this.popups]) {
      p.life -= dt;
      if (p.life <= 0) { this._removePopup(p); continue; }
      const t = 1 - p.life / p.max;
      _p.copy(p.pos).setY(p.pos.y + t * 1.2).project(camera);
      if (_p.z > 1) { p.el.style.display = 'none'; continue; }
      p.el.style.display = 'block';
      p.el.style.left = `${(_p.x * 0.5 + 0.5) * w}px`;
      p.el.style.top = `${(-_p.y * 0.5 + 0.5) * h}px`;
      p.el.style.opacity = t > 0.7 ? (1 - t) / 0.3 : 1;
    }
  }

  clearTransient() {
    for (const p of [...this.popups]) this._removePopup(p);
    this.feedEl.innerHTML = '';
    this.announcerEl.className = 'hide';
  }
}

function percentColor(p) {
  // white → yellow → orange → red → dark red
  const stops = [[0, [255, 255, 255]], [40, [255, 230, 90]], [80, [255, 150, 50]], [120, [255, 60, 60]], [180, [170, 20, 40]]];
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
      const t = (p - p0) / (p1 - p0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(',')})`;
    }
  }
  return 'rgb(170,20,40)';
}
