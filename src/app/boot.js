// boot.js — the app shell's orchestrator. Boots alongside the game.
//
// The one invariant that outranks everything else here:
//
//   OFFLINE NEVER BLOCKS. Offline is the default mode. There is no await, no
//   fetch and no NetClient call on the offline path, and the shell is fully
//   usable with the network switched off, the server down, or a bad invite URL.
//   Online is opt-in, behind an explicit button press.
//
// Boot order matters for the same reason: the shell is created first and is
// independent of the game, so a slow or failed game load can never stop the
// player reaching Play Offline.

/* global queueMicrotask, globalThis, console */

import { createRouter, INVITE_RE } from './router.js';
import { MockNetClient } from './MockNetClient.js';
import { buildScreens } from './screens.js';
import { createToasts } from './toasts.js';
import { createLoading } from './loading.js';
import { refreshHub, HUB_TIPS } from './hub-extras.js';
import { setMsg } from './dom.js';
import { renderLobby, wireLobby, updatePing } from './lobby.js';
import { mountSettings } from './settings-screen.js';
import { loadSettings, saveSettings, serverUrl, onSettingsChange, DEFAULT_BINDINGS } from './settings.js';
import { createInput } from './input.js';
import {
  isMatchLive, isAtResults, showOfflineMenu, hideOfflineMenu,
  startOfflineMatch, launchGameMode, watchGameScreens,
} from './legacy.js';
import {
  applySettings, watchSettings, installContextLoss, installVisibilityPause,
  registerServiceWorker,
} from './runtime.js';

export function bootApp() {
  const toast = createToasts();
  const loading = createLoading();
  // Loading tips rotate while the bar is under 100% — real mechanics, one line
  // each. They stop the moment progress hits 100 (see loading.js).
  loading.startTips(HUB_TIPS);
  const settings = loadSettings();

  // ─── the shell root ───
  // #app-shell is added by index.html. If it's missing (someone stripped the
  // script tag) we create it, but we never *require* it.
  let shell = document.getElementById('app-shell');
  if (!shell) {
    shell = document.createElement('div');
    shell.id = 'app-shell';
    document.body.appendChild(shell);
  }

  // ─── the network client ───
  // MOCKED until NET merges. createNetClient() is the single seam where the
  // real client gets swapped in; nothing else in the app knows which it is.
  const net = createNetClient({ serverUrl: serverUrl(), playerName: settings.playerName });

  // ─── screens ───
  const nodes = buildScreens();
  // NB: appendChild takes exactly one node — it is append() that is variadic.
  // (This was a silent bug: three of the four screens never reached the DOM.)
  shell.append(nodes.title, nodes.online, nodes.lobby, nodes.settings);

  // ─── unified input (keyboard + mouse + gamepad, app-owned) ───
  // Lives in the app layer so it never touches src/player/Controller.js;
  // subgames can adopt input.getState() later via window.__dweebsApp.input.
  const input = createInput({ bindings: settings.bindings || DEFAULT_BINDINGS });
  input.setGamepadEnabled(settings.gamepad !== false);
  onSettingsChange(s => input.setGamepadEnabled(s.gamepad !== false));

  const ctx = { shell, nodes, net, toast, loading, settings, input };

  const router = createRouter({ onRoute: route => onRoute(route, ctx) });
  ctx.router = router;

  wireTitle(ctx);
  wireOnline(ctx);
  wireLobbyScreen(ctx);
  const settingsUI = mountSettings({ root: nodes.settings, toast });
  settingsUI.onClose = () => router.go('/');
  wireNetEvents(ctx);
  wireGameEvents(ctx);

  applySettings();
  watchSettings();
  installContextLoss({ toast });
  installVisibilityPause({ toast });
  registerServiceWorker({ toast });

  // First paint of the shell is independent of the game's loading screen.
  loading.progress(100, 'Ready');

  return { router, net, toast, loading, input, ctx };
}

// ─── NetClient seam ──────────────────────────────────────────────────────────

