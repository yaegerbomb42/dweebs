// Dweeb Warfare wave 3 (content drop): new battlegrounds, commander powers (war horn,
// fortify, spike pit), AI personalities, campaign with persistent veterans. All headless sim.
import { describe, it, expect } from 'vitest';
import {
  createBattle, stepBattle, spawnUnit, applyCommand, battleHash,
  MAP_LAYOUTS, AI_PERSONALITIES,
  WARHORN_COST, WARHORN_TICKS, WARHORN_DMG_MUL,
  REPAIR_COST, REPAIR_AMOUNT, TRAP_COST, TRAP_RADIUS, TRAP_TICKS, TRAP_DPS, MAX_TRAPS,
  VETERAN_HP_MUL, MAX_VETERANS,
} from '../src/sim/warfareBattle.js';
import {
  commanderTurn, createCommanderBrain, PERSONALITIES, personalityOf,
} from '../src/warfare/WarfareCommander.js';
import {
  CAMPAIGN, missionById, validateMission, blankProgress, recordWin, missionStars, collectVeterans,
} from '../src/warfare/WarfareCampaign.js';

const arena = (seed = 42) => {
  const st = createBattle({ seed, mode: 'versus', army: false, coins: 0, personality: 'tactician' });
  st.income = 0;
  st.incomeRed = 0;
  st.forts.blue.invulnerable = true;
  st.forts.red.invulnerable = true;
  return st;
};

describe('new battlegrounds', () => {
  it('there are 6 layouts with unique names, all symmetric and inside the field', () => {
    expect(MAP_LAYOUTS.length).toBe(6);
    const names = MAP_LAYOUTS.map(m => m.name);
    expect(new Set(names).size).toBe(6);
    expect(names[0]).toBe('CROSSROADS'); // the tuned default stays first
    for (const m of MAP_LAYOUTS) {
      for (const b of m.barricades) {
        expect(Math.abs(b.x)).toBeLessThan(40);
        expect(Math.abs(b.z)).toBeLessThan(22);
        expect(m.barricades.some(o => o.x === -b.x && o.z === -b.z), `${m.name} symmetric`).toBe(true);
      }
    }
  });
  it('random seeds spread across all six maps', () => {
    const names = new Set();
    for (let s = 1; s <= 60; s++) names.add(createBattle({ seed: s, map: 'random' }).mapName);
    expect(names.size).toBe(6);
  });
  it('units slide around barricades on the new layouts', () => {
    for (const m of ['CORNERS', 'CANYON', 'ISLETS']) {
      const st = createBattle({ seed: 3, map: m, army: false });
      const b = st.barricades[0];
      const u = spawnUnit(st, 'blue', 'shield', { x: b.x, z: b.z });
      for (let i = 0; i < 90; i++) stepBattle(st);
      const d = Math.hypot(u.x - b.x, u.z - b.z);
      expect(d, m).toBeGreaterThanOrEqual(b.r + u.radius - 0.01);
    }
  });
});

