// T1: simView sync helper + T24 determinism/snapshot in vitest (not just tools/).
import { describe, it, expect } from 'vitest';
import { yawToQuat, syncViewFromState } from '../src/sim/simView.js';
import { Sim } from '../src/sim/Sim.js';

describe('simView', () => {
  it('yawToQuat is a pure Y-rotation (x=z=0, unit length)', () => {
    for (const yaw of [0, 0.5, Math.PI, -1.2, 6.28]) {
      const q = yawToQuat(yaw);
      expect(q.x).toBe(0); expect(q.z).toBe(0);
      expect(Math.hypot(q.y, q.w)).toBeCloseTo(1, 9);
    }
    expect(yawToQuat(0)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
  it('syncViewFromState copies pos/yaw/visibility, never throws on partial views', () => {
    const state = { dweebs: [
      { slot: 0, pos: [1, 2, 3], yaw: 0.7, active: true, out: false, eliminated: false, styleTier: 0 },
      { slot: 1, pos: [4, 5, 6], yaw: 0, active: false, out: true, eliminated: false, styleTier: 0 },
      { slot: 2, pos: [7, 8, 9], yaw: 0, active: false, out: false, eliminated: true, styleTier: 0 },
    ] };
    const mkMesh = () => ({ position: { set(x, y, z) { this.v = [x, y, z]; } }, quaternion: { set(x, y, z, w) { this.q = [x, y, z, w]; } }, visible: true });
    const m0 = mkMesh(), m1 = mkMesh();
    const counts = syncViewFromState(state, [{ mesh: m0 }, { mesh: m1 }, null]);
    expect(m0.position.v).toEqual([1, 2, 3]);
    expect(m0.visible).toBe(true);
    expect(m1.visible).toBe(true); // out but not eliminated: mesh stays (respawn pending)
    expect(counts).toEqual({ visible: 1, out: 1, dead: 1 });
    expect(() => syncViewFromState(state, [])).not.toThrow();
  });
});

describe('T24 determinism + snapshot/restore (in-suite)', () => {
  async function makeSim(seed) {
    const sim = new Sim({ seed, items: true, botDifficulty: 'normal' });
    await sim.init();
    sim.addSeat({ slot: 0, name: 'A', type: 'cube', isBot: true });
    sim.addSeat({ slot: 1, name: 'B', type: 'blob', isBot: true });
    sim.startMatch();
    return sim;
  }
  it('same seed + no inputs => same checksum after 600 ticks', async () => {
    const a = await makeSim(1234), b = await makeSim(1234);
    for (let t = 0; t < 600; t++) { a.step(); b.step(); }
    expect(a.checksum()).toBe(b.checksum());
  }, 30000);
  it('snapshot -> restore -> continue equals uninterrupted run', async () => {
    const a = await makeSim(99), b = await makeSim(99);
    for (let t = 0; t < 200; t++) { a.step(); b.step(); }
    const snap = b.snapshot();
    for (let t = 0; t < 200; t++) a.step();
    b.restore(snap);
    for (let t = 0; t < 200; t++) b.step();
    expect(b.checksum()).toBe(a.checksum());
  }, 30000);
});
