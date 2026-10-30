// adventure-wave2b.test.js — W4-BIGGER content drop:
// new ruin trials (bounce gauntlet, sentry vault), new critter kinds, new
// blueprints (tradepost/bakery/garden), merchant trade routes, role mastery,
// seasons + moon phases, festivals, new POIs, and bug-fix regressions.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Meadowlands, SEASONS, CRITTER_KINDS, TRADE_OFFERS } from '../src/world/Meadowlands.js';
import { Colony } from '../src/adventure/colony.js';
import { Citizen, PERSONALITIES, CITIZEN_STATES, ROLE_XP_LEVELS } from '../src/adventure/citizen.js';
import { BuildingManager, BLUEPRINTS } from '../src/adventure/building.js';
import { saveVillage, loadVillage, applySave } from '../src/adventure/persistence.js';

function fakeBody(x = 0, y = 0, z = 0) {
  return {
    _p: { x, y, z },
    _v: { x: 0, y: 0, z: 0 },
    translation() { return this._p; },
    linvel() { return this._v; },
    setLinvel(v) { this._v = { ...v }; },
    setTranslation(p) { this._p = { ...p }; },
  };
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); },
  };
}

function richColony() {
  const colony = new Colony();
  colony.resources = { wood: 999, berries: 999, stone: 999, gold: 0 };
  return colony;
}

function worldWithManager() {
  const scene = new THREE.Scene();
  const world = new Meadowlands(null, scene);
  const bm = new BuildingManager(scene, null);
  world.buildingManager = bm;
  return { scene, world, bm };
}

function place(bm, colony, world, id, x, z) {
  bm.activeBlueprint = BLUEPRINTS.find(b => b.id === id);
  bm.isValidPlacement = true;
  bm.placementPos.set(x, 0, z);
  const res = bm.confirmPlacement(colony, world);
  expect(res && res.success).toBe(true);
  return res.structure;
}

/** A citizen with zeroed needs for deterministic goal selection. */
function calmCitizen(name, role = null, personalityId = null) {
  const dweeb = { name, body: fakeBody(0, 0, 0) };
  const c = new Citizen(dweeb, personalityId
    ? { personality: PERSONALITIES.find(p => p.id === personalityId) }
    : {});
  c.hunger = 0; c.energy = 100; c.curiosity = 0; c.social = 0;
  if (role) c.assignRole(role);
  return c;
}

function calmWorld() {
  const { world, bm } = worldWithManager();
  world.timeOfDay = 12;
  world.weather = 'clear';
  world.weatherTimer = 99999;
  world.critterTimer = 99999;
  world.merchantTimer = 99999;
  world.toyTown = null;
  return { world, bm };
}

