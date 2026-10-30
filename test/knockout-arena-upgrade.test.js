// Knockout Arena upgrade (M1): stage hazards, 3 arenas, weapon depth, super-smash meter,
// and the physics + announcer bug fixes. Headless: no DOM, no WebGL.
import { describe, it, expect, beforeAll } from 'vitest';
import { Sim } from '../src/sim/Sim.js';
import { ARENA_PROFILES, TELEGRAPH_TICKS, STAGE_RADIUS, SEGMENTS } from '../src/sim/arena.js';
import { Phase } from '../src/sim/match.js';
import { EV } from '../src/sim/contracts.js';
import { BALANCE } from '../src/game/Balance.js';
import { ARENAS, arenaById } from '../src/game/Arenas.js';
import { GAME_MODES } from '../src/game/GameModes.js';
import { getMaterial } from '../src/physics/Materials.js';
import { RARE, DROP_ITEMS } from '../src/sim/tables.js';
import { AnnounceQueue } from '../src/game/Announcer.js';
import { CombatSystem, DEFAULT_LOFT } from '../src/combat/CombatSystem.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { getObjectDef } from '../src/world/ObjectRegistry.js';

/** A match-ready sim with the countdown skipped, so hazards run immediately. */
async function makeSim(arena = 'stadium', seed = 11, seats = 2) {
  const sim = new Sim({ seed, arena, stocks: 3, roundTime: 120 });
  await sim.init();
  for (let i = 0; i < seats; i++) sim.addSeat({ slot: i, name: 'D' + i });
  sim.startMatch();
  sim.match.phase = Phase.PLAYING;
  return sim;
}

function place(sim, d, x, y, z) {
  sim.physics.setPos(d.id, x, y, z);
  sim.physics.setVel(d.id, 0, 0, 0);
  d.sync();
}

function drain(sim, n, inputs = {}) {
  const evs = [];
  for (let i = 0; i < n; i++) evs.push(...sim.step(inputs));
  return evs;
}

const has = (evs, type, pred = () => true) => evs.some(e => e.type === type && pred(e));

describe('arena registry: the three Knockout Arena stages', () => {
  it('colosseum / icepeak / lavafoundry exist with their defining properties', () => {
    const col = arenaById('colosseum');
    expect(col.name).toBe('Colosseum of Clouts');
    expect(col.hammers).toBe(2);
    expect(col.conveyors).toBe(true);
    expect(col.jumpPads).toBe(2);

    const ice = arenaById('icepeak');
    expect(ice.name).toBe('Slippery Ice Peak');
    expect(ice.floorMaterial).toBe('ice');
    expect(ice.traction).toBeLessThan(0.2);

    const lava = arenaById('lavafoundry');
    expect(lava.name).toBe('Lava Foundry');
    expect(lava.lavaRising).toBe(true);
    expect(lava.lava).toBe(true);
  });

  it('icepeak friction comes from the physics ice material', () => {
    expect(getMaterial('ice').friction).toBe(0.08);
    expect(ARENA_PROFILES.icepeak.floorFriction).toBe(getMaterial('ice').friction);
  });

  it('arena selection is wired into game modes', () => {
    expect(GAME_MODES.brawl.arena).toBe('colosseum');
    for (const id of ['colosseum', 'icepeak', 'lavafoundry']) {
      expect(GAME_MODES.brawl.arenas).toContain(id);
    }
    // every mode's default is in its list, and every listed id is a real arena
    const ids = new Set(ARENAS.map(a => a.id));
    for (const m of Object.values(GAME_MODES)) {
      expect(m.arenas, m.id).toContain(m.arena);
      for (const a of m.arenas) expect(ids, `${m.id}:${a}`).toContain(a);
    }
  });
});

