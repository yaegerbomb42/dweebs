// arena-wave3.test.js — W3-BIGGER content drop: arena mechanics in the sim, new modes,
// brutal bots, crowd hype, match awards, tournament bracket.
//
// Every feature here runs headless and deterministic: same seed, same run.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/Sim.js';
import { Bot, BRUTAL, DIFFICULTY } from '../src/sim/bot.js';
import { Crowd } from '../src/sim/crowd.js';
import { RngStreams } from '../src/sim/rng.js';
import { runTournament } from '../src/sim/tournament.js';
import { NEUTRAL_INPUT } from '../src/sim/contracts.js';
import { ARENA_IDS, profileFor } from '../src/sim/arenaProfiles.js';
import { ARENAS } from '../src/game/Arenas.js';
import { GAME_MODES } from '../src/game/GameModes.js';
import { BALANCE } from '../src/game/Balance.js';
import { hypeLine, awardLine, victoryLine, introLine } from '../src/game/Announcer.js';
import { Match } from '../src/game/Match.js';

/** N seats, past the countdown. All sim options flow through. */
async function makeSim(seats, opts = {}) {
  const {
    seed = 4242, arena = 'stadium', mode = 'brawl', teams = null, stocks = 3,
    roundTime = 120, items = false, difficulty = 'hard', hillTarget = 60,
    roundsToWin = 2, suddenDeathAt = 40,
  } = opts;
  const sim = new Sim({
    seed, items, arena, mode, teams, stocks, roundTime, suddenDeathAt,
    botDifficulty: difficulty, hillTarget, roundsToWin,
  });
  await sim.init();
  seats.forEach((isBot, i) => sim.addSeat({ slot: i, name: 'P' + i, type: 'cube', isBot }));
  sim.startMatch();
  for (let t = 0; t < 400 && sim.match.phase !== 'playing'; t++) sim.step();
  expect(sim.match.phase).toBe('playing');
  return sim;
}

function place(sim, d, x, y, z) {
  sim.physics.setPos(d.id, x, y, z);
  sim.physics.setVel(d.id, 0, 0, 0);
  d.invuln = 0;
  d.percent = 0;
  d.flailUsed = true; // scenarios start past the flail; water means business
  d.swimFlail = 0;
  d.sync();
}

/** Neutral frames for every seat: the scenario, not the bots, drives. */
function neutralInputs(sim) {
  const inp = {};
  for (const d of sim.dweebs) if (d) inp[d.slot] = { ...NEUTRAL_INPUT };
  return inp;
}

function stepCollect(sim, ticks, inputs = null) {
  const evs = [];
  const inp = inputs ?? neutralInputs(sim);
  for (let t = 0; t < ticks; t++) for (const e of sim.step(inp)) evs.push(e);
  return evs;
}

const kinds = evs => evs.map(e => e.type + (e.kind ? ':' + e.kind : ''));

describe('arena profiles & parity', () => {
  it('every sim arena id exists in game/Arenas.js with matching mechanic flags', () => {
    for (const id of ARENA_IDS) {
      const game = ARENAS.find(a => a.id === id);
      expect(game, `game/Arenas.js missing ${id}`).toBeTruthy();
      const p = profileFor(id);
      expect(p.traction).toBeCloseTo(game.traction ?? 1, 6);
      expect(p.slide).toBeCloseTo(game.slide ?? 1, 6);
      expect(p.gravity).toBeCloseTo(game.gravity ?? 1, 6);
      expect(p.wind).toBe(!!game.wind);
      expect(p.lava).toBe(!!game.lava);
      expect(p.crust).toBe(!!game.crust);
      expect(p.conveyors).toBe(!!game.conveyors);
      expect(p.lightning).toBe(!!game.lightning);
      expect(p.stickyCenter).toBe(!!game.stickyCenter);
      expect(p.magnetPulse).toBe(!!game.magnetPulse);
      expect(p.bumperBoost).toBeCloseTo(game.bumpers ?? 1, 6);
    }
  });

  it('unknown arena ids play as the stadium', () => {
    expect(profileFor('nope')).toEqual(profileFor('stadium'));
  });

  it('three new arenas exist with distinct mechanics', () => {
    for (const id of ['stormspire', 'quicksand', 'magnetcore']) {
      expect(ARENA_IDS).toContain(id);
      expect(ARENAS.find(a => a.id === id)?.blurb?.length).toBeGreaterThan(10);
    }
    expect(profileFor('stormspire').lightning).toBe(true);
    expect(profileFor('quicksand').stickyCenter).toBe(true);
    expect(profileFor('magnetcore').magnetPulse).toBe(true);
  });

  it('new game modes are registered', () => {
    expect(GAME_MODES.hill.isHill).toBe(true);
    expect(GAME_MODES.teams.isTeams).toBe(true);
    expect(GAME_MODES.sudden.isSudden).toBe(true);
    expect(GAME_MODES.sudden.stocks).toBe(1);
  });
});

