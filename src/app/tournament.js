// tournament.js — daily tournament brackets.
//
// 8-player single elimination. Deterministic per day.

export function dailyBracket(date = new Date(), rng = Math.random) {
  const seed = date.getFullYear() * 1000 + date.getMonth() * 40 + date.getDate();
  const r = mulberry32(seed);
  const players = ['You', 'Ziggy', 'Mabel', 'Rocco', 'Pip', 'Gus', 'Nova', 'Blitz'];
  // Shuffle.
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }
  // Quarterfinals.
  const qf = [];
  for (let i = 0; i < 8; i += 2) {
    qf.push({ p1: players[i], p2: players[i + 1], winner: null });
  }
  return { date: date.toISOString().slice(0, 10), quarterfinals: qf, semifinals: [], final: null, champion: null };
}

/**
 * Simulate a match. Player wins 60% of the time.
 * @param {object} match {p1, p2}
 * @param {function} rng
 */
export function playMatch(match, rng = Math.random) {
  const p1Wins = match.p1 === 'You' ? rng() < 0.6 : rng() < 0.5;
  match.winner = p1Wins ? match.p1 : match.p2;
  return match.winner;
}

function mulberry32(a) {
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
