// rushboard.js — boss rush leaderboard.
//
// Best timed completion times.

export const RUSHBOARD_KEY = 'dweebs-rushboard-v1';
export const MAX_ENTRIES = 10;

function read() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(RUSHBOARD_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(RUSHBOARD_KEY, JSON.stringify(entries));
  } catch { /* private mode */ }
}

/** Get the leaderboard (sorted fastest first). */
export function getBoard() {
  return read().sort((a, b) => a.time - b.time);
}

/**
 * Submit a time. Returns {rank, board} where rank is 1-based or null if
 * it didn't make the board.
 */
export function submitTime(time, name = 'You') {
  const board = read();
  const entry = { time, name, date: new Date().toISOString().slice(0, 10) };
  board.push(entry);
  board.sort((a, b) => a.time - b.time);
  const trimmed = board.slice(0, MAX_ENTRIES);
  write(trimmed);
  const rank = trimmed.indexOf(entry) + 1;
  return { rank: rank > 0 ? rank : null, board: trimmed };
}

/** Clear the board. */
export function clearBoard() {
  write([]);
}
