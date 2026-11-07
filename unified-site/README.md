# Unified — landing page

A cinematic, zero-dependency landing page for **Unified**, an AI agent framework.
Pure black, charcoal layers, film grain, one electric accent (`#00F0FF`).

No build step, no framework, no runtime packages. One HTML document, four
stylesheets, eight ES modules, and two variable fonts.

## Run it

```bash
node server.mjs            # http://0.0.0.0:4173
node server.mjs 8080       # any port
```

The page is plain static files, so any host works — the server exists only because
`file://` blocks ES modules. Binds `0.0.0.0` and sends `frame-ancestors *` so the
sandbox preview proxy can embed it.

## Structure

```
index.html
fonts/            Geist + Geist Mono (variable, SIL OFL 1.1)
server.mjs        dependency-free static server
src/
  main.js         boot sequence + module wiring
  lib/
    state.js      shared pointer/scroll state + ONE rAF ticker + spring class
    reveal.js     mask/clip text reveals, scroll-word lighting, parallax, nav
    interactions.js  magnetic hover, 3D tilt + reflection, agent cards, cursor
    particles.js  pointer-reactive dust field (canvas)
    mesh.js       the agent mesh: nodes, reconfiguring edges, pulses (canvas)
    marquee.js    seamless capability ribbons with edge falloff
    terminal.js   the self-typing CTA session
  styles/
    base.css      tokens, type, glass, grain, buttons, nav, reveal primitives
    hero.css      wordmark depth stack, liquid blobs, floating agent cards
    sections.css  marquee, mesh, feature grid, parallax band
    cta.css       terminal, form, footer
```

## How the motion holds together

- **One ticker.** Every animated module subscribes to a single
  `requestAnimationFrame` loop in `state.js`, so nothing fights for frames and
  the springs all advance on the same clamped delta (no explosions after a tab
  switch).
- **Springs, not easings, for input.** Magnetic buttons, tilts and card drift use
  a semi-implicit Euler spring (sub-stepped) so hover *settles* rather than
  arrives. CSS curves handle one-shot reveals.
- **Write only when it changed.** Tilt and drift modules compare against the last
  written value and skip the DOM write when the delta is invisible; the marquee
  blur pass measures layout once per rebuild and then does modulo maths only.
- **Depth is composed, not stacked.** The floating cards get scroll offset from
  the parallax module and pointer drift from the interaction module through
  `data-par`, so two systems never write the same transform.
- **The wordmark** is three stacked text layers offset in Z: a cyan-stroked
  ghost, a white-stroked ghost, and a gradient-filled face with a slow rim-light
  sweep and a breathing scale/tracking cycle. It leans with the pointer through
  a spring, and blurs as it recedes.

## Accessibility & fallbacks

- `prefers-reduced-motion` disables the boot animation, parallax, scroll-linked
  lighting, the pointer-reactive field and every transition.
- Without JavaScript, `<noscript>` styles unlock scrolling, hide the boot
  screen and reveal all content.
- One `h1`, ordered headings, skip link, labelled form, `:focus-visible` rings,
  decorative canvases marked `aria-hidden`.
- The custom cursor only engages on fine pointers; native cursor is restored
  otherwise.

## Notes

This lives in its own directory so it does not disturb the DWEEBS game app; it
is a standalone design deliverable and shares nothing with the game's build.
