// challenge-m3.mjs — Comprehensive Empirical Challenge & Stress Harness for Milestone 3: Dweeb Warfare Polish
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { POWER_COOLDOWNS, DweebWarfare } from '../src/warfare/DweebWarfare.js';
import { WarfareHud, bestKey } from '../src/warfare/WarfareHud.js';
import { FINAL_WAVE } from '../src/sim/warfareWaves.js';

// Setup DOM mocks for Headless Node environment
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
    this.classList = new MockClassList();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this._attrs = new Map();
    this.textContent = '';
    this._innerHTML = '';
    this.disabled = false;
    this.parentElement = null;
    this._listeners = new Map();
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
  stopPropagation() {
    this._stopped = true;
  }
  get firstElementChild() { return this.children[0] || null; }
  setAttribute(k, v) {
    this._attrs.set(k, String(v));
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
  get innerHTML() { return this._innerHTML; }
  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    parseHtmlToMock(html, this);
  }
}

function matchesElement(el, sel) {
  if (!el || !sel) return false;
  if (sel.includes(',')) {
    return sel.split(',').some(s => matchesElement(el, s.trim()));
  }
  // Check for descendant selector (e.g. ".wf-powers button")
  if (sel.includes(' ')) {
    const parts = sel.split(/\s+/);
    const last = parts[parts.length - 1];
    if (!matchesSingle(el, last)) return false;
    let curr = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (curr && !matchesSingle(curr, parts[i])) {
        curr = curr.parentElement;
      }
      if (!curr) return false;
      curr = curr.parentElement;
    }
    return true;
  }
  return matchesSingle(el, sel);
}

function matchesSingle(el, sel) {
  if (sel === 'button' && el.tagName === 'BUTTON') return true;
  if (sel === 'span' && el.tagName === 'SPAN') return true;
  if (sel === 'i' && el.tagName === 'I') return true;
  if (sel === 'div' && el.tagName === 'DIV') return true;
  if (sel.startsWith('.')) {
    const cls = sel.slice(1).split('[')[0];
    if (!el.classList.contains(cls)) return false;
    if (sel.includes('[')) {
      const attrPart = sel.slice(sel.indexOf('['));
      return matchesAttr(el, attrPart);
    }
    return true;
  }
  if (sel.startsWith('button[')) {
    if (el.tagName !== 'BUTTON') return false;
    const attrPart = sel.slice(6);
    return matchesAttr(el, attrPart);
  }
  if (sel.startsWith('[')) {
    return matchesAttr(el, sel);
  }
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
    return el.dataset[prop] === val || el.getAttribute(name) === val;
  }
  return el.getAttribute(name) === val;
}

function parseHtmlToMock(html, rootParent) {
  const stack = [rootParent];
  const tagRe = /<\/?([a-zA-Z0-9_-]+)([^>]*?)(\/?)>/g;
  let match;
  let lastIndex = 0;
  while ((match = tagRe.exec(html)) !== null) {
    const isClosing = match[0].startsWith('</');
    const tagName = match[1].toLowerCase();
    const attrsStr = match[2];
    const isSelfClosing = match[3] === '/' || ['input', 'img', 'br', 'hr', 'meta', 'link'].includes(tagName);
    const parent = stack[stack.length - 1];

    const text = html.slice(lastIndex, match.index).trim();
    if (text && parent && !parent.children.length) {
      parent.textContent = text;
    }
    lastIndex = tagRe.lastIndex;

    if (isClosing) {
      if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tagName) {
        stack.pop();
      }
    } else {
      const el = new MockElement(tagName);
      const attrRe = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
      let aMatch;
      while ((aMatch = attrRe.exec(attrsStr)) !== null) {
        const name = aMatch[1];
        const val = aMatch[2] !== undefined ? aMatch[2] : '';
        if (name === 'class') {
          for (const c of val.split(/\s+/).filter(Boolean)) el.classList.add(c);
        } else {
          el.setAttribute(name, val);
        }
      }
      parent.appendChild(el);
      if (!isSelfClosing) {
        stack.push(el);
      }
    }
  }
}

