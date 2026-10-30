// WarfareAudio.js — procedural WebAudio SFX for Dweeb Warfare. No sample files, so it works
// offline from the first load. Hits, pops, booms, rocket thoomps, slams, grabs, wave horns,
// boss drone, win fanfare, lose trombone, UI clicks. Mute persists in localStorage.
const KEY = 'dweebs-warfare-muted';
const store = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} };
const LIMITS = { hit: 14, death: 8, explode: 6, fire: 8, slam: 4, grab: 4, convert: 4, fortHit: 4, recruit: 6, warhorn: 2, repair: 2, trap: 4 };

export class WarfareAudio {
  constructor({ enabled = true } = {}) {
    this.ctx = null;
    this.enabled = enabled;
    this.muted = store.getItem(KEY) === '1';
    this.listenerX = 0;
    this.budget = {};
    this.budgetT = 0;
  }

  /** Create/resume the context. Call from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted || !this.enabled ? 0 : 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = !!m;
    store.setItem(KEY, this.muted ? '1' : '0');
    this._applyGain();
  }

  setEnabled(on) { this.enabled = !!on; this._applyGain(); }

  _applyGain() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted || !this.enabled ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  get live() { return !!this.ctx && !this.muted && this.enabled; }

  _out(x) {
    const c = this.ctx;
    if (x === undefined || !c.createStereoPanner) return this.master;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-0.9, Math.min(0.9, (x - this.listenerX) / 28));
    p.connect(this.master);
    return p;
  }

  _tone({ type = 'sine', f0, f1 = f0, dur, vol = 0.3, at = 0, x, attack = 0.005, filter }) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const bq = c.createBiquadFilter();
      bq.type = 'lowpass';
      bq.frequency.value = filter;
      o.connect(bq);
      node = bq;
    }
    node.connect(g).connect(this._out(x));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise({ dur, vol = 0.3, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, at = 0, x }) {
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bq = c.createBiquadFilter();
    bq.type = type;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bq).connect(g).connect(this._out(x));
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  _take(kind) {
    const now = this.ctx.currentTime;
    if (now - this.budgetT > 0.25) { this.budget = {}; this.budgetT = now; }
    const n = this.budget[kind] = (this.budget[kind] || 0) + 1;
    return n <= Math.ceil((LIMITS[kind] || 6) / 4);
  }

  // ── one-shots ──
  hit(x, heavy = false) {
    const r = 0.85 + Math.random() * 0.3;
    this._noise({ dur: 0.07, vol: heavy ? 0.35 : 0.22, f0: 1700 * r, q: 2, x });
    this._tone({ type: 'square', f0: 260 * r, f1: 140 * r, dur: 0.06, vol: 0.06, x });
  }
  pop(x, big = false) {
    const r = 0.9 + Math.random() * 0.25;
    this._tone({ type: 'sine', f0: (big ? 500 : 950) * r, f1: (big ? 90 : 180) * r, dur: big ? 0.35 : 0.14, vol: 0.28, x });
    this._noise({ dur: 0.05, vol: 0.2, f0: 3000, q: 1, x });
  }
  boom(x, big = false) {
    this._noise({ dur: big ? 0.8 : 0.45, vol: big ? 0.6 : 0.4, type: 'lowpass', f0: big ? 1400 : 1000, f1: 90, q: 0.7, x });
    this._tone({ type: 'sine', f0: big ? 110 : 140, f1: 38, dur: big ? 0.55 : 0.3, vol: big ? 0.55 : 0.35, x });
  }
  thoomp(x) {
    this._noise({ dur: 0.18, vol: 0.18, f0: 380, f1: 1300, q: 3, x });
    this._tone({ type: 'triangle', f0: 180, f1: 90, dur: 0.12, vol: 0.12, x });
  }
  slam(x, boss = false) {
    this._tone({ type: 'sine', f0: boss ? 70 : 95, f1: 32, dur: boss ? 0.5 : 0.3, vol: boss ? 0.6 : 0.4, x });
    this._noise({ dur: 0.25, vol: 0.3, type: 'lowpass', f0: 500, f1: 80, x });
  }
  grab(x) { this._tone({ type: 'triangle', f0: 480, f1: 900, dur: 0.12, vol: 0.18, x }); }
  convert(x) {
    [660, 880, 1320].forEach((f, i) => this._tone({ type: 'triangle', f0: f, dur: 0.12, vol: 0.16, at: i * 0.06, x }));
  }
  recruit() { this._tone({ type: 'sine', f0: 300, f1: 620, dur: 0.09, vol: 0.2 }); }
  fortThunk() { this._tone({ type: 'square', f0: 120, f1: 70, dur: 0.12, vol: 0.12, filter: 600 }); }
  click() { if (this.live) this._tone({ type: 'sine', f0: 1250, f1: 900, dur: 0.04, vol: 0.12 }); }
  deny() { if (!this.live) return; this._tone({ type: 'square', f0: 210, dur: 0.08, vol: 0.12, filter: 900 }); this._tone({ type: 'square', f0: 160, dur: 0.1, vol: 0.12, at: 0.1, filter: 900 }); }
  waveStart(boss = false) {
    if (!this.live) return;
    if (boss) {
      for (const f of [55, 58.3]) this._tone({ type: 'sawtooth', f0: f, dur: 1.6, vol: 0.22, attack: 0.25, filter: 420 });
      [220, 207, 196].forEach((f, i) => this._tone({ type: 'sawtooth', f0: f, dur: 0.4, vol: 0.14, at: 0.2 + i * 0.35, filter: 1200 }));
    } else {
      [392, 523.3].forEach((f, i) => this._tone({ type: 'sawtooth', f0: f, dur: i ? 0.5 : 0.22, vol: 0.16, at: i * 0.2, attack: 0.03, filter: 1800 }));
    }
  }
  waveClear() {
    if (!this.live) return;
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => this._tone({ type: 'square', f0: f, dur: 0.16, vol: 0.09, at: i * 0.08, filter: 3000 }));
  }
  enrage() { if (!this.live) return; this._tone({ type: 'sawtooth', f0: 90, f1: 45, dur: 0.9, vol: 0.3, filter: 700 }); this._noise({ dur: 0.6, vol: 0.25, type: 'lowpass', f0: 800, f1: 100 }); }
  warhorn(x) {
    if (!this.live) return;
    [196, 261.6, 329.6].forEach((f, i) => this._tone({ type: 'sawtooth', f0: f * 0.99, f1: f, dur: 0.5, vol: 0.16, at: i * 0.16, attack: 0.06, filter: 1400, x }));
  }
  mend(x) {
    if (!this.live) return;
    [880, 1174.7].forEach((f, i) => this._tone({ type: 'triangle', f0: f, dur: 0.12, vol: 0.18, at: i * 0.09, x }));
    this._noise({ dur: 0.08, vol: 0.14, f0: 2400, q: 3, x });
  }
  trapSnap(x) {
    if (!this.live) return;
    this._noise({ dur: 0.1, vol: 0.3, f0: 3200, f1: 700, q: 2, x });
    this._tone({ type: 'square', f0: 180, f1: 90, dur: 0.1, vol: 0.14, filter: 900, x });
  }
  win() {
    if (!this.live) return;
    [523.3, 659.3, 784, 1046.5, 784, 1046.5].forEach((f, i) => this._tone({ type: 'square', f0: f, dur: i === 5 ? 0.7 : 0.16, vol: 0.1, at: i * 0.13, filter: 3200 }));
    for (const f of [523.3, 659.3, 784]) this._tone({ type: 'triangle', f0: f, dur: 1.2, vol: 0.1, at: 0.8 });
  }
  lose() {
    if (!this.live) return;
    const notes = [[392, 370], [370, 349], [349, 330], [330, 262]];
    notes.forEach(([a, b], i) => this._tone({ type: 'sawtooth', f0: a, f1: b, dur: i === 3 ? 1.1 : 0.42, vol: 0.16, at: i * 0.45, attack: 0.03, filter: 1100 }));
  }

  /** React to a tick's sim events (rate-limited so 100-unit brawls don't clip). */
  events(events, team) {
    if (!this.live) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'hit': if (this._take('hit')) this.hit(ev.x, ev.dmg > 40); break;
        case 'death': if (this._take('death')) this.pop(ev.x, ev.unit === 'boss' || ev.unit === 'brute'); break;
        case 'explode': if (this._take('explode')) this.boom(ev.x, !!ev.big); break;
        case 'fire': if (this._take('fire')) this.thoomp(ev.x); break;
        case 'slam': if (this._take('slam')) this.slam(ev.x, ev.unit === 'boss'); break;
        case 'grab': if (this._take('grab')) this.grab(ev.x); break;
        case 'convert': if (this._take('convert')) this.convert(ev.x); break;
        case 'artillery': if (this._take('explode')) this.boom(ev.x, true); break;
        case 'recruit': if (ev.team === team && this._take('recruit')) this.recruit(); break;
        case 'fortHit': if (ev.team === team && this._take('fortHit')) this.fortThunk(); break;
        case 'waveStart': this.waveStart(ev.boss); break;
        case 'waveClear': this.waveClear(); break;
        case 'enrage': this.enrage(); break;
        case 'warhorn': if (this._take('warhorn')) this.warhorn(ev.x); break;
        case 'repair': if (this._take('repair')) this.mend(ev.x); break;
        case 'trap': if (this._take('trap')) this.trapSnap(ev.x); break;
        default: break;
      }
    }
  }

  dispose() {
    try { this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
  }
}
