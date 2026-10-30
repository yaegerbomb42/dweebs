// nicknames.js — custom nicknames for warfare units.
//
// Players can rename their heroes. Stored in localStorage.

export const NICKNAME_KEY = 'dweebs-nicknames-v1';

function read() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(NICKNAME_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(NICKNAME_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

/** Get the nickname for a unit id, or null. */
export function getNickname(unitId) {
  return read()[unitId] || null;
}

/** Set the nickname for a unit id. */
export function setNickname(unitId, name) {
  const d = read();
  if (!name?.trim()) {
    delete d[unitId];
  } else {
    d[unitId] = name.trim().slice(0, 20);
  }
  write(d);
}

/** Clear all nicknames. */
export function clearNicknames() {
  try {
    localStorage.removeItem(NICKNAME_KEY);
  } catch { /* private mode */ }
}