// Global browser shims
const eventListeners = new Map();
globalThis.document = {
  head: new MockElement('head'),
  body: new MockElement('body'),
  createElement(tag) { return new MockElement(tag); }
};
globalThis.window = {
  innerWidth: 1024,
  innerHeight: 768,
  addEventListener(t, f) {
    if (!eventListeners.has(t)) eventListeners.set(t, []);
    eventListeners.get(t).push(f);
  },
  removeEventListener(t, f) {
    const list = eventListeners.get(t);
    if (list) {
      const idx = list.indexOf(f);
      if (idx >= 0) list.splice(idx, 1);
    }
  },
  dispatchEvent(e) {
    for (const f of eventListeners.get(e.type) || []) f(e);
    return true;
  }
};
globalThis.location = { search: '', hash: '' };
globalThis.localStorage = {
  _store: new Map(),
  getItem(k) { return this._store.get(k) || null; },
  setItem(k, v) { this._store.set(k, String(v)); },
  removeItem(k) { this._store.delete(k); },
  clear() { this._store.clear(); }
};

let passCount = 0;
let failCount = 0;
const failures = [];

function challenge(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    failures.push({ name, error: err });
    console.error(`  ✗ ${name}\n    Error: ${err.message}`);
  }
}

console.log('================================================================');
console.log('EMPIRICAL CHALLENGER: Milestone 3 Dweeb Warfare Polish');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Group 1: Power Cooldown Logic & Rapid-Fire Stress Test
// -----------------------------------------------------------------------------
console.log('--- Group 1: Power Cooldown Logic & Rapid-Fire Stress Test ---');

challenge('Artillery 10s cooldown and coin cost (25) guard', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const canvas = new MockElement('canvas');
  const game = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  game.start('defense');

  // Verify initial cooldowns
  assert.equal(game.powerCooldowns.artillery, 0);
  assert.equal(game.powerCooldowns.supply, 0);
  assert.equal(game.powerCooldowns.stance, 0);

  // Set coins below 25
  game.st.coins.blue = 24;
  game.callArtillery();
  assert.equal(game.powerCooldowns.artillery, 0, 'Must NOT trigger cooldown when coins < 25');
  assert.equal(game.pending.filter(c => c.type === 'artillery').length, 0, 'Must NOT queue artillery command');

  // Give enough coins
  game.st.coins.blue = 100;
  game.callArtillery();
  assert.equal(game.powerCooldowns.artillery, 10.0, 'Artillery CD must be set to 10.0s');
  assert.equal(game.pending.filter(c => c.type === 'artillery').length, 1, 'Artillery command must be queued');

  // Rapid spam 500 times in the same tick
  for (let i = 0; i < 500; i++) {
    game.callArtillery();
  }
  assert.equal(game.pending.filter(c => c.type === 'artillery').length, 1, 'Spamming while on CD must NOT queue additional commands');
  assert.equal(game.powerCooldowns.artillery, 10.0, 'Cooldown must remain intact');

  game.dispose();
});

challenge('Emergency Supply 8s cooldown and coin cost (15) guard', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const canvas = new MockElement('canvas');
  const game = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  game.start('defense');

  // Coins below 15
  game.st.coins.blue = 14;
  game.callSupply();
  assert.equal(game.powerCooldowns.supply, 0, 'Must NOT trigger cooldown when coins < 15');
  assert.equal(game.pending.filter(c => c.type === 'supply').length, 0);

  // Enough coins
  game.st.coins.blue = 50;
  game.callSupply();
  assert.equal(game.powerCooldowns.supply, 8.0, 'Supply CD must be set to 8.0s');
  assert.equal(game.pending.filter(c => c.type === 'supply').length, 1);

  // Rapid spam 500 times
  for (let i = 0; i < 500; i++) {
    game.callSupply();
  }
  assert.equal(game.pending.filter(c => c.type === 'supply').length, 1);
  assert.equal(game.powerCooldowns.supply, 8.0);

  game.dispose();
});

