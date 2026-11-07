/* The agent mesh: specialist nodes, reconfiguring edges, travelling pulses. */
import { state, addTick, clamp } from './state.js';

const LABELS = [
  'PLANNER', 'RESEARCHER', 'CODER', 'CRITIC', 'MEMORY',
  'ROUTER', 'TOOL', 'GUARD', 'SYNTH', 'EXEC', 'EVAL',
];

const ROLE = {
  PLANNER: 'decomposes intent',
  RESEARCHER: 'reads + cites',
  CODER: 'writes + verifies',
  CRITIC: 'scores output',
  MEMORY: 'recalls context',
  ROUTER: 'picks a model',
  TOOL: 'calls the world',
  GUARD: 'checks policy',
  SYNTH: 'merges branches',
  EXEC: 'runs sandbox',
  EVAL: 'scores the run',
};

export function initMesh() {
  const canvas = document.getElementById('meshCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const wrap = canvas.parentElement;
  const tip = document.getElementById('meshTip');
  const tickEl = document.querySelector('[data-mesh-ticks]');
  const statusEl = document.querySelector('[data-mesh-status]');

  let W = 0, H = 0, dpr = 1;
  let nodes = [];
  let edges = new Map(); // "i-j" -> alpha spring value
  let pulses = [];
  let hovered = -1;
  let ticks = 0;

  const isMobile = () => window.innerWidth < 720;

  function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = r.height;
    dpr = state.dpr;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function build() {
    const count = isMobile() ? 8 : LABELS.length;
    const cx = W / 2;
    const cy = H / 2;
    const rx = Math.min(W * 0.36, 520);
    const ry = Math.min(H * 0.38, 300);

    nodes = LABELS.slice(0, count).map((label, i) => {
      const a = (i / count) * Math.PI * 2 - Math.PI / 2;
      // deterministic jitter so the web feels hand-laid, not circular
      const jitter = Math.sin(i * 12.9898) * 0.5 + 0.5;
      const spread = 0.62 + jitter * 0.42;
      return {
        i,
        label,
        role: ROLE[label],
        bx: cx + Math.cos(a) * rx * spread,
        by: cy + Math.sin(a) * ry * spread,
        r: 2.4 + jitter * 1.6,
        ph: i * 1.77,
        sp: 0.22 + jitter * 0.3,
        ax: 0, ay: 0, // ambient drift
        x: 0, y: 0,
        hot: 0,
        appear: 0,
      };
    });

    pulses = new Array(isMobile() ? 4 : 7).fill(0).map(() => newPulse());
  }

  function newPulse() {
    const n = nodes.length;
    let a = Math.floor(Math.random() * n);
    let b = Math.floor(Math.random() * n);
    let guard = 0;
    while (b === a && guard++ < 8) b = Math.floor(Math.random() * n);
    return { a, b, t: Math.random(), speed: 0.22 + Math.random() * 0.3, life: 1 };
  }

  let localX = -9999, localY = -9999, inside = false;
  let boxTop = 0, boxLeft = 0;
  const refreshBox = () => {
    const r = wrap.getBoundingClientRect();
    boxTop = r.top;
    boxLeft = r.left;
  };
  refreshBox();

  wrap.addEventListener('pointermove', (e) => {
    // scroll only happens while the pointer is moving over the mesh
    refreshBox();
    localX = e.clientX - boxLeft;
    localY = e.clientY - boxTop;
    inside = true;
  }, { passive: true });
  wrap.addEventListener('pointerleave', () => {
    inside = false;
    localX = localY = -9999;
    document.body.classList.remove('cursor-mesh');
  }, { passive: true });

  const ro = new ResizeObserver(() => resize());

  resize();
  ro.observe(wrap);

  /* ── draw ──────────────────────────────────────────────────────────── */
  addTick((t) => {
    if (!W || !H) return;
    const dt = state.dt / 1000;
    ctx.clearRect(0, 0, W, H);

    const cursorAmp = inside ? 1 : 0;

    // node kinematics
    for (const n of nodes) {
      n.appear = Math.min(1, n.appear + dt * 2.2);
      n.ax = Math.sin(t * n.sp + n.ph) * 16 + Math.sin(t * n.sp * 0.43 + n.ph * 2) * 9;
      n.ay = Math.cos(t * n.sp * 0.86 + n.ph) * 13 + Math.cos(t * n.sp * 0.37 + n.ph * 3) * 7;

      let px = n.bx + n.ax + state.tx * 18 * (0.4 + n.i % 3 * 0.2);
      let py = n.by + n.ay + state.ty * 14 * (0.4 + n.i % 3 * 0.2);

      // gentle repulsion — nodes are shy of the pointer
      const dx = px - localX;
      const dy = py - localY;
      const d = Math.hypot(dx, dy);
      const near = d < 150 ? (1 - d / 150) ** 2 : 0;
      if (near > 0) {
        px += (dx / (d || 1)) * near * 34;
        py += (dy / (d || 1)) * near * 34;
      }
      n.x = px;
      n.y = py;
      n.hot = 0;
    }

    // hovered node = the one nearest the pointer within 64px
    hovered = -1;
    if (inside) {
      let best = 64;
      for (const n of nodes) {
        const d = Math.hypot(n.x - localX, n.y - localY);
        if (d < best) { best = d; hovered = n.i; }
      }
    }
    if (hovered >= 0) nodes[hovered].hot = 1;

    // ── edges: connect near neighbours, alpha springs smooth reconfiguration
    const maxD = Math.min(W, H) * (isMobile() ? 0.62 : 0.5);
    const seen = new Set();

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const key = `${i}-${j}`;
        const target = d < maxD ? (1 - d / maxD) ** 1.5 : 0;
        const prev = edges.get(key) ?? 0;
        const next = prev + (target - prev) * Math.min(1, dt * 3.4);
        if (next > 0.004) {
          edges.set(key, next);
          seen.add(key);
        } else {
          edges.delete(key);
        }
      }
    }

    // draw edges
    ctx.lineCap = 'round';
    for (const [key, alpha] of edges) {
      const [i, j] = key.split('-').map(Number);
      const a = nodes[i], b = nodes[j];
      if (!a || !b) continue;
      const involved = hovered === i || hovered === j;
      const pulse = 0.72 + Math.sin(t * 1.5 + (i + j) * 0.9) * 0.28;
      const base = alpha * 0.34 * pulse * nAppear(a, b);
      const strong = involved ? alpha * 0.95 : base;

      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      const cyan = involved ? '0,240,255' : '140,190,205';
      g.addColorStop(0, `rgba(${cyan},${(strong * 0.15).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(${cyan},${strong.toFixed(3)})`);
      g.addColorStop(1, `rgba(${cyan},${(strong * 0.15).toFixed(3)})`);

      ctx.strokeStyle = g;
      ctx.lineWidth = involved ? 1.15 : 0.7;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // glow pass for the whole web
    ctx.globalCompositeOperation = 'lighter';
    for (const [key, alpha] of edges) {
      const [i, j] = key.split('-').map(Number);
      const a = nodes[i], b = nodes[j];
      if (!a || !b) continue;
      if (hovered !== i && hovered !== j) continue;
      ctx.strokeStyle = `rgba(0,240,255,${(alpha * 0.12).toFixed(3)})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── pulses travelling along edges
    for (let p = 0; p < pulses.length; p++) {
      const pl = pulses[p];
      const a = nodes[pl.a], b = nodes[pl.b];
      if (!a || !b) { pulses[p] = newPulse(); continue; }
      pl.t += dt * pl.speed;
      if (pl.t >= 1) { pulses[p] = newPulse(); continue; }
      const e = clamp(edges.get(`${Math.min(pl.a, pl.b)}-${Math.max(pl.a, pl.b)}`) ?? 0);
      if (e < 0.06) continue;
      const ease = pl.t * pl.t * (3 - 2 * pl.t);
      const x = a.x + (b.x - a.x) * ease;
      const y = a.y + (b.y - a.y) * ease;
      const fade = Math.sin(pl.t * Math.PI);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
      g.addColorStop(0, `rgba(220,255,255,${(0.75 * fade).toFixed(3)})`);
      g.addColorStop(0.4, `rgba(0,240,255,${(0.35 * fade).toFixed(3)})`);
      g.addColorStop(1, 'rgba(0,240,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // ── nodes
    for (const n of nodes) {
      const hot = n.hot || (hovered === n.i ? 1 : 0);
      const breathe = 0.75 + Math.sin(t * 1.1 + n.ph) * 0.25;
      const alpha = n.appear;
      const R = n.r * (hot ? 1.9 : 1) * breathe;

      // halo
      ctx.globalCompositeOperation = 'lighter';
      const hg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R * (hot ? 20 : 11));
      hg.addColorStop(0, `rgba(0,240,255,${(0.5 * alpha * (hot ? 0.65 : 0.28)).toFixed(3)})`);
      hg.addColorStop(0.35, `rgba(0,240,255,${(0.12 * alpha * (hot ? 0.4 : 0.14)).toFixed(3)})`);
      hg.addColorStop(1, 'rgba(0,240,255,0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(n.x, n.y, R * (hot ? 20 : 11), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // ring
      ctx.strokeStyle = `rgba(255,255,255,${(0.16 * alpha * (0.6 + hot * 0.8)).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, R * 3.4, 0, Math.PI * 2);
      ctx.stroke();

      // core
      ctx.fillStyle = hot
        ? `rgba(255,255,255,${alpha})`
        : `rgba(232,246,250,${(0.9 * alpha).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
      ctx.fill();

      // label
      const showLabel = hot || n.i % 4 === 0 || isMobile() === false;
      if (showLabel && alpha > 0.6) {
        const la = (hot ? 0.95 : 0.32) * alpha;
        ctx.font = `${hot ? 500 : 400} 9px 'Geist Mono', monospace`;
        ctx.fillStyle = `rgba(${hot ? '255,255,255' : '190,200,208'},${la.toFixed(3)})`;
        ctx.textAlign = 'center';
        ctx.letterSpacing = '1.4px';
        ctx.fillText(n.label, n.x, n.y - R * 3.4 - 10);
      }
    }

    // ── tooltip / HUD
    if (hovered >= 0 && tip) {
      const n = nodes[hovered];
      tip.textContent = `${n.label} — ${n.role}`;
      tip.style.left = `${n.x}px`;
      tip.style.top = `${n.y}px`;
      tip.classList.add('is-on');
      document.body.classList.add('cursor-mesh');
    } else if (tip) {
      tip.classList.remove('is-on');
      document.body.classList.remove('cursor-mesh');
    }

    if (statusEl) {
      const phase = Math.floor(t / 4.2) % 3;
      statusEl.textContent = hovered >= 0 ? 'NODE ACTIVE' : ['RECONFIGURING', 'SYNCING', 'STABLE'][phase];
    }
    ticks += dt * 60;
    if (tickEl) tickEl.textContent = String(Math.floor(ticks)).padStart(4, '0');
  });

  /* node appear factor: edges fade with the younger node */
  function nAppear(a, b) { return Math.min(a.appear, b.appear); }
}
