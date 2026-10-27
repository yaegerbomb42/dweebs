// adventure-colony.test.js — roles, moods, routines, friendships, stunt reactions.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Colony } from '../src/adventure/colony.js';
import { Citizen, ROLES, MOODS, PERSONALITIES } from '../src/adventure/citizen.js';

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

function fakeDweeb(name, x = 0, y = 0, z = 0) {
  return { name, body: fakeBody(x, y, z), controllerInput: null };
}

/** A world stub with the pieces citizens read. */
function fakeWorld(over = {}) {
  return {
    berryBushes: [{ x: 5, y: 0, z: 5, available: 5 }],
    springPads: [],
    buildingManager: { placedStructures: [] },
    critters: [],
    stuntFeed: [],
    timeOfDay: 12,
    ...over,
  };
}

function colonyWith(names) {
  const colony = new Colony();
  for (const n of names) colony.addCitizen(fakeDweeb(n, 0, 0, 0));
  return colony;
}

describe('roles', () => {
  it('every role id is assignable and rejects bad ids', () => {
    const colony = colonyWith(['Blorp']);
    const c = colony.citizens[0];
    expect(c.role).toBeNull();
    for (const id of Object.keys(ROLES)) {
      expect(colony.assignRole(c, id)).toBe(true);
      expect(c.role).toBe(id);
    }
    expect(colony.assignRole(c, 'wizard')).toBe(false);
    expect(c.role).toBe('tinkerer'); // unchanged by the bad id
    expect(colony.assignRole(c, null)).toBe(true);
    expect(c.role).toBeNull();
  });

  it('a builder picks up the next queued blueprint', () => {
    const colony = colonyWith(['Mason']);
    const c = colony.citizens[0];
    colony.assignRole(c, 'builder');
    colony.queueBuild('tent');
    const world = fakeWorld();
    c._selectNextGoal(world, colony.citizens, colony);
    expect(c.state).toBe('BUILD');
    expect(c.targetEntity).toBe('tent');
  });

  it('a builder with an empty queue does not enter BUILD', () => {
    const colony = colonyWith(['Mason']);
    const c = colony.citizens[0];
    colony.assignRole(c, 'builder');
    const world = fakeWorld();
    c._selectNextGoal(world, colony.citizens, colony);
    expect(c.state).not.toBe('BUILD');
  });

  it('queueBuild rejects unknown ids and duplicates', () => {
    const colony = colonyWith(['Mason']);
    expect(colony.queueBuild('tent')).toBe(true);
    expect(colony.queueBuild('tent')).toBe(false);
    expect(colony.queueBuild('warp-drive')).toBe(false);
    expect(colony.cancelBuild('tent')).toBe(true);
    expect(colony.buildQueue.length).toBe(0);
  });

  it('a builder finishes the build after 6s of hammering (cost paid, queue cleared)', () => {
    const colony = colonyWith(['Mason']);
    colony.resources = { wood: 50, berries: 50, stone: 50, gold: 0 };
    const c = colony.citizens[0];
    colony.assignRole(c, 'builder');
    colony.queueBuild('tent');
    const built = [];
    const world = fakeWorld({
      buildingManager: {
        placedStructures: [],
        _instantiateStructure: (id, pos) => {
          const s = { id, pos, group: {}, colliders: [] };
          built.push(s);
          return s;
        },
      },
    });
    c._selectNextGoal(world, colony.citizens, colony);
    expect(c.state).toBe('BUILD');
    // Stand on the build site and hammer.
    const p = c.targetPos;
    c.dweeb.body._p = { x: p.x, y: p.y, z: p.z };
    for (let i = 0; i < 60 * 7; i++) c.update(1 / 60, world, colony.citizens, colony);
    expect(built.length).toBe(1);
    expect(built[0].id).toBe('tent');
    expect(colony.buildQueue.length).toBe(0);
    expect(colony.resources.wood).toBe(50 - 3);
  });

  it('a builder cannot build what the village cannot afford', () => {
    const colony = colonyWith(['Mason']);
    colony.resources = { wood: 0, berries: 0, stone: 0, gold: 0 };
    colony.queueBuild('tent');
    const world = fakeWorld({
      buildingManager: {
        placedStructures: [],
        _instantiateStructure: () => ({ id: 'tent', pos: {}, group: {}, colliders: [] }),
      },
    });
    expect(colony._completeBuild('tent', world)).toBe(false);
    expect(colony.buildQueue.length).toBe(1); // stays queued
  });

  it('a forager banks berries into the village stores', () => {
    const colony = colonyWith(['Pip']);
    const c = colony.citizens[0];
    colony.assignRole(c, 'forager');
    const bush = { x: 5, y: 0, z: 5, available: 5 };
    const world = fakeWorld({ berryBushes: [bush] });
    c.state = 'FORAGE';
    c.targetEntity = bush;
    c.targetPos.set(5, 0, 5);
    c.stateTimer = 100; // hold the state for the whole test
    c.dweeb.body._p = { x: 5, y: 0, z: 5 };
    const before = colony.resources.berries;
    for (let i = 0; i < 60 * 3; i++) c.update(1 / 60, world, colony.citizens, colony);
    expect(bush.available).toBeLessThan(5);
    expect(colony.resources.berries).toBeGreaterThan(before);
  });

  it('a defender patrols the cannon and bonks critters for gold', () => {
    const colony = colonyWith(['Guard']);
    const c = colony.citizens[0];
    colony.assignRole(c, 'defender');
    const critter = { x: 1, y: 0, z: 0, hp: 1, speed: 2, mesh: null };
    const world = fakeWorld({
      critters: [critter],
      buildingManager: { placedStructures: [{ id: 'cannon', pos: { x: 0, y: 0, z: 0 } }] },
      removeCritter(c) {
        const i = this.critters.indexOf(c);
        if (i !== -1) this.critters.splice(i, 1);
      },
    });
    c.state = 'GUARD';
    c.targetPos.set(0, 0, 0);
    c.stateTimer = 100; // hold the state for the whole test
    c.dweeb.body._p = { x: 0, y: 0, z: 0 };
    const gold0 = colony.resources.gold;
    for (let i = 0; i < 60 * 4; i++) c.update(1 / 60, world, colony.citizens, colony);
    expect(world.critters.length).toBe(0);
    expect(colony.resources.gold).toBe(gold0 + 1);
  });

  it('a tinkerer learns from peers 1.5x faster', () => {
    const colony = colonyWith(['Tink', 'Teach']);
    const tink = colony.citizens[0];
    const teach = colony.citizens[1];
    // Pin both to the same personality so the comparison isolates the role bonus.
    tink.personality = PERSONALITIES.find(p => p.id === 'cozy');
    colony.assignRole(tink, 'tinkerer');
    teach.knownVerbs.add('bounce');
    tink.observePeer(teach, 'bounce', 1);
    const tinkProgress = tink.learningProgress.bounce;
    const plain = new Citizen(fakeDweeb('Plain'), {});
    plain.personality = PERSONALITIES.find(p => p.id === 'cozy');
    plain.observePeer(teach, 'bounce', 1);
    expect(tinkProgress).toBeCloseTo(plain.learningProgress.bounce * 1.5, 5);
  });
});

