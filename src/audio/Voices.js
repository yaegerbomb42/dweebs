/**
 * Dweeb Voices: every Dweeb gets a little procedural gibberish voice (Animal-Crossing /
 * Banjo-style babble) seeded from its name + body type, so the same Dweeb always sounds
 * the same. Syllables are a buzzy source through two formant band-passes (a vowel), with
 * pitch contours per emotion: "ow!", a launched "waaAAAah", a falling KO wail, a cheeky
 * "hehe" for the KO scorer, an "eep!" when grabbed and a tiny "hup" on double jumps.
 */
const VOWELS = { a: [800, 1150], e: [400, 2000], i: [300, 2300], o: [450, 800], u: [325, 700] };
const TYPE_PITCH = { cube: 0.85, blob: 1.15, spiky: 1.05, tall: 0.8, tiny: 1.45, chonk: 0.7, blockhead: 0.9 };

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

export class DweebVoices {
  constructor(audio) {
    this.audio = audio;
    this.profiles = new WeakMap();
    this.last = new WeakMap();
    this.enabled = true;
  }

  profile(d) {
    let p = this.profiles.get(d);
    if (p) return p;
    const seed = hash(`${d.name || ''}|${d.type || ''}|${d.color || 0}`);
    const typeMul = TYPE_PITCH[d.type] ?? (0.85 + hash(String(d.type)) * 0.5);
    p = {
      base: (170 + seed * 260) * typeMul,              // fundamental
      wave: seed > 0.66 ? 'square' : seed > 0.33 ? 'sawtooth' : 'triangle',
      formantShift: 0.85 + hash(`${seed}f`) * 0.4,     // vocal-tract size
      vib: 4 + hash(`${seed}v`) * 5,
      vowels: ['a', 'e', 'i', 'o', 'u'].sort((x, y) => hash(seed + x) - hash(seed + y)).slice(0, 3),
    };
    this.profiles.set(d, p);
    return p;
  }

  /** One syllable: f0 contour [start, end], duration, vowel, volume. */
  _syl(out, t, p, f0a, f0b, dur, vowel, vol, vibAmt = 0) {
    const a = this.audio, ctx = a.ctx;
    const osc = ctx.createOscillator();
    osc.type = p.wave;
    osc.frequency.setValueAtTime(f0a, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f0b), t + dur);
    if (vibAmt > 0) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = p.vib; lg.gain.value = f0a * vibAmt;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.025, dur * 0.2));
    env.gain.setValueAtTime(vol, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const [F1, F2] = VOWELS[vowel] || VOWELS.a;
    for (const [f, q, g] of [[F1, 6, 1], [F2, 9, 0.55]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f * p.formantShift; bp.Q.value = q;
      const fg = ctx.createGain(); fg.gain.value = g;
      osc.connect(bp).connect(fg).connect(env);
    }
    env.connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  /** kind: 'ow' | 'yeet' | 'ko' | 'cheer' | 'eep' | 'hup' */
  say(d, kind, pan = 0, gain = 1, delay = 0) {
    const a = this.audio;
    if (!this.enabled || !d || !a?._ok || gain < 0.05) return;
    const now = a.ctx.currentTime;
    const gap = kind === 'ko' || kind === 'yeet' ? 0.15 : 0.35;
    if ((this.last.get(d) ?? -9) > now - gap) return;
    if (a._spend && !a._spend(2)) return;
    this.last.set(d, now);
    const p = this.profile(d), f = p.base, v = p.vowels;
    const t = now + delay;
    const out = a._out(pan, 0.15);
    const vol = 0.22 * gain;
    switch (kind) {
      case 'ow':
        this._syl(out, t, p, f * 1.5, f * 0.95, 0.13, v[0], vol);
        break;
      case 'yeet': // launched: rising then sliding scream
        this._syl(out, t, p, f * 1.2, f * 2.4, 0.28, 'a', vol, 0.04);
        this._syl(out, t + 0.26, p, f * 2.4, f * 1.3, 0.5, 'a', vol * 0.85, 0.06);
        break;
      case 'ko':
        this._syl(out, t, p, f * 2.0, f * 0.5, 0.9, 'o', vol * 0.9, 0.05);
        break;
      case 'cheer': // "he-he!"
        this._syl(out, t, p, f * 1.3, f * 1.5, 0.09, 'e', vol * 0.8);
        this._syl(out, t + 0.12, p, f * 1.5, f * 1.8, 0.11, 'e', vol * 0.8);
        break;
      case 'eep':
        this._syl(out, t, p, f * 2.2, f * 2.8, 0.1, 'i', vol * 0.8);
        break;
      case 'hup':
        this._syl(out, t, p, f * 1.1, f * 1.25, 0.07, v[1], vol * 0.5);
        break;
      default: { // babble: 2-4 random syllables (used for taunts/emotes)
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const s = f * (0.9 + Math.random() * 0.6);
          this._syl(out, t + i * 0.11, p, s, s * (0.9 + Math.random() * 0.25), 0.09, v[i % v.length], vol * 0.7);
        }
      }
    }
  }
}
