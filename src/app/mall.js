// mall.js — the Dweeb Mall's data model: every card, sub-game and launch target.
//
// The mall used to be one long HTML string in screens.js plus a pile of
// hand-wired querySelector calls in boot.js. Two games (Escape, Mimic) were
// wired to buttons that did not exist in the DOM, so they were unreachable —
// this module is the single source of truth, and screens.js + boot.js both
// render/wire from it, so a launch target can never be dead again.
//
// difficulty: 1 = EASY, 2 = NORMAL, 3 = HARD. Both cards and sub-game buttons
// carry one, rendered as star pips.

/* Difficulty labels shared by the badge renderer and the tests. */
export const DIFFICULTY_LABELS = { 1: 'EASY', 2: 'NORMAL', 3: 'HARD' };

/** Star pips for a difficulty level, e.g. 2 → '★★☆'. */
export function difficultyStars(level) {
  const n = Math.max(1, Math.min(3, Number(level) || 1));
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/**
 * Every mall card. `launch` is { mode, arena, submode } for launchGameMode;
 * `iconAnim` names a CSS keyframe class defined in shell.css (anim-bounce …).
 * Button ids are kept stable — boot.js wires by id as before.
 */
export const MALL_MODES = [
  {
    id: 'arena',
    cardId: 'mall-card-1',
    badge: 'STADIUM BRAWLER',
    badgeClass: '',
    icon: '🥊',
    iconAnim: 'anim-bounce',
    title: 'Knockout Arena',
    desc: 'The original 4-player stadium brawler. Dumb ways to die, crazy physics weapons & sudden death.',
    difficulty: 2,
    btnClass: 'yellow',
    subgames: [
      { id: 'app-btn-derby', label: '☠️ Derby', title: 'Dumb Ways to Die', launch: { mode: 'derby', arena: 'stadium' }, difficulty: 2 },
      { id: 'app-btn-walldrop', label: '🧱 Wall Drop', title: 'Wall Drop PVP', launch: { mode: 'walldrop', arena: 'stadium' }, difficulty: 3 },
      { id: 'app-btn-brawl', label: '🥊 Brawl', title: 'Knockout Brawl', launch: { mode: 'brawl', arena: 'stadium' }, difficulty: 2 },
      { id: 'app-btn-training', label: '🧪 Training', title: 'Training Lab', launch: { mode: 'training', arena: 'stadium' }, difficulty: 1 },
    ],
    launch: { id: 'app-btn-classic', label: 'PLAY BRAWLER', difficulty: 2, launch: { mode: 'derby', arena: 'stadium' } },
  },
  {
    id: 'adventure',
    cardId: 'mall-card-2',
    badge: 'LIVING CIVILIZATION',
    badgeClass: 'badge-green',
    icon: '🌱',
    iconAnim: 'anim-grow',
    title: 'Expedition & Dynasty',
    desc: 'Open-world colony in The Meadowlands. Assign citizen roles, build toy contraptions, solve ruin vaults, and guide your dynasty.',
    difficulty: 1,
    btnClass: 'green',
    subgames: [],
    launch: { id: 'app-btn-dynasty', label: 'ENTER EXPEDITION', difficulty: 1, launch: { mode: 'adventure', arena: 'meadowlands' } },
  },
  {
    id: 'warfare',
    cardId: 'mall-card-5',
    badge: 'PHYSICS BATTLE SIM',
    badgeClass: 'badge-red',
    icon: '⚔️',
    iconAnim: 'anim-shake',
    title: 'Dweeb Warfare',
    desc: 'Massive army combat. Tactical commander abilities, artillery barrages, supply drops, unit counters, and 100v100 warfare.',
    difficulty: 3,
    btnClass: 'pink',
    subgames: [
      { id: 'app-btn-warfare-defense', label: '🛡️ Defend Fort', title: 'Defend Fort 20 Waves', launch: { mode: 'warfare', arena: 'stadium', submode: 'defense' }, difficulty: 2 },
      { id: 'app-btn-warfare-versus', label: '⚔️ Versus AI', title: '100v100 Duel vs AI', launch: { mode: 'warfare', arena: 'stadium', submode: 'versus' }, difficulty: 3 },
    ],
    launch: { id: 'app-btn-warfare', label: 'START WARFARE', difficulty: 2, launch: { mode: 'warfare', arena: 'stadium', submode: 'defense' } },
  },
  {
    id: 'builder',
    cardId: 'mall-card-builder',
    badge: 'CREATURE LAB & AI ARENA',
    badgeClass: 'badge-purple',
    icon: '🧬',
    iconAnim: 'anim-wobble',
    title: 'Build-A-Dweeb',
    desc: 'Sculpt a custom 3D creature with body shapes, eyes, appendages, colors, and AI combat DNA. Watch them clash in autonomous colosseum battles!',
    difficulty: 1,
    btnClass: 'purple',
    subgames: [],
    launch: { id: 'app-btn-builder', label: 'ENTER 3D LAB', difficulty: 1, launch: { mode: 'build', arena: 'stadium' } },
  },
  {
    id: 'escape',
    cardId: 'mall-card-escape',
    badge: 'CO-OP ESCAPE ROOM',
    badgeClass: 'badge-blue',
    icon: '🏝️',
    iconAnim: 'anim-dash',
    title: 'Dweebscape Island',
    desc: 'Combatless co-op escape! Parkour the island, haul heavy batteries, and power the portal before time runs out.',
    difficulty: 2,
    btnClass: 'blue',
    subgames: [],
    launch: { id: 'app-btn-escape', label: 'START ESCAPE', difficulty: 2, launch: { mode: 'escape', arena: 'stadium' } },
  },
  {
    id: 'mimic',
    cardId: 'mall-card-mimic',
    badge: 'FIRST-PERSON TOY LAB',
    badgeClass: '',
    icon: '🪞',
    iconAnim: 'anim-flip',
    title: 'Mimic Lab',
    desc: 'First-person toy lab! Perform physical antics and watch crowds of dweebs copy and mutate every move.',
    difficulty: 1,
    btnClass: 'yellow',
    subgames: [],
    launch: { id: 'app-btn-mimic', label: 'ENTER THE LAB', difficulty: 1, launch: { mode: 'mimic', arena: 'stadium' } },
  },
];

/** Flatten every launchable button (subgames + main buttons) for wiring/tests. */
export function mallLaunchButtons() {
  const out = [];
  for (const card of MALL_MODES) {
    for (const s of card.subgames) {
      out.push({ id: s.id, label: s.label, difficulty: s.difficulty, launch: s.launch, card: card.id, main: false });
    }
    const m = card.launch;
    out.push({ id: m.id, label: m.label, difficulty: m.difficulty, launch: m.launch, card: card.id, main: true });
  }
  return out;
}

/** Look a launch up by its button id (used by the generic boot wiring). */
export function launchByButtonId(id) {
  return mallLaunchButtons().find(b => b.id === id) || null;
}
