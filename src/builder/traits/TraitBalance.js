// TraitBalance.js — turns any pile of trait toggles into a legal, capped build.
// Pure + deterministic (no RNG, no globals) so it's unit-testable.
// Math overview lives in docs/TRAIT_BALANCE.md.

import { CORE_STATS, STAT_IDS, STAT_BY_ID, TRAIT_BY_ID, FORBIDDEN_TAGS } from './TraitCatalog.js';

export const TRAIT_BUDGET = 100;      // trait points per Dweeb
export const MAX_TRAITS = 8;          // equip slots per Dweeb
export const POWER_CAP = 0.6;         // max power score after normalisation
export const BASE = 0.5;

// Coupled trade-offs: raising the source stat above average drains the targets.
// (Heavy and tanky bodies are slower; strong bodies tire faster; big bodies jump worse.)
export const COUPLINGS = [
  { from: 'weight', to: { speed: -0.45, agility: -0.35, jump: -0.4, stamina: -0.15 } },
  { from: 'health', to: { speed: -0.25, agility: -0.15 } },
  { from: 'armor', to: { speed: -0.25, jump: -0.2, agility: -0.15 } },
  { from: 'size', to: { agility: -0.3, cunning: -0.1 } },
  { from: 'strength', to: { stamina: -0.2 } },
  { from: 'bounce', to: { accuracy: -0.2, grip: -0.15 } },
];

// Hard product caps (feasible region). Each pair is normalised to [0,1] above BASE:
// x = max(0, s-BASE)/BASE. Constraint: xa * xb <= cap.
export const PRODUCT_CAPS = [
  { a: 'weight', b: 'speed', cap: 0.12, label: 'mass × speed (momentum)' },
  { a: 'health', b: 'speed', cap: 0.15, label: 'health × speed' },
  { a: 'armor', b: 'agility', cap: 0.15, label: 'armor × agility' },
  { a: 'strength', b: 'speed', cap: 0.2, label: 'strength × speed' },
  { a: 'health', b: 'regen', cap: 0.15, label: 'health × regen' },
];

const clamp01 = v => Math.max(0, Math.min(1, v));
const sortedIds = ids => [...new Set(ids)].filter(id => TRAIT_BY_ID.has(id));

/**
 * Resolve exclusivity + forbidden combos. Earlier ids in the list win (UI puts
 * the newest toggle first, so it replaces whatever it collides with).
 * Returns { kept, dropped: [{id, reason}] }.
 */
export function resolveTraitConflicts(ids) {
  const kept = [];
  const dropped = [];
  const groups = new Map();
  const tags = new Set();
  for (const id of sortedIds(ids)) {
    const t = TRAIT_BY_ID.get(id);
    if (kept.length >= MAX_TRAITS) { dropped.push({ id, reason: `max ${MAX_TRAITS} traits` }); continue; }
    if (groups.has(t.excl)) { dropped.push({ id, reason: `same slot as ${groups.get(t.excl)}` }); continue; }
    const bad = FORBIDDEN_TAGS.find(([a, b]) => (t.tags.includes(a) && tags.has(b)) || (t.tags.includes(b) && tags.has(a)));
    if (bad) { dropped.push({ id, reason: `${bad[0]} + ${bad[1]} can't mix` }); continue; }
    kept.push(id);
    groups.set(t.excl, t.name);
    for (const g of t.tags) tags.add(g);
  }
  return { kept, dropped };
}

/** Which kept traits would `id` conflict with? (for UI hints) */
export function conflictsFor(id, currentIds) {
  const t = TRAIT_BY_ID.get(id);
  if (!t) return [];
  const out = [];
  for (const cid of currentIds) {
    if (cid === id) continue;
    const c = TRAIT_BY_ID.get(cid);
    if (!c) continue;
    if (c.excl === t.excl) out.push(cid);
    else if (FORBIDDEN_TAGS.some(([a, b]) => (t.tags.includes(a) && c.tags.includes(b)) || (t.tags.includes(b) && c.tags.includes(a)))) out.push(cid);
  }
  return out;
}

// Hand-picked core stat points: each step moves a stat by CORE_STEP; steps in
// [CORE_MIN, CORE_MAX]. Raising costs w·8·n^1.5 (convex); lowering refunds w·3 per step.
export const CORE_STEP = 0.06, CORE_MIN = -3, CORE_MAX = 5;
export function corePoints(core = {}) {
  let p = 0;
  for (const [k, n0] of Object.entries(core)) {
    const n = Math.max(CORE_MIN, Math.min(CORE_MAX, Math.round(n0 || 0))), w = STAT_BY_ID[k]?.w ?? 0;
    p += n > 0 ? w * 8 * Math.pow(n, 1.5) : w * 3 * n;
  }
  return Math.round(p);
}

