// arena-wave2.test.js — W3: grab-system fixes, flail/grab ghost bug, bot flail use,
// round-end watch delay, grabbed-victim hit parity, escape event.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/Sim.js';
import { Bot } from '../src/sim/bot.js';
import { RngStreams } from '../src/sim/rng.js';
import { EVENT_TYPES } from '../src/sim/contracts.js';
import { NEUTRAL_INPUT } from '../src/sim/contracts.js';

/** Two bots, past the countdown, items off for determinism of the scenarios. */
async function makeSim(seats, seed = 4242) {
  const sim = new Sim({ seed, items: false, botDifficulty: 'hard' });
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
  d.percent = 0; // bots brawl during setup; scenarios start clean
  d.sync();
}

/** Holder carries victim, the way combat.grab() leaves them. Clears any stale hold first:
 *  bots brawl during setup and may already hold each other. */
function forceGrab(holder, victim, escapeTimer = 1.5) {
  holder.held = 0; holder.heldKind = ''; holder.grabbedBy = 0;
  victim.held = 0; victim.heldKind = ''; victim.grabbedBy = 0;
  victim.grabbedBy = holder.id;
  victim.escapeTimer = escapeTimer;
  victim.isCharging = false;
  victim.charge = 0;
  holder.held = victim.id;
  holder.heldKind = 'dweeb';
}

/** Neutral frames for every seat: bots stand still instead of fighting the scenario. */
function neutralInputs(sim) {
  const inp = {};
  for (const d of sim.dweebs) if (d) inp[d.slot] = { ...NEUTRAL_INPUT };
  return inp;
}

describe('grab/flail ghost bug (W3-B1)', () => {
  it('a grabbed victim’s flail clock keeps running — no frozen flail', async () => {
    const sim = await makeSim([true, true]);
    const [holder, victim] = sim.dweebs;
    place(sim, holder, 0, 0.6, 0);
    place(sim, victim, 10, -4.4, 0);
    victim.swimFlail = 0.6;
    victim.flailUsed = true;
    forceGrab(holder, victim);
    // 40 ticks of preStep with the victim grabbed: the flail must decay anyway.
    for (let t = 0; t < 40; t++) victim.preStep(undefined, {});
    expect(victim.swimFlail).toBeLessThanOrEqual(0);
  });

  it('a victim grabbed mid-flail can never fall out of the world active', async () => {
    const sim = await makeSim([true, true]);
    const [holder, victim] = sim.dweebs;
    place(sim, holder, 0, 0.6, 0);
    place(sim, victim, 10, -4.4, 0);
    victim.swimFlail = 0.6;
    victim.flailUsed = true;
    forceGrab(holder, victim);
    let minY = Infinity;
    let sawEscape = false;
    const neutral = neutralInputs(sim);
    for (let t = 0; t < 400; t++) {
      for (const e of sim.step(neutral)) if (e.type === 'escape') sawEscape = true;
      if (victim.active) minY = Math.min(minY, victim.position[1]);
    }
    // Pinned above the holder, then escaped — never anywhere near the abyss.
    expect(minY).toBeGreaterThan(-10);
    expect(sawEscape).toBe(true);
    expect(victim.grabbedBy).toBe(0);
  });

  it('the deep-water safety net KOs a dweeb far below the world even mid-flail', async () => {
    const sim = await makeSim([true, true]);
    const victim = sim.dweebs[1];
    place(sim, victim, 0, -200, 0);
    victim.swimFlail = 0.6; // frozen somehow — the net must not care
    victim.flailUsed = true;
    const stocks = victim.stocks;
    sim.step();
    expect(victim.stocks).toBe(stocks - 1);
  });
});

describe('KO’d holder releases the victim (W3-B2)', () => {
  it('victim.grabbedBy is cleared when the holder is KO’d', async () => {
    const sim = await makeSim([true, true]);
    const [holder, victim] = sim.dweebs;
    place(sim, holder, 0, 0.6, 0);
    place(sim, victim, 1, 0.6, 0);
    forceGrab(holder, victim);
    expect(victim.grabbedBy).toBe(holder.id);
    // The exact call sequence Sim.step uses on a KO: rules first, then the body hook.
    holder.stocks = 2;
    sim.match._ko(holder, 'side', sim._api());
    sim._koBody(holder);
    expect(victim.grabbedBy).toBe(0);
    expect(victim.escapeTimer).toBe(0);
    // …and the victim has agency again next tick
    sim.step(neutralInputs(sim));
    expect(victim.canAct).toBe(true);
  });
});