challenge('Stance shift 4s cooldown and state alternation', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const canvas = new MockElement('canvas');
  const game = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  game.start('defense');

  // Stance costs 0 coins, initial stance undefined/default
  game.toggleFormation();
  assert.equal(game.currentStance, 'charge', 'First stance shift toggles to charge');
  assert.equal(game.powerCooldowns.stance, 4.0, 'Stance CD must be set to 4.0s');
  assert.equal(game.pending.filter(c => c.type === 'stance').length, 1);

  // Rapid spam 500 times
  for (let i = 0; i < 500; i++) {
    game.toggleFormation();
  }
  assert.equal(game.pending.filter(c => c.type === 'stance').length, 1);
  assert.equal(game.currentStance, 'charge', 'Stance must NOT toggle while on cooldown');

  // Advance time past 4s
  for (let t = 0; t < 41; t++) {
    game.update(0.1);
  }
  assert.equal(game.powerCooldowns.stance, 0, 'Stance CD must decay to 0');

  // Second stance shift toggles back to defense
  game.toggleFormation();
  assert.equal(game.currentStance, 'defense', 'Second stance shift toggles back to defense');
  assert.equal(game.powerCooldowns.stance, 4.0);

  game.dispose();
});

challenge('Cooldown decay math, delta clamping, and recovery', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const canvas = new MockElement('canvas');
  const game = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  game.start('defense');

  game.st.coins.blue = 100;
  game.callArtillery();
  game.callSupply();
  game.toggleFormation();

  assert.equal(game.powerCooldowns.artillery, 10.0);
  assert.equal(game.powerCooldowns.supply, 8.0);
  assert.equal(game.powerCooldowns.stance, 4.0);

  // Update with rawDt = 0.5 (should be clamped to dt = 0.1)
  game.update(0.5);
  assert.equal(Math.round(game.powerCooldowns.artillery * 10) / 10, 9.9, 'Artillery CD decrements by clamped dt (0.1)');
  assert.equal(Math.round(game.powerCooldowns.supply * 10) / 10, 7.9, 'Supply CD decrements by clamped dt (0.1)');
  assert.equal(Math.round(game.powerCooldowns.stance * 10) / 10, 3.9, 'Stance CD decrements by clamped dt (0.1)');

  // Step 40 times with 0.1s dt (total 4.0s forward)
  for (let i = 0; i < 40; i++) {
    game.update(0.1);
  }
  assert.equal(Math.round(game.powerCooldowns.stance * 10) / 10, 0, 'Stance must be ready at 4.0s');
  assert.equal(Math.round(game.powerCooldowns.supply * 10) / 10, 3.9, 'Supply at ~3.9s remaining');
  assert.equal(Math.round(game.powerCooldowns.artillery * 10) / 10, 5.9, 'Artillery at ~5.9s remaining');

  // Step another 40 times with 0.1s dt
  for (let i = 0; i < 40; i++) {
    game.update(0.1);
  }
  assert.equal(game.powerCooldowns.supply, 0, 'Supply must be ready at 8.0s');
  assert.equal(Math.round(game.powerCooldowns.artillery * 10) / 10, 1.9, 'Artillery at ~1.9s remaining');

  // Step another 25 times with 0.1s dt
  for (let i = 0; i < 25; i++) {
    game.update(0.1);
  }
  assert.equal(game.powerCooldowns.artillery, 0, 'Artillery must be ready at 10.0s');
  assert.equal(game.powerCooldowns.supply, 0);
  assert.equal(game.powerCooldowns.stance, 0);

  // New powers should now succeed immediately
  game.pending = [];
  game.callArtillery();
  assert.equal(game.powerCooldowns.artillery, 10.0);
  assert.equal(game.pending.filter(c => c.type === 'artillery').length, 1);

  game.dispose();
});

// -----------------------------------------------------------------------------
// Group 2: WarfareHud Visual Overlays, Sweep Scaling & Gating
// -----------------------------------------------------------------------------
console.log('\n--- Group 2: WarfareHud Visual Overlays, Sweep Scaling & Gating ---');

challenge('WarfareHud buttons existence, attributes, and styles', () => {
  let actionTriggered = null;
  const hud = new WarfareHud({ onAction: a => { actionTriggered = a; } });

  const artBtn = hud.q('.wf-powers button[data-a="artillery"]');
  const supBtn = hud.q('.wf-powers button[data-a="supply"]');
  const stBtn = hud.q('.wf-powers button[data-a="stance"]');

  assert.ok(artBtn, 'Artillery button found');
  assert.ok(supBtn, 'Supply button found');
  assert.ok(stBtn, 'Stance button found');

  assert.ok(artBtn.classList.contains('red'));
  assert.ok(supBtn.classList.contains('blue'));
  assert.ok(stBtn.classList.contains('alt'));

  hud.dispose();
});

