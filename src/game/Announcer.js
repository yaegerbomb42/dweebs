// Announcer.js — the party-host voice: KO punchlines by context, round/match win banners.
// Wet (water dunk) and dry (side / top blast) KOs draw from separate pools, so a dunk and a
// side blast can never share a line. {a} = attacker, {v} = victim (HTML name tags).

const KO_LINES = {
  // Plain KOs, by how they left
  splash: [
    '{a} baptised {v}', '{v} went for a swim, courtesy of {a}', '{a} dunked {v} · splish splash',
    '{v} is sleeping with the rubber ducks', '{a} made {v} a lagoon souvenir', 'Cannonball! {a} → {v}',
    '{a} taught {v} the backstroke · the hard way', '{v} is now a lagoon statistic · {a}',
    'Pool\'s closed! {a} threw {v} out · into the pool',
  ],
  side: [
    '{a} yeeted {v} into next week', '{v} left the building (sideways) · thanks {a}', '{a} bowled {v} off the map',
    '{v} saw the horizon up close · {a}', 'Home run! {a} sent {v} packing', '{a} deleted {v} from the arena',
    '{a} filed {v} under "gone"', '{v} has left the chat · {a} showed them the door',
    'Outta here! {a} ejects {v} from the premises',
  ],
  star: [
    '{a} launched {v} into orbit', '{v} is a star now · {a} made it happen', '{a} sent {v} to the moon · ding!',
    '{v} achieved liftoff · pilot: {a}', 'Houston, {a} has a {v} problem',
    '{a} booked {v} a one-way ticket to the stratosphere', '{v} is stargazing permanently · {a}',
  ],
  // Nobody to blame
  self: {
    wet: ['{v} tried to walk on water', '{v} forgot how floors work (splash)', '{v} took the scenic route · into the lagoon',
      '{v} tested the lagoon depth · it\'s wet', '{v} mistook the lagoon for a shortcut'],
    dry: ['{v} self-destructed', '{v} flew off with nobody touching them', '{v} ran out of arena',
      '{v} yeeted themselves · no assist needed', '{v} found the edge · the hard way'],
  },
  // Contexts that outrank the plain line
  revenge: {
    wet: ['REVENGE! {a} dunks {v} right back', 'Payback tastes like pool water · {a} → {v}',
      'REVENGE! {a} returns the splash with interest'],
    dry: ['REVENGE! {a} returns {v} to sender', 'Payback! {a} yeets {v} straight back', 'Grudge settled: {a} > {v}',
      'REVENGE! {a} sends {v} right back where they came from'],
  },
  trick: {
    wet: ['Trickshot dunk! {a} sank {v} from downtown', '{a} bank-shot {v} into the drink',
      'Off the bumper and IN! {a} trickshots {v} into the lagoon'],
    dry: ['TRICKSHOT KO! {a} sniped {v}', '{a} called the pocket · {v} off the side', 'No-look yeet! {a} → {v}',
      'Trickshot! {a} threads {v} through the chaos'],
  },
  sd: {
    wet: ['Sudden death dunk! {a} sinks {v}', 'The lagoon claims {v} · thanks {a}',
      'Sudden death splash! {a} ends {v}\'s run'],
    dry: ['Sudden death! {a} blasts {v} out', '{a} wins the crumble lottery vs {v}',
      'Sudden death strike! {a} finishes {v}'],
  },
  style: {
    wet: ['DWEEB GOD {a} drowns {v} in style', 'Pure chaos: {a} dunks {v}',
      'Maximum style! {a} waterboards {v} beautifully'],
    dry: ['CHAOTIC! {a} stylishly yeets {v}', 'Style points! {a} sends {v} flying',
      'DWEEB GOD {a} styles all over {v}'],
  },
};

// Big announcer text for the local player
const PLAYER_KO = {
  splash: ['DUNKED!', 'SPLOOSH!', 'SOGGY!', 'WET WIPE!'],
  side: ['YEETED!', 'OOF!', 'BYE-BYE!', 'EJECTED!'],
  star: ['STAR KO!', 'TO THE MOON!', 'TWINKLE!', 'LIFTOFF!'],
};
const PLAYER_GOT = {
  splash: ['DUNK!', 'SPLASHDOWN!', 'POOL PARTY!'],
  side: ['YEET!', 'HOME RUN!', 'NICE!', 'SENT!'],
  star: ['STAR KO!', 'ORBITAL!', 'MOONSHOT!'],
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
