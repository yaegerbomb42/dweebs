// warfare-upgrade.test.js — Dweeb Warfare milestone (M3) coverage:
//   1. the 5 campaign battlegrounds load with their defining features
//   2. rock-paper-scissors unit combat modifiers (deterministic)
//   3. co-op wave-defense escalation over the lockstep relay
//   4. destructible barricades + high-ground battleground mechanics
//   5. bug fix: turn-hash-tightened rejoin after a laggy disconnect
//   6. bug fix: formation toggle [R] reaches lagging/flanker units (and works online at all)
import { describe, it, expect } from 'vitest';
import {
  createBattle, stepBattle, applyCommand, battleHash, spawnUnit,
  BARRICADES, FIELD, HIGH_GROUND_MULT, STANCE_SPEED,
} from '../src/sim/warfareBattle.js';
import { counterMult, COUNTERS, UNIT_TYPES } from '../src/sim/warfareUnits.js';
import { computeDamage } from '../src/sim/warfareDamage.js';
import { waveScaling, FINAL_WAVE, DIFFICULTY } from '../src/sim/warfareWaves.js';
import { BATTLEGROUNDS, BATTLEGROUND_IDS, getBattleground } from '../src/warfare/Battlegrounds.js';
import { sanitizeCmd, WarfareLobby, TURN_LOG, TURN_TICKS } from '../server/warfare.js';

const TT = TURN_TICKS;

describe('battlegrounds', () => {
  it('ships exactly 5 battlegrounds with unique ids', () => {
    expect(BATTLEGROUNDS.length).toBe(5);
    expect(new Set(BATTLEGROUND_IDS).size).toBe(5);
    for (const b of BATTLEGROUNDS) {
      expect(b.id).toMatch(/^[a-z-]+$/);
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.blurb.length).toBeGreaterThan(0);
    }
  });

  it('every battleground has barricades inside the field, and meadow matches the legacy ring', () => {
    const meadow = getBattleground('meadow');
    expect(meadow.barricades.map(b => [b.x, b.z, b.r])).toEqual(BARRICADES.map(b => [b.x, b.z, b.r]));
    for (const b of BATTLEGROUNDS) {
      expect(b.barricades.length).toBeGreaterThan(0);
      for (const c of b.barricades) {
        expect(Math.abs(c.x)).toBeLessThanOrEqual(FIELD.halfX);
        expect(Math.abs(c.z)).toBeLessThanOrEqual(FIELD.halfZ);
        expect(c.r).toBeGreaterThan(0);
        if (c.hp !== undefined) expect(c.hp).toBeGreaterThan(0);
      }
    }
  });

  it('each battleground has at least one defining feature beyond plain barricades', () => {
    // narrows: choke wall + destructible plug + ridges; highlands: plateaus + bridge;
    // crossroads: destructible cross + bridges; siegeworks: layered destructibles + knolls
    for (const b of BATTLEGROUNDS) {
      if (b.id === 'meadow') continue; // the classic open field is the control
      const features = (b.highGround?.length ? 1 : 0) + (b.bridges?.length ? 1 : 0)
        + (b.barricades.some(c => c.hp > 0) ? 1 : 0);
      expect(features).toBeGreaterThan(0);
    }
    expect(getBattleground('narrows').barricades.filter(c => c.hp > 0).length).toBeGreaterThan(0);
    expect(getBattleground('highlands').highGround.length).toBeGreaterThan(0);
    expect(getBattleground('highlands').bridges.length).toBeGreaterThan(0);
    expect(getBattleground('crossroads').barricades.filter(c => c.hp > 0).length).toBe(4);
    expect(getBattleground('siegeworks').barricades.filter(c => c.hp > 0).length).toBe(6);
  });

  it('unknown map ids fall back to the meadow', () => {
    expect(getBattleground('nope').id).toBe('meadow');
    expect(getBattleground(undefined).id).toBe('meadow');
  });

  it('createBattle takes a battleground: mutable copies, sim collides with them', () => {
    const bg = getBattleground('crossroads');
    const st = createBattle({ seed: 7, barricades: bg.barricades, highGround: bg.highGround });
    expect(st.barricades).toHaveLength(bg.barricades.length);
    expect(st.barricades[0]).toEqual(bg.barricades[0]);
    expect(st.barricades[0]).not.toBe(bg.barricades[0]); // a copy: the sim may destroy it
    expect(st.highGround).toEqual(bg.highGround);
    // default battle keeps the legacy ring
    const plain = createBattle({ seed: 7 });
    expect(plain.barricades.map(b => [b.x, b.z, b.r])).toEqual(BARRICADES.map(b => [b.x, b.z, b.r]));
    expect(plain.highGround).toEqual([]);
  });
});