challenge('Cooldown sweep vertical scaling and countdown text precision', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const artBtn = hud.q('.wf-powers button[data-a="artillery"]');
  const supBtn = hud.q('.wf-powers button[data-a="supply"]');
  const stBtn = hud.q('.wf-powers button[data-a="stance"]');

  const artSweep = artBtn.querySelector('[data-cd-sweep]');
  const artLabel = artBtn.querySelector('[data-cd-text]');
  const supSweep = supBtn.querySelector('[data-cd-sweep]');
  const supLabel = supBtn.querySelector('[data-cd-text]');
  const stSweep = stBtn.querySelector('[data-cd-sweep]');
  const stLabel = stBtn.querySelector('[data-cd-text]');

  const st = { coins: { blue: 100 }, units: [], forts: { blue: { hp: 1000, maxHp: 1000 }, red: { hp: 1000, maxHp: 1000 } } };

  // 100% cooldowns (initial firing)
  hud.updatePowers(st, { artillery: 10.0, supply: 8.0, stance: 4.0 });

  assert.equal(artSweep.style.display, 'block');
  assert.equal(artSweep.style.transform, 'scaleY(1.000)');
  assert.equal(artLabel.style.display, 'flex');
  assert.equal(artLabel.textContent, '10.0s');
  assert.equal(artBtn.disabled, true);
  assert.ok(artBtn.classList.contains('on-cd'));

  assert.equal(supSweep.style.transform, 'scaleY(1.000)');
  assert.equal(supLabel.textContent, '8.0s');

  assert.equal(stSweep.style.transform, 'scaleY(1.000)');
  assert.equal(stLabel.textContent, '4.0s');

  // Half cooldowns
  hud.updatePowers(st, { artillery: 5.0, supply: 4.0, stance: 2.0 });
  assert.equal(artSweep.style.transform, 'scaleY(0.500)');
  assert.equal(artLabel.textContent, '5.0s');
  assert.equal(supSweep.style.transform, 'scaleY(0.500)');
  assert.equal(supLabel.textContent, '4.0s');
  assert.equal(stSweep.style.transform, 'scaleY(0.500)');
  assert.equal(stLabel.textContent, '2.0s');

  // Fractional cooldown (e.g. 0.3s remaining)
  hud.updatePowers(st, { artillery: 0.3, supply: 0, stance: 0 });
  assert.equal(artSweep.style.transform, 'scaleY(0.030)');
  assert.equal(artLabel.textContent, '0.3s');
  assert.equal(supSweep.style.display, 'none');
  assert.equal(supLabel.style.display, 'none');
  assert.equal(stSweep.style.display, 'none');
  assert.equal(stLabel.style.display, 'none');

  // 0s cooldowns (ready)
  hud.updatePowers(st, { artillery: 0, supply: 0, stance: 0 });
  assert.equal(artSweep.style.display, 'none');
  assert.equal(artLabel.style.display, 'none');
  assert.equal(artBtn.disabled, false);
  assert.equal(artBtn.classList.contains('on-cd'), false);
  assert.equal(artBtn.classList.contains('off'), false);

  hud.dispose();
});

challenge('Differentiating on-cd vs lacking-coins disabled states', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const artBtn = hud.q('.wf-powers button[data-a="artillery"]');
  const supBtn = hud.q('.wf-powers button[data-a="supply"]');
  const stBtn = hud.q('.wf-powers button[data-a="stance"]');

  // Case A: 0 coins, cd = 0
  const poorState = { coins: { blue: 0 } };
  hud.updatePowers(poorState, { artillery: 0, supply: 0, stance: 0 });

  assert.equal(artBtn.disabled, true, 'Artillery disabled due to 0 coins');
  assert.ok(artBtn.classList.contains('off'));
  assert.ok(artBtn.classList.contains('disabled'));
  assert.equal(artBtn.classList.contains('on-cd'), false, 'NOT on-cd');
  assert.equal(artBtn.querySelector('[data-cd-sweep]').style.display, 'none', 'No sweep when lacking coins');
  assert.equal(artBtn.querySelector('[data-cd-text]').style.display, 'none', 'No countdown text when lacking coins');

  assert.equal(supBtn.disabled, true, 'Supply disabled due to 0 coins');
  assert.equal(supBtn.classList.contains('on-cd'), false);

  assert.equal(stBtn.disabled, false, 'Stance costs 0, so ready even with 0 coins');
  assert.equal(stBtn.classList.contains('off'), false);

  // Case B: 20 coins, cd = 0 (can afford supply, cannot afford artillery)
  const midState = { coins: { blue: 20 } };
  hud.updatePowers(midState, { artillery: 0, supply: 0, stance: 0 });
  assert.equal(artBtn.disabled, true);
  assert.equal(supBtn.disabled, false, 'Supply costs 15, should be enabled with 20 coins');
  assert.equal(stBtn.disabled, false);

  hud.dispose();
});