describe('new ruin trials', () => {
  it('creates four ruins: plates x2, bounce gauntlet, sentry vault', () => {
    const { world } = worldWithManager();
    const kinds = world.ruins.map(r => r.kind).sort();
    expect(kinds).toEqual(['bounce', 'guard', 'plates', 'plates']);
    const gauntlet = world.ruins.find(r => r.kind === 'bounce');
    expect(gauntlet.name).toBe('Gauntlet of Springs');
    const sentry = world.ruins.find(r => r.kind === 'guard');
    expect(sentry.name).toBe('Sentry Vault Ruin');
    // The gauntlet ships with its own spring pads.
    expect(world.springPads.length).toBeGreaterThanOrEqual(2);
  });

  it('bounce gauntlet opens after 6 nearby bounce stunts; distant ones do not count', () => {
    const { world } = calmWorld();
    const colony = new Colony();
    const gauntlet = world.ruins.find(r => r.kind === 'bounce');
    // Distant bounces are ignored.
    for (let i = 0; i < 10; i++) world._pushStunt('bounce', gauntlet.x + 60, gauntlet.z);
    world._updateRuins(0.016, [], colony);
    expect(gauntlet.opened).toBe(false);
    expect(gauntlet.work).toBe(0);
    // Six bounces at the ruin spring the vault.
    for (let i = 0; i < 6; i++) world._pushStunt('bounce', gauntlet.x + 1, gauntlet.z - 1);
    world._updateRuins(0.016, [], colony);
    expect(gauntlet.opened).toBe(true);
    expect(colony.resources.gold).toBeGreaterThan(0);
    expect(colony.hats.length).toBe(1);
  });

  it('sentry vault opens after 30s of defender guard duty; night counts double', () => {
    const mk = () => {
      const { world } = calmWorld();
      const colony = new Colony();
      const sentry = world.ruins.find(r => r.kind === 'guard');
      const d = calmCitizen('Guardy', 'defender');
      d.dweeb.body._p = { x: sentry.x + 2, y: 0, z: sentry.z };
      d.state = CITIZEN_STATES.GUARD;
      colony.citizens.push(d);
      return { world, colony, sentry };
    };
    // Day shift: 30 one-second ticks.
    const day = mk();
    for (let i = 0; i < 29; i++) day.world._updateRuins(1, [], day.colony);
    expect(day.sentry.opened).toBe(false);
    day.world._updateRuins(1, [], day.colony);
    expect(day.sentry.opened).toBe(true);
    // Night shift: 15 ticks suffice.
    const night = mk();
    night.world.isNight = true;
    for (let i = 0; i < 15; i++) night.world._updateRuins(1, [], night.colony);
    expect(night.sentry.opened).toBe(true);
    // A non-defender standing guard earns no respect.
    const civ = mk();
    civ.colony.citizens[0].role = null;
    for (let i = 0; i < 40; i++) civ.world._updateRuins(1, [], civ.colony);
    expect(civ.sentry.opened).toBe(false);
  });

  it('full moon boosts vault coin loot by 50%', () => {
    const { world } = calmWorld();
    const colony = new Colony();
    const ruin = world.ruins.find(r => r.kind === 'plates');
    world.dayCount = 4; // moonPhase 4 = full
    expect(world.moonPhase).toBe(4);
    world._openRuin(ruin, colony);
    expect(colony.resources.gold).toBe(Math.round(ruin.loot.coins * 1.5));
    // No moon bonus on an ordinary day.
    const w2 = calmWorld().world;
    const c2 = new Colony();
    const r2 = w2.ruins.find(r => r.kind === 'plates');
    w2._openRuin(r2, c2);
    expect(c2.resources.gold).toBe(r2.loot.coins);
  });

  it('new ruin ids round-trip through save/restore', () => {
    const { world } = worldWithManager();
    world.ruins.find(r => r.id === 'gauntlet').opened = true;
    const data = world.serialize();
    expect(data.dayCount).toBe(0);
    const scene2 = new THREE.Scene();
    const world2 = new Meadowlands(null, scene2);
    world2.restore(data);
    expect(world2.ruins.find(r => r.id === 'gauntlet').opened).toBe(true);
    expect(world2.ruins.find(r => r.id === 'sentry').opened).toBe(false);
  });
});

describe('new critter kinds', () => {
  it('spawnCritter supports mischief/gobbler/gnawer with distinct stats', () => {
    const { world } = calmWorld();
    const m = world.spawnCritter();
    expect(m.kind).toBe('mischief');
    expect(m.hp).toBe(2);
    const g = world.spawnCritter('gobbler');
    expect(g.kind).toBe('gobbler');
    expect(g.hp).toBe(CRITTER_KINDS.gobbler.hp);
    expect(g.speed).toBeGreaterThan(m.speed);
    const n = world.spawnCritter('gnawer');
    expect(n.hp).toBe(4);
    expect(n.speed).toBeLessThan(m.speed);
  });

  it('shadow gobblers steal gold, not berries', () => {
    const { world } = calmWorld();
    const colony = new Colony();
    colony.resources.gold = 5;
    colony.resources.berries = 20;
    const g = world.spawnCritter('gobbler');
    g.x = 0; g.z = 0;
    world.update(3.1, [], colony);
    expect(colony.resources.gold).toBe(4);
    expect(colony.resources.berries).toBe(20);
    expect(g.state).toBe('flee');
  });

  it('plank gnawers chew structures twice as hard as mischief critters', () => {
    const mk = (kind) => {
      const { world, bm } = calmWorld();
      const colony = richColony();
      const cannon = place(bm, colony, world, 'cannon', 5, 5);
      const c = world.spawnCritter(kind);
      c.x = 5; c.z = 6;
      world._updateCritters(1, [], colony);
      return cannon.hp;
    };
    expect(mk('gnawer')).toBe(60 - 8);
    expect(mk('mischief')).toBe(60 - 4);
  });

  it('shadow gobblers veer away from torchlight', () => {
    const { world } = calmWorld();
    world.addTorchlight(0, 0, 0);
    const g = world.spawnCritter('gobbler');
    g.x = 4; g.z = 0;
    const m = world.spawnCritter('mischief');
    m.x = 4; m.z = 0;
    world._updateCritters(0.5, [], null);
    expect(g.x).toBeGreaterThan(4); // repelled
    expect(m.x).toBeLessThan(4);    // marches on
  });
});

