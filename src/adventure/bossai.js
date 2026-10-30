// bossai.js — smarter boss AI for invasions.
//
// Bosses pick targets strategically and use special attacks.

export const BOSS_TACTICS = {
  grumblor: {
    tactic: 'siege',
    desc: 'Targets buildings first',
    special: 'quake', // AoE stomp
  },
  skitter: {
    tactic: 'harass',
    desc: 'Hit-and-run on citizens',
    special: 'swarm', // Spawns minions
  },
  mudking: {
    tactic: 'brute',
    desc: 'Charges the nearest defender',
    special: 'mudslide', // Slows area
  },
};

/**
 * Pick a target for the boss.
 * @param {string} bossId
 * @param {Array} targets [{x, z, type, hp}]
 * @param {object} boss {x, z}
 * @returns {object|null} target
 */
export function pickTarget(bossId, targets, boss) {
  if (!targets.length) return null;
  const tactic = BOSS_TACTICS[bossId]?.tactic || 'brute';
  
  if (tactic === 'siege') {
    // Prefer buildings.
    const buildings = targets.filter(t => t.type === 'building');
    if (buildings.length) return nearest(buildings, boss);
  } else if (tactic === 'harass') {
    // Prefer weak citizens.
    const citizens = targets.filter(t => t.type === 'citizen');
    if (citizens.length) {
      return citizens.sort((a, b) => a.hp - b.hp)[0];
    }
  }
  // Brute: nearest target.
  return nearest(targets, boss);
}

function nearest(targets, boss) {
  let best = null, bestD = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - boss.x, t.z - boss.z);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * Should the boss use its special? (cooldown-based)
 * @param {string} bossId
 * @param {number} cooldown remaining
 * @param {number} hpFrac 0-1
 */
export function shouldUseSpecial(bossId, cooldown, hpFrac) {
  if (cooldown > 0) return false;
  // Desperate bosses use specials more when hurt.
  return hpFrac < 0.5 || Math.random() < 0.1;
}
