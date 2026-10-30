// powerups.js — arena power-ups.
//
// Spawn in the arena; dweebs grab them for temporary boosts.

export const POWERUPS = {
  speed: {
    name: 'Speed Boost', icon: '⚡',
    desc: '+50% speed for 10s',
    duration: 10, speedMul: 1.5,
  },
  shield: {
    name: 'Shield', icon: '🛡️',
    desc: 'Invulnerable for 5s',
    duration: 5, invuln: true,
  },
  rage: {
    name: 'Rage', icon: '😡',
    desc: '+100% damage for 8s',
    duration: 8, dmgMul: 2.0,
  },
  magnet: {
    name: 'Magnet', icon: '🧲',
    desc: 'Pulls nearby dweebs for 6s',
    duration: 6, magnet: true,
  },
};

export const POWERUP_IDS = Object.keys(POWERUPS);

/**
 * Spawn a random power-up.
 * @param {function} rng
 * @returns {{type, x, z}}
 */
export function spawnPowerup(rng = Math.random) {
  const type = POWERUP_IDS[Math.floor(rng() * POWERUP_IDS.length)];
  // Random position in arena (radius 16).
  const angle = rng() * Math.PI * 2;
  const r = 4 + rng() * 10;
  return {
    type,
    x: Math.cos(angle) * r,
    z: Math.sin(angle) * r,
    ...POWERUPS[type],
  };
}

/**
 * Apply a power-up to a dweeb.
 * @param {object} dweeb
 * @param {object} powerup
 */
export function applyPowerup(dweeb, powerup) {
  dweeb.powerup = {
    type: powerup.type,
    expires: (dweeb.powerup?.expires || 0) + powerup.duration,
    ...powerup,
  };
  return dweeb.powerup;
}
