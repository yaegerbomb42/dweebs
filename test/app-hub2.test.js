// app-hub2.test.js — the "go bigger" hub pass: living hero, trophy wall,
// daily challenge, profile chip, loading tips, page transitions.
//
// Like app-hub.test.js these are static/pure tests on purpose: the hub is a
// template string (no DOM in the node test env), so markup and CSS are asserted
// on source text, while src/app/hub-extras.js keeps its logic in pure
// functions tested directly with fake storage and fake querySelector roots.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  HUB_TIPS,
  DAILY_CHALLENGES,
  pickDaily,
  readHubStats,
  applyHubStats,
  applyProfile,
  applyDaily,
  startSpotlight,
  motionOK,
  refreshHub,
} from '../src/app/hub-extras.js';
import { contractFor, todayKey } from '../src/app/daily.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screensSrc = readFileSync(path.join(root, 'src/app/screens.js'), 'utf8');
const bootSrc = readFileSync(path.join(root, 'src/app/boot.js'), 'utf8');
const cssSrc = readFileSync(path.join(root, 'src/app/shell.css'), 'utf8');
const loadingSrc = readFileSync(path.join(root, 'src/app/loading.js'), 'utf8');

/** The title screen's template: from its aria-label to the outer </section>. */
function titleMarkup() {
  const start = screensSrc.indexOf('aria-label="Dweebs hub"');
  expect(start).toBeGreaterThan(-1);
  const end = screensSrc.indexOf('</section>', screensSrc.indexOf('</footer>', start));
  expect(end).toBeGreaterThan(start);
  return screensSrc.slice(start, end);
}

/** All button ids present in the title markup. */
function titleButtonIds() {
  return [...new Set([...titleMarkup().matchAll(/id="(app-btn-[a-z-]+)"/g)].map(m => m[1]))];
}

// ─── tiny fakes: no DOM in the node env ──────────────────────────────────────

function fakeEl() {
  return {
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    children: [],
    append(...kids) { this.children.push(...kids); },
  };
}

function fakeRoot() {
  const slots = new Map();
  return {
    querySelector(sel) {
      if (!slots.has(sel)) slots.set(sel, fakeEl());
      return slots.get(sel);
    },
    querySelectorAll() { return []; },
  };
}

