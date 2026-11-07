/* Shared spatial + temporal state, driven by one requestAnimationFrame loop. */

export const state = {
  t: 0,
  dt: 16.7,
  sy: 0,          // raw scroll
  ssy: 0,         // smoothed scroll
  vel: 0,         // scroll velocity (smoothed)
  mx: 0, my: 0,   // raw pointer
  nmx: 0, nmy: 0, // normalized -1..1
  tx: 0, ty: 0,   // smoothed normalized pointer
  w: 0, h: 0,
  dpr: 1,
  reduced: false,
  fine: false,
  ready: false,
};

state.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
state.fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
state.dpr = Math.min(window.devicePixelRatio || 1, 2);

const measure = () => {
  state.w = window.innerWidth;
  state.h = window.innerHeight;
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.sy = window.scrollY || window.pageYOffset || 0;
};

measure();
state.mx = state.w / 2;
state.my = state.h / 2;
state.ssy = state.sy;

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/* ── ticker ──────────────────────────────────────────────────────────── */

const subs = new Set();
let raf = 0;
let prev = 0;
let lastScroll = 0;
let velAccum = 0;

function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!prev) prev = now;
  let dt = now - prev;
  prev = now;
  // clamp after tab switches so springs never explode
  dt = Math.min(dt, 48);
  state.dt = dt;
  state.t += dt / 1000;

  measure();
  const dScroll = state.sy - lastScroll;
  lastScroll = state.sy;
  velAccum += dScroll;
  state.vel = damp(state.vel, velAccum / Math.max(dt, 1) * 16.7, 9, dt / 1000);
  velAccum *= 0.55;

  state.ssy = damp(state.ssy, state.sy, state.reduced ? 40 : 12, dt / 1000);
  state.nmx = (state.mx / state.w) * 2 - 1;
  state.nmy = (state.my / state.h) * 2 - 1;
  state.tx = damp(state.tx, state.nmx, 6, dt / 1000);
  state.ty = damp(state.ty, state.nmy, 6, dt / 1000);

  for (const fn of subs) fn(state.t, dt, state);
}

export function addTick(fn) {
  subs.add(fn);
  if (!raf) {
    prev = 0;
    lastScroll = state.sy;
    raf = requestAnimationFrame(frame);
  }
  return () => subs.delete(fn);
}

/* ── pointer ─────────────────────────────────────────────────────────── */

window.addEventListener(
  'pointermove',
  (e) => {
    state.mx = e.clientX;
    state.my = e.clientY;
  },
  { passive: true }
);
window.addEventListener('resize', measure, { passive: true });
window.addEventListener('orientationchange', measure, { passive: true });

/* ── spring ──────────────────────────────────────────────────────────── */

export class Spring {
  constructor(value = 0, stiffness = 190, damping = 22) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.k = stiffness;
    this.d = damping;
  }
  set(v) { this.target = v; }
  snap(v) { this.value = v; this.target = v; this.velocity = 0; }
  update(dt) {
    const s = Math.min(dt, 34) / 1000;
    // semi-implicit euler, sub-stepped for stability
    const steps = 2;
    const h = s / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.value - this.target) - this.d * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}