describe('stage hazards', () => {
  it('rotating hammers smack dweebs at the head position', async () => {
    const sim = await makeSim('colosseum', 21);
    const [d] = sim.dweebs;
    const h = sim.arena.hazards.find(x => x.kind === 'hammer');
    expect(h).toBeTruthy();
    const head = sim.arena.hammerHead(h);
    place(sim, d, head.x, 0.5, head.z);
    d.hazardCd = 0;
    const evs = drain(sim, 5);
    expect(d.percent).toBeGreaterThan(0);
    expect(has(evs, 'hazard', e => e.kind === 'hammer')).toBe(true);
  });

  it('hammer heads orbit: the head position is a function of time', async () => {
    const sim = await makeSim('colosseum', 22);
    const h = sim.arena.hazards.find(x => x.kind === 'hammer');
    const p0 = sim.arena.hammerHead(h);
    drain(sim, 60);
    const p1 = sim.arena.hammerHead(h);
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    expect(moved).toBeGreaterThan(1); // 1.6 rad/s * 6.5 m arm moves a lot in 1 s
    // orbit radius stays constant
    expect(Math.hypot(p1.x - h.x, p1.z - h.z)).toBeCloseTo(BALANCE.arena.hammerArmR, 5);
  });

  it('conveyor belts drag grounded dweebs along the belt', async () => {
    const sim = await makeSim('colosseum', 23);
    const [d] = sim.dweebs;
    const c = sim.arena.hazards.find(x => x.kind === 'conveyor');
    expect(c).toBeTruthy();
    // park jump pads and hammers far away so the soak below measures the belt alone
    for (const j of sim.arena.hazards.filter(x => x.kind === 'jumppad')) { j.x = 14; j.z = 14; }
    for (const h of sim.arena.hazards.filter(x => x.kind === 'hammer')) { h.x = 14; h.z = 14; }
    place(sim, d, c.x, 0.5, c.z);
    drain(sim, 30); // settle onto the belt
    expect(d.grounded).toBe(true);
    const x0 = d.position[0], z0 = d.position[2];
    drain(sim, 240);
    const dx = d.position[0] - x0, dz = d.position[2] - z0;
    const along = dx * c.dx + dz * c.dz;
    expect(along).toBeGreaterThan(0.2);
  });

  it('jump pads launch harder than trampolines', async () => {
    const sim = await makeSim('colosseum', 24);
    const [d] = sim.dweebs;
    const j = sim.arena.hazards.find(x => x.kind === 'jumppad');
    expect(j).toBeTruthy();
    place(sim, d, j.x, 0.5, j.z);
    let peak = 0;
    const evs = [];
    for (let i = 0; i < 30; i++) {
      evs.push(...sim.step());
      peak = Math.max(peak, sim.physics.vel(d.id).y);
    }
    expect(has(evs, 'jumppad')).toBe(true);
    expect(peak).toBeGreaterThan(BALANCE.bounce.trampolineVel);
    expect(peak).toBeCloseTo(BALANCE.arena.jumpPadVel, 0);
  });

  it('crumbly edge tiles warn, fall, and drop dweebs through the floor', async () => {
    const sim = await makeSim('icepeak', 25);
    const [d] = sim.dweebs;
    const ti = sim.arena.crumbleTimes.findIndex(t => Number.isFinite(t));
    expect(ti).toBeGreaterThanOrEqual(0);
    const ct = sim.arena.crumbleTimes[ti];
    // tile centre on the rim band
    const a = (ti + 0.5) / SEGMENTS * Math.PI * 2;
    const x = Math.cos(a) * 13.5, z = Math.sin(a) * 13.5;
    // crossing into the warn window emits segmentWarn, crossing the fall emits segmentFall
    sim.arena.time = ct - BALANCE.arena.crumbleWarn - 0.05;
    let evs = drain(sim, 10);
    expect(has(evs, 'segmentWarn', e => e.b === ti)).toBe(true);
    sim.arena.time = ct - 0.05;
    evs = drain(sim, 10);
    expect(has(evs, 'segmentFall', e => e.b === ti)).toBe(true);
    // now stand on the gone tile: the floor is gone there
    place(sim, d, x, 0.5, z);
    const stocks0 = d.stocks;
    drain(sim, 5);
    expect(d.pitfall).toBe(true);
    let evs2 = drain(sim, 90);
    expect(d.position[1]).toBeLessThan(-2); // fell through to the lagoon, not standing on air
    // the lagoon KOs (possibly via the flail micro-comeback first): stocks drop
    evs2 = evs2.concat(drain(sim, 300));
    expect(d.stocks < stocks0 || has(evs2, 'splash', e => e.a === d.id)).toBe(true);
  });

  it('lava foundry: the safe radius shrinks and the rim burns', async () => {
    const sim = await makeSim('lavafoundry', 26);
    const [d] = sim.dweebs;
    expect(sim.arena.lavaEdge()).toBe(STAGE_RADIUS); // grace period
    sim.arena.time = BALANCE.arena.lavaEdgeGrace + 10;
    const edge = sim.arena.lavaEdge();
    expect(edge).toBeLessThan(STAGE_RADIUS);
    expect(edge).toBeCloseTo(STAGE_RADIUS - BALANCE.arena.lavaEdgeRise * 10, 5);
    expect(sim.arena.edgeRadius()).toBe(edge);
    place(sim, d, edge + 1.5, 0.5, 0); // outside the safe zone, on the floor
    const evs = drain(sim, 5);
    expect(d.percent).toBeGreaterThan(0);
    expect(has(evs, 'lava', e => e.a === d.id)).toBe(true);
  });

  it('hazard motion is deterministic: same seed, same checksum', async () => {
    const run = async () => {
      const sim = await makeSim('colosseum', 27);
      drain(sim, 300);
      return sim.checksum();
    };
    expect(await run()).toBe(await run());
  });
});

