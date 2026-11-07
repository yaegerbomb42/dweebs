/* A session that types itself. Starts when the CTA scrolls into view. */
import { state } from './state.js';

const SCRIPT = [
  { type: 'cmd', text: 'unified init my-mesh' },
  { type: 'out', text: '◇ runtime     v4.0.2' },
  { type: 'out', text: '◇ agents      5 defined' },
  { type: 'out', text: '◇ tools       12 attached' },
  { type: 'gap' },
  { type: 'cmd', text: 'unified run --mesh plan.yaml' },
  { type: 'run', text: 'planner     decomposing intent', ok: '0.4s' },
  { type: 'run', text: 'researcher  reading 14 sources', ok: '2.1s' },
  { type: 'run', text: 'coder       writing 3 files', ok: '5.8s' },
  { type: 'run', text: 'critic      confidence 0.94', ok: '0.3s' },
  { type: 'ok', text: 'mesh complete  ·  8.6s  ·  $0.041' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function initTerminal() {
  const body = document.getElementById('termBody');
  const box = document.querySelector('[data-terminal]');
  if (!body || !box) return;

  let started = false;

  const line = (html, cls = '') => {
    const el = document.createElement('span');
    el.className = `ln ${cls}`.trim();
    el.innerHTML = html;
    body.appendChild(el);
    return el;
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function play() {
    if (started) return;
    started = true;
    await wait(360);

    for (const step of SCRIPT) {
      if (state.reduced) {
        // still render everything, just without the typing
        if (step.type === 'gap') { line('&nbsp;'); continue; }
        if (step.type === 'cmd') { line(`<span class="p">$</span> <span class="cmd">${esc(step.text)}</span>`); continue; }
        if (step.type === 'run') {
          line(`<span class="acc">→</span> <span class="cmd">${esc(step.text)}</span> <span class="dim">✓ ${step.ok}</span>`);
          continue;
        }
        if (step.type === 'ok') { line(`<span class="ok">✓</span> <span class="acc">${esc(step.text)}</span>`); continue; }
        line(esc(step.text), 'warn');
        continue;
      }

      if (step.type === 'gap') {
        line('&nbsp;');
        await wait(120);
      } else if (step.type === 'cmd') {
        const el = line('<span class="p">$</span> <span class="cmd"></span>');
        el.dataset.pre = '';
        const cmd = el.querySelector('.cmd');
        await wait(220);
        for (let i = 0; i < step.text.length; i++) {
          cmd.textContent = step.text.slice(0, i + 1);
          await wait(30 + Math.random() * 34);
        }
        await wait(260);
      } else if (step.type === 'run') {
        const el = line(
          `<span class="acc">→</span> <span class="cmd">${esc(step.text)}</span> <span class="dim run-ok">✓ ${step.ok}</span>`
        );
        const ok = el.querySelector('.run-ok');
        ok.style.opacity = '0';
        await wait(180);
        ok.style.transition = 'opacity .5s ease';
        ok.style.opacity = '1';
      } else if (step.type === 'ok') {
        line(`<span class="ok">✓</span> <span class="acc">${esc(step.text)}</span>`);
        await wait(200);
      } else {
        line(esc(step.text), 'warn');
        await wait(90);
      }
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          play();
          io.disconnect();
        }
      }
    },
    { threshold: 0.35 }
  );
  io.observe(box);
}
