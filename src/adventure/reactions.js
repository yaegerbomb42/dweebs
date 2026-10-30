// reactions.js — dweeb emoji reactions to events.
//
// Citizens react with emoji to big events.

export const REACTIONS = {
  festival: ['🎉', '🥳', '🎊'],
  bossDefeated: ['💪', '🎯', '🏆'],
  bossIncoming: ['😱', '😨', '🫣'],
  harvest: ['🌾', '🍞', '😋'],
  storm: ['⛈️', '😬', '🏃'],
  birth: ['👶', '🎈', '💝'],
  relic: ['🤩', '💎', '✨'],
};

/**
 * Get a random reaction emoji for an event.
 * @param {string} event
 * @param {function} rng
 * @returns {string} emoji
 */
export function react(event, rng = Math.random) {
  const options = REACTIONS[event];
  if (!options) return '💬';
  return options[Math.floor(rng() * options.length)];
}

/**
 * Make citizens react to an event.
 * @param {Array} citizens
 * @param {string} event
 * @param {function} rng
 */
export function reactAll(citizens, event, rng = Math.random) {
  for (const c of citizens) {
    if (c.say) c.say('', react(event, rng), 3);
  }
}