describe('drop telegraphs', () => {
  it('a drop is warned before it lands, then spawns the warned key at the warned spot', async () => {
    const sim = await makeSim('stadium', 28);
    let evs = [];
    let tg = null;
    for (let i = 0; i < 400 && !tg; i++) {
      evs.push(...sim.step());
      tg = evs.find(e => e.type === 'telegraph');
    }
    expect(tg).toBeTruthy();
    expect(DROP_ITEMS.some(it => it.key === tg.kind)).toBe(true);
    expect(Number.isFinite(tg.x) && Number.isFinite(tg.z)).toBe(true);
    expect(tg.mag).toBeCloseTo(TELEGRAPH_TICKS / 60, 5);
    // the landing follows exactly TELEGRAPH_TICKS later with the same key and position
    evs = drain(sim, TELEGRAPH_TICKS + 2);
    const spawn = evs.find(e => e.type === 'spawn' && e.kind === tg.kind);
    expect(spawn).toBeTruthy();
    expect(spawn.x).toBeCloseTo(tg.x, 5);
    expect(spawn.z).toBeCloseTo(tg.z, 5);
  });

  it('rare drops are flagged on the telegraph event', () => {
    // unit-level: planDrop stamps rarity on the pending drop
    return makeSim('stadium', 29).then(sim => {
      sim.arena.time = 1000; // clear of cooldown weirdness; weights still apply
      const seen = new Set();
      for (let i = 0; i < 60; i++) {
        const pd = sim.arena.planDrop();
        if (pd) seen.add(pd.key + ':' + pd.rare);
      }
      // rarity flag agrees with the RARE table for whatever was picked
      for (const s of seen) {
        const [key, rare] = s.split(':');
        expect(String(!!RARE[key])).toBe(rare);
      }
      expect(seen.size).toBeGreaterThan(0);
    });
  });
});

