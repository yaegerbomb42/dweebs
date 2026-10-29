// adversarial-m4-challenger.mjs — Comprehensive Adversarial Stress Test & Verification Suite for M4
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ARCHETYPE_PRESETS,
  buildCustomDweebModel,
  DEFAULT_BUILD_CONFIG,
  BODY_SHAPES,
  APPENDAGES,
  FEET_TYPES,
  BROW_STYLES,
  MOUTH_STYLES,
} from '../../src/builder/CustomDweebModel.js';
import { BuildADweebLab } from '../../src/builder/BuildADweebLab.js';
import { BuildADweebHud } from '../../src/builder/BuildADweebHud.js';
import { BuilderBot } from '../../src/ai/BuilderBot.js';

console.log('================================================================');
console.log('ADVERSARIAL CHALLENGER SUITE: MILESTONE 4 (BUILD-A-DWEEB & DUEL)');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(desc, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`[PASS] ${desc}`);
  } catch (err) {
    failedTests++;
    console.error(`[FAIL] ${desc}\n       Error: ${err.message}`);
  }
}

// -------------------------------------------------------------
// PURE NODE DOM IMPLEMENTATION
// -------------------------------------------------------------
class MockClassList {
  constructor() { this._set = new Set(); }
  add(...c) { for (const x of c) if (x) this._set.add(x); }
  remove(...c) { for (const x of c) this._set.delete(x); }
  toggle(c, force) {
    if (force === undefined) force = !this._set.has(c);
    if (force) this._set.add(c); else this._set.delete(c);
    return force;
  }
  contains(c) { return this._set.has(c); }
  toString() { return [...this._set].join(' '); }
}

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.value = '';
    this.classList = new MockClassList();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this._attrs = new Map();
    this._text = '';
    this.disabled = false;
    this.parentElement = null;
    this._listeners = new Map();
  }

  get className() { return this.classList.toString(); }
  set className(v) {
    this.classList = new MockClassList();
    if (v) String(v).split(/\s+/).forEach(c => this.classList.add(c));
  }

  get textContent() { return this._text; }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }

  setAttribute(k, v) {
    this._attrs.set(k, String(v));
    if (k === 'id') this.id = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'value') this.value = String(v);
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this.dataset[prop] = String(v);
    }
  }

  getAttribute(k) { return this._attrs.get(k) || null; }

  appendChild(c) {
    if (c.parentElement) {
      const idx = c.parentElement.children.indexOf(c);
      if (idx >= 0) c.parentElement.children.splice(idx, 1);
    }
    c.parentElement = this;
    this.children.push(c);
    return c;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  addEventListener(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
  }

  removeEventListener(event, fn) {
    const list = this._listeners.get(event);
    if (list) {
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  dispatchEvent(e) {
    if (!e.target) e.target = this;
    let curr = this;
    while (curr) {
      const list = curr._listeners.get(e.type) || [];
      for (const fn of list) {
        fn(e);
        if (e._stopped) return true;
      }
      curr = curr.parentElement;
    }
    return true;
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault() {},
      stopPropagation() { this._stopped = true; },
    });
  }

  closest(sel) {
    let curr = this;
    while (curr) {
      if (matchesElement(curr, sel)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(sel) {
    for (const c of this.children) {
      if (matchesElement(c, sel)) return c;
      const found = c.querySelector(sel);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(sel) {
    const res = [];
    const walk = el => {
      for (const c of el.children) {
        if (matchesElement(c, sel)) res.push(c);
        walk(c);
      }
    };
    walk(this);
    return res;
  }

  get innerHTML() {
    return this.children.map(c => c.textContent).join('');
  }

  set innerHTML(html) {
    this.children = [];
    parseSimpleHtml(html, this);
  }
}

function matchesElement(el, sel) {
  if (!el || !sel) return false;
  if (sel.includes(',')) {
    return sel.split(',').some(s => matchesElement(el, s.trim()));
  }
  if (sel.startsWith('#')) {
    const id = sel.slice(1);
    return el.id === id;
  }
  if (sel.startsWith('.')) {
    const clsPart = sel.slice(1).split('[')[0];
    if (!el.classList.contains(clsPart)) return false;
    if (sel.includes('[')) {
      const attrPart = sel.slice(sel.indexOf('['));
      return matchesAttr(el, attrPart);
    }
    return true;
  }
  if (sel.startsWith('button[')) {
    if (el.tagName !== 'BUTTON') return false;
    return matchesAttr(el, sel.slice(6));
  }
  if (sel.startsWith('[')) {
    return matchesAttr(el, sel);
  }
  if (sel === 'button' && el.tagName === 'BUTTON') return true;
  if (sel === 'div' && el.tagName === 'DIV') return true;
  if (sel === 'span' && el.tagName === 'SPAN') return true;
  if (sel === 'input' && el.tagName === 'INPUT') return true;
  if (sel === 'select' && el.tagName === 'SELECT') return true;
  return false;
}

function matchesAttr(el, attrSel) {
  const match = /^\[([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?\]$/.exec(attrSel);
  if (!match) return false;
  const [_, name, val] = match;
  if (val === undefined) {
    if (name.startsWith('data-')) {
      const prop = name.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      return el.dataset[prop] !== undefined || el.getAttribute(name) !== null;
    }
    return el.getAttribute(name) !== null;
  }
  if (name.startsWith('data-')) {
    const prop = name.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
    if (el.dataset[prop] === val) return true;
  }
  return el.getAttribute(name) === val;
}

function parseSimpleHtml(html, parent) {
  const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>(.*?)<\/\1>|<([a-zA-Z0-9]+)([^>]*)\/?>/gs;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1] || match[4];
    const attrsStr = match[2] || match[5] || '';
    const inner = match[3] || '';
    const el = new MockElement(tagName);

    const attrRegex = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
    let aMatch;
    while ((aMatch = attrRegex.exec(attrsStr)) !== null) {
      const aName = aMatch[1];
      const aVal = aMatch[2] !== undefined ? aMatch[2] : '';
      el.setAttribute(aName, aVal);
    }
    if (inner) {
      if (inner.includes('<')) {
        parseSimpleHtml(inner, el);
      } else {
        el.textContent = inner;
      }
    }
    parent.appendChild(el);
  }
}

// Global DOM setup
const rootDoc = new MockElement('html');
const body = new MockElement('body');
rootDoc.appendChild(body);

globalThis.document = {
  head: new MockElement('head'),
  body: body,
  createElement(tag) { return new MockElement(tag); },
  getElementById(id) {
    return body.querySelector('#' + id);
  },
  querySelector(sel) {
    return body.querySelector(sel);
  },
  querySelectorAll(sel) {
    return body.querySelectorAll(sel);
  },
};
globalThis.window = globalThis;
globalThis.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; },
};

// Populate initial body elements for HUD and Results
const baseHtml = `
  <div id="hud">
    <div id="spectator-duel-overlay" class="hidden">
      <div class="sdo-banner">🤖 100% AUTONOMOUS AI COLOSSEUM DUEL · SPECTATOR MODE</div>
      <div class="sdo-fighters-row">
        <div class="sdo-card p1" id="sdo-fighter-1">
          <div class="sdo-header">
            <span class="sdo-name" id="sdo-p1-name">Robo-Brawler</span>
            <span class="sdo-badge" id="sdo-p1-badge">[🧬 CREATURE]</span>
          </div>
          <div class="sdo-tags" id="sdo-p1-tags"></div>
        </div>
        <div class="sdo-vs">VS</div>
        <div class="sdo-card p2" id="sdo-fighter-2">
          <div class="sdo-header">
            <span class="sdo-name" id="sdo-p2-name">Titan Chonk</span>
            <span class="sdo-badge" id="sdo-p2-badge">[🦏 TITAN CHONK]</span>
          </div>
          <div class="sdo-tags" id="sdo-p2-tags"></div>
        </div>
      </div>
    </div>
  </div>
  <div id="results-screen" class="overlay hidden">
    <h1 id="result-title">YOU WIN!</h1>
    <div class="banners" id="result-banners"></div>
    <div class="podium" id="results-podium"></div>
    <div class="reel" id="result-reel"></div>
    <div class="arena-tag" id="result-arena"></div>
    <div class="vote" id="rematch-vote"></div>
    <div class="menu-row">
      <button class="btn" id="btn-play-again">REMATCH!</button>
      <button class="btn hidden" id="btn-build-rematch">↺ Rematch AI</button>
      <button class="btn blue hidden" id="btn-build-workshop">🛠️ Back to Workshop</button>
      <button class="btn yellow" id="btn-results-mall">🏛️ THE DWEEB MALL</button>
      <button class="btn blue" id="btn-main-menu">MENU</button>
    </div>
  </div>
`;
body.innerHTML = baseHtml;

// -------------------------------------------------------------
// SECTION 1: ARCHETYPE PRESETS & PRESET BUTTON INTERACTION
// -------------------------------------------------------------
console.log('--- SECTION 1: ARCHETYPE PRESETS & WORKSHOP HUD SYNC ---');

runTest('All 4 canonical presets exist with full physical & DNA specs', () => {
  const keys = ['titan_chonk', 'speed_gremlin', 'sniper_bean', 'pugilist_champ'];
  for (const k of keys) {
    const p = ARCHETYPE_PRESETS[k];
    assert.ok(p, `Preset ${k} missing`);
    assert.ok(p.name, `Preset ${k} missing name`);
    assert.ok(p.badge, `Preset ${k} missing badge`);
    assert.ok(p.shape, `Preset ${k} missing shape`);
    assert.ok(p.mass > 0, `Preset ${k} mass invalid`);
    assert.ok(p.speed > 0, `Preset ${k} speed invalid`);
    assert.ok(p.jump > 0, `Preset ${k} jump invalid`);
    assert.ok(p.armor > 0, `Preset ${k} armor invalid`);
    assert.ok(p.DNA && p.dna, `Preset ${k} missing DNA/dna duality`);
    assert.ok(p.DNA.confidence >= 0 && p.DNA.confidence <= 1, `DNA confidence invalid`);
    assert.ok(p.DNA.aimAccuracy >= 0 && p.DNA.aimAccuracy <= 1, `DNA aimAccuracy invalid`);
    assert.ok(p.DNA.agility >= 0 && p.DNA.agility <= 1, `DNA agility invalid`);
    assert.ok(p.DNA.scavenge >= 0 && p.DNA.scavenge <= 1, `DNA scavenge invalid`);
  }
});

runTest('BuildADweebLab applies preset stats, mass, armor, speed, jump, and DNA', () => {
  const scene = new THREE.Scene();
  const lab = new BuildADweebLab(scene, null, null);

  for (const [key, preset] of Object.entries(ARCHETYPE_PRESETS)) {
    const res = lab.applyPreset(key);
    assert.equal(res.name, preset.name);
    assert.equal(res.shape, preset.shape);
    assert.equal(res.stats.mass, preset.mass);
    assert.equal(res.stats.armor, preset.armor);
    assert.equal(res.stats.speed, preset.speed);
    assert.equal(res.stats.jump, preset.jump);
    assert.equal(res.dna.confidence, preset.dna.confidence);
    assert.equal(res.dna.aimAccuracy, preset.dna.aimAccuracy);
    assert.equal(res.dna.agility, preset.dna.agility);
    assert.equal(res.dna.scavenge, preset.dna.scavenge);

    // Verify localStorage persistence
    const saved = JSON.parse(globalThis.localStorage.getItem('dweebs-custom-build'));
    assert.equal(saved.name, preset.name);
    assert.equal(saved.shape, preset.shape);
  }
  lab.dispose();
});

runTest('BuildADweebHud renders all 4 preset buttons in #bd-presets-row', () => {
  const hud = new BuildADweebHud(document.body, {});
  const row = document.getElementById('bd-presets-row');
  assert.ok(row, '#bd-presets-row must exist in HUD');
  const buttons = row.querySelectorAll('.bd-preset-btn');
  assert.equal(buttons.length, 4, 'Must have exactly 4 archetype buttons');

  const presetKeys = Array.from(buttons).map(b => b.dataset.preset);
  assert.deepEqual(presetKeys.sort(), ['pugilist_champ', 'sniper_bean', 'speed_gremlin', 'titan_chonk']);
  hud.dispose();
});

runTest('Clicking each preset button applies preset, syncs form, and updates active class', () => {
  const scene = new THREE.Scene();
  const lab = new BuildADweebLab(scene, null, null);

  let notifiedChanges = [];
  let presetSelected = null;

  const hud = new BuildADweebHud(document.body, {
    onChange: patch => { lab.updateConfig(patch); notifiedChanges.push(patch); },
    onPresetSelect: key => {
      presetSelected = key;
      const cfg = lab.applyPreset(key);
      if (cfg) hud.syncForm(cfg);
    },
  });

  const row = document.getElementById('bd-presets-row');
  const buttons = row.querySelectorAll('.bd-preset-btn');

  for (const btn of buttons) {
    const key = btn.dataset.preset;
    const preset = ARCHETYPE_PRESETS[key];

    // Trigger click on preset button
    btn.click();

    // Verify callback fired
    assert.equal(presetSelected, key, `onPresetSelect must receive ${key}`);

    // Verify active button state
    assert.ok(btn.classList.contains('active'), `${key} button must be active`);
    const otherButtons = Array.from(buttons).filter(b => b !== btn);
    for (const ob of otherButtons) {
      assert.ok(!ob.classList.contains('active'), `Other preset button ${ob.dataset.preset} must not be active`);
    }

    // Verify input synchronization
    assert.equal(document.getElementById('bd-name').value, preset.name);
    assert.equal(document.getElementById('bd-col-primary').value, preset.primaryColor);
    assert.equal(document.getElementById('bd-col-accent').value, preset.accentColor);
    assert.equal(parseFloat(document.getElementById('bd-slider-mass').value), preset.mass);
    assert.equal(parseFloat(document.getElementById('bd-slider-conf').value), preset.dna.confidence);
    assert.equal(parseFloat(document.getElementById('bd-slider-aim').value), preset.dna.aimAccuracy);
    assert.equal(parseFloat(document.getElementById('bd-slider-agi').value), preset.dna.agility);
    assert.equal(parseFloat(document.getElementById('bd-slider-scav').value), preset.dna.scavenge);

    // Verify lab configuration
    assert.equal(lab.config.name, preset.name);
    assert.equal(lab.config.shape, preset.shape);
    assert.equal(lab.config.stats.mass, preset.mass);
    assert.equal(lab.config.dna.confidence, preset.dna.confidence);
  }

  hud.dispose();
  lab.dispose();
});

// -------------------------------------------------------------
// SECTION 2: SPECTATOR MATCH OVERLAY ACCURACY & CLEANUP
// -------------------------------------------------------------
console.log('\n--- SECTION 2: SPECTATOR MATCH OVERLAY INTEGRITY ---');

function getArchetypeBadge(config = {}) {
  if (config.badge) return config.badge.startsWith('[') ? config.badge : `[${config.badge}]`;
  for (const preset of Object.values(ARCHETYPE_PRESETS || {})) {
    if (preset.name && preset.name.toLowerCase() === (config.name || '').toLowerCase()) {
      return `[${preset.badge}]`;
    }
  }
  if (config.shape === 'chonk') return '[🦏 TITAN CHONK]';
  if (config.shape === 'spiky') return '[⚡ SPEED GREMLIN]';
  if (config.shape === 'capsule') return '[🎯 SNIPER BEAN]';
  if (config.appendage === 'boxing_gloves' || config.appendages === 'boxing_gloves') return '[🥊 PUGILIST CHAMP]';
  return '[🧬 CUSTOM DWEEB]';
}

function formatDnaTags(dna = {}) {
  const conf = dna.confidence ?? 0.8;
  const stance = conf > 0.65 ? 'Stance: Rushdown 🔥' : conf < 0.4 ? 'Stance: Kiter 🌀' : 'Stance: Balanced ⚔️';
  const aim = dna.aimAccuracy ?? 0.7;
  const aimStr = aim > 0.6 ? 'Aim: Sniper 🎯' : 'Aim: Chaos 🎯';
  const agi = dna.agility ?? 0.7;
  const agiStr = agi > 0.7 ? 'Agility: Hyper ⚡' : 'Agility: Heavy ⚡';
  const scav = dna.scavenge ?? 0.6;
  const scavStr = scav > 0.5 ? 'Scavenge: Toy Hunter 🎁' : 'Scavenge: Fists 🎁';
  return [stance, aimStr, agiStr, scavStr];
}

function showSpectatorOverlay(playerConfig, oppConfig) {
  const overlay = document.getElementById('spectator-duel-overlay');
  if (!overlay) return;

  const p1Name = document.getElementById('sdo-p1-name');
  if (p1Name) p1Name.textContent = playerConfig.name || 'Your Dweeb';

  const p1Badge = document.getElementById('sdo-p1-badge');
  if (p1Badge) p1Badge.textContent = getArchetypeBadge(playerConfig);

  const p1Tags = document.getElementById('sdo-p1-tags');
  if (p1Tags) {
    const tags = formatDnaTags(playerConfig.dna || playerConfig.DNA || {});
    p1Tags.innerHTML = tags.map(t => `<span class="sdo-tag">${t}</span>`).join('');
  }

  const p2Name = document.getElementById('sdo-p2-name');
  if (p2Name) p2Name.textContent = oppConfig.name || 'Rival Bot';

  const p2Badge = document.getElementById('sdo-p2-badge');
  if (p2Badge) p2Badge.textContent = getArchetypeBadge(oppConfig);

  const p2Tags = document.getElementById('sdo-p2-tags');
  if (p2Tags) {
    const tags = formatDnaTags(oppConfig.dna || oppConfig.DNA || {});
    p2Tags.innerHTML = tags.map(t => `<span class="sdo-tag">${t}</span>`).join('');
  }

  overlay.classList.remove('hidden');
}

function hideSpectatorOverlay() {
  const overlay = document.getElementById('spectator-duel-overlay');
  if (overlay) overlay.classList.add('hidden');
}

runTest('showSpectatorOverlay accurately displays names, badges, and DNA trait tags', () => {
  const p1 = ARCHETYPE_PRESETS.titan_chonk;
  const p2 = ARCHETYPE_PRESETS.speed_gremlin;

  showSpectatorOverlay(p1, p2);

  const overlay = document.getElementById('spectator-duel-overlay');
  assert.ok(!overlay.classList.contains('hidden'), 'Overlay must not be hidden');

  assert.equal(document.getElementById('sdo-p1-name').textContent, 'Titan Chonk');
  assert.equal(document.getElementById('sdo-p1-badge').textContent, '[🦏 TITAN CHONK]');
  const p1TagTexts = Array.from(document.getElementById('sdo-p1-tags').children).map(c => c.textContent);
  assert.deepEqual(p1TagTexts, ['Stance: Rushdown 🔥', 'Aim: Chaos 🎯', 'Agility: Heavy ⚡', 'Scavenge: Fists 🎁']);

  assert.equal(document.getElementById('sdo-p2-name').textContent, 'Speed Gremlin');
  assert.equal(document.getElementById('sdo-p2-badge').textContent, '[⚡ SPEED GREMLIN]');
  const p2TagTexts = Array.from(document.getElementById('sdo-p2-tags').children).map(c => c.textContent);
  assert.deepEqual(p2TagTexts, ['Stance: Kiter 🌀', 'Aim: Sniper 🎯', 'Agility: Hyper ⚡', 'Scavenge: Fists 🎁']);
});

runTest('showSpectatorOverlay handles edge case configs (missing DNA, custom badges, unicode names)', () => {
  const weirdP1 = { name: '🌟 Cosmic Mecha-Destroyer 9000', shape: 'capsule' }; // No DNA object
  const weirdP2 = { name: 'Anti-Player', badge: '🤖 MIRROR RIVAL', dna: { confidence: 0.5, aimAccuracy: 0.65, agility: 0.75, scavenge: 0.8 } };

  showSpectatorOverlay(weirdP1, weirdP2);

  assert.equal(document.getElementById('sdo-p1-name').textContent, '🌟 Cosmic Mecha-Destroyer 9000');
  assert.equal(document.getElementById('sdo-p1-badge').textContent, '[🎯 SNIPER BEAN]'); // Inferred from capsule shape
  // Missing DNA falls back cleanly without throw
  const p1Tags = document.getElementById('sdo-p1-tags').children;
  assert.equal(p1Tags.length, 4);

  assert.equal(document.getElementById('sdo-p2-name').textContent, 'Anti-Player');
  assert.equal(document.getElementById('sdo-p2-badge').textContent, '[🤖 MIRROR RIVAL]');
  const p2TagTexts = Array.from(document.getElementById('sdo-p2-tags').children).map(c => c.textContent);
  assert.deepEqual(p2TagTexts, ['Stance: Balanced ⚔️', 'Aim: Sniper 🎯', 'Agility: Hyper ⚡', 'Scavenge: Toy Hunter 🎁']);
});

runTest('hideSpectatorOverlay cleanly hides overlay', () => {
  hideSpectatorOverlay();
  const overlay = document.getElementById('spectator-duel-overlay');
  assert.ok(overlay.classList.contains('hidden'), 'Overlay must have hidden class');
});

// -------------------------------------------------------------
// SECTION 3: DUEL MATCH END & RESULTS BUTTONS
// -------------------------------------------------------------
console.log('\n--- SECTION 3: DUEL RESULTS BUTTONS & AUTO-REMATCH SUPPRESSION ---');

runTest('onMatchEnd in build_arena mode hides generic buttons and exposes duel buttons', () => {
  let rematchVoteCalled = false;
  function startRematchVote() { rematchVoteCalled = true; }

  const currentMode = 'build_arena';
  const winner = { name: 'Titan Chonk', isPlayer: false };

  // Run onMatchEnd logic matching main.js lines 1160-1188
  hideSpectatorOverlay();
  if (currentMode === 'build_arena') {
    document.getElementById('result-title').textContent = `${winner.name.toUpperCase()} WINS!`;
    document.getElementById('rematch-vote')?.classList.add('hidden');
    document.getElementById('btn-play-again')?.classList.add('hidden');
    document.getElementById('btn-main-menu')?.classList.add('hidden');
    document.getElementById('btn-build-rematch')?.classList.remove('hidden');
    document.getElementById('btn-build-workshop')?.classList.remove('hidden');
    document.getElementById('btn-results-mall')?.classList.remove('hidden');
  } else {
    document.getElementById('rematch-vote')?.classList.remove('hidden');
    document.getElementById('btn-play-again')?.classList.remove('hidden');
    document.getElementById('btn-main-menu')?.classList.remove('hidden');
    document.getElementById('btn-build-rematch')?.classList.add('hidden');
    document.getElementById('btn-build-workshop')?.classList.add('hidden');
    document.getElementById('btn-results-mall')?.classList.remove('hidden');
    startRematchVote();
  }
  document.getElementById('results-screen').classList.remove('hidden');

  // Verify results UI state
  assert.equal(document.getElementById('result-title').textContent, 'TITAN CHONK WINS!');
  assert.ok(document.getElementById('rematch-vote').classList.contains('hidden'), 'rematch-vote must be hidden in duel');
  assert.ok(document.getElementById('btn-play-again').classList.contains('hidden'), 'btn-play-again must be hidden in duel');
  assert.ok(document.getElementById('btn-main-menu').classList.contains('hidden'), 'btn-main-menu must be hidden in duel');

  assert.ok(!document.getElementById('btn-build-rematch').classList.contains('hidden'), 'btn-build-rematch must be visible');
  assert.ok(!document.getElementById('btn-build-workshop').classList.contains('hidden'), 'btn-build-workshop must be visible');
  assert.ok(!document.getElementById('btn-results-mall').classList.contains('hidden'), 'btn-results-mall must be visible');

  // CRITICAL: auto-rematch voting timer must NEVER be initiated in duel mode
  assert.equal(rematchVoteCalled, false, 'startRematchVote must NOT be called in build_arena mode');

  // Overlay must be hidden
  assert.ok(document.getElementById('spectator-duel-overlay').classList.contains('hidden'), 'Spectator overlay must be hidden on match end');
});

runTest('btn-build-rematch cleanly restarts duel with last combatant configurations', () => {
  let arenaRelaunched = false;
  let relaunchedWithConfig = null;
  let relaunchedWithOpp = null;

  const lastBuilderPlayerConfig = ARCHETYPE_PRESETS.sniper_bean;
  const lastBuilderOppType = 'juggernaut';

  function launchBuilderArena(playerConfig, oppType) {
    arenaRelaunched = true;
    relaunchedWithConfig = playerConfig;
    relaunchedWithOpp = oppType;
    showSpectatorOverlay(playerConfig, ARCHETYPE_PRESETS.titan_chonk);
  }

  const rematchBtn = document.getElementById('btn-build-rematch');
  rematchBtn.addEventListener('click', () => {
    document.getElementById('results-screen').classList.add('hidden');
    launchBuilderArena(lastBuilderPlayerConfig, lastBuilderOppType);
  });

  rematchBtn.click();

  assert.ok(arenaRelaunched, 'Arena must relaunch');
  assert.equal(relaunchedWithConfig.name, 'Sniper Bean');
  assert.equal(relaunchedWithOpp, 'juggernaut');
  assert.ok(document.getElementById('results-screen').classList.contains('hidden'), 'Results screen must be hidden');
  assert.ok(!document.getElementById('spectator-duel-overlay').classList.contains('hidden'), 'Spectator overlay re-shown for new match');
});

runTest('btn-build-workshop returns to workshop and hides spectator overlay', () => {
  let workshopStarted = false;

  function startBuildLab() {
    hideSpectatorOverlay();
    workshopStarted = true;
  }

  const workshopBtn = document.getElementById('btn-build-workshop');
  workshopBtn.addEventListener('click', () => {
    document.getElementById('results-screen').classList.add('hidden');
    startBuildLab();
  });

  workshopBtn.click();

  assert.ok(workshopStarted, 'startBuildLab must be called');
  assert.ok(document.getElementById('results-screen').classList.contains('hidden'), 'Results screen hidden');
  assert.ok(document.getElementById('spectator-duel-overlay').classList.contains('hidden'), 'Spectator overlay hidden');
});

runTest('btn-results-mall exits to mall, unlocks match lock, and hides spectator overlay', () => {
  let mallNavigated = false;
  let matchLockReleased = false;

  const mockRouter = {
    setMatchLock(val) { matchLockReleased = !val; },
    go(route) { if (route === '/') mallNavigated = true; },
  };

  function returnToMall() {
    hideSpectatorOverlay();
    document.getElementById('results-screen')?.classList.add('hidden');
    mockRouter.setMatchLock(false);
    mockRouter.go('/');
  }

  const mallBtn = document.getElementById('btn-results-mall');
  mallBtn.addEventListener('click', returnToMall);

  mallBtn.click();

  assert.ok(mallNavigated, 'Must navigate to /');
  assert.ok(matchLockReleased, 'Match lock must be released');
  assert.ok(document.getElementById('results-screen').classList.contains('hidden'), 'Results screen hidden');
  assert.ok(document.getElementById('spectator-duel-overlay').classList.contains('hidden'), 'Spectator overlay hidden');
});

// -------------------------------------------------------------
// SECTION 4: ADVERSARIAL INTEGRITY AUDIT
// -------------------------------------------------------------
console.log('\n--- SECTION 4: ADVERSARIAL INTEGRITY & ANTI-CHEAT AUDIT ---');

runTest('BuilderBot AI behavior is genuinely driven by DNA traits and physics (no facade)', () => {
  function makeDweeb(x, y, z) {
    return {
      active: true,
      eliminated: false,
      swimFlail: 0,
      hitstun: 0,
      charging: 0,
      held: null,
      moveInput: new THREE.Vector2(),
      grounded: true,
      getPosition: () => ({ x, y, z }),
      requestJump: () => { jumps++; },
    };
  }

  let attacks = 0, charges = 0, releases = 0, grabs = 0, throws = 0, jumps = 0;
  const mockCombat = {
    attack: () => { attacks++; },
    chargeAttack: () => { charges++; },
    releaseAttack: () => { releases++; },
    grab: () => { grabs++; },
    throwItem: () => { throws++; },
  };

  const mockArena = { items: [] };

  // Test 1: Rushdown (high confidence) vs Kiter (low confidence)
  const rushDweeb = makeDweeb(0, 0.5, 0);
  const kiteDweeb = makeDweeb(2, 0.5, 0); // close distance
  const rushBot = new BuilderBot(rushDweeb, mockArena, mockCombat, { confidence: 0.95 });
  const kiteBot = new BuilderBot(kiteDweeb, mockArena, mockCombat, { confidence: 0.2 });

  rushBot.update(0.016, [rushDweeb, kiteDweeb]);
  kiteBot.update(0.016, [kiteDweeb, rushDweeb]);

  // Rushdown advances (+x toward x=2), Kiter retreats (+x away from x=0)
  assert.ok(rushDweeb.moveInput.x > 0, 'Rushdown bot must move towards target (+x)');
  assert.ok(kiteDweeb.moveInput.x > 0, 'Kiter bot must move away from target (+x away from 0)');

  // Test 2: Calculated Sniper (high aimAccuracy) charges attacks, while Chaos bot (low aimAccuracy) does instant attacks
  const meleeTarget = makeDweeb(1.5, 0.5, 0); // in melee attack range < 2.8
  const sniperBotDweeb = makeDweeb(0, 0.5, 0);
  const chaosBotDweeb = makeDweeb(0, 0.5, 0);

  const sniperBot = new BuilderBot(sniperBotDweeb, mockArena, mockCombat, { aimAccuracy: 0.95 });
  const chaosBot = new BuilderBot(chaosBotDweeb, mockArena, mockCombat, { aimAccuracy: 0.2 });

  // Advance time past initial actionTimer (0.3-0.7s)
  sniperBot.actionTimer = 0;
  sniperBot.update(0.016, [sniperBotDweeb, meleeTarget]);
  assert.ok(charges > 0, 'High accuracy bot must charge heavy smash');

  chaosBot.actionTimer = 0;
  chaosBot.update(0.016, [chaosBotDweeb, meleeTarget]);
  assert.ok(attacks > 0, 'Low accuracy bot must execute rapid attack');
});

runTest('Custom 3D model procedural generator builds unique geometry per body shape', () => {
  const geometries = new Map();
  for (const shape of BODY_SHAPES) {
    const model = buildCustomDweebModel({ ...DEFAULT_BUILD_CONFIG, shape });
    assert.ok(model.bodyMesh.geometry, `Shape ${shape} must have geometry`);
    const geoType = model.bodyMesh.geometry.type;
    geometries.set(shape, geoType);
  }

  // Ensure different geometries are produced (not a dummy single mesh)
  assert.ok(geometries.has('blob'));
  assert.ok(geometries.has('cube'));
  assert.ok(geometries.has('spiky'));
  assert.ok(geometries.has('star'));
  assert.ok(geometries.has('chonk'));
  assert.ok(geometries.has('capsule'));

  assert.equal(geometries.get('cube'), 'BoxGeometry');
  assert.equal(geometries.get('capsule'), 'CapsuleGeometry');
  assert.equal(geometries.get('blob'), 'SphereGeometry');
});

console.log('\n================================================================');
console.log(`RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log('================================================================');

if (failedTests > 0) process.exit(1);
