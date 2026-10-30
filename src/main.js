// main.js — boots the renderer, builds the stadium and wires every system together.
import { recordMatch, careerSummaryHtml } from './app/career.js';
//
// Frame order: input/AI → Dweeb.preStep → physics (sub-stepped) → Dweeb.postStep →
//              impacts (sound/breakage) → combat → arena → match rules → fx/hud → render.
// Hit-stop scales simulation time (not rendering), so big hits freeze for a beat.

import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import '@fontsource/lilita-one';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/900.css';

import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { Arena, WATER_LEVEL, CORE_RADIUS, STAGE_RADIUS } from './world/Arena.js';
import { Dweeb } from './player/Dweeb.js';
import { Controller } from './player/Controller.js';
import { CameraController } from './camera/CameraController.js';
import { CombatSystem, DEFAULT_LOFT } from './combat/CombatSystem.js';
import { Bot } from './ai/Bot.js';
import { AudioManager } from './audio/AudioManager.js';
import { Match, Phase } from './game/Match.js';
import { EmoteSystem } from './game/Emotes.js';
import { DeathCinema } from './game/DeathCinema.js';
import { GAME_MODES, DEFAULT_MODE } from './game/GameModes.js';
import { ModeDirector } from './game/ModeDirector.js';
import { ARENAS, arenaById, DEFAULT_ARENA } from './game/Arenas.js';
import { Fx } from './game/Fx.js';
import { StatusSystem } from './game/StatusEffects.js';
import { Haptics } from './game/Haptics.js';
import { Hud } from './ui/Hud.js';
import { ComboDirector } from './game/ComboDirector.js';
import { Sky, Water } from './render/Sky.js';
import { Particles } from './render/Particles.js';
import { Trails, Bursts, Decals } from './render/Juice.js';
import { AimGuide } from './render/AimGuide.js';
import { warmModels } from './world/ObjectModels.js';
import { OBJECT_DEFS } from './world/ObjectRegistry.js';
import { PALETTE } from './render/Toon.js';
import { statsFor, BALANCE } from './game/Balance.js';
import { koLine, playerKOWord, winBanners } from './game/Announcer.js';
import { MutatorDirector } from './game/Mutators.js';
import { Meadowlands } from './world/Meadowlands.js';
import { Colony } from './adventure/colony.js';
import { QuestBoard } from './adventure/quests.js';
import { BuildingManager } from './adventure/building.js';
import { saveVillage, loadVillage, applySave } from './adventure/persistence.js';
import { EscapeSandbox } from './escape/EscapeSandbox.js';
import { HillZone } from './world/HillZone.js';
let hillZone = null;
import { MimicLab } from './mimic/MimicLab.js';
import { DweebWarfare } from './warfare/DweebWarfare.js';
import { BuildADweebLab } from './builder/BuildADweebLab.js';
import { BuildADweebHud } from './builder/BuildADweebHud.js';
import { buildCustomDweebModel, ARCHETYPE_PRESETS } from './builder/CustomDweebModel.js';
import { BuilderBot } from './ai/BuilderBot.js';
import { serverUrl } from './app/settings.js';
import { defaultUrl } from './net/NetClient.js';
import { recordMatch } from './app/daily.js';

const $ = id => document.getElementById(id);
const hex = c => '#' + c.toString(16).padStart(6, '0');

let lastBuilderPlayerConfig = null;
let lastBuilderOppType = 'random';

let currentMeadowlands = null;
let colony = null;
let questBoard = null; // Meadowlands NPC quests + Moss Tablet secrets
let buildingManager = null;
let currentEscapeSandbox = null;
let currentMimicLab = null;
let currentWarfare = null;
let currentBuildLab = null;
let currentBuildHud = null;
let builderBots = [];
let activeCitizenIdx = 0;
let isBuildToolbarOpen = false;
let villageSaveTimer = 0;
let currentGatherTarget = null;
let modeDirector = new ModeDirector();
const _modeCtx = {};

function updateCitizenRoleBadges(cit) {
  const curRole = cit?.role || '';
  document.querySelectorAll('.role-badge-btn').forEach(btn => {
    const r = btn.dataset.role || '';
    btn.classList.toggle('active', r === curRole);
  });
}

const ROSTER = [
  { name: 'Blorp', type: 'blob', color: PALETTE.pink },
  { name: 'Squish', type: 'spiky', color: PALETTE.blue },
  { name: 'Nugget', type: 'cube', color: PALETTE.green },
  { name: 'Wobbles', type: 'blob', color: PALETTE.purple },
  { name: 'Toast', type: 'cube', color: PALETTE.orange },
  { name: 'Pickle', type: 'spiky', color: PALETTE.teal },
  { name: 'Gumbo', type: 'blob', color: PALETTE.red },
];

// ─── Settings (persisted) ───
const DEFAULTS = { bots: '3', difficulty: 'normal', stocks: '3', music: 'on', sound: 'on', rumble: 'on', shake: 'full', type: 'cube', color: 'yellow', mode: 'derby', arena: DEFAULT_ARENA };
const settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('dweebs-settings') || '{}') };
if (!ARENAS.some(a => a.id === settings.arena)) settings.arena = DEFAULT_ARENA;
const saveSettings = () => localStorage.setItem('dweebs-settings', JSON.stringify(settings));

// ─── Globals ───
let renderer, effect, scene, camera, clock;
let haptics;
let physics, arena, sky, water, particles, audio, cam, combat, match, fx, hud, deathCinema = null;
let trails, bursts, decals, aimGuide;
let dweebs = [], bots = [], player = null, controller = null;
let emotes = null; // 1–6 quick emotes (game/Emotes.js)
let paused = false;
let onlineMatch = false; // set per match: an online lobby must never be paused locally
let impactBudget = 0;
let sdPhase = -1, potatoTimer = 0, currentMode = DEFAULT_MODE;
let spectateTarget = null;
let comboDirector = null; // hit chains / juggles / assists (game/ComboDirector.js)
let rematch = null;
let mutatorDirector = new MutatorDirector();
// Near-miss tease: track how close the player's current launch gets to a blast line / the lagoon
const nearMiss = { flying: false, min: Infinity, last: -99 };

// Sudden-death item bias for the final 10 s: the sky rains explosives
const FINALE_BIAS = { toyRocket: 5, explosiveBarrel: 5, giantHammer: 0.5, anvil: 0.5 };

// Loading screen: real progress per boot stage, with a little personality
const BOOT_T0 = performance.now();
async function loadStep(pct, text) {
  $('load-fill').style.width = pct + '%';
  $('load-status').textContent = text;
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); // let it paint before the next heavy step
}
async function hideLoading() {
  await loadStep(100, 'Emotions: unstable. Ready!');
  const wait = 1100 - (performance.now() - BOOT_T0); // long enough to read the logo, never a fake stall after that
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  const el = $('loading-screen');
  el.classList.add('fade-out');
  setTimeout(() => el.classList.add('hidden'), 450);
}

async function init() {
  await loadStep(8, 'Inflating Dweebs…');
  const canvas = $('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  effect = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultColor: [0.08, 0.05, 0.12] });

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbfe6ff, 70, 190);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
  clock = new THREE.Timer();

  // Lighting: warm sun + sky bounce
  scene.add(new THREE.HemisphereLight(0xdff3ff, 0x8a6a9a, 1.3));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  sun.position.set(18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  sky = new Sky(scene);
  water = new Water(scene, WATER_LEVEL);
  particles = new Particles(scene);

  await loadStep(25, 'Teaching cubes to feel…');
  physics = new PhysicsWorld();
  await physics.init();
  await loadStep(50, 'Untangling tentacles…');

  // Sticker textures are drawn with the game font, so wait for it before building any props
  try { await document.fonts.load('40px "Lilita One"'); } catch { /* fall back to Arial Black */ }
  await loadStep(62, 'Calibrating googly eyes…');
  warmModels(OBJECT_DEFS);
  await loadStep(80, 'Filling the lagoon…');
  arena = new Arena(scene, physics);
  arena.build();
  trails = new Trails(scene, camera);
  bursts = new Bursts(scene);
  decals = new Decals(scene, physics, arena);
  aimGuide = new AimGuide(scene, WATER_LEVEL);

  audio = new AudioManager();
  haptics = new Haptics();
  cam = new CameraController(camera, canvas);
  hud = new Hud($('hud'));
  fx = new Fx({ particles, audio, camera, cameraController: cam, hud, arena, bursts, decals, haptics });
  comboDirector = new ComboDirector({ hud, audio, particles });
  fx.combo = comboDirector;
  aimGuide.onLock = () => fx.aimLock();
  combat = new CombatSystem(physics, arena, fx);
  combat.status = new StatusSystem({ particles, decals, hud, audio });
  combat.status.combat = combat;
  match = new Match();
  emotes = new EmoteSystem({ hud, combat, arena, audio });
  deathCinema = new DeathCinema(camera, scene);
  match.events = matchEvents;

  arena.isOccupied = tileOccupied;
  arena.dweebs = dweebs;
  arena.onSegmentWarn = () => { if (match.running) audio.playWarning(); };
  // Crowd Claw: arcade claw that scoops dweebs (or a prize) from the stadium rafters
  arena.onClaw = (kind, data) => {
    if (!match.running) return;
    const pos = data?.pos;
    if (kind === 'warn') { audio.playWarning(); hud.feed('🕹️ THE CROWD CLAW DESCENDS!'); }
    else if (kind === 'grab' && data.d) {
      const d = data.d;
      if (d.held) combat.drop?.(d);
      audio.playGrab(fx._pan(pos));
      hud.popup(d.isPlayer ? 'CLAWED!' : 'SNATCHED!', d.getPosition(), 'big', 0xff384b);
      fx.voice?.(d, 'eep');
      if (d.isPlayer) cam.shake(0.12);
    } else if (kind === 'miss') { audio.playGrab(fx._pan(pos)); }
    else if (kind === 'drop' && data.d) { hud.popup('BOMBS AWAY!', pos, 'small', 0xffd23f); fx.voice?.(data.d, 'yeet'); }
    else if (kind === 'prize') { hud.popup('🎁 PRIZE!', pos, 'big', 0x5ee06a); fx.particles?.confetti?.(pos, 30); }
  };
  arena.onSegmentFall = seg => audio.playCrumble(fx._pan(seg.mesh.position));
  arena.onContraptionHit = (c, victim, cause) => {
    audio.playHammer?.();
    fx.hit(victim, null, 18, 'hazard');
    cam.shake(0.3);
    if (deathCinema) {
      deathCinema.captureDeath(victim, cause, null);
    }
  };
  arena.onPortalPowered = () => {
    hud.announce('ESCAPE PORTAL ACTIVATED! YOU WIN!', 'success', 3.0);
    audio.playTech(1);
    fx.cheer();
    match._endRound();
  };
  arena.onBump = (b, obj) => fx.bumper(obj.getPosition(), b.color, false);
  arena.onBounce = (t) => fx.bounce({ x: t.x, y: 0.25, z: t.z }, t.color);
  arena.onLavaHit = (d, launch) => fx.lavaHit(d, launch);
  arena.onCrustWarn = () => hud.feed('<b>VOLCANO</b> · the rim is cracking!', 'sd');
  arena.onGustWarn = dir => {
    hud.feed(`<b>SKY TURBINE</b> · gust inbound ${dir > 0 ? '→' : '←'}`, 'sd');
    audio.playWarning();
  };
  arena.onGust = () => {
    hud.feed('<b>GUST!</b> lean into it', 'style');
    audio.playWhoosh(0, 1);
    cam.shake(0.16);
  };
  arena.onObjectSplash = (obj, pos) => {
    if (obj.def) fx.splash(pos, false);
    else fx.splash(pos, true); // falling stage tile
  };

  cam.snapTo(0, 1, 0);

  // Occlusion-aware camera: raycast from look target to ideal camera position
  cam.setCollisionProbe((from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return null;
    const hit = physics.raycast(
      { x: from.x, y: from.y, z: from.z },
      { x: dx / len, y: dy / len, z: dz / len },
      len,
      player?.collider ?? null
    );
    // Only static world geometry (terrain, buildings, stage) pulls the camera in — not dweebs or props flying past
    const body = hit?.collider?.parent?.();
    if (!hit || (body && !body.isFixed())) return null;
    return hit.distance;
  });

  setupMenu();
  window.addEventListener('resize', onResize);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvas.addEventListener('click', (e) => {
    if (match.phase !== Phase.MENU && match.phase !== Phase.RESULTS && !paused) {
      if (!currentWarfare && currentMode !== 'build_arena' && !currentBuildLab) cam.lock();
    }
  });

  // ─── Visibility / focus / gamepad pause (offline matches only) ───
  function isOfflineMatchRunning() {
    // Online/warfare matches use currentWarfare; build lab and adventure are offline but
    // adventure doesn't use the brawler pause screen. Only pause the standard brawler match.
    return !onlineMatch && !currentWarfare &&
           !currentBuildLab &&
           !currentMeadowlands &&
           (match.phase === Phase.PLAYING || match.phase === Phase.COUNTDOWN);
  }

  function handlePauseTrigger() {
    if (!paused && isOfflineMatchRunning()) {
      setPaused(true);
      cam.unlock();
      if (audio?.ctx?.state === 'running') audio.ctx.suspend();
    }
  }

  function handleResumeAudio() {
    if (audio?.ctx?.state === 'suspended') audio.ctx.resume();
    // Never auto-resume gameplay — player must click Resume.
  }

  // Tab hidden / visible (emitted by runtime.js as dweebs:hidden / dweebs:visible)
  document.addEventListener('dweebs:hidden', handlePauseTrigger);
  document.addEventListener('dweebs:visible', handleResumeAudio);

  // Window blur / focus
  window.addEventListener('blur', handlePauseTrigger);
  window.addEventListener('focus', handleResumeAudio);

  // Gamepad disconnect
  window.addEventListener('gamepaddisconnected', handlePauseTrigger);

  await hideLoading();
  if (import.meta.env.DEV && location.hash === '#lineup') return showLineup();
  if (import.meta.env.DEV && location.hash.startsWith('#dweebs')) return showDweebLineup();
  // If app shell is present, don't show legacy main-menu automatically to avoid double-title overlay
  if (!document.getElementById('app-shell')) {
    $('main-menu').classList.remove('hidden');
  }
  renderer.setAnimationLoop(loop);
}

/** Dev only (#lineup): every prop model on a slow turntable, for art review screenshots. */
async function showLineup() {
  const { createModel } = await import('./world/ObjectModels.js');
  const stage = new THREE.Scene();
  stage.background = new THREE.Color(0xe8eef5);
  stage.add(new THREE.HemisphereLight(0xdff3ff, 0x8a6a9a, 1.3));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  sun.position.set(5, 10, 8);
  stage.add(sun);
  const keys = Object.keys(OBJECT_DEFS);
  const cols = 9, gap = 2;
  const spinners = keys.map((k, i) => {
    const g = new THREE.Group();
    const m = createModel(k, OBJECT_DEFS[k]);
    const s = 1.3 / Math.max(...OBJECT_DEFS[k].visualScale);
    g.scale.setScalar(Math.min(2.2, s));
    g.add(m);
    g.position.set((i % cols - (cols - 1) / 2) * gap, -Math.floor(i / cols) * gap * 0.9 + 3.6, 0);
    stage.add(g);
    return g;
  });
  const cam = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
  cam.position.set(0, 0.9, 20);
  cam.lookAt(0, 0, 0);
  renderer.setAnimationLoop(() => {
    const t = performance.now() / 1000;
    spinners.forEach((g, i) => { g.rotation.y = t * 0.6 + i; g.rotation.x = 0.25; });
    effect.render(stage, cam);
  });
}

// Dev: every type × expression (idle moods, gritting, screaming, knocked silly)
function showDweebLineup() {
  const stage = new THREE.Scene();
  stage.background = new THREE.Color(0xe8eef5);
  stage.add(new THREE.HemisphereLight(0xdff3ff, 0x8a6a9a, 1.3));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  sun.position.set(5, 10, 8);
  stage.add(sun);
  const types = ['cube', 'spiky', 'blob'];
  const colors = [PALETTE.yellow, 0xe0603a, PALETTE.blue];
  const states = ['grumpy', 'calm', 'smug', 'worried', 'grit', 'scream', 'ko'];
  const all = [];
  types.forEach((type, row) => states.forEach((st, col) => {
    const d = new Dweeb(stage, physics, { type, color: colors[row], index: col, position: { x: 0, y: -50, z: 0 } });
    d.grounded = true;
    d._pos = { x: (col - 3) * 1.5, y: (1 - row) * 1.6, z: 0 };
    d._state = st;
    all.push(d);
  }));
  const cam = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
  cam.position.set(0, 0.6, 13);
  cam.lookAt(0, 0.3, 0);
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), t = now / 1000, dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const d of all) {
      const st = d._state;
      d.moodTimer = 99; d.gloatTimer = 0;
      if (MOODS_DEV.includes(st)) d.idleMood = st;
      d.charging = st === 'grit' ? 0.8 : 0;
      d.hitstun = st === 'scream' ? 0.5 : 0;
      d.ragdolling = st === 'ko';
      d.body.setTranslation({ x: 0, y: -50, z: 0 }, false);
      d._animate(dt, t, d._pos);
      d.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(t * 0.8 + d.index) * 0.35 + (location.hash === '#dweebs-side' ? 0.9 : 0));
      d.shadow.visible = false;
    }
    effect.render(stage, cam);
  });
}
const MOODS_DEV = ['grumpy', 'calm', 'smug', 'worried'];