function mapStorage(entries) {
  const m = new Map(Object.entries(entries));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

// ─── hub-extras: pure logic ──────────────────────────────────────────────────

describe('daily challenge', () => {
  it('is deterministic for the same calendar day', () => {
    const a = pickDaily(new Date('2026-10-29T01:00:00Z'));
    const b = pickDaily(new Date('2026-10-29T23:59:59Z'));
    expect(a).toEqual(b);
  });

  it('rotates through all 7 challenges across a week', () => {
    const seen = new Set();
    for (let d = 0; d < 7; d++) seen.add(pickDaily(new Date(Date.UTC(2026, 9, 29 + d))).title);
    expect(seen.size).toBe(DAILY_CHALLENGES.length);
  });

  it('points every challenge at a real, wired hub button', () => {
    const ids = titleButtonIds();
    expect(DAILY_CHALLENGES.length).toBe(7);
    for (const c of DAILY_CHALLENGES) {
      expect(c.icon && c.title && c.desc, 'challenge is complete').toBeTruthy();
      expect(ids, `challenge "${c.title}" targets #${c.target}`).toContain(c.target);
      expect(bootSrc, `challenge target #${c.target} is wired`).toContain(`#${c.target}`);
    }
  });
});

describe('trophy-wall stats', () => {
  it('reads the best warfare wave across difficulty variants', () => {
    const stats = readHubStats(mapStorage({
      'dweebs-warfare-best': '7',
      'dweebs-warfare-best-hard': '12',
      'dweebs-warfare-best-easy': 'not-a-number',
    }), null);
    expect(stats.warfareBest).toBe(12);
  });

  it('falls back to the base key when storage cannot be enumerated', () => {
    const stats = readHubStats({ getItem: k => (k === 'dweebs-warfare-best' ? '5' : null) }, null);
    expect(stats.warfareBest).toBe(5);
  });

  it('reads the village structure count and the builder save', () => {
    const stats = readHubStats(mapStorage({
      'dweebs-village-v1': JSON.stringify({ structures: [{}, {}, {}] }),
      'dweebs-custom-build': '{"body":"blob"}',
    }), null);
    expect(stats.hasVillage).toBe(true);
    expect(stats.villageStructures).toBe(3);
    expect(stats.hasBuild).toBe(true);
  });

  it('degrades to empty states on missing or corrupt saves', () => {
    const empty = readHubStats(mapStorage({}), null);
    expect(empty.warfareBest).toBeNull();
    expect(empty.hasVillage).toBe(false);
    expect(empty.hasBuild).toBe(false);
    const corrupt = readHubStats(mapStorage({ 'dweebs-village-v1': '💥 not json' }), null);
    expect(corrupt.hasVillage).toBe(false);
    expect(corrupt.villageStructures).toBe(0);
    const noStorage = readHubStats(null, null);
    expect(noStorage.warfareBest).toBeNull();
  });

  it('resolves the profile from settings: name, dweeb and colour', () => {
    const stats = readHubStats(null, { playerName: '  Sam  ', type: 'ghosty', color: 'purple' });
    expect(stats.playerName).toBe('Sam');
    expect(stats.dweebName).toBe('Ghosty');
    expect(stats.dweebColor).toBe('#b56cff');
  });
});

describe('hub paint functions (fake DOM)', () => {
  it('fills arcade stat lines and trophy values from real stats', () => {
    const r = fakeRoot();
    const stats = { warfareBest: 12, hasVillage: true, villageStructures: 4, hasBuild: true };
    applyHubStats(r, stats);
    expect(r.querySelector('[data-stat-for="warfare"]').textContent).toContain('wave 12');
    expect(r.querySelector('[data-stat-for="dynasty"]').textContent).toContain('4 structures');
    expect(r.querySelector('[data-trophy="warfare"]').textContent).toBe('wave 12');
    expect(r.querySelector('[data-trophy="village"]').textContent).toBe('4');
    expect(r.querySelector('[data-trophy="build"]').textContent).toBe('saved');
  });

  it('shows honest empty states when there are no saves yet', () => {
    const r = fakeRoot();
    applyHubStats(r, { warfareBest: null, hasVillage: false, villageStructures: 0, hasBuild: false });
    expect(r.querySelector('[data-stat-for="warfare"]').textContent).toContain('no battles yet');
    expect(r.querySelector('[data-stat-for="dynasty"]').textContent).toContain('no village yet');
    expect(r.querySelector('[data-trophy="warfare"]').textContent).toBe('—');
  });

  it('paints the daily card and stores the target for boot.js', () => {
    const r = fakeRoot();
    // applyDaily now paints today's contract from the Daily Contracts system
    // (src/app/daily.js), not a passed-in challenge.
    const c = contractFor(todayKey());
    applyDaily(r);
    expect(r.querySelector('#daily-title').textContent).toContain(c.title);
    const LAUNCH = { brawl: 'app-btn-brawl', derby: 'app-btn-derby', walldrop: 'app-btn-walldrop', build_arena: 'app-btn-builder' };
    expect(r.querySelector('#app-btn-daily').dataset.target).toBe(LAUNCH[c.mode] || 'app-btn-brawl');
  });

  it('builds the profile chip as text, never as markup', () => {
    const r = fakeRoot();
    const node = r.querySelector('#hub-profile');
    node.ownerDocument = { createElement: () => fakeEl() };
    applyProfile(r, { playerName: '<img src=x onerror=1>', type: 'cube', color: 'yellow' });
    expect(node.innerHTML).toBe('');
    expect(node.children.length).toBe(2);
    // The hostile name survives only as literal text on a text node
    // (settings truncates names to 12 chars, same as the name field).
    expect(node.children[1].textContent).toBe('<img src=x o' + ' · Cube');
    expect(node.children[0].style.background).toBe('#ffd23f');
  });

  it('rotates the spotlight and stops cleanly', async () => {
    const r = fakeRoot();
    const slot = r.querySelector('#hero-spotlight');
    const stop = startSpotlight(r, { intervalMs: 15 });
    expect(typeof stop).toBe('function');
    const first = slot.innerHTML;
    expect(first).toContain('hero-spot-emoji');
    await new Promise(res => setTimeout(res, 60));
    expect(slot.innerHTML).not.toBe(first);
    expect(() => stop()).not.toThrow();
  });

  it('startSpotlight is a safe no-op with no slot', () => {
    expect(() => startSpotlight(null)()).not.toThrow();
    expect(() => startSpotlight({})()).not.toThrow();
  });

  it('refreshHub paints everything and returns a stop handle', () => {
    const r = fakeRoot();
    const out = refreshHub(r);
    expect(out.stats).toBeDefined();
    expect(typeof out.stop).toBe('function');
    out.stop();
  });
});

describe('hub-extras environment guards', () => {
  it('allows motion when reduced motion cannot be detected (node)', () => {
    expect(motionOK()).toBe(true);
  });

  it('ships a non-empty tip list of real one-liners', () => {
    expect(HUB_TIPS.length).toBeGreaterThanOrEqual(5);
    for (const t of HUB_TIPS) expect(typeof t).toBe('string');
  });
});

// ─── hub markup: the bigger sections exist ───────────────────────────────────

describe('bigger hub markup in screens.js', () => {
  it('adds the living background layer and profile chip', () => {
    const m = titleMarkup();
    expect(m).toContain('class="hub-bg"');
    expect(m).toContain('id="hub-profile"');
  });

  it('adds the featured-dweeb spotlight inside the hero', () => {
    const hero = screensSrc.slice(screensSrc.indexOf('hub-hero-builder'), screensSrc.indexOf('hub-arcade'));
    expect(hero).toContain('hero-spotlight');
    expect(hero).toContain('id="hero-spotlight"');
  });

  it('adds one stat line per arcade cabinet', () => {
    const m = titleMarkup();
    for (const key of ['arena', 'dynasty', 'warfare', 'escape', 'mimic']) {
      expect(m, `stat line for ${key}`).toContain(`data-stat-for="${key}"`);
    }
  });

  it('adds the trophy wall with five trophies', () => {
    const m = titleMarkup();
    expect(m).toContain('hub-trophies');
    for (const key of ['warfare', 'village', 'build', 'career']) {
      expect(m, `trophy ${key}`).toContain(`data-trophy="${key}"`);
    }
    const trophies = m.match(/class="hub-trophy"/g) || [];
    expect(trophies.length).toBe(5);
  });

  it('adds the daily challenge card with a launch button', () => {
    const m = titleMarkup();
    expect(m).toContain('id="hub-daily"');
    expect(m).toContain('id="daily-title"');
    expect(m).toContain('id="daily-desc"');
    const btn = m.match(/<button[^>]*id="app-btn-daily"[^>]*>/);
    expect(btn?.[0]).toContain('data-launch');
  });

  it('adds the what-is-new panel', () => {
    const m = titleMarkup();
    expect(m).toContain('hub-news');
    expect(m).toContain("WHAT'S NEW");
  });

  it('keeps the new sections between the arcade and the footer', () => {
    const m = titleMarkup();
    const arcade = m.indexOf('hub-arcade');
    const footer = m.indexOf('hub-footer');
    // Note: 'class="hub-news"' targets the what's-new panel section, not the
    // hub-news-ticker div at the top of the hub (both share the hub-news prefix).
    for (const cls of ['hub-trophies', 'hub-daily', 'class="hub-news"']) {
      const i = m.indexOf(cls);
      expect(i).toBeGreaterThan(arcade);
      expect(i).toBeLessThan(footer);
    }
  });
});

// ─── wiring: boot.js drives the living hub ───────────────────────────────────

describe('bigger hub wiring in boot.js', () => {
  it('wires the daily challenge button through its data-target', () => {
    expect(bootSrc).toContain("querySelector('#app-btn-daily')");
    expect(bootSrc).toContain('dataset?.target');
  });

  it('refreshes the hub on the title route and stops it when leaving', () => {
    expect(bootSrc).toContain('refreshHub');
    expect(bootSrc).toMatch(/hubStop\s*=\s*refreshHub\(nodes\.title\)\.stop/);
    expect(bootSrc).toMatch(/if \(hubStop\) \{ hubStop\(\); hubStop = null; \}/);
  });

  it('starts loading tips at boot', () => {
    expect(bootSrc).toContain('HUB_TIPS');
    expect(bootSrc).toContain('loading.startTips(HUB_TIPS)');
  });

  it('every title-screen button id is still wired (no dead buttons)', () => {
    const markup = titleMarkup();
    const ids = [...new Set([...markup.matchAll(/id="(app-btn-[a-z-]+)"/g)].map(m => m[1]))];
    expect(ids).toContain('app-btn-daily');
    for (const id of ids) {
      expect(bootSrc, `hub button #${id} must be wired`).toContain(`#${id}`);
    }
  });
});

// ─── loading tips ────────────────────────────────────────────────────────────

describe('loading screen tips', () => {
  it('adds a startTips/stopTips API to the loading module', () => {
    expect(loadingSrc).toContain('function startTips');
    expect(loadingSrc).toContain('function stopTips');
    expect(loadingSrc).toContain('startTips, stopTips');
  });

  it('stops tips when progress completes, fails or resets', () => {
    expect(loadingSrc).toMatch(/if \(pct >= 100\) stopTips\(\)/);
    expect(loadingSrc).toMatch(/function fail[\s\S]*?stopTips\(\)/);
    expect(loadingSrc).toMatch(/reset\(\) \{[^}]*stopTips\(\)/);
  });
});

// ─── the bigger visual system in shell.css ───────────────────────────────────

describe('bigger hub visual system in shell.css', () => {
  it('ships page transitions for shell screens', () => {
    expect(cssSrc).toContain('.app-screen:not(.hidden)');
    expect(cssSrc).toContain('@keyframes screenIn');
  });

  it('ships the living-background, spotlight, trophy, daily and news classes', () => {
    for (const cls of [
      '.hub-bg', '.hub-profile', '.hero-spotlight', '.hero-spot-body',
      '.hub-section-title', '.hub-trophies', '.hub-trophy', '.hub-trophy-value',
      '.hub-daily', '.hub-daily-title', '.hub-news', '.hub-news-list', '.arcade-stat',
    ]) {
      expect(cssSrc, `hub class ${cls}`).toContain(cls);
    }
  });

  it('ships the new keyframes', () => {
    for (const key of ['@keyframes blobDrift', '@keyframes spotSwap', '@keyframes screenIn']) {
      expect(cssSrc, key).toContain(key);
    }
  });

  it('honours reduced motion on the new animated pieces', () => {
    const reduced = cssSrc.slice(cssSrc.indexOf('prefers-reduced-motion'));
    for (const cls of ['hub-bg i', 'hero-spotlight', 'hub-trophy', 'hub-daily', 'hub-news']) {
      expect(reduced, `reduced-motion covers ${cls}`).toContain(cls);
    }
  });

  it('keeps every new rule scoped so the shell cannot fight the game CSS', () => {
    // .mall-* is the milestone hub's shell-scoped prefix (mall cards,
    // difficulty badges, preview animations) — same shell, same guarantee.
    const lines = cssSrc.split('\n').filter(l => {
      const t = l.trim();
      return t.startsWith('.')
        && !t.startsWith('.app-') && !t.startsWith('.hub-')
        && !t.startsWith('.hero-') && !t.startsWith('.arcade-')
        && !t.startsWith('.diff-') && !t.startsWith('.mall-')
        && !t.startsWith('.mall-badge')
        && !t.startsWith('.btn') && !t.startsWith('@');
    });
    expect(lines, `unscoped rules: ${lines.slice(0, 5).join(' | ')}`).toEqual([]);
  });
});