// -----------------------------------------------------------------------------
// Group 3: Frontline Tug-of-War Lerp Smoothing & Unit Counts
// -----------------------------------------------------------------------------
console.log('\n--- Group 3: Frontline Tug-of-War Lerp Smoothing & Unit Counts ---');

challenge('Frontline lerp exponential smoothing and stability', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const forts = { blue: { hp: 1000, maxHp: 1000 }, red: { hp: 1000, maxHp: 1000 } };

  // Initial balanced state at center (avgX = 0 => flPct = 50%)
  const st1 = {
    mode: 'defense',
    wave: 1,
    coins: { blue: 50 },
    forts,
    units: [
      { id: 1, team: 'blue', alive: true, x: -10 },
      { id: 2, team: 'red', alive: true, x: 10 }
    ]
  };

  hud.update(st1, 'blue', 0.033, { artillery: 0, supply: 0, stance: 0 });
  assert.equal(hud.smoothFl, 50, 'Initial smoothFl should be initialized to exactly 50%');

  // Push blue line hard to x = 32 (target flPct = ((32 + 40)/80)*100 = 90%)
  const st2 = {
    mode: 'defense',
    wave: 1,
    coins: { blue: 50 },
    forts,
    units: [
      { id: 1, team: 'blue', alive: true, x: 32 }
    ]
  };

  // Step 1 frame (16.6ms)
  hud.update(st2, 'blue', 0.0166, { artillery: 0, supply: 0, stance: 0 });
  // Target is 90%. In 1 frame: smoothFl += (90 - 50) * min(1, 0.0166 * 5) = 40 * 0.0833 = ~3.33 => ~53.33%
  assert.ok(hud.smoothFl > 50 && hud.smoothFl < 55, `Frontline smoothed step should be ~53.3%, was ${hud.smoothFl.toFixed(2)}%`);

  // Step multiple frames over 1.0 second (30 steps of 0.033s)
  for (let i = 0; i < 30; i++) {
    hud.update(st2, 'blue', 0.033, { artillery: 0, supply: 0, stance: 0 });
  }
  // Should have smoothly converged near 90% without overshooting
  assert.ok(hud.smoothFl >= 89.0 && hud.smoothFl <= 90.0, `Frontline should converge near 90%, was ${hud.smoothFl.toFixed(2)}%`);

  // Zero-dt step: smoothFl must remain unchanged
  const beforeVal = hud.smoothFl;
  hud.update(st2, 'blue', 0, { artillery: 0, supply: 0, stance: 0 });
  assert.equal(hud.smoothFl, beforeVal, 'Zero dt should not change smoothFl');

  // Huge-dt step (dt = 100): Math.min(1, dt * 5) = 1, should snap to 90% without overshooting
  hud.update(st2, 'blue', 100, { artillery: 0, supply: 0, stance: 0 });
  assert.equal(hud.smoothFl, 90, 'Huge dt should snap to target (90%) without overshooting');

  hud.dispose();
});

