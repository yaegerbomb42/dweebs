// src/sim/tournament.js — a single-elimination bracket played entirely in the sim.
//
// Tournament mode for Knockout Arena: N entrants (bots, or bot-vs-bot exhibitions), seeded
// bracket, best-of rounds per the config, one champion. Every match is a real headless Sim,
// so the bracket is as deterministic as the sim: same seed, same champion.
//
// This is the headless core. The view-side bracket UI (main.js, off-limits) renders the
// returned structure; the events of each match are already in the contract.

import { Sim } from './Sim.js';

const NAMES = ['Blorp', 'Squish', 'Nugget', 'Wobbles', 'Toast', 'Pickle', 'Gumbo', 'Brim'];
const TYPES = ['cube', 'blob', 'spiky'];

/**
 * Play one bracket match to completion.
 * @returns {Promise<{winner: number, loser: number, ticks: number, kos: number}>} entrant indices
 */
async function playBracketMatch(a, b, { seed, arena, mode, roundsToWin, roundTime, stocks, maxTicks }) {
  const sim = new Sim({ seed, arena, mode, stocks, roundsToWin, roundTime, items: true });
  await sim.init();
  const entrants = [a, b];
  entrants.forEach((e, i) => sim.addSeat({
    slot: i, name: e.name, type: e.type, color: e.color ?? 0xffd23f, isBot: true,
    difficulty: e.difficulty ?? 'normal',
  }));
  sim.startMatch();
  let kos = 0;
  let t = 0;
  for (t = 1; t <= maxTicks; t++) {
    for (const e of sim.step()) if (e.type === 'ko') kos++;
    if (sim.match.phase === 'results') break;
  }
  const winnerSlot = sim.match.matchWinner >= 0 ? sim.match.matchWinner : 0;
  return { winner: winnerSlot === 0 ? 0 : 1, loser: winnerSlot === 0 ? 1 : 0, ticks: t, kos };
}

/**
 * Run a single-elimination tournament.
 *
 * @param {object} opts
 * @param {Array<{name?: string, type?: string, difficulty?: string, color?: number}>} opts.entrants
 * @param {number} [opts.seed] base seed; match i uses seed + i
 * @param {string} [opts.arena] arena id for every match
 * @param {string} [opts.mode] 'brawl' | 'hill' | 'teams' | 'sudden' (teams needs even brackets of 4+)
 * @param {number} [opts.roundsToWin] rounds to take a bracket match (default 1: single rounds)
 * @param {number} [opts.roundTime]
 * @param {number} [opts.stocks]
 * @param {number} [opts.maxTicks] give up on a match after this many ticks
 * @returns {Promise<{champion: object, rounds: Array<{matches: Array}>}>}
 */
export async function runTournament({
  entrants, seed = 1, arena = 'stadium', mode = 'brawl',
  roundsToWin = 1, roundTime = 60, stocks = 3, maxTicks = 30000,
} = {}) {
  if (!entrants || entrants.length < 2) throw new Error('runTournament needs at least 2 entrants');
  const full = entrants.map((e, i) => ({
    name: e.name ?? NAMES[i % NAMES.length],
    type: e.type ?? TYPES[i % TYPES.length],
    difficulty: e.difficulty ?? 'normal',
    color: e.color ?? 0xffd23f,
    seed: i,
  }));
  // Pad to a power of two with byes: the top seeds skip round one.
  const size = 1 << Math.ceil(Math.log2(full.length));
  let round = full.slice();
  while (round.length < size) round.push(null);
  const rounds = [];
  let matchIdx = 0;
  while (round.length > 1) {
    const next = [];
    const matches = [];
    for (let i = 0; i < round.length; i += 2) {
      const a = round[i], b = round[i + 1];
      if (!a) { next.push(b); continue; }
      if (!b) { next.push(a); matches.push({ a: a.name, b: null, winner: a.name, bye: true }); continue; }
      const res = await playBracketMatch(a, b, {
        seed: seed + matchIdx, arena, mode, roundsToWin, roundTime, stocks, maxTicks,
      });
      const winner = res.winner === 0 ? a : b;
      const loser = res.winner === 0 ? b : a;
      matches.push({ a: a.name, b: b.name, winner: winner.name, ticks: res.ticks, kos: res.kos });
      next.push(winner);
      matchIdx++;
    }
    rounds.push({ matches });
    round = next;
  }
  return { champion: round[0], rounds };
}