/**
 * The real client, once the module is available. NetClientApp (src/net) wraps the
 * wire client behind the APP→NET contract, so it is the drop-in twin of the mock:
 * same constructor options, same methods, same events, same error codes — plus the
 * live `online` headcount.
 *
 * The import is dynamic and fully guarded, for two reasons:
 *   * Before NET merges the module doesn't exist, so a static import would be a
 *     hard build error rather than a graceful fallback.
 *   * NetClient pulls in the WebSocket transport, which nobody should pay for
 *     when they're just playing offline. Keeping it behind a dynamic import
 *     means the netcode never enters the offline bundle at all.
 *
 * createNetClientSync is what boot() uses, so booting can never await.
 */
export function createNetClient(opts) {
  const Real = globalThis.__dweebsNetClient;
  if (Real) {
    try { return new Real(opts); } catch (err) { console.warn('[app/net] real NetClient failed, using mock', err); }
  }
  return new MockNetClient(opts);
}

/**
 * Warm the real client once — and only once — and only when the player actually
 * wants to play online:
 *
 *   * `?mock=…` forces the mock, so fault-injection and offline testing survive;
 *   * `?server=…` or a stored server URL takes the real path, so a shared dev box
 *     can point at the VPS build with one query string;
 *   * otherwise, on a plain local page with no server configured, the mock stays —
 *     Play Online on a plane is still fully explorable.
 */
export async function upgradeNetClient(opts) {
  if (globalThis.__dweebsNetClient) return createNetClient(opts);
  try {
    const qs = new URLSearchParams(location.search);
    if (qs.get('mock') != null) return null;      // fault-injection stays offline
    const mod = await import(/* @vite-ignore */ '../net/NetClientApp.js');
    const Real = mod.NetClientApp || mod.default;
    if (typeof Real !== 'function') return null;  // not merged yet
    globalThis.__dweebsNetClient = Real;
    return new Real(opts);
  } catch {
    return null;                                  // absent → stay mocked
  }
}

// ─── title ───

function wireTitle({ nodes, router, toast }) {
  // ── The Dweeb Mall: every launchable button carries data-launch, rendered
  // from src/app/mall.js. One generic handler means a new mall card can never
  // be wired to a button that doesn't exist (Escape/Mimic were, before).
  for (const b of nodes.title.querySelectorAll('[data-launch]')) {
    b.addEventListener('click', () => {
      let launch;
      try { launch = JSON.parse(b.dataset.launch); } catch { return; }
      launchGameMode(launch.mode, launch.arena, launch.submode);
    });
  }

  // ── Builder-first hub cabinets: the arcade buttons carry a bare data-launch
  // marker (picked up by the shimmer hook below); their modes are wired
  // explicitly here so every button id in the hub markup is bound in boot.js.
  nodes.title.querySelector('#app-btn-classic')?.addEventListener('click', () => {
    launchGameMode('derby', 'stadium');
  });

  // Subgames for Game 1 (Knockout Arena)
  nodes.title.querySelector('#app-btn-derby')?.addEventListener('click', () => {
    launchGameMode('derby', 'stadium');
  });
  nodes.title.querySelector('#app-btn-walldrop')?.addEventListener('click', () => {
    launchGameMode('walldrop', 'stadium');
  });
  nodes.title.querySelector('#app-btn-brawl')?.addEventListener('click', () => {
    launchGameMode('brawl', 'stadium');
  });
  nodes.title.querySelector('#app-btn-training')?.addEventListener('click', () => {
    launchGameMode('training', 'stadium');
  });

  nodes.title.querySelector('#app-btn-dynasty')?.addEventListener('click', () => {
    launchGameMode('adventure', 'meadowlands');
  });

  nodes.title.querySelector('#app-btn-escape')?.addEventListener('click', () => {
    launchGameMode('escape', 'stadium');
  });

  nodes.title.querySelector('#app-btn-mimic')?.addEventListener('click', () => {
    launchGameMode('mimic', 'stadium');
  });

  nodes.title.querySelector('#app-btn-builder')?.addEventListener('click', () => {
    launchGameMode('build', 'stadium');
  });

  // Dweeb Brawl Sim: trait-driven auto-battler (src/builder/traits/TraitBrawlMode.js)
  nodes.title.querySelector('#app-btn-traitbrawl')?.addEventListener('click', () => {
    launchGameMode('build', 'stadium', 'traitbrawl');
  });

  // Game 5 (Dweeb Warfare) and submodes
  nodes.title.querySelector('#app-btn-warfare')?.addEventListener('click', () => {
    launchGameMode('warfare', 'stadium', 'defense');
  });
  nodes.title.querySelector('#app-btn-warfare-defense')?.addEventListener('click', () => {
    launchGameMode('warfare', 'stadium', 'defense');
  });
  nodes.title.querySelector('#app-btn-warfare-versus')?.addEventListener('click', () => {
    launchGameMode('warfare', 'stadium', 'versus');
  });

  // The daily challenge: hub-extras.js paints the card and stores the target
  // game button id on data-target; pressing it presses that game button, so
  // the challenge takes the exact same launch path (shimmer included) as
  // tapping the cabinet directly. Keyboard/gamepad activation comes through
  // the same click path.
  nodes.title.querySelector('#app-btn-daily')?.addEventListener('click', e => {
    const target = e.currentTarget?.dataset?.target;
    if (target) document.getElementById(target)?.click();
  });

  // Footer Navigation
  nodes.title.querySelector('#app-btn-offline')?.addEventListener('click', () => router.go('/play'));
  nodes.title.querySelector('#app-btn-online')?.addEventListener('click', () => router.go('/online'));
  nodes.title.querySelector('#app-btn-how')?.addEventListener('click', () => {
    document.getElementById('how-to-play')?.classList.remove('hidden');
  });
  nodes.title.querySelector('#app-btn-settings')?.addEventListener('click', () => router.go('/settings'));

  // Launch shimmer: the shell hands off to the game immediately, but the tap
  // should feel answered first. Purely cosmetic — the shell hides on route
  // change, which also removes the state. Keyboard/gamepad activation goes
  // through the same click path, so no input mode is special-cased.
  nodes.title.addEventListener('click', e => {
    const b = e.target.closest?.('[data-launch]');
    if (!b || b.disabled) return;
    b.classList.add('is-launching');
    b.setAttribute('aria-busy', 'true');
  });

  // Main menu button to return to The Dweeb Mall
  document.getElementById('btn-back-to-mall')?.addEventListener('click', () => {
    router.go('/');
  });
}