describe('grab escape (W3-B3, live parity)', () => {
  it('the victim wriggles free on the escape clock: tossed, holder stunned, event out', async () => {
    const sim = await makeSim([true, true]);
    const [holder, victim] = sim.dweebs;
    place(sim, holder, 0, 0.6, 0);
    place(sim, victim, 1, 0.6, 0);
    forceGrab(holder, victim, 0.25); // ~15 ticks
    const neutral = neutralInputs(sim);
    let escapedAt = -1;
    let holderStun = 0;
    for (let t = 0; t < 120; t++) {
      for (const e of sim.step(neutral)) {
        if (e.type === 'escape' && e.a === victim.id && e.b === holder.id) {
          escapedAt = t;
          holderStun = holder.hitstun;
        }
      }
      if (escapedAt >= 0) break;
    }
    expect(escapedAt).toBeGreaterThanOrEqual(0);
    expect(victim.grabbedBy).toBe(0);
    expect(holder.held).toBe(0);
    expect(holderStun).toBeGreaterThan(0.2);
    // Tossed away from the holder and upward, like the live escape (one more tick so the
    // sync picks up the escape velocity set after the physics step).
    sim.step(neutral);
    const vv = victim.velocity;
    expect(vv[1]).toBeGreaterThan(3);
  });

  it('the carried victim is pinned above the holder’s head', async () => {
    const sim = await makeSim([true, true]);
    const [holder, victim] = sim.dweebs;
    place(sim, holder, 3, 0.6, -2);
    place(sim, victim, 3, 0.6, -1);
    forceGrab(holder, victim, 5); // long clock: no escape during the check
    // Freeze the holder in place with neutral input so the pin target is stable.
    for (let t = 0; t < 30; t++) sim.step({ 0: { ...NEUTRAL_INPUT }, 1: { ...NEUTRAL_INPUT } });
    const hp = holder.position, vp = victim.position;
    expect(Math.abs(vp[0] - hp[0])).toBeLessThan(0.6);
    expect(Math.abs(vp[2] - hp[2])).toBeLessThan(0.6);
    expect(vp[1] - hp[1]).toBeGreaterThan(0.8);
  });

  it('escape is part of the published event vocabulary', () => {
    expect(EVENT_TYPES).toContain('escape');
  });

  it('grab() uses the live escape formula (percent + archetype)', async () => {
    const sim = await makeSim([true, true]);
    const [holder, victim] = sim.dweebs;
    place(sim, holder, 0, 0.6, 0);
    place(sim, victim, 1, 0.6, 0);
    victim.percent = 100;
    sim.combat.grab(holder, sim.dweebs.filter(Boolean), [], sim._api());
    // (1.4 + 100*0.008) * cube.escape(1.0) = 2.2
    expect(victim.escapeTimer).toBeCloseTo(2.2, 5);
    expect(victim.grabbedBy).toBe(holder.id);
  });
});

describe('park() resets the flail (W3-B4)', () => {
  it('a new round restores the one-flail-per-life comeback', async () => {
    const sim = await makeSim([true, true]);
    const d = sim.dweebs[0];
    d.flailUsed = true;
    d.swimFlail = 0.3;
    d.park({ x: 0, y: 3, z: 0 });
    expect(d.flailUsed).toBe(false);
    expect(d.swimFlail).toBe(0);
  });
});

describe('round-end watch delay (W3-B7, live parity)', () => {
  it('waits ~3 s after the human is eliminated before ending the round', async () => {
    const sim = await makeSim([false, true, true]);
    const human = sim.dweebs[0];
    human.stocks = 1;
    sim.match._ko(human, 'side', sim._api());
    expect(human.eliminated).toBe(true);
    let ticks = 0;
    while (sim.match.phase === 'playing' && ticks < 600) { sim.step(); ticks++; }
    expect(sim.match.phase).toBe('roundEnd');
    expect(ticks).toBeGreaterThanOrEqual(150); // 3 s = 180 ticks
  });

  it('all-bot rounds still end immediately at one dweeb standing', async () => {
    const sim = await makeSim([true, true, true]);
    sim.dweebs[0].stocks = 1;
    sim.dweebs[1].stocks = 1;
    sim.match._ko(sim.dweebs[0], 'side', sim._api());
    sim.match._ko(sim.dweebs[1], 'side', sim._api());
    let ticks = 0;
    while (sim.match.phase === 'playing' && ticks < 600) { sim.step(); ticks++; }
    expect(sim.match.phase).toBe('roundEnd');
    expect(ticks).toBeLessThan(30);
  });
});