describe('new blueprints', () => {
  it('tradepost, bakery and garden exist with costs and ghost meshes', () => {
    for (const [id, wood] of [['tradepost', 6], ['bakery', 4], ['garden', 2]]) {
      const bp = BLUEPRINTS.find(b => b.id === id);
      expect(bp).toBeTruthy();
      expect(bp.cost.wood).toBe(wood);
    }
    const { world, bm } = worldWithManager();
    for (const id of ['tradepost', 'bakery', 'garden']) {
      expect(bm.startPlacing(id)).toBe(true);
      expect(bm.ghostMesh).toBeTruthy();
      bm.cancelPlacing();
    }
    expect(world).toBeTruthy();
  });

  it('berry garden plants 3 bushes on placement, but not on save restore', () => {
    const { world, bm } = calmWorld();
    const colony = richColony();
    const before = world.berryBushes.length;
    place(bm, colony, world, 'garden', 8, 8);
    expect(world.berryBushes.length).toBe(before + 3);

    // Save and restore onto a fresh world: no extra bushes.
    const storage = fakeStorage();
    saveVillage({ colony, buildingManager: bm, world }, storage);
    const save = loadVillage(storage);
    const fresh = worldWithManager();
    const freshBefore = fresh.world.berryBushes.length;
    const colony2 = new Colony();
    applySave(save, { colony: colony2, buildingManager: fresh.bm, world: fresh.world });
    expect(fresh.world.berryBushes.length).toBe(freshBefore);
    expect(fresh.bm.placedStructures.some(s => s.id === 'garden')).toBe(true);
  });

  it('berry bakery converts 3 berries into 1 gold every 25 seconds', () => {
    const { world, bm } = calmWorld();
    const colony = new Colony(); // berries 20, gold 0
    place(bm, richColony(), world, 'bakery', 0, 0);
    const player = { body: fakeBody(0, 1, 0) };
    bm.update(25, player, null, { dweebs: [], colony, world });
    expect(colony.resources.berries).toBe(17);
    expect(colony.resources.gold).toBe(1);
    // Not enough berries: no bake, no crash.
    colony.resources.berries = 2;
    bm.update(25, player, null, { dweebs: [], colony, world });
    expect(colony.resources.gold).toBe(1);
  });
});

describe('merchant trade routes', () => {
  it('no trading post means no merchant', () => {
    const { world } = calmWorld();
    const colony = richColony();
    world.merchantTimer = 0.01;
    world.update(0.5, [], colony);
    expect(world.merchant).toBe(null);
  });

  it('merchant arrives at the trading post, trades berries for gold, then leaves', () => {
    const { world, bm } = calmWorld();
    const colony = new Colony(); // berries 20, gold 0
    const post = place(bm, richColony(), world, 'tradepost', 10, 10);
    world.merchantTimer = 0.01;
    world.update(0.5, [], colony);
    expect(world.merchant).not.toBe(null);
    expect(world.merchant.state).toBe('arrive');
    expect(colony.historyLog[0].text).toContain('merchant');

    // Walk it to the stall.
    const m = world.merchant;
    m.x = post.pos.x + 3; m.z = post.pos.z;
    world._updateMerchant(1, colony);
    expect(m.state).toBe('trade');

    // Trade executes: 8 berries -> 3 gold.
    m.waitTimer = 0.01;
    world._updateMerchant(0.02, colony);
    expect(colony.resources.berries).toBe(12);
    expect(colony.resources.gold).toBe(3);
    expect(m.state).toBe('leave');

    // Walks home and despawns.
    m.x = m.homeX + 2; m.z = m.homeZ;
    world._updateMerchant(0.5, colony);
    expect(world.merchant).toBe(null);
  });

  it('autumn sweetens the deal by +1 gold', () => {
    const { world, bm } = calmWorld();
    world.dayCount = 4; // autumn
    expect(world.season).toBe('autumn');
    const colony = new Colony();
    const post = place(bm, richColony(), world, 'tradepost', 10, 10);
    world.merchantTimer = 0.01;
    world.update(0.5, [], colony);
    const m = world.merchant;
    m.x = post.pos.x + 1; m.z = post.pos.z;
    m.state = 'trade';
    m.waitTimer = 0.01;
    world._updateMerchant(0.02, colony);
    expect(colony.resources.gold).toBe(4);
    expect(TRADE_OFFERS.length).toBe(3);
  });

  it('a broke village sends the merchant home empty-handed', () => {
    const { world, bm } = calmWorld();
    const colony = new Colony();
    colony.resources.berries = 0;
    colony.resources.wood = 0;
    colony.resources.stone = 0;
    const post = place(bm, richColony(), world, 'tradepost', 10, 10);
    world.merchantTimer = 0.01;
    world.update(0.5, [], colony);
    const m = world.merchant;
    m.x = post.pos.x + 1; m.z = post.pos.z;
    m.state = 'trade';
    m.waitTimer = 0.01;
    world._updateMerchant(0.02, colony);
    expect(colony.resources.gold).toBe(0);
    expect(m.state).toBe('leave');
  });
});