describe('rock-paper-scissors combat modifiers', () => {
  it('the counter table matches the documented triangle', () => {
    expect(counterMult('shield', 'rocket')).toBe(1.6);
    expect(counterMult('rocket', 'stealer')).toBe(1.6);
    expect(counterMult('stealer', 'kami')).toBe(2.5);
    expect(counterMult('kami', 'shield')).toBe(2.0);
    expect(counterMult('rocket', 'shield')).toBe(0.4); // firing into the counter hurts
    expect(counterMult('shield', 'brute')).toBe(1);   // unlisted pairs are neutral
    for (const [att, row] of Object.entries(COUNTERS)) {
      expect(UNIT_TYPES[att], `attacker ${att}`).toBeTruthy();
      for (const def of Object.keys(row)) expect(UNIT_TYPES[def], `defender ${def}`).toBeTruthy();
    }
  });

  it('computeDamage applies the counter multiplier deterministically', () => {
    const a = computeDamage('kami', 'shield', {});
    const b = computeDamage('kami', 'shield', {});
    expect(a).toBe(b);
    expect(a).toBeCloseTo(UNIT_TYPES.kami.dmg * 2.0, 10);
    expect(computeDamage('rocket', 'shield', {})).toBeCloseTo(UNIT_TYPES.rocket.dmg * 0.4, 10);
  });

  it('counters decide a duel: kami shreds a shield wall, shields walk through rockets', () => {
    const duel = (att, def) => {
      const st = createBattle({ seed: 11, mode: 'versus', army: false, coins: 0 });
      const A = spawnUnit(st, 'blue', att, { x: 0, z: 0, hpMul: 50 });
      const D = spawnUnit(st, 'red', def, { x: 1.2, z: 0, hpMul: 50 });
      A.cd = 0; D.cd = 99999; // only the attacker swings
      for (let i = 0; i < 400 && D.alive; i++) stepBattle(st, []);
      return st.stats.blue.dmgDealt;
    };
    // kami (counter) vs shield deals far more than shield vs kami per swing
    expect(duel('kami', 'shield')).toBeGreaterThan(duel('shield', 'kami') * 1.5);
  });
});

describe('destructible barricades', () => {
  it('artillery breaks destructible bundles and emits barricadeDown', () => {
    const st = createBattle({
      seed: 3, army: false, coins: 1000,
      barricades: [{ x: 5, z: 5, r: 1.5, hp: 100 }, { x: -20, z: -20, r: 1.5 }],
    });
    const h0 = battleHash(st);
    expect(applyCommand(st, { type: 'artillery', team: 'blue', x: 5, z: 5 })).toBe(true);
    expect(st.barricades).toHaveLength(1);
    expect(st.barricades[0].x).toBe(-20); // the solid one survives
    const down = st.events.find(e => e.type === 'barricadeDown');
    expect(down).toMatchObject({ x: 5, z: 5 });
    expect(battleHash(st)).not.toBe(h0); // the tightened hash sees the broken bundle
  });

  it('barricade breaking is deterministic across lockstep peers', () => {
    const mk = () => createBattle({
      seed: 9, army: false, coins: 1000,
      barricades: [{ x: 2, z: 2, r: 1.5, hp: 300 }],
    });
    const a = mk(), b = mk();
    const cmd = { type: 'artillery', team: 'blue', x: 2, z: 2 };
    applyCommand(a, cmd); applyCommand(b, cmd);
    expect(a.barricades[0].hp).toBe(b.barricades[0].hp);
    expect(a.barricades[0].hp).toBeLessThan(300);
    applyCommand(a, cmd); applyCommand(b, cmd);
    expect(a.barricades).toHaveLength(0);
    expect(battleHash(a)).toBe(battleHash(b));
  });
});

