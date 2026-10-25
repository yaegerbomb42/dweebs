// main-shell.js — the app shell's entry point, loaded from index.html.
//
// This file is deliberately paranoid. The shell is an *enhancement*: the game
// boots and plays perfectly without it, so a failure here must never become a
// failure there. Two layers of insurance:
//
//   1. Everything is wrapped in try/catch. If bootApp() throws for any reason we
//      log it, hide our (possibly half-built) shell, and leave the original
//      #main-menu visible. The result is the game exactly as it shipped.
//   2. main.js and this file are independent module scripts, so even a total
//      failure to parse this one leaves src/main.js untouched and running.

import './shell.css';
import { bootApp } from './boot.js';

/* global console, document, CustomEvent */

function fallbackToLegacy(reason) {
  console.error('[app] shell boot failed, falling back to the original menu:', reason);
  try {
    document.getElementById('app-shell')?.classList.add('hidden');
    // The legacy menu is the offline flow. Show it so play still works.
    document.getElementById('main-menu')?.classList.remove('hidden');
  } catch { /* nothing more we can do */ }
}

try {
  const app = bootApp();
  // Expose for debugging and for QA's headless checks. Harmless in prod.
  window.__dweebsApp = app;
  window.dispatchEvent(new CustomEvent('dweebs:shell-ready', { detail: { app } }));
} catch (err) {
  fallbackToLegacy(err);
}

// A later async failure inside the shell (a bad room code, a dead socket) must
// also degrade to "the game still works" rather than a white screen.
window.addEventListener('error', e => {
  if (e?.message?.includes('ResizeObserver')) return;   // benign
  console.error('[app] uncaught shell error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', e => {
  console.error('[app] unhandled rejection in shell:', e.reason);
});
