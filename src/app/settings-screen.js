// settings-screen.js — the settings UI: volumes, rebinding, gamepad, motion, quality.
//
// It only writes to localStorage via saveSettings(); a subscriber (see
// runtime.js) pushes the values into the live game. Keeping the two apart means
// the settings screen is testable and the game is never poked at directly from
// a UI handler.

import { setSeg } from './dom.js';
import { loadSettings, saveSettings, onSettingsChange, prettyCode, DEFAULT_BINDINGS } from './settings.js';

/* global navigator, setInterval, clearInterval, window */

const SLIDERS = {
  'app-vol-master': ['master', v => v / 100],
  'app-vol-sfx': ['sfx', v => v / 100],
  'app-vol-music': ['musicVol', v => v / 100],
  'app-sens': ['sensitivity', v => v / 100],
};

export function mountSettings({ root, toast }) {
  const q = sel => root.querySelector(sel);
  let rebinding = null;   // action currently awaiting a key press

  function paint(s) {
    for (const [id, [key, toVal]] of Object.entries(SLIDERS)) {
      const input = q('#' + id);
      if (!input) continue;
      input.value = String(Math.round((s[key] ?? toVal(1)) * 100));
      const out = q('#' + id + '-out');
      if (out) out.value = out.textContent = input.value + '%';
    }
    setSeg(q('.seg[data-setting="quality"]'), s.quality);
    setSeg(q('.seg[data-setting="reducedMotion"]'), String(!!s.reducedMotion));
    setSeg(q('.seg[data-setting="gamepad"]'), String(!!s.gamepad));
    setSeg(q('.seg[data-setting="invertY"]'), String(!!s.invertY));
    setSeg(q('.seg[data-setting="music"]'), s.music);
    setSeg(q('.seg[data-setting="sound"]'), s.sound);
    paintBindings(s);
  }

  function paintBindings(s) {
    for (const [action, codes] of Object.entries(s.bindings || DEFAULT_BINDINGS)) {
      const out = q('[data-key="' + action + '"]');
      if (out) out.textContent = codes.map(prettyCode).join(' / ');
    }
  }

  // ─── sliders ───
  for (const [id, [key, toVal]] of Object.entries(SLIDERS)) {
    const input = q('#' + id);
    if (!input) continue;
    input.addEventListener('input', () => {
      const out = q('#' + id + '-out');
      if (out) out.value = out.textContent = input.value + '%';
      saveSettings({ [key]: toVal(Number(input.value)) });
    });
  }

  // ─── segmented toggles ───
  for (const seg of root.querySelectorAll('.seg[data-setting]')) {
    for (const b of seg.querySelectorAll('button')) {
      b.onclick = () => {
        const key = seg.dataset.setting;
        const raw = b.dataset.v;
        const value = (raw === 'true' || raw === 'false') ? raw === 'true' : raw;
        saveSettings({ [key]: value });
      };
    }
  }

  // ─── rebinding ───
  function beginRebind(action, btn) {
    rebinding = action;
    for (const other of root.querySelectorAll('.app-bind')) other.classList.remove('is-listening');
    btn.classList.add('is-listening');
    const key = btn.querySelector('.app-bind-key');
    if (key) key.textContent = 'PRESS…';
  }

  function cancelRebind() {
    if (!rebinding) return;
    const btn = root.querySelector('.app-bind[data-action="' + rebinding + '"]');
    btn?.classList.remove('is-listening');
    rebinding = null;
    paintBindings(loadSettings());
  }

  for (const btn of root.querySelectorAll('.app-bind')) {
    btn.onclick = () => beginRebind(btn.dataset.action, btn);
  }

  // Capture phase + preventDefault so the game never sees the rebinding key
  // press and acts on it (e.g. jumping) while the player is choosing a binding.
  function onKeyDown(e) {
    if (!rebinding) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { cancelRebind(); return; }
    const s = loadSettings();
    saveSettings({ bindings: { ...s.bindings, [rebinding]: [e.code] } });
    toast.info(prettyCode(e.code) + ' bound to ' + btn_label(rebinding));
    cancelRebind();
  }
  document.addEventListener('keydown', onKeyDown, true);

  q('#app-binds-reset').onclick = () => {
    saveSettings({ bindings: { ...DEFAULT_BINDINGS } });
    cancelRebind();
    toast.info('Controls reset to defaults.');
  };

  q('#app-btn-settings-back').onclick = () => { cancelRebind(); onClose?.(); };

  let onClose = null;
  paint(loadSettings());
  const off = onSettingsChange(paint);

  // ─── gamepad detection (informational only; support is always available) ───
  const note = q('#app-pad-note');
  function scanPads() {
    if (!note) return true;
    const pads = navigator.getGamepads?.() || [];
    const pad = [...pads].find(Boolean);
    note.textContent = pad
      ? 'Gamepad found: ' + (pad.id || 'connected').slice(0, 34)
      : 'No gamepad detected. Plug one in and press a button.';
    return !!pad;
  }
  let padTimer = setInterval(scanPads, 1000);
  window.addEventListener('gamepadconnected', scanPads);
  scanPads();

  return {
    show() { paint(loadSettings()); },
    set onClose(fn) { onClose = fn; },
    dispose() {
      document.removeEventListener('keydown', onKeyDown, true);
      clearInterval(padTimer);
      off();
    },
  };
}

function btn_label(action) {
  return {
    forward: 'forward', back: 'back', left: 'left', right: 'right',
    jump: 'jump', grab: 'grab/throw', dodge: 'dive/dodge', style: 'style', drop: 'drop',
  }[action] || action;
}
