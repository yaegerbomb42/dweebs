/* Dust field. Sparse, slow, and shy — it leans away from the pointer. */
import { state, addTick } from './state.js';

export function initParticles() {
  const canvas = document.getElementById('particles');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  let w = 0, h = 0, dpr = 1;
  let parts = [];
  let sprite = null;

  const makeSprite = () => {
    const s = 32;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const cx = c.getContext('2d');
    const g = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(210,235,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    cx.fill();
    return c;
  };
  sprite = makeSprite();

  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    dpr = state.dpr;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  };

  const seed = () => {
    const density = Math.min(1, (w * h) / (1600 * 900));
    const count = Math.round((state.w < 700 ? 44 : 96) * Math.max(density, 0.45));
    parts = new Array(count).fill(0).map(() => {
      const z = Math.random(); // depth
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        z,
        r: 0.5 + z * 1.9,
        a: 0.12 + Math.random() * 0.42 * (0.4 + z * 0.6),
        vx: (Math.random() - 0.5) * 0.055 * (0.4 + z),
        vy: -(0.02 + Math.random() * 0.09) * (0.3 + z),
        ph: Math.random() * Math.PI * 2,
        sp: 0.25 + Math.random() * 0.7,
        ox: 0,
        oy: 0,
      };
    });
  };

  resize();
  window.addEventListener('resize', resize, { passive: true });

  let last = performance.now();
  addTick((t) => {
    const now = performance.now();
    const dt = Math.min(now - last, 48);
    last = now;
    ctx.clearRect(0, 0, w, h);

    const mx = state.mx;
    const my = state.my;
    const R = 190;

    ctx.globalCompositeOperation = 'lighter';

    for (const p of parts) {
      // drift
      p.x += p.vx * (dt / 16.7);
      p.y += p.vy * (dt / 16.7);
      if (p.y < -20) { p.y = h + 20; p.x = Math.random() * w; }
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;

      // pointer repulsion, layered by depth
      const dx = p.x - mx;
      const dy = p.y - my;
      const d2 = dx * dx + dy * dy;
      let push = 0;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 1;
        push = (1 - d / R) ** 2 * 26 * (0.35 + p.z);
        p.ox += ((dx / d) * push - p.ox) * 0.09;
        p.oy += ((dy / d) * push - p.oy) * 0.09;
      } else {
        p.ox *= 0.94;
        p.oy *= 0.94;
      }

      const twinkle = 0.65 + Math.sin(t * p.sp + p.ph) * 0.35;
      const size = p.r * (1 + p.z * 0.6) * 7;
      ctx.globalAlpha = p.a * twinkle * (0.55 + p.z * 0.45);

      // depth parallax against pointer
      const px = p.x + p.ox + state.tx * -10 * p.z;
      const py = p.y + p.oy + state.ty * -8 * p.z;
      ctx.drawImage(sprite, px - size / 2, py - size / 2, size, size);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  });
}