describe('wind (gale)', () => {
  it('telegraphs then blows, and shoves a standing dweeb downwind', async () => {
    const sim = await makeSim([false], { arena: 'gale' });
    const d = sim.dweebs[0];
    place(sim, d, 0, 0.6, 0);
    sim.arena.wind = { phase: 'blow', timer: 156, dirX: 1, dirZ: 0 };
    stepCollect(sim, 60);
    expect(d.position[0]).toBeGreaterThan(0.5);
  });

  it('emits warn then blow on its schedule', async () => {
    const sim = await makeSim([false], { arena: 'gale' });
    sim.arena.wind.timer = 3; // first gust almost here
    const evs = stepCollect(sim, 400);
    const gusts = evs.filter(e => e.type === 'windGust');
    expect(gusts[0]?.kind).toBe('warn');
    expect(gusts.some(e => e.kind === 'blow')).toBe(true);
  });
});

describe('moon gravity', () => {
  it('a jump goes ~1/0.58x higher than on the stadium', async () => {
    async function apex(arena) {
      const sim = await makeSim([false], { arena });
      const d = sim.dweebs[0];
      place(sim, d, 0, 0.6, 0);
      let maxY = 0;
      for (let t = 0; t < 120; t++) {
        const inp = neutralInputs(sim);
        if (t === 2) inp[0] = { ...NEUTRAL_INPUT, jump: true };
        sim.step(inp);
        maxY = Math.max(maxY, d.position[1]);
      }
      return maxY;
    }
    const stadium = await apex('stadium');
    const moon = await apex('moon');
    expect(moon).toBeGreaterThan(stadium * 1.25); // 0.58 gravity: floatier, provably so
  });
});

describe('ice traction', () => {
  it('the iceberg accelerates much slower than the stadium', async () => {
    async function distance(arena) {
      const sim = await makeSim([false], { arena });
      const d = sim.dweebs[0];
      place(sim, d, -6, 0.6, 0);
      for (let t = 0; t < 90; t++) {
        sim.step({ 0: { ...NEUTRAL_INPUT, moveX: 1 } });
      }
      return d.position[0] + 6;
    }
    const stadium = await distance('stadium');
    const ice = await distance('iceberg');
    expect(stadium).toBeGreaterThan(5);
    expect(ice).toBeLessThan(stadium * 0.9);
  });
});

describe('conveyors (pinball)', () => {
  it('the +x belt carries a grounded dweeb', async () => {
    const sim = await makeSim([false], { arena: 'pinball' });
    const d = sim.dweebs[0];
    // The +x belt is the z≈−4.2 lane — the live Pinball Factory layout, which the sim mirrors.
    place(sim, d, 0, 0.6, -4.4);
    stepCollect(sim, 120);
    expect(d.position[0]).toBeGreaterThan(2);
    const ctrl = await makeSim([false]);
    const c = ctrl.dweebs[0];
    place(ctrl, c, 0, 0.6, -4.4);
    stepCollect(ctrl, 120);
    expect(Math.abs(c.position[0])).toBeLessThan(0.5);
  });
});