describe('moods & speech bubbles', () => {
  it('mood follows needs: tired, hungry, happy', () => {
    const colony = colonyWith(['Moody']);
    const c = colony.citizens[0];
    const world = fakeWorld();
    c.energy = 10; c.hunger = 10;
    c.update(0.1, world, colony.citizens, colony);
    expect(c.mood).toBe('tired');
    expect(c.moodIcon).toBe(MOODS.tired.icon);
    c.energy = 90; c.hunger = 80;
    c.update(0.1, world, colony.citizens, colony);
    expect(c.mood).toBe('hungry');
    c.hunger = 10;
    c.update(0.1, world, colony.citizens, colony);
    expect(c.mood).toBe('happy');
  });

  it('say() shows a bubble, then it falls back to the mood', () => {
    const colony = colonyWith(['Chatty']);
    const c = colony.citizens[0];
    const world = fakeWorld();
    c.say('Hello there!', '👋', 1);
    expect(c.bubbleText().icon).toBe('👋');
    expect(c.bubbleText().text).toBe('Hello there!');
    c.update(2, world, colony.citizens, colony); // bubble expired
    expect(c.bubbleText().icon).toBe(MOODS[c.mood].icon);
  });

  it('a nearby bounce makes citizens excited with a comic line', () => {
    const colony = colonyWith(['Watcher']);
    const c = colony.citizens[0];
    const world = fakeWorld();
    c.clock = 10;
    world.stuntFeed = [{ type: 'bounce', x: 1, z: 1, at: 10 }];
    c.dweeb.body._p = { x: 0, y: 0, z: 0 };
    c.update(0.1, world, colony.citizens, colony);
    expect(c.mood).toBe('excited');
    expect(c.bubbleText().text).toMatch(/bounce/i);
    // A far-away stunt gets no reaction.
    const far = colonyWith(['FarAway']);
    const f = far.citizens[0];
    f.clock = 10;
    f.dweeb.body._p = { x: 100, y: 0, z: 100 };
    f.update(0.1, world, far.citizens, far);
    expect(f.mood).not.toBe('excited');
  });

  it('learning a verb is exciting', () => {
    const colony = colonyWith(['Bright']);
    const c = colony.citizens[0];
    c.learnVerb('bounce');
    expect(c.moodTimer).toBeGreaterThan(0);
    c.update(0.1, fakeWorld(), colony.citizens, colony);
    expect(c.mood).toBe('excited');
  });
});

