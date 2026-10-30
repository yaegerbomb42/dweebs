// screens.js — builds the shell's own screens: Title, Online, Lobby, Settings.
//
// Rules that keep this safe for everyone else:
//   * Everything lives inside #app-shell. Nothing here queries or mutates the
//     HUD, the canvas or the Lead's markup, and it adds no global CSS classes
//     beyond .app-*.
//   * I reuse Lead's existing .btn / .panel / .overlay / .seg / .title classes
//     rather than inventing new ones, so the shell matches the game for free
//     and stays consistent when the Lead restyles them.
//   * "Play offline" is deliberately NOT built here — that screen is the
//     original #main-menu, untouched. Offline keeps working because it is
//     literally the flow that shipped.

import { el } from './dom.js';
import { BINDING_LABELS } from './settings.js';
import { MALL_MODES, DIFFICULTY_LABELS, difficultyStars } from './mall.js';

/** One launchable sub-game button. */
function subButton(s, btnClass) {
  const d = DIFFICULTY_LABELS[s.difficulty] || '';
  return `<button class="btn mall-sub-btn ${btnClass}" id="${s.id}" title="${s.title} · ${d}"
      data-launch='${JSON.stringify(s.launch)}'>${s.label}</button>`;
}

/** Difficulty badge: star pips + label, e.g. ★★☆ NORMAL. */
function diffBadge(level) {
  const label = DIFFICULTY_LABELS[level] || '';
  return `<span class="mall-diff mall-diff-${level}" title="Difficulty: ${label}"
    aria-label="Difficulty ${label}">${difficultyStars(level)} ${label}</span>`;
}

/** One mall card, rendered from the MALL_MODES data model. */
function mallCard(card) {
  const subs = card.subgames.map(s => subButton(s, card.btnClass)).join('');
  const main = card.launch;
  return `
  <article class="mall-card card-${card.id}" id="${card.cardId}">
    <div class="mall-badge ${card.badgeClass}">${card.badge}</div>
    <div class="mall-icon ${card.iconAnim}" aria-hidden="true">${card.icon}</div>
    <h3 class="mall-card-title">${card.title}</h3>
    ${diffBadge(card.difficulty)}
    <p class="mall-card-desc">${card.desc}</p>
    ${subs ? `<div class="mall-subgames">${subs}</div>` : ''}
    <button class="btn mall-btn ${card.btnClass}" id="${main.id}"
      data-launch='${JSON.stringify(main.launch)}'>${main.label}</button>
  </article>`;
}

/** Pure HTML for the mall title screen — exported so tests can assert every
 * launch button exists in the DOM boot.js wires, without needing a browser. */
export function mallTitleHtml() {
  const cards = MALL_MODES.map(mallCard).join('');
  return `
    <section id="app-title" class="app-screen hidden" aria-label="The Dweeb Mall">
      <div class="mall-container">
        <header class="mall-header">
          <h1 class="mall-title">THE DWEEB MALL</h1>
          <p class="mall-subtitle">6 toy-box physics experiences — one living universe</p>
        </header>

        <div class="mall-grid" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); max-width: 1040px; margin: 0 auto;">
          ${cards}
        </div>

        <footer class="mall-footer">
          <button class="btn white" id="app-btn-offline">CUSTOM LOBBY</button>
          <button class="btn pink" id="app-btn-online">PLAY ONLINE</button>
          <button class="btn white" id="app-btn-how">HOW TO PLAY</button>
          <button class="btn blue" id="app-btn-settings">SETTINGS</button>
        </footer>
      </div>
    </section>`;
}

function buildMallTitle() {
  return el(mallTitleHtml());
}

