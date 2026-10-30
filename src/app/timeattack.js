// timeattack.js — arena time attack mode.
//
// Win as fast as possible. Best times are saved per mode.

export const TIMEATTACK_KEY = 'dweebs-timeattack-v1';

function read() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(TIMEATTACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(TIMEATTACK_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

/** Get the best time for a mode (seconds), or null. */
export function bestTime(mode) {
  return read()[mode] ?? null;
}

/**
 * Record a win time. Returns {time, isRecord}.
 * @param {string} mode
 * @param {number} seconds
 */
export function recordTime(mode, seconds) {
  const d = read();
  const prev = d[mode];
  const isRecord = prev == null || seconds < prev;
  if (isRecord) {
    d[mode] = seconds;
    write(d);
  }
  return { time: seconds, isRecord };
}

/** Format seconds as M:SS.t */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