describe('high ground', () => {
  it('attackers on high ground deal HIGH_GROUND_MULT damage', () => {
    const mk = highGround => {
      const st = createBattle({ seed: 21, mode: 'versus', army: false, coins: 0, highGround });
      const A = spawnUnit(st, 'blue', 'shield', { x: 0, z: 0, hpMul: 50 });
      const D = spawnUnit(st, 'red', 'brute', { x: 1.5, z: 0, hpMul: 50 });
      A.cd = 0; D.cd = 99999;
      let sum = 0, n = 0;
      for (let i = 0; i < 120; i++) {
        stepBattle(st, []);
        for (const e of st.events) if (e.type === 'hit' && e.src === 'shield') { sum += e.dmg; n++; }
      }
      expect(n).toBeGreaterThan(0);
      return sum / n;
    };
    const flat = mk([]);
    const high = mk([{ x: 0, z: 0, w: 20, h: 20 }]);
    expect(flat).toBeCloseTo(UNIT_TYPES.shield.dmg, 10);
    expect(high).toBeCloseTo(UNIT_TYPES.shield.dmg * HIGH_GROUND_MULT, 10);
    expect(HIGH_GROUND_MULT).toBe(1.15);
  });
});

describe('co-op wave defense over the lockstep relay', () => {
  it('waves escalate and two blue peers stay hash-identical', () => {
    expect(FINAL_WAVE).toBe(10);
    const w1 = waveScaling(1), w5 = waveScaling(5), w9 = waveScaling(9);
    expect(w5.hpMul).toBeGreaterThan(w1.hpMul);
    expect(w9.dmgMul).toBeGreaterThan(w5.dmgMul);
    expect(DIFFICULTY.normal).toBeTruthy();

    let s = 424242;
    const lobby = new WarfareLobby({ rand: () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 });
    const mk = () => ({ out: [], send(m) { this.out.push(m); } });
    const a = mk(), b = mk();
    lobby.handle(a, { wf: 'queue', mode: 'coop', name: 'Ann' });
    lobby.handle(b, { wf: 'queue', mode: 'coop', name: 'Bea' });
    const sa = a.out.find(m => m.wf === 'start');
    expect(sa.team).toBe('blue');
    expect(a.out.find(m => m.wf === 'start').team).toBe('blue');

    const sims = [createBattle({ seed: sa.seed, mode: 'defense' }), createBattle({ seed: sa.seed, mode: 'defense' })];
    const next = [0, 0];
    const drain = (client, k) => {
      const turns = client.out.filter(m => m.wf === 'turn').sort((x, y) => x.n - y.n);
      client.out = client.out.filter(m => m.wf !== 'turn');
      for (const t of turns) {
        expect(t.n).toBe(next[k]);
        for (let j = 0; j < TT; j++) stepBattle(sims[k], j === 0 ? t.cmds : []);
        next[k]++;
      }
    };
    // both players recruit through the relay, then kick off wave 1
    lobby.handle(a, { wf: 'cmd', cmds: [{ type: 'recruit', unit: 'rocket' }] });
    lobby.handle(b, { wf: 'cmd', cmds: [{ type: 'recruit', unit: 'shield' }] });
    lobby.handle(a, { wf: 'cmd', cmds: [{ type: 'startWave' }] });
    for (let i = 0; i < 60; i++) { lobby.tick(); drain(a, 0); drain(b, 1); }
    expect(next[0]).toBeGreaterThan(30);
    expect(sims[0].wave).toBeGreaterThanOrEqual(1);
    expect(sims[1].wave).toBe(sims[0].wave);
    expect(battleHash(sims[0])).toBe(battleHash(sims[1]));
    expect(sims[0].units.some(u => u.team === 'blue' && u.type === 'rocket')).toBe(true);
  });
});

