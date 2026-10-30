// crossgame.js — cross-game daily challenge tracker.
//
// Tracks the Triathlon: win an arena match, clear a warfare wave, breed a
// dweeb — all on the same calendar day. Stored in localStorage.

export const CROSSGAME_KEY = 'dweebs-crossgame-v1';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function read() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CROSSGAME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(data) {
  try {
    localStorage.setItem(CROSSGAME_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

/** Get today's progress {arena, warfare, builder, done}. */
export function getProgress() {
  const d = read();
  const t = today();
  if (!d || d.date !== t) {
    return { date: t, arena: false, warfare: false, builder: false };
  }
  return d;
}

/** Mark a leg complete. Returns the updated progress. */
export function completeLeg(leg) {
  if (!['arena', 'warfare', 'builder'].includes(leg)) return getProgress();
  const p = getProgress();
  p[leg] = true;
  write(p);
  return p;
}

/** Has the triathlon been completed today? */
export function isComplete() {
  const p = getProgress();
  return p.arena && p.warfare && p.builder;
}

/** Progress line for the hub. */
export function progressLine() {
  const p = getProgress();
  const parts = [
    p.arena ? '✅' : '⬜',
    p.warfare ? '✅' : '⬜',
    p.builder ? '✅' : '⬜',
  ];
  return `${parts[0]} Arena ${parts[1]} Warfare ${parts[2]} Builder`;
}
