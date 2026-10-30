// Dweeb Warfare wave 2: retaliation, stance inheritance, supply boost, aimable artillery,
// map layouts, hash hardening, AI commander powers, wave preview. All headless sim.
import { describe, it, expect } from 'vitest';
import {
  createBattle, stepBattle, spawnUnit, applyCommand, battleHash,
  MAP_LAYOUTS, STANCE_SPEED, SUPPLY_BOOST_TICKS, ARTILLERY_FORT_FRAC,
} from '../src/sim/warfareBattle.js';
import { commanderTurn, createCommanderBrain, SUP_EVERY, ART_EVERY, STANCE_EVERY } from '../src/warfare/WarfareCommander.js';
import { wavePreview } from '../src/warfare/WarfareHud.js';

const arena = (seed = 42) => {
  const st = createBattle({ seed, mode: 'versus', army: false, coins: 0 });
  st.income = 0;
  st.forts.blue.invulnerable = true;
  st.forts.red.invulnerable = true;
  return st;
};

describe('retaliation (dead-zone standoff fix)', () => {
  it('a unit plinked from outside its aggro answers the attacker', () => {
    const st = arena();
    const shield = spawnUnit(st, 'blue', 'shield', { x: -16, z: 0 }); // 16 m: rocket range 19, shield aggro 14
    const rocket = spawnUnit(st, 'red', 'rocket', { x: 0, z: 0 });
    stepBattle(st);
    expect(shield.targetId).toBe(0);
    for (let i = 0; i < 400 && shield.targetId !== rocket.id; i++) stepBattle(st);
    expect(shield.targetId).toBe(rocket.id);
  });
  it('the standoff resolves instead of softlocking: the defender closes in and wins', () => {
    const st = createBattle({ seed: 7, mode: 'versus', army: false, coins: 0 });
    st.income = 0;
    spawnUnit(st, 'blue', 'shield', { x: -16, z: 0 });
    const rocket = spawnUnit(st, 'red', 'rocket', { x: 0, z: 0 });
    for (let i = 0; i < 30 * 300 && !st.winner; i++) stepBattle(st);
    expect(st.winner).toBe('blue');
    expect(rocket.alive).toBe(false);
  });
  it('splash victims retaliate against the shell owner', () => {
    const st = arena();
    const victim = spawnUnit(st, 'blue', 'stealer', { x: -16, z: 0 });
    const rocket = spawnUnit(st, 'red', 'rocket', { x: 0, z: 0 });
    for (let i = 0; i < 400 && victim.targetId !== rocket.id; i++) stepBattle(st);
    expect(victim.targetId).toBe(rocket.id);
  });
});

describe('stances and supply', () => {
  it('recruits inherit the team stance speed', () => {
    const st = createBattle({ seed: 1, coins: 200 });
    applyCommand(st, { type: 'stance', team: 'blue', stance: 'defense' });
    expect(applyCommand(st, { type: 'recruit', team: 'blue', unit: 'shield' })).toBe(true);
    const u = st.units[st.units.length - 1];
    expect(u.speedMul).toBe(STANCE_SPEED.defense);
    expect(STANCE_SPEED.defense).toBeLessThan(1);
    applyCommand(st, { type: 'stance', team: 'blue', stance: 'charge' });
    applyCommand(st, { type: 'recruit', team: 'blue', unit: 'rocket' });
    expect(st.units[st.units.length - 1].speedMul).toBe(STANCE_SPEED.charge);
  });
  it('stance junk normalizes to charge and never poisons speedMul', () => {
    const st = createBattle({ seed: 1, coins: 200 });
    applyCommand(st, { type: 'stance', team: 'blue', stance: 'whatever' });
    expect(st.stance.blue).toBe('charge');
    for (const u of st.units) expect(u.speedMul).toBe(STANCE_SPEED.charge);
  });
  it('supply is a 10 s boost that decays without clobbering the stance', () => {
    const st = createBattle({ seed: 1, coins: 200 });
    applyCommand(st, { type: 'stance', team: 'blue', stance: 'defense' });
    const u = spawnUnit(st, 'blue', 'shield', { x: -20, z: 0 });
    u.hp = u.maxHp * 0.5;
    expect(applyCommand(st, { type: 'supply', team: 'blue' })).toBe(true);
    expect(u.speedMul).toBe(STANCE_SPEED.defense);
    expect(u.boostMul).toBe(1.35);
    expect(u.hp).toBeGreaterThan(u.maxHp * 0.5);
    for (let i = 0; i < SUPPLY_BOOST_TICKS + 5; i++) stepBattle(st);
    expect(u.boostMul).toBe(1);
    expect(u.speedMul).toBe(STANCE_SPEED.defense);
  });
});

