// friends.js — friend activity feed for the hub.
//
// Generates plausible friend activity (clearly labeled as simulated) to make
// the hub feel alive. Deterministic per day so it doesn't spam.

const FRIENDS = [
  { name: 'Ziggy', emoji: '🦎' },
  { name: 'Mabel', emoji: '🐭' },
  { name: 'Rocco', emoji: '🦔' },
  { name: 'Pip', emoji: '🐤' },
  { name: 'Gus', emoji: '🦆' },
];

const ACTIVITIES = [
  'won a Knockout Brawl',
  'cleared wave 10 in Warfare Defense',
  'bred a legendary dweeb',
  'unlocked the Triathlete achievement',
  'tamed a pet beetle',
  'dug up a Dino Skull relic',
  'hit 1000 style points',
  'survived the lightning round',
];

/**
 * Get today's friend activity. Deterministic per date.
 * @param {Date} date
 * @returns {Array<{friend, emoji, activity, time}>}
 */
export function friendActivity(date = new Date()) {
  const seed = date.getFullYear() * 1000 + date.getMonth() * 40 + date.getDate();
  const rng = mulberry32(seed);
  const count = 3 + Math.floor(rng() * 3); // 3-5 items
  const items = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let fi = Math.floor(rng() * FRIENDS.length);
    while (used.has(fi)) fi = (fi + 1) % FRIENDS.length;
    used.add(fi);
    const f = FRIENDS[fi];
    const a = ACTIVITIES[Math.floor(rng() * ACTIVITIES.length)];
    const hours = Math.floor(rng() * 12) + 1;
    items.push({
      friend: f.name,
      emoji: f.emoji,
      activity: a,
      time: `${hours}h ago`,
    });
  }
  return items;
}

function mulberry32(a) {
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