describe('super-smash meter (consecutive punches)', () => {
  async function punchSetup() {
    const sim = await makeSim('stadium', 30);
    const [a, v] = sim.dweebs;
    place(sim, a, 0, 0.5, 0);
    place(sim, v, 0, 0.5, 1.2);
    a.yaw = 0; // facing +z, at the victim
    return { sim, a, v, api: sim._api() };
  }

  it('consecutive landed punches build a streak and bank bonus style', async () => {
    const { sim, a, v, api } = await punchSetup();
    for (let i = 0; i < 3; i++) {
      sim.time = 10 + i * 0.5; // inside the streak window
      place(sim, v, 0, 0.5, 1.2); // keep the victim in range
      v.invuln = 0;
      expect(sim.combat.resolveSwing(a, 0, sim.dweebs, api)).toBe(true);
    }
    expect(a.punchStreak).toBe(3);
    // 3 base awards (5 + launch*0.5 each, launch > 0) + streak bonus 3 + 6
    expect(a.style).toBeGreaterThanOrEqual(15 + BALANCE.style.streakBonus * 3);
  });

  it('a whiffed jab resets the streak', async () => {
    const { sim, a, v, api } = await punchSetup();
    sim.time = 10;
    place(sim, v, 0, 0.5, 1.2);
    sim.combat.resolveSwing(a, 0, sim.dweebs, api);
    expect(a.punchStreak).toBe(1);
    place(sim, v, 0, 0.5, 30); // out of range: whiff
    sim.time = 10.5;
    sim.combat.resolveSwing(a, 0, sim.dweebs, api);
    expect(a.punchStreak).toBe(0);
  });

  it('taking a hit resets your streak', async () => {
    const { sim, a, v, api } = await punchSetup();
    a.punchStreak = 4;
    // victim punches back
    place(sim, v, 0, 0.5, 1.2);
    place(sim, a, 0, 0.5, 2.4);
    v.yaw = 0; // facing +z, at the attacker
    sim.time = 20;
    v.invuln = 0; a.invuln = 0;
    sim.combat.resolveSwing(v, 0, sim.dweebs, api);
    expect(a.punchStreak).toBe(0);
  });

  it('a full meter arms the Super Yeet (the ultimate)', async () => {
    const { sim, a } = await punchSetup();
    a.style = BALANCE.style.max;
    a.styleTimer = BALANCE.style.hold;
    sim.time = 30;
    a.preStep({ superYeet: true }, sim._api());
    expect(a.superArmed).toBe(true);
  });

  it('live CombatSystem._punchStreak: window, cap, bonus', async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const sys = new CombatSystem(physics, {}, {});
    const d = { punchStreak: 0, punchStreakT: -99 };
    sys.time = 10;
    expect(sys._punchStreak(d)).toBe(0);
    expect(d.punchStreak).toBe(1);
    sys.time = 10.5;
    expect(sys._punchStreak(d)).toBe(BALANCE.style.streakBonus);
    expect(d.punchStreak).toBe(2);
    sys.time = 10.5 + BALANCE.style.streakWindow + 0.1; // window lapsed
    expect(sys._punchStreak(d)).toBe(0);
    expect(d.punchStreak).toBe(1);
    // cap
    d.punchStreak = BALANCE.style.streakCap;
    d.punchStreakT = sys.time;
    sys.time += 0.1;
    sys._punchStreak(d);
    expect(d.punchStreak).toBe(BALANCE.style.streakCap);
  });
});

describe('throw trajectory arcs for all item tiers', () => {
  let rig;
  beforeAll(async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    physics.createStaticBox(0, -0.5, 0, 60, 0.5, 60, 'toy');
    physics.step(1 / 60);
    rig = {
      physics,
      system: new CombatSystem(physics, {
        bumperByHandle: () => null,
        trampolineByHandle: () => null,
        bumpers: [], trampolines: [], powerups: [],
      }, { hit() {}, throw() {}, rocketSmoke() {} }),
    };
  });

  const throwerAt = (x, y, z, yaw) => ({
    getPosition: () => ({ x, y, z }), yaw, megaTimer: 0,
    active: true, grabbedBy: null, held: null, velocity: { x: 0, y: 0, z: 0 },
  });

  function itemFor(key) {
    const def = getObjectDef(key);
    const b = rig.physics.createDynamicBody(0, 1, 0, def.shape, def.dims, { material: def.material, mass: def.mass });
    return { key, def, collider: b.collider, body: b.body };
  }

  const TIERS = {
    common: 'beachBall',
    mid: 'couch',
    rare: 'anvil',
    rareWeapon: 'giantHammer',
    gadget: 'freezeRay',
    rocket: 'toyRocket',
    roller: 'bowlingBall',
  };

  for (const [tier, key] of Object.entries(TIERS)) {
    it(`predictThrow draws an honest arc for ${tier} (${key})`, () => {
      const obj = itemFor(key);
      const thrower = throwerAt(0, 1, 0, 0.6);
      const points = [];
      const pr = rig.system.predictThrow(thrower, obj, 0.5, 0.6, DEFAULT_LOFT, points);
      expect(pr.n).toBeGreaterThan(1);
      expect(points.length).toBe(pr.n);
      for (const p of points) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      }
      expect(Number.isFinite(pr.end.x) && Number.isFinite(pr.time)).toBe(true);
      expect(pr.launch).toBeTruthy();
    });
  }
});

