// toasts.js — reconnecting / disconnected / server full / room not found.
//
// APP-owned. Styles only its own .app-toast class; it never restyles HUD or
// menu chrome. Toasts are advisory only — nothing here can pause the game,
// because a toast must never be able to block offline play.

const BOX_ID = 'app-toasts';

function ensureBox() {
  let box = document.getElementById(BOX_ID);
  if (!box) {
    box = document.createElement('div');
    box.id = BOX_ID;
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  return box;
}

export function createToasts() {
  const box = ensureBox();
  const live = new Map();   // key → { node, timer } so repeats update in place

  function show(msg, { ms = 3400, kind = 'info', key = null } = {}) {
    if (!msg) return;
    const id = key || msg;
    const existing = live.get(id);
    if (existing) {
      // Same message again (e.g. another reconnect attempt): refresh, don't stack.
      existing.node.textContent = msg;
      existing.node.className = 'app-toast go app-toast-' + kind;
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => dismiss(id), ms);
      return;
    }
    const node = document.createElement('div');
    node.className = 'app-toast go app-toast-' + kind;
    node.textContent = msg;
    box.appendChild(node);
    live.set(id, { node, timer: setTimeout(() => dismiss(id), ms) });
  }

  function dismiss(id) {
    const entry = live.get(id);
    if (!entry) return;
    live.delete(id);
    clearTimeout(entry.timer);
    entry.node.classList.remove('go');
    setTimeout(() => entry.node.remove(), 400);
  }

  function info(msg, opts) { show(msg, { ...opts, kind: 'info' }); }
  function warn(msg, opts) { show(msg, { ...opts, kind: 'warn' }); }
  function error(msg, opts) { show(msg, { ...opts, kind: 'error', ms: 5200 }); }

  function clear() {
    for (const id of [...live.keys()]) dismiss(id);
  }

  /**
   * Turn a NetClient rejection into player-facing words. Codes come from the
   * APP→NET contract; anything unknown becomes a soft, non-scary message that
   * still points at offline play, because offline is always available.
   */
  function fromNetError(err, context = 'join') {
    const code = err?.code;
    if (code === 'ROOM_NOT_FOUND') {
      error('Room not found — check the code.', { key: 'net' });
      return 'ROOM_NOT_FOUND';
    }
    if (code === 'ROOM_FULL') {
      error('Server is full — try again in a minute, or play offline.', { key: 'net' });
      return 'ROOM_FULL';
    }
    if (code === 'SERVER_FULL') {
      error('The servers are full right now — try again in a minute.', { key: 'net' });
      return 'SERVER_FULL';
    }
    if (code === 'SERVER_UNREACHABLE' || code === 'NOT_CONNECTED') {
      error('Could not reach the server. Offline play still works.', { key: 'net' });
      return 'SERVER_UNREACHABLE';
    }
    error('Could not ' + context + '. Offline play still works.', { key: 'net' });
    return code || 'UNKNOWN';
  }

  return { show, info, warn, error, clear, fromNetError, dismiss };
}