// ─── Menu ───

// ─── Quick Chaos + More drawer ───
// The lobby shows 5 modes / 7 arenas; GAME_MODES and ARENAS hold far more. Quick Chaos
// rolls a brawler mode and a compatible arena; MORE reveals everything else in-place.
const CHAOS_POOL = ['brawl', 'derby', 'hill', 'teams', 'sudden', 'walldrop'];

function quickChaos(syncArena) {
  audio.playUIClick();
  const mode = CHAOS_POOL[Math.floor(Math.random() * CHAOS_POOL.length)];
  const def = GAME_MODES[mode];
  const pool = (def?.arenas || [def?.arena || 'stadium']).filter(id => ARENAS.some(a => a.id === id));
  const arenaId = pool[Math.floor(Math.random() * pool.length)] || 'stadium';
  settings.mode = mode;
  settings.arena = arenaId;
  saveSettings();
  for (const seg of document.querySelectorAll('.seg[data-setting="mode"], .seg[data-setting="arena"]')) {
    const key = seg.dataset.setting;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === settings[key]));
  }
  syncArena?.();
  const a = arenaById(arenaId);
  const btn = $('btn-chaos');
  if (btn) btn.textContent = `🎲 ${def?.name || mode} @ ${a.icon} ${a.name}`;
  // A beat to read the roll, then go
  setTimeout(() => { startMatch(); if (btn) btn.textContent = '🎲 QUICK CHAOS'; }, 650);
}

function buildMoreDrawer() {
  const add = (seg, items) => {
    if (!seg || !items.length) return;
    const have = new Set([...seg.querySelectorAll('button')].map(b => b.dataset.v));
    const fresh = items.filter(i => !have.has(i.v));
    if (!fresh.length) return;
    for (const i of fresh) {
      const b = document.createElement('button');
      b.dataset.v = i.v; b.title = i.title || ''; b.textContent = i.label;
      b.classList.add('more-item'); b.style.display = 'none';
      b.classList.toggle('on', settings[seg.dataset.setting] === i.v);
      seg.appendChild(b);
    }
    const more = document.createElement('a');
    more.href = '#'; more.className = 'more-toggle';
    more.textContent = `+${fresh.length} MORE`;
    more.style.cssText = 'font-weight:900;font-size:13px;margin-left:6px;align-self:center;color:inherit;text-decoration:underline;cursor:pointer';
    more.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const open = more.dataset.open !== '1';
      more.dataset.open = open ? '1' : '0';
      seg.querySelectorAll('.more-item').forEach(b => { b.style.display = open ? '' : 'none'; });
      more.textContent = open ? 'LESS' : `+${fresh.length} MORE`;
      audio.playUIClick();
    });
    seg.appendChild(more);
  };
  const modeLabels = { hill: '👑 King of the Hill', teams: '🤝 Teams', sudden: '💀 Sudden Death', escape: '🏝️ Escape', mimic: '🎭 Mimic' };
  add(document.querySelector('.seg[data-setting="mode"]'),
    ['hill', 'teams', 'sudden'].filter(id => GAME_MODES[id]).map(id => ({ v: id, label: modeLabels[id] || GAME_MODES[id].name, title: GAME_MODES[id].tagline })));
  add(document.querySelector('.seg[data-setting="arena"]'),
    ARENAS.map(a => ({ v: a.id, label: `${a.icon || ''} ${a.name}`.trim(), title: a.blurb })));
}

function setupMenu() {
  const unlockAudio = () => { audio.init(); audio.resume(); applyAudioSettings(); };
  document.addEventListener('pointerdown', unlockAudio, { once: false });

  for (const seg of document.querySelectorAll('.seg')) {
    const key = seg.dataset.setting;
    const sync = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === settings[key]));
    seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      settings[key] = b.dataset.v;
      saveSettings();
      sync();
      applyAudioSettings();
      syncBlurb();
      syncArena();
      audio.playUIClick();
    });
    sync();
  }
  const syncBlurb = () => {
    const st = statsFor(settings.type);
    $('type-blurb').textContent = `${st.label}: ${st.blurb}`;
  };
  syncBlurb();
  const syncArena = () => {
    const a = arenaById(settings.arena);
    $('arena-blurb').textContent = `${a.name} — ${a.blurb}`;
  };
  syncArena();
  for (const b of document.querySelectorAll('.btn')) b.addEventListener('mouseenter', () => audio.playUIHover());

  $('btn-play').onclick = () => { audio.playUIClick(); startMatch(); };
  $('btn-chaos')?.addEventListener('click', () => quickChaos(syncArena));
  buildMoreDrawer();
  $('btn-how').onclick = () => { audio.playUIClick(); $('how-to-play').classList.remove('hidden'); };
  $('btn-close-help').onclick = () => { audio.playUIClick(); $('how-to-play').classList.add('hidden'); };
  $('btn-resume').onclick = () => { audio.playUIClick(); setPaused(false); cam.lock(); };
  $('btn-quit').onclick = () => { audio.playUIClick(); setPaused(false); toMenu(); };
  $('btn-play-again').onclick = () => { audio.playUIClick(); if (rematch && !rematch.done) voteRematch(); else startMatch(); };
  $('btn-main-menu').onclick = () => { audio.playUIClick(); toMenu(); };

  const toggleSwitcher = () => {
    audio.playUIClick();
    const modal = $('game-switcher-modal');
    if (!modal) return;
    const isHidden = modal.classList.contains('hidden');
    if (isHidden) {
      setPaused(true);
      cam.unlock();
      modal.classList.remove('hidden');
    } else {
      modal.classList.add('hidden');
      if (paused) setPaused(false);
      cam.lock();
    }
  };

  $('btn-pause-switcher')?.addEventListener('click', () => {
    toggleSwitcher();
  });
  const returnToMall = () => {
    audio.playUIClick();
    setPaused(false);
    clearRematch();
    hideSpectatorOverlay();
    toMenu();
    $('main-menu')?.classList.add('hidden');
    $('game-switcher-modal')?.classList.add('hidden');
    if (window.__dweebsApp?.router) {
      window.__dweebsApp.router.setMatchLock(false);
      window.__dweebsApp.router.go('/');
    } else {
      location.hash = '#/';
    }
  };

  $('btn-pause-mall')?.addEventListener('click', returnToMall);
  $('btn-results-mall')?.addEventListener('click', returnToMall);
  $('btn-build-rematch')?.addEventListener('click', () => {
    audio.playUIClick();
    $('results-screen')?.classList.add('hidden');
    if (lastBuilderPlayerConfig) {
      launchBuilderArena(lastBuilderPlayerConfig, lastBuilderOppType);
    } else {
      startBuildLab();
    }
  });
  $('btn-build-workshop')?.addEventListener('click', () => {
    audio.playUIClick();
    $('results-screen')?.classList.add('hidden');
    startBuildLab();
  });
  $('btn-close-switcher')?.addEventListener('click', () => {
    audio.playUIClick();
    $('game-switcher-modal')?.classList.add('hidden');
  });
  $('btn-switcher-to-mall')?.addEventListener('click', returnToMall);
  $('btn-back-to-mall')?.addEventListener('click', returnToMall);
  $('hud-switcher-btn')?.addEventListener('click', () => {
    toggleSwitcher();
  });

  for (const btn of document.querySelectorAll('.switcher-btn')) {
    btn.addEventListener('click', () => {
      audio.playUIClick();
      const mode = btn.dataset.mode;
      const arena = btn.dataset.arena;
      const sub = btn.dataset.sub;
      $('game-switcher-modal')?.classList.add('hidden');
      setPaused(false);
      window.__dweebsLaunch = { mode, arena, submode: sub };
      if (mode === 'warfare') {
        startWarfare(sub || 'defense');
      } else {
        startMatch();
      }
    });
  }

  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyM') {
      toggleSwitcher();
      e.preventDefault();
    }
  });

  // Spectator cam: while you're out, left/right cycles the remaining brawlers.
  window.addEventListener('keydown', e => {
    if (match.phase !== Phase.PLAYING || !player || player.active) return;
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    const alive = dweebs.filter(d => d.active && !d.eliminated);
    if (!alive.length) return;
    const i = alive.indexOf(spectateTarget);
    spectateTarget = alive[(i + (e.code === 'ArrowRight' ? 1 : alive.length - 1)) % alive.length];
    e.preventDefault();
  });
}