describe('bug fix: rejoin with tightened turn hashes after a laggy disconnect', () => {
  function pair(mode = 'coop', map) {
    let s = 1234567;
    const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const lobby = new WarfareLobby({ rand });
    const mk = () => ({ out: [], send(m) { this.out.push(m); } });
    const a = mk(), b = mk();
    lobby.handle(a, { wf: 'queue', mode, name: 'Ann', map });
    lobby.handle(b, { wf: 'queue', mode, name: 'Bea' });
    return { lobby, a, b, sa: a.out.find(m => m.wf === 'start'), sb: b.out.find(m => m.wf === 'start') };
  }

  function drain(client, sim, st) {
    const turns = client.out.filter(m => m.wf === 'turn').sort((x, y) => x.n - y.n);
    client.out = client.out.filter(m => m.wf !== 'turn');
    for (const t of turns) {
      expect(t.n).toBe(st.next);
      for (let j = 0; j < TT; j++) stepBattle(sim, j === 0 ? t.cmds : []);
      st.next++;
    }
  }

  it('start carries a rejoin token and the picked battleground', () => {
    const { sa, sb } = pair('coop', 'highlands');
    expect(sa.token).toMatch(/^[A-Z]{12}$/);
    expect(sb.token).toMatch(/^[A-Z]{12}$/);
    expect(sa.token).not.toBe(sb.token);
    expect(sa.map).toBe('highlands');
    const { sa: def } = pair('versus');
    expect(def.map).toBe('meadow'); // no map picked → the meadow default
  });

  it('a dropped co-op player rejoins, replays missed turns over lag, and hashes agree', () => {
    const { lobby, a, b, sa, sb } = pair('coop', 'crossroads');
    const bg = getBattleground('crossroads');
    const simA = createBattle({ seed: sa.seed, mode: 'defense', barricades: bg.barricades, highGround: bg.highGround });
    const simB = createBattle({ seed: sb.seed, mode: 'defense', barricades: bg.barricades, highGround: bg.highGround });
    const stA = { next: 0 }, stB = { next: 0 };

    // warm up together, with b lagging 2 turns behind a (deterministic latency)
    lobby.handle(a, { wf: 'cmd', cmds: [{ type: 'recruit', unit: 'shield' }] });
    for (let i = 0; i < 12; i++) { lobby.tick(); drain(a, simA, stA); if (i % 3 === 2) drain(b, simB, stB); }
    drain(b, simB, stB);

    // b's socket dies mid-battle; a keeps playing, the turn log keeps recording
    lobby.drop(b);
    expect(a.out.some(m => m.wf === 'peerLeft')).toBe(true);
    lobby.handle(a, { wf: 'cmd', cmds: [{ type: 'stance', stance: 'defense' }] });
    for (let i = 0; i < 20; i++) { lobby.tick(); drain(a, simA, stA); }

    // b reconnects on a fresh socket and asks for everything since its last turn
    const b2 = { out: [], send(m) { this.out.push(m); } };
    lobby.handle(b2, { wf: 'rejoin', token: sb.token, from: stB.next });
    const resync = b2.out.find(m => m.wf === 'resync');
    expect(resync.ok).toBe(true);
    expect(resync.slot).toBe(1);
    expect(resync.turns.length).toBeGreaterThan(0);
    expect(resync.turns[0].n).toBe(stB.next);
    for (const t of resync.turns) {
      expect(t.n).toBe(stB.next);
      for (let j = 0; j < TT; j++) stepBattle(simB, j === 0 ? t.cmds : []);
      stB.next++;
    }
    // the partner is told, and both peers get an immediate hash check
    expect(a.out.some(m => m.wf === 'peerBack')).toBe(true);
    expect(a.out.some(m => m.wf === 'verifyHash')).toBe(true);
    expect(b2.out.some(m => m.wf === 'verifyHash')).toBe(true);

    // keep playing together; the stance command b missed is now applied on both sims
    for (let i = 0; i < 30; i++) { lobby.tick(); drain(a, simA, stA); drain(b2, simB, stB); }
    expect(battleHash(simA)).toBe(battleHash(simB));

    // both answer the tightened hash check at the same turn → recorded, no desync
    const t = stA.next - 1;
    lobby.handle(a, { wf: 'hash', turn: t, h: battleHash(simA) });
    lobby.handle(b2, { wf: 'hash', turn: t, h: battleHash(simB) });
    expect(a.out.some(m => m.wf === 'desync')).toBe(false);
    expect(b2.out.some(m => m.wf === 'desync')).toBe(false);
  });

  it('rejoin is refused when the turn log no longer reaches back far enough', () => {
    const { lobby, b, sb } = pair();
    for (let i = 0; i < 10; i++) lobby.tick();
    lobby.drop(b);
    for (let i = 0; i < TURN_LOG + 5; i++) lobby.tick();
    const b2 = { out: [], send(m) { this.out.push(m); } };
    lobby.handle(b2, { wf: 'rejoin', token: sb.token, from: 5 });
    expect(b2.out.at(-1)).toMatchObject({ wf: 'resync', ok: false });
  });

  it('rejoin with a bogus token is rejected', () => {
    const { lobby } = pair();
    const c = { out: [], send(m) { this.out.push(m); } };
    lobby.handle(c, { wf: 'rejoin', token: 'ZZZZZZZZZZZZ', from: 0 });
    expect(c.out.at(-1).wf).toBe('error');
  });
});