describe('war horn', () => {
  it('buffs the whole army: rage ticks, +20% speed, costs coins, emits an event', () => {
    const st = createBattle({ seed: 1, coins: 200, personality: 'tactician' });
    const before = st.units.filter(u => u.team === 'blue').length;
    expect(before).toBeGreaterThan(0);
    expect(applyCommand(st, { type: 'warhorn', team: 'blue' })).toBe(true);
    expect(st.coins.blue).toBe(200 - WARHORN_COST);
    for (const u of st.units) {
      if (u.team !== 'blue' || !u.alive) continue;
      expect(u.rageT).toBe(WARHORN_TICKS);
      expect(u.boostMul).toBeGreaterThanOrEqual(1.2);
    }
    expect(st.events.map(e => e.type)).toContain('warhorn');
  });
  it('the rage bonus actually lands harder: a horned duel out-damages the control', () => {
    const duel = horned => {
      const st = arena(9);
      st.coins.blue = 100;
      const a = spawnUnit(st, 'blue', 'shield', { x: -2, z: 0 });
      const d = spawnUnit(st, 'red', 'shield', { x: 2, z: 0 });
      a.cd = 0;
      if (horned) applyCommand(st, { type: 'warhorn', team: 'blue' });
      for (let i = 0; i < 200; i++) stepBattle(st);
      return d.hp;
    };
    const plain = duel(false), horned = duel(true);
    expect(horned).toBeLessThan(plain);
    // and the multiplier is exactly the documented one on a single melee hit
    expect(WARHORN_DMG_MUL).toBe(1.3);
  });
  it('rage decays after WARHORN_TICKS and the speed boost falls back', () => {
    const st = arena(5);
    st.coins.blue = 100;
    st.coins.red = 100; // keep the versus battle alive while the horn burns down
    const u = spawnUnit(st, 'blue', 'shield', { x: -20, z: 0 });
    applyCommand(st, { type: 'warhorn', team: 'blue' });
    expect(u.rageT).toBe(WARHORN_TICKS);
    for (let i = 0; i < WARHORN_TICKS + 5; i++) stepBattle(st);
    expect(u.rageT).toBe(0);
    expect(u.boostMul).toBe(1);
  });
  it('refuses when broke or when there is no army (no charge either way)', () => {
    const st = createBattle({ seed: 1, coins: 5, personality: 'tactician' });
    expect(applyCommand(st, { type: 'warhorn', team: 'blue' })).toBe(false);
    expect(st.coins.blue).toBe(5);
    const empty = arena(6);
    empty.coins.blue = 500;
    expect(applyCommand(empty, { type: 'warhorn', team: 'blue' })).toBe(false);
    expect(empty.coins.blue).toBe(500);
  });
});

describe('fortify (repair)', () => {
  it('patches the fort, capped at max HP, for coins', () => {
    const st = createBattle({ seed: 1, mode: 'versus', army: false, coins: 100, personality: 'tactician' });
    st.forts.blue.hp = 500;
    expect(applyCommand(st, { type: 'repair', team: 'blue' })).toBe(true);
    expect(st.forts.blue.hp).toBe(500 + REPAIR_AMOUNT);
    expect(st.coins.blue).toBe(100 - REPAIR_COST);
    expect(st.events.map(e => e.type)).toContain('repair');
    st.forts.blue.hp = st.forts.blue.maxHp - 10;
    applyCommand(st, { type: 'repair', team: 'blue' });
    expect(st.forts.blue.hp).toBe(st.forts.blue.maxHp);
  });
  it('refuses a full fort, an invulnerable fort, or an empty purse', () => {
    const st = createBattle({ seed: 1, mode: 'versus', army: false, coins: 100, personality: 'tactician' });
    expect(applyCommand(st, { type: 'repair', team: 'blue' })).toBe(false);
    expect(st.coins.blue).toBe(100);
    st.forts.blue.hp = 100;
    st.coins.blue = 5;
    expect(applyCommand(st, { type: 'repair', team: 'blue' })).toBe(false);
    expect(st.coins.blue).toBe(5);
    const def = createBattle({ seed: 1, coins: 500, personality: 'tactician' });
    def.forts.red.hp = 100; // red fort is invulnerable in defense
    expect(applyCommand(def, { type: 'repair', team: 'red' })).toBe(false);
  });
});