describe('volcano lava', () => {
  it('the first dip spits you back: lavaHit, no stock lost, launched up', async () => {
    const sim = await makeSim([false, false], { arena: 'volcano' });
    const d = sim.dweebs[0];
    place(sim, d, 10, -4.5, 0);
    const stocks = d.stocks;
    const evs = stepCollect(sim, 3);
    expect(kinds(evs)).toContain('lavaHit');
    expect(d.stocks).toBe(stocks);
    expect(d.position[1]).toBeGreaterThan(-4.5); // moving back up
    expect(d.lavaCd).toBeGreaterThan(0);
  });

  it('a dip while the lava cooldown runs dunks you for real', async () => {
    const sim = await makeSim([false, false], { arena: 'volcano' });
    const d = sim.dweebs[0];
    place(sim, d, 10, -4.5, 0);
    d.lavaCd = 1;
    const stocks = d.stocks;
    stepCollect(sim, 3);
    expect(d.stocks).toBe(stocks - 1);
  });

  it('the third consecutive dip dunks even off cooldown', async () => {
    const sim = await makeSim([false, false], { arena: 'volcano' });
    const d = sim.dweebs[0];
    d.lavaDips = 2;
    place(sim, d, 10, -4.5, 0);
    const stocks = d.stocks;
    stepCollect(sim, 3);
    expect(d.stocks).toBe(stocks - 1);
  });

  it('landing back on stage forgives the dip counter', async () => {
    const sim = await makeSim([false], { arena: 'volcano' });
    const d = sim.dweebs[0];
    d.lavaDips = 2;
    place(sim, d, 0, 0.6, 0);
    stepCollect(sim, 5);
    expect(d.lavaDips).toBe(0);
  });
});

describe('volcano crust', () => {
  it('the rim falls in on schedule and shrinks the edge', async () => {
    const sim = await makeSim([false], { arena: 'volcano' });
    const before = sim.arena.edgeRadius();
    sim.arena.crustTimer = 3;
    const evs = stepCollect(sim, 10);
    expect(sim.arena.crustFalls).toBe(1);
    expect(kinds(evs)).toContain('segmentWarn');
    expect(kinds(evs)).toContain('segmentFall');
    expect(sim.arena.edgeRadius()).toBeLessThan(before);
  });
});

describe('lightning (stormspire)', () => {
  it('warns, then strikes the marked spot for real damage', async () => {
    const sim = await makeSim([false, false], { arena: 'stormspire' });
    sim.arena.lightning.timer = 0.01;
    let warn = null;
    for (let t = 0; t < 30 && !warn; t++) {
      for (const e of sim.step(neutralInputs(sim))) if (e.type === 'lightning' && e.kind === 'warn') warn = e;
    }
    expect(warn).toBeTruthy();
    const d = sim.dweebs[0];
    place(sim, d, warn.x, 0.6, warn.z);
    const evs = stepCollect(sim, 80);
    expect(kinds(evs)).toContain('lightning:strike');
    expect(d.percent).toBeGreaterThanOrEqual(BALANCE.arena.lightningDamage);
  });

  it('the warn zone shows up in state hazards so bots can dodge it', async () => {
    const sim = await makeSim([true], { arena: 'stormspire' });
    sim.arena.lightning.timer = 0.01;
    stepCollect(sim, 10);
    expect(sim.getState().hazards.some(h => h.kind === 'lightning')).toBe(true);
  });
});

describe('quicksand', () => {
  it('the sticky centre bleeds horizontal speed', async () => {
    const sim = await makeSim([false], { arena: 'quicksand' });
    const d = sim.dweebs[0];
    place(sim, d, 0, 0.6, 0);
    sim.physics.setVel(d.id, 10, 0, 0);
    stepCollect(sim, 30);
    const v = sim.physics.vel(d.id);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(4);
  });
});

describe('magnet core', () => {
  it('an active pulse drags dweebs toward the centre', async () => {
    const sim = await makeSim([false], { arena: 'magnetcore' });
    const d = sim.dweebs[0];
    place(sim, d, 8, 0.6, 0);
    sim.arena.magnet.phase = 'active';
    sim.arena.magnet.timer = 120;
    stepCollect(sim, 60);
    expect(d.position[0]).toBeLessThan(6.5);
  });

  it('pulses telegraph warn then active', async () => {
    const sim = await makeSim([false], { arena: 'magnetcore' });
    sim.arena.magnet.timer = 2;
    const evs = stepCollect(sim, 200);
    const pulses = evs.filter(e => e.type === 'magnetPulse').map(e => e.kind);
    expect(pulses[0]).toBe('warn');
    expect(pulses).toContain('active');
  });
});

