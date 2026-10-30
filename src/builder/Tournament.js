// Tournament.js — Build-A-Dweeb Colosseum tournament ladder.
//
// Multi-round bracket (Quarterfinals → Semifinals → Grand Final) of autonomous
// AI bouts. The player's custom dweeb climbs the ladder against increasingly
// formidable champion builds; AI-vs-AI undercard bouts are simulated from each
// build's power rating. Champion AI reuses the existing BuilderBot DNA patterns
// (confidence / aimAccuracy / scavenge / agility) — this module only authors
// champion *configs*, never a new AI framework.
//
// Wiring: owned by BuildADweebLab (startTournament / tournamentOpponent /
// recordTournamentResult); the arena bout itself is launched through the HUD's
// onLaunchTournament handler (main.js follow-up).

import { ELEMENTAL_PALETTES, APPENDAGE_GAMEPLAY } from './CustomDweebModel.js';
import { BALANCE } from '../game/Balance.js';

export const TOURNAMENT_ROUNDS = [
  { id: 'quarterfinal', name: 'QUARTERFINALS', bouts: 4 },
  { id: 'semifinal', name: 'SEMIFINALS', bouts: 2 },
  { id: 'final', name: 'GRAND FINAL', bouts: 1 },
];

// Seeded bracket: the player opens against the softest champion; the far side
// of the bracket is stacked so semifinal/final opponents are genuinely scary.
export const CHAMPION_BUILDS = [
  {
    id: 'rusty_rivet',
    name: 'Rusty Rivet', badge: '🤖 RUSTY RIVET',
    shape: 'blob', width: 1.0, height: 0.95, depth: 1.0,
    primaryColor: '#8a8f98', accentColor: '#ff9f1c', eyeColor: '#14101c',
    eyeCount: 2, eyeSize: 1.0, eyeSpacing: 1.0, brows: 'derpy', mouth: 'grin',
    appendage: 'plungers', feet: 'pegs',
    stats: { mass: 2.8, armor: 1.0, speed: 1.0, jump: 1.0 },
    dna: { confidence: 0.55, aimAccuracy: 0.5, scavenge: 0.55, agility: 0.5 },
  },
  {
    id: 'bounce_bandit',
    name: 'Bounce Bandit', badge: '🌀 BOUNCE BANDIT',
    shape: 'spiky', width: 0.9, height: 0.9, depth: 0.9,
    primaryColor: '#00f5d4', accentColor: '#7b2cbf', eyeColor: '#14101c',
    eyeCount: 3, eyeSize: 0.9, eyeSpacing: 0.9, brows: 'confident', mouth: 'grin',
    appendage: 'spring_stompers', feet: 'coils',
    stats: { mass: 2.5, armor: 0.9, speed: 1.15, jump: 1.25 },
    dna: { confidence: 0.6, aimAccuracy: 0.45, scavenge: 0.5, agility: 0.8 },
  },
  {
    id: 'junk_sniper',
    name: 'Junk Sniper', badge: '🎯 JUNK SNIPER',
    shape: 'capsule', width: 0.85, height: 1.3, depth: 0.85,
    primaryColor: '#3a86ff', accentColor: '#ff006e', eyeColor: '#14101c',
    eyeCount: 1, eyeSize: 1.4, eyeSpacing: 1.0, brows: 'confident', mouth: 'open',
    appendage: 'antennae', feet: 'pegs',
    stats: { mass: 2.6, armor: 0.95, speed: 1.05, jump: 1.0 },
    dna: { confidence: 0.5, aimAccuracy: 0.88, scavenge: 0.7, agility: 0.6 },
  },
  {
    id: 'grease_goblin',
    name: 'Grease Goblin', badge: '👾 GREASE GOBLIN',
    shape: 'star', width: 1.0, height: 1.0, depth: 1.0,
    primaryColor: '#65a30d', accentColor: '#a16207', eyeColor: '#1a2e05',
    eyeCount: 2, eyeSize: 1.1, eyeSpacing: 1.0, brows: 'angry', mouth: 'teeth',
    appendage: 'tail', feet: 'stompers',
    stats: { mass: 2.7, armor: 1.0, speed: 1.1, jump: 1.05 },
    dna: { confidence: 0.68, aimAccuracy: 0.6, scavenge: 0.85, agility: 0.72 },
  },
  {
    id: 'volt_vixen',
    name: 'Volt Vixen', badge: '⚡ VOLT VIXEN',
    shape: 'blob', width: 0.95, height: 1.05, depth: 0.95,
    primaryColor: '#fbbf24', accentColor: '#fff7ed', eyeColor: '#7c2d12',
    eyeCount: 2, eyeSize: 1.0, eyeSpacing: 1.1, brows: 'confident', mouth: 'grin',
    appendage: 'magnet_eyes', feet: 'coils', palette: 'solar',
    stats: { mass: 2.9, armor: 1.0, speed: 1.12, jump: 1.1 },
    dna: { confidence: 0.62, aimAccuracy: 0.72, scavenge: 0.9, agility: 0.78 },
  },
  {
    id: 'iron_matriarch',
    name: 'Iron Matriarch', badge: '🏔️ IRON MATRIARCH · SEMIFINAL CHAMPION',
    shape: 'chonk', width: 1.3, height: 1.15, depth: 1.2,
    primaryColor: ELEMENTAL_PALETTES.terra.primaryColor,
    accentColor: ELEMENTAL_PALETTES.terra.accentColor,
    eyeColor: ELEMENTAL_PALETTES.terra.eyeColor,
    eyeCount: 2, eyeSize: 1.1, eyeSpacing: 1.0, brows: 'angry', mouth: 'teeth',
    appendage: 'anvil_tail', feet: 'stompers', palette: 'terra',
    stats: { mass: 4.0, armor: 1.35, speed: 1.0, jump: 0.95 },
    dna: { confidence: 0.85, aimAccuracy: 0.7, scavenge: 0.5, agility: 0.6 },
  },
  {
    id: 'storm_herald',
    name: 'Storm Herald', badge: '🌩️ STORM HERALD · GRAND CHAMPION',
    shape: 'spiky', width: 1.1, height: 1.1, depth: 1.0,
    primaryColor: ELEMENTAL_PALETTES.storm.primaryColor,
    accentColor: ELEMENTAL_PALETTES.storm.accentColor,
    eyeColor: ELEMENTAL_PALETTES.storm.eyeColor,
    eyeCount: 3, eyeSize: 1.0, eyeSpacing: 1.0, brows: 'angry', mouth: 'open',
    appendage: 'dragon_wings', feet: 'coils', palette: 'storm',
    stats: { mass: 3.2, armor: 1.2, speed: 1.22, jump: 1.3 },
    dna: { confidence: 0.9, aimAccuracy: 0.82, scavenge: 0.6, agility: 0.92 },
  },
];

