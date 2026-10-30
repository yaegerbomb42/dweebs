import { loadCareer } from './career.js';
// hub-extras.js — the living parts of the builder-first hub.
//
// Presentation/shell only. This module READS the same localStorage keys the
// games write (warfare best waves, the expedition village save, the builder
// save, the shell's own settings) and renders hub chrome around them. It never
// writes game state, never touches gameplay, and never touches the network.
//
// Everything is guarded: missing storage, bad JSON and missing DOM nodes all
// degrade to empty states instead of throwing, so the hub works offline,
// in private mode, and inside the node test runner (DOM-free logic is kept in
// pure functions; the paint functions only need a querySelector-shaped root).

/* global document, matchMedia, setInterval, clearInterval */

import { loadSettings } from './settings.js';
import { CHARACTER_ROSTER } from '../player/characterList.js';

// ─── loading tips ────────────────────────────────────────────────────────────
// Shown by src/app/loading.js while the bar is under 100%. Real mechanics,
// one line each, so a first-time player learns something while assets stream.

export const HUB_TIPS = [
  'Build-A-Dweeb is the main event — sculpt a creature, then watch it fight on its own.',
  'Knockout Brawl: the floor is lava. Everything else is a weapon.',
  'In Warfare Defense the fort holds 20 waves — spend gold between waves.',
  'Dweebscape Island has no combat. Batteries are heavy: haul them together.',
  'Expedition & Dynasty auto-saves every 30 seconds. The village keeps living.',
  'The Mimic Lab crowd copies what YOU do. Show them something weird.',
  'Reduced motion lives in Settings — no screen shake, no confetti.',
  'Press PLAY ONLINE with no server and you still get the offline demo.',
];

// ─── daily challenge ─────────────────────────────────────────────────────────
// Deterministic per calendar day: same day, same challenge, everywhere.
// Each target is a button id already wired in boot.js wireTitle().

export const DAILY_CHALLENGES = [
  { icon: '🥊', title: 'Brawl Blitz', desc: 'Win a Knockout Brawl — last dweeb standing takes the day.', target: 'app-btn-brawl' },
  { icon: '☠️', title: 'Derby Dare', desc: 'Survive a Dumb Ways to Die derby without embarrassing yourself.', target: 'app-btn-derby' },
  { icon: '🛡️', title: 'Fort Holder', desc: 'Reach wave 10 in Warfare Defense. The fort believes in you.', target: 'app-btn-warfare-defense' },
  { icon: '🌱', title: 'Homesteader', desc: 'Raise 3 contraptions in the Meadowlands expedition.', target: 'app-btn-dynasty' },
  { icon: '🏝️', title: 'Island Sprint', desc: 'Power the portal on Dweebscape Island, no punching allowed.', target: 'app-btn-escape' },
  { icon: '🧬', title: 'Lab Day', desc: 'Sculpt a brand-new dweeb in the 3D creature lab.', target: 'app-btn-builder' },
  { icon: '⚔️', title: 'Total War', desc: 'Win a 100v100 Warfare Versus. Bring artillery.', target: 'app-btn-warfare-versus' },
];

const DAY_MS = 86400 * 1000;

/** The challenge for a calendar day. Pure: same input date, same challenge. */
export function pickDaily(date = new Date()) {
  const days = Math.floor(date.getTime() / DAY_MS);
  const i = ((days % DAILY_CHALLENGES.length) + DAILY_CHALLENGES.length) % DAILY_CHALLENGES.length;
  return DAILY_CHALLENGES[i];
}

// ─── trophy-wall stats ───────────────────────────────────────────────────────
// Keys, grounded in the game sources that write them:
//   dweebs-warfare-best / dweebs-warfare-best-<diff> — String(wave) (WarfareHud.bestKey, DweebWarfare)
//   dweebs-village-v1 — JSON { structures: [...] } (adventure/persistence.js SAVE_KEY)
//   dweebs-custom-build — the builder's saved creature (BuildADweebLab STORAGE_KEY)

const WARFARE_BEST_PREFIX = 'dweebs-warfare-best';
const VILLAGE_KEY = 'dweebs-village-v1';
const BUILD_KEY = 'dweebs-custom-build';