describe('role mastery', () => {
  it('XP thresholds level foragers up at 10 and 30, with a colony log', () => {
    const colony = new Colony();
    const c = calmCitizen('Fern', 'forager');
    expect(c.roleLevel).toBe(1);
    c.addRoleXp(9, colony);
    expect(c.roleLevel).toBe(1);
    c.addRoleXp(1, colony);
    expect(c.roleLevel).toBe(2);
    expect(colony.historyLog[0].text).toContain('Forager level 2');
    c.addRoleXp(20, colony);
    expect(c.roleLevel).toBe(3);
    expect(ROLE_XP_LEVELS).toEqual([0, 10, 30]);
  });

  it('level-2 foragers bank 2 berries per bite', () => {
    const { world } = calmWorld();
    const colony = new Colony(); // berries 20
    const bush = { x: 5, y: 0, z: 5, berries: [], available: 5, regenTimer: 0 };
    const c = calmCitizen('Fern', 'forager');
    c.roleLevel = 2;
    c.dweeb.body._p = { x: 5, y: 0, z: 5 };
    c.state = CITIZEN_STATES.FORAGE;
    c.targetEntity = bush;
    c.targetPos.set(5, 0, 5);
    c.stateTimer = 30;
    c._eatAcc = 0.99;
    c.update(0.1, world, [], colony);
    expect(colony.resources.berries).toBe(22);
    expect(c.roleXp).toBe(1);
  });

  it('level-2 builders finish in 4.5s at the hammer site and free their claim', () => {
    const { world, bm } = calmWorld();
    const colony = richColony();
    colony.queueBuild('tent');
    const mk = (level) => {
      const c = calmCitizen('Bob', 'builder');
      c.roleLevel = level;
      c.dweeb.body._p = { x: 6, y: 0, z: 6 };
      c.state = CITIZEN_STATES.BUILD;
      c.targetEntity = 'tent';
      c.targetPos.set(6, 0, 6);
      c.stateTimer = 30;
      c._buildAcc = 4.4;
      colony.claimBuild(c);
      return c;
    };
    // Level 1: 4.6s of hammering is not enough.
    const rookie = mk(1);
    rookie.update(0.2, world, [], colony);
    expect(bm.placedStructures.length).toBe(0);
    colony.releaseBuild(rookie);
    // Level 2: done in 4.6s, at the hammer site.
    const pro = mk(2);
    pro.update(0.2, world, [], colony);
    expect(bm.placedStructures.length).toBe(1);
    const s = bm.placedStructures[0];
    expect(s.pos.x).toBeCloseTo(6, 5);
    expect(s.pos.z).toBeCloseTo(6, 5);
    expect(pro.roleXp).toBe(3);
    // Regression: the finished claim is released, so the blueprint can be
    // queued and claimed again.
    colony.queueBuild('tent');
    const c2 = calmCitizen('Bob2', 'builder');
    expect(colony.claimBuild(c2)).toBe('tent');
  });

  it('level-2 defenders bonk faster; level-3 fear aura routs critters', () => {
    const { world } = calmWorld();
    const colony = richColony();
    const mk = (level) => {
      const c = calmCitizen('Shieldy', 'defender');
      c.roleLevel = level;
      c.state = CITIZEN_STATES.GUARD;
      c.stateTimer = 30;
      c._bonkAcc = 1.2;
      return c;
    };
    const crit = world.spawnCritter();
    crit.x = 1; crit.z = 0;
    const rookie = mk(1);
    rookie.update(0.2, world, [], colony);
    expect(crit.hp).toBe(2); // 1.4s < 1.5s interval: no bonk yet
    const vet = mk(2);
    vet.update(0.2, world, [], colony);
    expect(crit.hp).toBe(1); // 1.4s >= 1.0s interval: bonk!
    // Fear aura: a level-3 defender routs a nearby critter without touching it.
    const legend = mk(3);
    const c2 = world.spawnCritter();
    c2.x = 3; c2.z = 0;
    legend.update(0.2, world, [], colony);
    expect(c2.state).toBe('flee');
  });

  it('level-2 tinkerers learn faster; level-3 sells a gizmo a minute', () => {
    const { world } = calmWorld();
    const colony = richColony();
    const teacher = calmCitizen('Teach');
    const mk = (level) => {
      // 'builder' personality => learningSpeed 1.0, deterministic rates.
      const c = calmCitizen('Tink', 'tinkerer', 'builder');
      c.roleLevel = level;
      return c;
    };
    const l1 = mk(1);
    l1.observePeer(teacher, 'bounce', 1);
    expect(l1.learningProgress.bounce).toBeCloseTo(0.375, 5);
    const l2 = mk(2);
    l2.observePeer(teacher, 'bounce', 1);
    expect(l2.learningProgress.bounce).toBeCloseTo(0.5625, 5);
    const l3 = mk(3);
    l3._gizmoAcc = 59.9;
    l3.update(0.2, world, [], colony);
    expect(colony.resources.gold).toBe(1);
  });

  it('role XP and level survive save/restore', () => {
    const storage = fakeStorage();
    const colony = new Colony();
    const c = calmCitizen('Fern', 'forager');
    c.addRoleXp(35);
    colony.citizens.push(c);
    saveVillage({ colony, buildingManager: null, world: null }, storage);
    const save = loadVillage(storage);
    const colony2 = new Colony();
    colony2.addCitizen({ name: 'Fern', body: fakeBody() });
    applySave(save, { colony: colony2, buildingManager: null, world: null });
    expect(colony2.citizens[0].roleXp).toBe(35);
    expect(colony2.citizens[0].roleLevel).toBe(3);
  });
});

