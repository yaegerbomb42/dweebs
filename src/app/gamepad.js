// gamepad.js — Gamepad API helpers for the app layer.
//
// The game itself never sees these directly: src/app/input.js polls them and
// exposes one unified state, so other modes can adopt the API later without
// touching src/player/Controller.js. Every function here is pure DOM-free
// logic over an injected navigator/window, which is what makes it unit
// testable in the node vitest environment.

/* global globalThis */

/** Standard-mapping button indices (W3C "standard" layout). */
export const BUTTONS = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
};

/** Friendly button names per pad family. Index 0–3 differ (A vs Cross …). */
const FAMILY_BUTTON_NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right'],
  playstation: ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right'],
  generic: ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15'],
};

/** 'xbox' | 'playstation' | 'generic', from the pad id heuristics. */
export function padFamily(pad) {
  const id = String(pad?.id || '').toLowerCase();
  if (/xbox/.test(id)) return 'xbox';
  // PlayStation: brand names, DualShock/DualSense, or Sony's 0x054c vendor id.
  if (/playstation|dualshock|dualsense|\bps[345]\b|054c/.test(id)) return 'playstation';
  return 'generic';
}

/** Friendly name for button index on this pad ('Cross' on PS, 'A' on Xbox). */
export function buttonName(index, pad) {
  const names = FAMILY_BUTTON_NAMES[padFamily(pad)];
  return names[index] ?? `B${index}`;
}

/**
 * All connected pads, as a real array with holes removed. Safe when there is
 * no Gamepad API at all (old browser, no permission) — returns [].
 */
export function listGamepads(nav = typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : undefined) {
  try {
    const pads = nav?.getGamepads?.() || [];
    return [...pads].filter(Boolean);
  } catch {
    return [];
  }
}

/** The pad input.js polls: the first connected one, or null. */
export function findGamepad(nav) {
  return listGamepads(nav)[0] || null;
}

/** True when at least one pad is connected. */
export function hasGamepad(nav) {
  return listGamepads(nav).length > 0;
}

/** Apply a deadzone to a stick axis; returns 0 inside the zone. */
export function deadzone(v, zone = 0.18) {
  const n = Number(v) || 0;
  return Math.abs(n) < zone ? 0 : n;
}

/** Left stick as {x, y} with a deadzone (y is positive-down, like screen space). */
export function stickVector(pad, zone = 0.18) {
  const axes = pad?.axes || [];
  return { x: deadzone(axes[0], zone), y: deadzone(axes[1], zone) };
}

/** Right stick as {x, y} (look) with a deadzone. */
export function lookVector(pad, zone = 0.18) {
  const axes = pad?.axes || [];
  return { x: deadzone(axes[2], zone), y: deadzone(axes[3], zone) };
}

/** True when any of the given button indices is pressed. */
export function anyPressed(pad, indices) {
  const buttons = pad?.buttons || [];
  return indices.some(i => !!buttons[i]?.pressed);
}

/**
 * Rumble the pad (dual-rumble). Resolves to false on pads / browsers without
 * a vibration actuator — never throws, so a missing actuator is a silent no-op.
 */
export async function rumble(pad, { duration = 200, strong = 1, weak = 0.6 } = {}) {
  try {
    const actuator = pad?.vibrationActuator;
    if (!actuator?.playEffect) return false;
    await actuator.playEffect('dual-rumble', {
      duration: Math.max(0, duration),
      strongMagnitude: Math.min(1, Math.max(0, strong)),
      weakMagnitude: Math.min(1, Math.max(0, weak)),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to gamepad connect/disconnect events. `target` defaults to the
 * global window when available; pass a fake EventTarget in tests.
 * Returns a dispose function.
 */
export function watchGamepads({ onConnect, onDisconnect, target } = {}) {
  const t = target ?? (typeof globalThis.window !== 'undefined' ? globalThis.window : null);
  const handleConnect = e => onConnect?.(e?.gamepad ?? null, e);
  const handleDisconnect = e => onDisconnect?.(e?.gamepad ?? null, e);
  if (t?.addEventListener) {
    t.addEventListener('gamepadconnected', handleConnect);
    t.addEventListener('gamepaddisconnected', handleDisconnect);
  }
  return () => {
    t?.removeEventListener?.('gamepadconnected', handleConnect);
    t?.removeEventListener?.('gamepaddisconnected', handleDisconnect);
  };
}
