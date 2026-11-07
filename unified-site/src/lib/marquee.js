/* Seamless capability ribbon. Scroll velocity leaks into its speed. */
import { state, addTick } from './state.js';

export function initMarquees() {
  const wraps = [...document.querySelectorAll('[data-marquee]')];
  if (!wraps.length) return;

  for (const wrap of wraps) {
    const track = wrap.querySelector('.marquee__track');
    const row = wrap.querySelector('[data-row]');
    if (!track || !row) continue;

    const base = parseFloat(wrap.dataset.speed || '50');
    const dir = parseFloat(wrap.dataset.dir || '1');

    let width = 0; // width of one row = the loop period
    let x = 0;
    let spans = []; // { el, left, w } — layout offsets, stable under transform
    let frameCount = 0;

    const build = () => {
      // reset to a single original row, then clone until it overflows twice
      [...track.querySelectorAll('[data-row]')].forEach((r, i) => { if (i > 0) r.remove(); });
      const first = track.querySelector('[data-row]');
      first.classList.remove('is-clone');

      width = first.getBoundingClientRect().width;
      if (!width) return;

      const need = Math.ceil((window.innerWidth * 2) / width) + 1;
      for (let i = 1; i < need; i++) {
        const c = first.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        c.setAttribute('data-row', '');
        c.classList.add('is-clone');
        track.appendChild(c);
      }

      // One layout pass, at rebuild time only. Positions are taken relative to
      // the track (whose transform cancels out) and folded into a single loop
      // period, so at runtime a modulo is all the position maths we need.
      const origin = track.getBoundingClientRect().left;
      spans = [...track.querySelectorAll('.marquee__row > li')].map((li) => {
        const r = li.getBoundingClientRect();
        return { el: li, left: (((r.left - origin) % width) + width) % width, w: r.width };
      });
    };

    build();
    const ro = new ResizeObserver(build);
    ro.observe(row);

    addTick((_t, dt) => {
      if (!width) return;

      const velBoost = state.reduced ? 0 : state.vel * 5.5;
      const speed = base + Math.max(-260, Math.min(260, velBoost));
      x -= (speed * dir * dt) / 1000;
      if (x <= -width) x += width;
      if (x > 0) x -= width;
      track.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;

      // Soft blur near the viewport edges. No layout reads, no style churn.
      if (++frameCount % 4) return;
      const vw = window.innerWidth;
      if (width < vw) return; // the whole strip is on screen: nothing to fade
      for (const s of spans) {
        if (!s.w) continue;
        const pos = ((s.left + x) % width + width) % width;
        const cx = pos + s.w / 2;
        const edge = Math.min(cx, vw - cx);
        const level = edge < 90 ? '1' : edge < 240 ? '2' : '';
        if (s.el.dataset.blur !== level) {
          if (level) s.el.dataset.blur = level;
          else delete s.el.dataset.blur;
        }
      }
    });
  }
}
