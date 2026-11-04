// src/game/Darwin.js — the scoring engine behind Dumb Ways to Die.
//
// The mode's promise is "die in the most ridiculous way possible", but the score used to be
// assembled inline in main.js from four facts the KO handler happened to have on hand
// (kind, height, credited, fall speed). That was enough to rank deaths, not enough to
// describe them, and none of it could be tested without a live match.
//
// So the scoring lives here now: a set of independent *beats*, each with a label and a value,
// scored from a plain facts object. Every beat is something the game already knows when a
// Dweeb leaves the stage — what got them, how long they were airborne, what was in their
// hands, who had been hitting them — and the sum is the Darwin award.
//
// The result is shaped for the HUD: `beats` is sorted biggest-first so the receipt can be
// read top-down, and `label` is the headline ("METEOR", "FLAMING BOLT", …). Pure: no imports,
// no DOM, no game objects. See src/main.js onKO for the facts and the callout.

/** Bonus values. Tuned against the old inline numbers so existing scores stay in range. */
export const DARWIN_POINTS = {
  base: 100,          // you died; that's the entry fee
  splash: 75,         // bell flop: surface KO
  sky: 100,           // died above this height
  skyY: 6,
  self: 80,           // nobody touched you: pure self-own
  meteorPerSpeed: 4,  // points per unit of downward speed at the KO …
  meteorCap: 150,     // … capped
  sudden: 100,        // died during the closing ring
  airPerSecond: 25,   // time spent airborne before the KO …
  airCap: 125,        // … capped
  held: 60,           // died still holding something
  comboPerHit: 30,    // each hit in the chain that finished you …
  comboLateHalf: 15,  // … worth half price deeper than three
  comboCap: 150,
  rebound: 45,        // you had already been KO'd once this round and came back
  reboundCap: 90,
  revenge: 40,        // the Dweeb who ended you is the one you last ended
};

const BEAT_ORDER = ['splash', 'sky', 'self', 'meteor', 'sudden', 'air', 'held', 'combo', 'rebound', 'revenge'];

/**
 * Score one death.
 *
 * @param {object} f facts about the KO
 * @param {string} f.kind        'splash' | 'side' | 'star'
 * @param {boolean} f.sudden     died during sudden death / the closing ring
 * @param {boolean} f.credited   somebody got credit (false = self-destruct)
 * @param {number}  f.height     world Y at the KO
 * @param {number}  f.fallSpeed  |vertical speed| at the KO
 * @param {number} [f.airTime]   seconds airborne on this life
 * @param {string} [f.held]      'object' | 'dweeb' | null — what they were carrying
 * @param {number} [f.chainHits] hits taken in the chain that finished them
 * @param {number} [f.rebounds]  previous KOs survived this round
 * @param {boolean}[f.revenge]   the creditor was the victim's own last victim
 * @returns {{ total: number, label: string, beats: Array<{id: string, label: string, value: number}> }}
 */
export function scoreDeath(f = {}) {
  const P = DARWIN_POINTS;
  const beats = [];
  const add = (id, label, value) => {
    if (value > 0) beats.push({ id, label, value: Math.round(value) });
  };

  if (f.kind === 'splash') add('splash', 'BELLY FLOP', P.splash);
  if ((f.height ?? 0) > P.skyY) add('sky', 'SKY DIVE', P.sky);
  if (!f.credited) add('self', 'SELF-OWN', P.self);
  add('meteor', 'METEOR', Math.min(P.meteorCap, Math.abs(f.fallSpeed ?? 0) * P.meteorPerSpeed));
  if (f.sudden) add('sudden', 'SUDDEN DEATH', P.sudden);
  add('air', 'HANG TIME', Math.min(P.airCap, (f.airTime ?? 0) * P.airPerSecond));
  if (f.held) {
    add('held', f.held === 'dweeb' ? 'STILL HOLDING A PUPIL' : 'STILL HOLDING A TOY', P.held);
  }
  const hits = Math.max(0, Math.floor(f.chainHits ?? 0));
  if (hits >= 2) {
    const value = Math.min(
      P.comboCap,
      P.comboPerHit * Math.min(hits, 3) + P.comboLateHalf * Math.max(0, hits - 3),
    );
    add('combo', `${hits}-HIT SEND-OFF`, value);
  }
  add('rebound', 'CAME BACK FOR MORE', Math.min(P.reboundCap, (f.rebounds ?? 0) * P.rebound));
  if (f.revenge) add('revenge', 'SWEET REVENGE', P.revenge);

  beats.sort((a, b) => (b.value - a.value) || (BEAT_ORDER.indexOf(a.id) - BEAT_ORDER.indexOf(b.id)));
  const total = P.base + beats.reduce((sum, b) => sum + b.value, 0);

  // Headline: biggest bonus, but a handful of beats are funnier than they are valuable and
  // should win the title anyway (dying with a pupil in your hands beats a slightly faster fall).
  const label = pickLabel(beats, f);
  return { total, label, beats };
}

/** The word that goes on the big yellow popup. */
function pickLabel(beats, f) {
  const has = id => beats.some(b => b.id === id);
  if (f.held === 'dweeb') return 'STILL HOLDING A PUPIL';
  if (has('self') && (has('held') || has('combo'))) return 'SELF-OWN';
  if (has('sudden') && has('combo')) return 'SUDDEN DEATH';
  return beats[0]?.label ?? 'DARWIN';
}

/** One-line receipt for the HUD feed: "DARWIN +430 · HANG TIME 125 · 5-HIT SEND-OFF 90". */
export function receiptLine(scored, maxBeats = 3) {
  const shown = (scored?.beats ?? []).slice(0, maxBeats)
    .map(b => `${b.label} <b>${b.value}</b>`);
  return shown.join(' · ');
}

/**
 * Was this death worth the crowd reacting to? 0..1, for scaling the confetti/cheer.
 * A plain walk-off-the-edge is 0; a flaming meteoric pupil-in-hand spectacle is 1.
 */
export function spectacle(scored) {
  const bonuses = (scored?.total ?? 0) - DARWIN_POINTS.base;
  return Math.max(0, Math.min(1, bonuses / 600));
}