describe('spike pit', () => {
  it('buries a pit that shreds enemies, spares friends, and collapses on time', () => {
    const st = arena(11);
    st.coins.blue = 100;
    st.coins.red = 100; // the battle must outlive the pit's victim
    const foe = spawnUnit(st, 'red', 'shield', { x: 5, z: 0 });
    foe.hp = foe.maxHp;
    foe.speedMul = 0; // hold still inside the pit; no enemies to chase
    expect(applyCommand(st, { type: 'trap', team: 'blue', x: 5, z: 0 })).toBe(true);
    expect(st.coins.blue).toBe(100 - TRAP_COST);
    expect(st.traps.length).toBe(1);
    expect(st.traps[0].r).toBe(TRAP_RADIUS);
    expect(st.events.map(e => e.type)).toContain('trap');
    const foeHp = foe.hp;
    for (let i = 0; i < 120; i++) stepBattle(st);
    expect(foe.hp).toBeLessThan(foeHp - TRAP_DPS * 2); // ~4 s inside ≈ 4 s of dps
    for (let i = 0; i < TRAP_TICKS; i++) stepBattle(st);
    expect(st.traps.length).toBe(0);
  });
  it('friendlies walk over their own pits unharmed', () => {
    const st = arena(15);
    st.coins.blue = 100;
    st.coins.red = 100;
    const friend = spawnUnit(st, 'blue', 'shield', { x: 5, z: 0 });
    friend.speedMul = 0; // hold still inside the pit; no enemies to fight
    applyCommand(st, { type: 'trap', team: 'blue', x: 5, z: 0 });
    const hp = friend.hp;
    for (let i = 0; i < 120; i++) stepBattle(st);
    expect(friend.hp).toBe(hp);
  });
  it('a pit can finish a unit: the kill pays bounty and ends the standoff', () => {
    const st = arena(12);
    st.coins.blue = 100;
    const foe = spawnUnit(st, 'red', 'kami', { x: 5, z: 0 });
    foe.hp = 10;
    applyCommand(st, { type: 'trap', team: 'blue', x: 5, z: 0 });
    const coinsBefore = st.coins.blue;
    for (let i = 0; i < 60 && foe.alive; i++) stepBattle(st);
    expect(foe.alive).toBe(false);
    expect(st.coins.blue).toBeGreaterThan(coinsBefore); // bounty paid
  });
  it('caps pits per team and clamps coordinates', () => {
    const st = arena(13);
    st.coins.blue = 10000;
    for (let i = 0; i < MAX_TRAPS; i++) {
      expect(applyCommand(st, { type: 'trap', team: 'blue', x: i, z: 0 })).toBe(true);
    }
    expect(applyCommand(st, { type: 'trap', team: 'blue', x: 99, z: 0 })).toBe(false);
    st.coins.red = 10000;
    expect(applyCommand(st, { type: 'trap', team: 'red', x: 999, z: -999 })).toBe(true);
    const t = st.traps[st.traps.length - 1];
    expect(Math.abs(t.x)).toBeLessThanOrEqual(40);
    expect(Math.abs(t.z)).toBeLessThanOrEqual(22);
  });
  it('trap commands survive a JSON round trip (lockstep-safe)', () => {
    const st = arena(14);
    st.coins.blue = 100;
    const cmds = JSON.parse(JSON.stringify([{ type: 'trap', team: 'blue', x: 1.5, z: -2.5 }]));
    stepBattle(st, cmds);
    expect(st.traps.length).toBe(1);
    expect(st.traps[0].x).toBe(1.5);
  });
});