describe('bug fix: simultaneous respawns no longer overlap', () => {
  it('three dweebs KOed on the same tick respawn separated', async () => {
    const sim = await makeSim('stadium', 31, 3);
    // drop everyone into the abyss at once (far out: no flail)
    for (const d of sim.dweebs) place(sim, d, 30, -6, 0);
    let evs = drain(sim, 2);
    expect(sim.dweebs.every(d => d.out)).toBe(true);
    // respawn delay is 2 s; all three timers were set on the same tick
    evs = drain(sim, 130);
    const respawns = evs.filter(e => e.type === 'respawn');
    expect(respawns).toHaveLength(3);
    const gap = BALANCE.arena.respawnMinGap;
    for (let i = 0; i < respawns.length; i++) {
      for (let j = i + 1; j < respawns.length; j++) {
        const dist = Math.hypot(respawns[i].x - respawns[j].x, respawns[i].z - respawns[j].z);
        expect(dist, `respawns ${i} and ${j}`).toBeGreaterThanOrEqual(gap);
      }
    }
    // and nobody clipped through the floor or got flung: everyone lands sane
    drain(sim, 120);
    for (const d of sim.dweebs) {
      const p = d.position, v = sim.physics.vel(d.id);
      expect(p[1]).toBeGreaterThan(-4.4);
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(40);
      expect(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])).toBe(true);
    }
  });

  it('separatedGroundPoint keeps its distance from other dweebs', async () => {
    const sim = await makeSim('stadium', 32);
    const avoid = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: -2, z: 2 }];
    for (let i = 0; i < 20; i++) {
      const p = sim.arena.separatedGroundPoint(5, avoid);
      for (const a of avoid) {
        expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeGreaterThanOrEqual(BALANCE.arena.respawnMinGap);
      }
    }
  });
});

describe('bug fix: announcer queue stops KO banner overlap', () => {
  function fakeHud() {
    return {
      log: [], announceTimer: 0,
      announce(text, style, duration) {
        this.log.push(text);
        this.announceTimer = duration;
      },
    };
  }
  // advance a fake frame loop: the HUD counts its banner down, the queue pumps
  function frames(q, hud, n) {
    for (let i = 0; i < n; i++) {
      hud.announceTimer = Math.max(0, hud.announceTimer - 1 / 60);
      q.update(hud, 1 / 60);
    }
  }

  it('serializes rapid KOs: the first banner is never stomped', () => {
    const q = new AnnounceQueue();
    const hud = fakeHud();
    expect(q.announce(hud, 'KO1', 'ko', 1.2)).toBe(true);  // immediate
    expect(q.announce(hud, 'KO2', 'ko', 1.2)).toBe(false); // queued
    expect(q.pending).toBe(1);
    frames(q, hud, 71);
    expect(hud.log).toEqual(['KO1']); // KO1 got its full 1.2 s
    frames(q, hud, 2);
    expect(hud.log).toEqual(['KO1', 'KO2']); // KO2 shows only after
  });

  it('debounces identical banners and caps the line', () => {
    const q = new AnnounceQueue({ maxQueue: 3 });
    const hud = fakeHud();
    q.announce(hud, 'A', '', 1.2);
    q.announce(hud, 'B', '', 1.2);
    q.announce(hud, 'B', '', 1.2); // dupe
    expect(q.pending).toBe(1);
    for (const t of ['C', 'D', 'E', 'F']) q.announce(hud, t, '', 1.2);
    expect(q.pending).toBeLessThanOrEqual(3);
    q.reset();
    expect(q.pending).toBe(0);
  });

  it('respects a banner the HUD is already showing', () => {
    const q = new AnnounceQueue();
    const hud = fakeHud();
    hud.announce('EXTERNAL', '', 1.0); // announced outside the queue
    expect(q.announce(hud, 'KO', 'ko', 1.2)).toBe(false); // waits its turn
    frames(q, hud, 61);
    expect(hud.log[hud.log.length - 1]).toBe('KO');
  });
});

describe('contracts: new events are published', () => {
  it('telegraph / lava / jumppad / hazard are in the event vocabulary', () => {
    expect(EV.TELEGRAPH).toBe('telegraph');
    expect(EV.LAVA).toBe('lava');
    expect(EV.JUMPPAD).toBe('jumppad');
    expect(EV.HAZARD).toBe('hazard');
  });
});
