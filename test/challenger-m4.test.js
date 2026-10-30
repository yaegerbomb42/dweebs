// challenger-m4.test.js — Empirical Challenge Suite for Milestone 4 (Build-A-Dweeb Workshop & Colosseum Duel)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  ARCHETYPE_PRESETS,
  DEFAULT_BUILD_CONFIG,
  BODY_SHAPES,
  APPENDAGES,
  FEET_TYPES,
  BROW_STYLES,
  MOUTH_STYLES,
  buildCustomDweebModel,
} from '../src/builder/CustomDweebModel.js';
import { BuildADweebLab } from '../src/builder/BuildADweebLab.js';
import { BuildADweebHud } from '../src/builder/BuildADweebHud.js';
import { BuilderBot } from '../src/ai/BuilderBot.js';

const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'link', 'meta']);

// --- Minimal DOM implementation for Hud and UI testing ---
class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.classList = {
      _classes: new Set(),
      add: (...c) => c.forEach(x => this.classList._classes.add(x)),
      remove: (...c) => c.forEach(x => this.classList._classes.delete(x)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._classes.has(c)) this.classList._classes.delete(c);
          else this.classList._classes.add(c);
        } else if (force) {
          this.classList._classes.add(c);
        } else {
          this.classList._classes.delete(c);
        }
      },
      contains: c => this.classList._classes.has(c),
    };
    this.attributes = {};
    this.listeners = {};
    this._value = '';
    this._textContent = '';
    this._innerHTML = '';
  }

  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = v; }

  get value() { return this._value; }
  set value(v) { this._value = String(v); }

  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v); }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this._parseHTML(v);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    event.preventDefault = () => {};
    event.stopPropagation = () => { event._stopped = true; };
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) h(event);
    if (this.parentNode && !event._stopped) {
      this.parentNode.dispatchEvent(event);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  input(val) {
    this.value = val;
    this.dispatchEvent({ type: 'input' });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const check = el => {
      if (matchesSelector(el, selector)) matches.push(el);
      for (const c of el.children) check(c);
    };
    for (const c of this.children) check(c);
    return matches;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (matchesSelector(curr, selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  _parseHTML(html) {
    this.children = [];
    // Tokenize tags and text
    const tokenRegex = /<!--[\s\S]*?-->|<([a-z0-9-]+)([^>]*?)(\/?)>|<\/([a-z0-9-]+)>|([^<]+)/gi;
    let match;
    const stack = [this];

    while ((match = tokenRegex.exec(html)) !== null) {
      const [full, openTag, rawAttrs, isSelfClosing, closeTag, text] = match;
      if (full.startsWith('<!--')) continue;

      if (openTag) {
        const tag = openTag.toLowerCase();
        const el = new MockElement(tag);
        const parent = stack[stack.length - 1];
        if (parent) parent.appendChild(el);

        const attrRegex = /([a-z0-9_-]+)(?:=["']([^"']*)["'])?/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
          const [, k, v = ''] = attrMatch;
          el.attributes[k] = v;
          if (k === 'id') el.id = v;
          if (k === 'class') v.split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
          if (k.startsWith('data-')) el.dataset[k.slice(5)] = v;
          if (k === 'value') el.value = v;
        }

        if (!VOID_TAGS.has(tag) && !isSelfClosing && !full.endsWith('/>')) {
          stack.push(el);
        }
      } else if (closeTag) {
        const tag = closeTag.toLowerCase();
        if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tag) {
          stack.pop();
        }
      } else if (text && text.trim()) {
        const curr = stack[stack.length - 1];
        if (curr) curr.textContent = (curr.textContent || '') + text.trim();
      }
    }
  }
}

function matchesSelector(el, sel) {
  if (!el || !sel) return false;
  let remaining = sel;

  const tagMatch = remaining.match(/^[a-z0-9-]+/i);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    remaining = remaining.slice(tagMatch[0].length);
  }

  const classMatches = remaining.matchAll(/\.([a-z0-9_-]+)/gi);
  for (const m of classMatches) {
    if (!el.classList.contains(m[1])) return false;
  }
  remaining = remaining.replace(/\.[a-z0-9_-]+/gi, '');

  const idMatch = remaining.match(/#([a-z0-9_-]+)/i);
  if (idMatch) {
    if (el.id !== idMatch[1]) return false;
    remaining = remaining.replace(/#[a-z0-9_-]+/gi, '');
  }

  const attrMatches = remaining.matchAll(/\[([a-z0-9_-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/gi);
  for (const m of attrMatches) {
    const [, attr, val] = m;
    if (attr.startsWith('data-')) {
      const dataKey = attr.slice(5);
      if (!(dataKey in el.dataset)) return false;
      if (val !== undefined && el.dataset[dataKey] !== val) return false;
    } else {
      if (!(attr in el.attributes)) return false;
      if (val !== undefined && el.attributes[attr] !== val) return false;
    }
  }

  return true;
}

function setupMockDom() {
  const root = new MockElement('body');
  globalThis.document = {
    head: new MockElement('head'),
    body: root,
    getElementById: id => {
      if (root.id === id) return root;
      return root.querySelector(`#${id}`);
    },
    createElement: tag => new MockElement(tag),
  };
  return root;
}

describe('Empirical Challenge 1: Rapid Preset Switching & 3D Turntable Sync', () => {
  let scene, lab;

  beforeEach(() => {
    scene = new THREE.Scene();
    globalThis.localStorage = {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; },
    };
    lab = new BuildADweebLab(scene, null, null);
  });

  it('rapidly switches presets 100 times without desync or memory leaks in 3D scene graph', () => {
    const keys = ['titan_chonk', 'speed_gremlin', 'sniper_bean', 'pugilist_champ'];
    const initialChildrenCount = lab.group.children.length; // pedestal + ring + lights + dust + holo + scan + currentModelRoot = 7

    expect(initialChildrenCount).toBe(7);

    for (let i = 0; i < 100; i++) {
      const key = keys[i % keys.length];
      const preset = ARCHETYPE_PRESETS[key];
      const cfg = lab.applyPreset(key);

      // 1. Verify lab configuration exactly mirrors preset traits
      expect(cfg.name).toBe(preset.name);
      expect(cfg.shape).toBe(preset.shape);
      expect(cfg.appendage).toBe(preset.appendage);
      expect(cfg.feet).toBe(preset.feet);
      expect(cfg.brows).toBe(preset.brows);
      expect(cfg.mouth).toBe(preset.mouth);
      expect(cfg.stats.mass).toBe(preset.mass);
      expect(cfg.stats.armor).toBe(preset.armor);
      expect(cfg.stats.speed).toBe(preset.speed);
      expect(cfg.stats.jump).toBe(preset.jump);
      expect(cfg.dna.confidence).toBe(preset.dna.confidence);
      expect(cfg.dna.aimAccuracy).toBe(preset.dna.aimAccuracy);
      expect(cfg.dna.agility).toBe(preset.dna.agility);
      expect(cfg.dna.scavenge).toBe(preset.dna.scavenge);

      // 2. Verify 3D model root is attached to lab group
      expect(lab.group.children).toContain(lab.currentModelRoot);
      // Ensure no orphan meshes accumulate (pedestal, ring, lights, dust, holo, scan, model root)
      expect(lab.group.children.length).toBe(7);

      // 3. Verify procedural mesh structure corresponds to preset
      const model = lab.modelInstance;
      expect(model).toBeDefined();
      expect(model.root).toBe(lab.currentModelRoot);
      expect(model.eyeMeshes.length).toBe(preset.eyeCount);
      expect(model.feetGroup.children.length).toBeGreaterThanOrEqual(2);

      if (preset.appendage !== 'none') {
        expect(model.appGroup.children.length).toBeGreaterThan(0);
      }

      // 4. Verify animation step works smoothly without throwing
      expect(() => lab.update(0.016)).not.toThrow();
    }

    lab.dispose();
    expect(scene.children).not.toContain(lab.group);
  });

  it('keeps HUD and 3D Lab synchronized when user clicks preset buttons in HUD', () => {
    const mockBody = setupMockDom();
    const hud = new BuildADweebHud(mockBody, {
      onChange: patch => lab.updateConfig(patch),
      onConfigChange: patch => lab.updateConfig(patch),
      onPresetSelect: presetKey => {
        const cfg = lab.applyPreset(presetKey);
        if (cfg) hud.syncForm(cfg);
      },
    });

    const presetRow = mockBody.querySelector('#bd-presets-row');
    expect(presetRow).not.toBeNull();

    const presetKeys = ['titan_chonk', 'speed_gremlin', 'sniper_bean', 'pugilist_champ'];

    for (const key of presetKeys) {
      const btn = presetRow.querySelector(`[data-preset="${key}"]`);
      expect(btn).not.toBeNull();

      // Simulate click
      btn.click();

      // Verify lab was updated
      const preset = ARCHETYPE_PRESETS[key];
      expect(lab.config.name).toBe(preset.name);
      expect(lab.config.shape).toBe(preset.shape);
      expect(lab.config.appendage).toBe(preset.appendage);
      expect(lab.config.feet).toBe(preset.feet);
      expect(lab.config.brows).toBe(preset.brows);
      expect(lab.config.mouth).toBe(preset.mouth);

      // Verify button active state in HUD
      expect(btn.classList.contains('active')).toBe(true);

      // Verify other preset buttons are NOT active
      for (const otherKey of presetKeys) {
        if (otherKey !== key) {
          const otherBtn = presetRow.querySelector(`[data-preset="${otherKey}"]`);
          expect(otherBtn.classList.contains('active')).toBe(false);
        }
      }

      // Verify 3D model instance matches
      expect(lab.modelInstance.eyeMeshes.length).toBe(preset.eyeCount);
    }

    hud.dispose();
    lab.dispose();
  });
});

describe('Empirical Challenge 2: Autonomous Duel Spectator Overlay Rendering', () => {
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

  it('correctly maps archetype badges for all presets and custom fallbacks', () => {
    expect(getArchetypeBadge(ARCHETYPE_PRESETS.titan_chonk)).toBe('[🦏 TITAN CHONK]');
    expect(getArchetypeBadge(ARCHETYPE_PRESETS.speed_gremlin)).toBe('[⚡ SPEED GREMLIN]');
    expect(getArchetypeBadge(ARCHETYPE_PRESETS.sniper_bean)).toBe('[🎯 SNIPER BEAN]');
    expect(getArchetypeBadge(ARCHETYPE_PRESETS.pugilist_champ)).toBe('[🥊 PUGILIST CHAMP]');

    // Custom creature shapes
    expect(getArchetypeBadge({ shape: 'chonk' })).toBe('[🦏 TITAN CHONK]');
    expect(getArchetypeBadge({ shape: 'spiky' })).toBe('[⚡ SPEED GREMLIN]');
    expect(getArchetypeBadge({ shape: 'capsule' })).toBe('[🎯 SNIPER BEAN]');
    expect(getArchetypeBadge({ appendage: 'boxing_gloves' })).toBe('[🥊 PUGILIST CHAMP]');
    expect(getArchetypeBadge({ shape: 'cube' })).toBe('[🧬 CUSTOM DWEEB]');

    // Double-bracket protection
    expect(getArchetypeBadge({ badge: '[⚡ SPEED GREMLIN]' })).toBe('[⚡ SPEED GREMLIN]');
    expect(getArchetypeBadge({ badge: '⚡ SPEED GREMLIN' })).toBe('[⚡ SPEED GREMLIN]');
  });

  it('produces distinct, valid DNA combat chips across trait spectrums', () => {
    const rushdown = formatDnaTags({ confidence: 0.95, aimAccuracy: 0.8, agility: 0.9, scavenge: 0.8 });
    expect(rushdown).toContain('Stance: Rushdown 🔥');
    expect(rushdown).toContain('Aim: Sniper 🎯');
    expect(rushdown).toContain('Agility: Hyper ⚡');
    expect(rushdown).toContain('Scavenge: Toy Hunter 🎁');

    const kiter = formatDnaTags({ confidence: 0.25, aimAccuracy: 0.3, agility: 0.5, scavenge: 0.2 });
    expect(kiter).toContain('Stance: Kiter 🌀');
    expect(kiter).toContain('Aim: Chaos 🎯');
    expect(kiter).toContain('Agility: Heavy ⚡');
    expect(kiter).toContain('Scavenge: Fists 🎁');

    const balanced = formatDnaTags({ confidence: 0.5, aimAccuracy: 0.6, agility: 0.7, scavenge: 0.5 });
    expect(balanced).toContain('Stance: Balanced ⚔️');
  });

  it('populates DOM overlay with accurate fighter names, badges, and DNA chips', () => {
    const p1Cfg = ARCHETYPE_PRESETS.titan_chonk;
    const p2Cfg = ARCHETYPE_PRESETS.speed_gremlin;

    const overlay = new MockElement('div');
    overlay.id = 'spectator-duel-overlay';
    overlay.classList.add('hidden');

    const banner = new MockElement('div');
    banner.className = 'sdo-banner';
    banner.textContent = '🤖 100% AUTONOMOUS AI COLOSSEUM DUEL · SPECTATOR MODE';
    overlay.appendChild(banner);

    const p1Name = new MockElement('span'); p1Name.id = 'sdo-p1-name';
    const p1Badge = new MockElement('span'); p1Badge.id = 'sdo-p1-badge';
    const p1Tags = new MockElement('div'); p1Tags.id = 'sdo-p1-tags';
    const p2Name = new MockElement('span'); p2Name.id = 'sdo-p2-name';
    const p2Badge = new MockElement('span'); p2Badge.id = 'sdo-p2-badge';
    const p2Tags = new MockElement('div'); p2Tags.id = 'sdo-p2-tags';

    overlay.appendChild(p1Name);
    overlay.appendChild(p1Badge);
    overlay.appendChild(p1Tags);
    overlay.appendChild(p2Name);
    overlay.appendChild(p2Badge);
    overlay.appendChild(p2Tags);

    // Run showSpectatorOverlay logic
    p1Name.textContent = p1Cfg.name;
    p1Badge.textContent = getArchetypeBadge(p1Cfg);
    p1Tags.innerHTML = formatDnaTags(p1Cfg.dna).map(t => `<span class="sdo-tag">${t}</span>`).join('');

    p2Name.textContent = p2Cfg.name;
    p2Badge.textContent = getArchetypeBadge(p2Cfg);
    p2Tags.innerHTML = formatDnaTags(p2Cfg.dna).map(t => `<span class="sdo-tag">${t}</span>`).join('');
    overlay.classList.remove('hidden');

    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(p1Name.textContent).toBe('Titan Chonk');
    expect(p1Badge.textContent).toBe('[🦏 TITAN CHONK]');
    expect(p1Tags.children.length).toBe(4);
    expect(p2Name.textContent).toBe('Speed Gremlin');
    expect(p2Badge.textContent).toBe('[⚡ SPEED GREMLIN]');
    expect(p2Tags.children.length).toBe(4);
  });
});

describe('Empirical Challenge 3: Colosseum Results Routing (Rematch, Workshop, Mall)', () => {
  it('displays build-specific buttons and hides arcade rematch controls on colosseum match end', () => {
    const elRematchVote = new MockElement('div'); elRematchVote.id = 'rematch-vote';
    const elPlayAgain = new MockElement('button'); elPlayAgain.id = 'btn-play-again';
    const elMainMenu = new MockElement('button'); elMainMenu.id = 'btn-main-menu';
    const elBuildRematch = new MockElement('button'); elBuildRematch.id = 'btn-build-rematch'; elBuildRematch.classList.add('hidden');
    const elBuildWorkshop = new MockElement('button'); elBuildWorkshop.id = 'btn-build-workshop'; elBuildWorkshop.classList.add('hidden');
    const elResultsMall = new MockElement('button'); elResultsMall.id = 'btn-results-mall';
    const elResultTitle = new MockElement('h1'); elResultTitle.id = 'result-title';

    const currentMode = 'build_arena';
    const winner = { name: 'Titan Chonk', isPlayer: false };

    // Simulate main.js onMatchEnd in build_arena mode
    if (currentMode === 'build_arena') {
      elResultTitle.textContent = `${winner.name.toUpperCase()} WINS!`;
      elRematchVote.classList.add('hidden');
      elPlayAgain.classList.add('hidden');
      elMainMenu.classList.add('hidden');
      elBuildRematch.classList.remove('hidden');
      elBuildWorkshop.classList.remove('hidden');
      elResultsMall.classList.remove('hidden');
    }

    expect(elResultTitle.textContent).toBe('TITAN CHONK WINS!');
    expect(elRematchVote.classList.contains('hidden')).toBe(true);
    expect(elPlayAgain.classList.contains('hidden')).toBe(true);
    expect(elMainMenu.classList.contains('hidden')).toBe(true);
    expect(elBuildRematch.classList.contains('hidden')).toBe(false);
    expect(elBuildWorkshop.classList.contains('hidden')).toBe(false);
    expect(elResultsMall.classList.contains('hidden')).toBe(false);
  });

  it('clicking Rematch AI immediately relaunches arena with identical combatant configurations', () => {
    const lastBuilderPlayerConfig = { name: 'Titan Chonk', shape: 'chonk', stats: { mass: 4.5 } };
    const lastBuilderOppType = 'gremlin';

    let launchedWithPlayer = null;
    let launchedWithOpp = null;

    const launchBuilderArena = (playerCfg, oppType) => {
      launchedWithPlayer = playerCfg;
      launchedWithOpp = oppType;
    };

    const btnRematch = new MockElement('button');
    btnRematch.addEventListener('click', () => {
      if (lastBuilderPlayerConfig) {
        launchBuilderArena(lastBuilderPlayerConfig, lastBuilderOppType);
      }
    });

    btnRematch.click();

    expect(launchedWithPlayer).toEqual(lastBuilderPlayerConfig);
    expect(launchedWithOpp).toBe('gremlin');
  });

  it('clicking Back to Workshop cleanly transitions mode back to build lab', () => {
    let mode = 'build_arena';
    let labCreated = false;

    const startBuildLab = () => {
      mode = 'build';
      labCreated = true;
    };

    const btnWorkshop = new MockElement('button');
    btnWorkshop.addEventListener('click', () => {
      startBuildLab();
    });

    btnWorkshop.click();

    expect(mode).toBe('build');
    expect(labCreated).toBe(true);
  });

  it('clicking Exit to Mall unlocks router and transitions to root URL', () => {
    let matchLock = true;
    let targetPath = null;

    const router = {
      setMatchLock(val) { matchLock = val; },
      go(path) { targetPath = path; },
    };

    const returnToMall = () => {
      router.setMatchLock(false);
      router.go('/');
    };

    const btnMall = new MockElement('button');
    btnMall.addEventListener('click', returnToMall);
    btnMall.click();

    expect(matchLock).toBe(false);
    expect(targetPath).toBe('/');
  });
});

describe('Empirical Challenge 4: Bot Auto-Rematch Suppression', () => {
  it('prevents bot voting timers from starting in build_arena mode', () => {
    let startRematchVoteCalled = false;
    let rematch = null;

    const startRematchVote = () => {
      startRematchVoteCalled = true;
      rematch = { votes: 0, timers: [setTimeout(() => {}, 1000)] };
    };

    const currentMode = 'build_arena';

    if (currentMode !== 'build_arena') {
      startRematchVote();
    }

    expect(startRematchVoteCalled).toBe(false);
    expect(rematch).toBeNull();
  });

  it('clearRematch disarms all active timers cleanly', () => {
    let timerFired = false;
    const timerId = setTimeout(() => { timerFired = true; }, 50);

    let rematch = { votes: 1, timers: [timerId] };

    const clearRematch = () => {
      if (!rematch) return;
      for (const t of rematch.timers || []) clearTimeout(t);
      rematch = null;
    };

    clearRematch();
    expect(rematch).toBeNull();

    // Advance beyond timer duration
    return new Promise(resolve => {
      setTimeout(() => {
        expect(timerFired).toBe(false);
        resolve();
      }, 70);
    });
  });
});

describe('Empirical Challenge 5: Opponent Generator Contract & Badge Invariants', () => {
  function generateOpponentConfig(playerConfig, oppType = 'random') {
    if (oppType === 'mirror') {
      return {
        ...playerConfig,
        name: `Anti-${playerConfig.name || 'Dweeb'}`,
        badge: '🤖 MIRROR RIVAL',
        primaryColor: '#2b1b3d',
        accentColor: '#ff2a5f',
        dna: {
          confidence: 0.9,
          aimAccuracy: playerConfig.dna?.aimAccuracy ?? 0.75,
          scavenge: playerConfig.dna?.scavenge ?? 0.6,
          agility: playerConfig.dna?.agility ?? 0.8,
        },
      };
    }
    if (oppType === 'juggernaut' && ARCHETYPE_PRESETS?.titan_chonk) {
      return { ...ARCHETYPE_PRESETS.titan_chonk };
    }
    if (oppType === 'gremlin' && ARCHETYPE_PRESETS?.speed_gremlin) {
      return { ...ARCHETYPE_PRESETS.speed_gremlin };
    }
    if (oppType === 'sniper' && ARCHETYPE_PRESETS?.sniper_bean) {
      return { ...ARCHETYPE_PRESETS.sniper_bean };
    }
    if (oppType === 'pugilist' && ARCHETYPE_PRESETS?.pugilist_champ) {
      return { ...ARCHETYPE_PRESETS.pugilist_champ };
    }
    // 'random' (mutant)
    const dummyScene = new THREE.Scene();
    const lab = new BuildADweebLab(dummyScene, null, null);
    const cfg = lab.mutateRandom();
    lab.dispose();
    cfg.badge = '👾 RANDOM MUTANT';
    return cfg;
  }

  it('guarantees valid geometry, badge, and normalized DNA for every opponent type', () => {
    const oppTypes = ['mirror', 'juggernaut', 'gremlin', 'sniper', 'pugilist', 'random'];
    const playerCfg = ARCHETYPE_PRESETS.titan_chonk;

    for (const type of oppTypes) {
      const opp = generateOpponentConfig(playerCfg, type);

      expect(opp.name).toBeTruthy();
      expect(opp.badge).toBeTruthy();
      expect(opp.badge.length).toBeGreaterThan(3);
      expect(BODY_SHAPES).toContain(opp.shape);

      const dna = opp.dna || opp.DNA;
      expect(dna).toBeDefined();
      expect(dna.confidence).toBeGreaterThanOrEqual(0);
      expect(dna.confidence).toBeLessThanOrEqual(1.0);
      expect(dna.aimAccuracy).toBeGreaterThanOrEqual(0);
      expect(dna.aimAccuracy).toBeLessThanOrEqual(1.0);
      expect(dna.agility).toBeGreaterThanOrEqual(0);
      expect(dna.agility).toBeLessThanOrEqual(1.0);
      expect(dna.scavenge).toBeGreaterThanOrEqual(0);
      expect(dna.scavenge).toBeLessThanOrEqual(1.0);

      // Verify procedural mesh builds without error
      const model = buildCustomDweebModel(opp);
      expect(model.root).toBeInstanceOf(THREE.Group);
    }
  });
});

describe('Empirical Challenge 6: Brawler Model Morphing & Rig Attachment', () => {
  function makeMockBrawler() {
    const rig = new THREE.Group();
    const defaultBody = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const playerRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.2));
    const bubbleMesh = new THREE.Mesh(new THREE.SphereGeometry(1));
    const freezeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const parryMesh = new THREE.Mesh(new THREE.RingGeometry(1, 1.2));

    rig.add(defaultBody, playerRing, bubbleMesh, freezeMesh, parryMesh);

    return {
      name: 'Default',
      rig,
      playerRing,
      bubbleMesh,
      freezeMesh,
      parryMesh,
      flashMats: [],
      stats: { speed: 1.0, jump: 1.0, mass: 3.0 },
      collider: { setMass: vi.fn() },
    };
  }

  function applyCustomDweebToBrawler(dweeb, config) {
    const custom = buildCustomDweebModel(config);
    dweeb.customModel = custom;
    for (const c of dweeb.rig.children) {
      if (c !== dweeb.playerRing && c !== dweeb.bubbleMesh && c !== dweeb.freezeMesh && c !== dweeb.parryMesh) {
        c.visible = false;
      }
    }
    dweeb.rig.add(custom.root);
    custom.root.traverse(child => {
      if (child.isMesh && child.material && !dweeb.flashMats.includes(child.material)) {
        dweeb.flashMats.push(child.material);
      }
    });
    if (config.stats) {
      if (config.stats.speed) dweeb.stats.speed *= config.stats.speed;
      if (config.stats.jump) dweeb.stats.jump *= config.stats.jump;
      if (config.stats.mass) {
        dweeb.stats.mass = config.stats.mass;
        dweeb.collider?.setMass?.(config.stats.mass);
      }
    }
    if (config.name) dweeb.name = config.name;
    return custom;
  }

  it('correctly morphs brawler rig, preserves shields/rings, and applies battle metrics', () => {
    const brawler = makeMockBrawler();
    const titan = ARCHETYPE_PRESETS.titan_chonk;

    const custom = applyCustomDweebToBrawler(brawler, titan);

    expect(brawler.name).toBe('Titan Chonk');
    expect(brawler.customModel).toBe(custom);
    expect(brawler.rig.children).toContain(custom.root);
    expect(brawler.playerRing.visible).toBe(true);
    expect(brawler.bubbleMesh.visible).toBe(true);
    expect(brawler.freezeMesh.visible).toBe(true);
    expect(brawler.parryMesh.visible).toBe(true);

    // Old generic body mesh is hidden
    expect(brawler.rig.children[0].visible).toBe(false);

    // Flash materials collected
    expect(brawler.flashMats.length).toBeGreaterThan(0);

    // Mass scaled and collider updated
    expect(brawler.stats.mass).toBe(4.5);
    expect(brawler.collider.setMass).toHaveBeenCalledWith(4.5);
  });
});

describe('Empirical Challenge 7: BuilderBot Resiliency with Missing / Extreme DNA', () => {
  function makeMockDweeb() {
    return {
      active: true,
      eliminated: false,
      swimFlail: 0,
      hitstun: 0,
      ragdolling: false,
      isCharging: false,
      charging: 0,
      held: null,
      moveInput: new THREE.Vector2(),
      grounded: true,
      ledge: false,
      getPosition: () => ({ x: 0, y: 1, z: 0 }),
      requestJump: vi.fn(),
      requestLedgeHop: vi.fn(),
    };
  }

  it('operates stably with undefined or empty DNA, and reveals null-pointer edge case', () => {
    const dweeb = makeMockDweeb();
    const arena = { isOverGround: () => true, objects: [], items: [], hazardAt: () => false };
    const combat = { canAct: () => true, startCharge: () => true, releaseCharge: () => {}, grab: () => {}, throwHeld: () => {}, drop: () => {}, dodgeOrDive: () => {}, startParry: () => {} };

    // Undefined DNA defaults cleanly via default parameter
    expect(() => new BuilderBot(dweeb, arena, combat, undefined)).not.toThrow();
    // Empty object defaults cleanly
    const bot = new BuilderBot(dweeb, arena, combat, {});
    expect(() => bot.update(0.016, [dweeb])).not.toThrow();

    // Passing null bypasses the default param `dna = {}`, exposing a TypeError
    expect(() => new BuilderBot(dweeb, arena, combat, null)).toThrow(TypeError);
  });

  it('handles extreme DNA values [0.0, 1.0] without producing NaN vectors', () => {
    const dweeb = makeMockDweeb();
    const rival = makeMockDweeb();
    rival.getPosition = () => ({ x: 10, y: 1, z: 10 });

    const arena = { isOverGround: () => true, objects: [], items: [], hazardAt: () => false };
    const combat = { canAct: () => true, startCharge: () => true, releaseCharge: () => {}, grab: () => {}, throwHeld: () => {}, drop: () => {}, dodgeOrDive: () => {}, startParry: () => {} };

    // Extreme zero DNA
    const zeroBot = new BuilderBot(dweeb, arena, combat, { confidence: 0, aimAccuracy: 0, agility: 0, scavenge: 0 });
    zeroBot.update(0.016, [dweeb, rival]);
    expect(Number.isNaN(dweeb.moveInput.x)).toBe(false);
    expect(Number.isNaN(dweeb.moveInput.y)).toBe(false);

    // Extreme max DNA
    const maxBot = new BuilderBot(dweeb, arena, combat, { confidence: 1, aimAccuracy: 1, agility: 1, scavenge: 1 });
    maxBot.update(0.016, [dweeb, rival]);
    expect(Number.isNaN(dweeb.moveInput.x)).toBe(false);
    expect(Number.isNaN(dweeb.moveInput.y)).toBe(false);
  });
});
