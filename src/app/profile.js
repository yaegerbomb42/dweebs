// profile.js — hub profile customization.

export const PROFILE_KEY = 'dweebs-profile-v1';

export const AVATARS = ['🦎', '🐭', '🦔', '🐤', '🦆', '🐸', '🐙', '🦄'];
export const TITLES = ['Rookie', 'Brawler', 'Champion', 'Legend', 'Mythic'];

function read() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(data) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

/** Get the profile, with defaults. */
export function getProfile() {
  return read() || { name: 'Player', avatar: '🦎', title: 'Rookie', color: '#4a90e2' };
}

/**
 * Update the profile.
 * @param {object} updates
 * @returns {object} updated profile
 */
export function updateProfile(updates) {
  const p = { ...getProfile(), ...updates };
  // Validate.
  if (!AVATARS.includes(p.avatar)) p.avatar = '🦎';
  if (!TITLES.includes(p.title)) p.title = 'Rookie';
  if (typeof p.name !== 'string' || !p.name.trim()) p.name = 'Player';
  p.name = p.name.trim().slice(0, 20);
  write(p);
  return p;
}
