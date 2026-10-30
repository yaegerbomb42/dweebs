// morale.js — dweeb morale for Expedition & Dynasty.
//
// Every citizen has morale (0-100). It drifts toward a target computed from
// their vitals and world events (disasters, invasions, festivals), and it
// scales their productivity: happy dweebs forage faster, miserable ones dawdle.
// Pure functions + a tiny updater, fully testable.

/** Work-speed multiplier for a morale value: 0.7x (miserable) → 1.3x (ecstatic). */
export function workMultiplier(morale) {
  const m = Math.max(0, Math.min(100, morale ?? 60));
  return 0.7 + (m / 100) * 0.6;
}

/** Mood override for extreme morale (null = keep the citizen's own mood). */
export function moraleMood(morale) {
  if (morale < 25) return 'miserable';
  if (morale < 40) return 'sad';
  if (morale > 88) return 'ecstatic';
  return null;
}

/**
 * Compute a citizen's morale target (0-100) from vitals + world factors.
 * @param {object} c citizen-like {hunger, energy}
 * @param {object} f factors {disaster, invasion, festival, isNight}
 */
export function moraleTarget(c, f = {}) {
  let t = 62; // baseline: content village life
  if ((c.hunger ?? 0) > 75) t -= 22;       // starving
  else if ((c.hunger ?? 0) < 30) t += 8;   // well fed
  if ((c.energy ?? 100) < 25) t -= 14;     // exhausted
  else if ((c.energy ?? 0) > 70) t += 6;   // rested
  if (f.disaster) t -= 18;
  if (f.invasion) t -= 22;
  if (f.festival) t += 20;
  if (f.isNight) t -= 4;                   // the dark is spooky
  // Friendship: strong bonds lift the spirits; loneliness drags.
  const friends = c.friends;
  if (friends && typeof friends.size === 'number' && friends.size > 0) {
    let sum = 0;
    for (const bond of friends.values()) sum += bond;
    t += (sum / friends.size / 100) * 12;  // up to +12 for a beloved dweeb
  } else {
    t -= 5;                                // lonely
  }
  return Math.max(0, Math.min(100, t));
}

/**
 * Drift morale toward its target. Returns the new morale.
 * rate: fraction of the gap closed per second (~0.05 = slow mood shift).
 */
export function driftMorale(morale, target, dt, rate = 0.05) {
  const m = morale ?? 60;
  return m + (target - m) * Math.min(1, rate * dt);
}

/** One-shot morale shocks from world events. */
export function applyMoraleShock(citizens, amount) {
  for (const c of citizens) {
    c.morale = Math.max(0, Math.min(100, (c.morale ?? 60) + amount));
  }
}

/** Average morale of a citizen list (0-100). */
export function averageMorale(citizens) {
  if (!citizens || citizens.length === 0) return 60;
  let sum = 0;
  for (const c of citizens) sum += c.morale ?? 60;
  return sum / citizens.length;
}
