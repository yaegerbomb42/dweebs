// themes.js — expedition village visual themes.

export const THEMES = {
  meadow: { name: 'Meadow', icon: '🌱', desc: 'Classic green', sky: '#87ceeb', ground: '#7ec850' },
  desert: { name: 'Desert', icon: '🏜️', desc: 'Sandy dunes', sky: '#ffd699', ground: '#e6b800' },
  snow: { name: 'Snow', icon: '❄️', desc: 'Winter wonderland', sky: '#b8d4e8', ground: '#ffffff' },
  sunset: { name: 'Sunset', icon: '🌅', desc: 'Golden hour', sky: '#ff9a56', ground: '#c98a5e' },
  night: { name: 'Night', icon: '🌙', desc: 'Starry night', sky: '#0a0a2e', ground: '#2d4a2d' },
};

export const THEME_KEY = 'dweebs-theme-v1';

function read() {
  try {
    if (typeof localStorage === 'undefined') return 'meadow';
    return localStorage.getItem(THEME_KEY) || 'meadow';
  } catch {
    return 'meadow';
  }
}

function write(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* private mode */ }
}

/** Get the current theme id. */
export function currentTheme() {
  const t = read();
  return THEMES[t] ? t : 'meadow';
}

/** Get the theme data. */
export function themeData(id = currentTheme()) {
  return THEMES[id] || THEMES.meadow;
}

/** Set the theme. Returns true if valid. */
export function setTheme(id) {
  if (!THEMES[id]) return false;
  write(id);
  return true;
}
