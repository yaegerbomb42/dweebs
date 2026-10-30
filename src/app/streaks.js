// streaks.js — arena win streaks.
//
// Tracks consecutive wins. Win 3 in a row for a bonus.

export const STREAK_KEY = 'dweebs-streak-v1';

function read() {
  try {
    if (typeof localStorage === 'undefined') return { streak: 0, best: 0 };
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : { streak: 0, best: 0 };
  } catch {
    return { streak: 0, best: 0 };
  }
}

function write(data) {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

/** Get the current streak {streak, best}. */
export function getStreak() {
  return read();
}

/**
 * Record a match result. Returns {streak, best, bonus} where bonus is true
 * when the streak hits a multiple of 3.
 */
export function recordResult(won) {
  const d = read();
  if (won) {
    d.streak++;
    d.best = Math.max(d.best, d.streak);
  } else {
    d.streak = 0;
  }
  write(d);
  return { ...d, bonus: won && d.streak % 3 === 0 };
}

/** Reset the streak. */
export function resetStreak() {
  write({ streak: 0, best: 0 });
}
