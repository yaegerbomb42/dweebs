// login.js — daily login rewards.
//
// Consecutive days grant escalating rewards. Resets if you miss a day.

export const LOGIN_KEY = 'dweebs-login-v1';

const REWARDS = [
  { day: 1, icon: '🪙', label: '50 coins', coins: 50 },
  { day: 2, icon: '🎨', label: 'Random palette', palette: true },
  { day: 3, icon: '🪙', label: '100 coins', coins: 100 },
  { day: 4, icon: '⭐', label: 'Style boost', style: 50 },
  { day: 5, icon: '👑', label: 'Golden crown hat', hat: '👑' },
  { day: 6, icon: '🪙', label: '200 coins', coins: 200 },
  { day: 7, icon: '💎', label: 'Diamond dweeb skin', skin: 'diamond' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function read() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LOGIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(data) {
  try {
    localStorage.setItem(LOGIN_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

/**
 * Check in for today. Returns {streak, reward, isNew} where isNew is false
 * if already checked in today.
 */
export function checkIn() {
  const t = today();
  const d = read();
  if (d?.last === t) {
    return { streak: d.streak, reward: null, isNew: false };
  }
  let streak = 1;
  if (d?.last === yesterday()) {
    streak = d.streak + 1;
  }
  // Cycle rewards weekly.
  const reward = REWARDS[(streak - 1) % REWARDS.length];
  write({ last: t, streak });
  return { streak, reward, isNew: true };
}

/** Get the current streak without checking in. */
export function currentStreak() {
  const d = read();
  if (!d) return 0;
  if (d.last === today() || d.last === yesterday()) return d.streak;
  return 0; // broken streak
}
