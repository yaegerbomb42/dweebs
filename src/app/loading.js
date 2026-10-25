// loading.js — progress mechanics for the Boot/Loading screen.
//
// The Lead owns the loading *art*; APP owns progress, errors and retry. So this
// module only ever writes three things: the width of #load-fill, the text of
// #load-label, and the .hidden class. It never sets a colour, font or layout on
// anything inside #loading-screen.
//
// The hooks were proposed on the board (COORDINATION.md → Requests, APP→LEAD).
// If the Lead has added #load-bar / #load-fill / #load-label / #load-retry we
// drive those. If not, we create them ourselves, unstyled, so the bar is real
// today and inherits the Lead's styling for free the moment they add it.

/* global console */

const HOOKS = { bar: 'load-bar', fill: 'load-fill', label: 'load-label', retry: 'load-retry' };

export function createLoading({ screen = null } = {}) {
  const root = screen || document.getElementById('loading-screen');
  let fill = document.getElementById(HOOKS.fill);
  let label = document.getElementById(HOOKS.label);
  let retry = document.getElementById(HOOKS.retry);

  // Create the missing hooks ourselves. Deliberately unstyled: the only CSS
  // these get is the .app-load-* rules in shell.css, which the Lead can restyle.
  if (root && !fill) {
    let bar = document.getElementById(HOOKS.bar);
    if (!bar) { bar = document.createElement('div'); bar.id = HOOKS.bar; root.appendChild(bar); }
    fill = document.createElement('div');
    fill.id = HOOKS.fill;
    bar.appendChild(fill);
  }
  if (root && !label) {
    // The Lead's screen already has one <p>; reuse it as the label.
    label = root.querySelector('p');
    if (label && !label.id) label.id = HOOKS.label;
  }
  if (root && !retry) {
    retry = document.createElement('button');
    retry.id = HOOKS.retry;
    retry.className = 'btn white hidden';
    retry.textContent = 'TRY AGAIN';
    root.appendChild(retry);
  }

  let pct = 0;
  let failed = false;

  /** Monotonic progress: a phase can never move the bar backwards. */
  function progress(p, text) {
    if (failed) return pct;
    pct = Math.max(pct, Math.min(100, Math.round(p)));
    if (fill) fill.style.width = pct + '%';
    if (label && text) label.textContent = text;
    document.documentElement.dataset.loadPct = String(pct);
    return pct;
  }

  function fail(err, onRetry) {
    failed = true;
    if (label) label.textContent = 'Failed to load — check your connection.';
    if (retry) {
      retry.classList.remove('hidden');
      retry.onclick = () => { failed = false; pct = 0; onRetry?.(); };
    }
    root?.classList.remove('hidden');
    console.error('[app/loading]', err);
  }

  const done = () => { failed = false; root?.classList.add('hidden'); };

  return { progress, fail, done, retry, get pct() { return pct; }, reset() { pct = 0; failed = false; } };
}
