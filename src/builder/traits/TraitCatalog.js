// TraitCatalog.js — data-driven trait/toggle catalog for Build-A-Dweeb.
//
// Every trait is generated from a small authored table of FAMILIES (each with a
// real stat-delta vector, tags and an exclusivity group) crossed with TIERS and
// AFFIXES. Nothing here is prose spam: each entry's `fx` is the exact stat push
// it applies, and `ai` stats (aggression, caution, cunning…) feed the utility AI
// in TraitBrawl.js. See docs/TRAIT_BALANCE.md for how a pile of toggles becomes
// a legal, budget-capped build.

/** Core stat layer. All stats live in [0,1]; 0.5 is "average Dweeb". */
export const CORE_STATS = [
  // physical
  { id: 'speed', label: 'Speed', group: 'physical', w: 1.3 },
  { id: 'agility', label: 'Agility', group: 'physical', w: 1.1 },
  { id: 'stamina', label: 'Stamina', group: 'physical', w: 0.9 },
  { id: 'strength', label: 'Strength', group: 'physical', w: 1.2 },
  { id: 'weight', label: 'Weight', group: 'physical', w: 0.8 },
  { id: 'health', label: 'Health', group: 'physical', w: 1.3 },
  { id: 'armor', label: 'Armor', group: 'physical', w: 1.1 },
  { id: 'jump', label: 'Jump', group: 'physical', w: 0.8 },
  { id: 'grip', label: 'Grip', group: 'physical', w: 0.7 },
  { id: 'friction', label: 'Friction', group: 'physical', w: 0.5 },
  { id: 'bounce', label: 'Bounciness', group: 'physical', w: 0.6 },
  { id: 'size', label: 'Size', group: 'physical', w: 0.6 },
  // combat
  { id: 'reach', label: 'Reach', group: 'combat', w: 0.9 },
  { id: 'reaction', label: 'Reaction', group: 'combat', w: 1.0 },
  { id: 'accuracy', label: 'Accuracy', group: 'combat', w: 0.9 },
  { id: 'knockback', label: 'Knockback', group: 'combat', w: 0.9 },
  { id: 'regen', label: 'Regen', group: 'combat', w: 1.0 },
  { id: 'throwPower', label: 'Throw Power', group: 'combat', w: 0.7 },
  // AI personality (cheap: they shape decisions, not raw power)
  { id: 'aggression', label: 'Aggression', group: 'mind', w: 0.25 },
  { id: 'caution', label: 'Caution', group: 'mind', w: 0.25 },
  { id: 'cunning', label: 'Cunning', group: 'mind', w: 0.45 },
  { id: 'bravery', label: 'Bravery', group: 'mind', w: 0.3 },
  { id: 'focus', label: 'Focus', group: 'mind', w: 0.35 },
  { id: 'curiosity', label: 'Curiosity', group: 'mind', w: 0.2 },
  { id: 'loyalty', label: 'Loyalty', group: 'mind', w: 0.2 },
  { id: 'showoff', label: 'Showoff', group: 'mind', w: 0.15 },
];
export const STAT_IDS = CORE_STATS.map(s => s.id);
export const STAT_BY_ID = Object.fromEntries(CORE_STATS.map(s => [s.id, s]));

export const CATEGORIES = [
  { id: 'physical', label: 'Physical', icon: '💪' },
  { id: 'combat', label: 'Combat Style', icon: '🥊' },
  { id: 'mind', label: 'AI Personality', icon: '🧠' },
  { id: 'quirk', label: 'Quirks', icon: '🌀' },
  { id: 'style', label: 'Styles', icon: '🎨' },
];

