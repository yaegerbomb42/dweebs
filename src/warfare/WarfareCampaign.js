// WarfareCampaign.js — the Dweeb Warfare campaign: a 6-mission tour with a persistent army.
//
// Survivors of a won mission fight on as veterans (+15% max HP) in the next one, so the
// campaign plays as one long war rather than six skirmishes. Progress (unlocked missions and
// stars) persists in localStorage. Everything here is offline and deterministic: missions pin
// their own seeds, and the sim derives AI personalities from the seed, so replays are identical.
//
// The offline test (test/warfare-offline.test.js) scans this file: no fetch/WebSocket/XHR here.
import { AI_PERSONALITIES } from '../sim/warfareBattle.js';
import { DIFFICULTY } from '../sim/warfareWaves.js';
import { WF_HZ } from '../sim/warfareBattle.js';

export const CAMPAIGN_KEY = 'dweebs-warfare-campaign';
export const MAX_VETERANS = 12;

export const CAMPAIGN = Object.freeze([
  {
    id: 'boot-camp', name: 'Boot Camp',
    briefing: 'Your first command. Hold the fort for 5 waves on open ground and learn the ropes.',
    mode: 'defense', difficulty: 'easy', map: 'OPEN FIELD', waves: 5, seed: 1101,
  },
  {
    id: 'crossfire', name: 'Crossfire',
    briefing: 'The crossroads are crawling. 6 waves, real resistance — keep your shields up.',
    mode: 'defense', difficulty: 'normal', map: 'CROSSROADS', waves: 6, seed: 2202,
  },
  {
    id: 'gauntlet-run', name: 'Gauntlet Run',
    briefing: 'A narrow killing field and 7 waves of toys that want your fort in pieces.',
    mode: 'defense', difficulty: 'normal', map: 'GAUNTLET', waves: 7, seed: 3303,
  },
  {
    id: 'first-strike', name: 'First Strike',
    briefing: 'Take the fight to them. The Siege Mistress turtles behind her walls — crack the red fort.',
    mode: 'versus', difficulty: 'normal', map: 'CANYON', seed: 4404, personality: 'turtle', aiLevel: 1,
  },
  {
    id: 'brawlers-pit', name: "Brawler's Pit",
    briefing: 'Brawler Bax is waiting in the corners with kamis and a war horn. Hit first, hit hard.',
    mode: 'versus', difficulty: 'normal', map: 'CORNERS', seed: 5505, personality: 'brawler', aiLevel: 1.15,
  },
  {
    id: 'last-stand', name: 'Last Stand',
    briefing: 'The full tour: 10 hard waves across the islets, bosses at 5 and 10. Hold everything.',
    mode: 'defense', difficulty: 'hard', map: 'ISLETS', waves: 10, seed: 6606,
  },
]);

export function missionById(id) {
  return CAMPAIGN.find(m => m.id === id) || null;
}

/** Validate a mission def (used by tests and the HUD). Returns an array of problems. */
export function validateMission(m) {
  const problems = [];
  if (!m.id || !m.name || !m.briefing) problems.push('missing id/name/briefing');
  if (m.mode !== 'defense' && m.mode !== 'versus') problems.push(`bad mode ${m.mode}`);
  if (!DIFFICULTY[m.difficulty]) problems.push(`bad difficulty ${m.difficulty}`);
  if (!Number.isInteger(m.seed)) problems.push('seed must be an integer');
  if (m.mode === 'defense' && !(Number.isInteger(m.waves) && m.waves >= 1)) problems.push('defense needs waves >= 1');
  if (m.personality && !AI_PERSONALITIES.includes(m.personality)) problems.push(`bad personality ${m.personality}`);
  if (m.aiLevel !== undefined && !(m.aiLevel > 0 && m.aiLevel <= 3)) problems.push(`bad aiLevel ${m.aiLevel}`);
  return problems;
}

export function blankProgress() {
  return { unlocked: 0, stars: {} };
}

/** Read campaign progress; never throws (private-mode localStorage, corrupt JSON). */
export function loadCampaign() {
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return blankProgress();
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return blankProgress();
    return {
      unlocked: Math.max(0, Math.min(CAMPAIGN.length - 1, p.unlocked | 0)),
      stars: p.stars && typeof p.stars === 'object' ? p.stars : {},
    };
  } catch { return blankProgress(); }
}

export function saveCampaign(p) {
  try { localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

/** Record a mission win: unlock the next mission, keep the best star count. Pure. */
export function recordWin(progress, missionIdx, stars) {
  const p = { unlocked: progress.unlocked, stars: { ...progress.stars } };
  const m = CAMPAIGN[missionIdx];
  if (!m) return p;
  p.stars[m.id] = Math.max(p.stars[m.id] || 0, stars);
  p.unlocked = Math.max(p.unlocked, Math.min(CAMPAIGN.length - 1, missionIdx + 1));
  return p;
}

/**
 * Stars for a won mission, from the finished battle state. Defense: keep the fort healthy.
 * Versus: win fast.
 */
export function missionStars(mission, st) {
  if (st.winner !== 'blue') return 0;
  if (mission.mode === 'defense') {
    const f = st.forts.blue.hp / st.forts.blue.maxHp;
    return f > 0.66 ? 3 : f > 0.33 ? 2 : 1;
  }
  const secs = st.tick / WF_HZ;
  return secs < 240 ? 3 : secs < 480 ? 2 : 1;
}

/** Blue survivors become veterans for the next mission: [{type, hpFrac}], deterministic order. */
export function collectVeterans(st, cap = MAX_VETERANS) {
  const out = [];
  const alive = st.units.filter(u => u.alive && u.team === 'blue').sort((a, b) => a.id - b.id);
  for (const u of alive) {
    if (out.length >= cap) break;
    out.push({ type: u.type, hpFrac: Math.round((u.hp / u.maxHp) * 100) / 100 });
  }
  return out;
}