/**
 * Power rating of a build config — drives AI-vs-AI undercard simulation and
 * documents the intended difficulty curve. Combines combat stats with the
 * BuilderBot DNA traits (confidence/aim/scavenge/agility).
 */
export function powerOf(config = {}) {
  const s = config.stats || {};
  const d = config.dna || config.DNA || {};
  const mass = s.mass ?? config.mass ?? 3.0;
  const armor = s.armor ?? config.armor ?? 1.0;
  const speed = s.speed ?? config.speed ?? 1.0;
  const jump = s.jump ?? config.jump ?? 1.0;
  const dnaSum = (d.confidence ?? 0.8) + (d.aimAccuracy ?? 0.7) + (d.scavenge ?? 0.6) + (d.agility ?? 0.7);
  return mass * 0.35 + armor * 2.2 + speed * 2.0 + jump * 1.2 + dnaSum * 1.5;
}

/**
 * Simulate an AI-vs-AI undercard bout. Win probability is proportional to power
 * rating, so stronger champions usually (not always) advance — upsets happen.
 * rng is injectable for deterministic tests.
 */
export function simulateAiMatch(a, b, rng = Math.random) {
  const pa = powerOf(a);
  const pb = powerOf(b);
  const pA = pa / Math.max(1e-6, pa + pb);
  return rng() < pA ? a : b;
}

/**
 * Generate a gauntlet opponent for a wave: a random champion that gets heavier, tougher, a little
 * faster and a lot smarter every wave (each stat has its own cap so late waves stay playable),
 * with one appendage re-rolled so the run doesn't feel like the same fight on repeat.
 */
export function gauntletOpponent(wave, rng = Math.random) {
  const G = BALANCE.gauntlet;
  const n = Math.max(0, wave - 1);
  const pick = CHAMPION_BUILDS[Math.floor(rng() * CHAMPION_BUILDS.length)];
  const grow = (base, per, cap) => Number((base * Math.min(cap, 1 + per * n)).toFixed(2));
  const st = pick.stats || {};
  const stats = {
    ...st,
    mass: grow(st.mass ?? 2.8, G.massPerWave, G.massCap),
    armor: grow(st.armor ?? 1, G.armorPerWave, G.armorCap),
    speed: grow(st.speed ?? 1, G.speedPerWave, G.speedCap),
    jump: grow(st.jump ?? 1, G.jumpPerWave, G.jumpCap),
  };
  // AI brains sharpen toward G.dnaMax over the first G.dnaWaves waves.
  const t = Math.min(1, n / G.dnaWaves);
  const dna = {};
  for (const [k, v] of Object.entries(pick.dna || {})) dna[k] = Number((v + (Math.max(v, G.dnaMax) - v) * t).toFixed(2));
  const appendages = Object.keys(APPENDAGE_GAMEPLAY || {}).filter(k => k !== 'none');
  const appendage = n > 0 && appendages.length ? appendages[Math.floor(rng() * appendages.length)] : pick.appendage;
  return {
    ...pick,
    stats, dna, appendage,
    badge: `🌊 WAVE ${wave} · ${pick.badge}`,
    name: wave > 1 ? `${pick.name} Mk.${wave}` : pick.name,
    isGauntlet: true,
    wave,
  };
}

