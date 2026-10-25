// Stickers.js — canvas-generated decal textures (stickers, stripes, faces, comic bursts, splats).
// Everything is drawn once and cached by key; no image files needed.

import * as THREE from 'three';

const INK = '#1b1030';
const FONT = '"Lilita One", "Arial Black", sans-serif';
const cache = new Map();

function tex(key, w, h, draw, { repeat = null } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  cache.set(key, t);
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function burstPath(g, cx, cy, r0, r1, n, jitter = 0) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 2 ? r0 : r1) * (1 + (jitter ? Math.sin(i * 12.9898) * jitter : 0));
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

function fitText(g, text, maxW, size) {
  g.font = `${size}px ${FONT}`;
  const w = g.measureText(text).width;
  if (w > maxW) g.font = `${Math.floor(size * maxW / w)}px ${FONT}`;
}

/** Die-cut text sticker: white border, coloured fill, ink text. Multi-line via '\n'. */
export function textSticker(text, { bg = '#ffd23f', fg = INK, w = 256, h = 128, shape = 'round', tilt = 0 } = {}) {
  return tex(`txt:${text}:${bg}:${fg}:${w}x${h}:${shape}:${tilt}`, w, h, (g) => {
    g.translate(w / 2, h / 2);
    g.rotate(tilt);
    g.translate(-w / 2, -h / 2);
    const pad = 6;
    const shapePath = (inset) => {
      if (shape === 'burst') burstPath(g, w / 2, h / 2, Math.min(w, h) * 0.34 - inset, Math.min(w, h) * 0.5 - inset - pad, 12);
      else if (shape === 'circle') { g.beginPath(); g.arc(w / 2, h / 2, Math.min(w, h) / 2 - pad - inset, 0, Math.PI * 2); }
      else roundRect(g, pad + inset, pad + inset, w - (pad + inset) * 2, h - (pad + inset) * 2, Math.min(w, h) * 0.18);
    };
    shapePath(0); g.fillStyle = '#fff'; g.fill();
    shapePath(7); g.fillStyle = bg; g.fill();
    g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
    const lines = text.split('\n');
    const size = Math.min(h * 0.62 / lines.length, 90);
    g.fillStyle = fg;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      fitText(g, ln, w * (shape === 'burst' || shape === 'circle' ? 0.52 : 0.8), size);
      g.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.02 + 2);
    });
  });
}

/** Diagonal hazard stripes (tiles horizontally). */
export function stripes(c1 = '#ffd23f', c2 = INK, n = 8) {
  return tex(`stripes:${c1}:${c2}:${n}`, 256, 64, (g, w, h) => {
    g.fillStyle = c1; g.fillRect(0, 0, w, h);
    g.fillStyle = c2;
    const step = w / n;
    for (let i = -1; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * step, h); g.lineTo(i * step + step / 2, h);
      g.lineTo(i * step + step, 0); g.lineTo(i * step + step / 2, 0);
      g.closePath(); g.fill();
    }
  });
}

export function checker(c1 = '#ff4d5e', c2 = '#fff8ee', n = 6) {
  return tex(`checker:${c1}:${c2}:${n}`, 256, 256, (g, w, h) => {
    const s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? c1 : c2;
      g.fillRect(x * s, y * s, s, s);
    }
    // Soft weave lines so it reads as cloth
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 2;
    for (let i = 0; i < n * 3; i++) { g.beginPath(); g.moveTo(0, i * s / 3); g.lineTo(w, i * s / 3); g.stroke(); }
  });
}

/** Bottle label wrapped around a cylinder. */
export function label(text, bg = '#ff6fb5', fg = '#fff8ee') {
  return tex(`label:${text}:${bg}:${fg}`, 256, 64, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 6, w, 5); g.fillRect(0, h - 11, w, 5);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `40px ${FONT}`;
    g.fillText(text, w * 0.25, h / 2 + 2);
    g.fillText(text, w * 0.75, h / 2 + 2);
  });
}

