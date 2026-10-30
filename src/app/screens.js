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

/* ── Title: the builder-first hub ── (live title screen) ─────────────────── */
export function buildScreens() {
  // ── Title: the builder-first hub ──────────────────────────────────────────
  // Build-A-Dweeb is the hero (MAIN EVENT banner, biggest CTA). The mini-games
  // live below it in THE ARCADE: compact cabinets, each with a difficulty
  // badge. Every game-launch button carries data-launch so boot.js can show a
  // launch shimmer; every id here must stay wired in wireTitle() (see
  // test/app-hub.test.js and test/app-hub2.test.js, which cross-check both
  // files).
  //
  // The hub's living parts (featured-dweeb spotlight, trophy-wall stats,
  // daily challenge, profile chip) are painted by src/app/hub-extras.js on
  // the title route — this template only carries their slots.
  const title = el(`
    <section id="app-title" class="app-screen hidden" aria-label="Dweebs hub">
      <div class="hub-bg" aria-hidden="true"><i>🫧</i><i>✨</i><i>🫧</i><i>💫</i><i>🫧</i><i>✨</i></div>
      <div class="hub-container">
        <header class="hub-header">
          <h1 class="hub-wordmark" aria-label="DWEEBS"><span style="--c:#f47a3a;--i:0">D</span><span style="--c:#ffc53d;--i:1">W</span><span style="--c:#ffd84a;--i:2">E</span><span style="--c:#6cc35a;--i:3">E</span><span style="--c:#56aee8;--i:4">B</span><span style="--c:#a98be0;--i:5">S</span></h1>
          <p class="hub-tagline">emotionally unstable. Collectibly adorable.</p>
          <div class="hub-profile" id="hub-profile" aria-label="Your dweeb profile"></div>
        </header>

        <!-- DWEEB NEWS: live ticker under the header -->
        <div class="hub-news-ticker" id="hub-news" aria-label="Dweeb News" role="status" aria-live="polite">
          <span class="hub-news-label" id="hub-news-label">📰 DWEEB NEWS</span>
          <div class="hub-news-track" id="hub-news-track" aria-hidden="true"></div>
        </div>

        <!-- HERO: Build-A-Dweeb is the main experience -->
        <article class="hub-hero" id="hub-hero-builder" aria-label="Build-A-Dweeb, the main experience">
          <div class="hero-glow" aria-hidden="true"></div>
          <div class="hero-badges">
            <span class="hero-main-badge">⭐ MAIN EVENT</span>
            <span class="mall-badge badge-purple">CREATURE LAB &amp; AI ARENA</span>
          </div>
          <div class="hero-body">
            <div class="hero-icon" aria-hidden="true">🧬</div>
            <div class="hero-copy">
              <h2 class="hero-title">Build-A-Dweeb</h2>
              <p class="hero-desc">Sculpt a custom 3D creature — body shapes, eyes, appendages, colors, AI combat DNA — then send it into the autonomous colosseum and watch zero-input battles unfold.</p>
              <ul class="hero-chips">
                <li>🧪 3D creature sculpting</li>
                <li>🧠 AI combat DNA</li>
                <li>🤖 Autonomous battles</li>
              </ul>
            </div>
          </div>
          <button class="btn big purple hero-cta" id="app-btn-builder" data-launch>ENTER THE 3D LAB</button>
          <button class="btn blue hero-cta" id="app-btn-traitbrawl" title="Trait-driven auto-battler in the Toy Playroom" style="font-size:18px;margin-top:8px"
            data-launch>🤖 DWEEB BRAWL SIM</button>
          <button class="btn green hero-cta" id="app-btn-wilds" title="Open-world survival: watch your Dweeb try to survive on its own" style="font-size:18px;margin-top:8px"
            data-launch>🌲 DWEEB WILDS</button>
          <aside class="hero-spotlight" aria-label="Featured dweeb">
            <span class="hero-spot-label">🌟 FEATURED DWEEB</span>
            <div class="hero-spot-body" id="hero-spotlight"></div>
          </aside>
        </article>

        <!-- THE ARCADE: the mini-games, secondary row -->
        <section class="hub-arcade" aria-label="The arcade: mini-games">
          <div class="arcade-head">
            <h2 class="arcade-title">🕹️ THE ARCADE</h2>
            <p class="arcade-sub">mini-games · quick physics chaos</p>
          </div>
          <div class="arcade-row">
            <article class="arcade-card" style="--i:0" id="arcade-card-arena">
              <div class="arcade-card-top">
                <span class="arcade-icon" aria-hidden="true">🥊</span>
                <span class="diff-badge diff-easy" title="Pick-up-and-play chaos">EASY</span>
              </div>
              <h3 class="arcade-card-title">Knockout Arena</h3>
              <p class="arcade-card-desc">The original stadium brawler. Dumb ways to die, wild physics weapons, sudden death.</p>
              <p class="arcade-stat" data-stat-for="arena"></p>
              <div class="arcade-subgames">
                <button class="btn arcade-sub-btn yellow" id="app-btn-derby" data-launch title="Dumb Ways to Die">☠️ Derby</button>
                <button class="btn arcade-sub-btn yellow" id="app-btn-walldrop" data-launch title="Wall Drop PVP">🧱 Wall Drop</button>
                <button class="btn arcade-sub-btn yellow" id="app-btn-brawl" data-launch title="Knockout Brawl">🥊 Brawl</button>
                <button class="btn arcade-sub-btn yellow" id="app-btn-training" data-launch title="Training Lab">🧪 Training</button>
              </div>
              <button class="btn arcade-btn yellow" id="app-btn-classic" data-launch>PLAY BRAWLER</button>
            </article>

            <article class="arcade-card" style="--i:1" id="arcade-card-dynasty">
              <div class="arcade-card-top">
                <span class="arcade-icon" aria-hidden="true">🌱</span>
                <span class="diff-badge diff-easy" title="Peaceful and slow-paced">EASY</span>
              </div>
              <h3 class="arcade-card-title">Expedition &amp; Dynasty</h3>
              <p class="arcade-card-desc">Open-world colony in The Meadowlands. Citizen roles, toy contraptions, ruin vaults.</p>
              <p class="arcade-stat" data-stat-for="dynasty"></p>
              <button class="btn arcade-btn green" id="app-btn-dynasty" data-launch>ENTER EXPEDITION</button>
            </article>

            <article class="arcade-card" style="--i:2" id="arcade-card-warfare">
              <div class="arcade-card-top">
                <span class="arcade-icon" aria-hidden="true">⚔️</span>
                <span class="diff-badge diff-intense" title="Big battles, real tactics">INTENSE</span>
              </div>
              <h3 class="arcade-card-title">Dweeb Warfare</h3>
              <p class="arcade-card-desc">Mass physics army combat. Commander abilities, artillery, supply drops, 100v100.</p>
              <p class="arcade-stat" data-stat-for="warfare"></p>
              <div class="arcade-subgames">
                <button class="btn arcade-sub-btn pink" id="app-btn-warfare-defense" data-launch title="Defend the Fort: 20 waves">🛡️ Defend</button>
                <button class="btn arcade-sub-btn blue" id="app-btn-warfare-versus" data-launch title="100v100 versus AI">⚔️ Versus</button>
              </div>
              <button class="btn arcade-btn pink" id="app-btn-warfare" data-launch>START WARFARE</button>
            </article>

            <article class="arcade-card" style="--i:3" id="arcade-card-escape">
              <div class="arcade-card-top">
                <span class="arcade-icon" aria-hidden="true">🏝️</span>
                <span class="diff-badge diff-medium" title="Puzzles and parkour">MEDIUM</span>
              </div>
              <h3 class="arcade-card-title">Dweebscape Island</h3>
              <p class="arcade-card-desc">Combatless co-op escape. Parkour, haul heavy batteries, flip gate switches, power the portal.</p>
              <p class="arcade-stat" data-stat-for="escape"></p>
              <button class="btn arcade-btn blue" id="app-btn-escape" data-launch>START ESCAPE</button>
            </article>

            <article class="arcade-card" style="--i:4" id="arcade-card-mimic">
              <div class="arcade-card-top">
                <span class="arcade-icon" aria-hidden="true">🪞</span>
                <span class="diff-badge diff-medium" title="Sandbox antics">MEDIUM</span>
              </div>
              <h3 class="arcade-card-title">Mimic &amp; Mutate Lab</h3>
              <p class="arcade-card-desc">First-person toy lab. Show off physical antics — crowds of Dweebs copy and mutate them.</p>
              <p class="arcade-stat" data-stat-for="mimic"></p>
              <button class="btn arcade-btn" id="app-btn-mimic" data-launch>ENTER THE LAB</button>
            </article>
          </div>
        </section>

        <!-- TROPHY WALL: real stats, read from the games' own saves -->
        <section class="hub-trophies" aria-label="Trophy wall">
          <h2 class="hub-section-title">🏆 TROPHY WALL</h2>
          <div class="hub-trophy-row">
            <div class="hub-trophy" style="--i:0">
              <span class="hub-trophy-icon" aria-hidden="true">🛡️</span>
              <span class="hub-trophy-value" data-trophy="warfare">—</span>
              <span class="hub-trophy-label">best defense wave</span>
            </div>
            <div class="hub-trophy" style="--i:1">
              <span class="hub-trophy-icon" aria-hidden="true">🌱</span>
              <span class="hub-trophy-value" data-trophy="village">—</span>
              <span class="hub-trophy-label">village structures</span>
            </div>
            <div class="hub-trophy" style="--i:2">
              <span class="hub-trophy-icon" aria-hidden="true">🧬</span>
              <span class="hub-trophy-value" data-trophy="build">—</span>
              <span class="hub-trophy-label">custom dweeb</span>
            </div>
            <div class="hub-trophy" style="--i:3">
              <span class="hub-trophy-icon" aria-hidden="true">🕹️</span>
              <span class="hub-trophy-value">6</span>
              <span class="hub-trophy-label">ways to play</span>
            </div>
            <div class="hub-trophy" style="--i:4">
              <span class="hub-trophy-icon" aria-hidden="true">🏅</span>
              <span class="hub-trophy-value" data-trophy="career">—</span>
              <span class="hub-trophy-label">brawl career</span>
            </div>
          </div>
        </section>

        <!-- DAILY CONTRACT: one per calendar day, with progress, streak, rewards -->
        <section class="hub-daily" id="hub-daily" aria-label="Daily contract">
          <div class="hub-daily-copy">
            <span class="hub-daily-kicker">🎯 DAILY CONTRACT</span>
            <h3 class="hub-daily-title" id="daily-title">…</h3>
            <p class="hub-daily-desc" id="daily-desc">…</p>
            <div class="hub-daily-progress-wrap hidden" id="daily-progress-wrap">
              <div class="hub-daily-progress-track">
                <div class="hub-daily-progress-bar" id="daily-progress-bar"></div>
              </div>
              <span class="hub-daily-progress-text" id="daily-progress-text">0 / 1</span>
            </div>
            <div class="hub-daily-meta">
              <span class="hub-daily-streak hidden" id="daily-streak"></span>
              <span class="hub-daily-coins hidden" id="daily-total-coins"></span>
            </div>
          </div>
          <button class="btn big yellow hub-daily-cta" id="app-btn-daily" data-launch data-target="">TAKE THE CHALLENGE</button>
        </section>

        <!-- WHAT'S NEW: the hub's patch notes -->
        <section class="hub-news" aria-label="What's new">
          <h2 class="hub-section-title">📰 WHAT'S NEW</h2>
          <ul class="hub-news-list">
            <li><strong>Builder-first hub</strong> — the 3D creature lab is now the main event.</li>
            <li><strong>Autonomous colosseum</strong> — breed AI combat DNA, watch zero-input battles.</li>
            <li><strong>5-game arcade</strong> — derby, wall drop, brawl, defense, versus: pick your chaos.</li>
            <li><strong>Warfare command</strong> — abilities, artillery and supply drops in 100v100.</li>
          </ul>
        </section>

        <footer class="hub-footer">
          <button class="btn white" id="app-btn-offline">CUSTOM LOBBY</button>
          <button class="btn pink" id="app-btn-online">PLAY ONLINE</button>
          <button class="btn white" id="app-btn-how">HOW TO PLAY</button>
          <button class="btn blue" id="app-btn-settings">SETTINGS</button>
        </footer>
      </div>
    </section>`);

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
            ${seg('quality', 'Quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
            ${seg('reducedMotion', 'Reduced motion', [['false', 'Off'], ['true', 'On']])}
            <p class="app-note">Reduced motion turns off screen shake, hit-stop and confetti.</p>
            ${seg('colorblind', 'Colorblind', [['off', 'Off'], ['deuteranopia', 'Deuteranopia'], ['protanopia', 'Protanopia'], ['tritanopia', 'Tritanopia']])}
            <p class="app-note">Remaps colors to a colorblind-safe palette (Okabe-Ito). Adds shape badges to HUD cards.</p>
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