function safeStorage() {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    return g && g.localStorage ? g.localStorage : null;
  } catch {
    return null;
  }
}

/** Read the stats the hub can honestly show. Never throws. */
export function readHubStats(storage = safeStorage(), settings = null) {
  const stats = {
    warfareBest: null,
    hasVillage: false,
    villageStructures: 0,
    hasBuild: false,
    playerName: 'You',
    dweebName: 'Cube',
    dweebColor: '#ffd23f',
  };
  if (settings && typeof settings === 'object') {
    if (typeof settings.playerName === 'string' && settings.playerName.trim()) {
      stats.playerName = settings.playerName.trim().slice(0, 12);
    }
    const entry = CHARACTER_ROSTER.find(c => c.id === settings.type);
    if (entry) stats.dweebName = entry.name;
    const hex = COLOR_HEX[settings.color];
    if (hex) stats.dweebColor = hex;
  }
  if (!storage || typeof storage.getItem !== 'function') return stats;

  const read = key => {
    try { return storage.getItem(key); }
    catch { return null; }
  };

  // Warfare best: max over the base key and every difficulty variant.
  let best = null;
  const consider = raw => {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) best = best == null ? n : Math.max(best, n);
  };
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (typeof k === 'string' && k.startsWith(WARFARE_BEST_PREFIX)) consider(read(k));
      }
    } catch { /* storage enumeration failed; fall through */ }
  } else {
    consider(read(WARFARE_BEST_PREFIX));
  }
  stats.warfareBest = best;

  try {
    const raw = read(VILLAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      stats.hasVillage = true;
      stats.villageStructures = Array.isArray(v.structures) ? v.structures.length : 0;
    }
  } catch { /* corrupt save: treat as no village */ }

  stats.hasBuild = read(BUILD_KEY) != null;
  return stats;
}

/** Colour names → hex. Mirrors boot.js's COLOR_NAME_TO_HEX for the profile chip. */
const COLOR_HEX = {
  yellow: '#ffd23f', pink: '#ff6fb5', blue: '#3fa9ff',
  green: '#5ee06a', orange: '#ff9a3c', purple: '#b56cff',
};

// ─── paint: stats, profile, daily ────────────────────────────────────────────

function setText(root, sel, text) {
  const node = root?.querySelector?.(sel);
  if (node) node.textContent = text;
}

/** Fill arcade-card stat lines and the trophy wall. Idempotent. */
export function applyHubStats(root, stats = readHubStats(safeStorage(), loadSettings())) {
  if (!root?.querySelector) return stats;
  setText(root, '[data-stat-for="arena"]', '3 sub-games · pick-up-and-play chaos');
  setText(root, '[data-stat-for="dynasty"]',
    stats.hasVillage ? `village saved · ${stats.villageStructures} structure${stats.villageStructures === 1 ? '' : 's'}` : 'no village yet — found yours');
  setText(root, '[data-stat-for="warfare"]',
    stats.warfareBest != null ? `best defense: wave ${stats.warfareBest}` : 'no battles yet — hold the fort');
  setText(root, '[data-stat-for="escape"]', 'co-op · combatless');
  setText(root, '[data-stat-for="mimic"]', 'sandbox · the crowd copies you');

  setText(root, '[data-trophy="warfare"]', stats.warfareBest != null ? `wave ${stats.warfareBest}` : '—');
  setText(root, '[data-trophy="village"]', stats.hasVillage ? String(stats.villageStructures) : '—');
  try {
    const c = loadCareer();
    setText(root, '[data-trophy="career"]', c.matches ? `${c.wins}W · ${c.kos} KO` : '—');
  } catch { /* no storage */ }
  setText(root, '[data-trophy="build"]', stats.hasBuild ? 'saved' : '—');
  return stats;
}

