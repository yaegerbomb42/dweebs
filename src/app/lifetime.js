// lifetime.js — lifetime player stats for the hub.
//
// Aggregates the persistent stores the games already write (achievements,
// ghosts, betting, envkills) into one summary for a "lifetime stats" hub card.
// DOM-free and storage-guarded for node tests.

import { statValue, unlockedCount, totalCount } from './achievements.js';
import { GHOST_KEY } from './ghosts.js';
import { getCoins } from './betting.js';
import { totalDeaths } from './envkills.js';

function readJson(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Lifetime summary. Never throws; missing stores read as zero.
 * @returns {{matches,wins,winRate,kos,ghosts,coins,betProfit,deaths,achievements,achievementsTotal}}
 */
export function getLifetimeStats() {
  const matches = statValue('match');
  const wins = statValue('win');
  const kos = statValue('ko');
  const ghostsData = readJson(GHOST_KEY) || {};
  const ghosts = Object.keys(ghostsData).length;
  let coins = 0;
  try { coins = getCoins(); } catch { /* no storage */ }
  const betProfit = statValue('betProfit');
  let deaths = 0;
  try { deaths = totalDeaths(); } catch { /* no storage */ }
  return {
    matches,
    wins,
    winRate: matches > 0 ? Math.round((wins / matches) * 100) : 0,
    kos,
    ghosts,
    coins,
    betProfit,
    deaths,
    achievements: unlockedCount(),
    achievementsTotal: totalCount(),
  };
}