// Family: [id, name, category, fx, tags, exclusivity group]
// fx are deltas at tier III (scale 1). Tags drive forbidden combos.
const F = (id, name, cat, fx, tags = [], excl = null) => ({ id, name, cat, fx, tags, excl });
const FAMILIES = [
  // ── physical ──
  F('heavy', 'Heavyset', 'physical', { weight: 0.22, health: 0.1, knockback: 0.08, speed: -0.12, jump: -0.1 }, ['heavy'], 'mass'),
  F('feather', 'Featherweight', 'physical', { weight: -0.22, speed: 0.1, jump: 0.12, health: -0.1 }, ['light'], 'mass'),
  F('sprinter', 'Sprinter', 'physical', { speed: 0.2, stamina: -0.08 }, ['fast']),
  F('marathon', 'Marathoner', 'physical', { stamina: 0.2, regen: 0.04, strength: -0.06 }),
  F('brute', 'Brute Muscle', 'physical', { strength: 0.2, weight: 0.06, agility: -0.08 }, ['strong']),
  F('nimble', 'Nimble Feet', 'physical', { agility: 0.2, reaction: 0.04, armor: -0.06 }, ['agile']),
  F('tank', 'Tank Shell', 'physical', { armor: 0.2, speed: -0.1, agility: -0.06 }, ['armored', 'heavy']),
  F('springs', 'Spring Legs', 'physical', { jump: 0.22, bounce: 0.08, grip: -0.06 }, ['jumpy']),
  F('sticky', 'Sticky Pads', 'physical', { grip: 0.22, friction: 0.12, speed: -0.04 }, ['sticky'], 'surface'),
  F('slick', 'Slick Skin', 'physical', { friction: -0.2, speed: 0.06, grip: -0.12 }, ['slippery'], 'surface'),
  F('rubber', 'Rubber Body', 'physical', { bounce: 0.22, armor: 0.04, accuracy: -0.05 }, ['bouncy']),
  F('giant', 'Big Boned', 'physical', { size: 0.22, health: 0.08, reach: 0.08, agility: -0.1 }, ['big'], 'size'),
  F('tiny', 'Pocket Sized', 'physical', { size: -0.22, agility: 0.1, health: -0.08, reach: -0.06 }, ['small'], 'size'),
  F('vital', 'Big Heart', 'physical', { health: 0.2, speed: -0.06 }, ['tough']),
  F('regen', 'Quick Healer', 'physical', { regen: 0.2, armor: -0.05 }),
  F('long', 'Long Limbs', 'physical', { reach: 0.2, agility: -0.05 }),
  // ── combat style ──
  F('boxer', 'Boxer', 'combat', { accuracy: 0.12, reaction: 0.1, aggression: 0.1 }, [], 'style'),
  F('wrestler', 'Wrestler', 'combat', { strength: 0.1, grip: 0.12, throwPower: 0.1 }, ['grabber'], 'style'),
  F('brawler', 'Bar Brawler', 'combat', { knockback: 0.14, aggression: 0.12, accuracy: -0.06 }, [], 'style'),
  F('fencer', 'Fencer', 'combat', { reach: 0.12, accuracy: 0.1, strength: -0.05 }, [], 'style'),
  F('sniper', 'Toy Sniper', 'combat', { throwPower: 0.16, accuracy: 0.12, caution: 0.08 }, ['ranged'], 'style'),
  F('counter', 'Counter Puncher', 'combat', { reaction: 0.16, caution: 0.08, aggression: -0.06 }, [], 'style'),
  F('juggler', 'Prop Juggler', 'combat', { throwPower: 0.12, grip: 0.08, curiosity: 0.1 }, ['grabber']),
  F('slammer', 'Body Slammer', 'combat', { knockback: 0.16, weight: 0.06, jump: 0.06 }),
  F('guard', 'Iron Guard', 'combat', { armor: 0.12, reaction: 0.06, speed: -0.06 }),
  F('dirty', 'Dirty Fighter', 'combat', { cunning: 0.16, accuracy: 0.04, loyalty: -0.08 }, ['sneaky']),
  F('pounce', 'Pouncer', 'combat', { jump: 0.1, aggression: 0.08, reaction: 0.06 }),
  F('rammer', 'Battering Ram', 'combat', { knockback: 0.12, speed: 0.06, armor: 0.04, accuracy: -0.08 }),
  // ── AI personality ──
  F('berserk', 'Berserker', 'mind', { aggression: 0.3, bravery: 0.2, caution: -0.25 }, ['berserk'], 'temper'),
  F('coward', 'Coward', 'mind', { caution: 0.3, bravery: -0.25, aggression: -0.15 }, ['coward'], 'temper'),
  F('stoic', 'Stoic', 'mind', { focus: 0.2, bravery: 0.1, showoff: -0.15 }, [], 'temper'),
  F('hothead', 'Hothead', 'mind', { aggression: 0.2, focus: -0.15 }, [], 'temper'),
  F('ambusher', 'Ambusher', 'mind', { cunning: 0.2, caution: 0.12, aggression: 0.06 }, ['sneaky'], 'tactic'),
  F('kiter', 'Kiter', 'mind', { caution: 0.15, cunning: 0.1, aggression: -0.05 }, ['ranged'], 'tactic'),
  F('flanker', 'Flanker', 'mind', { cunning: 0.15, curiosity: 0.08 }, [], 'tactic'),
  F('turtle', 'Turtler', 'mind', { caution: 0.2, focus: 0.1, aggression: -0.12 }, [], 'tactic'),
  F('hunter', 'Hunter', 'mind', { focus: 0.2, aggression: 0.1 }, [], 'tactic'),
  F('hider', 'Hide & Seeker', 'mind', { caution: 0.22, cunning: 0.12, bravery: -0.08 }, ['coward-ish'], 'tactic'),
  F('scavenger', 'Scavenger', 'mind', { curiosity: 0.25, cunning: 0.05 }),
  F('loyal', 'Pack Animal', 'mind', { loyalty: 0.25, bravery: 0.05 }, [], 'social'),
  F('lone', 'Lone Wolf', 'mind', { loyalty: -0.2, focus: 0.1, bravery: 0.06 }, [], 'social'),
  F('showboat', 'Showboat', 'mind', { showoff: 0.3, focus: -0.1 }),
  F('vengeful', 'Grudge Holder', 'mind', { focus: 0.15, aggression: 0.1, cunning: -0.05 }),
  F('opportunist', 'Opportunist', 'mind', { cunning: 0.18, focus: -0.05, aggression: 0.06 }),
  // ── quirks ──
  F('slideFan', 'Slide Addict', 'quirk', { curiosity: 0.12, speed: 0.04, friction: -0.05 }, ['slider']),
  F('railRider', 'Rail Grinder', 'quirk', { agility: 0.06, grip: 0.06, curiosity: 0.08 }, ['railer']),
  F('trampKid', 'Trampoline Kid', 'quirk', { bounce: 0.12, jump: 0.06, showoff: 0.06 }, ['tramper']),
  F('boardSmasher', 'Chalkboard Smasher', 'quirk', { strength: 0.06, knockback: 0.06, aggression: 0.06 }, ['smasher']),
  F('blockHoarder', 'Block Hoarder', 'quirk', { throwPower: 0.08, curiosity: 0.1, speed: -0.03 }, ['grabber']),
  F('fuzzFriend', 'Fuzzball Whisperer', 'quirk', { cunning: 0.08, loyalty: 0.06, armor: 0.03 }, ['fuzzfriend']),
  F('dizzy', 'Dizzy Spinner', 'quirk', { agility: 0.08, accuracy: -0.08, knockback: 0.05 }),
  F('snacker', 'Snack Break', 'quirk', { regen: 0.1, focus: -0.08 }),
  F('nervous', 'Jittery', 'quirk', { reaction: 0.1, focus: -0.06, caution: 0.06 }),
  F('sleepy', 'Sleepy Head', 'quirk', { stamina: 0.1, reaction: -0.08 }),
  F('glassJaw', 'Glass Jaw', 'quirk', { health: -0.12, speed: 0.06, agility: 0.06 }, ['fragile']),
  F('ironGut', 'Iron Gut', 'quirk', { health: 0.08, armor: 0.04, speed: -0.04 }),
  F('wobbly', 'Wobbly', 'quirk', { bounce: 0.06, grip: -0.08, agility: 0.04 }),
  F('scrappy', 'Scrappy', 'quirk', { bravery: 0.1, regen: 0.06, health: 0.04, caution: -0.05 }),
  F('stubborn', 'Stubborn', 'quirk', { grip: 0.08, bravery: 0.08, agility: -0.04 }),
  // ── styles (cosmetic, with small psychological effect on the AI) ──
  F('spiky', 'Spiky Hair', 'style', { showoff: 0.06, knockback: 0.02 }, [], 'hair'),
  F('mohawk', 'Mohawk', 'style', { aggression: 0.06, showoff: 0.04 }, [], 'hair'),
  F('bald', 'Shiny Dome', 'style', { focus: 0.05, friction: -0.02 }, [], 'hair'),
  F('stripes', 'Racing Stripes', 'style', { speed: 0.02, showoff: 0.05 }, [], 'pattern'),
  F('camo', 'Camo Paint', 'style', { cunning: 0.06, caution: 0.03 }, ['sneaky'], 'pattern'),
  F('polka', 'Polka Dots', 'style', { curiosity: 0.05, showoff: 0.03 }, [], 'pattern'),
  F('neon', 'Neon Glow', 'style', { showoff: 0.08, cunning: -0.03 }, [], 'pattern'),
  F('cape', 'Tiny Cape', 'style', { bravery: 0.06, showoff: 0.04 }, [], 'gear'),
  F('goggles', 'Goggles', 'style', { accuracy: 0.03, focus: 0.03 }, [], 'gear'),
  F('helmet', 'Bucket Helmet', 'style', { armor: 0.03, bravery: 0.03 }, [], 'gear'),
  F('bowtie', 'Bow Tie', 'style', { loyalty: 0.05, showoff: 0.03 }, [], 'gear'),
];