/** The profile chip: who you are, which dweeb, which colour. */
export function applyProfile(root, settings = loadSettings()) {
  const node = root?.querySelector?.('#hub-profile');
  if (!node) return;
  const stats = readHubStats(null, settings);
  // Build with DOM calls so a player name can never inject markup.
  const doc = node.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;
  node.innerHTML = '';
  const d = doc.createElement('span');
  d.className = 'hub-profile-dot';
  d.style.background = stats.dweebColor;
  const t = doc.createElement('span');
  t.className = 'hub-profile-text';
  t.textContent = `${stats.playerName} · ${stats.dweebName}`;
  node.append(d, t);
}

/** Fill the daily-challenge card; the CTA's data-target is what boot.js clicks. */
export function applyDaily(root, challenge = pickDaily()) {
  if (!root?.querySelector) return challenge;
  setText(root, '#daily-title', `${challenge.icon} ${challenge.title}`);
  setText(root, '#daily-desc', challenge.desc);
  const btn = root.querySelector('#app-btn-daily');
  if (btn) {
    btn.dataset.target = challenge.target;
    btn.setAttribute('aria-label', `Daily challenge: ${challenge.title}. ${challenge.desc}`);
  }
  return challenge;
}

// ─── featured-dweeb spotlight ────────────────────────────────────────────────
// Rotates through curated roster picks inside the hero. The index lives at
// module scope so leaving and returning to the hub keeps the rotation alive
// instead of restarting at the first dweeb every visit.

const SPOTLIGHT = [
  { id: 'boxer', emoji: '🥊', quip: 'The people’s champ. Two gloves, zero mercy.' },
  { id: 'ghosty', emoji: '👻', quip: 'Spooky season never ended for this one.' },
  { id: 'boing', emoji: '🌀', quip: 'Bounces first, asks questions never.' },
  { id: 'gumball', emoji: '🍬', quip: 'Shake well. Thirty-seven marbles of pure spite.' },
  { id: 'starry', emoji: '⭐', quip: 'Dances straight through danger.' },
  { id: 'plunger', emoji: '🪠', quip: 'Unclogs destiny, one suction cup at a time.' },
];

let spotIdx = 0;

/** False when the player (or OS) asked for reduced motion. */
export function motionOK() {
  try {
    if (typeof document !== 'undefined' && document.documentElement?.dataset?.reducedMotion === 'on') return false;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {
    // Unknown environment: allow motion rather than kill the feature.
  }
  return true;
}

/**
 * Start the spotlight rotation inside #hero-spotlight. Returns a stop function.
 * With reduced motion (or no slot) it paints once and returns a no-op.
 */
export function startSpotlight(root, { intervalMs = 4500 } = {}) {
  const slot = root?.querySelector?.('#hero-spotlight');
  const noop = () => {};
  if (!slot) return noop;
  const paint = () => {
    const pick = SPOTLIGHT[spotIdx % SPOTLIGHT.length];
    const entry = CHARACTER_ROSTER.find(c => c.id === pick.id);
    slot.classList.remove('hero-spot-swap');
    // Quips are our own strings; the roster blurb is trusted game data. A
    // textContent-built tree would cost three nodes per swap for no benefit
    // here since nothing in these strings comes from the player.
    slot.innerHTML =
      `<span class="hero-spot-emoji" aria-hidden="true">${pick.emoji}</span>` +
      `<span class="hero-spot-name">${entry ? entry.name : pick.id}</span>` +
      `<span class="hero-spot-quip">${pick.quip}</span>`;
    // Re-trigger the swap animation on the next frame.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => slot.classList.add('hero-spot-swap'));
    } else {
      slot.classList.add('hero-spot-swap');
    }
    spotIdx++;
  };
  paint();
  if (!motionOK()) return noop;
  const timer = setInterval(paint, intervalMs);
  return () => clearInterval(timer);
}

// ─── one entry point ─────────────────────────────────────────────────────────

/**
 * Refresh every living part of the hub. Call it whenever the title route
 * shows (stats may have changed while a game was running). Returns a stop
 * function that halts the spotlight rotation.
 */
export function refreshHub(root, opts = {}) {
  const settings = loadSettings();
  const stats = applyHubStats(root, readHubStats(safeStorage(), settings));
  applyProfile(root, settings);
  applyDaily(root, opts.daily || pickDaily(opts.date));
  const stop = startSpotlight(root, opts.spotlight);
  return { stats, stop };
}