describe('seasons and moon phases', () => {
  it('midnight wraps the day counter and turns the season every 4 days', () => {
    const { world } = calmWorld();
    const colony = new Colony();
    world.dayCount = 3;
    world.timeOfDay = 23.9;
    world.update(2, [], colony); // +0.2h -> wraps past midnight
    expect(world.dayCount).toBe(4);
    expect(world.season).toBe('autumn');
    expect(colony.historyLog.some(e => e.text.includes('Autumn'))).toBe(true);
    expect(SEASONS).toContain(world.season);
  });

  it('spring regrows berries 1.5x; winter halves regrowth', () => {
    const mk = (dayCount) => {
      const { world } = calmWorld();
      world.dayCount = dayCount;
      const bush = { x: 0, y: 0, z: 0, berries: [], available: 0, regenTimer: 0 };
      world.berryBushes = [bush];
      return { world, bush };
    };
    const spring = mk(12); // spring
    expect(spring.world.season).toBe('spring');
    spring.world.update(14, [], null);
    expect(spring.bush.available).toBe(1); // 14s >= 20/1.5 = 13.33s

    const winter = mk(8); // winter
    expect(winter.world.season).toBe('winter');
    winter.world.update(39, [], null);
    expect(winter.bush.available).toBe(0); // 39s < 20*2 = 40s
  });

  it('new moon doubles the critter arrival rate', () => {
    const { world } = calmWorld();
    world.dayCount = 0; // moonPhase 0 = new moon
    world.critterTimer = 2;
    world.update(1, [], null);
    expect(world.critters.length).toBe(1);
    const w2 = calmWorld().world;
    w2.dayCount = 1; // moonPhase 1
    w2.critterTimer = 2;
    w2.update(1, [], null);
    expect(w2.critters.length).toBe(0);
  });

  it('day count round-trips through save/restore', () => {
    const { world } = worldWithManager();
    world.dayCount = 9;
    const data = world.serialize();
    const world2 = new Meadowlands(null, new THREE.Scene());
    world2.restore(data);
    expect(world2.dayCount).toBe(9);
    expect(world2.season).toBe('winter');
  });
});

