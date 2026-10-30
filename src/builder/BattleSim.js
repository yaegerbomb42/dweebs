// BattleSim.js — Deterministic Autonomous Duel Simulator for the Build-A-Dweeb Dojo
//
// A pure, seeded combat model over build configs (effective stats + DNA), used
// by the lab's DOJO spar / gauntlet modes and by the offline playtest suite.
// No renderer, no physics — just numbers, so bouts run instantly and are
// reproducible from a seed. NOT the live arena combat (src/game); results are
// labelled "simulated" in the HUD.

import {
  effectiveStats,
  computeBattleProfile,
  ARCHETYPE_PRESETS,
  randomizeConfig,
} from './CustomDweebModel.js';

/** Seeded PRNG (mulberry32). Same seed => same bout, every time. */
export function createRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fighterState(cfg) {
  const st = effectiveStats(cfg);
  const dna = cfg.dna || {};
  const d = (k, fb) => (Number.isFinite(dna[k]) ? dna[k] : fb);
  return {
    st,
    conf: d('confidence', 0.8),
    aim: d('aimAccuracy', 0.7),
    agi: d('agility', 0.7),
  };
}

/**
 * Simulate one duel between two builds.
 * @returns { winner: 0|1|'draw', rounds, hpA, hpB, dmgA, dmgB, log[] }
 */
export function simulateDuel(aCfg, bCfg, rng = Math.random) {
  const A = fighterState(aCfg);
  const B = fighterState(bCfg);
  const nameA = aCfg.name || 'Fighter A';
  const nameB = bCfg.name || 'Fighter B';

  let hpA = 100 + A.st.mass * 14;
  let hpB = 100 + B.st.mass * 14;
  const maxHpA = hpA, maxHpB = hpB;
  const dmg = { a: 0, b: 0 };
  const log = [];

  const attack = F => 9 * (0.7 + F.st.mass * 0.12) * (0.8 + 0.5 * F.conf);
  const hitChance = (F, E) => clamp(
    0.58 + (F.st.speed - 1) * 0.45 + (F.aim - 0.7) * 0.5 - (E.agi - 0.7) * 0.55 + (F.st.jump - 1) * 0.15,
    0.22, 0.97
  );
  const armorReduce = F => clamp(1 - (F.st.armor - 1) * 0.45, 0.5, 1.15);

  // Faster build strikes first each round (initiative re-rolled lightly).
  const order = () => ((A.st.speed + rng() * 0.3) >= (B.st.speed + rng() * 0.3) ? ['a', 'b'] : ['b', 'a']);

  let winner = 'draw';
  let rounds = 0;
  const MAX_ROUNDS = 60;

  const strike = (atk, def, atkName, defName, key) => {
    const F = atk === 'a' ? A : B;
    const E = def === 'a' ? A : B;
    if (rng() > hitChance(F, E)) {
      if (log.length < 24 && rng() < 0.3) log.push(`${atkName} whiffs — ${defName} dodges!`);
      return 0;
    }
    const crit = rng() < 0.08;
    const raw = attack(F) * armorReduce(E) * (0.85 + rng() * 0.3) * (crit ? 1.6 : 1);
    const dealt = Math.max(1, Math.round(raw));
    if (key === 'a') { hpB -= dealt; dmg.a += dealt; } else { hpA -= dealt; dmg.b += dealt; }
    if (log.length < 24) {
      const hpLeft = Math.max(0, Math.round(key === 'a' ? hpB : hpA));
      log.push(`${atkName} ${crit ? 'lands a CRIT' : 'hits'} for ${dealt} (${defName} ${hpLeft} HP left)`);
    }
    return dealt;
  };

  for (rounds = 1; rounds <= MAX_ROUNDS; rounds++) {
    for (const side of order()) {
      if (side === 'a') strike('a', 'b', nameA, nameB, 'a');
      else strike('b', 'a', nameB, nameA, 'b');
      if (hpA <= 0 || hpB <= 0) break;
    }
    if (hpA <= 0 || hpB <= 0) break;
  }
  // If the loop ran to completion without a KO, `rounds` overshoots by one.
  rounds = Math.min(rounds, MAX_ROUNDS);

  const finalA = Math.max(0, hpA), finalB = Math.max(0, hpB);
  if (finalA <= 0 && finalB <= 0) winner = finalA === finalB ? 'draw' : (finalA > finalB ? 0 : 1);
  else if (finalA <= 0) winner = 1;
  else if (finalB <= 0) winner = 0;
  // Round cap: compare remaining HP *fractions* (unrounded) so a bigger
  // health pool alone doesn't win a fight where nothing landed.
  else {
    const fracA = finalA / maxHpA, fracB = finalB / maxHpB;
    winner = Math.abs(fracA - fracB) < 1e-9 ? 'draw' : (fracA > fracB ? 0 : 1);
  }

  return {
    winner,
    rounds,
    hpA: Math.round(finalA), hpB: Math.round(finalB),
    maxHpA: Math.round(maxHpA), maxHpB: Math.round(maxHpB),
    dmgA: dmg.a, dmgB: dmg.b,
    log,
  };
}

/**
 * Best-of-N bouts. Plays exactly `bestOf` duels; winner is whoever won more.
 */
