// forecast.js — expedition weather forecast.
//
// Predicts upcoming disasters so players can prepare.

import { DISASTER_TYPES } from './disasters.js';

const DISASTER_IDS = Object.keys(DISASTER_TYPES);

/**
 * Generate a 3-day forecast.
 * @param {function} rng
 * @returns {Array<{day, disaster, icon}>}
 */
export function forecast(rng = Math.random) {
  const days = [];
  for (let i = 1; i <= 3; i++) {
    // 40% chance of a disaster each day.
    if (rng() < 0.4) {
      const id = DISASTER_IDS[Math.floor(rng() * DISASTER_IDS.length)];
      const d = DISASTER_TYPES[id];
      days.push({ day: i, disaster: d.name, icon: d.icon });
    } else {
      days.push({ day: i, disaster: 'Clear', icon: '☀️' });
    }
  }
  return days;
}

/** Format the forecast for display. */
export function formatForecast(days) {
  return days.map(d => `${d.icon} Day ${d.day}: ${d.disaster}`).join(' · ');
}