challenge('Frontline boundary clamping [5%, 95%] and empty unit handling', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const forts = { blue: { hp: 1000, maxHp: 1000 }, red: { hp: 1000, maxHp: 1000 } };

  // 1. Extreme left units (avgX = -500)
  const stFarLeft = {
    mode: 'defense', wave: 1, coins: { blue: 10 }, forts,
    units: [{ id: 1, team: 'blue', alive: true, x: -500 }]
  };
  hud.update(stFarLeft, 'blue', 1.0, {});
  assert.equal(hud.smoothFl, 5, 'Must clamp to 5% at extreme left');

  // 2. Extreme right units (avgX = +500)
  const stFarRight = {
    mode: 'defense', wave: 1, coins: { blue: 10 }, forts,
    units: [{ id: 1, team: 'red', alive: true, x: 500 }]
  };
  hud.update(stFarRight, 'blue', 1.0, {});
  assert.equal(hud.smoothFl, 95, 'Must clamp to 95% at extreme right');

  // 3. No units alive (empty units array)
  const stEmpty = {
    mode: 'defense', wave: 1, coins: { blue: 10 }, forts,
    units: []
  };
  hud.update(stEmpty, 'blue', 1.0, {});
  assert.equal(hud.smoothFl, 50, 'Must default to 50% when no units exist');

  // 4. All dead units
  const stAllDead = {
    mode: 'defense', wave: 1, coins: { blue: 10 }, forts,
    units: [
      { id: 1, team: 'blue', alive: false, x: -80 },
      { id: 2, team: 'red', alive: false, x: -80 }
    ]
  };
  hud.update(stAllDead, 'blue', 1.0, {});
  assert.equal(hud.smoothFl, 50, 'Must default to 50% when all units dead');

  hud.dispose();
});

challenge('Alive unit counter chip strictly excludes dead units', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const forts = { blue: { hp: 1000, maxHp: 1000 }, red: { hp: 1000, maxHp: 1000 } };

  const st = {
    mode: 'defense',
    wave: 3,
    coins: { blue: 25 },
    forts,
    units: [
      { id: 1, team: 'blue', alive: true, x: 0 },
      { id: 2, team: 'blue', alive: true, x: 1 },
      { id: 3, team: 'blue', alive: false, x: 2 }, // dead
      { id: 4, team: 'blue', alive: false, x: 3 }, // dead
      { id: 5, team: 'red', alive: true, x: 10 },
      { id: 6, team: 'red', alive: false, x: 11 }, // dead
      { id: 7, team: 'red', alive: false, x: 12 }, // dead
      { id: 8, team: 'red', alive: false, x: 13 }  // dead
    ]
  };

  hud.update(st, 'blue', 0.033, {});
  assert.equal(hud.f('nb').textContent, 2, 'Alive blue count must be 2');
  assert.equal(hud.f('nr').textContent, 1, 'Alive red count must be 1');

  hud.dispose();
});

// -----------------------------------------------------------------------------
// Group 4: Match Results Overlay, Score Card & Action Buttons
// -----------------------------------------------------------------------------
console.log('\n--- Group 4: Match Results Overlay, Score Card & Action Buttons ---');

challenge('Match Results Hero Card & Action Buttons in WarfareHud', () => {
  let actionCalled = null;
  const hud = new WarfareHud({ onAction: a => { actionCalled = a; } });

  // Verify elements exist in template
  assert.ok(hud.f('scoreHero'), 'Score Hero card container must exist');
  assert.ok(hud.f('endWaves'), 'endWaves element must exist');
  assert.ok(hud.f('endKills'), 'endKills element must exist');
  assert.ok(hud.f('endTime'), 'endTime element must exist');
  assert.ok(hud.f('endScore'), 'endScore element must exist');

  const endScreen = hud.q('[data-s="end"]');
  const replayBtn = endScreen.querySelector('[data-a="restart"]');
  const mallBtn = endScreen.querySelector('[data-a="exit"]');
  const menuBtn = endScreen.querySelector('[data-a="quit"]');

  assert.ok(replayBtn, 'Replay button must exist in end screen');
  assert.ok(replayBtn.classList.contains('wf-btn-replay'), 'Replay button must have .wf-btn-replay');
  assert.ok(mallBtn, 'Mall exit button must exist in end screen');
  assert.ok(mallBtn.classList.contains('wf-btn-mall'), 'Mall button must have .wf-btn-mall');
  assert.ok(menuBtn, 'Menu button must exist');

  // Trigger showEnd
  hud.showEnd({
    won: true,
    title: 'VICTORY!',
    sub: `The fort held through all ${FINAL_WAVE} waves!`,
    waves: `${FINAL_WAVE} / ${FINAL_WAVE}`,
    kills: 142,
    time: '05:32',
    score: 24750,
    stats: [
      ['waves cleared', `${FINAL_WAVE}/${FINAL_WAVE}`],
      ['enemies popped', 142],
      ['dweebs lost', 8],
      ['time', '332s']
    ]
  });

  assert.equal(hud.f('endTitle').textContent, 'VICTORY!');
  assert.equal(hud.f('endWaves').textContent, `${FINAL_WAVE} / ${FINAL_WAVE}`);
  assert.equal(hud.f('endKills').textContent, '142');
  assert.equal(hud.f('endTime').textContent, '05:32');
  assert.equal(hud.f('endScore').textContent, '24,750', 'Score must format with commas');

  // Click simulation on Replay button
  replayBtn.dispatchEvent({ type: 'click', target: replayBtn });
  assert.equal(actionCalled, 'restart', 'Clicking replay button dispatches restart action');

  // Click simulation on Mall Exit button
  mallBtn.dispatchEvent({ type: 'click', target: mallBtn });
  assert.equal(actionCalled, 'exit', 'Clicking mall button dispatches exit action');

  hud.dispose();
});