function applyAudioSettings() {
  audio.setEnabled(settings.sound === 'on');
  audio.setMusicEnabled(settings.music === 'on');
  haptics?.setEnabled(settings.rumble !== 'off');
  cam?.setShakeScale(settings.shake === 'off' ? 0 : settings.shake === 'low' ? 0.42 : 1);
}

function toMenu() {
  if (currentMeadowlands) {
    if (colony && buildingManager) saveVillage({ colony, buildingManager, world: currentMeadowlands });
    (questBoard?.dispose(), questBoard = null, currentMeadowlands.dispose());
    currentMeadowlands = null;
  }
  if (buildingManager) {
    buildingManager.cancelPlacing();
    buildingManager = null;
  }
  colony = null;
  if (hillZone) { hillZone.dispose(); hillZone = null; }
  audio.stopAmbience?.();
  if (currentWarfare) { currentWarfare.dispose(); currentWarfare = null; document.body.classList.remove('warfare-active'); }
  if (currentBuildLab) { currentBuildLab.dispose(); currentBuildLab = null; }
  if (currentBuildHud) { currentBuildHud.dispose(); currentBuildHud = null; }
  match.phase = Phase.MENU;
  clearRematch();
  spectateTarget = null;
  arena.hazardsActive = false;
  controller && (controller.enabled = false);
  resetSuddenDeathFx();
  try { mutatorDirector.end(mutatorCtx()); } catch (e) { console.error('[Mutator] end error:', e); }
  cam.unlock();
  audio.stopMusic();
  audio.setCharge(0);
  hud.setSpectator('');
  hideSpectatorOverlay();
  try { modeDirector.reset(); } catch (e) { console.warn('[ModeDirector] reset error:', e); }
  for (const id of ['hud', 'results-screen', 'round-screen', 'pause-screen', 'game-switcher-modal', 'civ-hud', 'spectator-duel-overlay']) $(id)?.classList.add('hidden');
  $('main-menu').classList.remove('hidden');
}

// ─── Match flow ───

function clearDweebs() {
  controller?.destroy();
  controller = null;
  for (const d of dweebs) d.destroy();
  dweebs = [];
  bots = [];
  builderBots = [];
  player = null;
}

/** Game 5: Dweeb Warfare. Takes over the scene with its own board, sim, HUD and audio. */
function startWarfare(submode = 'defense') {
  clearRematch();
  clearDweebs();
  match.phase = Phase.MENU;
  arena.hazardsActive = false;
  spectateTarget = null;
  if (arena.setStadiumVisible) arena.setStadiumVisible(false);
  for (const o of arena.objects || []) if (o.mesh) o.mesh.visible = false;
  if (currentMeadowlands) { (questBoard?.dispose(), questBoard = null, currentMeadowlands.dispose()); currentMeadowlands = null; }
  if (currentEscapeSandbox) { currentEscapeSandbox.dispose(); currentEscapeSandbox = null; }
  if (currentMimicLab) { currentMimicLab.dispose(); currentMimicLab = null; }
  if (buildingManager) { buildingManager.cancelPlacing(); buildingManager = null; }
  colony = null;
  if (currentWarfare) currentWarfare.dispose();
  cam.unlock();
  currentMode = 'warfare';
  currentWarfare = new DweebWarfare({ scene, camera, canvas: renderer.domElement, onExit: exitWarfare, soundOn: settings.sound !== 'off', serverUrl: serverUrl() || defaultUrl(location.search) });
  if (submode === 'versus' || submode === 'defense') {
    currentWarfare.start(submode);
  }
  for (const id of ['main-menu', 'results-screen', 'how-to-play', 'round-screen', 'pause-screen', 'civ-hud', 'game-switcher-modal']) $(id)?.classList.add('hidden');
  $('hud').classList.remove('hidden'); // tells the app shell a game is live
  audio.init();
  audio.resume();
  applyAudioSettings();
  audio.stopMusic();
}

function exitWarfare() {
  toMenu();
  if (arena.setStadiumVisible) arena.setStadiumVisible(true);
  for (const o of arena.objects || []) if (o.mesh) o.mesh.visible = true;
  setTimeout(() => { location.hash = '#/'; }, 0);
}

function applyCustomDweebToBrawler(dweeb, config) {
  const custom = buildCustomDweebModel(config);
  dweeb.customModel = custom;
  for (const c of dweeb.rig.children) {
    if (c !== dweeb.playerRing && c !== dweeb.bubbleMesh && c !== dweeb.freezeMesh && c !== dweeb.parryMesh) {
      c.visible = false;
    }
  }
  dweeb.rig.add(custom.root);
  custom.root.traverse(child => {
    if (child.isMesh && child.material && !dweeb.flashMats.includes(child.material)) {
      dweeb.flashMats.push(child.material);
    }
  });
  if (config.stats) {
    if (config.stats.speed) dweeb.stats.speed *= config.stats.speed;
    if (config.stats.jump) dweeb.stats.jump *= config.stats.jump;
    if (config.stats.mass) {
      dweeb.stats.mass = config.stats.mass;
      dweeb.collider?.setMass?.(config.stats.mass);
    }
  }
  if (config.name) dweeb.name = config.name;
  return custom;
}

function getArchetypeBadge(config = {}) {
  if (config.badge) return config.badge.startsWith('[') ? config.badge : `[${config.badge}]`;
  for (const preset of Object.values(ARCHETYPE_PRESETS || {})) {
    if (preset.name && preset.name.toLowerCase() === (config.name || '').toLowerCase()) {
      return `[${preset.badge}]`;
    }
  }
  if (config.shape === 'chonk') return '[🦏 TITAN CHONK]';
  if (config.shape === 'spiky') return '[⚡ SPEED GREMLIN]';
  if (config.shape === 'capsule') return '[🎯 SNIPER BEAN]';
  if (config.appendage === 'boxing_gloves' || config.appendages === 'boxing_gloves') return '[🥊 PUGILIST CHAMP]';
  return '[🧬 CUSTOM DWEEB]';
}

function formatDnaTags(dna = {}) {
  const conf = dna.confidence ?? 0.8;
  const stance = conf > 0.65 ? 'Stance: Rushdown 🔥' : conf < 0.4 ? 'Stance: Kiter 🌀' : 'Stance: Balanced ⚔️';

  const aim = dna.aimAccuracy ?? 0.7;
  const aimStr = aim > 0.6 ? 'Aim: Sniper 🎯' : 'Aim: Chaos 🎯';

  const agi = dna.agility ?? 0.7;
  const agiStr = agi > 0.7 ? 'Agility: Hyper ⚡' : 'Agility: Heavy ⚡';

  const scav = dna.scavenge ?? 0.6;
  const scavStr = scav > 0.5 ? 'Scavenge: Toy Hunter 🎁' : 'Scavenge: Fists 🎁';

  return [stance, aimStr, agiStr, scavStr];
}

function showSpectatorOverlay(playerConfig, oppConfig) {
  const overlay = $('spectator-duel-overlay');
  if (!overlay) return;

  const p1Name = $('sdo-p1-name');
  if (p1Name) p1Name.textContent = playerConfig.name || 'Your Dweeb';

  const p1Badge = $('sdo-p1-badge');
  if (p1Badge) p1Badge.textContent = getArchetypeBadge(playerConfig);

  const p1Tags = $('sdo-p1-tags');
  if (p1Tags) {
    const tags = formatDnaTags(playerConfig.dna || playerConfig.DNA || {});
    p1Tags.innerHTML = tags.map(t => `<span class="sdo-tag">${t}</span>`).join('');
  }

  const p2Name = $('sdo-p2-name');
  if (p2Name) p2Name.textContent = oppConfig.name || 'Rival Bot';

  const p2Badge = $('sdo-p2-badge');
  if (p2Badge) p2Badge.textContent = getArchetypeBadge(oppConfig);

  const p2Tags = $('sdo-p2-tags');
  if (p2Tags) {
    const tags = formatDnaTags(oppConfig.dna || oppConfig.DNA || {});
    p2Tags.innerHTML = tags.map(t => `<span class="sdo-tag">${t}</span>`).join('');
  }

  overlay.classList.remove('hidden');
}

