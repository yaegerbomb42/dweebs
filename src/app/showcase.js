// showcase.js — pin favorite achievements to the hub showcase.

export const SHOWCASE_KEY = 'dweebs-showcase-v1';
export const MAX_PINNED = 3;

function read() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SHOWCASE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(ids) {
  try {
    localStorage.setItem(SHOWCASE_KEY, JSON.stringify(ids));
  } catch { /* private mode */ }
}

/** Get pinned achievement ids. */
export function getPinned() {
  return read();
}

/** Pin an achievement (max 3). Returns the updated list. */
export function pin(id) {
  const ids = read();
  if (!ids.includes(id)) {
    ids.push(id);
    while (ids.length > MAX_PINNED) ids.shift(); // keep newest 3
    write(ids);
  }
  return ids;
}

/** Unpin an achievement. Returns the updated list. */
export function unpin(id) {
  const ids = read().filter(x => x !== id);
  write(ids);
  return ids;
}

/** Is this achievement pinned? */
export function isPinned(id) {
  return read().includes(id);
}