describe('artillery', () => {
  it('cracks the enemy fort inside the blast', () => {
    const st = createBattle({ seed: 1, mode: 'versus', army: false, coins: 100 });
    const before = st.forts.red.hp;
    expect(applyCommand(st, { type: 'artillery', team: 'blue', x: 36, z: 0 })).toBe(true);
    expect(st.coins.blue).toBe(75);
    expect(st.forts.red.hp).toBeLessThan(before);
    expect(before - st.forts.red.hp).toBeCloseTo(160 * ARTILLERY_FORT_FRAC * 0.6, 6);
  });
  it('never touches the firing side', () => {
    const st = createBattle({ seed: 1, mode: 'versus', army: false, coins: 100 });
    const mine = spawnUnit(st, 'blue', 'shield', { x: 30, z: 0 });
    const foe = spawnUnit(st, 'red', 'shield', { x: 33, z: 0 });
    const myHp = mine.hp;
    applyCommand(st, { type: 'artillery', team: 'blue', x: 33, z: 0 });
    expect(mine.hp).toBe(myHp);
    expect(foe.hp).toBeLessThan(foe.maxHp);
  });
});

describe('map layouts', () => {
  it('seeds pick different symmetric layouts inside the field', () => {
    const names = new Set();
    for (let s = 1; s <= 24; s++) names.add(createBattle({ seed: s, map: 'random' }).mapName);
    expect(names.size).toBeGreaterThan(1);
    for (const m of MAP_LAYOUTS) {
      for (const b of m.barricades) {
        expect(Math.abs(b.x)).toBeLessThan(40);
        expect(Math.abs(b.z)).toBeLessThan(22);
        // 180° rotational symmetry: fair for both sides
        expect(m.barricades.some(o => o.x === -b.x && o.z === -b.z)).toBe(true);
      }
    }
  });
  it('units still slide around barricades on every layout', () => {
    for (const m of MAP_LAYOUTS) {
      if (!m.barricades.length) continue;
      const st = createBattle({ seed: 3 });
      st.barricades = m.barricades;
      const b = m.barricades[0];
      const u = spawnUnit(st, 'blue', 'shield', { x: b.x, z: b.z });
      stepBattle(st);
      expect(Math.hypot(u.x - b.x, u.z - b.z)).toBeGreaterThanOrEqual(b.r + u.radius - 1e-6);
    }
  });
  it('is deterministic: same seed, same map', () => {
    expect(createBattle({ seed: 9, map: 'random' }).mapName).toBe(createBattle({ seed: 9, map: 'random' }).mapName);
    expect(createBattle({ seed: 9, map: 'GAUNTLET' }).mapName).toBe('GAUNTLET');
    expect(createBattle({ seed: 9 }).mapName).toBe('CROSSROADS'); // the classic default
  });
});

describe('barricade slide (head-on equilibrium fix)', () => {
  it('a unit marching straight into a barricade slides around it instead of sticking forever', () => {
    // defense: red units march straight at the blue fort, down the z=0 centre line
    const st = createBattle({ seed: 13, mode: 'defense', army: false, coins: 0 });
    st.barricades = Object.freeze([{ x: 16, z: 0, r: 1.6 }]);
    const brute = spawnUnit(st, 'red', 'brute', { x: 19.2, z: 0 });
    for (let i = 0; i < 30 * 120 && brute.x > 12; i++) stepBattle(st);
    expect(brute.x).toBeLessThanOrEqual(12);
  });
  it('units never rest inside a barricade circle', () => {
    const st = createBattle({ seed: 21 });
    for (let i = 0; i < 30 * 120 && !st.winner; i++) stepBattle(st);
    for (const u of st.units) {
      for (const b of st.barricades) {
        expect(Math.hypot(u.x - b.x, u.z - b.z)).toBeGreaterThanOrEqual(b.r + u.radius - 1e-6);
      }
    }
  });
});

