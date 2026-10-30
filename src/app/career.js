// career.js — lifetime brawl record that survives reloads. One versioned
// localStorage blob; every read/write is defensive so a full or corrupt store
// can never break the results screen.

const KEY = 'dweebs-career-v1';
const HISTORY = 10;

const blank = () => ({ v: 1, matches: 0, wins: 0, kos: 0, falls: 0, streak: 0, bestStreak: 0,
  stylePeak: 0, byMode: {}, byDweeb: {}, recent: [] });

function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function loadCareer(storage = store()) {
  try {
    const c = JSON.parse(storage?.getItem(KEY) || 'null');
    if (c && c.v === 1) return { ...blank(), ...c };
  } catch { /* corrupt → fresh */ }
  return blank();
}

/** Record one finished match for the human player. Returns { career, notes }. */
export function recordMatch({ mode = 'brawl', won = false, kos = 0, falls = 0, stylePeak = 0, dweeb = 'cube', arena = '' } = {},
  storage = store()) {
  const c = loadCareer(storage);
  const notes = [];
  const prevPeak = c.stylePeak, prevBest = c.bestStreak;
  c.matches++;
  c.kos += kos | 0;
  c.falls += falls | 0;
  if (won) { c.wins++; c.streak++; } else c.streak = 0;
  c.bestStreak = Math.max(c.bestStreak, c.streak);
  c.stylePeak = Math.max(c.stylePeak, Math.round(stylePeak) || 0);
  const m = (c.byMode[mode] ||= { played: 0, wins: 0 });
  m.played++; if (won) m.wins++;
  c.byDweeb[dweeb] = (c.byDweeb[dweeb] || 0) + 1;
  c.recent = [{ mode, won, kos: kos | 0, arena, t: Date.now() }, ...c.recent].slice(0, HISTORY);

  if (c.matches === 1) notes.push('First career match on record!');
  if (won && c.streak >= 2) notes.push(`🔥 ${c.streak}-win streak`);
  if (c.bestStreak > prevBest && c.bestStreak >= 3) notes.push('New best streak!');
  if (c.stylePeak > prevPeak && prevPeak > 0) notes.push(`New style peak: ${c.stylePeak}`);
  if ([10, 25, 50, 100, 250].includes(c.matches)) notes.push(`${c.matches} matches played`);
  if (Math.floor((c.kos - kos) / 50) < Math.floor(c.kos / 50)) notes.push(`${Math.floor(c.kos / 50) * 50} career KOs`);
  try { storage?.setItem(KEY, JSON.stringify(c)); } catch { /* quota: keep playing */ }
  return { career: c, notes };
}

export function favoriteDweeb(c) {
  let best = null, n = 0;
  for (const [k, v] of Object.entries(c.byDweeb || {})) if (v > n) { best = k; n = v; }
  return best;
}

/** Recent form as W/L pips, newest first. */
export function formPips(c) {
  return (c.recent || []).map(r => `<span class="career-pip ${r.won ? 'w' : 'l'}" title="${r.mode}${r.arena ? ' · ' + r.arena : ''} · ${r.kos} KO">${r.won ? 'W' : 'L'}</span>`).join('');
}

export function careerSummaryHtml(c, notes = []) {
  const rate = c.matches ? Math.round((c.wins / c.matches) * 100) : 0;
  return `<div class="career-line"><b>Career</b> ${c.wins}W–${c.matches - c.wins}L (${rate}%) · ${c.kos} KOs · best streak ${c.bestStreak}</div>
    <div class="career-form">${formPips(c)}</div>
    ${notes.map(n => `<div class="career-note">${n}</div>`).join('')}`;
}