// ─── online: the one-tap door (PLAY NOW) + friends-by-code ───

import { CHARACTER_ROSTER } from '../player/characterList.js';
const ARCHETYPE_BLURB = Object.fromEntries(
  CHARACTER_ROSTER.map(c => [c.id, `${c.name} — ${c.blurb}`])
);
// The main menu's colour keys are names; the wire takes hex. This is the one map.
export const COLOR_NAME_TO_HEX = {
  yellow: '#ffd23f', pink: '#ff6fb5', blue: '#3fa9ff', green: '#5ee06a',
  orange: '#ff9a3c', purple: '#b56cff',
};

/** Wire identity the other way too: a hex colour from the wire back to a name. */
export function onlineProfile() {
  const s = loadSettings();
  return { name: s.playerName, archetype: s.type, color: COLOR_NAME_TO_HEX[s.color] || '#ffd23f' };
}

function syncOnlineSegs(nodes) {
  const s = loadSettings();
  const setSeg = (sel, v) => {
    for (const b of nodes.online.querySelectorAll(sel + ' button')) b.classList.toggle('on', b.dataset.v === v);
  };
  setSeg('.seg[data-online="type"]', s.type);
  setSeg('.seg[data-online="color"]', s.color);
  const blurb = nodes.online.querySelector('#app-type-blurb');
  if (blurb) blurb.textContent = ARCHETYPE_BLURB[s.type] || ARCHETYPE_BLURB.cube;
}

function renderOnlineCount(nodes, net) {
  const wrap = nodes.online.querySelector('#app-online-count');
  const num = nodes.online.querySelector('#app-online-num');
  if (!wrap || !num) return;
  // Before any connection the honest answer is "checking", not a number from nowhere.
  if (!net?.connected && net?.mocked !== false) {
    wrap.dataset.warm = '0'; wrap.dataset.stale = '0';
    num.textContent = net?.mocked ? 'Offline demo — rooms are simulated locally' : 'Checking who’s online…';
    return;
  }
  const snap = typeof net?.onlineSnapshot === 'function' ? net.onlineSnapshot() : null;
  if (!snap) { wrap.dataset.warm = '0'; num.textContent = 'Checking who’s online…'; return; }
  wrap.dataset.warm = '1';
  wrap.dataset.stale = snap.stale ? '1' : '0';
  const n = snap.humans;
  num.textContent = n === 0
    ? 'Nobody online yet — press PLAY NOW and start the party'
    : `${n} dweeb${n === 1 ? '' : 's'} online · ${snap.matches} match${snap.matches === 1 ? '' : 'es'} live`;
}
/**
 * Connect (upgrading to the real client on the way), then read the live number.
 * Never blocks the screen and never blocks offline: a server that is down is a
 * grey dot and a note, and PLAY NOW fails loudly instead of spinning forever.
 */