// Tiers I–V scale the family vector (convex costs make high tiers pricey).
const TIERS = [
  { n: 'I', s: 0.4 }, { n: 'II', s: 0.7 }, { n: 'III', s: 1.0 }, { n: 'IV', s: 1.35 }, { n: 'V', s: 1.75 },
];
const STYLE_TIERS = [{ n: 'Classic', s: 1 }, { n: 'Deluxe', s: 1.5 }];

// Affixes graft a secondary flavour onto a family at tier II strength, creating
// the long tail of combo traits ("Reckless Sprinter", "Sneaky Wrestler"…).
const AFFIXES = [
  { id: 'reckless', name: 'Reckless', fx: { aggression: 0.08, caution: -0.08, armor: -0.03 } },
  { id: 'careful', name: 'Careful', fx: { caution: 0.08, aggression: -0.05, focus: 0.03 } },
  { id: 'sneaky', name: 'Sneaky', fx: { cunning: 0.08, showoff: -0.05 }, tags: ['sneaky'] },
  { id: 'proud', name: 'Proud', fx: { showoff: 0.08, bravery: 0.04, cunning: -0.03 } },
  { id: 'wiry', name: 'Wiry', fx: { agility: 0.05, weight: -0.04 } },
  { id: 'chunky', name: 'Chunky', fx: { weight: 0.05, health: 0.03, speed: -0.04 } },
  { id: 'twitchy', name: 'Twitchy', fx: { reaction: 0.06, stamina: -0.03 } },
  { id: 'gritty', name: 'Gritty', fx: { stamina: 0.05, bravery: 0.04, speed: -0.02 } },
  { id: 'bouncy', name: 'Bouncy', fx: { bounce: 0.07, grip: -0.03 } },
  { id: 'grabby', name: 'Grabby', fx: { grip: 0.05, throwPower: 0.04 } },
  { id: 'curious', name: 'Curious', fx: { curiosity: 0.08, focus: -0.03 } },
  { id: 'loyal', name: 'Faithful', fx: { loyalty: 0.08 } },
  { id: 'slippery', name: 'Slippery', fx: { friction: -0.06, agility: 0.03, grip: -0.03 } },
  { id: 'stout', name: 'Stout', fx: { armor: 0.04, size: 0.03, agility: -0.03 } },
];

