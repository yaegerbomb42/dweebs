// hub-global-polish (M5): the arcade switcher, the unified input/gamepad
// abstraction, and PWA offline completeness for level assets.
//
// The commit contract: every sub-game the mall advertises is launchable (no
// dead buttons — Escape/Mimic were wired to buttons that didn't exist), every
// card shows a difficulty badge and a preview animation, keyboard/mouse/gamepad
// are auto-detected through one input API, and the service worker precaches
// every build asset on the first visit so every level runs offline.

/* global Event, EventTarget */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { MALL_MODES, DIFFICULTY_LABELS, difficultyStars, mallLaunchButtons, launchByButtonId } from '../src/app/mall.js';
import { mallTitleHtml } from '../src/app/screens.js';
import {
  BUTTONS, padFamily, buttonName, listGamepads, findGamepad, hasGamepad,
  deadzone, stickVector, lookVector, anyPressed, rumble, watchGamepads,
} from '../src/app/gamepad.js';
import { createInput, ACTIONS } from '../src/app/input.js';
import { DEFAULT_BINDINGS, DEFAULT_PAD_BUTTONS } from '../src/app/settings.js';
import { injectPrecache, precacheList } from '../tools/precache.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

// ─── mall data model ───

describe('mall data model', () => {
  it('has six cards with unique ids, titles, badges and preview animations', () => {
    expect(MALL_MODES.length).toBe(6);
    const ids = MALL_MODES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of MALL_MODES) {
      expect(c.title, c.id).toBeTruthy();
      expect(c.badge, c.id).toBeTruthy();
      expect(c.icon, c.id).toBeTruthy();
      expect(c.iconAnim, c.id).toMatch(/^anim-/);
    }
  });

  it('every launch button id is unique and every launch targets a real game mode', () => {
    const modesSrc = read('src/game/GameModes.js');
    const knownModes = new Set([...modesSrc.matchAll(/^\s{2}(\w+): \{/gm)].map(m => m[1]));
    const buttons = mallLaunchButtons();
    const ids = buttons.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of buttons) {
      expect(knownModes.has(b.launch.mode), `button ${b.id} targets unknown mode ${b.launch.mode}`).toBe(true);
      expect(b.launch.arena, b.id).toBeTruthy();
    }
  });

  it('every difficulty is 1..3 with a label, and star pips render', () => {
    for (const b of mallLaunchButtons()) {
      expect(b.difficulty).toBeGreaterThanOrEqual(1);
      expect(b.difficulty).toBeLessThanOrEqual(3);
      expect(DIFFICULTY_LABELS[b.difficulty]).toBeTruthy();
    }
    for (const c of MALL_MODES) expect(DIFFICULTY_LABELS[c.difficulty]).toBeTruthy();
    expect(difficultyStars(1)).toBe('★☆☆');
    expect(difficultyStars(2)).toBe('★★☆');
    expect(difficultyStars(3)).toBe('★★★');
  });

  it('launchByButtonId finds Escape and Mimic (the previously dead buttons)', () => {
    expect(launchByButtonId('app-btn-escape')?.launch.mode).toBe('escape');
    expect(launchByButtonId('app-btn-mimic')?.launch.mode).toBe('mimic');
    expect(launchByButtonId('nope')).toBeNull();
  });
});

describe('mall DOM (screens.js)', () => {
  const html = mallTitleHtml();

  it('renders a card per mode with a difficulty badge and an animated icon', () => {
    for (const c of MALL_MODES) {
      expect(html, c.cardId).toContain(`id="${c.cardId}"`);
      expect(html, c.id).toContain('mall-diff');
      expect(html, c.id).toContain(`mall-icon ${c.iconAnim}`);
      // every preview animation class used here has keyframes in shell.css
      const css = read('src/app/shell.css');
      expect(css, c.iconAnim).toContain(`.mall-icon.${c.iconAnim}`);
      const keyframe = c.iconAnim.replace(/^anim-/, 'mall-');
      expect(css, keyframe).toContain(`@keyframes ${keyframe}`);
    }
  });

  it('renders every launch button with a parseable data-launch boot.js can wire', () => {
    for (const b of mallLaunchButtons()) {
      expect(html, b.id).toContain(`id="${b.id}"`);
      const m = html.match(new RegExp(`id="${b.id}"[^>]*data-launch='([^']+)'`));
      expect(m, `${b.id} must carry data-launch`).toBeTruthy();
      const launch = JSON.parse(m[1]);
      expect(launch).toEqual({ mode: b.launch.mode, arena: b.launch.arena, ...(b.launch.submode ? { submode: b.launch.submode } : {}) });
    }
  });

  it('the subtitle no longer claims only 4 experiences', () => {
    expect(html).not.toContain('4 massive physics experiences');
  });
});

