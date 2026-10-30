// Announcer.js — the party-host voice: KO punchlines by context, round/match win banners.
// Wet (water dunk) and dry (side / top blast) KOs draw from separate pools, so a dunk and a
// side blast can never share a line. {a} = attacker, {v} = victim (HTML name tags).

const KO_LINES = {
  // Plain KOs, by how they left
  splash: [
    '{a} baptised {v}', '{v} went for a swim, courtesy of {a}', '{a} dunked {v} · splish splash',
    '{v} is sleeping with the rubber ducks', '{a} made {v} a lagoon souvenir', 'Cannonball! {a} → {v}',
  ],
  side: [
    '{a} yeeted {v} into next week', '{v} left the building (sideways) · thanks {a}', '{a} bowled {v} off the map',
    '{v} saw the horizon up close · {a}', 'Home run! {a} sent {v} packing', '{a} deleted {v} from the arena',
  ],
  star: [
    '{a} launched {v} into orbit', '{v} is a star now · {a} made it happen', '{a} sent {v} to the moon · ding!',
    '{v} achieved liftoff · pilot: {a}', 'Houston, {a} has a {v} problem',
  ],
  // Nobody to blame
  self: {
    wet: ['{v} tried to walk on water', '{v} forgot how floors work (splash)', '{v} took the scenic route · into the lagoon'],
    dry: ['{v} self-destructed', '{v} flew off with nobody touching them', '{v} ran out of arena'],
  },
  // Contexts that outrank the plain line
  revenge: {
    wet: ['REVENGE! {a} dunks {v} right back', 'Payback tastes like pool water · {a} → {v}'],
    dry: ['REVENGE! {a} returns {v} to sender', 'Payback! {a} yeets {v} straight back', 'Grudge settled: {a} > {v}'],
  },
  trick: {
    wet: ['Trickshot dunk! {a} sank {v} from downtown', '{a} bank-shot {v} into the drink'],
    dry: ['TRICKSHOT KO! {a} sniped {v}', '{a} called the pocket · {v} off the side', 'No-look yeet! {a} → {v}'],
  },
  sd: {
    wet: ['Sudden death dunk! {a} sinks {v}', 'The lagoon claims {v} · thanks {a}'],
    dry: ['Sudden death! {a} blasts {v} out', '{a} wins the crumble lottery vs {v}'],
  },
  style: {
    wet: ['DWEEB GOD {a} drowns {v} in style', 'Pure chaos: {a} dunks {v}'],
    dry: ['CHAOTIC! {a} stylishly yeets {v}', 'Style points! {a} sends {v} flying'],
  },
};

// Big announcer text for the local player
const PLAYER_KO = {
  splash: ['DUNKED!', 'SPLOOSH!', 'SOGGY!'],
  side: ['YEETED!', 'OOF!', 'BYE-BYE!'],
  star: ['STAR KO!', 'TO THE MOON!', 'TWINKLE!'],
};
const PLAYER_GOT = {
  splash: ['DUNK!', 'SPLASHDOWN!'],
  side: ['YEET!', 'HOME RUN!', 'NICE!'],
  star: ['STAR KO!', 'ORBITAL!'],
};

const last = new Map();
function pick(list, key) {
  if (list.length === 1) return list[0];
  let i;
  do i = Math.floor(Math.random() * list.length); while (list[i] === last.get(key));
  last.set(key, list[i]);
  return list[i];
}

/**
 * @param ctx { kind: 'splash'|'side'|'star', self, revenge, trick, sd, styleTier }
 * @returns { line (feed html, names filled), context }
 */
export function koLine(ctx, aTag, vTag) {
  const wet = ctx.kind === 'splash' ? 'wet' : 'dry';
  let context = ctx.kind, list;
  if (ctx.self) { context = 'self'; list = KO_LINES.self[wet]; }
  else if (ctx.revenge) { context = 'revenge'; list = KO_LINES.revenge[wet]; }
  else if (ctx.trick) { context = 'trick'; list = KO_LINES.trick[wet]; }
  else if (ctx.sd) { context = 'sd'; list = KO_LINES.sd[wet]; }
  else if (ctx.styleTier >= 2) { context = 'style'; list = KO_LINES.style[wet]; }
  else list = KO_LINES[ctx.kind];
  const line = pick(list, context + wet).replaceAll('{a}', aTag).replaceAll('{v}', vTag);
  return { line, context };
}