// Forbidden tag pairs (can't both be present in one build).
export const FORBIDDEN_TAGS = [
  ['heavy', 'light'], ['berserk', 'coward'], ['big', 'small'], ['sticky', 'slippery'],
  ['fragile', 'armored'], ['berserk', 'coward-ish'], ['heavy', 'fast'],
];

const round3 = v => Math.round(v * 1000) / 1000;
const scale = (fx, s) => Object.fromEntries(Object.entries(fx).map(([k, v]) => [k, round3(v * s)]));
const addFx = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = round3((out[k] || 0) + v);
  return out;
};

/** Point cost of a trait: convex in its total magnitude (weighted by stat price). */
export function traitPointCost(fx) {
  let pos = 0, neg = 0;
  for (const [k, v] of Object.entries(fx)) {
    const w = STAT_BY_ID[k]?.w ?? 0.5;
    if (v > 0) pos += w * v; else neg += w * -v;
  }
  // 100 pts * (positive^1.35) minus a refund for drawbacks that never exceeds 60% of the upside.
  const raw = 100 * Math.pow(pos, 1.35) - 0.6 * Math.min(100 * Math.pow(pos, 1.35), 60 * neg);
  return Math.max(1, Math.round(raw));
}

export const RARITIES = [
  { id: 'common', label: 'Common', color: '#9aa3b0' },
  { id: 'uncommon', label: 'Uncommon', color: '#5ee06a' },
  { id: 'rare', label: 'Rare', color: '#2f9bff' },
  { id: 'epic', label: 'Epic', color: '#b25ee0' },
  { id: 'legendary', label: 'Legendary', color: '#f2a93b' },
];
function rarityOf(tier) {
  return { I: 'common', Classic: 'common', II: 'uncommon', III: 'rare', combo: 'rare', IV: 'epic', Deluxe: 'epic', V: 'legendary' }[tier] || 'common';
}

