/* Text masking + scroll reveals. */
import { state, addTick, clamp } from './state.js';

/* Split a heading into masked lines / words. */
export function splitText(el) {
  if (el.dataset.splitDone) return;
  const raw = el.innerHTML.trim();
  const lines = raw.split(/<br\s*\/?>/i);
  const out = lines.map((line, li) => {
    const words = line.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    let i = 0;
    const inner = words
      .map((w) => {
        const d = `${(li * 90 + i++ * 42).toFixed(0)}ms`;
        return `<span class="split-word" style="--d:${d}">${w}</span>`;
      })
      .join(' ');
    return `<span class="split-line">${inner}</span>`;
  });
  el.innerHTML = out.join('');
  el.dataset.splitDone = '1';
}

export function initDrawer({ onReady } = {}) {
  const reveals = [...document.querySelectorAll('[data-reveal]')];
  const staggers = [...document.querySelectorAll('[data-stagger]')];
  const splits = [...document.querySelectorAll('[data-split]')];

  reveals.forEach((el, i) => {
    if (!el.style.getPropertyValue('--d')) {
      el.style.setProperty('--d', `${Math.min(i * 55, 260)}ms`);
    }
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
  );

  const splitIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        splitIo.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -18% 0px', threshold: 0.2 }
  );

  const arm = () => {
    reveals.forEach((el) => io.observe(el));
    staggers.forEach((el) => io.observe(el));
    splits.forEach((el) => {
      splitText(el);
      splitIo.observe(el);
    });
    document.body.dataset.loading = 'false';
    document.body.classList.add('is-ready');
    onReady?.();
  };

  // Draw first-frame reveals immediately once the boot screen clears.
  return { arm };
}

/* Words that light up as the section moves through the viewport. */
export function initScrollWords() {
  const els = [...document.querySelectorAll('[data-scroll-words]')];
  if (!els.length) return;

  const items = els.map((el) => {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    const words = text.split(' ');
    el.textContent = '';
    const spans = words.map((w, i) => {
      const s = document.createElement('span');
      s.className = 'sw';
      s.textContent = w;
      el.appendChild(s);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
      return s;
    });
    return { el, spans, top: 0, height: 0 };
  });

  const measure = () => {
    for (const it of items) {
      const r = it.el.getBoundingClientRect();
      it.top = r.top + window.scrollY;
      it.height = r.height;
    }
  };
  measure();
  window.addEventListener('resize', measure, { passive: true });
  // fonts settle a frame or two after load
  setTimeout(measure, 400);

  const ease = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  addTick(() => {
    const vh = state.h;
    for (const it of items) {
      // Lighting window: starts as the block crosses 92% of the viewport and
      // completes after 0.62 viewport-heights of scrolling. Word thresholds are
      // spread evenly across it, so even a 30-word quote reads at a calm pace.
      const p = (state.ssy - (it.top - vh * 0.92)) / (vh * 0.62);
      const n = it.spans.length;
      for (let i = 0; i < n; i++) {
        const th = n > 1 ? i / (n - 1) : 0;
        const lit = ease(th - 0.055, th + 0.055, p);
        const cls = lit > 0.7 ? 'is-on' : lit > 0.2 ? 'is-warm' : '';
        const want = cls ? `sw ${cls}` : 'sw';
        if (it.spans[i].className !== want) it.spans[i].className = want;
      }
    }
  });
}

/* Scroll-linked parallax + hero recession. */
export function initParallax() {
  const layers = [...document.querySelectorAll('[data-parallax]')];
  const hero = document.querySelector('[data-hero]');
  const heroSection = document.querySelector('.hero');
  const ambient = document.querySelector('.hero__ambient');
  const agents = [...document.querySelectorAll('[data-agent]')];
  const wordmark = document.querySelector('[data-wordmark]');

  if (!layers.length && !hero) return;

  addTick(() => {
    const sy = state.ssy;

    if (state.reduced) return;

    if (hero && heroSection) {
      const p = clamp(sy / (state.h * 0.95));
      hero.style.transform = `translate3d(0, ${-p * 90}px, 0) scale(${1 - p * 0.045})`;
      hero.style.opacity = String(1 - p * 0.95);
      if (ambient) ambient.style.transform = `translate3d(0, ${p * 150}px, 0)`;
      if (wordmark) wordmark.style.filter = `blur(${(p * 4).toFixed(2)}px)`;
      if (agents && !state.reduced) {
        for (const a of agents) {
          const d = parseFloat(a.dataset.depth || '0.2');
          // consumed by initAgentCards, which owns `translate`
          a.dataset.par = String(p * 230 * d);
        }
      }
    }

    for (const l of layers) {
      const rect = l.parentElement.getBoundingClientRect();
      const mid = rect.top + rect.height / 2 - state.h / 2;
      const amt = parseFloat(l.dataset.parallax || '0.2');
      l.style.transform = `translate3d(0, ${(-mid * amt).toFixed(2)}px, 0)`;
    }
  });
}

/* Nav: stuck state + hide-on-scroll-down. */
export function initNav() {
  const nav = document.querySelector('[data-nav]');
  if (!nav) return;
  let last = 0;
  addTick(() => {
    const y = state.sy;
    nav.classList.toggle('is-stuck', y > 32);
    const goingDown = y > last + 1.2;
    const goingUp = y < last - 1.2;
    if (y > 240 && goingDown) nav.classList.add('is-hidden');
    else if (goingUp || y < 240) nav.classList.remove('is-hidden');
    if (Math.abs(y - last) > 0.6) last = y;
  });
}

/* Anchor smooth scrolling with an eased, slightly cinematic curve. */
export function initAnchors() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    if (!id || id === '#') return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 10;
    window.scrollTo({ top, behavior: state.reduced ? 'auto' : 'smooth' });
    window.history.replaceState(null, '', id);
  });
}
