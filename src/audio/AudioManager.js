// AudioManager.js — fully procedural audio engine (Web Audio, no sample files).
//
// Signal flow:
//   voices ─► panner ─┬─► sfxBus ─────────────────► compressor ─► master ─► speakers
//                     └─► reverb send ─► convolver ─┘   (stadium-sized generated impulse)
//   loops (crowd, water, rolling, charge hum) ─► ambBus ─► compressor
//   music ─► musicGain ─► master (ducked on big moments)
//
// Impacts use modal synthesis: each material in Materials.js lists resonant partials plus a
// noise "contact" layer. Mass lowers the pitch and adds a body thump; impact speed sets loudness
// and brightness. So a bowling ball, a bottle and a beach ball all sound different for free.

import { getMaterial } from '../physics/Materials.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.enabled = true;
    this.volume = 0.6;
    this.musicEnabled = true;
    this._initialized = false;
    this._budgetStart = 0;
    this._budget = 0;
    this._lastImpact = new WeakMap();
  }

  init() {
    if (this._initialized) return;
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.enabled ? this.volume : 0;
      this.masterGain.connect(ctx.destination);

      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.18;
      this.compressor.connect(this.masterGain);

      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.compressor);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._makeImpulse(2.4, 2.8);
      this.reverbIn = ctx.createGain();
      this.reverbOut = ctx.createGain();
      this.reverbOut.gain.value = 0.55;
      this.reverbIn.connect(this.reverb);
      this.reverb.connect(this.reverbOut);
      this.reverbOut.connect(this.compressor);

      this.ambBus = ctx.createGain();
      this.ambBus.gain.value = 1;
      this.ambBus.connect(this.compressor);

      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = this.musicEnabled ? 0.15 : 0;
      this.musicGain.connect(this.masterGain);

      // Shared noise buffers (read from random offsets instead of allocating per sound)
      this.white = this._makeNoise(2, 'white');
      this.pink = this._makeNoise(4, 'pink');
      this.brown = this._makeNoise(4, 'brown');

      this._initialized = true;
    } catch (e) {
      console.warn('Audio not available:', e);
      this.enabled = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(this.enabled ? v : 0, this.ctx.currentTime, 0.02);
  }

  setEnabled(on) {
    this.enabled = on;
    this.setVolume(this.volume);
  }

  get _ok() {
    return this._initialized && this.enabled && this.ctx.state === 'running';
  }

  /** Cap how many sound events start per 50 ms so pile-ups never turn to mush. */
  _spend(cost = 1) {
    const now = this.ctx.currentTime;
    if (now - this._budgetStart > 0.05) { this._budgetStart = now; this._budget = 0; }
    this._budget += cost;
    return this._budget <= 14;
  }

  // ═══ Physics impacts ═══

  /**
   * Impact between two things. `a`/`b` are { material, mass } (b may be null for stage).
   * speed: relative impact speed (m/s). gain: distance attenuation 0..1.
   */
  impact(a, b, speed, pan = 0, gain = 1, key = null) {
    if (!this._ok || gain < 0.03) return;
    if (key) {
      const now = this.ctx.currentTime;
      const last = this._lastImpact.get(key);
      if (last && now - last.t < 0.07 && speed < last.s * 1.5) return;
      this._lastImpact.set(key, { t: now, s: speed });
    }
    if (!this._spend(1)) return;
    const intensity = clamp((speed - 1) / 13, 0, 1);
    this._modal(a.material, a.mass ?? 1, intensity, pan, gain);
    if (b && b.material !== a.material && intensity > 0.15) this._modal(b.material, b.mass ?? 5, intensity * 0.6, pan, gain * 0.6);
  }

  /** Legacy entry point: force-based impact */
  playImpact(material, force, pan = 0) {
    if (!this._ok) return;
    this._modal(material, 1, clamp(force / 5000, 0, 1), pan, 1);
  }

  _modal(material, mass, intensity, pan, gain) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.002;
    const prof = getMaterial(material === 'splat' ? 'fruit' : material).sound;
    const vol = (0.06 + intensity * 0.55) * gain;
    const pitch = prof.base * clamp(Math.pow(1 / Math.max(mass, 0.05), 0.22), 0.55, 1.7) * rand(0.94, 1.06);
    const out = this._out(pan, 0.12 + intensity * 0.2);

    // Resonant partials — higher ones only ring when hit hard (brightness)
    prof.modes.forEach(([ratio, decay, g], i) => {
      const f = pitch * ratio;
      if (f > 16000) return;
      const bright = i === 0 ? 1 : 0.35 + intensity * 0.65;
      const osc = ctx.createOscillator();
      osc.frequency.value = f * rand(0.995, 1.005);
      const env = ctx.createGain();
      const d = decay * (0.6 + intensity * 0.7);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(vol * g * bright * 0.5, t + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + d + 0.02);
    });

    // Contact noise (the "click" / "thock" / "scrunch")
    const [lo, hi, ng, nd] = prof.noise;
    const center = Math.sqrt(lo * hi);
    this._noiseBurst(out, t, nd * (0.7 + intensity * 0.6), vol * ng * (0.6 + intensity * 0.6), {
      type: 'bandpass', freq: center * (0.8 + intensity * 0.4), Q: clamp(center / (hi - lo) * 2, 0.4, 6),
    });

    // Heavy things get a body thump
    if (mass > 1.2) {
      const thump = clamp(mass / 4, 0.2, 1) * vol;
      this._toneAt(out, t, 95 / Math.sqrt(mass / 1.2 + 0.5), 0.12 + mass * 0.02, thump, 'sine', 38);
    }
    // Comic bounce for rubber
    if (prof.bounce && intensity > 0.12) {
      this._toneAt(out, t, pitch * 1.6, 0.14 + intensity * 0.1, vol * 0.35, 'triangle', pitch * 0.9);
    }
    // Wet splat for fruit
    if (prof.splat && intensity > 0.3) {
      this._noiseBurst(out, t + 0.01, 0.18, vol * 0.6, { type: 'lowpass', freq: 2400, endFreq: 300, Q: 3 });
    }
  }

  // ═══ Continuous loops ═══

  /** Crowd murmur + lapping water; call once when a match starts. */
  startAmbience() {
    if (!this._initialized || this._amb) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Crowd: pink noise through two vowel-ish formants, amplitude wobbling like chatter
    const crowd = this._loop(this.pink);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 520; f1.Q.value = 1.2;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1350; f2.Q.value = 1.6;
    const crowdGain = ctx.createGain(); crowdGain.gain.value = 0.05;
    const murmur = ctx.createGain(); murmur.gain.value = 0.8;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.25;
    lfo.connect(lfoAmt).connect(murmur.gain);
    crowd.connect(f1).connect(murmur);
    crowd.connect(f2).connect(murmur);
    murmur.connect(crowdGain).connect(this.ambBus);
    crowdGain.connect(this.reverbIn);
    lfo.start(t);

    // Water: brown noise, low-passed, slowly swelling
    const water = this._loop(this.brown);
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420;
    const waterGain = ctx.createGain(); waterGain.gain.value = 0.05;
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.13;
    const wlfoAmt = ctx.createGain(); wlfoAmt.gain.value = 0.03;
    wlfo.connect(wlfoAmt).connect(waterGain.gain);
    water.connect(wf).connect(waterGain).connect(this.ambBus);
    wlfo.start(t);

    // Rolling: brown noise rumble whose level + brightness follow rolling objects
    const roll = this._loop(this.brown);
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 180; rf.Q.value = 2;
    const rollGain = ctx.createGain(); rollGain.gain.value = 0;
    roll.connect(rf).connect(rollGain).connect(this.ambBus);

    this._amb = { crowd, water, roll, crowdGain, rollGain, rf, sources: [crowd, water, roll, lfo, wlfo] };
    this.crowdLevel = 0;
  }

  stopAmbience() {
    if (!this._amb) return;
    for (const s of this._amb.sources) s.stop();
    this._amb = null;
  }

  /** Per-frame: rolling speed from PhysicsWorld.rollSpeed, crowd excitement 0..1+ */
  updateLoops(dt, rollSpeed = 0, excitement = 0) {
    if (!this._amb) return;
    const t = this.ctx.currentTime;
    const r = clamp(rollSpeed / 12, 0, 1);
    this._amb.rollGain.gain.setTargetAtTime(r * 0.35, t, 0.08);
    this._amb.rf.frequency.setTargetAtTime(140 + r * 360, t, 0.1);
    this.crowdLevel += (clamp(excitement, 0, 1.5) - this.crowdLevel) * Math.min(1, dt * 3);
    this._amb.crowdGain.gain.setTargetAtTime(0.045 + this.crowdLevel * 0.14, t, 0.15);
  }

  /** Charge-up hum: level 0..1 (0 stops it). Rises in pitch and wobbles faster as it fills. */
  setCharge(level) {
    if (!this._initialized) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (level <= 0) {
      if (this._charge) {
        const c = this._charge;
        c.g.gain.setTargetAtTime(0, t, 0.02);
        c.osc.stop(t + 0.1); c.lfo.stop(t + 0.1);
        this._charge = null;
      }
      return;
    }
    if (!this._charge) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator();
      const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 12;
      lfo.connect(lfoAmt).connect(osc.frequency);
      osc.connect(lp).connect(g).connect(this.sfxBus);
      osc.start(t); lfo.start(t);
      this._charge = { osc, lp, g, lfo, full: false };
    }
    const c = this._charge;
    c.osc.frequency.setTargetAtTime(110 + level * 330, t, 0.03);
    c.lp.frequency.setTargetAtTime(400 + level * 2600, t, 0.03);
    c.lfo.frequency.setTargetAtTime(5 + level * 14, t, 0.05);
    c.g.gain.setTargetAtTime(0.03 + level * 0.07, t, 0.03);
    if (level >= 1 && !c.full) {
      c.full = true;
      this._toneAt(this._out(0, 0.3), t, 1760, 0.18, 0.12, 'triangle', 2640);
    }
  }

  // ═══ Combat ═══

  /** Punchy hit; power 0..1 scales weight, crunch and reverb */
  playPunch(power = 0.3, pan = 0) {
    if (!this._ok) return;
    const p = clamp(power, 0, 1);
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.15 + p * 0.3);
    // Sub thump
    this._toneAt(out, t, 170 - p * 50, 0.12 + p * 0.14, 0.55 + p * 0.35, 'sine', 42);
    // Slap
    this._noiseBurst(out, t, 0.05 + p * 0.05, 0.5 + p * 0.25, { type: 'bandpass', freq: 1900 - p * 600, Q: 0.9 });
    // Click transient
    this._noiseBurst(out, t, 0.012, 0.4, { type: 'highpass', freq: 4000 });
    // Crunch on big hits
    if (p > 0.45) {
      this._toneAt(out, t, 90, 0.2, 0.25 * p, 'square', 45, this._shaper());
      this._noiseBurst(out, t + 0.015, 0.25, 0.2 * p, { type: 'lowpass', freq: 900, endFreq: 150 });
    }
  }

  // ═══ Parry, aerials & gadgets ═══

  /** Guard-up tick: a short rising triangle so the parry window reads instantly. */
  playParryStart(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.2);
    this._toneAt(out, t, 880, 0.1, 0.12, 'triangle', 1400);
    this._noiseBurst(out, t, 0.05, 0.12, { type: 'highpass', freq: 3200 });
  }

  /** Connected parry: a bright metallic clang with a fat sub under it. */
  playParry(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.4);
    this._toneAt(out, t, 1760, 0.5, 0.22, 'triangle', 1320);
    this._toneAt(out, t, 2637, 0.34, 0.1, 'sine', 2093);
    this._toneAt(out, t, 92, 0.24, 0.4, 'sine', 42);
    this._noiseBurst(out, t, 0.12, 0.3, { type: 'bandpass', freq: 5200, Q: 1.4 });
    this._noiseBurst(out, t, 0.3, 0.14, { type: 'highpass', freq: 2400 });
  }

  /** Ground slam: sub drop + debris crunch. */
  playSlam(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.35);
    this._toneAt(out, t, 110, 0.42, 0.6, 'sine', 34);
    this._toneAt(out, t, 72, 0.3, 0.35, 'square', 38, this._shaper());
    this._noiseBurst(out, t, 0.28, 0.4, { type: 'lowpass', freq: 1100, endFreq: 140 });
    this._noiseBurst(out, t + 0.02, 0.1, 0.2, { type: 'highpass', freq: 3000 });
  }

  /** Drop-kick confirms with a snappier, higher crack than a punch. */
  playDropkickHit(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.2);
    this._toneAt(out, t, 220, 0.12, 0.35, 'triangle', 90);
    this._toneAt(out, t + 0.01, 1320, 0.08, 0.14, 'square', 660);
    this._noiseBurst(out, t, 0.06, 0.35, { type: 'bandpass', freq: 2800, Q: 1.1 });
  }

  /** Frost beam / nova: crystalline shimmer, thicker and longer for the burst. */
  playFreeze(pan = 0, burst = false) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, burst ? 0.45 : 0.25);
    const dur = burst ? 0.9 : 0.28;
    for (let i = 0; i < (burst ? 5 : 3); i++) {
      this._toneAt(out, t + i * 0.035, 2200 + i * 520, dur * (1 - i * 0.1), 0.09, 'sine', 1400);
    }
    this._noiseBurst(out, t, dur, burst ? 0.28 : 0.14, { type: 'highpass', freq: 4200, endFreq: 2600 });
    if (burst) {
      this._toneAt(out, t, 130, 0.4, 0.25, 'sine', 60);
      this._noiseBurst(out, t, 0.5, 0.12, { type: 'bandpass', freq: 1800, Q: 0.7, attack: 0.1 });
    }
  }

  /** Magnet: a rubbery rising zing. */
  playMagnet(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.25);
    this._toneAt(out, t, 130, 0.28, 0.18, 'square', 520);
    this._toneAt(out, t + 0.06, 260, 0.22, 0.1, 'triangle', 780);
    this._noiseBurst(out, t, 0.3, 0.12, { type: 'bandpass', freq: 600, endFreq: 2600, Q: 2.2, attack: 0.12 });
  }

  /** Gadget cast: freeze ray / magnet fire, plus a sad little whiff when it misses. */
  /** Leaf blower: a buzzy two-stroke motor rev under a breathy hiss. */
  playBlower(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.2);
    this._toneAt(out, t, 70, 0.28, 0.16, 'sawtooth', 130);
    this._toneAt(out, t + 0.02, 140, 0.24, 0.07, 'square', 220);
    this._noiseBurst(out, t, 0.3, 0.22, { type: 'bandpass', freq: 1400, endFreq: 2600 });
  }

  playGadget(kind, pan = 0, hit = true) {
    if (kind === 'freezeRay') this.playFreeze(pan, false);
    else if (kind === 'magnet') this.playMagnet(pan);
    else if (kind === 'leafBlower') this.playBlower(pan);
    if (!hit) this.playWhoosh(pan, 0.3);
  }

  /** Lava sizzle: high hiss over a molasses-low thud. */
  playLavaHit(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.25);
    this._noiseBurst(out, t, 0.5, 0.24, { type: 'highpass', freq: 3800, endFreq: 1800 });
    this._toneAt(out, t, 84, 0.26, 0.3, 'sine', 38);
    this._toneAt(out, t + 0.04, 420, 0.18, 0.08, 'square', 160);
  }

  playWhoosh(pan = 0, strength = 0.5) {
    if (!this._ok || !this._spend()) return;
    const t = this.ctx.currentTime;
    const d = 0.14 + strength * 0.1;
    this._noiseBurst(this._out(pan, 0.1), t, d, 0.16 + strength * 0.12,
      { type: 'bandpass', freq: 500, endFreq: 2200 + strength * 1500, Q: 1.8, attack: d * 0.4 });
  }

  /** Throw whoosh — heavier objects whoosh lower and longer */
  playThrow(pan = 0, mass = 1) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const heavy = clamp(mass / 4, 0, 1);
    const d = 0.18 + heavy * 0.2;
    this._noiseBurst(this._out(pan, 0.12), t, d, 0.28,
      { type: 'bandpass', freq: 1400 - heavy * 900, endFreq: 3200 - heavy * 2200, Q: 1.5, attack: d * 0.35 });
    this._toneAt(this._out(pan, 0), t, 90, 0.08, 0.2, 'sine', 50);
  }

  playGrab(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.08);
    this._toneAt(out, t, 330, 0.07, 0.22, 'triangle', 520);
    this._noiseBurst(out, t, 0.04, 0.2, { type: 'bandpass', freq: 900, Q: 2 });
    this._toneAt(out, t + 0.05, 180, 0.08, 0.2, 'sine', 120);
  }

  playComicBonk(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.2);
    this._toneAt(out, t, 620, 0.16, 0.35, 'triangle', 240);
    this._noiseBurst(out, t, 0.04, 0.35, { type: 'bandpass', freq: 2200, Q: 1.2 });
    // Woodblock "tok"
    this._toneAt(out, t, 1150, 0.05, 0.25, 'sine');
  }

  playSlideWhistle(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.25);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.28);
    const vib = this.ctx.createOscillator(); vib.frequency.value = 9;
    const vibAmt = this.ctx.createGain(); vibAmt.gain.value = 18;
    vib.connect(vibAmt).connect(osc.frequency);
    const g = this._env(t, 0.03, 0.3, 0.13);
    osc.connect(g).connect(out);
    osc.start(t); vib.start(t);
    osc.stop(t + 0.35); vib.stop(t + 0.35);
  }

  /** Big launch: rising whistle + wind */
  playLaunch(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.3);
    this._toneAt(out, t, 600, 0.45, 0.14, 'sine', 1900);
    this._noiseBurst(out, t, 0.5, 0.2, { type: 'bandpass', freq: 800, endFreq: 3000, Q: 1.5, attack: 0.15 });
  }

  playBubblePop(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.25);
    this._toneAt(out, t, 380, 0.09, 0.4, 'sine', 1600);
    this._noiseBurst(out, t, 0.03, 0.3, { type: 'highpass', freq: 3000 });
  }

  playSpringBoing(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.2);
    const osc = this.ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.12);
    const vib = this.ctx.createOscillator(); vib.frequency.setValueAtTime(28, t); vib.frequency.linearRampToValueAtTime(8, t + 0.4);
    const vibAmt = this.ctx.createGain(); vibAmt.gain.setValueAtTime(140, t); vibAmt.gain.linearRampToValueAtTime(10, t + 0.4);
    vib.connect(vibAmt).connect(osc.frequency);
    osc.connect(this._env(t, 0.005, 0.42, 0.3)).connect(out);
    osc.start(t); vib.start(t);
    osc.stop(t + 0.45); vib.stop(t + 0.45);
  }

  playExplosion(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan * 0.6, 0.6);
    this._noiseBurst(out, t, 1.4, 0.9, { type: 'lowpass', freq: 2200, endFreq: 90, Q: 0.7, src: this.brown });
    this._toneAt(out, t, 70, 0.8, 0.9, 'sine', 24);
    this._noiseBurst(out, t, 0.08, 0.6, { type: 'highpass', freq: 1500 });
    // Crackle debris
    for (let i = 0; i < 8; i++) {
      this._noiseBurst(out, t + 0.1 + Math.random() * 0.6, 0.02, rand(0.08, 0.2), { type: 'bandpass', freq: rand(1500, 5000), Q: 3 });
    }
    this.duck(0.5, 1.2);
  }

  playGlassBreak(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.35);
    this._noiseBurst(out, t, 0.12, 0.5, { type: 'highpass', freq: 3500 });
    for (let i = 0; i < 14; i++) {
      const dt = Math.pow(Math.random(), 2) * 0.35;
      this._toneAt(out, t + dt, rand(2200, 7000), rand(0.05, 0.2), rand(0.05, 0.14), 'sine');
    }
  }

  playWoodBreak(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.25);
    this._noiseBurst(out, t, 0.06, 0.7, { type: 'bandpass', freq: 1400, Q: 1.5 });
    this._toneAt(out, t, 140, 0.15, 0.4, 'sine', 60);
    for (let i = 0; i < 6; i++) {
      this._noiseBurst(out, t + 0.03 + Math.random() * 0.2, 0.025, rand(0.15, 0.3), { type: 'bandpass', freq: rand(600, 2500), Q: 4 });
    }
  }

  /** Break sound chosen by material */
  playBreak(material, pan = 0) {
    if (material === 'glass' || material === 'ceramic') return this.playGlassBreak(pan);
    if (material === 'fruit') return this.playSplat(pan);
    if (material === 'stone') return this.playCrumble(pan);
    return this.playWoodBreak(pan);
  }

  playSplat(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.2);
    this._noiseBurst(out, t, 0.3, 0.7, { type: 'lowpass', freq: 3000, endFreq: 200, Q: 4 });
    this._toneAt(out, t, 220, 0.12, 0.35, 'sine', 70);
    for (let i = 0; i < 4; i++) this._toneAt(out, t + 0.05 + i * 0.06, rand(500, 900), 0.05, 0.1, 'sine', rand(1200, 1800));
  }

  playCrumble(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.35);
    this._noiseBurst(out, t, 0.9, 0.55, { type: 'lowpass', freq: 700, endFreq: 120, src: this.brown });
    this._toneAt(out, t, 55, 0.6, 0.35, 'sine', 30);
    for (let i = 0; i < 10; i++) {
      this._noiseBurst(out, t + Math.random() * 0.7, 0.03, rand(0.1, 0.25), { type: 'bandpass', freq: rand(300, 1600), Q: 2 });
    }
  }

  playSplash(pan = 0, size = 1) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.35);
    this._noiseBurst(out, t, 0.25, 0.5 * size, { type: 'bandpass', freq: 300, endFreq: 2500, Q: 0.8 });
    this._noiseBurst(out, t + 0.05, 0.7, 0.35 * size, { type: 'lowpass', freq: 5000, endFreq: 400 });
    this._toneAt(out, t, 160, 0.2, 0.3 * size, 'sine', 50);
    // Bubbles + drips
    for (let i = 0; i < 6; i++) {
      const f = rand(500, 1100);
      this._toneAt(out, t + 0.15 + Math.random() * 0.6, f, 0.06, rand(0.05, 0.12) * size, 'sine', f * 1.8);
    }
  }

  // ═══ Movement ═══

  playFootstep(pan = 0, weight = 0.5) {
    if (!this._ok || !this._spend(0.5)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.05);
    this._noiseBurst(out, t, 0.05, 0.12 + weight * 0.15, { type: 'lowpass', freq: 700 + Math.random() * 300 });
    this._toneAt(out, t, rand(90, 130), 0.06, 0.12 + weight * 0.2, 'sine', 50);
  }

  playLand(speed, pan = 0) {
    if (!this._ok) return;
    const w = clamp(speed / 20, 0, 1);
    this.playFootstep(pan, 0.4 + w);
    if (w > 0.5) this._noiseBurst(this._out(pan, 0.2), this.ctx.currentTime, 0.2, w * 0.3, { type: 'lowpass', freq: 400, src: this.brown });
  }

  playJump(pan = 0, double = false) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.1);
    if (double) {
      this._toneAt(out, t, 500, 0.14, 0.16, 'triangle', 1100);
      this._toneAt(out, t + 0.05, 1300, 0.1, 0.08, 'sine', 1800);
    } else {
      this._toneAt(out, t, 240, 0.12, 0.2, 'triangle', 520);
    }
    this._noiseBurst(out, t, 0.06, 0.08, { type: 'bandpass', freq: 1200, Q: 1 });
  }

  playRagdollHit(force, pan = 0) {
    if (!this._ok) return;
    this._modal('toy', 3, clamp(force / 3000, 0, 1), pan, 1);
  }

  // ═══ Match / UI ═══

  playUIClick() {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.05);
    this._toneAt(out, t, 720, 0.05, 0.16, 'triangle', 980);
    this._toneAt(out, t + 0.03, 1300, 0.04, 0.07, 'sine');
  }

  playUIHover() {
    if (!this._ok || !this._spend()) return;
    this._toneAt(this._out(0, 0), this.ctx.currentTime, 900, 0.03, 0.05, 'sine', 1100);
  }

  playAirHorn() {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.45);
    [[0, 0.12], [0.16, 0.12], [0.32, 0.45]].forEach(([dt, d]) => {
      for (const f of [233, 294, 349]) {
        const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f * 0.94, t + dt);
        osc.frequency.linearRampToValueAtTime(f, t + dt + 0.04);
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 3;
        osc.connect(lp).connect(this._env(t + dt, 0.015, d, 0.09, true)).connect(out);
        osc.start(t + dt); osc.stop(t + dt + d + 0.05);
      }
    });
  }

  playKO() {
    if (!this._ok) return;
    this.playAirHorn();
    this.playCheer(1);
    this.duck(0.35, 1.5);
  }

  /** Crowd reaction: swell of cheering, whistles and claps */
  playCheer(amount = 0.5) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const a = clamp(amount, 0, 1.5);
    const out = this._out(0, 0.6);
    for (const [f, q] of [[600, 1.2], [1100, 1.5], [2400, 2]]) {
      this._noiseBurst(out, t, 1.6 + a, 0.16 * a, { type: 'bandpass', freq: f, Q: q, attack: 0.25, src: this.pink });
    }
    const claps = Math.floor(10 + a * 20);
    for (let i = 0; i < claps; i++) {
      this._noiseBurst(this._out(rand(-0.9, 0.9), 0.4), t + Math.random() * (1.2 + a), 0.02, rand(0.04, 0.1) * a, { type: 'bandpass', freq: rand(1200, 2400), Q: 1.5 });
    }
    if (a > 0.6) {
      for (let i = 0; i < 2; i++) {
        const st = t + 0.1 + Math.random() * 0.4, f = rand(1800, 2600);
        const osc = this.ctx.createOscillator();
        osc.frequency.setValueAtTime(f * 0.8, st);
        osc.frequency.linearRampToValueAtTime(f * 1.15, st + 0.18);
        osc.frequency.linearRampToValueAtTime(f * 0.7, st + 0.5);
        osc.connect(this._env(st, 0.03, 0.5, 0.05)).connect(this._out(rand(-0.7, 0.7), 0.5));
        osc.start(st); osc.stop(st + 0.55);
      }
    }
  }

  /** Trickshot sting: rising bell arpeggio (longer for more style tags) + a crowd "ooh" */
  playTrickshot(level = 1, pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan * 0.5, 0.45);
    const notes = [784, 988, 1175, 1568, 1976].slice(0, 2 + Math.min(3, level));
    notes.forEach((f, i) => {
      this._toneAt(out, t + i * 0.06, f, 0.35, 0.13, 'triangle');
      this._toneAt(out, t + i * 0.06, f * 2.01, 0.2, 0.05, 'sine');
    });
    this.playCheer(0.5 + level * 0.25);
  }

  /** Style tier-up stinger: a quick rising triad that climbs with the tier */
  playStyleTier(tier = 1) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.25);
    const base = [0, 523, 659, 784][tier] || 784;
    [1, 1.26, 1.5].forEach((m, i) => this._toneAt(out, t + i * 0.05, base * m, 0.16, 0.09, 'square'));
    if (tier >= 3) this._toneAt(out, t + 0.15, base * 2, 0.5, 0.1, 'triangle');
  }

  /** Meter full: sparkly shimmer so you know the Super Yeet is armed-able */
  playSuperReady() {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.3);
    for (let i = 0; i < 6; i++) this._toneAt(out, t + i * 0.04, 1568 * (1 + i * 0.12), 0.18, 0.06, 'sine');
  }

  /** Super Yeet impact: sub drop + brassy chord, music ducks out of the way */
  playSuperYeet(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan * 0.5, 0.5);
    this._toneAt(out, t, 120, 0.6, 0.6, 'sine', 35);
    for (const f of [262, 330, 392, 523]) this._toneAt(out, t + 0.03, f, 0.7, 0.07, 'sawtooth');
    this.duck(0.15, 1.2);
  }

  /** Lit fuse: short hiss */
  playFuse(pan = 0) {
    if (!this._ok) return;
    this._noiseBurst(this._out(pan, 0.1), this.ctx.currentTime, 0.7, 0.12, { type: 'highpass', freq: 3500 });
  }

  /** Tech: crisp tick + ding */
  playTech(pan = 0) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan, 0.2);
    this._noiseBurst(out, t, 0.015, 0.4, { type: 'highpass', freq: 5000 });
    this._toneAt(out, t + 0.02, 1320, 0.15, 0.1, 'triangle');
  }

  /** Sudden-death heartbeat loop layered under the music (0 = off) */
  setHeartbeat(rate = 0) {
    this.heartbeat = rate;
  }

  /** Tiny click when the throw arc locks onto a rival */
  playAimLock() {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.05);
    this._toneAt(out, t, 1400, 0.05, 0.07, 'square');
    this._toneAt(out, t + 0.05, 2100, 0.07, 0.06, 'square');
  }

  playCountdown(final = false) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.35);
    if (final) {
      for (const f of [523, 659, 784, 1047]) this._toneAt(out, t, f, 0.6, 0.1, 'square');
      this._toneAt(out, t, 131, 0.5, 0.4, 'triangle');
    } else {
      this._toneAt(out, t, 440, 0.2, 0.2, 'square');
      this._toneAt(out, t, 880, 0.12, 0.08, 'sine');
    }
  }

  playRoundStart() {
    this.playCountdown(true);
  }

  playPowerUp() {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.3);
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
      this._toneAt(out, t + i * 0.045, f, 0.12, 0.13, 'square');
      this._toneAt(out, t + i * 0.045, f * 2, 0.08, 0.04, 'sine');
    });
  }

  playCharge(level) {
    this.setCharge(level);
  }

  playWarning() {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.3);
    this._toneAt(out, t, 660, 0.12, 0.18, 'square');
    this._toneAt(out, t + 0.15, 520, 0.18, 0.18, 'square');
  }

  /** Podium banner sting: snare roll into a brassy hit, music ducked so it lands loud */
  playBanner(win = true) {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.45);
    for (let i = 0; i < 10; i++) this._noiseBurst(out, t + i * 0.035, 0.04, 0.12 + i * 0.02, { type: 'bandpass', freq: 2200, Q: 1 });
    const chord = win ? [392, 494, 587, 784] : [370, 440, 523, 740];
    for (const f of chord) this._toneAt(out, t + 0.38, f, 0.9, 0.07, 'sawtooth');
    this._toneAt(out, t + 0.38, 98, 0.8, 0.35, 'triangle');
    this.duck(0.2, 1.8);
  }

  playVictory() {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.4);
    const notes = [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.54], [1047, 0.66]];
    for (const [f, dt] of notes) {
      this._toneAt(out, t + dt, f, dt > 0.6 ? 0.8 : 0.16, 0.14, 'square');
      this._toneAt(out, t + dt, f / 2, dt > 0.6 ? 0.8 : 0.16, 0.12, 'triangle');
    }
    this.playCheer(1.2);
  }

  /** Sad trombone: wah-wah-wah-waaah */
  playDefeat() {
    if (!this._ok) return;
    const t = this.ctx.currentTime;
    const out = this._out(0, 0.35);
    [[392, 0, 0.35], [370, 0.4, 0.35], [349, 0.8, 0.35], [330, 1.2, 1.1]].forEach(([f, dt, d]) => {
      const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t + dt);
      if (d > 0.5) {
        const vib = this.ctx.createOscillator(); vib.frequency.value = 6;
        const amt = this.ctx.createGain(); amt.gain.value = 8;
        vib.connect(amt).connect(osc.frequency);
        vib.start(t + dt); vib.stop(t + dt + d + 0.05);
      }
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
      lp.frequency.setValueAtTime(300, t + dt);
      lp.frequency.linearRampToValueAtTime(1400, t + dt + 0.12);
      lp.frequency.linearRampToValueAtTime(500, t + dt + d);
      osc.connect(lp).connect(this._env(t + dt, 0.03, d, 0.16, true)).connect(out);
      osc.start(t + dt); osc.stop(t + dt + d + 0.05);
    });
  }

  // ═══ Music: a bouncy procedural loop ═══

  startMusic(intense = false) {
    if (!this._initialized) return;
    this.musicIntense = intense;
    if (this._musicTimer) return;
    this._nextNoteTime = this.ctx.currentTime + 0.1;
    this._step = 0;
    this._musicTimer = setInterval(() => this._scheduleMusic(), 25);
  }

  stopMusic() {
    clearInterval(this._musicTimer);
    this._musicTimer = null;
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.15 : 0, this.ctx.currentTime, 0.05);
  }

  /** Briefly lower the music so a big moment cuts through */
  duck(amount = 0.4, duration = 1) {
    if (!this._initialized || !this.musicEnabled) return;
    const g = this.musicGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.15 * amount, t, 0.03);
    g.setTargetAtTime(0.15, t + duration, 0.4);
  }

  _scheduleMusic() {
    if (this.ctx.state !== 'running') return;
    const bpm = this.musicIntense ? 150 : 124;
    const stepDur = 60 / bpm / 4; // 16th notes
    // I – vi – IV – V in C, one bar each
    const roots = [48, 45, 41, 43];
    const chords = [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]];
    const melody = [12, -1, 16, 19, -1, 16, 14, -1, 12, -1, 9, -1, 11, 12, -1, -1];
    if (this._nextNoteTime < this.ctx.currentTime) this._nextNoteTime = this.ctx.currentTime + 0.05;
    while (this._nextNoteTime < this.ctx.currentTime + 0.12) {
      const t = this._nextNoteTime;
      const step = this._step % 16;
      const bar = Math.floor(this._step / 16) % 4;
      const root = roots[bar];
      // Bass on 8ths with an octave bounce
      if (step % 2 === 0) this._musicNote(midi(root + (step % 4 === 2 ? 12 : 0) - 12), t, stepDur * 1.6, 0.5, 'triangle');
      // Chord stabs on the off-beats
      if (step % 4 === 2) for (const c of chords[bar]) this._musicNote(midi(root + 12 + c), t, stepDur * 1.2, 0.12, 'square');
      // Kick + hat
      if (step % 4 === 0) this._musicKick(t);
      // Sudden death: lub-dub heartbeat every half bar (every quarter when frantic)
      if (this.heartbeat > 0 && step % (this.heartbeat > 1 ? 4 : 8) === 0) {
        this._toneAt(this.sfxBus, t, 58, 0.12, 0.35, 'sine', 40);
        this._toneAt(this.sfxBus, t + stepDur * 0.9, 52, 0.12, 0.25, 'sine', 38);
      }
      if (step % 2 === 1 || this.musicIntense) this._musicHat(t, step % 4 === 2 ? 0.1 : 0.05);
      // Melody every other pass
      const m = melody[step];
      if (m >= 0 && (Math.floor(this._step / 64) % 2 === 1 || this.musicIntense)) {
        this._musicNote(midi(root + 12 + m), t, stepDur * 1.8, 0.14, 'sine');
      }
      this._nextNoteTime += stepDur;
      this._step++;
    }
  }

  _musicNote(freq, t, dur, vol, type) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(this._env(t, 0.01, dur, vol)).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _musicKick(t) {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    osc.connect(this._env(t, 0.002, 0.15, 0.7)).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  _musicHat(t, vol) {
    this._noiseBurst(this.musicGain, t, 0.04, vol, { type: 'highpass', freq: 7000 });
  }

  // ═══ Synthesis helpers ═══

  /** A panned voice input that feeds the dry bus and (optionally) the reverb. */
  _out(pan = 0, reverb = 0.2) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(this.sfxBus);
    if (reverb > 0) {
      const send = this.ctx.createGain();
      send.gain.value = reverb;
      p.connect(send).connect(this.reverbIn);
    }
    return p;
  }

  /** Attack/decay envelope gain node. `hold` keeps it flat until the end (horns). */
  _env(t, attack, dur, vol, hold = false) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
    if (hold) g.gain.setValueAtTime(vol, t + Math.max(attack, dur - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  _toneAt(out, t, freq, dur, vol, type = 'sine', endFreq = null, shaper = null) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const env = this._env(t, 0.004, dur, vol);
    if (shaper) osc.connect(shaper).connect(env); else osc.connect(env);
    env.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noiseBurst(out, t, dur, vol, { type = 'bandpass', freq = 1000, endFreq = null, Q = 1, attack = 0.003, src = this.white } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = src;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    f.Q.value = Q;
    s.connect(f).connect(this._env(t, attack, dur, vol)).connect(out);
    const offset = Math.random() * Math.max(0, src.duration - dur - 0.05);
    s.start(t, offset);
    s.stop(t + dur + 0.02);
  }

  _loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start(this.ctx.currentTime, Math.random() * buffer.duration);
    return s;
  }

  _shaper() {
    if (!this._shaperCurve) {
      const n = 1024;
      this._shaperCurve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1) * 2 - 1;
        this._shaperCurve[i] = Math.tanh(x * 4);
      }
    }
    const w = this.ctx.createWaveShaper();
    w.curve = this._shaperCurve;
    return w;
  }

  _makeNoise(seconds, color) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  /** Stereo stadium impulse: a few early reflections, then a dense decaying tail. */
  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.01 ? t / 0.01 : 1);
      }
      for (let r = 0; r < 6; r++) {
        const at = Math.floor(rate * (0.02 + Math.random() * 0.09));
        d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.6 - r * 0.08);
      }
    }
    return buf;
  }
}

function midi(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}