/** Retro-TV screen faces. mood: 'happy' | 'hurt' | 'dizzy' */
export function tvFace(mood = 'happy') {
  return tex(`tv:${mood}`, 160, 112, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    grd.addColorStop(0, mood === 'hurt' ? '#ff9aa8' : '#8ff5e6');
    grd.addColorStop(1, mood === 'hurt' ? '#d23a55' : '#1f9c9a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2); // scanlines
    g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 7; g.lineCap = 'round';
    if (mood === 'happy') {
      for (const x of [w * 0.34, w * 0.66]) { g.beginPath(); g.ellipse(x, h * 0.4, 9, 14, 0, 0, Math.PI * 2); g.fill(); }
      g.beginPath(); g.arc(w / 2, h * 0.56, 22, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    } else if (mood === 'hurt') {
      for (const x of [w * 0.34, w * 0.66]) {
        g.beginPath(); g.moveTo(x - 10, h * 0.3); g.lineTo(x + 10, h * 0.5); g.moveTo(x + 10, h * 0.3); g.lineTo(x - 10, h * 0.5); g.stroke();
      }
      g.beginPath();
      for (let i = 0; i <= 6; i++) g.lineTo(w * 0.32 + i * w * 0.06, h * 0.72 + (i % 2 ? -6 : 6));
      g.stroke();
    } else {
      for (const x of [w * 0.34, w * 0.66]) {
        g.beginPath();
        for (let a = 0; a < 12; a += 0.3) g.lineTo(x + Math.cos(a) * a * 1.3, h * 0.42 + Math.sin(a) * a * 1.3);
        g.lineWidth = 4; g.stroke();
      }
      g.lineWidth = 7; g.beginPath(); g.arc(w / 2, h * 0.72, 9, 0, Math.PI * 2); g.stroke();
    }
  });
}

/** Comic impact star (white/yellow burst with ink rim) — tinted by material colour. */
export function burstTexture() {
  return tex('burst', 256, 256, (g, w, h) => {
    burstPath(g, w / 2, h / 2, w * 0.2, w * 0.47, 11, 0.12);
    g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 10; g.strokeStyle = INK; g.stroke();
    burstPath(g, w / 2, h / 2, w * 0.1, w * 0.27, 9, 0.15);
    g.fillStyle = '#fff3a0'; g.fill();
  });
}

/** Ground decals: white masks tinted by material colour. */
export function decalTexture(kind) {
  return tex(`decal:${kind}`, 256, 256, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    let seed = kind.length * 7.3;
    const rnd = () => ((seed = Math.sin(seed * 91.7 + 13.1) * 43758.5453) - Math.floor(seed));
    if (kind === 'splat') {
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(cx, cy, w * 0.24, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 16; i++) {
        const a = rnd() * Math.PI * 2, d = w * (0.18 + rnd() * 0.24), r = w * (0.02 + rnd() * 0.06);
        g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2); g.fill();
        g.lineWidth = r * 1.1; g.strokeStyle = '#fff';
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); g.stroke();
      }
    } else if (kind === 'scorch') {
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.48);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.8)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      burstPath(g, cx, cy, w * 0.3, w * 0.48, 14, 0.2); g.fill();
    } else { // crack: comic ground crack
      g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rnd() * 0.5;
        let x = cx, y = cy;
        g.lineWidth = 9;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
          const d = w * (0.06 + rnd() * 0.07), b = a + (rnd() - 0.5) * 0.9;
          x += Math.cos(b) * d; y += Math.sin(b) * d;
          g.lineTo(x, y);
          g.lineWidth = Math.max(2, 9 - s * 2);
        }
        g.stroke();
      }
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.fill();
    }
  });
}

/** Core stage play-mat: lanes, polka dots, a centre star and the stadium name around the rim. */
export function playmatTexture() {
  return tex('playmat', 1024, 1024, (g, w, h) => {
    const cx = w / 2, cy = h / 2, R = w / 2;
    g.fillStyle = '#6fdc5a'; g.fillRect(0, 0, w, h);
    // Pie-slice lanes in two greens
    for (let i = 0; i < 16; i++) {
      g.beginPath(); g.moveTo(cx, cy);
      g.arc(cx, cy, R, (i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2);
      g.closePath();
      g.fillStyle = i % 2 ? '#6fdc5a' : '#63d150'; g.fill();
    }
    // Polka dots
    let seed = 4.2;
    const rnd = () => ((seed = Math.sin(seed * 91.7 + 13.1) * 43758.5453) - Math.floor(seed));
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2, d = R * (0.3 + rnd() * 0.55);
      g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 6 + rnd() * 8, 0, Math.PI * 2); g.fill();
    }
    // Rings
    const ring = (r, lw, col, dash = null) => {
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
      g.lineWidth = lw; g.strokeStyle = col; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
    };
    ring(R * 0.86, 30, '#fff3d6');
    ring(R * 0.86, 6, '#1b1030', [26, 22]);
    ring(R * 0.55, 22, '#fff3d6');
    ring(R * 0.25, 60, '#ffd23f');
    ring(R * 0.25 + 30, 6, '#1b1030');
    // Stadium name around the outer track
    g.fillStyle = '#1b1030'; g.font = `44px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const text = '★ DWEEB STADIUM ★ TOYBOX ISLAND ';
    const chars = (text + text).split('');
    chars.forEach((ch, i) => {
      const a = (i / chars.length) * Math.PI * 2;
      g.save();
      g.translate(cx + Math.cos(a) * R * 0.72, cy + Math.sin(a) * R * 0.72);
      g.rotate(a + Math.PI / 2);
      g.fillStyle = 'rgba(27,16,48,0.55)';
      g.fillText(ch, 0, 0);
      g.restore();
    });
    // Arrows pointing out toward the drop
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      g.save(); g.translate(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94); g.rotate(a);
      g.beginPath(); g.moveTo(18, 0); g.lineTo(-14, -20); g.lineTo(-6, 0); g.lineTo(-14, 20); g.closePath(); g.fill();
      g.restore();
    }
    // Centre star
    burstPath(g, cx, cy, R * 0.07, R * 0.17, 5);
    g.fillStyle = '#ff9a3c'; g.fill();
    g.lineWidth = 8; g.strokeStyle = '#1b1030'; g.stroke();
  });
}

/** Big letter block face: bold letter on a colour square with an inset border. */
export function letterBlock(letter, bg) {
  return tex(`letter:${letter}:${bg}`, 256, 256, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.lineWidth = 14; g.strokeStyle = '#fff8ee'; g.strokeRect(20, 20, w - 40, h - 40);
    g.fillStyle = '#fff8ee'; g.font = `190px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = INK; g.strokeText(letter, w / 2, h / 2 + 10);
    g.fillText(letter, w / 2, h / 2 + 10);
  });
}