export function rawStats(ids, core = {}) {
  const s = Object.fromEntries(STAT_IDS.map(k => [k, BASE]));
  for (const [k, n] of Object.entries(core)) if (k in s) s[k] += CORE_STEP * Math.max(CORE_MIN, Math.min(CORE_MAX, Math.round(n || 0)));
  for (const id of ids) {
    const t = TRAIT_BY_ID.get(id);
    if (!t) continue;
    for (const [k, v] of Object.entries(t.fx)) if (k in s) s[k] += v;
  }
  return s;
}

/** Apply coupled trade-offs once (no feedback loops => deterministic & stable). */
export function applyCouplings(s) {
  const out = { ...s };
  for (const c of COUPLINGS) {
    const excess = Math.max(0, s[c.from] - BASE);
    for (const [k, m] of Object.entries(c.to)) out[k] += m * excess;
  }
  for (const k of STAT_IDS) out[k] = clamp01(out[k]);
  return out;
}

/** Project onto the product-cap region by shrinking both excesses by the same factor. */
export function enforceProductCaps(s) {
  const out = { ...s };
  for (const { a, b, cap } of PRODUCT_CAPS) {
    const xa = Math.max(0, out[a] - BASE) / BASE;
    const xb = Math.max(0, out[b] - BASE) / BASE;
    const p = xa * xb;
    if (p > cap) {
      const f = Math.sqrt(cap / p); // keeps the a:b ratio, lands exactly on the cap curve
      out[a] = BASE + xa * f * BASE;
      out[b] = BASE + xb * f * BASE;
    }
  }
  return out;
}

/**
 * Power score: convex in each stat's excess (doubling a stat costs ~4x), with a
 * small linear refund for weaknesses capped at 40% of the upside so dumping
 * stats can't buy unlimited strength.
 */
export function powerScore(s) {
  let up = 0, down = 0;
  for (const st of CORE_STATS) {
    const d = (s[st.id] - BASE) / BASE;
    if (d > 0) up += st.w * d * d; else down += st.w * -d * 0.25;
  }
  return Math.max(0, up - Math.min(down, up * 0.4)) / 3;
}

/** Shrink every deviation from BASE by t∈[0,1] (bisection) until power <= cap. */
export function capPower(s, cap = POWER_CAP) {
  if (powerScore(s) <= cap) return { stats: s, shrink: 1 };
  const at = t => Object.fromEntries(STAT_IDS.map(k => [k, BASE + (s[k] - BASE) * t]));
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (powerScore(at(mid)) <= cap) lo = mid; else hi = mid;
  }
  return { stats: at(lo), shrink: lo };
}

export function traitPoints(ids) {
  return ids.reduce((n, id) => n + (TRAIT_BY_ID.get(id)?.cost || 0), 0);
}

/**
 * Full pipeline: conflicts → raw sum → couplings → budget squeeze → product caps → power cap.
 * Over-budget builds are still legal but uniformly squeezed by budget/points.
 */
export function normalizeBuild(ids, core = {}) {
  const { kept, dropped } = resolveTraitConflicts(ids);
  const points = Math.max(0, traitPoints(kept) + corePoints(core));
  let s = applyCouplings(rawStats(kept, core));
  const budgetScale = points > TRAIT_BUDGET ? TRAIT_BUDGET / points : 1;
  if (budgetScale < 1) s = Object.fromEntries(STAT_IDS.map(k => [k, BASE + (s[k] - BASE) * budgetScale]));
  s = enforceProductCaps(s);
  const { stats, shrink } = capPower(s);
  return { traits: kept, core, dropped, points, budget: TRAIT_BUDGET, budgetScale, shrink, stats, power: powerScore(stats) };
}

/** Deterministic AI opponent: greedy affordable picks from a seeded walk. */
export function generateBuild(seed, catalog, maxPicks = 7) {
  let x = (seed >>> 0) || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const picks = [];
  let pts = 0;
  for (let i = 0; i < 80 && picks.length < maxPicks; i++) {
    const t = catalog[Math.floor(rnd() * catalog.length)];
    if (pts + t.cost > TRAIT_BUDGET) continue;
    const { kept } = resolveTraitConflicts([...picks, t.id]);
    if (kept.length === picks.length + 1) { picks.push(t.id); pts += t.cost; }
  }
  return picks;
}

export const statLabel = id => STAT_BY_ID[id]?.label || id;
