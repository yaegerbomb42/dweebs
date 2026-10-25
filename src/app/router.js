// router.js — tiny hash router, back-button safe. APP-owned.
//
// Routes:  #/            title
//          #/play        offline setup  (the original #main-menu, untouched)
//          #/online      create / join by code / quick play
//          #/room/ABCD   lobby for room ABCD  (invite links land here)
//          #/lobby       lobby for the room we're already in
//          #/match       the game itself (main.js owns the HUD)
//          #/results     the game results (main.js owns #results-screen)
//          #/settings    volumes / rebinding / gamepad / motion / quality
//
// The router only decides *which screen is visible* and tells the rest of the app.
// It never imports the game and never touches the network, so an invite link
// resolves to a visible, usable screen even with the server down.
//
// Back-button rules (this is the part that bites):
//   * MATCH_LOCK paths (/match, /results) are "sticky": while a match is live,
//     navigating back to a shell screen is refused and the hash is restored, so
//     the player can never strand a running match behind the menu. Leaving the
//     match goes through the game's own quit button, which then unlocks it.
//   * Every other navigation uses pushState, so Back walks the screens the
//     player actually saw instead of teleporting them to the title.

/* global URLSearchParams, history, queueMicrotask */

const ROUTES = ['/', '/play', '/online', '/lobby', '/match', '/results', '/settings'];
export const MATCH_LOCK = new Set(['/match', '/results']);
export const INVITE_RE = /^[A-Za-z0-9]{4}$/;

/** Route codes are 4 alphanumeric chars; anything else is a normal route. */
function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  const qs = new URLSearchParams(query || '');

  // #/room/ABCD — the invite link
  const room = path.match(/^\/room\/([A-Za-z0-9]{1,8})$/i);
  if (room) return { path: '/room/' + room[1].toUpperCase(), name: 'room', code: room[1].toUpperCase() };

  // #/lobby?code=ABCD
  if (path === '/lobby' || path === '/lobby/') {
    const code = (qs.get('code') || '').toUpperCase();
    return code && INVITE_RE.test(code)
      ? { path: '/room/' + code, name: 'room', code }
      : { path: '/lobby', name: 'lobby', code: '' };
  }

  if (ROUTES.includes(path)) return { path, name: path.slice(1) || 'title' };
  return { path: '/', name: 'title' };
}

export function createRouter({ onRoute } = {}) {
  let current = parseHash();
  let lockMatch = false;          // true while a match is live
  let suppress = false;           // guards echo from our own history moves

  function emit() { onRoute?.(current); }

  function apply() {
    const next = parseHash();
    // Back-button guard. While a match is live the only permitted moves are
    // between /match and /results — both are the same live game. Anything that
    // would land on a shell screen is refused and the hash is restored, so the
    // player can never strand a running match behind the menu.
    const leavingMatch = lockMatch && MATCH_LOCK.has(current.path) && !MATCH_LOCK.has(next.path);
    if (leavingMatch) {
      history.replaceState(null, '', '#' + current.path);
      return;
    }
    current = next;
    emit();
  }

  // hashchange only fires for user-typed hashes; pushState is synchronous.
  const onHashChange = () => { if (!suppress) apply(); suppress = false; };
  const onPopState = () => { suppress = false; apply(); };
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('popstate', onPopState);

  const api = {
    get current() { return current; },
    get path() { return current.path; },
    get locked() { return lockMatch; },

    /** Lock/unlock the match. Going back out of a live match is refused until unlocked. */
    setMatchLock(on) {
      lockMatch = !!on;
      if (on && !MATCH_LOCK.has(current.path)) api.go('/match', { replace: true });
    },

    /** Navigate. `replace` swaps the current entry so Back skips it. */
    go(path, { replace = false } = {}) {
      const target = '#' + (path.startsWith('/') ? path : '/' + path);
      suppress = true;
      if (replace) history.replaceState(null, '', target);
      else history.pushState(null, '', target);
      suppress = false;
      // Always re-render, even when the hash didn't change: several callers
      // (leaving a match, normalising a bad code) rely on that to sync the UI.
      apply();
    },

    /** Replace the current URL without rendering (used to normalise bad codes). */
    replaceUrl(path) {
      suppress = true;
      history.replaceState(null, '', '#' + path);
      suppress = false;
    },

    back() { history.back(); },
    dispose() {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onPopState);
    },
  };

  // Defer the first emit so the shell can register its screens first.
  queueMicrotask(emit);
  return api;
}