describe('battleHash hardening', () => {
  it('sees stance and rally changes, not just unit state', () => {
    const a = createBattle({ seed: 5, mode: 'versus' });
    const b = createBattle({ seed: 5, mode: 'versus' });
    expect(battleHash(a)).toBe(battleHash(b));
    applyCommand(b, { type: 'stance', team: 'blue', stance: 'defense' });
    expect(battleHash(b)).not.toBe(battleHash(a));
    applyCommand(a, { type: 'stance', team: 'blue', stance: 'defense' });
    expect(battleHash(a)).toBe(battleHash(b));
    applyCommand(b, { type: 'rally', team: 'red', x: 10, z: 5 });
    expect(battleHash(b)).not.toBe(battleHash(a));
  });
});

describe('AI commander powers', () => {
  const hurtArmy = (seed = 9) => {
    const st = createBattle({ seed, mode: 'versus', army: false, coins: 500 });
    st.income = 0;
    for (let i = 0; i < 5; i++) {
      const u = spawnUnit(st, 'blue', 'shield', { x: -10, z: i * 2 });
      u.hp = u.maxHp * 0.4;
    }
    return st;
  };
  it('drops supply when the army is bleeding', () => {
    const st = hurtArmy();
    st.tick = SUP_EVERY + 1;
    const cmds = commanderTurn(st, createCommanderBrain(), 'blue');
    expect(cmds.some(c => c.type === 'supply')).toBe(true);
  });
  it('shells dense enemy clumps, rounded to 1 dp', () => {
    const st = createBattle({ seed: 9, mode: 'versus', army: false, coins: 500 });
    st.income = 0;
    spawnUnit(st, 'red', 'shield', { x: 20, z: 0 });
    for (let i = 0; i < 4; i++) spawnUnit(st, 'blue', 'shield', { x: 10.37, z: i * 1.1 });
    st.tick = ART_EVERY + 1;
    const cmds = commanderTurn(st, createCommanderBrain(), 'red');
    const art = cmds.find(c => c.type === 'artillery');
    expect(art).toBeTruthy();
    expect(art.x).toBe(10.4);
    expect(art.z).toBe(0); // densest clump centres on the lowest-id unit of the tied pack
  });
  it('shifts stance with the battle plan and rate-limits powers', () => {
    const st = hurtArmy();
    st.tick = STANCE_EVERY + 1;
    const brain = createCommanderBrain();
    const cmds = commanderTurn(st, brain, 'blue');
    expect(cmds.filter(c => c.type === 'supply').length).toBeLessThanOrEqual(1);
    expect(cmds.filter(c => c.type === 'stance').length).toBeLessThanOrEqual(1);
    const stance = cmds.find(c => c.type === 'stance');
    expect(stance.stance).toBe('charge'); // 150 cost vs 0: the push is on
    // second call on the same tick issues no duplicate powers
    const again = commanderTurn(st, brain, 'blue');
    expect(again.some(c => c.type === 'supply')).toBe(false);
  });
  it('is deterministic: same state ⇒ same commands', () => {
    const mk = () => {
      const st = hurtArmy(11);
      for (let i = 0; i < 3; i++) spawnUnit(st, 'red', 'rocket', { x: 12, z: i });
      st.tick = 1300;
      return st;
    };
    const a = commanderTurn(mk(), createCommanderBrain(), 'blue');
    const b = commanderTurn(mk(), createCommanderBrain(), 'blue');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('a full battle with AI powers stays deterministic and terminates', () => {
    const run = () => {
      const st = createBattle({ seed: 11 });
      const brain = createCommanderBrain();
      const mix = ['shield', 'rocket', 'shield', 'kami', 'rocket', 'stealer'];
      let k = 0;
      for (let i = 0; i < 30 * 1200 && !st.winner; i++) {
        const c = [];
        if (st.tick % 30 === 0 && st.coins.blue >= 40) c.push({ type: 'recruit', team: 'blue', unit: mix[k++ % mix.length] });
        if (st.phase === 'prep' && st.coins.blue < 40) c.push({ type: 'startWave' });
        c.push(...commanderTurn(st, brain, 'blue'));
        stepBattle(st, c);
      }
      return { hash: battleHash(st), winner: st.winner, tick: st.tick };
    };
    const r1 = run(), r2 = run();
    expect(r1.hash).toBe(r2.hash);
    expect(r1.winner).toBeTruthy();
  });
});

describe('wave preview', () => {
  it('lists the next wave composition, flagging bosses', () => {
    const p1 = wavePreview(1);
    expect(p1).toMatch(/×\d/);
    expect(wavePreview(5)).toContain('BOSS');
    expect(wavePreview(5)).toContain('⚙️');
    expect(wavePreview(1)).not.toContain('BOSS');
  });
});