describe('battle hash covers the new state', () => {
  it('traps and rage change the hash; identical scripts hash identically', () => {
    const script = st => {
      const cmds = [];
      if (st.tick === 10) cmds.push({ type: 'warhorn', team: 'blue' });
      if (st.tick === 20) cmds.push({ type: 'trap', team: 'blue', x: 4, z: -3 });
      if (st.tick === 30) cmds.push({ type: 'repair', team: 'blue' });
      return JSON.parse(JSON.stringify(cmds));
    };
    const run = withTrap => {
      const st = createBattle({ seed: 77, mode: 'versus', coins: 500, personality: 'tactician' });
      for (let i = 0; i < 300; i++) {
        const c = script(st).filter(c => withTrap || c.type !== 'trap');
        stepBattle(st, c);
      }
      return battleHash(st);
    };
    const h1 = run(true), h2 = run(true), h3 = run(false);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('AI personalities', () => {
  it('every AI_PERSONALITIES key has a defined personality', () => {
    for (const k of AI_PERSONALITIES) {
      const p = PERSONALITIES[k];
      expect(p, k).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.desc).toBeTruthy();
    }
    expect(personalityOf('nope')).toBe(PERSONALITIES.tactician);
  });
  it('seed-drawn personalities agree across identical battles; explicit ones are respected', () => {
    const a = createBattle({ seed: 5, mode: 'versus' });
    const b = createBattle({ seed: 5, mode: 'versus' });
    expect(a.aiPersonality).toEqual(b.aiPersonality);
    const c = createBattle({ seed: 5, mode: 'versus', personality: 'turtle' });
    expect(c.aiPersonality.red).toBe('turtle');
    const d = createBattle({ seed: 5, mode: 'versus', personality: { blue: 'brawler', red: 'trickster' } });
    expect(d.aiPersonality).toEqual({ blue: 'brawler', red: 'trickster' });
  });
  const biased = (personality, tick = 52) => {
    const st = arena(21);
    st.tick = tick;
    st.coins.red = 500;
    for (let i = 0; i < 3; i++) spawnUnit(st, 'blue', 'rocket', { x: -10 - i * 3, z: (i - 1) * 8 });
    for (let i = 0; i < 2; i++) spawnUnit(st, 'red', 'shield', { x: 10 + i * 3, z: (i - 1) * 5 });
    const brain = createCommanderBrain();
    return commanderTurn(st, brain, 'red', personality);
  };
  it('brawler buys kamis and charges; turtle buys shields and turtles', () => {
    const bCmds = biased('brawler');
    expect(bCmds.find(c => c.type === 'recruit')?.unit).toBe('kami');
    expect(bCmds.find(c => c.type === 'stance')?.stance).toBe('charge');
    const tCmds = biased('turtle');
    expect(tCmds.find(c => c.type === 'recruit')?.unit).toBe('shield');
    expect(tCmds.find(c => c.type === 'stance')?.stance).toBe('defense');
  });
  it('tactician keeps commanderDecide counter-picks (shield beats rocket)', () => {
    const cmds = biased('tactician');
    expect(cmds.find(c => c.type === 'recruit')?.unit).toBe('shield');
  });
  it('brawler rushes the rally forward earlier than turtle', () => {
    // red 4 shields (120) vs blue 3 rockets (120): brawler attacks (120 > 108), turtle holds (120 < 204)
    const setup = personality => {
      const st = arena(21);
      st.tick = 52;
      st.coins.red = 500;
      for (let i = 0; i < 3; i++) spawnUnit(st, 'blue', 'rocket', { x: -10 - i * 3, z: (i - 1) * 8 });
      for (let i = 0; i < 4; i++) spawnUnit(st, 'red', 'shield', { x: 10 + i * 3, z: (i - 1) * 5 });
      return commanderTurn(st, createCommanderBrain(), 'red', personality).find(c => c.type === 'rally')?.x;
    };
    expect(setup('brawler')).toBeLessThan(setup('turtle')); // red attacks toward -x: further forward = smaller x
  });
  it('turtle repairs a scuffed fort; a brawler lets it burn', () => {
    const st = arena(22);
    st.tick = 52;
    st.coins.red = 500;
    st.forts.red.invulnerable = false;
    st.forts.red.hp = st.forts.red.maxHp * 0.7;
    spawnUnit(st, 'blue', 'shield', { x: -10, z: 0 });
    spawnUnit(st, 'red', 'shield', { x: 10, z: 0 });
    const tCmds = commanderTurn(st, createCommanderBrain(), 'red', 'turtle');
    expect(tCmds.some(c => c.type === 'repair')).toBe(true);
    const bCmds = commanderTurn(st, createCommanderBrain(), 'red', 'brawler');
    expect(bCmds.some(c => c.type === 'repair')).toBe(false);
  });
  it('trickster seeds spike pits on clumps', () => {
    const st = arena(23);
    st.tick = 52;
    st.coins.red = 500;
    for (let i = 0; i < 4; i++) spawnUnit(st, 'blue', 'shield', { x: -10 + (i % 2), z: (i - 1.5) * 1.5 });
    spawnUnit(st, 'red', 'shield', { x: 10, z: 0 });
    const cmds = commanderTurn(st, createCommanderBrain(), 'red', 'trickster');
    const trap = cmds.find(c => c.type === 'trap');
    expect(trap).toBeTruthy();
    expect(Math.abs(trap.x - -10)).toBeLessThan(3);
    const t2 = commanderTurn(st, createCommanderBrain(), 'red', 'tactician');
    expect(t2.some(c => c.type === 'trap')).toBe(false);
  });
  it('personality turns are deterministic', () => {
    const run = () => {
      const st = arena(24);
      st.tick = 52;
      st.coins.red = 500;
      for (let i = 0; i < 3; i++) spawnUnit(st, 'blue', 'rocket', { x: -10 - i * 3, z: 0 });
      spawnUnit(st, 'red', 'shield', { x: 10, z: 0 });
      return commanderTurn(st, createCommanderBrain(), 'red', 'brawler');
    };
    expect(run()).toEqual(run());
  });
});

describe('campaign', () => {
  it('all six missions validate cleanly with unique ids', () => {
    expect(CAMPAIGN.length).toBe(6);
    const ids = CAMPAIGN.map(m => m.id);
    expect(new Set(ids).size).toBe(6);
    for (const m of CAMPAIGN) expect(validateMission(m)).toEqual([]);
    expect(missionById('nope')).toBe(null);
    expect(missionById('last-stand').name).toBe('Last Stand');
  });
  it('recordWin unlocks the next mission, keeps best stars, and is pure', () => {
    const p0 = blankProgress();
    const p1 = recordWin(p0, 0, 2);
    expect(p1.unlocked).toBe(1);
    expect(p1.stars['boot-camp']).toBe(2);
    expect(p0.unlocked).toBe(0); // input untouched
    const p2 = recordWin(p1, 0, 1);
    expect(p2.stars['boot-camp']).toBe(2); // best kept
    const last = recordWin(blankProgress(), 5, 3);
    expect(last.unlocked).toBe(5);
  });
  it('missionStars rewards healthy forts and fast versus wins', () => {
    const m = missionById('boot-camp');
    const st = createBattle({ seed: 1, personality: 'tactician' });
    st.winner = 'blue';
    expect(missionStars(m, st)).toBe(3);
    st.forts.blue.hp = st.forts.blue.maxHp * 0.5;
    expect(missionStars(m, st)).toBe(2);
    st.forts.blue.hp = 1;
    expect(missionStars(m, st)).toBe(1);
    st.winner = 'red';
    expect(missionStars(m, st)).toBe(0);
    const mv = missionById('first-strike');
    const sv = createBattle({ seed: 1, mode: 'versus', personality: 'tactician' });
    sv.winner = 'blue'; sv.tick = 100 * 30;
    expect(missionStars(mv, sv)).toBe(3);
    sv.tick = 300 * 30;
    expect(missionStars(mv, sv)).toBe(2);
  });
  it('collectVeterans caps at MAX_VETERANS in id order', () => {
    const st = arena(31);
    for (let i = 0; i < 15; i++) spawnUnit(st, 'blue', 'shield', { x: -20, z: i });
    const vets = collectVeterans(st);
    expect(vets.length).toBe(MAX_VETERANS);
    expect(vets[0].type).toBe('shield');
    expect(vets[0].hpFrac).toBe(1);
  });
  it('veterans re-enlist tougher, capped, and unknown types are skipped', () => {
    const vets = [{ type: 'shield', hpFrac: 0.8 }, { type: 'nope', hpFrac: 1 }];
    const st = createBattle({ seed: 2, veterans: vets, personality: 'tactician' });
    const vet = st.units.find(u => u.veteran);
    expect(vet).toBeTruthy();
    expect(vet.maxHp).toBeCloseTo(190 * VETERAN_HP_MUL, 6);
    expect(vet.hp / vet.maxHp).toBeCloseTo(0.8, 6);
    expect(st.events.map(e => e.type)).toContain('veteran');
    const many = Array.from({ length: 30 }, () => ({ type: 'rocket', hpFrac: 1 }));
    const st2 = createBattle({ seed: 2, veterans: many, personality: 'tactician' });
    expect(st2.units.filter(u => u.veteran).length).toBe(MAX_VETERANS);
  });
  it('a short campaign mission ends after its own wave count', () => {
    const st = createBattle({ seed: 3, waves: 2, personality: 'tactician' });
    expect(st.finalWave).toBe(2);
    st.wave = 2; st.phase = 'battle'; st.spawnQueue = [];
    st.units = st.units.filter(u => u.team === 'blue');
    stepBattle(st);
    expect(st.phase).toBe('won');
  });
});

describe('content-drop soak', () => {
  const aiBattle = (seed, map, blueP = 'tactician', redP = 'brawler') => {
    const st = createBattle({ seed, mode: 'versus', map, personality: { blue: blueP, red: redP } });
    const brain = createCommanderBrain();
    const maxTicks = 30 * 240;
    for (let i = 0; i < maxTicks && !st.winner; i++) {
      stepBattle(st, [...commanderTurn(st, brain, 'blue', blueP), ...commanderTurn(st, brain, 'red', redP)]);
    }
    return st;
  };
  it('AI-vs-AI terminates on all six maps with powers flying', () => {
    const pairs = [['tactician', 'brawler'], ['turtle', 'trickster'], ['brawler', 'trickster']];
    let i = 0;
    for (const m of MAP_LAYOUTS) {
      const [bp, rp] = pairs[i++ % pairs.length];
      const st = aiBattle(100 + i, m.name, bp, rp);
      expect(st.winner, `${m.name} ${bp} vs ${rp}`).toBeTruthy();
    }
  }, 120000);
  it('a power-spam script (horns, pits, repairs) always terminates', () => {
    for (const seed of [5, 6, 7]) {
      const st = createBattle({ seed, mode: 'versus', coins: 5000, personality: { blue: 'tactician', red: 'brawler' } });
      const brain = createCommanderBrain();
      for (let i = 0; i < 30 * 240 && !st.winner; i++) {
        // AI commanders keep spending (so the versus end-condition can fire) while both
        // sides also spam the new powers every few seconds.
        const cmds = [...commanderTurn(st, brain, 'blue', 'tactician'), ...commanderTurn(st, brain, 'red', 'brawler')];
        if (i % 90 === 0) cmds.push({ type: 'warhorn', team: 'blue' }, { type: 'warhorn', team: 'red' });
        if (i % 120 === 0) cmds.push({ type: 'trap', team: 'blue', x: (i % 40) - 20, z: 0 });
        if (i % 300 === 0) cmds.push({ type: 'repair', team: 'blue' }, { type: 'repair', team: 'red' });
        stepBattle(st, JSON.parse(JSON.stringify(cmds)));
      }
      expect(st.winner, `seed ${seed}`).toBeTruthy();
    }
  }, 120000);
  it('campaign mission 1 plays to a conclusion under AI command', () => {
    const m = missionById('boot-camp');
    const st = createBattle({ seed: m.seed, mode: m.mode, difficulty: m.difficulty, map: m.map, waves: m.waves, personality: 'tactician' });
    const brain = createCommanderBrain();
    for (let i = 0; i < 30 * 900 && !st.winner; i++) {
      stepBattle(st, commanderTurn(st, brain, 'blue', 'tactician'));
    }
    expect(st.winner, 'boot camp concludes').toBeTruthy();
  }, 120000);
});
