// botPersonalities.js — AI personalities for arena bots.
//
// Different bots fight differently.

export const BOT_PERSONALITIES = {
  brawler: {
    name: 'Brawler', icon: '🥊',
    desc: 'Seeks fights constantly',
    aggression: 1.5, evasion: 0.5,
  },
  coward: {
    name: 'Coward', icon: '🏃',
    desc: 'Runs from danger',
    aggression: 0.3, evasion: 1.5,
  },
  opportunist: {
    name: 'Opportunist', icon: '🎯',
    desc: 'Attacks weakened foes',
    aggression: 1.0, evasion: 1.0, focusWeak: true,
  },
  showman: {
    name: 'Showman', icon: '🤩',
    desc: 'Styles over substance',
    aggression: 0.8, evasion: 0.8, styleFocus: true,
  },
  tank: {
    name: 'Tank', icon: '🛡️',
    desc: 'Slow but unstoppable',
    aggression: 1.0, evasion: 0.3, hpMul: 1.5,
  },
};

export const BOT_PERSONALITY_IDS = Object.keys(BOT_PERSONALITIES);

/**
 * Assign a random personality.
 * @param {function} rng
 */
export function randomPersonality(rng = Math.random) {
  return BOT_PERSONALITY_IDS[Math.floor(rng() * BOT_PERSONALITY_IDS.length)];
}