describe('bumper boost (megastadium)', () => {
  it('mega bumpers shove harder than stadium bumpers', async () => {
    async function bounceSpeed(arena) {
      const sim = await makeSim([false], { arena });
      const d = sim.dweebs[0];
      const bx = Math.cos(Math.PI / 8) * 8.2, bz = Math.sin(Math.PI / 8) * 8.2;
      place(sim, d, bx, 0.6, bz);
      stepCollect(sim, 5);
      const v = sim.physics.vel(d.id);
      return Math.hypot(v.x, v.z);
    }
    const stadium = await bounceSpeed('stadium');
    const mega = await bounceSpeed('megastadium');
    expect(mega).toBeGreaterThan(stadium * 1.2);
  });
});

describe('king of the hill', () => {
  it('the sole holder accrues points and takes the round at target', async () => {
    const sim = await makeSim([false, false], { mode: 'hill', hillTarget: 25, roundsToWin: 1 });
    const [a, b] = sim.dweebs;
    place(sim, a, 0, 0.6, 0);
    place(sim, b, 12, 0.6, 0);
    const evs = stepCollect(sim, 2200);
    expect(kinds(evs)).toContain('hillHold');
    expect(kinds(evs)).toContain('hillScore');
    expect(sim.match.phase).toBe('results');
    expect(sim.match.matchWinner).toBe(0);
  });

  it('a contested hill scores nothing', async () => {
    const sim = await makeSim([false, false], { mode: 'hill', hillTarget: 500 });
    const [a, b] = sim.dweebs;
    place(sim, a, 0.5, 0.6, 0);
    place(sim, b, -0.5, 0.6, 0);
    // pin them in place so the hill stays contested
    for (let t = 0; t < 120; t++) {
      sim.physics.setVel(a.id, 0, 0, 0);
      sim.physics.setVel(b.id, 0, 0, 0);
      sim.step(neutralInputs(sim));
    }
    expect(a.hillScore).toBeLessThan(1);
    expect(b.hillScore).toBeLessThan(1);
  });

  it('a KO costs no stock: out, then back in', async () => {
    const sim = await makeSim([false, false], { mode: 'hill', hillTarget: 500 });
    const [, b] = sim.dweebs;
    place(sim, b, 40, 0.6, 0); // past the side blast line
    const stocks = b.stocks;
    stepCollect(sim, 5);
    expect(b.stocks).toBe(stocks);
    expect(b.out).toBe(true);
    stepCollect(sim, 200); // respawn delay is 2 s
    expect(b.active).toBe(true);
    expect(b.eliminated).toBe(false);
  });

  it('hill bots run at the hill', async () => {
    const sim = await makeSim([true], { mode: 'hill', hillTarget: 500 });
    const bot = sim.bots[0];
    const d = sim.dweebs[0];
    place(sim, d, 10, 0.6, 0);
    const f = bot.think(sim.getState());
    // moving toward the centre: velocity intent opposes the position vector
    expect(f.moveX * d.position[0] + f.moveZ * d.position[2]).toBeLessThan(0);
  });
});