export function playerKOWord(kind, gotIt) {
  const pool = (gotIt ? PLAYER_GOT : PLAYER_KO)[kind] ?? PLAYER_KO.side;
  return pick(pool, (gotIt ? 'got' : 'ko') + kind);
}

/** Win banners, loudest first. Returns an array of { title, sub } (possibly empty). */
export function winBanners({ winner, match, isMatch }) {
  const out = [];
  if (winner.eliminated) return out; // a "winner" who's already out has nothing to brag about
  const full = match.settings.stocks;
  const stocks = winner.stocks;
  if (isMatch && match.roundWins.get(winner) > 0) {
    const others = [...match.roundWins].filter(([d]) => d !== winner).every(([, w]) => w === 0);
    if (others) out.push({ title: `CLEAN SWEEP ${match.roundWins.get(winner)}–0`, sub: 'not a single round dropped' });
  }
  if (stocks >= full && full > 1) out.push({ title: 'STOCK SWEPT', sub: 'never lost a life' });
  else if (stocks === 1 && full > 1) out.push({ title: 'CLUTCH 1-STOCK', sub: 'hanging on by a googly eye' });
  if (match.suddenDeath) out.push({ title: 'SUDDEN DEATH HERO', sub: 'last dweeb standing on the rubble' });
  return out;
}

/** Every string, for WHY.md / tuning. */
export const ALL_LINES = { KO_LINES, PLAYER_KO, PLAYER_GOT };

/**
 * AnnounceQueue — the fix for overlapping KO announcements.
 *
 * The bug: `hud.announce()` stomps the current banner on every call. When two KOs land in
 * quick succession the second call wipes the first mid-display, so the earlier KO's punchline
 * is cut off (or the two banners visibly fight over the element). There is no voice synth in
 * the game — the "announcer voice" IS these banners plus the feed lines — so the overlap is
 * this stomping.
 *
 * The queue serializes announcements: each one gets its full duration on screen, extras wait
 * their turn (deduped, capped). Wiring: construct once per match, call `announce(hud, ...)`
 * instead of `hud.announce(...)`, and call `update(hud, dt)` every frame. It works headless
 * against any `{ announce(), announceTimer }`-shaped object, which is what the test uses.
 */
export class AnnounceQueue {
  /**
   * @param {object} [opts]
   * @param {number} [opts.minGap] Minimum seconds a banner owns the screen, even a short one.
   * @param {number} [opts.maxQueue] Longest the waiting line may grow; oldest waiters drop.
   */
  constructor({ minGap = 0.45, maxQueue = 3 } = {}) {
    this.minGap = minGap;
    this.maxQueue = maxQueue;
    this.queue = [];
    this.now = 0;
    this.activeUntil = -Infinity;
  }

  get pending() { return this.queue.length; }

  /**
   * @returns {boolean} true when the banner showed immediately, false when it was queued
   *   (or deduped).
   */
  announce(hud, text, style = '', duration = 1.2) {
    const item = { text, style, duration };
    const hudIdle = (hud.announceTimer ?? 0) <= 0;
    if (hudIdle && this.queue.length === 0 && this.now >= this.activeUntil) {
      this._show(hud, item);
      return true;
    }
    // Debounce: an identical banner already showing or queued adds nothing.
    if (this.queue.some(q => q.text === item.text)) return false;
    if (this.queue.length >= this.maxQueue) this.queue.shift(); // shed the oldest waiter
    this.queue.push(item);
    return false;
  }

  /** Advance the clock and show whatever is due. Call every frame with the HUD. */
  update(hud, dt) {
    this.now += dt;
    if (this.queue.length > 0 && this.now >= this.activeUntil) {
      this._show(hud, this.queue.shift());
    }
  }

  /** Drop the line and reset the clock (round transitions). */
  reset() {
    this.queue.length = 0;
    this.now = 0;
    this.activeUntil = -Infinity;
  }

  _show(hud, item) {
    hud.announce(item.text, item.style, item.duration);
    this.activeUntil = this.now + Math.max(item.duration, this.minGap);
  }
}
