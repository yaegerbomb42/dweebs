// achievements.js — cross-game achievement system.
//
// A single persistent store (localStorage `dweebs-achievements-v1`) tracks unlocks
// and the stat counters that drive threshold achievements. Games report progress
// through `recordStat(key, n)` / `unlock(id)`; the hub renders the trophy gallery
// and boot.js shows a toast on every unlock.
//
// DOM-free by design: storage is guarded so the whole module runs in node tests.

const STORE_KEY = 'dweebs-achievements-v1';

/**
 * Every achievement. `stat` achievements unlock when stats[stat] >= at via
 * recordStat; `event` achievements unlock via an explicit unlock(id) call.
 */
export const ACHIEVEMENTS = [
  // ── Arena ──
  { id: 'first-blood',  name: 'First Blood',       desc: 'Score your first KO',              icon: '🩸', game: 'arena', stat: 'ko', at: 1 },
  { id: 'delete-10',    name: 'Delete Machine',    desc: 'Score 10 total KOs',               icon: '💥', game: 'arena', stat: 'ko', at: 10 },
  { id: 'delete-100',   name: 'Arena Menace',      desc: 'Score 100 total KOs',              icon: '👹', game: 'arena', stat: 'ko', at: 100 },
  { id: 'brawl-win',    name: 'Last Dweeb Standing', desc: 'Win a Knockout Brawl',           icon: '🏆', game: 'arena', event: true },
  { id: 'royale-win',   name: 'Royale Royalty',    desc: 'Win a Dweeb Royale',               icon: '👑', game: 'arena', event: true },
  { id: 'derby-win',    name: 'Death Defier',      desc: 'Win a Dumb Ways to Die derby',     icon: '💀', game: 'arena', event: true },
  { id: 'hill-win',     name: 'King of the Hill',  desc: 'Win a King of the Hill round',     icon: '⛰️', game: 'arena', event: true },
  { id: 'style-god',    name: 'Dweeb God',         desc: 'Reach the top style tier',         icon: '✨', game: 'arena', event: true },
  { id: 'trickshot-ko', name: 'Trickshot Artist',  desc: 'Land a trickshot KO',              icon: '🎯', game: 'arena', event: true },
  { id: 'team-player', name: 'Team Player',      desc: 'Earn 5 KO assists',                icon: '🤝', game: 'arena', stat: 'assist', at: 5 },
  { id: 'triathlon', name: 'Triathlete',         desc: 'Complete the cross-game triathlon', icon: '🌟', game: 'hub', event: true },
  { id: 'streak-3', name: 'On Fire',            desc: 'Win 3 arena matches in a row',       icon: '🔥', game: 'arena', event: true },
  { id: 'speedster', name: 'Speedster',          desc: 'Set a time attack record',           icon: '⏱️', game: 'arena', event: true },
  { id: 'comeback-kid', name: 'Comeback Kid',      desc: 'Win a match after losing round 1', icon: '🔄', game: 'arena', event: true },
  // ── Expedition ──
  { id: 'founder',      name: 'Founder',           desc: 'Found your first settlement',      icon: '🏕️', game: 'expedition', event: true },
  { id: 'village-tier', name: 'Village People',    desc: 'Grow to Village tier',             icon: '🏘️', game: 'expedition', event: true },
  { id: 'citadel-tier', name: 'Citadel',           desc: 'Grow to Citadel tier',             icon: '🏰', game: 'expedition', event: true },
  { id: 'ruin-raider',  name: 'Ruin Raider',       desc: 'Clear your first ruin vault',      icon: '🗝️', game: 'expedition', event: true },
  { id: 'trader-10',    name: 'Merchant Prince',   desc: 'Complete 10 trades',               icon: '💰', game: 'expedition', stat: 'trades', at: 10 },
  { id: 'festival-goer', name: 'Party Animal',     desc: 'Attend a seasonal festival',       icon: '🎉', game: 'expedition', event: true },
  { id: 'boss-slayer',  name: 'Boss Slayer',       desc: 'Defeat an invasion boss',            icon: '🐛', game: 'expedition', event: true },
  { id: 'disaster-survivor', name: 'Storm Survivor',  desc: 'Weather a thunderstorm or meteor shower', icon: '⛈️', game: 'expedition', event: true },
  // ── Warfare ──
  { id: 'first-victory', name: 'Commander',        desc: 'Win your first battle',            icon: '⚔️', game: 'warfare', event: true },
  { id: 'campaigner',   name: 'Campaigner',        desc: 'Complete campaign mission 1',      icon: '🗺️', game: 'warfare', event: true },
  { id: 'conqueror',    name: 'Conqueror',         desc: 'Complete the whole campaign',      icon: '🌍', game: 'warfare', event: true },
  { id: 'wave-10',      name: 'Wave Rider',        desc: 'Survive 10 waves in co-op survival', icon: '🌊', game: 'warfare', stat: 'waves', at: 10 },
  // ── Builder ──
  { id: 'sculptor',     name: 'Sculptor',          desc: 'Build your first dweeb',           icon: '🗿', game: 'builder', event: true },
  { id: 'geneticist',   name: 'Geneticist',        desc: 'Breed two dweebs together',        icon: '🧪', game: 'builder', event: true },
  { id: 'tournament-win', name: 'Champion',        desc: 'Win a colosseum tournament',       icon: '🥇', game: 'builder', event: true },
  { id: 'dojo-clear',   name: 'Dojo Master',       desc: 'Clear the dojo gauntlet',          icon: '🥋', game: 'builder', event: true },
  // ── Hub / global ──
  { id: 'daily-done',   name: 'Daily Grind',       desc: 'Complete a daily challenge',       icon: '📅', game: 'hub', event: true },
  { id: 'streak-7',     name: 'On Fire',           desc: 'Reach a 7-day streak',             icon: '🔥', game: 'hub', stat: 'streak', at: 7 },
  { id: 'explorer',     name: 'Explorer',          desc: 'Play all four main game modes',    icon: '🧭', game: 'hub', event: true },
  { id: 'collector',    name: 'Completionist',     desc: 'Unlock 20 achievements',           icon: '💯', game: 'hub', stat: '_unlockedCount', at: 20 },
];

const BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]));

function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* private mode / node */ }
  return null;
}

function load() {
  const s = safeStorage();
  if (!s) return { v: 1, unlocked: {}, stats: {} };
  try {
    const raw = s.getItem(STORE_KEY);
    if (!raw) return { v: 1, unlocked: {}, stats: {} };
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return { v: 1, unlocked: {}, stats: {} };
    return { v: 1, unlocked: data.unlocked || {}, stats: data.stats || {} };
  } catch {
    return { v: 1, unlocked: {}, stats: {} };
  }
}

function save(state) {
  const s = safeStorage();
  if (!s) return;
  try { s.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
}

let state = load();
const listeners = new Set();

function notify(a) {
  for (const cb of listeners) {
    try { cb(a); } catch { /* listener bugs never break unlocks */ }
  }
}

/** Re-read from storage (picks up unlocks from other tabs). Test hook: reload(). */
export function reload() { state = load(); }

/** Wipe everything. Used by tests and a future settings button. */
export function reset() {
  state = { v: 1, unlocked: {}, stats: {} };
  save(state);
}

/** Subscribe to unlocks. Returns an unsubscribe function. */
export function onUnlock(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isUnlocked(id) { return !!state.unlocked[id]; }

export function unlockedCount() { return Object.keys(state.unlocked).length; }

export function totalCount() { return ACHIEVEMENTS.length; }

export function statValue(key) { return state.stats[key] || 0; }

/**
 * Unlock by id. Returns the achievement on a fresh unlock, null otherwise.
 * Also re-checks the '_unlockedCount' pseudo-stat for the Completionist.
 */
export function unlock(id) {
  const def = BY_ID.get(id);
  if (!def || state.unlocked[id]) return null;
  state.unlocked[id] = Date.now();
  save(state);
  notify(def);
  // The collector achievement keys off the unlock count itself.
  if (id !== 'collector') {
    const c = BY_ID.get('collector');
    if (c && !state.unlocked.collector && unlockedCount() >= c.at) unlock('collector');
  }
  return def;
}

/**
 * Add n to a stat counter and unlock any threshold achievements it trips.
 * Returns the list of newly unlocked achievements.
 */
export function recordStat(key, n = 1) {
  state.stats[key] = (state.stats[key] || 0) + n;
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (a.stat === key && !state.unlocked[a.id] && state.stats[key] >= a.at) {
      const u = unlock(a.id);
      if (u) fresh.push(u);
    }
  }
  // Pseudo-stat: completionist counts unlocks, including ones from this call.
  const c = BY_ID.get('collector');
  if (c && !state.unlocked.collector && unlockedCount() >= c.at) {
    const u = unlock('collector');
    if (u) fresh.push(u);
  }
  save(state);
  return fresh;
}

/** All achievements with live locked/unlocked state and progress fractions. */
export function list() {
  return ACHIEVEMENTS.map(a => ({
    ...a,
    unlocked: !!state.unlocked[a.id],
    unlockedAt: state.unlocked[a.id] || 0,
    progress: a.stat && a.stat !== '_unlockedCount'
      ? Math.min(1, (state.stats[a.stat] || 0) / a.at)
      : a.stat === '_unlockedCount'
        ? Math.min(1, unlockedCount() / a.at)
        : null,
  }));
}

/** Validate the table itself (ids unique, every entry has a trigger). For tests. */
export function validate() {
  const ids = new Set();
  const problems = [];
  for (const a of ACHIEVEMENTS) {
    if (ids.has(a.id)) problems.push(`duplicate id ${a.id}`);
    ids.add(a.id);
    if (!a.name || !a.desc || !a.icon || !a.game) problems.push(`incomplete ${a.id}`);
    if (!a.event && !(a.stat && a.at > 0)) problems.push(`no trigger ${a.id}`);
  }
  return problems;
}
