// history.js — recent finished matches, for /status.
//
// The server keeps no accounts and no database, so there is no per-player
// leaderboard to build. What it can honestly report is what just happened:
// the last few finished matches (room, when, how long, who played). That is the
// natural home for "stats" on a stateless server: the Play Online screen can show
// "recent battles" without anyone needing to log in.

const MAX_KEPT = 20;
const recent = [];

/**
 * Record a finished match. `players` is an array of display names.
 * @returns the recorded entry
 */
export function recordMatch({ room, durationS, players }) {
  const entry = {
    room: String(room || ''),
    at: Date.now(),
    durationS: Math.max(0, Math.round(Number(durationS) || 0)),
    players: (Array.isArray(players) ? players : []).map(String).slice(0, 8),
  };
  recent.unshift(entry);
  if (recent.length > MAX_KEPT) recent.length = MAX_KEPT;
  return entry;
}

/** Newest first, for /status. Returns copies so callers can't mutate the ring. */
export function recentMatches() {
  return recent.map(e => ({ ...e, players: [...e.players] }));
}

/** Test hook. */
export function clearHistory() {
  recent.length = 0;
}
