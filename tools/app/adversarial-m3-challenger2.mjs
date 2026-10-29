// adversarial-m3-challenger2.mjs
// Rigorous adversarial empirical challenge harness for Milestone 3: Dweeb Warfare Polish
import * as THREE from 'three';
import { POWER_COOLDOWNS, DweebWarfare } from '../../src/warfare/DweebWarfare.js';
import { WarfareHud, bestKey } from '../../src/warfare/WarfareHud.js';
import { createBattle, WF_DT } from '../../src/sim/warfareBattle.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
  } else {
    failedTests++;
    console.error(`  [FAIL] ${message}`);
    failures.push(message);
  }
}

async function runTest(suiteName, fn) {
  console.log(`\n▶ Running: ${suiteName}`);
  try {
    await fn();
    console.log(`  ✓ Passed`);
  } catch (err) {
    failedTests++;
    console.error(`  ✗ Threw error: ${err.message}\n${err.stack}`);
    failures.push(`${suiteName}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Robust DOM & Browser Environment Mock for Warfare
// ─────────────────────────────────────────────────────────────────────────────
class MockClassList {
  constructor() { this._set = new Set(); }
  add(...c) { for (const x of c) if (x) this._set.add(x); }
  remove(...c) { for (const x of c) if (x) this._set.delete(x); }
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
    const list = this._listeners.get(event) || [];
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }
  dispatchEvent(e) {
    if (!e.target) e.target = this;
    const list = this._listeners.get(e.type) || [];
    for (const fn of list) fn(e);
  }
  get firstElementChild() { return this.children[0] || null; }
  setAttribute(k, v) { this._attrs.set(k, String(v)); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
  getAttribute(k) { return this._attrs.get(k) || null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  remove() { if (this.parentElement) { const idx = this.parentElement.children.indexOf(this); if (idx >= 0) this.parentElement.children.splice(idx, 1); } }
  closest(sel) {
    let curr = this;
    while (curr) {
      if (sel.startsWith('[data-a]') && curr.dataset.a !== undefined) return curr;
      if (sel.startsWith('[data-u]') && curr.dataset.u !== undefined) return curr;
      if (sel === 'button' && curr.tagName === 'BUTTON') return curr;
      if (sel.includes('.wf-card') && curr.classList.contains('wf-card')) return curr;
      if (sel.includes('.wf-screen') && curr.classList.contains('wf-screen')) return curr;
      if (sel.includes('button,.wf-card,.wf-screen') && (curr.tagName === 'BUTTON' || curr.classList.contains('wf-card') || curr.classList.contains('wf-screen'))) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
  querySelector(sel) {
    for (const c of this.children) {
      if (sel === 'i' && c.tagName === 'I') return c;
      if (sel.startsWith('[data-cd-sweep]') && (c.dataset.cdSweep !== undefined || c.getAttribute('data-cd-sweep') !== null)) return c;
      if (sel.startsWith('[data-cd-text]') && (c.dataset.cdText !== undefined || c.getAttribute('data-cd-text') !== null)) return c;
      if (sel.startsWith('[data-f="') && (c.dataset.f === sel.slice(9, -2) || c.getAttribute('data-f') === sel.slice(9, -2))) return c;
      if (sel.startsWith('[data-s="') && (c.dataset.s === sel.slice(9, -2) || c.getAttribute('data-s') === sel.slice(9, -2))) return c;
      if (sel.includes('data-a="')) {
        const val = sel.split('data-a="')[1].replace(/["'\]]/g, '');
        if (c.dataset.a === val || c.getAttribute('data-a') === val) return c;
      }
      if (sel.startsWith('.') && c.classList.contains(sel.slice(1))) return c;
      const found = c.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll(sel) {
    const res = [];
    const walk = el => {
      for (const c of el.children) {
        if (sel.includes('button') && c.tagName === 'BUTTON') res.push(c);
        else if (sel.includes('.wf-card') && c.classList.contains('wf-card')) res.push(c);
        else if (sel.includes('.wf-diff button') && c.tagName === 'BUTTON' && el.classList.contains('wf-diff')) res.push(c);
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

// Global window and document wiring
const winListeners = new Map();
globalThis.document = {
  head: new MockElement('head'),
  body: new MockElement('body'),
  createElement(tag) { return new MockElement(tag); }
};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener(event, fn) {
    if (!winListeners.has(event)) winListeners.set(event, []);
    winListeners.get(event).push(fn);
  },
  removeEventListener(event, fn) {
    const list = winListeners.get(event) || [];
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  },
  dispatchEvent(e) {
    const list = winListeners.get(e.type) || [];
    for (const fn of list) fn(e);
  }
};
globalThis.localStorage = {
  _s: new Map(),
  getItem(k) { return this._s.has(k) ? this._s.get(k) : null; },
  setItem(k, v) { this._s.set(k, String(v)); },
  removeItem(k) { this._s.delete(k); }
};
globalThis.location = { search: '', hash: '#/warfare' };

console.log('================================================================');
console.log('CHALLENGER 2: EMPIRICAL ADVERSARIAL STRESS HARNESS — MILESTONE 3');
console.log('================================================================');

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 1: Cooldown Rejection for Artillery, Supply, and Stance
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 1.1: Artillery cooldown rejection & burst call spamming', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100);
  const canvas = new MockElement('canvas');
  const wf = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  wf.start('defense');

  // Initial state: 0 cd, plenty of coins
  wf.st.coins.blue = 100;
  assert(wf.powerCooldowns.artillery === 0, 'Artillery CD starts at 0');
  assert(wf.pending.length === 0, 'No pending commands initially');

  // Trigger 1: Execution succeeds
  wf.callArtillery();
  assert(wf.powerCooldowns.artillery === POWER_COOLDOWNS.artillery, `Artillery CD set to ${POWER_COOLDOWNS.artillery}s`);
  assert(wf.pending.length === 1, 'Exactly 1 command queued');
  assert(wf.pending[0].type === 'artillery', 'Command type is artillery');

  // Adversarial Attack: 100 rapid-fire calls while cooldown is active
  for (let i = 0; i < 100; i++) {
    wf.callArtillery();
  }
  assert(wf.pending.length === 1, 'Pending commands strictly remains 1 (all 100 spammed calls rejected before sim tick)');

  // Advance time by 5.0 seconds (artillery CD should be 5.0s remaining)
  // Each update tick will process pending commands in the sim
  for (let t = 0; t < 50; t++) wf.update(0.1);
  assert(Math.abs(wf.powerCooldowns.artillery - 5.0) < 0.05, `Artillery CD is ~5.0s (got ${wf.powerCooldowns.artillery})`);
  assert(wf.pending.length === 0, 'Previous command was consumed by sim step');

  // Call again at 5.0s remaining: must be rejected, pending must remain 0
  wf.callArtillery();
  assert(wf.pending.length === 0, 'Rejected at 5.0s cooldown (no new command queued)');

  // Advance remaining 5.1 seconds (51 ticks of 0.1 to account for IEEE-754 float precision)
  for (let t = 0; t < 51; t++) wf.update(0.1);
  assert(wf.powerCooldowns.artillery === 0, 'Artillery CD completely reached 0');

  // Now trigger again: should succeed
  wf.callArtillery();
  assert(wf.pending.length === 1, 'Second artillery command queued successfully after cooldown elapsed');
  assert(wf.powerCooldowns.artillery === POWER_COOLDOWNS.artillery, 'Artillery CD reset to 10.0s');

  wf.dispose();
});

await runTest('Adversarial 1.2: Coin cost gating under boundary and zero coin conditions', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100);
  const canvas = new MockElement('canvas');
  const wf = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  wf.start('defense');

  // Artillery costs 25 coins. Test boundary coins = 24
  wf.powerCooldowns.artillery = 0;
  wf.st.coins.blue = 24;
  wf.callArtillery();
  assert(wf.powerCooldowns.artillery === 0, 'Artillery rejected when coins = 24 (< 25)');
  assert(wf.pending.length === 0, 'No command queued on insufficient coins');

  // Supply costs 15 coins. Test boundary coins = 14
  wf.powerCooldowns.supply = 0;
  wf.st.coins.blue = 14;
  wf.callSupply();
  assert(wf.powerCooldowns.supply === 0, 'Supply rejected when coins = 14 (< 15)');
  assert(wf.pending.length === 0, 'No command queued on insufficient coins');

  // Stance costs 0 coins. Test with 0 coins
  wf.powerCooldowns.stance = 0;
  wf.st.coins.blue = 0;
  wf.toggleFormation();
  assert(wf.powerCooldowns.stance === POWER_COOLDOWNS.stance, 'Stance succeeds even with 0 coins (free ability)');
  assert(wf.pending.length === 1, 'Stance command queued');
  assert(wf.pending[0].type === 'stance', 'Command type is stance');

  wf.dispose();
});

await runTest('Adversarial 1.3: Stance toggle alternates formation between charge and defense', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100);
  const canvas = new MockElement('canvas');
  const wf = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  wf.start('defense');

  assert(!wf.currentStance || wf.currentStance === 'defense', 'Default stance');
  wf.powerCooldowns.stance = 0;
  wf.toggleFormation();
  assert(wf.currentStance === 'charge', 'Stance shifted to charge');
  assert(wf.pending[0].stance === 'charge');

  // Advance time to clear cooldown (4.1s = 41 ticks)
  for (let i = 0; i < 41; i++) wf.update(0.1);
  assert(wf.powerCooldowns.stance === 0, 'Stance CD cleared');
  assert(wf.pending.length === 0, 'Previous stance command consumed by sim');

  wf.toggleFormation();
  assert(wf.currentStance === 'defense', 'Stance shifted back to defense');
  assert(wf.pending.length === 1 && wf.pending[0].stance === 'defense', 'Second stance command queued with defense');

  wf.dispose();
});

await runTest('Adversarial 1.4: Powers strictly rejected outside playing phase (title, paused, over)', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100);
  const canvas = new MockElement('canvas');
  const wf = new DweebWarfare({ scene, camera, canvas, soundOn: false });

  // Phase is 'title' initially
  assert(wf.phase === 'title', 'Initially in title phase');
  wf.st.coins.blue = 1000;
  wf.callArtillery();
  wf.callSupply();
  wf.toggleFormation();
  assert(wf.pending.length === 0, 'No powers queued while in title phase');

  // Start playing, then pause
  wf.start('defense');
  wf.setPaused(true);
  assert(wf.phase === 'paused', 'In paused phase');
  wf.callArtillery();
  wf.callSupply();
  wf.toggleFormation();
  assert(wf.pending.length === 0, 'No powers queued while in paused phase');

  // Over phase
  wf.setPaused(false);
  wf.phase = 'over';
  wf.callArtillery();
  wf.callSupply();
  wf.toggleFormation();
  assert(wf.pending.length === 0, 'No powers queued while in over phase');

  wf.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 2: Input Vectors (Mouse Clicks, Touch, Keyboard Hotkeys)
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 2.1: WarfareHud buttons DOM disabled state and simulated clicks', () => {
  let dispatchedAction = null;
  const hud = new WarfareHud({ onAction: a => { dispatchedAction = a; } });
  const artBtn = hud.q('.wf-powers button[data-a="artillery"]');
  const supBtn = hud.q('.wf-powers button[data-a="supply"]');
  const stBtn = hud.q('.wf-powers button[data-a="stance"]');

  const mockState = {
    coins: { blue: 50 },
    units: [],
    forts: { blue: { hp: 1000, maxHp: 1000 }, red: { hp: 1000, maxHp: 1000 } }
  };

  // Case A: Fully available
  hud.render(mockState, { artillery: 0, supply: 0, stance: 0 });
  assert(!artBtn.disabled, 'Artillery button enabled when ready');
  assert(!artBtn.classList.contains('off'), 'Artillery button not off');
  assert(!artBtn.classList.contains('on-cd'), 'Artillery button not on-cd');

  // Click on ready button
  dispatchedAction = null;
  hud.root.dispatchEvent({ type: 'click', target: artBtn });
  assert(dispatchedAction === 'artillery', 'Dispatches artillery action on click when ready');

  // Case B: On Cooldown (Artillery 7.5s, Supply 3.2s)
  hud.render(mockState, { artillery: 7.5, supply: 3.2, stance: 0 });
  assert(artBtn.disabled === true, 'Artillery button disabled on cooldown');
  assert(artBtn.classList.contains('off'), 'Artillery has class off');
  assert(artBtn.classList.contains('disabled'), 'Artillery has class disabled');
  assert(artBtn.classList.contains('on-cd'), 'Artillery has class on-cd');

  const sweep = artBtn.querySelector('[data-cd-sweep]');
  const cdLabel = artBtn.querySelector('[data-cd-text]');
  assert(sweep.style.display === 'block', 'Cooldown sweep overlay is visible');
  assert(sweep.style.transform === 'scaleY(0.750)', `Cooldown sweep scaled proportionally (7.5/10.0 = 0.750, got ${sweep.style.transform})`);
  assert(cdLabel.style.display === 'flex', 'Cooldown text is visible');
  assert(cdLabel.textContent === '7.5s', `Cooldown text displays exact seconds ("7.5s", got "${cdLabel.textContent}")`);

  // Case C: Lacking Coins (Coins = 10, Cooldown = 0)
  const brokeState = { coins: { blue: 10 }, units: [], forts: mockState.forts };
  hud.render(brokeState, { artillery: 0, supply: 0, stance: 0 });
  assert(artBtn.disabled === true, 'Artillery button disabled when lacking coins');
  assert(artBtn.classList.contains('off'), 'Artillery has class off when lacking coins');
  assert(!artBtn.classList.contains('on-cd'), 'Artillery does NOT have class on-cd (not cooling down, just broke)');
  assert(sweep.style.display === 'none', 'Sweep overlay hidden when lacking coins');
  assert(cdLabel.style.display === 'none', 'CD label hidden when lacking coins');

  assert(supBtn.disabled === true, 'Supply button disabled when coins=10 < 15');
  assert(stBtn.disabled === false, 'Stance button remains enabled because cost is 0');

  hud.dispose();
});

await runTest('Adversarial 2.2: Keyboard hotkeys Q, E, R (case-insensitivity, modifier states, input guard)', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100);
  const canvas = new MockElement('canvas');
  const wf = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  wf.start('defense');
  wf.st.coins.blue = 100;

  // Press lowercase 'q'
  let prevented = false;
  window.dispatchEvent({ type: 'keydown', key: 'q', preventDefault: () => { prevented = true; } });
  assert(prevented, 'Q keydown prevented default browser behavior');
  assert(wf.pending.length === 1 && wf.pending[0].type === 'artillery', 'Lowercase q triggered artillery');
  assert(wf.powerCooldowns.artillery === 10.0, 'Artillery placed on 10s cooldown');

  // Press uppercase 'Q' while on cooldown
  prevented = false;
  window.dispatchEvent({ type: 'keydown', key: 'Q', preventDefault: () => { prevented = true; } });
  assert(prevented, 'Q keydown handled');
  assert(wf.pending.length === 1, 'Uppercase Q rejected during cooldown');

  // Reset CD and test uppercase 'Q' succeeds
  wf.powerCooldowns.artillery = 0;
  window.dispatchEvent({ type: 'keydown', key: 'Q', preventDefault: () => {} });
  assert(wf.pending.length === 2 && wf.pending[1].type === 'artillery', 'Uppercase Q succeeds when ready');

  // Test 'e' / 'E' for Supply
  wf.powerCooldowns.supply = 0;
  window.dispatchEvent({ type: 'keydown', key: 'e', preventDefault: () => {} });
  assert(wf.pending.length === 3 && wf.pending[2].type === 'supply', 'Key e triggered supply');
  assert(wf.powerCooldowns.supply === 8.0, 'Supply placed on 8s cooldown');

  // Test 'r' / 'R' for Stance
  wf.powerCooldowns.stance = 0;
  window.dispatchEvent({ type: 'keydown', key: 'r', preventDefault: () => {} });
  assert(wf.pending.length === 4 && wf.pending[3].type === 'stance', 'Key r triggered stance');
  assert(wf.powerCooldowns.stance === 4.0, 'Stance placed on 4s cooldown');

  // Typing in form field: target is INPUT element
  const inputEl = new MockElement('input');
  wf.powerCooldowns.artillery = 0;
  wf.pending.length = 0;
  window.dispatchEvent({ type: 'keydown', key: 'q', target: inputEl, preventDefault: () => {} });
  assert(wf.pending.length === 0, 'Hotkeys safely ignored when typing in an INPUT element');

  wf.dispose();
});

await runTest('Adversarial 2.3: Touch/pointer interactions on HUD buttons prevent board rally flag placement', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const artBtn = hud.q('.wf-powers button[data-a="artillery"]');

  let stopped = false;
  const pointerEv = {
    type: 'pointerdown',
    target: artBtn,
    stopPropagation: () => { stopped = true; }
  };

  hud.root.dispatchEvent(pointerEv);
  assert(stopped, 'pointerdown on HUD power button calls stopPropagation to protect board rally flag');

  hud.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 3: Frontline Meter Center Notch, Smoothing & Delta Time Stability
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 3.1: Frontline bar center divider notch CSS structure', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const cssText = hud.style.textContent;

  assert(cssText.includes('.wf-frontline-bar::after'), 'CSS defines ::after pseudo-element for frontline divider');
  assert(cssText.includes('left:50%'), 'Divider is positioned at left: 50%');
  assert(cssText.includes('transform:translateX(-50%)'), 'Divider is perfectly centered via translateX(-50%)');
  assert(cssText.includes('pointer-events:none'), 'Divider does not intercept pointer clicks');

  const frontlineBar = hud.q('.wf-frontline-bar');
  assert(frontlineBar !== null, 'Frontline bar element exists in HUD');
  assert(frontlineBar.firstElementChild.getAttribute('data-f') === 'frontlineBar', 'Frontline bar inner fill exists');

  hud.dispose();
});

await runTest('Adversarial 3.2: Frontline bar lerp smoothing under extreme delta times (dt=0, 0.016, 1.0, 100.0)', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const baseForts = { blue: { hp: 1000, maxHp: 1000 }, red: { hp: 1000, maxHp: 1000 } };

  // Setup state where units are pushed to blue side (x = -20)
  // flPct = ((avgX + 40) / 80) * 100 = ((-20 + 40) / 80) * 100 = 25%
  const stateLeft = {
    mode: 'defense',
    wave: 1,
    coins: { blue: 50 },
    forts: baseForts,
    units: [
      { id: 1, team: 'blue', alive: true, x: -20 },
      { id: 2, team: 'red', alive: true, x: -20 }
    ]
  };

  // 1. Initial update (dt = 0.016): initializes smoothFl to 25%
  hud.update(stateLeft, 'blue', 0.016);
  assert(Math.abs(hud.smoothFl - 25) < 0.001, `Initial smoothFl matches target 25% (got ${hud.smoothFl})`);

  // Now change units to red side (x = +20)
  // target flPct = ((20 + 40) / 80) * 100 = 75%
  const stateRight = {
    mode: 'defense',
    wave: 1,
    coins: { blue: 50 },
    forts: baseForts,
    units: [
      { id: 1, team: 'blue', alive: true, x: 20 },
      { id: 2, team: 'red', alive: true, x: 20 }
    ]
  };

  // 2. Test dt = 0: no change, no NaN, smoothFl stays 25
  hud.update(stateRight, 'blue', 0);
  assert(hud.smoothFl === 25, 'dt = 0 does not alter smoothFl');
  assert(!Number.isNaN(hud.smoothFl), 'smoothFl is not NaN');

  // 3. Test dt = 0.016 (60 FPS): smooth continuous movement
  // rate = min(1, 0.016 * 5) = 0.08
  // delta = (75 - 25) * 0.08 = 4.0 -> smoothFl = 29.0
  hud.update(stateRight, 'blue', 0.016);
  assert(Math.abs(hud.smoothFl - 29.0) < 0.05, `dt = 0.016 updates smoothly to ~29.0 (got ${hud.smoothFl})`);

  // 4. Test dt = 1.0 (huge lag spike): Math.min(1, dt * 5) caps rate to 1.0
  // Should cleanly snap to 75% without overshooting!
  hud.update(stateRight, 'blue', 1.0);
  assert(Math.abs(hud.smoothFl - 75.0) < 0.001, `dt = 1.0 cleanly reaches 75.0 without overshoot (got ${hud.smoothFl})`);

  // 5. Test dt = 100.0 (extreme freeze): Math.min(1, dt * 5) caps rate to 1.0
  // Move back to left (target 25%)
  hud.update(stateLeft, 'blue', 100.0);
  assert(Math.abs(hud.smoothFl - 25.0) < 0.001, `dt = 100.0 cleanly reaches 25.0 without exploding (got ${hud.smoothFl})`);

  hud.dispose();
});

await runTest('Adversarial 3.3: Clamping limits and dead unit filtering in frontline meter', () => {
  const hud = new WarfareHud({ onAction: () => {} });
  const baseForts = { blue: { hp: 1000, maxHp: 1000 }, red: { hp: 1000, maxHp: 1000 } };

  // Case A: 0 units alive (e.g. before wave spawns or all wiped)
  const emptyState = {
    mode: 'defense',
    wave: 1,
    coins: { blue: 50 },
    forts: baseForts,
    units: [
      { id: 1, team: 'blue', alive: false, x: -100 },
      { id: 2, team: 'red', alive: false, x: 100 }
    ]
  };
  hud.update(emptyState, 'blue', 0.033);
  assert(hud.f('nb').textContent === 0, 'Blue alive count is 0');
  assert(hud.f('nr').textContent === 0, 'Red alive count is 0');
  // avgX = 0, flPct = 50%
  assert(Math.abs(hud.smoothFl - 50.0) < 0.01, 'Defaults to exactly 50% center when no units are alive');

  // Case B: Extreme out-of-bounds position (x = -9999)
  const extremeLeftState = {
    mode: 'defense',
    wave: 1,
    coins: { blue: 50 },
    forts: baseForts,
    units: [{ id: 1, team: 'blue', alive: true, x: -9999 }]
  };
  hud.update(extremeLeftState, 'blue', 1.0);
  assert(hud.smoothFl === 5, `Strictly clamped to min 5% (got ${hud.smoothFl}%)`);

  // Case C: Extreme out-of-bounds position (x = +9999)
  const extremeRightState = {
    mode: 'defense',
    wave: 1,
    coins: { blue: 50 },
    forts: baseForts,
    units: [{ id: 1, team: 'red', alive: true, x: 9999 }]
  };
  hud.update(extremeRightState, 'blue', 1.0);
  assert(hud.smoothFl === 95, `Strictly clamped to max 95% (got ${hud.smoothFl}%)`);

  hud.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 4: Results Screen Accuracy and Mall Navigation Cleanliness
// ─────────────────────────────────────────────────────────────────────────────
await runTest('Adversarial 4.1: Results screen stats formatting under victory and defeat scenarios', () => {
  const hud = new WarfareHud({ onAction: () => {} });

  // Victory scenario: wave 20 cleared, 142 kills, 3m 45s, 19,550 score
  hud.showEnd({
    won: true,
    title: 'VICTORY!',
    sub: 'The fort held through all 20 waves on normal!',
    waves: '20 / 20',
    kills: 142,
    time: '03:45',
    score: 19550,
    stats: [
      ['waves cleared', '20/20'],
      ['enemies popped', 142]
    ]
  });

  assert(hud.f('endTitle').textContent === 'VICTORY!', 'Title is VICTORY!');
  assert(hud.f('endTitle').style.color === '#5ee06a', 'Title color is victory green');
  assert(hud.f('endWaves').textContent === '20 / 20', 'Waves defended is 20 / 20');
  assert(hud.f('endKills').textContent === '142', 'Enemies slain is 142');
  assert(hud.f('endTime').textContent === '03:45', 'Match time is 03:45');
  assert(hud.f('endScore').textContent === '19,550', 'Score is formatted with thousand separator (19,550)');

  // Defeat scenario: wave 8 reached (7 cleared), 38 kills, 1m 20s, 4,200 score
  hud.showEnd({
    won: false,
    title: 'DEFEAT',
    sub: 'The fort fell on wave 8 (normal).',
    waves: '7 / 20',
    kills: 38,
    time: '01:20',
    score: 4200,
    stats: []
  });

  assert(hud.f('endTitle').textContent === 'DEFEAT', 'Title is DEFEAT');
  assert(hud.f('endTitle').style.color === '#ff4d5e', 'Title color is defeat red');
  assert(hud.f('endWaves').textContent === '7 / 20', 'Waves defended is 7 / 20');
  assert(hud.f('endKills').textContent === '38', 'Enemies slain is 38');
  assert(hud.f('endTime').textContent === '01:20', 'Match time is 01:20');
  assert(hud.f('endScore').textContent === '4,200', 'Score is formatted with thousand separator (4,200)');

  hud.dispose();
});

await runTest('Adversarial 4.2: End screen buttons and clean exit to Mall lifecycle', () => {
  let exitInvoked = 0;
  let restartInvoked = 0;
  let quitInvoked = 0;

  const onExit = () => {
    exitInvoked++;
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100);
  const canvas = new MockElement('canvas');
  const wf = new DweebWarfare({ scene, camera, canvas, onExit, soundOn: false });
  wf.start('defense');

  // Trigger end of game
  wf._end();
  assert(wf.phase === 'over', 'Phase transitioned to over');

  const endScreen = wf.hud.q('[data-s="end"]');
  assert(!endScreen.classList.contains('wf-hidden'), 'End screen is visible');

  const replayBtn = endScreen.querySelector('[data-a="restart"]');
  const mallBtn = endScreen.querySelector('[data-a="exit"]');
  const menuBtn = endScreen.querySelector('[data-a="quit"]');

  assert(replayBtn !== null, 'Replay button exists');
  assert(replayBtn.classList.contains('wf-btn-replay'), 'Replay button has wf-btn-replay styling');
  assert(mallBtn !== null, 'Exit to Mall button exists');
  assert(mallBtn.classList.contains('wf-btn-mall'), 'Exit to Mall button has wf-btn-mall styling');

  // Click Exit to Mall button
  wf.hud.root.dispatchEvent({ type: 'click', target: mallBtn });
  assert(exitInvoked === 1, 'Clicking Exit to Mall invokes onExit handler cleanly');

  // Verify dispose cleans up event listeners and body classes
  wf.dispose();
  assert(!document.body.classList.contains('warfare-active'), 'warfare-active class removed from document.body on dispose');
});

await runTest('Adversarial 4.3: Results screen extreme score formatting and empty stats resilience', () => {
  const hud = new WarfareHud({ onAction: () => {} });

  // 1. Extreme 7-digit score
  hud.showEnd({
    won: true,
    waves: '20 / 20',
    kills: 9999,
    time: '59:59',
    score: 1234567,
    stats: []
  });
  assert(hud.f('endScore').textContent === '1,234,567', '7-digit score formatted with comma separators');

  // 2. Zero stats
  hud.showEnd({
    won: false,
    waves: '0 / 20',
    kills: 0,
    time: '00:00',
    score: 0,
    stats: []
  });
  assert(hud.f('endScore').textContent === '0', '0 score displayed cleanly');
  assert(hud.f('endWaves').textContent === '0 / 20', '0 waves displayed');
  assert(hud.f('endKills').textContent === '0', '0 kills displayed');
  assert(hud.f('endTime').textContent === '00:00', '00:00 time displayed');

  // 3. String score fallback
  hud.showEnd({
    won: false,
    score: 'N/A'
  });
  assert(hud.f('endScore').textContent === 'N/A', 'String score supported without crash');

  hud.dispose();
});

await runTest('Adversarial 4.4: Replay and Menu actions from results screen', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100);
  const canvas = new MockElement('canvas');
  const wf = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  wf.start('defense');
  wf._end();

  // Test Replay button action
  wf._action('restart');
  assert(wf.phase === 'playing', 'Restart action resets phase to playing');
  assert(wf.powerCooldowns.artillery === 0, 'Restart resets power cooldowns to 0');
  assert(wf.powerCooldowns.supply === 0, 'Restart resets supply cooldown to 0');
  assert(wf.powerCooldowns.stance === 0, 'Restart resets stance cooldown to 0');

  // Test Quit button action
  wf._end();
  wf._action('quit');
  assert(wf.phase === 'title', 'Quit action returns to title attract phase');
  assert(wf.attract === true, 'Attract mode active');

  wf.dispose();
});

await runTest('Adversarial 4.5: Local 2-Player PvP commander hotkeys [ and ]', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100);
  const canvas = new MockElement('canvas');
  const wf = new DweebWarfare({ scene, camera, canvas, soundOn: false });
  wf.isLocalPvp = true;
  wf.start('versus');
  wf.st.coins.red = 100;

  // Player 2 presses '[' for Artillery Barrage
  let prevented = false;
  window.dispatchEvent({ type: 'keydown', key: '[', preventDefault: () => { prevented = true; } });
  assert(prevented, "Key '[' keydown prevented default browser behavior");
  assert(wf.pending.length === 1 && wf.pending[0].type === 'artillery', 'P2 [ key triggered artillery');
  assert(wf.pending[0].team === 'red', 'Artillery commanded for red team');

  // Player 2 presses ']' while artillery on cooldown, but supply ready
  prevented = false;
  wf.st.coins.red = 100;
  window.dispatchEvent({ type: 'keydown', key: ']', preventDefault: () => { prevented = true; } });
  assert(prevented, "Key ']' keydown prevented default browser behavior");
  assert(wf.pending.length === 2 && wf.pending[1].type === 'supply', 'P2 ] key triggered supply');
  assert(wf.pending[1].team === 'red', 'Supply commanded for red team');

  wf.dispose();
});

console.log('\n================================================================');
console.log(`TOTAL ADVERSARIAL TESTS: ${totalTests}`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${failedTests}`);
console.log('================================================================');

if (failedTests > 0) {
  console.error('\nFAILURES RECORDED:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
} else {
  console.log('\n>>> ALL EMPIRICAL ADVERSARIAL CHALLENGES CONFIRMED AND PASSED! <<<');
  process.exit(0);
}
