import { describe, expect, it } from 'vitest';
import { NetClient } from '../src/net/NetClient.js';
import { makeCodec } from '../src/net/protocol.js';
import { wireEntities } from '../server/snapshot.js';

const entity = (id, x = 0) => ({ id, x, y: 0, z: 0, q: 0, vx: 0, vy: 0, vz: 0, flags: 0, state: 0 });
const snapshot = (tick, entities, full = false) => ({ t: 'snapshot', tick, entities, full });

describe('network snapshot reconstruction', () => {
  for (const spectator of [false, true]) {
    it(`retains unchanged entities in interpolation frames (${spectator ? 'spectator' : 'player'})`, () => {
      const c = new NetClient();
      c.spectating = spectator;
      c.slot = spectator ? -1 : 0;
      c.handle({ t: 'room', phase: 'playing', players: [] });
      c.onSnapshot(snapshot(2, [entity(1), entity(2, 100)], true));
      c.onSnapshot(snapshot(4, [entity(1, 20)]));
      c.onSnapshot(snapshot(6, []));
      expect(c.snapBuffer.at(-1).entities.map(e => e.id)).toEqual([1, 2]);
      expect(c.snapBuffer.at(-1).entities.find(e => e.id === 2).x).toBe(1);
      c.onSnapshot(snapshot(8, [entity(1)], true));
      expect(c.snapBuffer.at(-1).entities.map(e => e.id)).toEqual([1]);
      c.onSnapshot(snapshot(7, [entity(2)]));
      expect(c.serverEntities.has(2)).toBe(false);
    });
  }

  it('accepts updates at the same lobby tick without filling the interpolation buffer', () => {
    const c = new NetClient();
    c.spectating = true;
    c.handle({ t: 'room', phase: 'lobby', players: [] });
    c.onSnapshot(snapshot(0, [], true));
    c.onSnapshot(snapshot(0, [entity(1)]));
    expect(c.snapBuffer).toHaveLength(1);
    expect(c.renderEntities().map(e => e.id)).toEqual([1]);
  });

  it('clears the previous timeline and prediction history for a rematch', () => {
    const c = new NetClient();
    c.slot = 0;
    c.handle({ t: 'room', phase: 'playing', players: [] });
    c.onSnapshot(snapshot(100, [entity(1, 100)], true));
    c.history.record(101, {});
    c.handle({ t: 'room', phase: 'lobby', players: [] });
    expect(c.history.size).toBe(0);
    expect(c.serverTick).toBe(0);
    c.onSnapshot(snapshot(0, [entity(1, 300)]));
    c.handle({ t: 'room', phase: 'playing', players: [] });
    c.onSnapshot(snapshot(2, [entity(1, 400)]));
    expect(c.serverTick).toBe(2);
    expect(c.myAuthority().x).toBe(4);
  });
});

describe('server snapshot encoding', () => {
  it('sends own velocity in centimetres for both real and mock simulations', () => {
    const base = { id: 1, kind: 'dweeb', slot: 0, x: 0, y: 0, z: 0, yaw: 0, state: 0, flags: 0 };
    const real = { ...base, _cm: true, vx: 125, vy: -40, vz: 25 };
    const mock = { ...base, vx: 1.25, vy: -0.4, vz: 0.25 };
    const item = { ...base, id: 1000, kind: 'item', slot: -1, flags: 8, vx: 0, vy: 0, vz: 0 };
    const codec = makeCodec('bin');
    for (const player of [real, mock]) {
      const entities = wireEntities([player, item], 0);
      const decoded = codec.decode(codec.encode({ t: 'snapshot', tick: 1, ack: 0, full: true, serverTime: 0, entities }));
      expect(decoded.entities[0]).toMatchObject({ flags: 8, vx: 125, vy: -40, vz: 25 });
      expect(decoded.entities[1].flags & 8).toBe(0);
      expect(wireEntities([player], -1)[0]).toMatchObject({ flags: 0, vx: 0, vy: 0, vz: 0 });
      expect(wireEntities([player, item], 0, false)).toHaveLength(1);
    }
  });
});