challenge('DweebWarfare end-of-game score calculation and routing', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const canvas = new MockElement('canvas');
  let exitCalled = false;
  const game = new DweebWarfare({
    scene,
    camera,
    canvas,
    soundOn: false,
    onExit: () => { exitCalled = true; }
  });

  game.start('defense');
  game.st.winner = 'blue';
  game.st.wave = FINAL_WAVE;
  game.st.stats.blue.kills = 50;
  game.st.stats.blue.dmgDealt = 4000;
  game.st.tick = 3000; // 3000 * (1/30) = 100s

  game._end();

  assert.equal(game.phase, 'over');
  assert.equal(game.hud.f('endWaves').textContent, `${FINAL_WAVE} / ${FINAL_WAVE}`);
  assert.equal(game.hud.f('endKills').textContent, '50');
  assert.equal(game.hud.f('endTime').textContent, '1:40');

  // Total score formula: (FINAL_WAVE * 500) + (50 * 25) + round(4000 * 0.5) + 2000
  // = (10 * 500) + 1250 + 2000 + 2000 = 5000 + 1250 + 2000 + 2000 = 10,250
  assert.equal(game.hud.f('endScore').textContent, '10,250');

  // Test action routing from end screen
  game._action('exit');
  assert.equal(exitCalled, true, 'Action "exit" must invoke onExit callback');

  game.dispose();
});

// -----------------------------------------------------------------------------
// Group 5: Hotkey Dispatch & Keyboard Interaction
// -----------------------------------------------------------------------------
console.log('\n--- Group 5: Hotkey Dispatch & Keyboard Interaction ---');

challenge('Keydown hotkeys (Q, E, R) in playing vs non-playing states', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const canvas = new MockElement('canvas');
  const game = new DweebWarfare({ scene, camera, canvas, soundOn: false });

  // In title state: hotkeys must be ignored
  window.dispatchEvent({ type: 'keydown', key: 'q', target: canvas, preventDefault() {} });
  window.dispatchEvent({ type: 'keydown', key: 'e', target: canvas, preventDefault() {} });
  window.dispatchEvent({ type: 'keydown', key: 'r', target: canvas, preventDefault() {} });
  assert.equal(game.powerCooldowns.artillery, 0);
  assert.equal(game.powerCooldowns.supply, 0);
  assert.equal(game.powerCooldowns.stance, 0);

  // In playing state
  game.start('defense');
  game.st.coins.blue = 100;

  // Press 'q'
  window.dispatchEvent({ type: 'keydown', key: 'q', target: canvas, preventDefault() {} });
  assert.equal(game.powerCooldowns.artillery, 10.0, 'Key Q must trigger Artillery');
  assert.equal(game.pending.filter(c => c.type === 'artillery').length, 1);

  // Press 'e'
  window.dispatchEvent({ type: 'keydown', key: 'e', target: canvas, preventDefault() {} });
  assert.equal(game.powerCooldowns.supply, 8.0, 'Key E must trigger Supply');
  assert.equal(game.pending.filter(c => c.type === 'supply').length, 1);

  // Press 'r'
  window.dispatchEvent({ type: 'keydown', key: 'r', target: canvas, preventDefault() {} });
  assert.equal(game.powerCooldowns.stance, 4.0, 'Key R must trigger Stance');
  assert.equal(game.pending.filter(c => c.type === 'stance').length, 1);

  // Input element focus guard: typing 'q' into an input field should NOT trigger power
  const inputEl = new MockElement('input');
  window.dispatchEvent({ type: 'keydown', key: 'q', target: inputEl, preventDefault() {} });

  game.dispose();
});

console.log('\n================================================================');
console.log(`RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
}