function buildCatalog() {
  const out = [];
  for (const fam of FAMILIES) {
    const tiers = fam.cat === 'style' ? STYLE_TIERS : TIERS;
    for (const t of tiers) {
      const fx = scale(fam.fx, t.s);
      out.push({
        id: `${fam.id}.${t.n}`, family: fam.id, name: `${fam.name} ${t.n}`, cat: fam.cat,
        tier: t.n, fx, tags: [...fam.tags], excl: fam.excl ? fam.excl : `fam:${fam.id}`,
      });
    }
  }
  // Combo traits: every affix × every non-style family (one per family/affix pair).
  for (const fam of FAMILIES) {
    if (fam.cat === 'style') continue;
    for (const a of AFFIXES) {
      const fx = addFx(scale(fam.fx, 0.7), a.fx);
      out.push({
        id: `${fam.id}+${a.id}`, family: fam.id, name: `${a.name} ${fam.name}`, cat: fam.cat,
        tier: 'combo', fx, tags: [...new Set([...fam.tags, ...(a.tags || [])])],
        excl: fam.excl ? fam.excl : `fam:${fam.id}`,
      });
    }
  }
  for (const t of out) { t.cost = traitPointCost(t.fx); t.rarity = rarityOf(t.tier); }
  return out;
}

export const TRAITS = buildCatalog();
export const TRAIT_BY_ID = new Map(TRAITS.map(t => [t.id, t]));
export const TRAIT_COUNT = TRAITS.length;
