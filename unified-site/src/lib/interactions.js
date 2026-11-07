/* Magnetic hover, 3D tilt with light reflection, custom cursor. */
import { state, addTick, Spring, clamp } from './state.js';

/* ── magnetic pull ───────────────────────────────────────────────────── */
export function initMagnetic() {
  if (!state.fine || state.reduced) return;
  const els = [...document.querySelectorAll('[data-magnetic]')];
  for (const el of els) {
    const xs = new Spring(0, 210, 26);
    const ys = new Spring(0, 210, 26);
    const rs = new Spring(0, 160, 20);
    let active = false;

    el.style.willChange = 'transform';
    el.style.transformOrigin = 'center';

    const enter = () => { active = true; };
    const leave = () => {
      active = false;
      xs.set(0); ys.set(0); rs.set(0);
    };
    const move = (e) => {
      if (!active) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const strength = parseFloat(el.dataset.magnetic) || 0.28;
      xs.set(dx * strength);
      ys.set(dy * strength);
      rs.set(clamp(dx / r.width, -0.5, 0.5) * 5);
      el.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
    };

    el.addEventListener('pointerenter', enter, { passive: true });
    el.addEventListener('pointerleave', leave, { passive: true });
    el.addEventListener('pointermove', move, { passive: true });

    addTick((_t, dt) => {
      const x = xs.update(dt);
      const y = ys.update(dt);
      const r = rs.update(dt);
      const resting = Math.abs(x) < 0.01 && Math.abs(y) < 0.01 && Math.abs(r) < 0.005;
      if (!active && resting) {
        if (el.style.transform) el.style.transform = '';
        return;
      }
      el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(2)}deg)`;
    });
  }
}

/* ── 3D tilt + reflection ────────────────────────────────────────────── */
export function initTilt() {
  if (state.reduced) return;
  const els = [...document.querySelectorAll('[data-tilt]')];
  for (const el of els) {
    const kind = el.classList.contains('terminal') ? 'terminal' : 'card';
    const maxX = kind === 'terminal' ? 5 : 4.5;
    const maxY = kind === 'terminal' ? 7 : 6;
    const rx = new Spring(0, 170, 20);
    const ry = new Spring(0, 170, 20);
    const zs = new Spring(1, 190, 24);
    let hovered = false;

    el.addEventListener('pointerenter', () => {
      hovered = true;
      zs.set(1.012);
    }, { passive: true });

    el.addEventListener('pointerleave', () => {
      hovered = false;
      rx.set(0); ry.set(0); zs.set(1);
      el.style.removeProperty('--sx');
      el.style.removeProperty('--sy');
    }, { passive: true });

    el.addEventListener(
      'pointermove',
      (e) => {
        if (!hovered) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        ry.set((px - 0.5) * maxY * 2);
        rx.set(-(py - 0.5) * maxX * 2);
        el.style.setProperty('--sx', `${(px * 100).toFixed(1)}%`);
        el.style.setProperty('--sy', `${(py * 100).toFixed(1)}%`);
      },
      { passive: true }
    );

    addTick((_t, dt) => {
      const a = rx.update(dt);
      const b = ry.update(dt);
      const s = zs.update(dt);
      const settled =
        !hovered &&
        Math.abs(a) < 0.004 && Math.abs(b) < 0.004 && Math.abs(s - 1) < 0.0008;
      if (settled) {
        if (el.style.transform) el.style.transform = '';
        return;
      }
      el.style.transform = `perspective(1100px) rotateX(${a.toFixed(3)}deg) rotateY(${b.toFixed(3)}deg) scale(${s.toFixed(4)})`;
    });
  }
}

/* ── agent cards: parallax tilt toward pointer ───────────────────────── */
export function initAgentCards() {
  if (!state.fine || state.reduced) return;
  const cards = [...document.querySelectorAll('[data-agent]')];
  for (const card of cards) {
    const depth = parseFloat(card.dataset.depth || '0.25');
    const rx = new Spring(0, 120, 18);
    const ry = new Spring(0, 120, 18);
    let hovered = false;

    card.addEventListener('pointerenter', () => { hovered = true; }, { passive: true });
    card.addEventListener('pointerleave', () => {
      hovered = false;
      rx.set(0); ry.set(0);
      card.style.removeProperty('--sx');
      card.style.removeProperty('--sy');
    }, { passive: true });
    card.addEventListener(
      'pointermove',
      (e) => {
        if (!hovered) return;
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        ry.set((px - 0.5) * 16);
        rx.set(-(py - 0.5) * 12);
        card.style.setProperty('--sx', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--sy', `${(py * 100).toFixed(1)}%`);
      },
      { passive: true }
    );

    let lastA = 0, lastB = 0;

    addTick(() => {
      const driftX = hovered ? 0 : state.tx * 26 * depth;
      const driftY = hovered ? 0 : state.ty * 18 * depth;
      const a = rx.update(state.dt);
      const b = ry.update(state.dt);
      // the float animation re-reads these vars; only poke them on real change
      if (Math.abs(a - lastA) > 0.01 || Math.abs(b - lastB) > 0.01) {
        lastA = a; lastB = b;
        card.style.setProperty('--tilt-x', `${a.toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${b.toFixed(2)}deg`);
      }
      const par = parseFloat(card.dataset.par || '0');
      card.style.translate = `${driftX.toFixed(2)}px ${(driftY + par).toFixed(2)}px`;
    });
  }
}

/* ── hero wordmark: 3D breathing that answers the pointer ────────────── */
export function initWordmark() {
  const stage = document.querySelector('[data-wordmark]');
  if (!stage || state.reduced) return;
  const rx = new Spring(0, 55, 13);
  const ry = new Spring(0, 55, 13);

  addTick((t, dt) => {
    const sc = clamp(1 - state.ssy / (state.h * 1.1), 0, 1);
    ry.set(state.tx * 9 * sc);
    rx.set(-state.ty * 6 * sc);
    const a = rx.update(dt);
    const b = ry.update(dt);
    const bob = Math.sin(t * 0.42) * 4;
    stage.style.transform =
      `rotateX(${a.toFixed(2)}deg) rotateY(${b.toFixed(2)}deg) translateY(${bob.toFixed(2)}px)`;
  });
}

/* ── custom cursor ───────────────────────────────────────────────────── */
export function initCursor() {
  if (!state.fine || state.reduced) return;
  const ring = document.querySelector('[data-cursor-ring]');
  const dot = document.querySelector('[data-cursor-dot]');
  if (!ring || !dot) return;
  document.body.classList.add('has-cursor');

  let rx = state.mx, ry = state.my;
  let dx = state.mx, dy = state.my;
  let scale = 1;

  const hot = 'a, button, [data-cursor-hot], input, [data-tilt], [data-agent]';
  document.addEventListener('pointerover', (e) => {
    document.body.classList.toggle('cursor-hot', !!e.target.closest(hot));
  }, { passive: true });

  addTick((_t, dt) => {
    const k = 1 - Math.exp(-16 * (dt / 1000));
    const kd = 1 - Math.exp(-34 * (dt / 1000));
    rx += (state.mx - rx) * k;
    ry += (state.my - ry) * k;
    dx += (state.mx - dx) * kd;
    dy += (state.my - dy) * kd;
    const target = document.body.classList.contains('cursor-hot') ? 1.6 : 1;
    scale += (target - scale) * 0.14;
    ring.style.transform = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;
    dot.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
  });
}