export function buildScreens() {
  const title = buildMallTitle();

  const online = el(`
    <section id="app-online" class="app-screen hidden" aria-label="Play online">
      <div class="panel app-panel app-online-panel">
        <h2>Play online</h2>
        <p class="app-online-count" id="app-online-count" role="status">
          <span class="app-online-dot" aria-hidden="true"></span>
          <span id="app-online-num">…</span>
        </p>
        <button class="btn big pink app-playnow" id="app-btn-quick">PLAY NOW</button>
        <label class="app-field">Your name
          <input id="app-name" maxlength="12" autocomplete="nickname" spellcheck="false" />
        </label>
        <div class="app-field">
          <span class="app-slider-head">Your dweeb</span>
          <div class="seg dweeb-roster-grid" data-online="type" style="display:flex; flex-wrap:wrap; gap:6px; max-height:160px; overflow-y:auto; padding:4px;">
            <button data-v="cube" title="All-rounder">Cube</button>
            <button data-v="blob" title="Heavy &amp; hard to launch">Blob</button>
            <button data-v="spiky" title="Fast glass cannon">Spiky</button>
            <button data-v="stalky" title="Twin eye stalks">Stalky</button>
            <button data-v="peep" title="Giant horned eyeball">Peep</button>
            <button data-v="tri_cloud" title="Floaty tri-lobed cloud">Tri-Cloud</button>
            <button data-v="bunny" title="Springy floppy ears">Bunny</button>
            <button data-v="puddle" title="Melting slime pancake">Puddle</button>
            <button data-v="blockhead" title="Cube periscope">Blockhead</button>
            <button data-v="gumball" title="Candy marble belly">Gumball</button>
            <button data-v="bumpy" title="Knobby sensory bumps">Bumpy</button>
            <button data-v="cyclops" title="One giant eye">Cyclops</button>
            <button data-v="starry" title="5-pointed star">Starry</button>
            <button data-v="blink" title="Pill capsule">Blink</button>
            <button data-v="bean" title="Tilted legume">Bean</button>
            <button data-v="tadpole" title="Wagging spring tail">Tadpole</button>
            <button data-v="floppy" title="Heavy ear lobes">Floppy</button>
            <button data-v="chonk" title="Heavy 4-legged block">Chonk</button>
            <button data-v="ghosty" title="Floating sheet specter">Ghosty</button>
            <button data-v="triclops" title="3 mismatched eyes">Tri-Clops</button>
            <button data-v="rolling_eye" title="Wander eye orb">Roll-Eye</button>
            <button data-v="sherbet" title="Pastel swirl">Sherbet</button>
            <button data-v="antenna" title="Teardrop antenna">Antenna</button>
            <button data-v="boing" title="Coiled spring legs">Boing</button>
            <button data-v="boxer" title="Boxing gloves">Boxer</button>
            <button data-v="plunger" title="Suction cup arms">Plunger</button>
          </div>
          <p class="app-note" id="app-type-blurb"></p>
        </div>
        <div class="app-field">
          <span class="app-slider-head">Colour</span>
          <div class="seg swatches" data-online="color">
            <button data-v="yellow" style="--s:#ffd23f" aria-label="yellow"></button><button data-v="pink" style="--s:#ff6fb5" aria-label="pink"></button><button data-v="blue" style="--s:#3fa9ff" aria-label="blue"></button><button data-v="green" style="--s:#5ee06a" aria-label="green"></button><button data-v="orange" style="--s:#ff9a3c" aria-label="orange"></button><button data-v="purple" style="--s:#b56cff" aria-label="purple"></button>
          </div>
        </div>
        <details class="app-advanced">
          <summary>Play with friends (room code)</summary>
          <div class="app-menu-row">
            <button class="btn" id="app-btn-create">CREATE ROOM</button>
          </div>
          <label class="app-field">Room code
            <span class="app-join-row">
              <input id="app-code" maxlength="4" placeholder="ABCD" spellcheck="false"
                     autocapitalize="characters" autocomplete="off" inputmode="text" />
              <button class="btn blue" id="app-btn-join">JOIN</button>
            </span>
          </label>
        </details>
        <p id="app-online-msg" class="app-msg hidden" role="alert"></p>
        <div class="app-menu-row">
          <button class="btn white" id="app-btn-online-back">BACK</button>
        </div>
        <p class="app-note" id="app-online-note"></p>
      </div>
    </section>`);

  const lobby = el(`
    <section id="app-lobby" class="app-screen hidden" aria-label="Lobby">
      <div class="panel app-panel app-lobby-panel">
        <h2>Lobby</h2>
        <div class="app-lobby-head">
          <div class="app-code-box">
            <span class="app-code-label">CODE</span>
            <span id="app-room-code" class="app-code">----</span>
          </div>
          <div class="app-menu-row">
            <button class="btn white" id="app-btn-copy">COPY INVITE</button>
            <span id="app-ping" class="app-ping" title="Round-trip time to the server">-- ms</span>
          </div>
        </div>
        <ul id="app-player-list" class="app-players"></ul>
        <p id="app-lobby-msg" class="app-msg hidden" role="alert"></p>
        <div class="settings app-settings-grid" id="app-host-settings">
          <span>Stocks</span>
          <div class="seg" data-lobby="stocks">
            <button data-v="1">1</button><button data-v="3">3</button><button data-v="5">5</button>
          </div>
          <span>Time</span>
          <div class="seg" data-lobby="time">
            <button data-v="60">1:00</button><button data-v="120">2:00</button><button data-v="300">5:00</button>
          </div>
          <span>Items</span>
          <div class="seg" data-lobby="items">
            <button data-v="on">On</button><button data-v="off">Off</button>
          </div>
          <span>Bots</span>
          <div class="seg" data-lobby="bots">
            <button data-v="0">None</button><button data-v="1">1</button><button data-v="3">3</button><button data-v="7">Fill</button>
          </div>
        </div>
        <p id="app-host-note" class="app-note hidden">Only the host can change these.</p>
        <div class="app-menu-row">
          <button class="btn pink" id="app-btn-ready">READY!</button>
          <button class="btn" id="app-btn-fight">START MATCH</button>
          <button class="btn white" id="app-btn-leave">LEAVE</button>
        </div>
      </div>
    </section>`);

  const settings = buildSettings();

  return { title, online, lobby, settings, all: [title, online, lobby, settings] };
}