// ─── gamepad helpers ───

const fakePad = (over = {}) => ({
  id: 'Generic Pad',
  index: 0,
  connected: true,
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  axes: [0, 0, 0, 0],
  ...over,
});

describe('gamepad module', () => {
  it('detects Xbox and PlayStation families from the pad id', () => {
    expect(padFamily(fakePad({ id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)' }))).toBe('xbox');
    expect(padFamily(fakePad({ id: 'Sony Interactive Entertainment DualSense Wireless Controller' }))).toBe('playstation');
    expect(padFamily(fakePad({ id: '054c:0ce6 Sony DualSense' }))).toBe('playstation');
    expect(padFamily(fakePad({ id: 'PS5 Controller' }))).toBe('playstation');
    expect(padFamily(fakePad({ id: 'Some USB Gamepad' }))).toBe('generic');
    expect(padFamily(null)).toBe('generic');
  });

  it('names buttons per family (A on Xbox, Cross on PlayStation)', () => {
    const xbox = fakePad({ id: 'Xbox One Controller' });
    const ps = fakePad({ id: 'DualShock 4' });
    expect(buttonName(0, xbox)).toBe('A');
    expect(buttonName(0, ps)).toBe('Cross');
    expect(buttonName(3, ps)).toBe('Triangle');
    expect(buttonName(99, xbox)).toBe('B99');
  });

  it('lists pads safely: holes removed, no API → [], throwing API → []', () => {
    const pad = fakePad();
    expect(listGamepads({ getGamepads: () => [null, pad, undefined] })).toEqual([pad]);
    expect(listGamepads({})).toEqual([]);
    expect(listGamepads(undefined)).toEqual([]);
    expect(listGamepads({ getGamepads: () => { throw new Error('denied'); } })).toEqual([]);
    expect(findGamepad({ getGamepads: () => [pad] })).toBe(pad);
    expect(hasGamepad({ getGamepads: () => [] })).toBe(false);
    expect(hasGamepad({ getGamepads: () => [pad] })).toBe(true);
  });

  it('applies a deadzone to sticks and reads the right stick for look', () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(0.3)).toBeCloseTo(0.3);
    const pad = fakePad({ axes: [0.5, -0.1, 0.9, 0] });
    expect(stickVector(pad)).toEqual({ x: 0.5, y: 0 });
    expect(lookVector(pad)).toEqual({ x: 0.9, y: 0 });
  });

  it('anyPressed reads the standard button indices', () => {
    const pad = fakePad();
    pad.buttons[BUTTONS.A].pressed = true;
    expect(anyPressed(pad, [BUTTONS.A])).toBe(true);
    expect(anyPressed(pad, [BUTTONS.B])).toBe(false);
    expect(anyPressed(null, [BUTTONS.A])).toBe(false);
  });

  it('rumble is a silent no-op without an actuator, and works with one', async () => {
    expect(await rumble(fakePad())).toBe(false);
    const calls = [];
    const pad = fakePad({ vibrationActuator: { playEffect: async (t, p) => { calls.push([t, p]); } } });
    expect(await rumble(pad, { duration: 100, strong: 0.5 })).toBe(true);
    expect(calls[0][0]).toBe('dual-rumble');
    expect(calls[0][1].duration).toBe(100);
  });

  it('watchGamepads relays connect/disconnect and disposes', () => {
    const target = new EventTarget();
    const seen = [];
    const dispose = watchGamepads({
      target,
      onConnect: pad => seen.push(['connect', pad?.id]),
      onDisconnect: pad => seen.push(['disconnect', pad?.id]),
    });
    const pad = fakePad({ id: 'Xbox Pad' });
    const ce = new Event('gamepadconnected'); ce.gamepad = pad;
    const de = new Event('gamepaddisconnected'); de.gamepad = pad;
    target.dispatchEvent(ce);
    target.dispatchEvent(de);
    expect(seen).toEqual([['connect', 'Xbox Pad'], ['disconnect', 'Xbox Pad']]);
    dispose();
    target.dispatchEvent(ce);
    expect(seen.length).toBe(2);
  });
});

// ─── unified input ───

const keyEvent = (type, code) => {
  const e = new Event(type);
  e.code = code; e.repeat = false;
  return e;
};
const mouseEvent = (type, button) => {
  const e = new Event(type);
  e.button = button;
  return e;
};
const padWith = ({ id = 'Xbox Pad', axes = [0, 0, 0, 0], pressed = [] } = {}) => {
  const pad = fakePad({ id, axes });
  for (const i of pressed) pad.buttons[i].pressed = true;
  return pad;
};

describe('unified input', () => {
  it('reads keyboard movement from the default bindings', () => {
    const target = new EventTarget();
    const input = createInput({ target, getPad: () => null });
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    target.dispatchEvent(keyEvent('keydown', 'KeyD'));
    const s = input.getState();
    // diagonal is normalised to unit magnitude, like an analogue stick
    expect(s.move.x).toBeCloseTo(Math.SQRT1_2);
    expect(s.move.y).toBeCloseTo(Math.SQRT1_2);
    expect(s.device).toBe('keyboard');
    target.dispatchEvent(keyEvent('keyup', 'KeyW'));
    expect(input.getState().move.y).toBe(0);
    input.dispose();
  });

  it('respects custom bindings', () => {
    const target = new EventTarget();
    const input = createInput({ target, getPad: () => null, bindings: { ...DEFAULT_BINDINGS, jump: ['KeyJ'] } });
    target.dispatchEvent(keyEvent('keydown', 'Space'));
    expect(input.getState().actions.jump).toBe(false);
    target.dispatchEvent(keyEvent('keydown', 'KeyJ'));
    expect(input.getState().actions.jump).toBe(true);
    input.dispose();
  });

  it('reads mouse buttons (Mouse2 = grab) and switches device to mouse', () => {
    const target = new EventTarget();
    const input = createInput({ target, getPad: () => null });
    target.dispatchEvent(mouseEvent('mousedown', 2));
    const s = input.getState();
    expect(s.actions.grab).toBe(true);
    expect(s.device).toBe('mouse');
    target.dispatchEvent(mouseEvent('mouseup', 2));
    expect(input.getState().actions.grab).toBe(false);
    input.dispose();
  });

  it('polls the gamepad stick, buttons and d-pad; device flips to gamepad', () => {
    const target = new EventTarget();
    let pad = padWith({ axes: [0.6, -0.4, 0, 0], pressed: [DEFAULT_PAD_BUTTONS.jump] });
    const input = createInput({ target, getPad: () => pad });
    const s = input.getState();
    expect(s.move.x).toBeCloseTo(0.6);
    expect(s.move.y).toBeCloseTo(0.4);   // stick y down-positive → forward
    expect(s.actions.jump).toBe(true);
    expect(s.device).toBe('gamepad');
    expect(s.gamepad.id).toBe('Xbox Pad');
    pad = padWith({ pressed: [BUTTONS.DPAD_UP] });
    expect(input.getState().move.y).toBe(1);
    input.dispose();
  });

  it('falls back gracefully with no gamepad: keyboard still works, no crash', () => {
    const target = new EventTarget();
    const input = createInput({ target, navigatorLike: {} });   // no getGamepads at all
    expect(input.hasGamepad()).toBe(false);
    target.dispatchEvent(keyEvent('keydown', 'Space'));
    const s = input.getState();
    expect(s.actions.jump).toBe(true);
    expect(s.gamepad).toBeNull();
    expect(s.device).toBe('keyboard');
    input.dispose();
  });

  it('connect/disconnect: a pad that appears mid-session is picked up, then dropped', () => {
    const target = new EventTarget();
    let pad = null;
    const input = createInput({ target, getPad: () => pad });
    expect(input.hasGamepad()).toBe(false);
    pad = padWith({ axes: [1, 0, 0, 0] });
    expect(input.hasGamepad()).toBe(true);
    expect(input.getState().device).toBe('gamepad');
    pad = null;   // unplugged
    expect(input.hasGamepad()).toBe(false);
    expect(input.getState().device).not.toBe('gamepad');
    input.dispose();
  });

  it('setGamepadEnabled(false) ignores the pad (the settings toggle path)', () => {
    const target = new EventTarget();
    const input = createInput({ target, getPad: () => padWith({ axes: [1, 0, 0, 0] }) });
    input.setGamepadEnabled(false);
    expect(input.hasGamepad()).toBe(false);
    expect(input.getState().move.x).toBe(0);
    input.setGamepadEnabled(true);
    expect(input.getState().move.x).toBe(1);
    input.dispose();
  });

  it('onDeviceChange fires on transitions, blur clears stuck keys', () => {
    const target = new EventTarget();
    const seen = [];
    const input = createInput({ target, getPad: () => null });
    const off = input.onDeviceChange(d => seen.push(d));
    target.dispatchEvent(mouseEvent('mousedown', 0));
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    expect(seen).toEqual(['mouse', 'keyboard']);
    off();
    target.dispatchEvent(mouseEvent('mousedown', 0));
    expect(seen.length).toBe(2);   // unsubscribed
    target.dispatchEvent(keyEvent('keydown', 'KeyA'));
    target.dispatchEvent(new Event('blur'));
    expect(input.getState().move.x).toBe(0);
    input.dispose();
  });

  it('every action has a default pad button that the input polls', () => {
    for (const a of ACTIONS) {
      expect(typeof DEFAULT_PAD_BUTTONS[a], `pad button for ${a}`).toBe('number');
    }
  });
});

// ─── PWA: every level asset is precached on install ───

/** Minimal install-harness for public/sw.js: capture every cache.add on install. */
function installSW(src) {
  const listeners = new Map();
  const added = [];
  const self = {
    location: new URL('http://localhost:4321/sw.js'),
    addEventListener: (t, fn) => listeners.set(t, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const caches = {
    open: name => Promise.resolve({ name, add: p => { added.push([name, p]); return Promise.resolve(); }, put: () => Promise.resolve() }),
    keys: () => Promise.resolve([]), match: () => Promise.resolve(undefined), delete: () => Promise.resolve(true),
  };
  vm.runInNewContext(src, { self, caches, fetch: () => Promise.reject(new Error('offline')), URL, Promise, console });
  let wait;
  listeners.get('install')({ waitUntil: p => { wait = p; } });
  return wait.then(() => added);
}

const swSrc = () => read('public/sw.js');

describe('PWA precache covers every level asset (M5)', () => {
  it('the precache manifest keeps every bundle asset a level needs, dropping only maps/woff/html', () => {
    // Synthetic "build": one chunk per game mode, plus css and fonts.
    const bundle = [
      'assets/index-a1b2c3.js', 'assets/index-a1b2c3.js.map',
      'assets/Adventure-d4e5f6.js', 'assets/Warfare-789abc.js',
      'assets/EscapeSandbox-def012.js', 'assets/MimicLab-345678.js',
      'assets/Builder-9abcdef.js', 'assets/style-012345.css',
      'assets/font.woff2', 'assets/font.woff',
      'index.html', 'sw.js',
    ];
    const list = precacheList(bundle);
    for (const f of ['assets/index-a1b2c3.js', 'assets/Adventure-d4e5f6.js', 'assets/Warfare-789abc.js',
                     'assets/EscapeSandbox-def012.js', 'assets/MimicLab-345678.js', 'assets/Builder-9abcdef.js',
                     'assets/style-012345.css', 'assets/font.woff2']) {
      expect(list, f).toContain('./' + f);
    }
    for (const f of ['assets/index-a1b2c3.js.map', 'assets/font.woff', 'index.html', 'sw.js']) {
      expect(list, f).not.toContain('./' + f);
    }
  });

  it('the service worker install path precaches every injected level asset', async () => {
    const files = ['./assets/index-a1b2c3.js', './assets/Adventure-d4e5f6.js', './assets/Warfare-789abc.js', './assets/style-012345.css'];
    const added = await installSW(injectPrecache(swSrc(), files, 'm5test'));
    const paths = added.map(a => a[1]);
    for (const f of [...files, './', './index.html', './manifest.webmanifest']) {
      expect(paths, f).toContain(f);
    }
    // per-build cache name, so a new deploy never serves stale levels
    expect(new Set(added.map(a => a[0]))).toEqual(new Set(['dweebs-mall-v2-m5test']));
  });

  it('no level code fetches assets at runtime outside the precached bundle', () => {
    // If a level loaded JSON/GLB/textures via fetch, precaching the bundle
    // would NOT make it offline-safe. Grounded by reading the actual sources.
    const dirs = ['src/adventure', 'src/escape', 'src/mimic', 'src/builder', 'src/warfare', 'src/game'];
    const hits = [];
    for (const d of dirs) {
      let files = [];
      try { files = readdirSync(join(root, d)).filter(f => f.endsWith('.js')); } catch { continue; }
      for (const f of files) {
        const src = readFileSync(join(root, d, f), 'utf8');
        const m = src.match(/\bfetch\s*\(\s*['"`](?!https?:)[^'"`]*\.(json|glb|gltf|png|jpg|mp3|ogg)['"`]/);
        if (m) hits.push(`${d}/${f}: ${m[0]}`);
      }
    }
    expect(hits, 'runtime level-asset fetches break offline-first').toEqual([]);
  });

  // Runs only when a real build exists (the M5 verification runs `npm run build`).
  describe.runIf(existsSync(join(root, 'dist', 'sw.js')))('built sw.js (dist)', () => {
    it('the built worker precaches every hashed asset in dist/assets', () => {
      const built = read('dist/sw.js');
      const precache = JSON.parse(built.match(/const PRECACHE = (\[.*?\]);/s)[1]);
      expect(precache.length, 'a build must inject a non-empty precache list').toBeGreaterThan(0);
      const onDisk = readdirSync(join(root, 'dist', 'assets'))
        .filter(f => !f.endsWith('.map') && !/\.woff$/.test(f))
        .map(f => './assets/' + f);
      for (const f of onDisk) expect(precache, f).toContain(f);
    });
  });
});
