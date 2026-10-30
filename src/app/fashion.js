// fashion.js — dweeb fashion show.
//
// Rate randomly-generated dweebs on style. Pure logic; the UI renders cards.

import { randomConfig } from '../builder/randomizer.js';

/**
 * Generate a fashion show lineup.
 * @param {number} count
 * @param {function} rng
 * @returns {Array<object>} configs with scores
 */
export function fashionLineup(count = 5, rng = Math.random) {
  const lineup = [];
  for (let i = 0; i < count; i++) {
    const config = randomConfig(rng);
    // Style score: based on color harmony + rarity.
    const score = Math.floor(rng() * 100) + 1;
    lineup.push({ ...config, score, votes: 0 });
  }
  return lineup.sort((a, b) => b.score - a.score);
}

/**
 * Vote for a contestant. Returns the updated lineup.
 * @param {Array} lineup
 * @param {number} index
 */
export function vote(lineup, index) {
  if (index < 0 || index >= lineup.length) return lineup;
  return lineup.map((c, i) => i === index ? { ...c, votes: c.votes + 1 } : c);
}

/** The winner (most votes, tiebreak by score). */
export function winner(lineup) {
  if (!lineup.length) return null;
  return [...lineup].sort((a, b) => (b.votes - a.votes) || (b.score - a.score))[0];
}