describe('team battle', () => {
  it('swings ignore teammates but hit enemies', async () => {
    const sim = await makeSim([false, false, false, false], { mode: 'teams', teams: [[0, 2], [1, 3]] });
    const [a, b, c] = sim.dweebs;
    expect(a.team).toBe(0);
    expect(c.team).toBe(0);
    expect(b.team).toBe(1);
    const api = sim._api();
    const seated = sim.dweebs.filter(Boolean);
    // teammate in range, attacker facing them
    place(sim, a, 0, 0.6, 0);
    place(sim, c, 1.0, 0.6, 0);
    a.yaw = Math.atan2(1, 0);
    let evs = [];
    const apiSpy = { ...api, emit: (t, f) => evs.push(t) };
    sim.combat.resolveSwing(a, 0.5, seated, apiSpy);
    expect(c.percent).toBe(0);
    expect(evs).not.toContain('hit');
    // enemy in range: the same swing lands
    place(sim, b, 1.0, 0.6, 0);
    place(sim, c, 8, 0.6, 8);
    evs = [];
    sim.combat.resolveSwing(a, 0.5, seated, apiSpy);
    expect(b.percent).toBeGreaterThan(0);
  });

  it('wiping a team ends the round', async () => {
    const sim = await makeSim([false, false, false, false], { mode: 'teams', teams: [[0, 2], [1, 3]] });
    sim.dweebs[1].eliminated = true;
    sim.dweebs[3].eliminated = true;
    const evs = stepCollect(sim, 5);
    expect(kinds(evs)).toContain('roundEnd:round');
    expect(sim.match.roundWinner).toBe(0);
  });

  it('bots never chase teammates', async () => {
    const sim = await makeSim([true, true, true, true], { mode: 'teams', teams: [[0, 1], [2, 3]] });
    const bot = sim.bots[0];
    const state = sim.getState();
    bot._pickTarget(state);
    expect(bot.target).not.toBe(1);
  });
});

describe('sudden death mode', () => {
  it('the arena is already closing in at GO', async () => {
    const sim = await makeSim([false, false], { mode: 'sudden', stocks: 1 });
    expect(sim.match.suddenDeath).toBe(true);
    expect(sim.match.blastSide).toBeCloseTo(BALANCE.match.blastSide * BALANCE.match.sdBlastScale, 6);
    expect(kinds(stepCollect(sim, 5))).not.toContain('suddenDeath'); // already fired in beginRound
  });
});

describe('brutal bots', () => {
  it('brutal merges over hard with superhuman reactions', () => {
    const rng = new RngStreams(1).stream('bot0');
    const bot = new Bot({ slot: 0, difficulty: 'brutal', rng });
    expect(bot.level).toBe('brutal');
    expect(bot.p).toEqual({ ...DIFFICULTY.hard, ...BRUTAL });
    expect(bot.p.reaction).toBeLessThan(DIFFICULTY.hard.reaction);
    expect(bot.p.tech).toBeGreaterThan(DIFFICULTY.hard.tech);
  });

  it('DIFFICULTY itself is untouched (live parity holds)', () => {
    expect(Object.keys(DIFFICULTY).sort()).toEqual(['easy', 'hard', 'normal']);
  });

  it('addSeat accepts a per-seat difficulty override', async () => {
    const sim = new Sim({ seed: 3 });
    await sim.init();
    sim.addSeat({ slot: 0, name: 'E', isBot: true, difficulty: 'easy' });
    sim.addSeat({ slot: 1, name: 'B', isBot: true, difficulty: 'brutal' });
    expect(sim.bots[0].level).toBe('easy');
    expect(sim.bots[1].level).toBe('brutal');
  });

  it('an unknown difficulty falls back to normal', () => {
    const rng = new RngStreams(1).stream('bot0');
    const bot = new Bot({ slot: 0, difficulty: '??', rng });
    expect(bot.p).toEqual(DIFFICULTY.normal);
  });
});

describe('crowd hype', () => {
  it('KOs swell the hype and cross levels with events', () => {
    const c = new Crowd();
    const seen = [];
    for (let i = 0; i < 2; i++) {
      const ev = c.notice('ko', { b: 2, kind: 'side' });
      if (ev) seen.push(ev);
    }
    expect(c.hype).toBe(24);
    expect(seen.length).toBe(1);
    expect(seen[0].type).toBe('hype');
    expect(seen[0].fields.mag).toBe(1);
    expect(seen[0].fields.kind).toBe('buzz');
  });

  it('a self-KO deflates the room', () => {
    const c = new Crowd();
    c.notice('ko', { b: 2, kind: 'side' });
    c.notice('ko', { b: 0, kind: 'splash' });
    expect(c.hype).toBe(6);
  });

  it('hype decays every tick and survives a snapshot', () => {
    const c = new Crowd();
    c.notice('explosion', {});
    c.notice('explosion', {});
    const before = c.hype;
    for (let t = 0; t < 60; t++) c.step();
    expect(c.hype).toBeLessThan(before);
    const snap = c.snapshot();
    const c2 = new Crowd().restore(snap);
    expect(c2.hype).toBe(c.hype);
    expect(c2.level).toBe(c.level);
  });

  it('big moments emitted through the real api path swell the crowd', async () => {
    const sim = await makeSim([false, false]);
    const api = sim._api();
    api.emit('ko', { a: 1, b: 2, kind: 'side' });   // +12
    api.emit('ko', { a: 2, b: 1, kind: 'top' });    // +16 -> crosses 20
    const evs = sim.drainEvents();
    const hype = evs.filter(e => e.type === 'hype');
    expect(hype.length).toBe(1);
    expect(hype[0].mag).toBe(1);
    expect(hype[0].kind).toBe('buzz');
    expect(sim.crowd.hype).toBe(28);
  });
});