export function simulateBout(aCfg, bCfg, { bestOf = 3, rng = Math.random } = {}) {
  const n = Math.max(1, bestOf);
  let winsA = 0, winsB = 0, draws = 0;
  let roundsSum = 0, dmgA = 0, dmgB = 0;
  const duels = [];
  for (let i = 0; i < n; i++) {
    const d = simulateDuel(aCfg, bCfg, rng);
    duels.push(d);
    if (d.winner === 0) winsA++;
    else if (d.winner === 1) winsB++;
    else draws++;
    roundsSum += d.rounds;
    dmgA += d.dmgA;
    dmgB += d.dmgB;
  }
  return {
    winsA, winsB, draws,
    winner: winsA === winsB ? 'draw' : (winsA > winsB ? 0 : 1),
    avgRounds: Number((roundsSum / n).toFixed(1)),
    totalDmgA: dmgA, totalDmgB: dmgB,
    duels,
  };
}

// ─── Gauntlet ────────────────────────────────────────────────────────────────

/** Six escalating tiers for the DOJO GAUNTLET ladder mode. */
export const GAUNTLET_TIERS = [
  { title: '🥊 WARM-UP', preset: 'pugilist_champ', buff: 0.0 },
  { title: '🎯 SHARPSHOOTER', preset: 'sniper_bean', buff: 0.05 },
  { title: '⚡ SPEED DEMON', preset: 'speed_gremlin', buff: 0.1 },
  { title: '🪂 SKY TERROR', preset: 'sky_corsair', buff: 0.15 },
  { title: '🐢 IRON WALL', preset: 'siege_turtle', buff: 0.2 },
  { title: '👑 CHAMPION', preset: 'titan_chonk', buff: 0.25 },
];

/** Build a tier opponent: archetype preset with a multiplicative stat buff. */
export function gauntletOpponent(tier, buffOverride = null) {
  const preset = ARCHETYPE_PRESETS[tier.preset];
  if (!preset) throw new Error(`Unknown gauntlet preset: ${tier.preset}`);
  const buff = buffOverride ?? tier.buff ?? 0;
  const stats = {};
  for (const [k, v] of Object.entries(preset.stats || {})) {
    stats[k] = Number((v * (1 + buff)).toFixed(2));
  }
  return {
    ...preset,
    name: `${tier.title.replace(/^[^\s]+\s/, '')} ${preset.name}`.trim(),
    badge: `🏆 GAUNTLET ${tier.title}`,
    stats,
  };
}

/**
 * Run the ladder: best-of-`bestOf` vs each tier in order; the run ends at the
 * first lost tier.
 */
export function runGauntlet(playerCfg, { rng = Math.random, bestOf = 3 } = {}) {
  const rounds = [];
  let cleared = 0;
  for (const tier of GAUNTLET_TIERS) {
    const opp = gauntletOpponent(tier);
    const bout = simulateBout(playerCfg, opp, { bestOf, rng });
    const won = bout.winner === 0;
    rounds.push({ tier: tier.title, opponent: opp.name, buff: tier.buff, bout, won });
    if (!won) break;
    cleared++;
  }
  return {
    rounds,
    cleared,
    total: GAUNTLET_TIERS.length,
    champion: cleared === GAUNTLET_TIERS.length,
  };
}

/**
 * Endless gauntlet: seeded random mutants with stats scaling +6% per round,
 * single duels, until the first loss (or maxRounds).
 */
export function runEndlessGauntlet(playerCfg, { rng = Math.random, maxRounds = 25 } = {}) {
  const rounds = [];
  let cleared = 0;
  for (let r = 1; r <= Math.max(1, maxRounds); r++) {
    const opp = randomizeConfig(rng);
    const scale = 1 + r * 0.06;
    for (const k of Object.keys(opp.stats)) opp.stats[k] = Number((opp.stats[k] * scale).toFixed(2));
    opp.name = `Endless R${r}: ${opp.name}`;
    const duel = simulateDuel(playerCfg, opp, rng);
    const won = duel.winner === 0;
    rounds.push({ round: r, opponent: opp.name, scale: Number(scale.toFixed(2)), duel, won });
    if (!won) break;
    cleared++;
  }
  return { rounds, cleared };
}

// ─── Dojo opponents ──────────────────────────────────────────────────────────

/**
 * Resolve a dojo spar opponent key to a build config. Keys match the HUD's
 * opponent select so SPAR and SEND-TO-ARENA can share the picker.
 */
export function dojoSparOpponent(oppKey, playerCfg, rng = Math.random) {
  const presetKey = {
    juggernaut: 'titan_chonk',
    gremlin: 'speed_gremlin',
    sniper: 'sniper_bean',
    pugilist: 'pugilist_champ',
  }[oppKey];
  if (presetKey && ARCHETYPE_PRESETS[presetKey]) {
    return { ...ARCHETYPE_PRESETS[presetKey] };
  }
  if (oppKey === 'mirror') {
    return {
      ...playerCfg,
      name: `Anti-${playerCfg.name || 'Dweeb'}`,
      badge: '🤖 MIRROR RIVAL',
      primaryColor: '#2b1b3d',
      accentColor: '#ff2a5f',
    };
  }
  // 'random' and anything unknown: seeded mutant
  const cfg = randomizeConfig(rng);
  cfg.badge = '👾 DOJO MUTANT';
  return cfg;
}

/** One-line balance snapshot for a build, used by dojo reports. */
export function buildSnapshot(cfg) {
  const p = computeBattleProfile(cfg);
  return {
    name: cfg.name || 'Unnamed',
    rating: p.rating,
    tier: p.tier,
    synergies: p.synergies,
  };
}
