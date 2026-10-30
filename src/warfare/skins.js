// skins.js — cosmetic skins for warfare units.

export const SKINS = {
  default: { name: 'Default', icon: '🎨', desc: 'Standard issue' },
  golden: { name: 'Golden', icon: '✨', desc: 'Shiny and proud', unlock: 'Win 10 matches' },
  shadow: { name: 'Shadow', icon: '🌑', desc: 'Sneaky dark', unlock: 'Win a survival run' },
  rainbow: { name: 'Rainbow', icon: '🌈', desc: 'Fabulous', unlock: 'Collect 50 cards' },
};

export const SKIN_KEY = 'dweebs-skins-v1';

function read() {
  try {
    if (typeof localStorage === 'undefined') return { selected: 'default', unlocked: ['default'] };
    const raw = localStorage.getItem(SKIN_KEY);
    return raw ? JSON.parse(raw) : { selected: 'default', unlocked: ['default'] };
  } catch {
    return { selected: 'default', unlocked: ['default'] };
  }
}

function write(data) {
  try {
    localStorage.setItem(SKIN_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

/** Get the selected skin. */
export function selectedSkin() {
  return read().selected;
}

/** Get unlocked skins. */
export function unlockedSkins() {
  return read().unlocked;
}

/** Unlock a skin. Returns true if newly unlocked. */
export function unlockSkin(id) {
  if (!SKINS[id]) return false;
  const d = read();
  if (d.unlocked.includes(id)) return false;
  d.unlocked.push(id);
  write(d);
  return true;
}

/** Select a skin (must be unlocked). */
export function selectSkin(id) {
  const d = read();
  if (!d.unlocked.includes(id)) return false;
  d.selected = id;
  write(d);
  return true;
}
