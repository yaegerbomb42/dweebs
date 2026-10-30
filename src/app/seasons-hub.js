// seasons-hub.js — real-world seasonal decorations for the hub.
//
// Maps the current date to a season and provides the CSS class + emoji set.
// The hub applies the class; CSS does the rest.

/**
 * Get the current meteorological season.
 * @param {Date} date
 * @returns {'spring'|'summer'|'autumn'|'winter'}
 */
export function currentSeason(date = new Date()) {
  const m = date.getMonth(); // 0-11
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

export const SEASON_DECOR = {
  spring: { emoji: '🌸', label: 'Spring Bloom' },
  summer: { emoji: '☀️', label: 'Summer Sun' },
  autumn: { emoji: '🍂', label: 'Autumn Harvest' },
  winter: { emoji: '❄️', label: 'Winter Frost' },
};

/** Apply the seasonal class to the hub root. Returns the season. */
export function applySeason(root, date = new Date()) {
  const season = currentSeason(date);
  if (!root?.classList) return season;
  root.classList.remove('season-spring', 'season-summer', 'season-autumn', 'season-winter');
  root.classList.add(`season-${season}`);
  return season;
}
