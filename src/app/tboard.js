// tboard.js — time attack leaderboard.
//
// Best times per arena mode.

export const TBOARD_KEY = 'dweebs-tboard-v1';

function read() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(TBOARD_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(TBOARD_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

/** Get all best times {mode: seconds}. */
export function getBoard() {
  return read();
}

/** Get the best time for a mode. */
export function bestFor(mode) {
  return read()[mode] ?? null;
}

/**
 * Submit a time. Returns true if it's a new record.
 * @param {string} mode
 * @param {number} seconds
 */
export function submit(mode, seconds) {
  const d = read();
  if (d[mode] == null || seconds < d[mode]) {
    d[mode] = seconds;
    write(d);
    return true;
  }
  return false;
}