function buildSettings() {
  const slider = (id, label, value) => `
    <label class="app-field app-slider">
      <span class="app-slider-head">${label}<output id="${id}-out">${Math.round(value * 100)}%</output></span>
      <input type="range" id="${id}" min="0" max="100" step="1" value="${Math.round(value * 100)}" />
    </label>`;

  const seg = (key, label, options) => `
    <div class="app-field">
      <span class="app-slider-head">${label}</span>
      <div class="seg" data-setting="${key}">
        ${options.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}
      </div>
    </div>`;

  const node = el(`
    <section id="app-settings" class="app-screen hidden" aria-label="Settings">
      <div class="panel app-panel app-settings-panel">
        <h2>Settings</h2>
        <div class="app-settings-cols">
          <div class="app-col">
            <h3>Audio</h3>
            ${slider('app-vol-master', 'Master volume', 0.8)}
            ${slider('app-vol-sfx', 'Effects', 1)}
            ${slider('app-vol-music', 'Music', 0.6)}
            ${seg('music', 'Music', [['on', 'On'], ['off', 'Off']])}
            ${seg('sound', 'Sound', [['on', 'On'], ['off', 'Off']])}
          </div>
          <div class="app-col">
            <h3>Video &amp; motion</h3>
            ${seg('quality', 'Quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
            ${seg('reducedMotion', 'Reduced motion', [['false', 'Off'], ['true', 'On']])}
            <p class="app-note">Reduced motion turns off screen shake, hit-stop and confetti.</p>
            <h3>Input</h3>
            ${seg('gamepad', 'Gamepad', [['false', 'Off'], ['true', 'On']])}
            ${seg('invertY', 'Invert look Y', [['false', 'Off'], ['true', 'On']])}
            ${slider('app-sens', 'Look sensitivity', 1)}
            <p class="app-note" id="app-pad-note"></p>
          </div>
          <div class="app-col">
            <h3>Controls</h3>
            <p class="app-note">Click a key, then press the new one. Escape cancels.</p>
            <div class="app-binds" id="app-binds">
              ${Object.entries(BINDING_LABELS).map(([action, label]) => `
                <button class="app-bind" data-action="${action}">
                  <span class="app-bind-label">${label}</span>
                  <span class="app-bind-key" data-key="${action}">—</span>
                </button>`).join('')}
            </div>
            <button class="btn white app-reset-binds" id="app-binds-reset">RESET CONTROLS</button>
          </div>
        </div>
        <div class="app-menu-row">
          <button class="btn blue" id="app-btn-settings-back">DONE</button>
        </div>
      </div>
    </section>`);

  return node;
}