describe('grabbed-victim hit parity (W3-B6)', () => {
  it('a swing never hits the attacker’s own captive (but still hits others)', async () => {
    const sim = await makeSim([true, true, true]);
    const [attacker, victim, bystander] = sim.dweebs;
    place(sim, attacker, 0, 0.6, 0);
    attacker.yaw = 0; // facing +z
    place(sim, victim, 0, 0.6, 1.0);
    place(sim, bystander, 0, 0.6, 1.4);
    forceGrab(attacker, victim);
    // Sanity: the captive really is marked as the attacker's.
    expect(victim.grabbedBy).toBe(attacker.id);
    sim.combat.resolveSwing(attacker, 0.5, [attacker, victim, bystander], sim._api());
    expect(victim.percent).toBe(0); // the captive is skipped…
    expect(bystander.percent).toBeGreaterThan(0); // …but the swing still connects otherwise
  });

  it('dives and thrown items pass through grabbed victims', async () => {
    const sim = await makeSim([true, true, true]);
    const [diver, victim, holder] = sim.dweebs;
    place(sim, diver, 0, 0.6, 0);
    place(sim, victim, 0, 0.6, 0.8);
    place(sim, holder, 5, 0.6, 5);
    victim.invuln = 0;
    forceGrab(holder, victim);
    diver.diveTimer = 0.35;
    sim.combat.diveContacts([diver, victim, holder], sim._api());
    expect(victim.percent).toBe(0);

    const item = sim.spawnItem('crate', { x: 0, y: 0.6, z: 0.8 });
    sim.physics.setVel(item.id, 12, 0, 0);
    sim._syncItem(item);
    sim.combat.itemContacts(item, [victim], sim._api());
    expect(victim.percent).toBe(0);
    expect(item.active).toBe(true); // not consumed by the captive
  });
});

describe('bots take the flail splash-jump on purpose (W3-I1)', () => {  function thinkWith(state) {
    const bot = new Bot({ slot: 0, difficulty: 'hard', rng: new RngStreams(7).stream('bot0') });
    return bot.think(state);
  }
  const base = {
    tick: 100, groundRadius: 14, stageRadius: 16, hazards: [], items: [],
    dweebs: [{
      slot: 0, pos: [13.5, -4.3, 0], vel: [0, 0.6, 0], active: true, canAct: true,
      jumpsLeft: 0, flail: true, held: 0, isCharging: false, charge: 0,
    }],
  };
  it('presses jump during the flail window even with no jumps left', () => {
    const f = thinkWith(base);
    expect(f.jump).toBe(true);
  });
  it('does not press jump when merely falling with no jumps and no flail', () => {
    const st = { ...base, dweebs: [{ ...base.dweebs[0], flail: false }] };
    const f = thinkWith(st);
    expect(f.jump).toBe(false);
    expect(f.dodge).toBe(false);
  });
  it('the sim exposes the flail flag to bots', async () => {
    const sim = await makeSim([true]);
    const d = sim.dweebs[0];
    d.swimFlail = 0.4;
    expect(d.toState(false).flail).toBe(true);
    d.swimFlail = 0;
    expect(d.toState(false).flail).toBe(false);
  });
});

describe('ragdoll recovery + tech (W3-B8, live parity)', () => {
  it('a ragdolled dweeb on the floor stands back up when the tumble clock lapses', async () => {
    const sim = await makeSim([true]);
    const d = sim.dweebs[0];
    place(sim, d, 0, 0.6, 0);
    // A launch >= ragdollAt (15) starts the tumble; the clock is hitstun + 0.2.
    d.applyHit({ damage: 10, base: 20, growth: 0, dirX: 1, dirZ: 0, lift: 0.5, from: null }, sim._api());
    expect(d.ragdolling).toBe(true);
    const neutral = neutralInputs(sim);
    for (let t = 0; t < 300 && d.ragdolling; t++) sim.step(neutral);
    expect(d.ragdolling).toBe(false);
    expect(d.canAct).toBe(true);
  });

  it('a dodge pressed while tumbling techs the landing', async () => {
    const sim = await makeSim([true]);
    const d = sim.dweebs[0];
    place(sim, d, 0, 0.6, 0);
    d.ragdolling = true;
    d.ragdollTimer = 5; // long clock: only the tech ends this tumble
    d.hitstun = 0;
    sim.step({ 0: { ...NEUTRAL_INPUT, dodge: true } });
    expect(d.techBuffer).toBeGreaterThan(0);
    const neutral = neutralInputs(sim);
    let teched = false;
    for (let t = 0; t < 30; t++) {
      for (const e of sim.step(neutral)) if (e.type === 'land' && e.kind === 'tech') teched = true;
      if (!d.ragdolling) break;
    }
    expect(d.ragdolling).toBe(false);
    expect(teched).toBe(true);
    expect(d.invuln).toBeGreaterThan(0); // tech grants the brief invuln
  });

  it('bots tech a landing when the tumble is about to hit the floor', () => {
    const mk = (ragdoll, y, vy) => {
      const bot = new Bot({ slot: 0, difficulty: 'hard', rng: new RngStreams(7).stream('bot0') });
      bot.p = { ...bot.p, tech: 1.0 }; // deterministic: always take the tech when it is on
      return bot.think({
        tick: 100, groundRadius: 14, stageRadius: 16, hazards: [], items: [],
        dweebs: [{
          slot: 0, pos: [5, y, 0], vel: [0, vy, 0], active: true, canAct: false,
          jumpsLeft: 0, flail: false, ragdoll, grounded: false, held: 0,
          isCharging: false, charge: 0,
        }],
      });
    };
    // 0.5 m up, falling at 10 m/s: ~0.05 s to impact — dodge now.
    expect(mk(true, 0.5, -10).dodge).toBe(true);
    // Too high: not yet.
    expect(mk(true, 10, -10).dodge).toBe(false);
    // Not tumbling: never.
    expect(mk(false, 0.5, -10).dodge).toBe(false);
  });

  it('the sim exposes the ragdoll flag to bots', async () => {
    const sim = await makeSim([true]);
    const d = sim.dweebs[0];
    d.ragdolling = true;
    expect(d.toState(false).ragdoll).toBe(true);
    d.ragdolling = false;
    expect(d.toState(false).ragdoll).toBe(false);
  });
});