describe('bug fix: formation toggle [R] reaches lagging flanker units', () => {
  it('stance is inherited by units recruited after the toggle (flankers included)', () => {
    const st = createBattle({ seed: 5, army: false, coins: 1000 });
    expect(applyCommand(st, { type: 'stance', team: 'blue', stance: 'defense' })).toBe(true);
    expect(st.stance.blue).toBe('defense');
    // a flanker recruited AFTER the toggle must not lag behind the formation
    const late = spawnUnit(st, 'blue', 'stealer', { x: 0, z: 0 });
    expect(late.speedMul).toBe(STANCE_SPEED.defense);
    const before = spawnUnit(st, 'blue', 'shield', { x: 0, z: 0 });
    // (spawned after too — stance applies at spawn, not just at command time)
    expect(before.speedMul).toBe(STANCE_SPEED.defense);
    expect(applyCommand(st, { type: 'stance', team: 'blue', stance: 'charge' })).toBe(true);
    expect(spawnUnit(st, 'blue', 'sneak', { x: 0, z: 0 }).speedMul).toBe(STANCE_SPEED.charge);
    // and the toggle still hits every living unit, flankers or not
    for (const u of st.units) expect(u.speedMul).toBe(STANCE_SPEED.charge);
  });

  it('the server relays stance / artillery / supply instead of silently dropping them', () => {
    // before the fix, sanitizeCmd only knew rally/recruit/startWave: [R]/[Q]/[E] died online
    expect(sanitizeCmd({ type: 'stance', team: 'red', stance: 'defense' }, 'blue'))
      .toEqual({ type: 'stance', team: 'blue', stance: 'defense' });
    expect(sanitizeCmd({ type: 'artillery', team: 'red', x: 3.14159, z: -2 }, 'blue'))
      .toEqual({ type: 'artillery', team: 'blue', x: 3.14, z: -2 });
    expect(sanitizeCmd({ type: 'supply', team: 'red' }, 'blue')).toEqual({ type: 'supply', team: 'blue' });
    expect(sanitizeCmd({ type: 'stance', stance: 'berserk' }, 'blue')).toBeNull();
    expect(sanitizeCmd({ type: 'artillery', x: 'NaN', z: 1 }, 'blue')).toBeNull();
  });

  it('a relayed stance toggle lands identically on both lockstep sims', () => {
    let s = 777;
    const lobby = new WarfareLobby({ rand: () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 });
    const mk = () => ({ out: [], send(m) { this.out.push(m); } });
    const a = mk(), b = mk();
    lobby.handle(a, { wf: 'queue', mode: 'versus' });
    lobby.handle(b, { wf: 'queue', mode: 'versus' });
    const sa = a.out.find(m => m.wf === 'start');
    const sims = [createBattle({ seed: sa.seed, mode: 'versus' }), createBattle({ seed: sa.seed, mode: 'versus' })];
    // both sides field a flanker, then blue toggles to defense through the relay
    lobby.handle(a, { wf: 'cmd', cmds: [{ type: 'recruit', unit: 'stealer' }] });
    lobby.handle(b, { wf: 'cmd', cmds: [{ type: 'recruit', unit: 'stealer' }] });
    for (let i = 0; i < 4; i++) lobby.tick();
    lobby.handle(a, { wf: 'cmd', cmds: [{ type: 'stance', stance: 'defense' }] });
    for (let i = 0; i < 4; i++) lobby.tick();
    const next = [0, 0];
    for (const [client, k] of [[a, 0], [b, 1]]) {
      for (const t of client.out.filter(m => m.wf === 'turn').sort((x, y) => x.n - y.n)) {
        for (let j = 0; j < TT; j++) stepBattle(sims[k], j === 0 ? t.cmds : []);
        next[k]++;
      }
    }
    expect(next[0]).toBe(next[1]);
    for (const s of sims) {
      expect(s.stance.blue).toBe('defense');
      for (const u of s.units) if (u.alive && u.team === 'blue') expect(u.speedMul).toBe(STANCE_SPEED.defense);
    }
    expect(battleHash(sims[0])).toBe(battleHash(sims[1]));
  });
});
