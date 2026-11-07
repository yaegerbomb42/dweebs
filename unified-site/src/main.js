import { state, addTick } from './lib/state.js';
import { initDrawer, initParallax, initNav, initAnchors, initScrollWords } from './lib/reveal.js';
import {
  initMagnetic,
  initTilt,
  initAgentCards,
  initWordmark,
  initCursor,
} from './lib/interactions.js';
import { initParticles } from './lib/particles.js';
import { initMesh } from './lib/mesh.js';
import { initMarquees } from './lib/marquee.js';
import { initTerminal } from './lib/terminal.js';

/* ═══════════════════════════════════════════════════════════════════════
   Boot: a short, quiet handshake rather than a spinner.
   ═══════════════════════════════════════════════════════════════════════ */

function boot() {
  const el = document.getElementById('boot');
  const bar = document.getElementById('bootBar');
  const num = document.getElementById('bootCount');
  if (!el || !bar || !num) return Promise.resolve();

  if (state.reduced) {
    el.dataset.done = 'true';
    bar.style.transform = 'scaleX(1)';
    num.textContent = '100';
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const DUR = 980;
    const start = performance.now();
    let shown = -1;

    const step = (now) => {
      const p = Math.min(1, (now - start) / DUR);
      // ease-out quart, so it decelerates into the reveal
      const e = 1 - Math.pow(1 - p, 4);
      bar.style.transform = `scaleX(${e.toFixed(4)})`;
      const n = Math.floor(e * 100);
      if (n !== shown) {
        shown = n;
        num.textContent = String(n).padStart(2, '0');
      }
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        setTimeout(() => {
          el.dataset.done = 'true';
          document.body.dataset.loading = 'false';
          setTimeout(resolve, 240);
        }, 220);
      }
    };
    requestAnimationFrame(step);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Liquid: blobs lean with the pointer, very gently.
   ═══════════════════════════════════════════════════════════════════════ */

function initBlobs() {
  const blobs = [...document.querySelectorAll('[data-blob]')];
  if (!blobs.length || state.reduced) return;
  addTick(() => {
    for (let i = 0; i < blobs.length; i++) {
      const d = 18 + i * 12;
      blobs[i].style.translate = `${(state.tx * d).toFixed(2)}px ${(state.ty * d * 0.7).toFixed(2)}px`;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Form: quiet confirmation, never a jarring alert.
   ═══════════════════════════════════════════════════════════════════════ */

function initForm() {
  const form = document.querySelector('[data-form]');
  const note = document.querySelector('[data-form-note]');
  if (!form || !note) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    if (!input || !input.value || !input.checkValidity()) {
      input?.focus();
      note.textContent = 'Please enter a valid work email.';
      note.classList.remove('is-ok');
      return;
    }
    form.classList.add('is-done');
    input.disabled = true;
    const btn = form.querySelector('button');
    const label = btn?.querySelector('.btn__label');
    if (label) label.textContent = 'Requested';
    if (btn) btn.style.pointerEvents = 'none';
    note.classList.add('is-ok');
    note.textContent = '✓  You are on the list. Watch for an invite within 48h.';
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Go
   ═══════════════════════════════════════════════════════════════════════ */

async function main() {
  try {
    await boot_();
  } catch (err) {
    console.error('[unified] init failed', err);
    document.body.dataset.loading = 'false';
  }
}

async function boot_() {
  initParticles();
  initMesh();
  initMarquees();
  initParallax();
  initScrollWords();
  initNav();
  initAnchors();
  initBlobs();
  initCursor();
  initMagnetic();
  initTilt();
  initAgentCards();
  initWordmark();
  initTerminal();
  initForm();

  const drawer = initDrawer();

  // Safety net: if anything above stalls, the page still unlocks.
  const unlock = setTimeout(() => {
    document.body.dataset.loading = 'false';
    drawer.arm();
  }, 4000);

  await boot();
  clearTimeout(unlock);
  drawer.arm();

  // A tiny settle after the reveal so the hero arrives, not pops.
  requestAnimationFrame(() => document.documentElement.classList.add('is-live'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}
