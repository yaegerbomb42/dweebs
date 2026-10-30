// TraitCollection.js — which traits you own. Most of the catalog is DISCOVERED in
// Brawl Sim fights: drops are tied to what your Dweeb actually did (threw a lot →
// grip/grab traits, won by hiding → Ambusher, survived on a sliver of HP → Scrappy…).
// Persisted in localStorage next to the other Build-A-Dweeb saves.

import { TRAITS, TRAIT_BY_ID, RARITIES } from './TraitCatalog.js';
import { rng32 } from './TraitBrawl.js';

export const COLLECTION_KEY = 'dweebs-trait-collection-v1';
const RANK = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));

/** Starter kit: every family's tier I + Classic styles (~70 traits); the other ~1000 drop. */
export const STARTER_TRAITS = TRAITS.filter(t => t.tier === 'I' || t.tier === 'Classic').map(t => t.id);

export function loadCollection() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(COLLECTION_KEY) || 'null'); } catch { /* ignore */ }
  if (!c || typeof c !== 'object') c = { owned: {}, sandbox: false, battles: 0 };
  c.owned = c.owned || {};
  for (const id of STARTER_TRAITS) if (!c.owned[id]) c.owned[id] = 1;
  return c;
}
export function saveCollection(c) { try { localStorage.setItem(COLLECTION_KEY, JSON.stringify(c)); } catch { /* private mode */ } }
export const isOwned = (c, id) => !!(c.sandbox || c.owned[id]);
export const ownedTraits = c => (c.sandbox ? TRAITS : TRAITS.filter(t => c.owned[t.id]));

// What earns which families (shown as unlock hints in the picker too).
export const DROP_RULES = [
  { key: 'throws', label: 'throw 3+ toy blocks in a fight', min: 3, fams: ['sticky', 'wrestler', 'juggler', 'blockHoarder', 'sniper'] },
  { key: 'hideWin', label: 'win after hiding behind chalkboards', min: 1, fams: ['ambusher', 'hider', 'camo', 'counter', 'kiter'] },
  { key: 'scrappy', label: 'survive a win below 20% HP', min: 1, fams: ['scrappy', 'stubborn', 'vital', 'regen', 'ironGut'] },
  { key: 'rides', label: 'ride slides or rails 2+ times', min: 2, fams: ['slideFan', 'railRider', 'sprinter', 'nimble', 'slick'] },
  { key: 'stomps', label: 'land trampoline stomps', min: 1, fams: ['trampKid', 'springs', 'rubber', 'pounce', 'slammer'] },
  { key: 'smashes', label: 'smash chalkboards', min: 2, fams: ['boardSmasher', 'brute', 'rammer', 'heavy', 'tank'] },
  { key: 'kos', label: 'score KOs', min: 1, fams: ['berserk', 'hunter', 'brawler', 'boxer', 'hothead', 'vengeful'] },
  { key: 'flees', label: 'escape by fleeing and live', min: 1, fams: ['coward', 'feather', 'tiny', 'nervous', 'kiter'] },
  { key: 'guards', label: 'guard a lot', min: 6, fams: ['guard', 'turtle', 'stoic', 'helmet', 'giant'] },
  { key: 'dmg', label: 'deal 120+ damage', min: 120, fams: ['long', 'fencer', 'dirty', 'opportunist', 'showboat', 'marathon'] },
  { key: 'team', label: 'win as a squad', min: 1, fams: ['loyal', 'flanker', 'bowtie', 'cape', 'lone', 'scavenger'] },
];
export function unlockHint(t) {
  const r = DROP_RULES.find(d => d.fams.includes(t.family));
  return r ? `Drops when your Dweeb ${r.label}` : 'Random drop from any fight';
}

/** Summarise a finished fighter for the drop table. */
export function fightFacts(f, won) {
  return {
    throws: f.throws, hideWin: won && f.hideT > 3 ? 1 : 0, scrappy: won && f.alive && f.minHpR < 0.2 ? 1 : 0,
    rides: f.rides, stomps: f.stomps, smashes: f.smashes, kos: f.kos,
    flees: f.alive && (f.decisions.flee || 0) > 3 ? 1 : 0, guards: f.decisions.defend || 0, dmg: f.dmgDealt, team: won ? 1 : 0,
  };
}

/**
 * Deterministic drops (same facts + seed => same loot). 1 drop, +1 for a win, +1 for KOs.
 * Rarity roll leans up with wins and how far past the rule threshold you went.
 */
export function rollDrops(facts, seed, collection) {
  const rnd = rng32(seed);
  const earned = DROP_RULES.filter(r => (facts[r.key] || 0) >= r.min).map(r => ({ r, over: (facts[r.key] || 0) / r.min }));
  const n = 1 + (facts.team ? 1 : 0) + (facts.kos >= 2 ? 1 : 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const roll = rnd() + (facts.team ? 0.1 : 0) + Math.min(0.15, earned.length * 0.03);
    const rarity = roll > 1.02 ? 'legendary' : roll > 0.9 ? 'epic' : roll > 0.65 ? 'rare' : roll > 0.35 ? 'uncommon' : 'common';
    const fams = earned.length ? earned[Math.floor(rnd() * earned.length)].r.fams : null;
    let pool = TRAITS.filter(t => (!fams || fams.includes(t.family)) && RANK[t.rarity] <= RANK[rarity] && !out.includes(t.id));
    const fresh = pool.filter(t => !collection?.owned?.[t.id]);
    if (fresh.length) pool = fresh;
    // prefer the highest rarity reached
    const top = Math.max(...pool.map(t => RANK[t.rarity]));
    pool = pool.filter(t => RANK[t.rarity] === top);
    if (pool.length) out.push(pool[Math.floor(rnd() * pool.length)].id);
  }
  return out;
}

export function grantTraits(c, ids) {
  const fresh = [];
  for (const id of ids) { if (!TRAIT_BY_ID.has(id)) continue; if (!c.owned[id]) fresh.push(id); c.owned[id] = (c.owned[id] || 0) + 1; }
  saveCollection(c);
  return fresh;
}