async function warmOnlineClient(ctx) {
  const { nodes, toast } = ctx;
  if (ctx.net.mocked === false && ctx.net.connected) { renderOnlineCount(nodes, ctx.net); return; }
  renderOnlineCount(nodes, ctx.net);
  try {
    const real = await upgradeNetClient({ serverUrl: serverUrl(), playerName: loadSettings().playerName });
    if (real && real !== ctx.net) {
      ctx.net.disconnect?.();
      ctx.net = real;
      wireLobbyScreen(ctx);
      wireNetEvents(ctx);
    }
  } catch { /* offline: the mock stays, the screen says so */ }
  if (ctx.net.mocked === false) {
    try {
      await ctx.net.connect();
      ctx.net.on?.('online', () => { if (ctx.router?.path === '/online') renderOnlineCount(nodes, ctx.net); });
      renderOnlineCount(nodes, ctx.net);
    } catch {
      toast.warn('No server right now — showing the offline demo instead.');
      renderOnlineCount(nodes, ctx.net);
    }
  } else {
    renderOnlineCount(nodes, ctx.net);
  }
  updateOnlineNote(ctx);
}

function wireOnline(ctx) {
  const { nodes, router, toast } = ctx;
  const q = sel => nodes.online.querySelector(sel);
  const msg = q('#app-online-msg');

  syncOnlineSegs(nodes);

  q('#app-name').value = loadSettings().playerName || 'You';
  q('#app-name').addEventListener('change', e => {
    saveSettings({ playerName: e.target.value.trim().slice(0, 12) || 'You' });
    ctx.net.playerName = loadSettings().playerName;
    ctx.net.updateProfile?.({ name: loadSettings().playerName });
  });

  // The character picker writes the same settings keys the offline menu reads, so
  // the dweeb you pick here is the dweeb you play everywhere. No account, no card —
  // the browser remembers, and that is the whole identity system.
  for (const seg of nodes.online.querySelectorAll('.seg[data-online]')) {
    for (const b of seg.querySelectorAll('button')) {
      b.onclick = () => {
        const key = seg.dataset.online;   // 'type' | 'color'
        saveSettings(key === 'type' ? { type: b.dataset.v } : { color: b.dataset.v });
        ctx.net.updateProfile?.({ archetype: loadSettings().type, color: onlineProfile().color });
        syncOnlineSegs(nodes);
      };
    }
  }

  // Uppercase as you type, so "ab3d" can't fail on a lowercase paste.
  const codeInput = q('#app-code');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  codeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') q('#app-btn-join').click();
  });

  const busy = async (label, fn) => {
    setMsg(msg, '');
    for (const b of nodes.online.querySelectorAll('.btn')) b.disabled = true;
    setMsg(msg, label);
    try { await fn(); }
    catch (err) {
      const kind = toast.fromNetError(err, 'connect');
      setMsg(msg,
        kind === 'SERVER_FULL' ? 'The servers are full right now — try again in a minute.'
        : kind === 'NOT_CONNECTED' ? 'Lost the connection while joining. Try again.'
        : '');
    }
    finally { for (const b of nodes.online.querySelectorAll('.btn')) b.disabled = false; }
  };

  q('#app-btn-create').onclick = () => busy('Creating room…', async () => {
    const room = await ctx.net.createRoom(onlineProfile());
    router.go('/room/' + room.code);
  });

  // PLAY NOW is the whole screen's promise: one press, one match. Name, dweeb and
  // colour ride along from the fields above.
  const playNow = () => busy('Finding you a match…', async () => {
    const room = await ctx.net.quickPlay(onlineProfile());
    router.go('/room/' + room.code);
  });
  q('#app-btn-quick').onclick = playNow;
  // Enter anywhere on the screen (except the code row, which has its own Enter) is
  // also PLAY NOW — the green path should be one key away.
  nodes.online.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target !== codeInput && e.target.tagName !== 'BUTTON') playNow();
  });

  q('#app-btn-join').onclick = () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!INVITE_RE.test(code)) { toast.warn('Room codes are 4 letters or numbers.'); return; }
    busy('Joining ' + code + '…', async () => {
      await ctx.net.joinRoom(code, onlineProfile());
      router.go('/room/' + code);
    });
  };

  q('#app-btn-online-back').onclick = () => router.go('/');
}