describe('match awards (the podium)', () => {
  it('results carry mvp, yeet and showman awards for real dweebs', async () => {
    const sim = await makeSim([true, true], {
      roundsToWin: 1, roundTime: 12, stocks: 1, difficulty: 'hard',
    });
    const evs = stepCollect(sim, 4000);
    expect(sim.match.phase).toBe('results');
    const awards = evs.filter(e => e.type === 'award');
    const byKind = Object.fromEntries(awards.map(e => [e.kind, e]));
    expect(byKind.mvp).toBeTruthy();
    expect(byKind.showman).toBeTruthy();
    const ids = new Set(sim.dweebs.map(d => d.id));
    for (const a of awards) expect(ids.has(a.a)).toBe(true);
  });
});

describe('tournament bracket', () => {
  it('four entrants play semis and a final, and it is deterministic', async () => {
    const entrants = [
      { name: 'A', difficulty: 'brutal' }, { name: 'B', difficulty: 'easy' },
      { name: 'C', difficulty: 'normal' }, { name: 'D', difficulty: 'hard' },
    ];
    const opts = { entrants, seed: 5, roundsToWin: 1, roundTime: 10, maxTicks: 12000 };
    const t1 = await runTournament(opts);
    const t2 = await runTournament(opts);
    expect(t1.champion.name).toBe(t2.champion.name);
    expect(t1.rounds.length).toBe(2);
    expect(t1.rounds[0].matches.length).toBe(2);
    expect(t1.rounds[1].matches.length).toBe(1);
    for (const r of t1.rounds) for (const m of r.matches) {
      expect(m.winner).toBeTruthy();
      expect(m.ticks).toBeLessThanOrEqual(12000);
    }
  }, 30000);

  it('odd brackets grant byes', async () => {
    const t = await runTournament({
      entrants: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 9, roundsToWin: 1, roundTime: 10, maxTicks: 12000,
    });
    expect(t.champion.name).toBeTruthy();
    expect(t.rounds[0].matches.some(m => m.bye)).toBe(true);
  }, 30000);
});

describe('snapshot/restore under arena mechanics', () => {
  it('a gale match restored mid-gust resumes bit-identically', async () => {
    const mk = async () => {
      const sim = await makeSim([true, true], { arena: 'gale', seed: 77 });
      return sim;
    };
    const a = await mk();
    for (let t = 0; t < 700; t++) a.step();
    const snap = a.snapshot();
    const b = await mk();
    b.restore(snap);
    expect(b.checksum()).toBe(a.checksum());
    for (let t = 0; t < 600; t++) { a.step(); b.step(); }
    expect(b.checksum()).toBe(a.checksum());
  });
});

describe('announcer: new lines', () => {
  it('hype, award, victory and intro lines render with names filled', () => {
    expect(hypeLine(4)).toMatch(/PANDEMONIUM|LOUDEST|LOST ITS MIND/);
    expect(awardLine('mvp', '<b>A</b>', 7)).toContain('<b>A</b>');
    expect(awardLine('mvp', 'A', 7)).toContain('7');
    expect(awardLine('yeet', 'A', 21.5)).toContain('21.5');
    expect(victoryLine('Zed')).toContain('Zed');
    expect(introLine('Storm Spire', 'Hold the centre!')).toContain('Storm Spire');
  });
});

