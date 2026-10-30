// nemesis.js — rival bots that remember you.
//
// Head-to-head records per bot (localStorage `dweebs-nemesis-v1`). The bot
// with the best record against you becomes your NEMESIS: badged, taunting,
// and shown in the menu. DOM-free and storage-guarded for node tests.

export const NEMESIS_KEY = 'dweebs-nemesis-v1';
/** Wins needed before a bot is crowned your nemesis. */
export const NEMESIS_THRESHOLD = 2;

export const NEMESIS_TAUNTS = [
  'Is that all you\'ve got?',
  'I\'ve beaten you before. I\'ll do it again.',
  'You fight like a tutorial bot.',
  'Remember my name.',
  'The student has not become the master.',
];

function readAll() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(NEMESIS_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(NEMESIS_KEY, JSON.stringify(all));
  } catch { /* private mode */ }
}

/**
 * Record a match result from the player's perspective.
 * @param {string} botName
 * @param {boolean} playerWon
 */
export function recordRivalry(botName, playerWon) {
  if (!botName) return;
  const all = readAll();
  const r = all[botName] || { wins: 0, losses: 0 };
  if (playerWon) r.losses++;
  else r.wins++;
  all[botName] = r;
  writeAll(all);
}

/** {wins, losses} vs a bot, or zeros. */
export function getRivalry(botName) {
  const r = readAll()[botName];
  return r ? { wins: r.wins || 0, losses: r.losses || 0 } : { wins: 0, losses: 0 };
}

/** The player's nemesis: most wins against you (min threshold), or null. */
export function getNemesis() {
  const all = readAll();
  let best = null;
  for (const [name, r] of Object.entries(all)) {
    const wins = r.wins || 0;
    if (wins >= NEMESIS_THRESHOLD && (!best || wins > best.wins)) {
      best = { name, wins, losses: r.losses || 0 };
    }
  }
  return best;
}

/** A taunt line for the nemesis (deterministic pick by match count). */
export function nemesisTaunt(name) {
  const r = getRivalry(name);
  const total = r.wins + r.losses;
  return NEMESIS_TAUNTS[total % NEMESIS_TAUNTS.length];
}

/** Head-to-head line for menus. */
export function rivalryLine(name) {
  const r = getRivalry(name);
  if (r.wins + r.losses === 0) return `${name}: no history yet`;
  return `${name}: ${r.wins}-${r.losses} vs you`;
}
