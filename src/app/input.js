// input.js — the app's unified input abstraction.
//
// One `getState()` for keyboard + mouse + gamepad, with automatic device
// detection: the returned `device` is 'keyboard' | 'mouse' | 'gamepad' and
// follows whichever device produced input most recently, so menus can show the
// right button prompts ("Press A" vs "Press Space") without guessing.
//
// This is APP-owned and lives above the game: it never imports or mutates
// src/player/Controller.js. The API is deliberately small so other modes can
// adopt it later:
//
//   const input = createInput({ bindings: settings.bindings });
//   input.setGamepadEnabled(settings.gamepad);
//   input.onDeviceChange(dev => hud.showPromptsFor(dev));
//   const s = input.getState();   // { move, look, actions, device }
//   input.dispose();
//
// Keyboard/mouse come from DOM events on `target` (document by default);
// the gamepad is polled through src/app/gamepad.js, with a graceful fallback
// when no pad (or no Gamepad API) is present. Everything is injectable, so the
// node test suite can drive it with a fake EventTarget and a mocked
// navigator.getGamepads.

/* global globalThis */

import { DEFAULT_BINDINGS, DEFAULT_PAD_BUTTONS } from './settings.js';
import { findGamepad, stickVector, lookVector, anyPressed, BUTTONS } from './gamepad.js';

/** Actions the game polls. */
export const ACTIONS = ['jump', 'grab', 'dodge', 'style', 'drop'];
/** Movement actions, kept separate so the d-pad can map onto them. */
export const MOVE_ACTIONS = ['forward', 'back', 'left', 'right'];

/** D-pad → movement action, standard mapping. */
const DPAD_MOVE = {
  forward: BUTTONS.DPAD_UP,
  back: BUTTONS.DPAD_DOWN,
  left: BUTTONS.DPAD_LEFT,
  right: BUTTONS.DPAD_RIGHT,
};

function clamp1(v) { return Math.max(-1, Math.min(1, v)); }

export function createInput({
  bindings = DEFAULT_BINDINGS,
  padButtons = DEFAULT_PAD_BUTTONS,
  getPad,
  target,
  gamepadEnabled = true,
  navigatorLike,
} = {}) {
  const padSource = getPad || (() => findGamepad(navigatorLike ?? (typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : undefined)));
  const t = target ?? (typeof globalThis.document !== 'undefined' ? globalThis.document : null);

  const keys = new Set();    // KeyboardEvent.code strings
  const mouse = new Set();   // 'Mouse0' | 'Mouse1' | 'Mouse2'
  let padOn = !!gamepadEnabled;
  let device = 'keyboard';
  const deviceListeners = new Set();

  function setDevice(next) {
    if (next === device) return;
    device = next;
    for (const fn of deviceListeners) {
      try { fn(device); } catch { /* a prompt painter must never break input */ }
    }
  }

  function bound(action) { return bindings[action] || []; }
  function actionDown(action) {
    const codes = bound(action);
    for (const c of codes) {
      if (c.startsWith('Mouse')) { if (mouse.has(c)) return true; }
      else if (keys.has(c)) return true;
    }
    return false;
  }

  // ─── keyboard / mouse listeners ───

  function onKeyDown(e) {
    if (!e.repeat) keys.add(e.code);
    setDevice('keyboard');
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onMouseDown(e) {
    mouse.add('Mouse' + e.button);
    setDevice('mouse');
  }
  function onMouseUp(e) { mouse.delete('Mouse' + e.button); }
  function onBlur() { keys.clear(); mouse.clear(); }

  if (t?.addEventListener) {
    t.addEventListener('keydown', onKeyDown);
    t.addEventListener('keyup', onKeyUp);
    t.addEventListener('mousedown', onMouseDown);
    t.addEventListener('mouseup', onMouseUp);
    t.addEventListener('blur', onBlur);
  }

  // ─── the polled state ───

  function getState() {
    let pad = null;
    if (padOn) { try { pad = padSource() || null; } catch { pad = null; } }

    // movement: keyboard/mouse bindings first, pad stick + d-pad added on top
    let mx = (actionDown('right') ? 1 : 0) - (actionDown('left') ? 1 : 0);
    let my = (actionDown('forward') ? 1 : 0) - (actionDown('back') ? 1 : 0);
    let padMoved = false;
    if (pad) {
      const stick = stickVector(pad);
      mx += stick.x;
      my += -stick.y;                       // stick y is down-positive; forward is up
      for (const a of MOVE_ACTIONS) if (anyPressed(pad, [DPAD_MOVE[a]])) {
        if (a === 'forward') my += 1; else if (a === 'back') my -= 1;
        else if (a === 'left') mx -= 1; else mx += 1;
        padMoved = true;
      }
      if (stick.x !== 0 || stick.y !== 0) padMoved = true;
    }
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }

    const actions = {};
    for (const a of ACTIONS) {
      let down = actionDown(a);
      if (!down && pad) {
        const idx = padButtons[a];
        if (typeof idx === 'number' && anyPressed(pad, [idx])) { down = true; padMoved = true; }
      }
      actions[a] = down;
    }

    let look = { x: 0, y: 0 };
    if (pad) {
      look = lookVector(pad);
      if (look.x !== 0 || look.y !== 0) padMoved = true;
    }

    if (padMoved) setDevice('gamepad');
    else if (!pad && device === 'gamepad') setDevice('keyboard');   // unplugged mid-session

    return {
      move: { x: clamp1(mx), y: clamp1(my) },
      look,
      actions,
      device,
      gamepad: pad ? { id: pad.id || '', index: pad.index ?? -1 } : null,
    };
  }

  return {
    getState,
    get device() { return device; },

    /** Wire the settings screen's gamepad toggle straight through. */
    setGamepadEnabled(on) { padOn = !!on; },

    /** For prompts: called with the new device whenever it changes. */
    onDeviceChange(fn) {
      deviceListeners.add(fn);
      return () => deviceListeners.delete(fn);
    },

    /** Test/debug seam: is a pad currently visible to the poller? */
    hasGamepad() {
      if (!padOn) return false;
      try { return !!padSource(); } catch { return false; }
    },

    dispose() {
      if (t?.removeEventListener) {
        t.removeEventListener('keydown', onKeyDown);
        t.removeEventListener('keyup', onKeyUp);
        t.removeEventListener('mousedown', onMouseDown);
        t.removeEventListener('mouseup', onMouseUp);
        t.removeEventListener('blur', onBlur);
      }
      deviceListeners.clear();
      keys.clear();
      mouse.clear();
    },
  };
}