describe('snapshot/restore re-links bodies after item id recycling (W3-B9)', () => {
  it('a recycled item id maps to the right Rapier body after restore', async () => {
    const sim = new Sim({ seed: 99, items: false, botDifficulty: 'hard' });
    await sim.init();
    sim.addSeat({ slot: 0, name: 'P0', type: 'cube', isBot: true });
    sim.addSeat({ slot: 1, name: 'P1', type: 'cube', isBot: true });
    sim.startMatch();
    for (let t = 0; t < 400 && sim.match.phase !== 'playing'; t++) sim.step();
    const neutral = {};
    for (const d of sim.dweebs) if (d) neutral[d.slot] = { ...NEUTRAL_INPUT };
    // Recycle an id: spawn 3 items, despawn the middle one, spawn a 4th (reuses the freed id).
    // Rapier reuses the freed body slot, so forEach order stops matching creation order —
    // the exact condition that used to cross-link bodies to the wrong ids on restore.
    sim.spawnItem('crate', { x: 0, y: 5, z: 0 });
    const b = sim.spawnItem('box', { x: 3, y: 5, z: 0 });
    sim.spawnItem('tire', { x: -3, y: 5, z: 0 });
    sim.despawnItem(b, false);
    const recycled = sim.spawnItem('cake', { x: 6, y: 5, z: 0 });
    expect(recycled.id).toBe(b.id);
    for (let t = 0; t < 120; t++) sim.step(neutral);
    const snap = sim.snapshot();
    const c1 = sim.checksum();
    for (let t = 0; t < 120; t++) sim.step(neutral);
    const straight = sim.checksum();
    sim.restore(snap);
    expect(sim.checksum()).toBe(c1);
    for (let t = 0; t < 120; t++) sim.step(neutral);
    expect(sim.checksum()).toBe(straight);
  });

  it('a thrown rocket keeps its aim across a snapshot/restore', async () => {
    const sim = new Sim({ seed: 99, items: false, botDifficulty: 'hard' });
    await sim.init();
    sim.addSeat({ slot: 0, name: 'P0', type: 'cube', isBot: true });
    sim.addSeat({ slot: 1, name: 'P1', type: 'cube', isBot: true });
    sim.startMatch();
    for (let t = 0; t < 400 && sim.match.phase !== 'playing'; t++) sim.step();
    const neutral = {};
    for (const d of sim.dweebs) if (d) neutral[d.slot] = { ...NEUTRAL_INPUT };
    // Throw a rocket: its thrust direction (aim) must survive the snapshot.
    const [holder] = sim.dweebs;
    const rocket = sim.spawnItem('toyRocket', { x: 0, y: 2, z: 0 });
    holder.held = rocket.id;
    holder.heldKind = 'item';
    holder.yaw = Math.PI / 4;
    sim.combat.throwHeld(holder, 0.8, sim._api());
    expect(rocket.aim).not.toBe(null);
    const snap = sim.snapshot();
    sim.restore(snap);
    const live = sim.items.find(i => i.id === rocket.id);
    expect(live.aim).toEqual(rocket.aim);
  });
});