describe('friendships', () => {
  it('chatting builds a bond and names a best friend', () => {
    const colony = colonyWith(['A', 'B']);
    const a = colony.citizens[0];
    const b = colony.citizens[1];
    const world = fakeWorld();
    a.state = 'SOCIALIZE';
    a.targetEntity = b;
    a.targetPos.set(0, 0, 0);
    a.stateTimer = 100; // hold the state for the whole test
    a.dweeb.body._p = { x: 0, y: 0, z: 0 };
    b.dweeb.body._p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 60 * 20; i++) a.update(1 / 60, world, colony.citizens, colony);
    expect(a.friends.get('B')).toBeGreaterThan(50);
    expect(a.bestFriend).toBe('B');
    expect(colony.historyLog.some(e => e.text.includes('best buds'))).toBe(true);
  });
});

describe('time-of-day routines', () => {
  it('at night citizens head to rest', () => {
    const colony = colonyWith(['NightOwl']);
    const c = colony.citizens[0];
    c.energy = 50;
    const world = fakeWorld({ timeOfDay: 23 });
    c._selectNextGoal(world, colony.citizens, colony);
    expect(c.state).toBe('REST');
  });

  it('in the evening citizens gather to sing', () => {
    const colony = colonyWith(['Singer']);
    const c = colony.citizens[0];
    c.social = 80;
    c.energy = 90;
    c.hunger = 10;
    const world = fakeWorld({ timeOfDay: 18 });
    c._selectNextGoal(world, colony.citizens, colony);
    expect(c.state).toBe('SING');
    // Singing at the fire drains social and lifts energy.
    c.targetPos.set(0, 0, 0);
    c.dweeb.body._p = { x: 0, y: 0, z: 0 };
    const social0 = c.social;
    for (let i = 0; i < 60 * 2; i++) c.update(1 / 60, world, colony.citizens, colony);
    expect(c.social).toBeLessThan(social0);
    expect(c.activityText).toMatch(/Singing/);
  });

  it('a forager heads out earlier in the morning than a plain citizen', () => {
    const colony = colonyWith(['Early']);
    const c = colony.citizens[0];
    colony.assignRole(c, 'forager');
    c.hunger = 60; // below the plain 70 line, above the forager 55 line
    const world = fakeWorld({ timeOfDay: 8 });
    c._selectNextGoal(world, colony.citizens, colony);
    expect(c.state).toBe('FORAGE');
  });
});

describe('colony serialize / restore', () => {
  it('round-trips resources, roles, verbs, hats and friendships', () => {
    const colony = colonyWith(['Keeper']);
    const c = colony.citizens[0];
    colony.assignRole(c, 'forager');
    colony.resources.gold = 42;
    colony.hats.push('🎩 Top Hat');
    colony.tools.push('🔧 Wobbly Wrench');
    colony.queueBuild('silo');
    c.friends.set('Ghost', 77);
    const data = colony.serialize();
    const colony2 = colonyWith(['Keeper']);
    colony2.restore(data);
    expect(colony2.resources.gold).toBe(42);
    expect(colony2.hats).toEqual(['🎩 Top Hat']);
    expect(colony2.buildQueue).toEqual(['silo']);
    expect(colony2.citizens[0].role).toBe('forager');
    expect(colony2.citizens[0].friends.get('Ghost')).toBe(77);
  });
});

describe('REPAIR — fixing damaged toy-town landmarks', () => {
  it('a builder-biased citizen marches to a damaged landmark and hammers it fixed', () => {
    let repairs = 0;
    const damaged = {
      name: 'Breakable Toy Fort',
      repairPoint: new THREE.Vector3(0, 0, 0),
      repairStep: () => { repairs += 1; return repairs < 3; },
    };
    const world = fakeWorld({ toyTown: { getDamaged: () => (repairs < 3 ? [damaged] : []) } });
    const builderPersonality = PERSONALITIES.find(p => (p.buildingBias || 0) >= 1.8);
    const c = new Citizen(fakeDweeb('Mason', 0, 0, 0), { personality: builderPersonality });
    c.hunger = 10;
    c.energy = 80;

    c._selectNextGoal(world, [], null);
    expect(c.state).toBe('REPAIR');
    expect(c.targetEntity).toBe(damaged);

    // Three hammer swings: the third finishes the repair.
    for (let i = 0; i < 3; i++) c.update(1 / 60, world, [], null);
    expect(repairs).toBe(3);
    expect(c.activityText).toMatch(/patched up/);
    expect(c.repairHammer).not.toBeNull();
  });

  it('a low-building-bias citizen ignores damaged landmarks', () => {
    const damaged = {
      name: 'Breakable Toy Fort',
      repairPoint: new THREE.Vector3(0, 0, 0),
      repairStep: () => true,
    };
    const world = fakeWorld({ toyTown: { getDamaged: () => [damaged] } });
    const cozyPersonality = PERSONALITIES.find(p => (p.buildingBias || 0) < 1.4);
    const c = new Citizen(fakeDweeb('Cozy', 0, 0, 0), { personality: cozyPersonality });
    c.hunger = 10;
    c.energy = 80;

    c._selectNextGoal(world, [], null);
    expect(c.state).not.toBe('REPAIR');
  });
});