function wireLobbyScreen(ctx) {
  wireLobby({
    root: ctx.nodes.lobby,
    net: ctx.net,
    router: ctx.router,
    toast: ctx.toast,
    onStartMatch: () => {
      // Online play starts a local match for now; once NET lands, the server
      // owns the start and this becomes a wait for the 'match' event.
      ctx.toast.info('Starting the match…');
      beginMatch(ctx, { bots: ctx.net.roomSnapshot?.()?.settings?.bots ?? 0 });
    },
  });
}

// ─── net events → UI ───

function wireNetEvents(ctx) {
  const { net, nodes, toast } = ctx;
  const refresh = () => {
    if (!nodes.lobby.classList.contains('hidden')) {
      renderLobby({ root: nodes.lobby, net, toast });
    }
  };

  net.on?.('room', refresh);
  net.on?.('ping', () => updatePing(nodes.lobby, net.rttMs));
  net.on?.('reconnecting', d => toast.warn('Reconnecting to the server…', { key: 'net' }));
  net.on?.('disconnected', d => toast.error('Disconnected from the server.', { key: 'net' }));
  net.on?.('connected', d => {
    if (d?.reconnected) toast.info('Back online.', { key: 'net' });
    refresh();
  });
  net.on?.('left', () => refresh());
  net.on?.('error', d => { if (d) toast.error(d.message || 'Network error.', { key: 'net' }); });
}

// ─── game events → routes ───

function wireGameEvents({ router, nodes, toast }) {
  // Watch the game's own overlays, so the route always agrees with what's
  // actually on screen even if the player clicks the game's buttons directly.
  watchGameScreens({
    onMatchStart: () => {
      router.setMatchLock(true);
      router.go('/match', { replace: true });
      applySettings();
    },
    onResults: () => router.go('/results', { replace: true }),
    onMenu: () => {
      router.setMatchLock(false);
      if (router.path === '/' || location.hash === '#/' || location.hash === '') return;
      if (router.path === '/results' || router.path === '/match') router.go('/play', { replace: true });
    },
  });

  // The game's own QUIT / MENU buttons must release the route lock.
  for (const id of ['btn-quit', 'btn-main-menu', 'btn-play-again', 'btn-pause-mall', 'btn-results-mall']) {
    document.getElementById(id)?.addEventListener('click', () => {
      queueMicrotask(() => {
        if (!isMatchLive()) router.setMatchLock(false);
      });
    });
  }

  for (const id of ['btn-pause-mall', 'btn-results-mall']) {
    document.getElementById(id)?.addEventListener('click', () => {
      router.setMatchLock(false);
      router.go('/');
    });
  }
  document.getElementById('btn-play')?.addEventListener('click', () => {
    router.setMatchLock(true);
  });
}

/** Enter the match from the lobby: hide everything, let the game show the HUD. */
function beginMatch(ctx, opts) {
  hideOfflineMenu();
  for (const n of ctx.nodes.all) n.classList.add('hidden');
  ctx.shell.classList.add('app-in-match');
  // The offline path is the only one that can start a real match today, so we
  // hand off to the game's own PLAY button. It is a local call: no network.
  if (!isMatchLive()) startOfflineMatch(opts);
  ctx.router.setMatchLock(true);
  ctx.router.go('/match');
}

// ─── routing ───

// The hub's living parts (spotlight rotation) run on an interval. It starts
// when the title route shows and stops on every other route, so it never
// paints a hidden screen or leaks across visits.
let hubStop = null;

