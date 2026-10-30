// envkills.js — the Hall of Doom: a persistent leaderboard of how dweebs die.
//
// Every KO records its death cause; the board tallies them across all matches.
// DOM-free and storage-guarded for node tests.

export const ENVKILLS_KEY = 'dweebs-envkills-v1';

/** Cause → icon for the leaderboard. */
export const CAUSE_ICONS = {
  'VAPORIZED IN THE VOID': '🌌',
  'DROWNED IN THE LAGOON': '🌊',
  'BLENDED BY INDUSTRIAL SHREDDER': '⚙️',
  'SMASHED BY HYDRAULIC TENDERIZER': '🥩',
};

export function causeIcon(cause) {
  return CAUSE_ICONS[cause] ?? '👊';
}

function readBoard() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(ENVKILLS_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}

function writeBoard(board) {
  try {
    localStorage.setItem(ENVKILLS_KEY, JSON.stringify(board));
  } catch { /* private mode */ }
}

/** Record one death by its cause string. */
export function recordDeath(cause) {
  if (!cause) return;
  const board = readBoard();
  board[cause] = (board[cause] || 0) + 1;
  writeBoard(board);
}

/** Leaderboard entries sorted by count desc: [{cause, icon, count}]. */
export function getBoard(limit = 5) {
  const board = readBoard();
  return Object.entries(board)
    .map(([cause, count]) => ({ cause, icon: causeIcon(cause), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Total recorded deaths. */
export function totalDeaths() {
  return Object.values(readBoard()).reduce((a, b) => a + b, 0);
}
