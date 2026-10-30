// app-hub.test.js — the builder-first hub: structure, wiring and visual system.
//
// These are static structure tests on purpose: the hub is a template string in
// src/app/screens.js (its el() helper needs a DOM), so we assert on the source
// text instead of a rendered tree. What they pin down:
//   1. Builder is the hero: the hero section precedes the arcade section, and
//      the builder launch button lives inside it.
//   2. The arcade row holds all 5 mini-game cabinets, each with a difficulty badge.
//   3. Every button id boot.js wires on the title screen exists in the markup,
//      and every launch button in the markup is wired (no dead ids either way).
//   4. Footer navigation and shared input affordances are intact.
//   5. The CSS visual system ships: hub layout, hero/card animations, difficulty
//      badges, launch shimmer, reduced-motion and focus-visible rules.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screensSrc = readFileSync(path.join(root, 'src/app/screens.js'), 'utf8');
const bootSrc = readFileSync(path.join(root, 'src/app/boot.js'), 'utf8');
const cssSrc = readFileSync(path.join(root, 'src/app/shell.css'), 'utf8');

/** The title screen's template: from its aria-label to the outer </section>. */
function titleMarkup() {
  const start = screensSrc.indexOf('aria-label="Dweebs hub"');
  expect(start).toBeGreaterThan(-1);
  // NB: the hub nests a <section class="hub-arcade">, so the outer close is the
  // first </section> after the footer.
  const end = screensSrc.indexOf('</section>', screensSrc.indexOf('</footer>', start));
  expect(end).toBeGreaterThan(start);
  return screensSrc.slice(start, end);
}

describe('builder-first hub structure', () => {
  it('renders the builder hero BEFORE the arcade row', () => {
    const hero = screensSrc.indexOf('hub-hero-builder');
    const arcade = screensSrc.indexOf('hub-arcade');
    expect(hero).toBeGreaterThan(-1);
    expect(arcade).toBeGreaterThan(-1);
    expect(hero).toBeLessThan(arcade);
  });

  it('launches the builder from inside the hero section', () => {
    const heroBlock = screensSrc.slice(
      screensSrc.indexOf('hub-hero-builder'),
      screensSrc.indexOf('hub-arcade')
    );
    expect(heroBlock).toContain('id="app-btn-builder"');
    expect(heroBlock).toContain('MAIN EVENT');
  });

  it('has all 5 arcade cabinets as mini-games', () => {
    for (const name of [
      'Knockout Arena',
      'Expedition &amp; Dynasty',
      'Dweeb Warfare',
      'Dweebscape Island',
      'Mimic &amp; Mutate Lab',
    ]) {
      expect(titleMarkup(), `cabinet "${name}"`).toContain(name);
    }
    const cards = titleMarkup().match(/<article class="arcade-card"/g) || [];
    expect(cards.length).toBe(5);
  });

  it('keeps a difficulty badge on every arcade card', () => {
    const cards = titleMarkup().match(/<article class="arcade-card"[\s\S]*?<\/article>/g) || [];
    expect(cards.length).toBe(5);
    for (const card of cards) {
      expect(card, 'arcade card keeps its difficulty badge').toMatch(/diff-badge diff-(easy|medium|intense)/);
    }
  });

  it('keeps the footer navigation intact', () => {
    for (const id of ['app-btn-offline', 'app-btn-online', 'app-btn-how', 'app-btn-settings']) {
      expect(titleMarkup(), `footer button ${id}`).toContain(`id="${id}"`);
    }
  });

  it('marks game-launch buttons with data-launch for the shimmer state', () => {
    const launched = titleMarkup().match(/data-launch/g) || [];
    expect(launched.length).toBeGreaterThanOrEqual(10);
    for (const id of ['app-btn-builder', 'app-btn-derby', 'app-btn-brawl', 'app-btn-dynasty', 'app-btn-warfare', 'app-btn-escape', 'app-btn-mimic']) {
      const m = titleMarkup().match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
      expect(m?.[0], `${id} carries data-launch`).toContain('data-launch');
    }
  });
});

describe('hub wiring: screens.js <-> boot.js agree', () => {
  /** Ids boot.js binds on the title screen (launchers + footer nav). */
  function wiredIds() {
    const ids = new Set();
    const re = /nodes\.title\.querySelector\('#(app-btn-[a-z-]+)'\)/g;
    let m;
    while ((m = re.exec(bootSrc))) ids.add(m[1]);
    return [...ids];
  }

  it('every id wired in boot.js exists in the hub markup', () => {
    const markup = titleMarkup();
    for (const id of wiredIds()) {
      expect(markup, `boot.js wires #${id}, so it must exist`).toContain(`id="${id}"`);
    }
    expect(wiredIds().length).toBeGreaterThanOrEqual(14);
  });

  it('every title-screen button id is wired in boot.js (no dead buttons)', () => {
    const markup = titleMarkup();
    const ids = [...new Set([...markup.matchAll(/id="(app-btn-[a-z-]+)"/g)].map(m => m[1]))];
    expect(ids.length).toBeGreaterThanOrEqual(14);
    for (const id of ids) {
      expect(bootSrc, `hub button #${id} must be wired`).toContain(`#${id}`);
    }
  });

  it('boot.js adds the launch shimmer via the data-launch hook', () => {
    expect(bootSrc).toContain('[data-launch]');
    expect(bootSrc).toContain('is-launching');
  });
});

describe('hub visual system in shell.css', () => {
  it('ships the builder-first layout classes', () => {
    for (const cls of ['.hub-container', '.hub-wordmark', '.hub-hero', '.hero-cta', '.hub-arcade', '.arcade-row', '.arcade-card', '.arcade-btn']) {
      expect(cssSrc, `hub class ${cls}`).toContain(cls);
    }
  });

  it('ships the difficulty badge system', () => {
    for (const cls of ['.diff-badge', '.diff-easy', '.diff-medium', '.diff-intense']) {
      expect(cssSrc, `badge class ${cls}`).toContain(cls);
    }
  });

  it('ships entrance animations and hover/launch states', () => {
    for (const key of ['@keyframes heroIn', '@keyframes cardIn', '@keyframes hubBob', '@keyframes launchSheen']) {
      expect(cssSrc, key).toContain(key);
    }
    expect(cssSrc).toContain('.arcade-card:hover');
    expect(cssSrc).toContain('.btn.is-launching');
    expect(cssSrc).toContain('.hero-cta:hover');
  });

  it('honours reduced motion and keeps keyboard focus visible', () => {
    expect(cssSrc).toContain('prefers-reduced-motion');
    expect(cssSrc).toContain('data-reduced-motion="on"');
    expect(cssSrc).toContain(':focus-visible');
  });

  it('keeps every rule scoped so the shell cannot fight the game CSS', () => {
    // .mall-* is the milestone hub's shell-scoped prefix (mall cards, difficulty
    // badges, preview animations) — same shell, same scoping guarantee.
    const lines = cssSrc.split('\n').filter(l => l.trim().startsWith('.') && !l.trim().startsWith('.app-') && !l.trim().startsWith('.hub-') && !l.trim().startsWith('.hero-') && !l.trim().startsWith('.arcade-') && !l.trim().startsWith('.diff-') && !l.trim().startsWith('.mall-') && !l.trim().startsWith('.mall-badge') && !l.trim().startsWith('.btn') && !l.trim().startsWith('@'));
    expect(lines, `unscoped rules: ${lines.slice(0, 5).join(' | ')}`).toEqual([]);
  });
});
