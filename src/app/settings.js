// settings.js — APP-owned settings, persisted in localStorage.
//
// The key 'dweebs-settings' is deliberately shared with src/main.js: the game
// already reads bots/difficulty/stocks/music/sound/type/color from it, and it
// writes them back. So the legacy offline menu and this settings screen are two
// views of one object, and a change made in either is seen by the other on the
// next menu paint. Everything APP adds (volumes, quality, motion, bindings) is
// namespaced under these keys and ignored by main.js.
//
// Reads are defensive: a corrupt or hostile localStorage must never stop the
// game booting, so every getter falls back to the default.

/* global URLSearchParams */

const KEY = 'dweebs-settings';

export const DEFAULTS = {
  // ── legacy, read by main.js ──
  bots: '3',
  difficulty: 'normal',
  stocks: '3',
  music: 'on',
  sound: 'on',
  mode: 'derby',
  type: 'cube',
  color: 'yellow',
  // ── APP-owned ──
  playerName: 'You',
  master: 0.8,
  sfx: 1,
  musicVol: 0.6,
  quality: 'auto',        // low | medium | high | auto
  reducedMotion: false,
  gamepad: true,
  invertY: false,
  sensitivity: 1,
  bindings: null,         // null = factory defaults; otherwise { action: KeyboardEvent.code }
  serverUrl: '',
  colorblind: 'off',      // off | deuteranopia | protanopia | tritanopia
};

/** Default key map. Mirrors the on-screen controls list in index.html. */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  grab: ['KeyE', 'Mouse2'],
  dodge: ['ShiftLeft', 'ShiftRight'],
  style: ['KeyF'],
  drop: ['KeyQ'],
  parry: ['KeyC'],
};

export const BINDING_LABELS = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump / double jump',
  grab: 'Grab / throw',
  dodge: 'Dive / air-dodge',
  style: 'Cash in style',
  drop: 'Drop item',
  parry: 'Parry',
};

/** Gamepad button indices → the same actions, polled by the gamepad adapter. */
export const DEFAULT_PAD_BUTTONS = {
  jump: 0,      // A
  grab: 2,      // X
  dodge: 1,     // B
  style: 3,     // Y
  drop: 4,      // LB
};

let cache = null;
const subscribers = new Set();

export function loadSettings() {
  if (cache) return cache;
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { raw = {}; }
  if (typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  cache = { ...DEFAULTS, ...raw };
  cache.bindings = normaliseBindings(cache.bindings);
  return cache;
}

/** Merge partial updates into settings, persist, notify listeners, return settings. */
export function saveSettings(patch = {}) {
  const s = { ...loadSettings(), ...patch };
  s.bindings = normaliseBindings(s.bindings);
  cache = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: keep in memory */ }
  for (const fn of subscribers) fn(s);
  return s;
}

export function onSettingsChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function normaliseBindings(b) {
  if (!b || typeof b !== 'object') return { ...DEFAULT_BINDINGS };
  const out = { ...DEFAULT_BINDINGS };
  for (const action of Object.keys(DEFAULT_BINDINGS)) {
    const v = b[action];
    if (Array.isArray(v) && v.length) out[action] = v.filter(c => typeof c === 'string');
    else if (typeof v === 'string') out[action] = [v];
  }
  return out;
}

/** "KeyW" → "W", "Space" → "SPACE". Used for the rebinding UI only. */
export function prettyCode(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  if (code.startsWith('Mouse')) return 'MOUSE ' + code.slice(5);
  return code.toUpperCase();
}

/** Render a quality preset for the UI. */
export function describeQuality(q) {
  return {
    auto: { label: 'Auto', detail: 'Adapts to device performance' },
    low: { label: 'Low', detail: 'No shadows · half res · 30 fps cap' },
    medium: { label: 'Medium', detail: 'Shadows on · full res' },
    high: { label: 'High', detail: 'Shadows + outlines · full res' },
  }[q] || { label: q, detail: '' };
}

/**
 * Server URL, most specific first:
 *   ?server=…            (shareable, per-session override)
 *   localStorage          (the player set it once)
 *   VITE_SERVER_URL       (baked in at build time for the deploy)
 * Returns '' when unset — the client then uses same-origin /ws (production) or
 * localhost:8787 (dev), so a stock `vite build` deploys without extra config.
 */
export function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const stored = loadSettings().serverUrl;
  if (stored) return stored;
  return (import.meta.env?.VITE_SERVER_URL) || '';
}
