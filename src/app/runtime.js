// runtime.js — pushes settings into the live game and owns the browser-level
// survival concerns: WebGL context loss, tab-hidden pause, the service worker.
//
// Design rule for this file: everything here is best-effort and defensive.
// A missing handle (production build without window.__dweebs, or a game that
// failed to load) must never throw, because a throw here could stop the shell
// from rendering and take offline play down with it.

import { loadSettings, onSettingsChange, serverUrl } from './settings.js';
import { game, applyAudioSettings, isMatchLive } from './legacy.js';

/* global document, window, navigator, console, CustomEvent, setTimeout, location */

/** Fire-and-forget custom event other modules can listen for. */
export function appEmit(name, detail) {
  document.dispatchEvent(new CustomEvent('dweebs:' + name, { detail }));
}

// ─── Settings → live game ────────────────────────────────────────────────────

/**
 * Apply the current settings to whatever game handle exists.
 * Called on boot, on every settings change, and when a match starts.
 */
export function applySettings() {
  const s = loadSettings();
  const g = game();
  applyAudioSettings(g?.audio, s);
  window.__dweebsGovernor?.setAuto?.(s.quality === 'auto');
  applyQuality(g?.renderer, s.quality);
  applyReducedMotion(g, s.reducedMotion);
  return s;
}

/** Quality preset: shadow map on/off plus a render-scale hint. */
function applyQuality(renderer, quality) {
  if (!renderer) return;
  // 'auto' is handled by the quality governor; skip here
  if (quality === 'auto') return;
  const dpr = window.devicePixelRatio || 1;
  const scale = quality === 'low' ? 0.6 : quality === 'medium' ? 0.85 : 1;
  try {
    renderer.setPixelRatio(Math.min(dpr, 2) * scale);
    renderer.shadowMap.enabled = quality !== 'low';
  } catch { /* renderer not ready yet */ }
}

/**
 * Reduced motion zeroes the camera shake by clamping the CameraController's
 * shake input. Fx.js calls cam.shake() from many places, so clamping at the
 * controller is the one place that covers all of them without editing Fx.js
 * (which the Lead owns).
 */
function applyReducedMotion(g, on) {
  const cam = g?.cam;
  if (!cam) return;
  if (on) {
    if (!cam.__appShakePatched) {
      cam.__appShakePatched = true;
      cam.__appShake = cam.shake.bind(cam);
      cam.shake = () => {};               // hard stop: no shake at all
    }
  } else if (cam.__appShakePatched) {
    cam.shake = cam.__appShake;
    cam.__appShakePatched = false;
  }
  document.documentElement.dataset.reducedMotion = on ? 'on' : 'off';
}

/** Wire settings changes to the game, for as long as the app is alive. */
export function watchSettings() {
  return onSettingsChange(() => {
    applySettings();
    appEmit('settings', loadSettings());
  });
}

// ─── WebGL context loss ──────────────────────────────────────────────────────

/**
 * three.js does not recover a lost context on its own: the buffers are gone and
 * the next frame draws nothing. The honest fix is to tell the player and reload
 * the game module, because the sim/physics state lives on the GPU-backed side
 * and cannot be reconstructed. We preventDefault so the browser gives us a
 * 'contextrestored' chance first, and only reload if that doesn't arrive.
 */
export function installContextLoss({ onLost, toast }) {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return () => {};

  let restored = false;
  let reloading = false;

  canvas.addEventListener('webglcontextlost', e => {
    // Required, or the browser never fires contextrestored.
    e.preventDefault();
    restored = false;
    onLost?.();
    toast?.error('Graphics lost — restoring the arena…', { ms: 6000 });

    // Give the driver a chance to restore before we resort to a reload.
    setTimeout(() => {
      if (restored || reloading) return;
      reloading = true;
      // The GPU-side buffers are gone and physics state lives with them, so a
      // reload is the only honest recovery. We go to #/ (the title) rather than
      // a deep route, so the player lands somewhere that always works offline.
      location.hash = '#/';
      location.reload();
    }, 2500);
  }, false);

  canvas.addEventListener('webglcontextrestored', () => {
    restored = true;
    toast?.info('Graphics restored.');
    applySettings();          // re-apply quality/DPR to the fresh context
  }, false);
}

// ─── Tab hidden ──────────────────────────────────────────────────────────────

/**
 * Browsers throttle rAF in a hidden tab, so a match left running in the
 * background would resume with one enormous dt and teleport everyone. Pausing
 * on hide is therefore a correctness fix, not just battery saving.
 *
 * This only ever *pauses*; it never quits and never blocks. If the game handle
 * isn't there (still loading), we do nothing at all.
 */
export function installVisibilityPause({ toast } = {}) {
  const onChange = () => {
    const g = game();
    if (document.hidden) {
      appEmit('hidden');
      if (!isMatchLive()) return;
      // The browser suspends the AudioContext anyway; zeroing the gain stops
      // any queued music from blaring out when the tab comes back.
      try { g?.audio?.setVolume?.(0); } catch { /* not ready */ }
      toast?.info('Paused — the tab was hidden.');
    } else {
      appEmit('visible');
      if (g?.audio) applyAudioSettings(g.audio, loadSettings());
    }
  };
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

// ─── Service worker ──────────────────────────────────────────────────────────

/**
 * Register the offline cache. Only in a production build: in dev the SW would
 * serve stale modules and make everyone else's HMR lie to them.
 */
export function registerServiceWorker({ toast } = {}) {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      .then(reg => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              toast?.info('Update ready — reload to play the new build.');
            }
          });
        });
      })
      .catch(err => console.warn('[app/sw] registration failed', err));
  });
}

export { serverUrl };
