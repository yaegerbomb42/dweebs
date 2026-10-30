// ghosts.js — async ghost rivals.
//
// Your best past performance per arena mode, saved as a "ghost" you race
// against. A ghost is pure data (no replay): KOs, match duration, style peak.
// Beating it saves a new ghost. DOM-free and storage-guarded for node tests.

export const GHOST_KEY = 'dweebs-ghosts-v1';

/**
 * Compare two ghosts. Better = more KOs, then shorter duration, then style.
 * @returns {number} >0 if a beats b, <0 if b beats a, 0 if tied
 */
export function compareGhosts(a, b) {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  if (a.kos !== b.kos) return a.kos - b.kos;
  if (a.durationSec !== b.durationSec) return b.durationSec - a.durationSec;
  return (a.stylePeak || 0) - (b.stylePeak || 0);
}

export function isNewRecord(ghost, prev) {
  return compareGhosts(ghost, prev) > 0;
}

function readAll() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(GHOST_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(GHOST_KEY, JSON.stringify(all));
  } catch { /* private mode */ }
}

/** Best ghost for a mode, or null. */
export function getGhost(mode) {
  return readAll()[mode] ?? null;
}

/**
 * Save a ghost if it beats the stored one. Returns 'record' | 'kept' | 'saved'.
 * ('saved' = first ghost for the mode.)
 */
export function saveGhost(mode, ghost) {
  const all = readAll();
  const prev = all[mode] ?? null;
  if (!prev) {
    all[mode] = ghost;
    writeAll(all);
    return 'saved';
  }
  if (isNewRecord(ghost, prev)) {
    all[mode] = ghost;
    writeAll(all);
    return 'record';
  }
  return 'kept';
}

/** Human-readable ghost line for menus/HUD. */
export function ghostLine(ghost) {
  if (!ghost) return 'No rival yet — set one!';
  const mm = Math.floor(ghost.durationSec / 60);
  const ss = String(Math.floor(ghost.durationSec % 60)).padStart(2, '0');
  return `${ghost.kos} KO${ghost.kos === 1 ? '' : 's'} · ${mm}:${ss} · ${ghost.fighterName || 'you'}`;
}

/**
 * Live pace check: are you ahead of the ghost's KO pace right now?
 * @param {object} ghost
 * @param {number} kosNow player KOs so far
 * @param {number} tNow seconds elapsed
 */
export function aheadOfGhost(ghost, kosNow, tNow) {
  if (!ghost || ghost.durationSec <= 0) return false;
  const ghostPace = ghost.kos / ghost.durationSec;
  const expected = ghostPace * tNow;
  return kosNow > expected + 0.5;
}

/** Have you already beaten the ghost's final KO total? */
export function ghostBeaten(ghost, kosNow) {
  return !!ghost && kosNow > ghost.kos;
}