function onRoute(route, ctx) {
  const { nodes, shell, router } = ctx;
  const path = route.path;
  const inGame = path === '/match' || path === '/results';

  // One screen at a time. In a match the shell is entirely out of the way.
  for (const n of nodes.all) n.classList.add('hidden');
  shell.classList.toggle('app-in-match', inGame);
  shell.classList.toggle('hidden', inGame);
  if (hubStop) { hubStop(); hubStop = null; }

  if (inGame) {
    hideOfflineMenu();
    if (path === '/match' && !isMatchLive() && !isAtResults()) {
      // Deep link straight to a match with nothing running: give the player the
      // offline menu rather than a black screen, since that's the safe default.
      router.replaceUrl('/play');
      return onRoute({ path: '/play' }, ctx);
    }
    return;
  }

  switch (path) {
    case '/play':
      // The original, untouched offline menu. This is the whole point.
      showOfflineMenu(loadSettings());
      break;

    case '/online':
      hideOfflineMenu();
      nodes.online.classList.remove('hidden');
      document.getElementById('how-to-play')?.classList.add('hidden');
      syncOnlineSegs(ctx.nodes);
      warmOnlineClient(ctx);   // connects + starts the live count; the screen never waits
      updateOnlineNote(ctx);
      break;

    case '/settings':
      hideOfflineMenu();
      nodes.settings.classList.remove('hidden');
      break;

    case '/lobby':
      hideOfflineMenu();
      nodes.lobby.classList.remove('hidden');
      handleLobbyRoute(route, ctx);
      break;

    default:
      // #/room/ABCD — the invite link. Matched by prefix because the route path
      // carries the code, so it can never be a literal `case`.
      if (path.startsWith('/room/')) {
        hideOfflineMenu();
        nodes.lobby.classList.remove('hidden');
        handleLobbyRoute(route, ctx);
        return;
      }
      // Title. Ensure legacy menu is strictly hidden so plates never overlap
      hideOfflineMenu();
      // Double check after next tick in case main.js finished late
      setTimeout(() => hideOfflineMenu(), 50);
      setTimeout(() => hideOfflineMenu(), 250);
      nodes.title.classList.remove('hidden');
      document.getElementById('how-to-play')?.classList.add('hidden');
      // The hub is alive: stats may have changed while a game was running, and
      // the spotlight/daily/profile repaint from the games' own saves.
      hubStop = refreshHub(nodes.title).stop;
  }
}

/** Tell the player, honestly, which transport they are looking at. */
function updateOnlineNote(ctx) {
  const note = ctx.nodes.online.querySelector('#app-online-note');
  const mocked = !!ctx.net.mocked;
  if (mocked) {
    note.textContent = 'Offline demo: rooms are simulated locally. The real server takes over the moment it is reachable.';
    return;
  }
  const stale = ctx.net.onlineSnapshot?.().stale;
  note.textContent = stale
    ? 'Connected to ' + (ctx.net.serverUrl || 'the server') + ' — refreshing the count…'
    : 'Connected to ' + (ctx.net.serverUrl || 'the server') + '. No account needed — your dweeb is this browser.';
}

function handleLobbyRoute(route, ctx) {
  const { net, router, toast, nodes } = ctx;
  const code = route.code || net.roomSnapshot?.()?.code;

  const current = net.roomSnapshot?.();
  if (!code) {
    setMsg(nodes.lobby.querySelector('#app-lobby-msg'), 'You are not in a room.');
    return;
  }
  if (current?.code === code) {
    renderLobby({ root: nodes.lobby, net, toast });
    updatePing(nodes.lobby, net.rttMs);
    return;
  }

  // Arriving from an invite link: join, but never block the screen on it.
  setMsg(nodes.lobby.querySelector('#app-lobby-msg'), 'Joining ' + code + '…');
  updatePing(nodes.lobby, null);
  net.joinRoom(code, {
    name: loadSettings().playerName,
    archetype: loadSettings().type,
    color: loadSettings().color,
  }).then(room => {
    if (router.path.startsWith('/room')) {
      router.replaceUrl('/room/' + room.code);
      renderLobby({ root: nodes.lobby, net, toast });
    }
  }).catch(err => {
    const kind = toast.fromNetError(err, 'join');
    setMsg(nodes.lobby.querySelector('#app-lobby-msg'),
      kind === 'ROOM_NOT_FOUND' ? 'That room does not exist (or it has closed).'
        : kind === 'ROOM_FULL' ? 'That room is full. Try another, or play offline.'
        : 'Could not reach the server. Offline play is still available.');
    renderLobby({ root: nodes.lobby, net, toast });
  });
}