describe('festivals', () => {
  it('a festival fires on day 2 at dusk when berries allow, then ends', () => {
    const { world } = calmWorld();
    const colony = new Colony();
    colony.resources.berries = 20;
    colony.citizens.push(calmCitizen('A'), calmCitizen('B'));
    world.dayCount = 2;
    world.timeOfDay = 17.5;
    colony.update(0.1, world);
    expect(colony.festival.active).toBe(true);
    expect(colony.resources.berries).toBe(10);
    expect(colony.historyLog[0].text).toContain('Festival');
    // It does not re-fire the same day.
    colony.festival.active = false;
    colony.update(0.1, world);
    expect(colony.festival.active).toBe(false);
    // A fresh festival runs its 60 seconds and winds down.
    colony.lastFestivalDay = -1;
    world.dayCount = 5;
    colony.update(0.1, world);
    expect(colony.festival.active).toBe(true);
    colony.update(61, world);
    expect(colony.festival.active).toBe(false);
  });

  it('citizens drop work to mingle while the festival lasts', () => {
    const { world } = calmWorld();
    const colony = new Colony();
    const a = calmCitizen('A');
    const b = calmCitizen('B');
    colony.citizens.push(a, b);
    colony.festival.active = true;
    colony.festival.timer = 60;
    a._selectNextGoal(world, [b], colony);
    expect(a.state).toBe(CITIZEN_STATES.SOCIALIZE);
  });

  it('friendships form 3x as fast during a festival', () => {
    const { world } = calmWorld();
    const colony = new Colony();
    const b = calmCitizen('B');
    const bond = () => {
      const x = calmCitizen('A');
      x.state = CITIZEN_STATES.SOCIALIZE;
      x.targetEntity = b;
      x.targetPos.set(0, 0, 0);
      x.stateTimer = 30;
      x.update(1, world, [b], colony);
      return x.friends.get('B') || 0;
    };
    const plain = bond();
    colony.festival.active = true;
    colony.festival.timer = 60;
    const festive = bond();
    expect(festive).toBeGreaterThan(plain * 2);
  });
});

describe('new expedition POIs', () => {
  it('launched expeditions visit all five points of interest', () => {
    const colony = new Colony();
    colony.citizens.push(calmCitizen('Scout'));
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      colony.launchExpedition(null);
      seen.add(colony.citizens[0]._expeditionHaul.poi);
    }
    expect([...seen].sort()).toEqual([
      'the Ancient Ruin',
      'the Crystal Hollow',
      'the Gauntlet of Springs',
      'the Geyser Gorge',
      'the Lookout Bluff',
      'the Old Wooden Bridge',
      'the Sentry Vault Ruin',
    ]);
  });
});

describe('stale build-claim regression', () => {
  it('a finished claim releases so the same blueprint can be re-queued and claimed', () => {
    const { world } = calmWorld();
    const colony = richColony();
    colony.queueBuild('tent');
    const c1 = calmCitizen('Bob', 'builder');
    expect(colony.claimBuild(c1)).toBe('tent');
    // Builder finishes: claim released via the builder param.
    expect(colony._completeBuild('tent', world, { x: 1, y: 0, z: 1 }, c1)).toBe(true);
    colony.queueBuild('tent');
    const c2 = calmCitizen('Bob2', 'builder');
    expect(colony.claimBuild(c2)).toBe('tent');
  });
});

describe('organic ruin integration', () => {
  it('defenders patrol to the sentry vault and open it on their own', () => {
    const { world } = calmWorld();
    const colony = richColony();
    const d = calmCitizen('Sentry', 'defender');
    d.dweeb.moveInput = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
    d.dweeb.body._p = { x: 20, y: 0, z: 18 }; // start near the sentry ruin
    colony.citizens.push(d);
    const sentry = world.ruins.find(r => r.kind === 'guard');
    expect(sentry.x).toBe(26);
    // Drive the citizen with real movement for up to 3 sim-minutes, keeping
    // needs topped up so duty is never interrupted.
    for (let i = 0; i < 60 * 180 && !sentry.opened; i++) {
      if (i % 600 === 0) { d.hunger = 0; d.energy = 100; d.curiosity = 0; d.social = 0; }
      d.update(1 / 60, world, [], colony);
      world._updateRuins(1 / 60, [], colony);
      const mi = d.dweeb.moveInput;
      d.dweeb.body._p.x += mi.x * 4.2 / 60;
      d.dweeb.body._p.z += mi.y * 4.2 / 60;
    }
    expect(sentry.opened).toBe(true);
    expect(colony.resources.gold).toBeGreaterThan(0);
  });
});
