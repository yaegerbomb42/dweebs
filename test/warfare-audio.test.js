// WarfareAudio: safe without WebAudio (node / old browsers), mute persists, rate limiting caps spam.
import { describe, it, expect } from 'vitest';
import { WarfareAudio } from '../src/warfare/WarfareAudio.js';

function fakeCtx() {
  const calls = { osc: 0, noise: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect(n) { return n; }, gain: param(), frequency: param(), Q: param(), pan: param(), type: '' });
  const ctx = {
    currentTime: 0, sampleRate: 100, state: 'running', destination: node(),
    createGain: node, createBiquadFilter: node, createStereoPanner: node,
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), ratio: param() }),
    createOscillator: () => { calls.osc++; return { ...node(), start() {}, stop() {} }; },
    createBufferSource: () => { calls.noise++; return { ...node(), playbackRate: param(), start() {}, stop() {} }; },
    createBuffer: () => ({ getChannelData: () => new Float32Array(100) }),
    resume() {}, close() {},
  };
  return { ctx, calls };
}

describe('warfare audio', () => {
  it('is a silent no-op before unlock and without WebAudio', () => {
    const a = new WarfareAudio();
    expect(a.live).toBe(false);
    expect(() => a.unlock()).not.toThrow();
    expect(() => a.events([{ type: 'hit', x: 0, dmg: 10 }], 'blue')).not.toThrow();
    expect(() => { a.win(); a.lose(); a.click(); a.deny(); a.waveStart(true); }).not.toThrow();
  });
  it('plays sounds for sim events, rate-limits spam, and mute silences everything', () => {
    const a = new WarfareAudio();
    const { ctx, calls } = fakeCtx();
    a.ctx = ctx; a.master = ctx.createGain(); a.noise = ctx.createBuffer();
    a.events([{ type: 'explode', x: 1, big: true }, { type: 'waveStart', boss: false }], 'blue');
    const after = calls.osc + calls.noise;
    expect(after).toBeGreaterThan(2);
    const spam = Array.from({ length: 200 }, () => ({ type: 'hit', x: 0, dmg: 5 }));
    a.events(spam, 'blue');
    expect(calls.osc + calls.noise - after).toBeLessThan(20);
    a.setMuted(true);
    const muted = calls.osc + calls.noise;
    a.events([{ type: 'explode', x: 0 }], 'blue'); a.win();
    expect(calls.osc + calls.noise).toBe(muted);
    expect(a.muted).toBe(true);
  });
});
