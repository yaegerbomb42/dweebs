// lobby.js — renders the lobby from a NetClient room snapshot.
//
// It reads only `net.roomSnapshot()` and only ever calls the methods in the
// APP→NET contract, so swapping MockNetClient for the real NetClient changes
// nothing in this file. There is no networking and no timing logic here.

import { setMsg, setSeg, inviteLink } from './dom.js';

import { CHARACTER_ROSTER } from '../player/characterList.js';
const ARCHETYPE_LABEL = Object.fromEntries(
  CHARACTER_ROSTER.map(c => [c.id, c.name])
);
const COLOR_HEX = {
  yellow: '#ffd23f', pink: '#ff6fb5', blue: '#3fa9ff', green: '#5ee06a',
  orange: '#ff9a3c', purple: '#b56cff', red: '#ff4d5e', teal: '#2fd6c4',
};

export function renderLobby({ root, net, toast }) {
  const q = sel => root.querySelector(sel);
  const room = net.roomSnapshot?.() ?? net.room ?? null;

  q('#app-room-code').textContent = room?.code || '----';

  if (!room) {
    q('#app-player-list').innerHTML = '';
    setMsg(q('#app-lobby-msg'), '');
    updateHostControls(root, null, net);
    return;
  }

  renderPlayers(q('#app-player-list'), room);
  updateHostControls(root, room, net);
  updateReadyButton(q('#app-btn-ready'), room);

  const everyoneReady = room.players.filter(p => !p.bot).every(p => p.ready);
  q('#app-btn-fight').classList.toggle('hidden', !room.players.some(p => p.you && p.host));
  if (!everyoneReady) q('#app-btn-fight').classList.add('app-waiting');
  else q('#app-btn-fight').classList.remove('app-waiting');
}

function renderPlayers(list, room) {
  list.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    li.className = 'app-player'
      + (p.ready ? ' is-ready' : '')
      + (p.you ? ' is-you' : '')
      + (p.host ? ' is-host' : '')
      + (p.bot ? ' is-bot' : '');

    const swatch = document.createElement('span');
    swatch.className = 'app-swatch';
    swatch.style.background = COLOR_HEX[p.color] || '#ccc';
    swatch.title = p.color;

    const name = document.createElement('span');
    name.className = 'app-player-name';
    name.textContent = p.name + (p.you ? ' (you)' : '');

    const badge = document.createElement('span');
    badge.className = 'app-player-arch';
    badge.textContent = ARCHETYPE_LABEL[p.archetype] || p.archetype;

    const ping = document.createElement('span');
    ping.className = 'app-player-ping';
    ping.textContent = p.ping == null ? '–' : p.ping + ' ms';

    const state = document.createElement('span');
    state.className = 'app-player-state';
    state.textContent = p.bot ? (p.ready ? 'READY' : 'WAITING') : (p.ready ? 'READY' : 'NOT READY');

    li.append(swatch, name, badge, ping, state);
    list.appendChild(li);
  }
}

function updateHostControls(root, room, net) {
  const s = room?.settings ?? {};
  setSeg(root.querySelector('.seg[data-lobby="stocks"]'), s.stocks ?? 3);
  setSeg(root.querySelector('.seg[data-lobby="time"]'), s.time ?? 120);
  setSeg(root.querySelector('.seg[data-lobby="items"]'), s.items === false ? 'off' : 'on');
  setSeg(root.querySelector('.seg[data-lobby="bots"]'), s.bots ?? 0);

  // Only the host may change the rules; everyone else sees them read-only.
  const iAmHost = !!room?.players.some(p => p.you && p.host);
  for (const seg of root.querySelectorAll('.seg[data-lobby]')) {
    for (const b of seg.querySelectorAll('button')) b.disabled = !iAmHost;
  }
  root.querySelector('#app-host-settings').classList.toggle('app-readonly', !iAmHost);
  root.querySelector('#app-host-note').classList.toggle('hidden', iAmHost);
}

function updateReadyButton(btn, room) {
  const me = room.players.find(p => p.you);
  btn.textContent = me?.ready ? 'CANCEL READY' : 'READY!';
  btn.classList.toggle('is-ready', !!me?.ready);
}

export function updatePing(root, rtt) {
  const pill = root.querySelector('#app-ping');
  if (!pill) return;
  const ms = Math.round(rtt ?? -1);
  pill.textContent = ms < 0 ? '-- ms' : ms + ' ms';
  // Three tiers, matching the brief's brief > ok > bad.
  pill.dataset.tier = ms < 0 ? 'idle' : ms < 60 ? 'good' : ms < 140 ? 'ok' : 'bad';
}

/** Wire the lobby's own controls. All of it goes through the NetClient contract. */
export function wireLobby({ root, net, router, toast, onStartMatch }) {
  const q = sel => root.querySelector(sel);

  q('#app-btn-copy').onclick = async () => {
    const code = q('#app-room-code').textContent;
    if (!code || code === '----') { toast.warn('No room yet.'); return; }
    const link = inviteLink(code);
    try {
      await navigator.clipboard.writeText(link);
      toast.info('Invite link copied.');
    } catch {
      // Clipboard needs a secure context; showing the link is the fallback.
      toast.info('Invite link: ' + link, { ms: 8000 });
    }
  };

  q('#app-btn-ready').onclick = () => {
    const me = net.roomSnapshot?.()?.players.find(p => p.you);
    if (!me) { toast.warn('You are not in a room yet.'); return; }
    net.setReady(!me.ready);
  };

  q('#app-btn-fight').onclick = () => {
    const room = net.roomSnapshot?.();
    if (!room) return;
    if (room.players.some(p => p.you && p.host)) onStartMatch?.({ room });
  };

  q('#app-btn-leave').onclick = () => {
    net.leave?.();
    router.go('/online');
  };

  for (const seg of root.querySelectorAll('.seg[data-lobby]')) {
    for (const b of seg.querySelectorAll('button')) {
      b.onclick = () => {
        const key = seg.dataset.lobby;
        const v = b.dataset.v;
        const patch = key === 'items' ? { items: v === 'on' } : { [key]: Number(v) };
        net.updateSettings(patch);
      };
    }
  }
}
