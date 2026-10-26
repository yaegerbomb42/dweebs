// legacy.js — the bridge to the original, untouched offline game flow.
//
// This is the most important file in src/app. The whole app shell sits *around*
// the existing game, it does not replace it, so the offline path is literally
// the code that already shipped:
//
//   #/play  →  show #main-menu   (Lead's markup, main.js's own handlers)
//   PLAY!   →  main.js startMatch(), which hides #main-menu and shows the HUD
//   QUIT    →  main.js toMenu()
//
// The shell only ever *shows or hides* #main-menu and *clicks* its buttons. It
// never re-implements the settings grid, never touches #hud, and never
// intercepts the game's own buttons. Consequences:
//
//   * If src/app/** is deleted entirely, the game still boots and plays.
//   * No network call exists anywhere on this path. Offline cannot block.
//   * The shell can't desync from the game's real state, because it reads that
//     state from the game's own DOM (see watchGameScreens below) rather than
//     keeping its own copy.
//
// The one place we do need a look inside is the debug handle: main.js only
// publishes window.__dweebs in DEV, so in a production build we read game state
// from the visible overlays instead. Both paths are handled.

/* global MutationObserver */

const $ = id => document.getElementById(id);

/** The live game handle, or null in a production build where it isn't exposed. */
export function game() {
  return typeof window !== 'undefined' ? window.__dweebs || null : null;
}

export function isMatchLive() {
  const g = game();
  if (g?.match) return g.match.running || g.match.phase === 'PLAYING' || g.match.phase === 'COUNTDOWN';
  // No debug handle (production build): infer from the HUD, which main.js only
  // shows while a match is actually running.
  return !!$('hud') && !$('hud').classList.contains('hidden');
}

export function isAtResults() {
  const r = $('results-screen');
  return !!r && !r.classList.contains('hidden');
}

export function isAtMenu() {
  const m = $('main-menu');
  return !!m && !m.classList.contains('hidden');
}

/** True once the game has finished booting (the loading screen is gone). */
export function isGameReady() {
  const l = $('loading-screen');
  return !!l && l.classList.contains('hidden') && !!$('main-menu');
}

/**
 * Mirror the offline settings the player just changed in the shell into the
 * legacy menu's own segmented controls, so that when #/play is shown it already
 * displays the right values, and so main.js's in-memory settings object agrees.
 *
 * main.js reads its settings from localStorage on load and re-reads on every
 * seg click, so clicking the matching button is both the update and the sync.
 */
export function syncOfflineSegs(settings) {
  for (const key of ['bots', 'difficulty', 'stocks', 'music', 'sound', 'type', 'color', 'mode', 'arena']) {
    const seg = document.querySelector(`#main-menu .seg[data-setting="${key}"]`);
    if (!seg) continue;
    const want = String(settings[key]);
    const btn = seg.querySelector(`button[data-v="${want}"]`);
    if (btn && !btn.classList.contains('on')) btn.click();
  }
}

/** Directly launch any of the Dweeb Mall experiences */
export function launchGameMode(mode, arena = null) {
  if (mode) {
    const modeBtn = document.querySelector(`#main-menu .seg[data-setting="mode"] button[data-v="${mode}"]`);
    if (modeBtn) modeBtn.click();
  }
  if (arena) {
    const arenaBtn = document.querySelector(`#main-menu .seg[data-setting="arena"] button[data-v="${arena}"]`);
    if (arenaBtn) arenaBtn.click();
  }
  return startOfflineMatch();
}

/** Show the original offline menu and put it on screen. */
export function showOfflineMenu(settings) {
  const menu = $('main-menu');
  if (!menu) return false;
  syncOfflineSegs(settings);
  menu.classList.remove('hidden');
  return true;
}

export function hideOfflineMenu() {
  $('main-menu')?.classList.add('hidden');
}

/**
 * Start an offline match by clicking the game's own PLAY button. `bots` overrides
 * the offline bot count for this one match (online lobbies pass their own rule, so
 * a room never gets padded with the offline menu's bots).
 */
export function startOfflineMatch({ bots } = {}) {
  const play = $('btn-play');
  if (!play) return false;
  if (bots != null) window.__dweebsMatchOverride = { bots: Number(bots) || 0 };
  play.click();
  return true;
}

/** Leave to the menu via the game's own quit button. */
export function quitToMenu() {
  $('btn-quit')?.click();
  $('btn-main-menu')?.click();
}

/**
 * Watch the game's own overlays and report transitions.
 *
 * main.js flips #hud, #results-screen and #main-menu directly and exposes no
 * events, so a MutationObserver on their class attribute is the least invasive
 * way to stay in step — and it stays correct even if the Lead reworks the flow,
 * because we are watching the outcome rather than duplicating the logic.
 */
export function watchGameScreens({ onMatchStart, onResults, onMenu } = {}) {
  const nodes = ['hud', 'results-screen', 'main-menu']
    .map($)
    .filter(Boolean);
  if (!nodes.length) return () => {};

  const obs = new MutationObserver(() => {
    const now = snapshot();
    if (now.live === last.live && now.results === last.results && now.menu === last.menu) return;
    const wasLive = last.live;
    last = now;
    if (now.live && !wasLive) onMatchStart?.();
    if (now.results) onResults?.();
    if (now.menu) onMenu?.();
  });

  function snapshot() {
    const hud = $('hud');
    const res = $('results-screen');
    const menu = $('main-menu');
    return {
      live: !!hud && !hud.classList.contains('hidden'),
      results: !!res && !res.classList.contains('hidden'),
      menu: !!menu && !menu.classList.contains('hidden'),
    };
  }

  // Declared after snapshot() and seeded from it: the first call must not
  // reference `last` before it exists.
  let last = snapshot();

  for (const n of nodes) obs.observe(n, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}

/** Let the game know a settings change happened while it was running. */
export function applyAudioSettings(audio, settings) {
  if (!audio) return;
  if (typeof audio.setVolume === 'function') {
    audio.setVolume(Math.max(0, Math.min(1, settings.master ?? 0.8)));
  }
  if (typeof audio.setEnabled === 'function') audio.setEnabled(settings.sound !== 'off');
  if (typeof audio.setMusicEnabled === 'function') audio.setMusicEnabled(settings.music !== 'off');
}