let _boutSeq = 0;

export class TournamentBracket {
  constructor(playerConfig = {}, rng = Math.random) {
    this.rng = rng;
    this.player = { ...playerConfig, isPlayer: true, entrantId: 'player' };
    this.champions = CHAMPION_BUILDS.map(c => ({ ...c, entrantId: c.id }));
    this.status = 'in'; // 'in' | 'eliminated' | 'champion'
    this.currentRoundIndex = 0;
    this.rounds = [];
    this._buildQuarterfinals();
  }

  _entrant(id) {
    if (id === 'player') return this.player;
    return this.champions.find(c => c.entrantId === id) || null;
  }

  _match(round, a, b) {
    return {
      id: `bout_${++_boutSeq}`,
      round,
      aId: a.entrantId, bId: b.entrantId,
      aName: a.name || 'Custom Dweeb', bName: b.name || 'Custom Dweeb',
      winnerId: null,
    };
  }

  _buildQuarterfinals() {
    const c = this.champions;
    this.rounds = [{
      ...TOURNAMENT_ROUNDS[0],
      matches: [
        this._match(0, this.player, c[0]),
        this._match(0, c[1], c[2]),
        this._match(0, c[3], c[4]),
        this._match(0, c[5], c[6]),
      ],
    }];
  }

  /** The player's current unplayed bout, or null when out of the tournament. */
  playerMatch() {
    if (this.status !== 'in') return null;
    const round = this.rounds[this.currentRoundIndex];
    if (!round) return null;
    return round.matches.find(m => !m.winnerId && (m.aId === 'player' || m.bId === 'player')) || null;
  }

  /** Champion config the player must beat next (null when no bout is pending). */
  opponentForPlayer() {
    const m = this.playerMatch();
    if (!m) return null;
    return this._entrant(m.aId === 'player' ? m.bId : m.aId);
  }

  /**
   * Record the outcome of the player's current bout. A win simulates the
   * round's remaining undercard bouts and advances the bracket; a loss ends
   * the run. Returns the fresh state summary.
   */
  recordPlayerResult(playerWon) {
    const m = this.playerMatch();
    if (!m) return this.state();
    m.winnerId = playerWon ? 'player' : (m.aId === 'player' ? m.bId : m.aId);
    if (!playerWon) {
      this.status = 'eliminated';
      return this.state();
    }
    const round = this.rounds[this.currentRoundIndex];
    for (const om of round.matches) {
      if (!om.winnerId) {
        om.winnerId = simulateAiMatch(this._entrant(om.aId), this._entrant(om.bId), this.rng).entrantId;
      }
    }
    this._advance();
    return this.state();
  }

  _advance() {
    const winners = this.rounds[this.currentRoundIndex].matches.map(m => m.winnerId);
    this.currentRoundIndex += 1;
    if (this.currentRoundIndex >= TOURNAMENT_ROUNDS.length) {
      this.status = 'champion';
      return;
    }
    const def = TOURNAMENT_ROUNDS[this.currentRoundIndex];
    const matches = [];
    for (let i = 0; i < winners.length; i += 2) {
      matches.push(this._match(this.currentRoundIndex, this._entrant(winners[i]), this._entrant(winners[i + 1])));
    }
    this.rounds[this.currentRoundIndex] = { ...def, matches };
  }

  /** Plain summary for HUD rendering / persistence. */
  state() {
    return {
      status: this.status,
      roundIndex: this.currentRoundIndex,
      roundName: this.status === 'champion' ? 'CHAMPION' : (TOURNAMENT_ROUNDS[this.currentRoundIndex]?.name || ''),
      rounds: this.rounds.map(r => ({
        id: r.id, name: r.name,
        matches: r.matches.map(m => ({ ...m })),
      })),
      playerMatch: this.playerMatch(),
      opponent: this.opponentForPlayer(),
      champion: this.status === 'champion' ? { ...this.player } : null,
    };
  }

  toJSON() {
    return {
      player: this.player,
      champions: this.champions,
      status: this.status,
      currentRoundIndex: this.currentRoundIndex,
      rounds: this.rounds.map(r => ({
        id: r.id, name: r.name, bouts: r.bouts,
        matches: r.matches.map(m => ({ ...m })),
      })),
    };
  }

  static fromJSON(data) {
    const t = new TournamentBracket(data.player || {}, Math.random);
    t.champions = data.champions || t.champions;
    t.status = data.status || 'in';
    t.currentRoundIndex = data.currentRoundIndex || 0;
    t.rounds = (data.rounds || []).map(r => ({ ...r, matches: r.matches.map(m => ({ ...m })) }));
    return t;
  }
}