function hideSpectatorOverlay() {
  const overlay = $('spectator-duel-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function generateOpponentConfig(playerConfig, oppType = 'random') {
  if (oppType === 'mirror') {
    return {
      ...playerConfig,
      name: `Anti-${playerConfig.name || 'Dweeb'}`,
      badge: '🤖 MIRROR RIVAL',
      primaryColor: '#2b1b3d',
      accentColor: '#ff2a5f',
      dna: {
        confidence: 0.9,
        aimAccuracy: playerConfig.dna?.aimAccuracy ?? 0.75,
        scavenge: playerConfig.dna?.scavenge ?? 0.6,
        agility: playerConfig.dna?.agility ?? 0.8,
      },
    };
  }
  if (oppType === 'juggernaut' && ARCHETYPE_PRESETS?.titan_chonk) {
    return { ...ARCHETYPE_PRESETS.titan_chonk };
  }
  if (oppType === 'gremlin' && ARCHETYPE_PRESETS?.speed_gremlin) {
    return { ...ARCHETYPE_PRESETS.speed_gremlin };
  }
  if (oppType === 'sniper' && ARCHETYPE_PRESETS?.sniper_bean) {
    return { ...ARCHETYPE_PRESETS.sniper_bean };
  }
  if (oppType === 'pugilist' && ARCHETYPE_PRESETS?.pugilist_champ) {
    return { ...ARCHETYPE_PRESETS.pugilist_champ };
  }
  // 'random' (mutant)
  const dummyScene = new THREE.Scene();
  const lab = new BuildADweebLab(dummyScene, null, null);
  const cfg = lab.mutateRandom();
  lab.dispose();
  cfg.badge = '👾 RANDOM MUTANT';
  return cfg;
}

function startBuildLab() {
  hideSpectatorOverlay();
  clearRematch();
  clearDweebs();
  match.phase = Phase.MENU;
  arena.hazardsActive = false;
  spectateTarget = null;
  if (arena.setStadiumVisible) arena.setStadiumVisible(false);
  for (const o of arena.objects || []) if (o.mesh) o.mesh.visible = false;
  if (currentMeadowlands) { (questBoard?.dispose(), questBoard = null, currentMeadowlands.dispose()); currentMeadowlands = null; }
  if (currentEscapeSandbox) { currentEscapeSandbox.dispose(); currentEscapeSandbox = null; }
  if (currentMimicLab) { currentMimicLab.dispose(); currentMimicLab = null; }
  if (buildingManager) { buildingManager.cancelPlacing(); buildingManager = null; }
  colony = null;
  if (currentWarfare) { currentWarfare.dispose(); currentWarfare = null; }
  if (currentBuildLab) { currentBuildLab.dispose(); currentBuildLab = null; }
  if (currentBuildHud) { currentBuildHud.dispose(); currentBuildHud = null; }

  cam.unlock();
  currentMode = 'build';

  for (const id of ['main-menu', 'results-screen', 'how-to-play', 'round-screen', 'pause-screen', 'civ-hud', 'game-switcher-modal', 'hud', 'spectator-duel-overlay']) {
    $(id)?.classList.add('hidden');
  }

  currentBuildLab = new BuildADweebLab(scene, camera, renderer);
  currentBuildHud = new BuildADweebHud(document.body, {
    onChange: patch => currentBuildLab?.updateConfig(patch),
    onConfigChange: patch => currentBuildLab?.updateConfig(patch),
    onPresetSelect: presetKey => {
      if (!currentBuildLab || !currentBuildHud) return;
      const cfg = currentBuildLab.applyPreset(presetKey);
      if (cfg) currentBuildHud.syncForm(cfg);
    },
    onRandomMutant: () => {
      if (!currentBuildLab || !currentBuildHud) return;
      const cfg = currentBuildLab.mutateRandom();
      currentBuildHud.syncForm(cfg);
    },
    onExit: exitBuildLab,
    onLaunchArena: oppType => {
      if (!currentBuildLab) return;
      launchBuilderArena(currentBuildLab.config, oppType);
    },
  });

  currentBuildHud.syncForm(currentBuildLab.config);
  currentBuildHud.show();

  camera.position.set(0, 1.1, 2.8);
  camera.lookAt(0, 0.45, 0);

  audio.init();
  audio.resume();
  applyAudioSettings();
  audio.stopMusic();
}

function exitBuildLab() {
  hideSpectatorOverlay();
  if (currentBuildLab) { currentBuildLab.dispose(); currentBuildLab = null; }
  if (currentBuildHud) { currentBuildHud.dispose(); currentBuildHud = null; }
  toMenu();
  if (arena.setStadiumVisible) arena.setStadiumVisible(true);
  for (const o of arena.objects || []) if (o.mesh) o.mesh.visible = true;
  setTimeout(() => { location.hash = '#/'; }, 0);
}

function launchBuilderArena(playerConfig, oppType = 'random') {
  lastBuilderPlayerConfig = playerConfig;
  lastBuilderOppType = oppType;

  if (currentBuildLab) { currentBuildLab.dispose(); currentBuildLab = null; }
  if (currentBuildHud) { currentBuildHud.dispose(); currentBuildHud = null; }

  clearRematch();
  clearDweebs();

  arena.setArena('stadium');
  arena.reset();
  if (arena.setStadiumVisible) arena.setStadiumVisible(true);
  for (const o of arena.objects || []) if (o.mesh) o.mesh.visible = true;
  arena.hazardsActive = true;
  spectateTarget = null;
  currentMode = 'build_arena';

  for (const id of ['game-switcher-modal', 'pause-screen', 'main-menu', 'results-screen']) $(id)?.classList.add('hidden');
  $('hud').classList.remove('hidden');

  const spawn0 = arena.getSpawnPoint(0, 2);
  player = new Dweeb(scene, physics, {
    isPlayer: true,
    name: playerConfig.name || 'Your Dweeb',
    type: playerConfig.shape || 'blob',
    color: 0xffffff,
    index: 0,
    position: spawn0,
  });
  dweebs.push(player);
  wireDweeb(player);
  applyCustomDweebToBrawler(player, playerConfig);

  const oppConfig = generateOpponentConfig(playerConfig, oppType);
  const spawn1 = arena.getSpawnPoint(1, 2);
  const oppDweeb = new Dweeb(scene, physics, {
    isPlayer: false,
    name: oppConfig.name || 'Rival Bot',
    type: oppConfig.shape || 'cube',
    color: 0xffffff,
    index: 1,
    position: spawn1,
  });
  dweebs.push(oppDweeb);
  wireDweeb(oppDweeb);
  applyCustomDweebToBrawler(oppDweeb, oppConfig);

  builderBots = [
    new BuilderBot(player, arena, combat, playerConfig.dna),
    new BuilderBot(oppDweeb, arena, combat, oppConfig.dna),
  ];

  controller = new Controller(player, cam, combat);
  controller.enabled = false;

  combat.status?.setDweebs(dweebs);
  combat.setDweebs(dweebs);
  fx.reactions?.setDweebs(dweebs);
  arena.dweebs = dweebs;
  hud.setup(dweebs);

  match.settings.stocks = 3;
  match.settings.mode = 'build_arena';
  match.startMatch(dweebs);

  cam.unlock();
  cam.snapTo(0, 2, 9);
  hud.setSuddenDeath('🤖 100% AUTONOMOUS AI ARENA DUEL 🤖');
  setTimeout(() => { if (match.running) hud.setSuddenDeath(''); }, 3500);

  showSpectatorOverlay(playerConfig, oppConfig);

  audio.init();
  audio.resume();
  applyAudioSettings();
}

function startMatch() {
  const launch = window.__dweebsLaunch;
  window.__dweebsLaunch = null;
  if (launch?.mode && GAME_MODES[launch.mode]) settings.mode = launch.mode;
  if (launch?.arena && ARENAS.some(a => a.id === launch.arena)) settings.arena = launch.arena;
  for (const id of ['game-switcher-modal', 'pause-screen']) $(id)?.classList.add('hidden');
  if ((settings.mode || 'derby') === 'build') return startBuildLab();
  if ((settings.mode || 'derby') === 'warfare') return startWarfare(launch?.submode || 'defense');
  if (currentWarfare) {
    currentWarfare.dispose();
    currentWarfare = null;
    document.body.classList.remove('warfare-active');
  }
  if (currentBuildLab) {
    currentBuildLab.dispose();
    currentBuildLab = null;
  }
  if (currentBuildHud) {
    currentBuildHud.dispose();
    currentBuildHud = null;
  }
  hideSpectatorOverlay();
  clearRematch();
  clearDweebs();
  arena.setArena(settings.arena);
  arena.reset();
  arena.hazardsActive = false;
  spectateTarget = null;

  // An online lobby hands over its own bot rule for this one match (see legacy.js).
  const override = window.__dweebsMatchOverride;
  window.__dweebsMatchOverride = null;
  onlineMatch = !!override;
  const botCount = Math.min(ROSTER.length, override ? override.bots : +settings.bots);
  const total = botCount + 1;
  const myColor = PALETTE[settings.color] ?? PALETTE.yellow;
  player = new Dweeb(scene, physics, { isPlayer: true, name: 'You', type: settings.type, color: myColor, index: 0, position: arena.getSpawnPoint(0, total) });
  dweebs.push(player);
  for (let i = 0; i < botCount; i++) {
    // A bot wearing the player's colour swaps into the yellow the player gave up
    const r = ROSTER[i].color === myColor ? { ...ROSTER[i], color: PALETTE.yellow } : ROSTER[i];
    const d = new Dweeb(scene, physics, { ...r, index: i + 1, position: arena.getSpawnPoint(i + 1, total) });
    dweebs.push(d);
    bots.push(new Bot(d, arena, combat, settings.difficulty));
  }
  for (const d of dweebs) wireDweeb(d);

  controller = new Controller(player, cam, combat);
  combat.status?.setDweebs(dweebs);
  combat.setDweebs(dweebs);
  fx.reactions?.setDweebs(dweebs);
  // clearDweebs() swaps in a fresh array, so the arena's hazard lists must be re-pointed at it
  // (lava, conveyors, contraptions and wind all iterate arena.dweebs).
  arena.dweebs = dweebs;
  if (import.meta.env.DEV) window.__dweebs = { physics, arena, combat, match, audio, player, dweebs, fx, cam, camera, trails, bursts, decals, bots, renderer, controller, aimGuide };
  if (import.meta.env.DEV) Object.defineProperty(window.__dweebs, 'quests', { get: () => questBoard, configurable: true });
  fx.player = player;
  hud.setup(dweebs);

  currentMode = settings.mode || 'derby';
  match.settings.stocks = (GAME_MODES[currentMode]?.stocks ?? +settings.stocks);
  match.settings.mode = currentMode;
  match.startMatch(dweebs);

  // ── Mode Initialization (Knockout Arena vs Expedition & Dynasty) ──
  const isAdventure = (currentMode === 'adventure') || (settings.arena === 'meadowlands');

  if (isAdventure) {
    if (arena.setStadiumVisible) arena.setStadiumVisible(false);
    if (currentWarfare) { currentWarfare.dispose(); currentWarfare = null; }
    if (currentMeadowlands) (questBoard?.dispose(), questBoard = null, currentMeadowlands.dispose());
    currentMeadowlands = new Meadowlands(physics, scene, { fx });
    colony = new Colony();
    bots = []; // Citizens are autonomous and peaceful; no brawler AI in adventure
    for (const d of dweebs) {
      if (!d.isPlayer) colony.addCitizen(d);
    }
    // Spawn player in village clearing at campfire
    if (player && player.body) {
      player.body.setTranslation({ x: 0, y: 1.2, z: 2 }, true);
      player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    // Spawn citizens near campfire
    for (let i = 0; i < colony.citizens.length; i++) {
      const c = colony.citizens[i];
      const ang = (i / Math.max(1, colony.citizens.length)) * Math.PI * 2;
      if (c.dweeb && c.dweeb.body) {
        c.dweeb.body.setTranslation({ x: Math.cos(ang) * 4, y: 1.2, z: Math.sin(ang) * 4 }, true);
        c.dweeb.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    cam.setMode('explorer');
    buildingManager = new BuildingManager(scene, physics, { fx });
    currentMeadowlands.buildingManager = buildingManager;
    currentMeadowlands.onStructureRepaired = (s) => colony._addLog(`🔧 ${s.name} is all patched up!`);
    $('civ-hud')?.classList.remove('hidden');
    $('hud-top')?.classList.add('hidden');
    $('hud-cards')?.classList.add('hidden');
    wireCivCameraControls();
    // Restore the saved village (if any): citizens, structures, resources, vaults.
    const savedVillage = loadVillage();
    if (savedVillage) {
      const restored = applySave(savedVillage, { colony, buildingManager, world: currentMeadowlands });
      colony._addLog(`📂 Welcome back! Restored ${restored.citizens} citizens and ${restored.structures} structures.`);
    }
    try { questBoard = new QuestBoard({ world: currentMeadowlands, colony, hud, audio, buildingManager }); } catch (e) { console.warn('[quests]', e); questBoard = null; }

    for (const id of ['main-menu', 'results-screen', 'round-screen', 'how-to-play']) $(id)?.classList.add('hidden');
    $('hud')?.classList.remove('hidden');
    audio.init();
    audio.resume();
    applyAudioSettings();
    audio.startAmbience();
    audio.startMusic(false);
    controller.enabled = true;
    match.phase = Phase.PLAYING;
    // (was `match.running = false`, but `running` is a getter: in a module that assignment threw and
    // aborted the rest of adventure setup. Behaviour is unchanged — the phase above already decides it.)
    hud.clearTransient();
    trails.clear();
    bursts.clear();
    decals.clear();
    return;
  } else {
    if (arena.setStadiumVisible) arena.setStadiumVisible(true);
    if (currentWarfare) { currentWarfare.dispose(); currentWarfare = null; }
    if (currentMeadowlands) {
      // Save the village before tearing it down.
      if (colony && buildingManager) saveVillage({ colony, buildingManager, world: currentMeadowlands });
      (questBoard?.dispose(), questBoard = null, currentMeadowlands.dispose());
      currentMeadowlands = null;
    }
    if (buildingManager) {
      buildingManager.cancelPlacing();
      buildingManager = null;
    }
    colony = null;
    $('civ-hud')?.classList.add('hidden');
    $('hud-top')?.classList.remove('hidden');
    $('hud-cards')?.classList.remove('hidden');
  }

  for (const id of ['main-menu', 'results-screen', 'round-screen', 'how-to-play']) $(id)?.classList.add('hidden');
  $('hud').classList.remove('hidden');
  audio.init();
  audio.resume();
  applyAudioSettings();
  audio.startAmbience();
  audio.startMusic(false);
  startRound();
  cam.lock();
}

// Build ctx for mutators: { physics, arena, dweebs, hud, combat, time, match }
// One persistent ctx: mutators keep their timers on it between frames.
const _mutatorCtx = {};
function mutatorCtx() {
  return Object.assign(_mutatorCtx, { physics, arena, dweebs, hud, combat, time: match?.time ?? 0, match });
}

function startRound() {
  const modeDef = GAME_MODES[currentMode] || GAME_MODES.derby;
  // Undo last round's mutator before the round reset re-applies arena stats.
  try { mutatorDirector.end(mutatorCtx()); } catch (e) { console.error('[Mutator] end error:', e); }
  if (arena.dropWall) {
    if (modeDef.hasWallDrop) {
      arena.dropWall.dropped = false;
      arena.dropWall.curY = 7.0;
      arena.dropWall.group.position.y = 7.0;
      arena.dropWall.group.visible = true;
    } else {
      arena.dropWall.group.visible = false;
      arena.dropWall.body.setNextKinematicTranslation({ x: 0, y: -20, z: 0 });
    }
  }

  arena.hazardsActive = false;
  arena.reset();
  combat.status?.clear();
  resetSuddenDeathFx();
  comboDirector?.reset?.();
  hud.clearTransient();
  trails.clear();
  bursts.clear();
  decals.clear();
  $('round-screen').classList.add('hidden');

  // King of the Hill: draw the zone + race board, and point the bots at it
  if (hillZone) { hillZone.dispose(); hillZone = null; }
  if (modeDef.isHill) hillZone = new HillZone(scene, BALANCE.hill);
  for (const b of bots) b.hill = modeDef.isHill ? { x: 0, z: 0, r: BALANCE.hill.radius } : null;

  // Spawn batteries if in escape mode
  // Spawn arcing cannons and bouncy melons in Wall Drop mode
  if (modeDef.hasWallDrop) {
    // Team West (Pink side)
    arena.spawnItem('melonCannon', { x: -7, y: 2, z: -3 });
    arena.spawnItem('explodingMelon', { x: -6, y: 2, z: 2 });
    arena.spawnItem('spikyBall', { x: -8, y: 2, z: 0 });
    // Team East (Cyan side)
    arena.spawnItem('melonCannon', { x: 7, y: 2, z: 3 });
    arena.spawnItem('explodingMelon', { x: 6, y: 2, z: -2 });
    arena.spawnItem('spikyBall', { x: 8, y: 2, z: 0 });
  }

  if (modeDef.hasEscapePuzzles) {
    arena.spawnItem('powerBattery', { x: 8, y: 3, z: -4 });
    arena.spawnItem('powerBattery', { x: 8, y: 3, z: 4 });
  }

  const total = dweebs.length;
  dweebs.forEach((d, i) => {
    const p = arena.getSpawnPoint(i, total, currentMode);
    d.eliminated = false;
    // Stage physics belongs to the arena: the Moonbase is lighter, the Iceberg slicker.
    d.gravityScale = arena.gravity;
    d.jumpScale = arena.gravity < 1 ? 0.72 + arena.gravity * 0.28 : 1;
    d.respawn(p, 0);
    d.held = null;
    d.yaw = Math.atan2(-p.x, -p.z);
    // Arena floor feel: the Iceberg's traction lives on the stage, not the Dweeb.
    d.traction = arena.traction;
    d.slide = arena.slide;
    if (modeDef.hasWallDrop) {
      // Set team indicator color: even index = Team Pink, odd index = Team Cyan
      d.team = i % 2 === 0 ? 'pink' : 'cyan';
      d.teamColor = i % 2 === 0 ? 0xff4d5e : 0x3fa9ff;
    }
  });
  match.beginRound();
  // Pick and begin round mutator (brawl-like modes only)
  try {
    const def = mutatorDirector.pick(currentMode);
    mutatorDirector.begin(def, mutatorCtx());
    if (def) { hud.announce(def.name, 'mutator', 2.4); hud.feed?.(`MUTATOR · ${def.blurb}`); }
  } catch (e) { console.error('[Mutator] startRound error:', e); }
  hud.setRound(match.round, winsHtml());
  controller.enabled = false;
  if (match.round === 1 && !currentMeadowlands) hud.feed('<b>EMOTES</b> · 1 Taunt · 2 Cheer · 3 Dance · 4 Sweat · 5 GG · 6 Flex');
  cam.targetDistance = 9;
  cam.pitch = -0.42;
  const pp = player.getPosition();
  cam.yaw = Math.atan2(-pp.x, -pp.z) + Math.PI;
  cam.snapTo(pp.x, pp.y, pp.z);
  audio.startMusic(false);
  try { modeDirector.start(currentMode); } catch (e) { console.warn('[ModeDirector] start error:', e); }
}

function winsHtml() {
  const w = match.roundWins.get(player) || 0;
  return w ? '★'.repeat(w) : '';
}

const nameOf = d => (d.isPlayer ? 'YOU' : d.name);

const matchEvents = {
  onCountdown(n) {
    hud.announce(String(n), '', 0.9);
    audio.playCountdown(false);
  },
  onGo() {
    const modeDef = GAME_MODES[currentMode] || GAME_MODES.derby;
    arena.hazardsActive = true;
    arena.clawEnabled = ['brawl', 'teams', 'sudden', 'hill'].includes(currentMode) && !window.__dweebsMatchOverride;
    if (!arena.clawEnabled) arena.claw?.reset();
    if (modeDef.hasWallDrop && arena) {
      arena.dropTheWall();
      hud.announce('WALL DROPPED! FIGHT!', 'danger', 1.8);
      audio.playWarning();
    }
    hud.announce('BRAWL!', 'go', 0.8);
    audio.playCountdown(true);
    audio.playCheer(0.8);
    arena.excite(0.8);
    if (currentMode !== 'build_arena') {
      controller.enabled = true;
    }
  },
  onSuddenDeath() {
    arena.startSuddenDeath(match.settings.suddenDeathAt);
    sdPhase = -1;
    potatoTimer = 6;
    sky.setTint(0.6);
    audio.setHeartbeat(1);
    hud.announce('SUDDEN DEATH!', 'danger', 1.6);
    audio.playWarning();
    audio.startMusic(true);
    audio.musicIntense = true;
  },
  onKO(d, credited, kind, pos) {
    emotes?.onKO(d, credited);
    const sd = match.suddenDeath;
    fx.ko(d, credited, kind, pos, sd);
    comboDirector?.registerKO?.(d, credited, performance.now() / 1000);
    if (deathCinema) {
      let cause = 'VAPORIZED IN THE VOID';
      if (kind === 'splash') cause = 'DROWNED IN THE LAGOON';
      else if (pos.y < 3 && Math.hypot(pos.x, pos.z) < 8) cause = 'BLENDED BY INDUSTRIAL SHREDDER';
      else if (pos.y > 6) cause = 'SMASHED BY HYDRAULIC TENDERIZER';
      deathCinema.captureDeath(d, cause, credited);
    }
    hud.cardKO(d);
    // Pick a punchline for the context (revenge > trickshot > sudden death > style > how they left)
    const t = match.time;
    const ctx = {
      kind, sd,
      self: !credited,
      revenge: !!credited && credited.koedBy === d && t - credited.koedAt < 8,
      trick: !!credited && d.trickHitBy === credited && t - d.trickHitTime < 3,
      styleTier: credited?.styleTier ?? 0,
    };
    d.koedBy = credited;
    d.koedAt = t;
    const { line, context } = koLine(ctx, credited ? Hud.nameTag(credited) : '', Hud.nameTag(d));
    if (credited && !credited.eliminated) combat.addStyle(credited, 25, kind === 'star' ? 'STAR KO' : 'K.O.');
    hud.feed(line, `ko ${context}`);
    const tag = { revenge: 'REVENGE', trick: 'TRICKSHOT KO', sd: 'SUDDEN DEATH', style: 'STYLE KO', self: 'SELF-KO' }[context];
    if (d.isPlayer) hud.announce(d.eliminated ? 'ELIMINATED!' : playerKOWord(kind, false) + (tag ? `<small>${tag}</small>` : ''), 'ko', 1.2);
    else if (credited?.isPlayer) hud.announce((d.eliminated ? 'K.O.!' : playerKOWord(kind, true)) + (tag ? `<small>${tag}</small>` : ''), 'ko small', 1.1);
    if (d.eliminated && !d.isPlayer) hud.popup('OUT!', pos, 'big', d.color);
    // Kill-cam lite: lean toward where they went when the player was part of it
    if (d.isPlayer || credited?.isPlayer) cam.killCam(pos, BALANCE.juice.killCam);
  },
  onHillHold(holder) {
    if (!holder) return;
    const p = holder.getPosition();
    hud.feed(`${Hud.nameTag(holder)} <b>takes the hill!</b>`, holder.isPlayer ? 'style' : '');
    hud.popup(holder.isPlayer ? 'YOUR HILL!' : 'KING!', { x: p.x, y: p.y + 1.8, z: p.z }, 'small', holder.color);
    particles.ring({ x: 0, y: 0.1, z: 0 }, { color: holder.color, size: BALANCE.hill.radius * 1.6, life: 0.45 });
    arena.excite?.(0.25);
  },
  onHillScore(d, score) {
    fx.hillScoreFx(d, score);
    const left = BALANCE.hill.target - score;
    if (left > 0 && left <= 10) hud.announce(`${nameOf(d)}: ${left} TO GO!`, d.isPlayer ? 'go' : 'danger', 1.0);
    arena.excite?.(0.4);
  },
  onFlail(d, pos) {
    fx.flail(d, pos);
  },
  onRespawn(d) {
    d.respawn(arena.getRespawnPoint());
    fx.respawn(d);
    if (d.isPlayer) { const p = d.getPosition(); cam.snapTo(p.x, p.y, p.z); }
  },
  onRoundEnd(winner, ranked) {
    controller.enabled = false;
    arena.hazardsActive = false;
    audio.setHeartbeat(0);
    audio.setCharge(0);
    const you = winner.isPlayer;
    const banners = winBanners({ winner, match, isMatch: false });
    hud.announce(you ? 'YOU WIN THE ROUND!' : `${winner.name.toUpperCase()} WINS!`, you ? 'go small' : 'small', 2.5);
    if (you) audio.playVictory(); else audio.playCheer(1);
    arena.excite(1.5);

    const showRoundSummary = () => {
      match.pausedForCinema = false;
      if (match.phase !== Phase.ROUND_END) return;
      hud.announcerEl.className = 'hide';
      $('round-title').textContent = match.matchWinner ? 'MATCH POINT!' : `ROUND ${match.round} DONE!`;
      $('round-banners').innerHTML = bannersHtml(banners);
      if (banners.length) { audio.playBanner(you); hud.confetti(40); }
      $('round-podium').innerHTML = podium(ranked.slice(0, 3), d => `${plural(d.eliminated ? 0 : d.stocks, 'stock')} · ${Math.floor(d.percent)}%`);
      $('round-screen').classList.remove('hidden');
    };

    if (deathCinema && deathCinema.savedClips.length > 0 && currentMode !== 'adventure') {
      match.pausedForCinema = true;
      deathCinema.playCinema(deathCinema.savedClips, () => {
        showRoundSummary();
      });
    } else {
      setTimeout(showRoundSummary, 1300);
    }
  },
  onNextRound() {
    startRound();
  },
  onMatchEnd(winner, standings) {
    $('round-screen').classList.add('hidden');
    $('hud').classList.add('hidden');
    hideSpectatorOverlay();
    resetSuddenDeathFx();
    cam.unlock();
    audio.stopMusic();
    audio.setCharge(0);
    arena.hazardsActive = false;
    spectateTarget = null;
    hud.setSpectator('');
    const you = winner.isPlayer;
    if (currentMode === 'build_arena') {
      $('result-title').textContent = `${winner.name.toUpperCase()} WINS!`;
    } else {
      $('result-title').textContent = you ? 'YOU WIN!' : `${winner.name.toUpperCase()} WINS!`;
    }
    $('results-podium').innerHTML = podium(standings.slice(0, 3), d => `${plural(match.roundWins.get(d), 'round')} · ${plural(d.totalKos || 0, 'KO')}`,
      d => `${statsFor(d.type).label} · style peak ${Math.round(d.stylePeak)} · ${d.trickshots || 0} trickshots`);
    $('result-banners').innerHTML = bannersHtml(winBanners({ winner, match, isMatch: true }));
    $('result-reel').innerHTML = highlightReel();
    const a = arenaById(arena.arenaId);
    $('result-arena').textContent = `${a.icon} ${a.name}`;
    try {
      const me = standings.find(d => d.isPlayer);
      if (me && currentMode !== 'build_arena') {
        const { career, notes } = recordMatch({ mode: currentMode || 'brawl', won: you, kos: me.totalKos || 0,
          falls: me.totalFalls || me.falls || 0, stylePeak: me.stylePeak || 0, dweeb: me.type, arena: a.name });
        const el = $('result-career');
        if (el) el.innerHTML = careerSummaryHtml(career, notes);
      }
    } catch (e) { console.warn('career record failed', e); }

    if (currentMode === 'build_arena') {
      $('rematch-vote')?.classList.add('hidden');
      $('btn-play-again')?.classList.add('hidden');
      $('btn-main-menu')?.classList.add('hidden');
      $('btn-build-rematch')?.classList.remove('hidden');
      $('btn-build-workshop')?.classList.remove('hidden');
      $('btn-results-mall')?.classList.remove('hidden');
    } else {
      $('rematch-vote')?.classList.remove('hidden');
      $('btn-play-again')?.classList.remove('hidden');
      $('btn-main-menu')?.classList.remove('hidden');
      $('btn-build-rematch')?.classList.add('hidden');
      $('btn-build-workshop')?.classList.add('hidden');
      $('btn-results-mall')?.classList.remove('hidden');
      startRematchVote();
    }

    $('results-screen').classList.remove('hidden');
    hud.confetti();
    audio.playBanner(you);
    if (you) audio.playVictory(); else audio.playDefeat();

    // Daily contract progress
    try {
      const payload = {
        mode: currentMode,
        win: you,
        kos: player.totalKos ?? player.kos ?? 0,
        trickshots: player.trickshots ?? 0,
        stylePeak: player.stylePeak ?? 0,
      };
      const result = recordMatch(payload);
      if (result.justCompleted) {
        hud.announce('DAILY CONTRACT COMPLETE!', result.contract.title, 2);
      }
    } catch (e) {
      console.warn('Daily contract recordMatch failed:', e);
    }
  },
};

function bannersHtml(list) {
  return list.map(b => `<div class="banner">${b.title}<small>${b.sub}</small></div>`).join('');
}

// ─── Rematch vote ───
// Bots trickle in their votes; the player's click is the only one that waits.
// When every Dweeb has voted, the next match starts automatically.

function startRematchVote() {
  clearRematch();
  rematch = { votes: 0, total: dweebs.length, playerVoted: false, done: false, timers: [] };
  updateRematchVote();
  dweebs.filter(d => !d.isPlayer).forEach((d, i) => {
    const delay = 700 + i * 380 + Math.random() * 500;
    rematch.timers.push(setTimeout(() => {
      if (!rematch || rematch.done) return;
      rematch.votes++;
      updateRematchVote();
      if (rematch.playerVoted && rematch.votes >= rematch.total) finishRematchVote();
    }, delay));
  });
}

function voteRematch() {
  if (!rematch || rematch.done || rematch.playerVoted) return;
  rematch.playerVoted = true;
  rematch.votes++;
  updateRematchVote();
  if (rematch.votes >= rematch.total) finishRematchVote();
}

function updateRematchVote() {
  if (!rematch) return;
  const el = $('rematch-vote');
  if (el) el.textContent = `${rematch.votes}/${rematch.total} DWEEBS VOTED REMATCH`;
  const btn = $('btn-play-again');
  if (btn) btn.textContent = rematch.playerVoted ? `VOTED · ${rematch.votes}/${rematch.total}` : 'REMATCH!';
}

function finishRematchVote() {
  if (!rematch || rematch.done) return;
  rematch.done = true;
  rematch.timers.forEach(clearTimeout);
  const el = $('rematch-vote');
  if (el) el.textContent = 'UNANIMOUS! STARTING REMATCH…';
  $('btn-play-again').textContent = 'REMATCH!';
  audio.playCheer(0.8);
  rematch.timers.push(setTimeout(() => { if (match.phase === Phase.RESULTS) startMatch(); }, 800));
}

function clearRematch() {
  if (!rematch) return;
  rematch.timers.forEach(clearTimeout);
  rematch = null;
  const el = $('rematch-vote');
  if (el) el.textContent = '';
  const btn = $('btn-play-again');
  if (btn) btn.textContent = 'REMATCH!';
}

/** Last-match highlight reel: biggest launch, longest air time, trickshots. */
function highlightReel() {
  const h = match.highlights;
  const out = [];
  if (h?.launchOn) {
    const who = h.launchBy ? `${nameOf(h.launchBy)} → ${nameOf(h.launchOn)}` : `${nameOf(h.launchOn)} (stage toy)`;
    out.push(`<div><b>BIGGEST YEET</b>${who} · ${Math.round(h.launch)} m/s</div>`);
  }
  const air = dweebs.reduce((a, d) => (d.maxAir > (a?.maxAir ?? 0) ? d : a), null);
  if (air) out.push(`<div><b>LONGEST AIR</b>${nameOf(air)} · ${air.maxAir.toFixed(1)}s</div>`);
  const total = dweebs.reduce((n, d) => n + (d.trickshots || 0), 0);
  const ace = dweebs.reduce((a, d) => ((d.trickshots || 0) > (a?.trickshots || 0) ? d : a), null);
  out.push(`<div><b>TRICKSHOTS</b>${total}${ace ? ` · most: ${nameOf(ace)} (${ace.trickshots})` : ''}</div>`);
  return out.join('');
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function podium(list, stat, extra = null) {
  const heights = [150, 110, 80];
  const order = list.length >= 3 ? [1, 0, 2] : list.map((_, i) => i);
  return order.filter(i => list[i]).map(i => {
    const d = list[i];
    return `<div class="pod" style="--c:${hex(d.color)}">
      <div class="portrait"><span class="shape ${d.type}${i === 2 ? ' worried' : ''}"><i class="brow"></i><i class="mouth"></i></span></div>
      <div class="nm">${nameOf(d)}</div><div class="st">${stat(d)}</div>${extra ? `<div class="st extra">${extra(d)}</div>` : ''}
      <div class="block" style="height:${heights[i]}px">${i + 1}</div></div>`;
  }).join('');
}

function wireDweeb(d) {
  d.onJump = (dw, double) => fx.jump(dw, double);
  d.onLand = (dw, speed) => fx.land(dw, speed);
  d.onSkid = (dw, speed) => fx.skid(dw, speed);
  d.onStep = (dw, speed) => fx.step(dw, speed);
  d.onDropThrough = dw => arena.dropThroughUnder(dw);
  d.onFastFall = dw => fx.fastFall?.(dw);
  d.onRoll = dw => {
    fx.roll?.(dw);
    combat.addStyle(dw, BALANCE.roll.style, 'ROLL');
  };
  d.onShieldBreak = dw => {
    fx.bubblePop(dw);
    hud.popup('SHIELD!', dw.getPosition(), 'small', 0xffd23f);
  };
  d.onBubblePop = dw => fx.bubblePop(dw);
  d.onTech = dw => fx.tech(dw);
  d.onHit = (dw, launch) => match.noteLaunch(dw, launch);
  d.onFlailJump = dw => fx.flailJump(dw);
  d.onParryStart = dw => fx.parryStart(dw);
  d.onParry = (dw, attacker) => {
    fx.parry(dw, attacker);
    combat.addStyle(dw, BALANCE.parry.style, 'PARRY');
  };
}

// ─── Pause ───

function onPointerLockChange() {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && (match.phase === Phase.PLAYING || match.phase === Phase.COUNTDOWN)) setPaused(true);
}

function setPaused(on) {
  paused = on;
  $('pause-screen').classList.toggle('hidden', !on);
  if (on) {
    audio.setCharge(0);
    haptics?.charge(0);
    haptics?.heartbeat(0);
  }
}

// ─── Main loop ───

function loop() {
  clock.update();
  const rawDt = Math.min(clock.getDelta(), 0.1);
  const inGame = match.phase !== Phase.MENU && match.phase !== Phase.RESULTS;

  if (paused) {
    effect.render(scene, camera);
    return;
  }

  // Dweeb Warfare runs its own fixed-step sim, camera and HUD; the brawler stack sits idle.
  if (currentWarfare) {
    currentWarfare.update(rawDt);
    sky.update(rawDt);
    water.update(rawDt);
    effect.render(scene, camera);
    return;
  }

  // Build-A-Dweeb workshop turntable
  if (currentBuildLab) {
    currentBuildLab.update(rawDt);
    sky.update(rawDt);
    water.update(rawDt);
    effect.render(scene, camera);
    return;
  }

  // Hit-stop: slow simulation time to a crawl for a split second
  fx.update(rawDt);
  comboDirector?.update?.(rawDt);
  const dt = fx.hitStop > 0 ? rawDt * 0.08 : rawDt;

  if (inGame && dweebs.length) {
    if (currentMode !== 'build_arena') {
      controller.update(dt);
    }
    if (currentMeadowlands && colony) {
      colony.update(dt, currentMeadowlands);
    }
    if (match.running) {
      try { modeDirector.update(dt, Object.assign(_modeCtx, { arena, hud, audio, dweebs, match, particles })); } catch (e) { console.warn('[ModeDirector] update error:', e); }
      for (const b of bots) b.update(dt, dweebs);
      if (emotes) { emotes.setActors(dweebs, bots, player); emotes.enabled = !!controller?.enabled && !currentMeadowlands /* adventure uses 1–6 for camera/tools */; emotes.update(dt); }
      for (const b of builderBots) b.update(dt, dweebs);
      try { mutatorDirector.update(dt, mutatorCtx()); } catch (e) { console.error('[Mutator] update error:', e); }
    }
    else if (!currentMeadowlands) for (const d of dweebs) d.moveInput.set(0, 0);
    for (const d of dweebs) d.preStep(dt);
  }

  physics.step(dt);

  if (inGame && dweebs.length) {
    for (const d of dweebs) {
      d.postStep(dt, match.time);
      if (d.customModel) d.customModel.animate(match.time, d.mood);
    }
    handleImpacts();
    combat.update(dt, match.time);
    combat.status?.update(dt);
    updateDrops(dt);
    match.update(dt);
    if (hillZone) hillZone.update(dt, dweebs, match.hillHolder, nameOf);
    if (deathCinema && !deathCinema.isPlaying && currentMode !== 'adventure') {
      for (const d of dweebs) deathCinema.recordFrame(d, match.time);
    }
    if (deathCinema && deathCinema.isPlaying) {
      deathCinema.update(dt, cam);
    } else {
      hud.update(rawDt, match, camera, player);
      const charging = player.active && controller.live ? player.charging : 0;
      audio.setCharge(player.charging > 0 ? charging : 0);
      haptics?.charge(charging);
      haptics?.heartbeat(match.running && player.active ? player.percent : 0, match.suddenDeath);
      updateAim(rawDt);
      updateFocus(rawDt);
      updateNearMiss();
      followCamera();
      // Speed-based FOV
      if (player && player.velocity) {
        const speed = Math.hypot(player.velocity.x, player.velocity.z);
        cam.setSpeedFov(speed);
      }
    }
  } else {
    // Menu: slow orbit around the stage
    aimGuide.hide();
    aimGuide.hideFocus();
    aimGuide.hideAttack();
    hud.setAim(null);
    hud.setFocus(null);
    cam.lookAhead.set(0, 0, 0);
    cam.yaw += rawDt * 0.1;
    cam.pitch = -0.38;
    cam.targetDistance = 27;
    cam.setTarget(0, -1, 0);
  }
  arena.update(dt);
  if (currentMeadowlands) {
    if (buildingManager && player) {
      buildingManager.update(rawDt, player, currentMeadowlands.terrainMesh, { dweebs, colony, world: currentMeadowlands });
      buildingManager.updatePlaced(rawDt, dweebs);
    }
    currentMeadowlands.update(dt, dweebs, colony);
    if (questBoard && player) questBoard.update(dt, player);

    // Gently rescue any dweeb that falls below the map
    for (const d of dweebs) {
      const p = d.getPosition?.() || d.body?.translation?.();
      if (p && p.y < -3) {
        d.respawn?.({ x: 0, y: 1.2, z: 2 }, 0);
        fx?.respawn?.(d);
      }
    }

    // Autosave the village every 30 seconds.
    villageSaveTimer += rawDt;
    if (villageSaveTimer >= 30 && colony && buildingManager) {
      villageSaveTimer = 0;
      saveVillage({ colony, buildingManager, world: currentMeadowlands });
    }

    // Update Living Civilization HUD
    const resB = $('res-berries'), resW = $('res-wood'), resS = $('res-stone'), resV = $('unlocked-verbs'), resG = $('res-gold');
    if (colony && resB) {
      resB.textContent = colony.resources.berries;
      resW.textContent = colony.resources.wood;
      resS.textContent = colony.resources.stone;
      if (resG) resG.textContent = colony.resources.gold || 0;
      resV.textContent = Array.from(colony.unlockedVerbs).map(v => v.toUpperCase()).join(', ');
      const genEl = $('civ-gen');
      if (genEl) genEl.textContent = colony.generation;
    }

    // Dynasty Objective Banner
    const objBanner = $('dynasty-objective-banner');
    if (objBanner && colony && currentMeadowlands) {
      const placed = buildingManager?.placedStructures || [];
      const hasSilo = placed.some(s => s.id === 'silo');
      const openedVaults = (currentMeadowlands.ruins || []).filter(r => r.opened).length;
      const totalVaults = (currentMeadowlands.ruins || []).length || 2;
      const wood = colony.resources.wood || 0;
      const stone = colony.resources.stone || 0;

      if (!hasSilo) {
        objBanner.textContent = `Goal: Gather Wood & Stone to build a Silo (🪵 ${Math.min(3, wood)}/3 · 🪨 ${Math.min(3, stone)}/3) or step on 3 Ancient Plates to unlock the Toy Vault (${openedVaults}/${totalVaults})`;
      } else if (openedVaults < totalVaults) {
        objBanner.textContent = `Goal: Step on 3 Ancient Plates to unlock the Toy Vault! (${openedVaults}/${totalVaults} Unlocked)`;
      } else {
        objBanner.textContent = `Goal: Expand New Dweebtopia! Build Watchtowers & Barricades to defend against Critters (Gen ${colony.generation})`;
      }
      if (questBoard) objBanner.textContent = `${questBoard.bannerText()}  ·  ${objBanner.textContent}`;
    }

    // Citizen Observation Card in Observer mode
    const banner = $('citizen-banner');
    if (cam.mode === 'observer' && colony && colony.citizens.length > 0) {
      const activeCit = colony.citizens[activeCitizenIdx % colony.citizens.length];
      if (banner && activeCit) {
        banner.classList.remove('hidden');
        const nameEl = $('cit-name');
        const actEl = $('cit-activity');
        if (nameEl) {
          const roleName = activeCit.role ? ` · ${activeCit.role}` : '';
          nameEl.textContent = `${activeCit.moodIcon} ${activeCit.name} (${activeCit.personality.name}${roleName})`;
        }
        if (actEl) actEl.textContent = activeCit.activityText;
        updateCitizenRoleBadges(activeCit);
      }
    } else if (banner) {
      banner.classList.add('hidden');
    }

    // Proximity Detection & Prompt
    const proxPrompt = $('civ-proximity-prompt');
    const promptAction = $('civ-prompt-action');
    currentGatherTarget = null;

    if (proxPrompt && player && !buildingManager?.activeBlueprint) {
      const p = player.getPosition?.() || player.body?.translation?.();
      if (p) {
        let bestTarget = null;
        let minScore = Infinity;

        // Trees (< 3.2m)
        for (const tree of currentMeadowlands.trees || []) {
          const d = Math.hypot(p.x - tree.x, p.z - tree.z);
          if (d < 3.2 && (d / 3.2) < minScore) {
            minScore = d / 3.2;
            bestTarget = { type: 'tree', tree, text: '[E] Gather Lumber (+2 Wood)' };
          }
        }

        // Rock Nodes (< 3.0m)
        for (const rock of currentMeadowlands.rockNodes || []) {
          const d = Math.hypot(p.x - rock.x, p.z - rock.z);
          if (d < 3.0 && (d / 3.0) < minScore) {
            minScore = d / 3.0;
            bestTarget = { type: 'rock', rock, text: '[E] Mine Stone (+2 Stone)' };
          }
        }

        // Berry Bushes (< 2.6m)
        for (const bush of currentMeadowlands.berryBushes || []) {
          const d = Math.hypot(p.x - bush.x, p.z - bush.z);
          if (d < 2.6 && (d / 2.6) < minScore) {
            minScore = d / 2.6;
            const hasBerries = (bush.available ?? 5) > 0;
            bestTarget = {
              type: hasBerries ? 'bush' : 'bush_empty',
              bush,
              text: hasBerries ? '[E] Harvest Berries (+1 Berry)' : '🍓 Berry Bush (Regrowing...)'
            };
          }
        }

        // Pressure Plates (< 2.2m)
        const plates = [
          ...(currentMeadowlands.pressurePlates || []),
          ...((currentMeadowlands.ruins || []).flatMap(r => r.plates || []))
        ];
        for (const plate of plates) {
          const d = Math.hypot(p.x - plate.x, p.z - plate.z);
          if (d < 2.2 && (d / 2.2) < minScore) {
            minScore = d / 2.2;
            bestTarget = { type: 'plate', plate, text: '[E] Step on Plate' };
          }
        }

        // Vaults (< 3.2m)
        for (const ruin of currentMeadowlands.ruins || []) {
          const d = Math.hypot(p.x - ruin.x, p.z - ruin.z);
          if (d < 3.2 && (d / 3.2) < minScore) {
            minScore = d / 3.2;
            bestTarget = {
              type: 'vault',
              ruin,
              text: ruin.opened ? '✨ Ancient Vault (Opened)' : '🔒 Sealed Toy Vault (Requires 3 Plates)'
            };
          }
        }

        if (bestTarget) {
          currentGatherTarget = bestTarget;
          if (promptAction) promptAction.textContent = bestTarget.text;
          proxPrompt.classList.remove('hidden');
        } else {
          proxPrompt.classList.add('hidden');
        }
      } else {
        proxPrompt.classList.add('hidden');
      }
    } else if (proxPrompt) {
      proxPrompt.classList.add('hidden');
    }
  }
  particles.update(dt);
  trails.update(dt, arena.objects);
  bursts.update(rawDt);
  decals.update(dt);
  sky.update(rawDt);
  water.update(rawDt);
  cam.update(rawDt);
  audio.updateLoops(rawDt, physics.rollSpeed, arena.cheer);
  effect.render(scene, camera);
}

/** Turn physics impacts into sound, dust and breakage. */
function handleImpacts() {
  impactBudget = 6;
  const list = physics.getImpacts().sort((a, b) => b.speed - a.speed);
  for (const imp of list) {
    for (const side of [imp.a, imp.b]) {
      const obj = side.kind === 'object' ? side.ref : null;
      // The same frame can splash an object out of the world before its impact is read.
      if (obj && (!obj.mesh || !obj.body || obj.broken)) continue;
      const other = side === imp.a ? imp.b : imp.a;
      // Freshly thrown things don't blow up in their thrower's face
      if (obj?.thrownBy && other.ref === obj.thrownBy && obj.hitList.has(other.ref)) continue;
      // Trickshot bookkeeping: caroms off props/hazards (ricochet) and hard skips off the floor
      if (obj?.thrownBy && obj.thrownTime > 0 && other.kind !== 'dweeb' && imp.speed > 3) {
        if (other.kind === 'stage') { if (imp.speed > 8) obj.skips = (obj.skips || 0) + 1; }
        else obj.bounces = (obj.bounces || 0) + 1;
        // Spiky balls and bowling balls re-arm after a bounce, so one throw can bowl over several rivals
        if (obj.def.multiHit && (other.kind !== 'stage' || imp.speed > 8)) {
          obj.hitList.clear();
          obj.hitList.add(obj.thrownBy);
        }
      }
      obj?.onImpact?.(imp.speed);
      // Breakables take damage from hard impacts (energy ∝ speed² × mass)
      if (obj && !obj.broken && obj.def.breakable && imp.speed > 4 && (obj.thrownBy || imp.speed > 7)) {
        if (obj.def.explosive && imp.speed > 9) combat.explode(obj.getPosition(), obj.thrownBy, obj);
        else combat.damageObject(obj, imp.speed * imp.speed * side.mass * 12, obj.thrownBy, { speed: imp.speed });
      }
    }
    // Tumbling dweebs thud, puff and bounce when they smack the ground or a prop
    for (const side of [imp.a, imp.b]) {
      const d = side.kind === 'dweeb' ? side.ref : null;
      if (!d?.ragdolling || imp.speed < 4.5 || (d._ragContactCd ?? 0) > match.time) continue;
      d._ragContactCd = match.time + 0.18;
      fx.ragdollContact?.(d, imp.speed, imp.pos);
    }
    if (impactBudget-- > 0) fx.impact(imp);
  }
}

function updateDrops(dt) {
  if (!match.running) return;
  const finale = match.suddenDeath && match.timer <= 10;
  if (match.suddenDeath) updateSuddenDeath(dt);
  arena.itemTimer -= dt;
  if (arena.itemTimer <= 0) {
    arena.itemTimer = finale ? 2.2 : match.suddenDeath ? 4 : 7 + Math.random() * 4;
    arena.dropRandomItem(match.time, finale ? FINALE_BIAS : null);
  }
  arena.powerupTimer -= dt;
  if (arena.powerupTimer <= 0) {
    arena.powerupTimer = 14 + Math.random() * 8;
    // Rubber-band a little: a bubble when you're on a high %, mega when you're behind on stocks
    let kind = null;
    if (player.active && !player.eliminated) {
      const bestRival = Math.max(...dweebs.filter(d => d !== player && !d.eliminated).map(d => d.stocks), 0);
      if (player.percent > 90 && Math.random() < 0.6) kind = 'bubble';
      else if (player.stocks < bestRival && Math.random() < 0.5) kind = 'mega';
    }
    arena.spawnPowerUp(kind);
  }
}

/** Sudden-death escalation: 0–15 s crumble fast, 15–30 s wrecking cubes swing wider, last 10 s rain explosives. */
function updateSuddenDeath(dt) {
  const t = match.settings.suddenDeathAt - match.timer;
  const phase = match.timer <= 10 ? 2 : t >= 15 ? 1 : 0;
  if (phase !== sdPhase) {
    sdPhase = phase;
    if (phase === 0) {
      arena.sdPace = 0.75; arena.sdWarnScale = 0.75;
      hud.setSuddenDeath('RING CRUMBLING');
    } else if (phase === 1) {
      arena.sdPace = 1; arena.sdWarnScale = 1; arena.sdPendulumAmp = 1.2;
      hud.setSuddenDeath('WRECKING CUBES UNLEASHED');
      hud.feed('<b>SUDDEN DEATH</b> · the cubes swing wider!', 'style');
    } else {
      arena.sdPendulumAmp = 1.25;
      hud.setSuddenDeath('FINAL 10 · IT\'S RAINING BOOMS');
      hud.announce('FINAL 10!', 'danger', 1.2);
      audio.setHeartbeat(2);
      sky.setTint(1);
      audio.playWarning();
    }
  }
  // Hot potato: a lit barrel drops every ~12 s; whoever held it last gets the credit
  potatoTimer -= dt;
  if (potatoTimer <= 0) {
    potatoTimer = 12;
    const p = arena.randomGroundPoint(6);
    const obj = arena.spawnItem('explosiveBarrel', { x: p.x, y: 12, z: p.z });
    obj.hotPotato = true;
    combat.lightFuse(obj, null, 7);
    hud.feed('<b>HOT POTATO!</b> · pass the barrel', 'style');
  }
}

/** Is anyone standing on this outer-ring tile? (sudden-death crumble fairness) */
function tileOccupied(seg) {
  for (const d of dweebs) {
    if (!d.active || d.out) continue;
    const p = d.getPosition();
    const r = Math.hypot(p.x, p.z);
    if (r > CORE_RADIUS - 0.5 && r < STAGE_RADIUS + 0.5 && p.y > -1.5 && p.y < 3 && arena.segmentAt(p.x, p.z) === seg) return true;
  }
  return false;
}

function resetSuddenDeathFx() {
  sdPhase = -1;
  hud.setSuddenDeath('');
  sky.setTint(0);
  audio.setHeartbeat(0);
}

/** Throw preview while holding something: arc + landing reticle (full strength while charging). */
function updateAim(dt) {
  const held = player.active && controller.live && player.held?.kind === 'object' ? player.held.ref : null;
  const showing = held && (!held.isWeapon || controller.throwCharging);
  if (!showing) {
    aimGuide.hide();
    hud.setAim(null);
    cam.lookAhead.set(0, 0, 0);
    return;
  }
  const raw = controller.throwCharging ? controller.throwCharge : player.isCharging ? player.charging : 0;
  const charge = raw >= 0.2 ? raw : 0;
  const f = cam.getForward();
  const a = combat.assistAim(player, held, charge, Math.atan2(f.x, f.z), player.aimLoft ?? DEFAULT_LOFT);
  const pred = combat.predictThrow(player, held, charge, a.yaw, a.loft, aimGuide.points);
  aimGuide.update(dt, pred, { charge: raw, color: player.color, target: a.target, blast: held.def.explosive ? held.def.explosionRadius ?? 5 : 0 });
  // Pull the view toward where it'll land so long throws stay on screen
  const p = player.getPosition();
  const dx = pred.end.x - p.x, dz = pred.end.z - p.z, dist = Math.hypot(dx, dz) || 1;
  if (a.target) {
    const tp = a.target.getPosition();
    hud.setAim(Math.hypot(tp.x - p.x, tp.z - p.z), true);
  } else hud.setAim(pred.land ? dist : null, false);
  const k = Math.min(3, dist * 0.2) / dist;
  cam.lookAhead.set(dx * k, 0, dz * k);
}

/** Aim focus: ring the thing E will grab or LMB will hit, and preview the charged swing arc. */
function updateFocus(dt) {
  if (!player || !player.active || !controller.live || !player.canAct || !match.running) {
    hud.setFocus(null);
    aimGuide.hideFocus();
    aimGuide.hideAttack();
    return;
  }

  const held = player.held?.kind === 'object' ? player.held.ref : null;
  if (player.held && !held?.isWeapon) {
    // Holding a throwable/gadget: the throw arc and hold hint own the screen.
    hud.setFocus(null);
    aimGuide.hideFocus();
    aimGuide.hideAttack();
    return;
  }

  // Only empty hands or a melee weapon can focus a grab/punch target.
  const focus = held ? null : combat.focusTarget(player);
  if (focus) {
    const name = focus.kind === 'object' ? (focus.ref.def?.name ?? 'ITEM') : focus.ref.name;
    const prompt = focus.kind === 'object' ? `E · PICK UP · ${name}` : `E · GRAB · LMB · PUNCH · ${name}`;
    hud.setFocus(prompt.toUpperCase(), focus.kind);
    aimGuide.setFocus(focus.ref, focus.kind, dt);
  } else {
    const target = combat.attackTarget(player);
    if (target) {
      const profile = combat.attackProfile(player);
      const verb = profile.weapon ? 'SWING' : 'PUNCH';
      const prefix = player.isCharging ? 'RELEASE' : 'LMB';
      hud.setFocus(`${prefix} · ${verb} · ${target.name}`.toUpperCase(), 'dweeb');
      aimGuide.setFocus(target, 'dweeb', dt);
    } else {
      hud.setFocus(null);
      aimGuide.hideFocus();
    }
  }

  if (player.isCharging) {
    const profile = combat.attackProfile(player);
    const pos = player.getPosition();
    const groundY = player.groundY > -50 ? player.groundY : pos.y - 0.5;
    aimGuide.setAttack(profile, { x: pos.x, y: groundY, z: pos.z }, player.lookYaw ?? player.yaw, player.charging);
  } else {
    aimGuide.hideAttack();
  }
}

/** "CLOSE!" when the player's launch ends within 1.5 m of a blast line or the lagoon (once per 3 s). */
function updateNearMiss() {
  const d = player;
  if (!d.active || d.out) { nearMiss.flying = false; nearMiss.min = Infinity; return; }
  const p = d.getPosition();
  const launched = d.hitstun > 0 || d.ragdolling || d.swimFlail > 0;
  if (launched) nearMiss.flying = true;
  if (!nearMiss.flying) return;
  const margin = Math.min(match.blastSide - Math.hypot(p.x, p.z), BALANCE.match.blastTop - p.y,
    arena.isOverGround(p.x, p.z) ? Infinity : p.y - (WATER_LEVEL + 0.6));
  if (margin < nearMiss.min) nearMiss.min = margin;
  // The flight is over once you're back on your feet (or holding the ledge)
  if (!launched && (d.grounded || d.ledge)) {
    if (nearMiss.min < 1.5 && match.time - nearMiss.last > 3) {
      nearMiss.last = match.time;
      hud.popup('CLOSE!', p, 'big', 0xbff4ff);
      audio.playTech(0);
    }
    nearMiss.flying = false;
    nearMiss.min = Infinity;
  }
}

function followCamera() {
  if (currentMode === 'build_arena') {
    const active = dweebs.filter(d => d.active && !d.eliminated);
    if (active.length >= 2) {
      const p1 = active[0].getPosition();
      const p2 = active[1].getPosition();
      const midX = (p1.x + p2.x) * 0.5;
      const midY = (p1.y + p2.y) * 0.5 + 0.4;
      const midZ = (p1.z + p2.z) * 0.5;
      const dist = Math.hypot(p1.x - p2.x, p1.z - p2.z);
      cam.setTarget(midX, midY, midZ);
      cam.targetDistance = Math.max(9, Math.min(22, 6 + dist * 1.15));
      cam.pitch = -0.38;
      cam.yaw += 0.002;
      return;
    }
  }
  if (cam.mode === 'first_person') {
    const p = player.getPosition();
    cam.setTarget(p.x, p.y + 0.5, p.z);
    return;
  }
  if (cam.mode === 'god') {
    // In Civ / God view, camera target is panned freely across the settlement
    return;
  }
  if (cam.mode === 'observer' && colony && colony.citizens.length > 0) {
    const activeCit = colony.citizens[activeCitizenIdx % colony.citizens.length];
    if (activeCit && activeCit.dweeb) {
      const p = activeCit.dweeb.getPosition();
      cam.setTarget(p.x, p.y, p.z);
    }
    return;
  }
  let focus = player.active ? player : null;
  if (focus) {
    if (spectateTarget) { spectateTarget = null; hud.setSpectator(''); }
  } else {
    // Spectate a remaining brawler (leader first, ←/→ cycles the rest)
    const alive = dweebs.filter(d => d.active && !d.eliminated);
    if (!alive.includes(spectateTarget)) {
      const ranked = match.roundStandings().filter(d => alive.includes(d));
      spectateTarget = ranked[0] || alive[0] || null;
    }
    focus = spectateTarget;
    hud.setSpectator(focus ? (focus.isPlayer ? 'YOU' : focus.name) : '');
  }
  if (focus) {
    const p = focus.getPosition();
    cam.setTarget(p.x, p.y, p.z);
  }
}

let civControlsWired = false;
function wireCivCameraControls() {
  if (civControlsWired) return;
  civControlsWired = true;

  const btnExp = $('cam-explorer');
  const btnObs = $('cam-observer');
  const btnGod = $('cam-god');
  const btnBuild = $('btn-toggle-build');
  const buildToolbar = $('build-toolbar');

  const updateButtons = (activeMode) => {
    btnExp?.classList.toggle('active', activeMode === 'explorer');
    btnObs?.classList.toggle('active', activeMode === 'observer');
    btnGod?.classList.toggle('active', activeMode === 'god');
  };

  const toggleBuild = () => {
    isBuildToolbarOpen = !isBuildToolbarOpen;
    buildToolbar?.classList.toggle('hidden', !isBuildToolbarOpen);
    btnBuild?.classList.toggle('active', isBuildToolbarOpen);
    if (!isBuildToolbarOpen && buildingManager) {
      buildingManager.cancelPlacing();
      document.querySelectorAll('.build-card').forEach(c => c.classList.remove('active'));
    }
  };

  btnBuild?.addEventListener('click', toggleBuild);

  // Blueprint card selection
  document.querySelectorAll('.build-card').forEach(card => {
    card.addEventListener('click', () => {
      const bpId = card.dataset.bp;
      document.querySelectorAll('.build-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      if (buildingManager) buildingManager.startPlacing(bpId);
    });
  });

  btnExp?.addEventListener('click', () => {
    cam.setMode('explorer');
    updateButtons('explorer');
  });

  btnObs?.addEventListener('click', () => {
    if (colony && colony.citizens.length > 0) {
      activeCitizenIdx = (activeCitizenIdx + 1) % colony.citizens.length;
      cam.setMode('observer', colony.citizens[activeCitizenIdx]);
    }
    updateButtons('observer');
  });

  btnGod?.addEventListener('click', () => {
    cam.setMode('god');
    cam.target.set(0, 0, 0);
    updateButtons('god');
  });

  const btnExpedition = $('btn-launch-expedition');
  btnExpedition?.addEventListener('click', () => {
    audio.playUIClick();
    if (colony && currentMeadowlands) {
      colony.launchExpedition(currentMeadowlands);
    }
  });

  const btnExitMall = $('btn-civ-exit-mall');
  btnExitMall?.addEventListener('click', () => {
    audio.playUIClick();
    if (colony && buildingManager && currentMeadowlands) {
      saveVillage({ colony, buildingManager, world: currentMeadowlands });
    }
    if (currentMeadowlands) {
      (questBoard?.dispose(), questBoard = null, currentMeadowlands.dispose());
      currentMeadowlands = null;
    }
    if (buildingManager) {
      buildingManager.cancelPlacing();
      buildingManager = null;
    }
    colony = null;
    audio.stopAmbience?.();
    cam.setMode('explorer');
    cam.unlock();
    toMenu();
    $('main-menu')?.classList.add('hidden');
    if (window.__dweebsApp?.router) {
      window.__dweebsApp.router.setMatchLock(false);
      window.__dweebsApp.router.go('/');
    } else {
      location.hash = '#/';
    }
  });

  // Citizen re-tasking clicker badges
  document.querySelectorAll('.role-badge-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!colony || colony.citizens.length === 0) return;
      const cit = colony.citizens[activeCitizenIdx % colony.citizens.length];
      if (!cit) return;
      const roleId = btn.dataset.role || null;
      colony.assignRole(cit, roleId);
      audio.playUIClick();
      updateCitizenRoleBadges(cit);
      cit.say?.(roleId ? `I am now the ${roleId}!` : 'I am free to wander!', roleId ? '🛠️' : '🌱');
      const p = cit.dweeb?.getPosition?.() || cit.dweeb?.body?.translation?.() || player?.getPosition?.();
      if (p && hud?.popup) hud.popup(roleId ? `${roleId.toUpperCase()}!` : 'FREE!', p, 'small', 0x5ee06a);
    });
  });

  window.addEventListener('keydown', (e) => {
    if (!currentMeadowlands) return;
    if (e.key === 'x' || e.key === 'X') {
      if (colony && currentMeadowlands) {
        audio.playUIClick();
        colony.launchExpedition(currentMeadowlands);
      }
    } else if (e.key === 'b' || e.key === 'B') {
      toggleBuild();
    } else if (e.key === 'r' || e.key === 'R') {
      if (colony && colony.citizens.length > 0) {
        const cit = colony.citizens[activeCitizenIdx % colony.citizens.length];
        if (cit) {
          const rolesCycle = [null, 'forager', 'builder', 'defender', 'tinkerer'];
          const curIdx = rolesCycle.indexOf(cit.role || null);
          const nextRole = rolesCycle[(curIdx + 1) % rolesCycle.length];
          colony.assignRole(cit, nextRole);
          audio.playUIClick();
          updateCitizenRoleBadges(cit);
          cit.say?.(nextRole ? `I am now a ${nextRole}!` : 'I am free to wander!', nextRole ? '🛠️' : '🌱');
          const p = cit.dweeb?.getPosition?.() || cit.dweeb?.body?.translation?.() || player?.getPosition?.();
          if (p && hud?.popup) hud.popup(nextRole ? `${nextRole.toUpperCase()}!` : 'FREE!', p, 'small', 0x5ee06a);
        }
      }
    } else if (e.key === 'e' || e.key === 'E') {
      if (buildingManager && buildingManager.activeBlueprint) {
        const res = buildingManager.confirmPlacement(colony, currentMeadowlands);
        if (res && !res.success) {
          hud?.toast?.(res.reason || 'Cannot place here');
        }
      } else if (currentGatherTarget && colony && currentMeadowlands) {
        const silos = buildingManager
          ? buildingManager.placedStructures.filter(s => s.id === 'silo')
          : [];
        const p = player?.getPosition?.() || player?.body?.translation?.() || { x: 0, y: 1, z: 0 };
        if (currentGatherTarget.type === 'tree') {
          colony.addResource('wood', 2, silos);
          audio.playUIClick();
          if (hud?.popup) hud.popup('+2 WOOD!', p, 'small', 0xb45309);
        } else if (currentGatherTarget.type === 'rock') {
          colony.addResource('stone', 2, silos);
          audio.playUIClick();
          if (hud?.popup) hud.popup('+2 STONE!', p, 'small', 0x94a3b8);
        } else if (currentGatherTarget.type === 'bush') {
          const bush = currentGatherTarget.bush;
          if ((bush.available ?? 0) > 0) {
            bush.available--;
            if (bush.berries && bush.berries.length > 0) {
              const bMesh = bush.berries[bush.available];
              if (bMesh) bMesh.visible = false;
            }
            colony.addResource('berries', 1, silos);
            audio.playUIClick();
            if (hud?.popup) hud.popup('+1 BERRY!', p, 'small', 0xef4444);
          }
        }
      }
    } else if (e.key === 'Escape') {
      if (buildingManager && buildingManager.activeBlueprint) {
        buildingManager.cancelPlacing();
        document.querySelectorAll('.build-card').forEach(c => c.classList.remove('active'));
      }
    } else if (e.key === '1') {
      cam.setMode('explorer');
      updateButtons('explorer');
    } else if (e.key === '2') {
      if (colony && colony.citizens.length > 0) {
        activeCitizenIdx = (activeCitizenIdx + 1) % colony.citizens.length;
        cam.setMode('observer', colony.citizens[activeCitizenIdx]);
      }
      updateButtons('observer');
    } else if (e.key === '3') {
      cam.setMode('god');
      cam.target.set(0, 0, 0);
      updateButtons('god');
    } else if (cam.mode === 'god') {
      const panSpeed = 0.8;
      if (e.key === 'w' || e.key === 'ArrowUp') cam.panGodView(0, panSpeed);
      if (e.key === 's' || e.key === 'ArrowDown') cam.panGodView(0, -panSpeed);
      if (e.key === 'a' || e.key === 'ArrowLeft') cam.panGodView(-panSpeed, 0);
      if (e.key === 'd' || e.key === 'ArrowRight') cam.panGodView(panSpeed, 0);
    }
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

init().catch(err => {
  console.error(err);
  $('load-status').textContent = 'Something broke. Refresh to try again (details in the console).';
});