describe('arena determinism across modes', () => {
  it('every arena and mode checksums identically across two runs', async () => {
    async function checksum(cfg) {
      const sim = await makeSim([true, true], { seed: 99, ...cfg });
      for (let t = 0; t < 700; t++) sim.step();
      return sim.checksum();
    }
    for (const cfg of [
      { arena: 'stormspire' }, { arena: 'quicksand' }, { arena: 'magnetcore' },
      { arena: 'volcano' }, { arena: 'gale' }, { arena: 'moon' },
      { arena: 'iceberg' }, { arena: 'pinball' },
      { mode: 'hill', hillTarget: 30 }, { mode: 'teams', teams: [[0], [1]] },
      { mode: 'sudden', stocks: 1 },
    ]) {
      expect(await checksum(cfg), JSON.stringify(cfg)).toBe(await checksum(cfg));
    }
  }, 60000);
});

// ─── Live engine parity: game/Match.js mirrors the sim's modes ───

/** Minimal live-dweeb double: what Match.update/_ko actually touch. */
function liveDweeb(x = 0, z = 0, y = 0.5) {
  return {
    stocks: 3, kos: 0, falls: 0, damageDealt: 0, totalKos: 0, totalFalls: 0,
    trickshots: 0, maxAir: 0, stylePeak: 0, koedBy: null, percent: 0,
    eliminated: false, out: false, isPlayer: false, team: 0, hillScore: 0,
    respawnTimer: 0, swimFlail: 0, flailUsed: true, lastHitBy: null, lastHitTime: -99,
    _x: x, _z: z, _y: y,
    getPosition() { return { x: this._x, y: this._y, z: this._z }; },
    knockOut(t) { this.out = true; this.respawnTimer = t; },
    eliminate() { this.eliminated = true; },
    startFlail() {},
  };
}

function liveMatch(mode, n = 2, events = {}) {
  const m = new Match();
  m.settings.mode = mode;
  m.settings.roundsToWin = 1;
  m.events = events;
  const dweebs = Array.from({ length: n }, () => liveDweeb());
  m.startMatch(dweebs);
  m.beginRound();
  m.phase = 'playing'; // skip the countdown for unit tests
  return { m, dweebs };
}

describe('live Match.js mode parity', () => {
  it('hill: the sole holder scores and takes the round at target', () => {
    const seen = [];
    const { m, dweebs } = liveMatch('hill', 2, {
      onHillHold: h => seen.push(['hold', h]), onHillScore: (h, s) => seen.push(['score', s]),
    });
    dweebs[0]._x = 0; dweebs[0]._z = 0;
    dweebs[1]._x = 12; dweebs[1]._z = 0;
    for (let t = 0; t < 70 * 60; t++) m.update(1 / 60); // 60 s to target + 4 s round-end
    expect(dweebs[0].hillScore).toBeGreaterThan(55);
    expect(seen.some(s => s[0] === 'score' && s[1] >= 10)).toBe(true);
    expect(m.phase).toBe('results');
    expect(m.matchWinner).toBe(dweebs[0]);
  });

  it('hill: a KO costs no stock', () => {
    const { m, dweebs } = liveMatch('hill');
    m._ko(dweebs[0], 'side', { x: 40, y: 0, z: 0 });
    expect(dweebs[0].stocks).toBe(3);
    expect(dweebs[0].out).toBe(true);
    expect(dweebs[0].eliminated).toBe(false);
  });

  it('teams: wiping a team ends the round', () => {
    const { m, dweebs } = liveMatch('teams', 4);
    dweebs[0].team = 0; dweebs[1].team = 1; dweebs[2].team = 0; dweebs[3].team = 1;
    dweebs[1].eliminate();
    dweebs[3].eliminate();
    m.update(1 / 60);
    expect(m.phase).toBe('roundEnd');
  });

  it('sudden: the arena is closing in from GO', () => {
    const { m } = liveMatch('sudden');
    expect(m.suddenDeath).toBe(true);
    expect(m.blastSide).toBeLessThan(34);
  });

  it('brawl is untouched: a KO still costs a stock', () => {
    const { m, dweebs } = liveMatch('brawl');
    m._ko(dweebs[0], 'side', { x: 40, y: 0, z: 0 });
    expect(dweebs[0].stocks).toBe(2);
  });
});
