// roster-select.js — Roster Select 2.0 for the offline lobby
// Renders a grid of character cards, 3D turntable preview, stat bars, blurb, and RANDOM button.

import * as THREE from 'three';
import { CHARACTER_ROSTER } from '../player/characterList.js';
import { statsFor } from '../game/Balance.js';
import { buildDweebModel, LAYOUT } from '../player/DweebModel.js';
import { toonMat, PALETTE } from '../render/Toon.js';

const INK = 0x14101c;

// Default colors for each type (cycle through PALETTE)
const TYPE_COLORS = {};
const paletteColors = [PALETTE.yellow, PALETTE.pink, PALETTE.blue, PALETTE.green, PALETTE.orange, PALETTE.purple, PALETTE.red, PALETTE.teal];
CHARACTER_ROSTER.forEach((c, i) => {
  TYPE_COLORS[c.id] = paletteColors[i % paletteColors.length];
});

function darken(color, factor) {
  const c = new THREE.Color(color);
  return c.multiplyScalar(factor).getHex();
}

function lerpColor(a, b, t) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return ca.lerp(cb, t).getHex();
}

function createCapsuleFallback(scene, color) {
  // Simple colored capsule as fallback
  const geo = new THREE.CapsuleGeometry(0.3, 0.6, 8, 16);
  const mat = toonMat({ color });
  mat.flatShading = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.5;
  scene.add(mesh);
  return mesh;
}

export function mountRosterSelect(container, { getType, setType }) {
  // Clear the container and build the roster UI
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '12px';

  // ─── Main row: grid + side panel ───
  const mainRow = document.createElement('div');
  mainRow.style.display = 'flex';
  mainRow.style.gap = '16px';
  mainRow.style.alignItems = 'flex-start';
  mainRow.style.flexWrap = 'wrap';
  mainRow.style.justifyContent = 'center';

  // ─── Grid of character cards ───
  const grid = document.createElement('div');
  grid.className = 'roster-grid';
  grid.style.display = 'flex';
  grid.style.flexWrap = 'wrap';
  grid.style.gap = '6px';
  grid.style.justifyContent = 'center';
  grid.style.maxWidth = '520px';
  grid.style.maxHeight = '300px';
  grid.style.overflowY = 'auto';
  grid.style.padding = '4px';

  let selectedType = getType();

  // Compute stat ranges for normalization across roster
  const statKeys = ['mass', 'move', 'jump', 'armor'];
  const statLabels = { mass: 'MASS', move: 'SPEED', jump: 'JUMP', armor: 'ARMOR' };
  const ranges = {};
  for (const key of statKeys) {
    const values = CHARACTER_ROSTER.map(c => statsFor(c.id)[key]);
    ranges[key] = { min: Math.min(...values), max: Math.max(...values) };
  }

  function norm(key, value) {
    const { min, max } = ranges[key];
    if (max === min) return 0.5;
    return (value - min) / (max - min);
  }

  function updateCardSelection() {
    grid.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.v === selectedType);
    });
  }

  function renderBlurb(typeId) {
    const st = statsFor(typeId);
    blurbEl.textContent = `${st.label}: ${st.blurb}`;
    // Update stat bars
    for (const key of statKeys) {
      const val = st[key];
      const n = norm(key, val);
      const bar = statBars[key];
      if (bar) {
        bar.fill.style.width = `${Math.round(n * 100)}%`;
        bar.value.textContent = typeof val === 'number' ? (val % 1 === 0 ? val : val.toFixed(2)) : val;
      }
    }
    // Update preview
    updatePreview(typeId);
  }

  // Create character cards
  for (const char of CHARACTER_ROSTER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.v = char.id;
    btn.className = 'roster-card';
    btn.style.cssText = `
      font-family: var(--display);
      font-size: 14px;
      border: 3px solid var(--ink);
      border-radius: 10px;
      padding: 8px 12px;
      background: var(--cream);
      cursor: pointer;
      color: var(--ink);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      min-width: 72px;
      transition: transform .08s, box-shadow .08s, filter .15s, background .15s;
    `;
    btn.innerHTML = `<span style="font-size:20px;line-height:1">${char.id === 'tri_cloud' ? '☁️' : char.id === 'rolling_eye' ? '👁️' : ''}</span><span>${char.name}</span>`;
    btn.addEventListener('click', () => {
      selectedType = char.id;
      setType(selectedType);
      updateCardSelection();
      renderBlurb(selectedType);
    });
    btn.addEventListener('mouseenter', () => {
      if (btn.dataset.v !== selectedType) {
        btn.style.transform = 'translateY(-2px) rotate(-1deg)';
        btn.style.boxShadow = '0 4px 0 var(--ink)';
        btn.style.filter = 'brightness(1.06)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (btn.dataset.v !== selectedType) {
        btn.style.transform = '';
        btn.style.boxShadow = '';
        btn.style.filter = '';
      }
    });
    grid.appendChild(btn);
  }

  updateCardSelection();

  // ─── Side panel ───
  const sidePanel = document.createElement('div');
  sidePanel.style.display = 'flex';
  sidePanel.style.flexDirection = 'column';
  sidePanel.style.gap = '12px';
  sidePanel.style.alignItems = 'center';
  sidePanel.style.minWidth = '260px';
  sidePanel.style.flex = '0 0 260px';

  // 3D Preview canvas
  const previewWrap = document.createElement('div');
  previewWrap.style.position = 'relative';
  previewWrap.style.width = '220px';
  previewWrap.style.height = '220px';
  previewWrap.style.border = '4px solid var(--ink)';
  previewWrap.style.borderRadius = '16px';
  previewWrap.style.background = 'var(--cream)';
  previewWrap.style.boxShadow = '0 6px 0 var(--ink)';
  previewWrap.style.overflow = 'hidden';

  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = 220;
  previewCanvas.height = 220;
  previewCanvas.style.display = 'block';
  previewCanvas.style.width = '100%';
  previewCanvas.style.height = '100%';
  previewWrap.appendChild(previewCanvas);

  // Preview THREE setup (lazy)
  let previewRenderer = null;
  let previewScene = null;
  let previewCamera = null;
  let previewModel = null;
  let previewAnimId = null;
  let previewTime = 0;
  let previewActive = false;

  function initPreview() {
    if (previewRenderer) return;
    previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true });
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    previewRenderer.setSize(220, 220);
    previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    previewRenderer.toneMappingExposure = 1.05;

    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0xe8eef5);

    // Lighting
    previewScene.add(new THREE.HemisphereLight(0xdff3ff, 0x8a6a9a, 1.3));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
    sun.position.set(5, 10, 8);
    sun.castShadow = true;
    previewScene.add(sun);

    previewCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    previewCamera.position.set(0, 0.7, 3.2);
    previewCamera.lookAt(0, 0.4, 0);

    previewActive = true;
    animatePreview();
  }

  function animatePreview() {
    if (!previewActive) return;
    previewAnimId = requestAnimationFrame(animatePreview);
    const now = performance.now() / 1000;
    const dt = now - previewTime;
    previewTime = now;

    if (previewModel) {
      previewModel.rotation.y += dt * 0.6;
    }
    previewRenderer.render(previewScene, previewCamera);
  }

  function updatePreview(typeId) {
    initPreview();
    const st = statsFor(typeId);
    const color = TYPE_COLORS[typeId] ?? PALETTE.yellow;

    // Clean up old model
    if (previewModel) {
      // Geometry/materials come from DweebModel's shared caches: never dispose them here,
      // or the in-game dweebs lose their meshes.
      previewScene.remove(previewModel);
      previewModel = null;
    }

    // Create a fake d object with fields buildDweebModel needs
    const fakeD = {
      type: typeId,
      color: color,
      index: 0,
      rig: new THREE.Group(),
      flashMats: [],
      layout: LAYOUT[typeId] || LAYOUT.cube,
      wiggleItems: [],
      tentacles: null,
      eyes: [],
      brows: [],
      mouth: null,
      screamMouth: null,
      arms: [],
      legs: [],
      mood: 'calm',
      idleMood: 'calm',
      moodTimer: 0,
      gloatTimer: 0,
      _seenKOs: 0,
      _browAnger: 0,
      _mouthCurve: 0,
      blinkTimer: 0,
      velocity: { x: 0, y: 0, z: 0 },
      charging: 0,
      hitstun: 0,
      ragdolling: false,
      grabbedBy: null,
      swimFlail: 0,
      percent: 0,
      kos: 0,
      name: '',
      isPlayer: false,
      active: true,
      eliminated: false,
      groundY: 0,
      lookYaw: 0,
      yaw: 0,
      traction: 1,
      slide: 1,
      gravityScale: 1,
      jumpScale: 1,
      body: { setTranslation: () => {}, setLinvel: () => {} },
      onJump: () => {},
      onLand: () => {},
      onSkid: () => {},
      onStep: () => {},
      onDropThrough: () => {},
      onFastFall: () => {},
      onRoll: () => {},
      onShieldBreak: () => {},
      onBubblePop: () => {},
      onTech: () => {},
      onHit: () => {},
      onFlailJump: () => {},
      onParryStart: () => {},
      onParry: () => {},
      customModel: null,
      preStep: () => {},
      postStep: () => {},
      respawn: () => {},
      destroy: () => {},
      getPosition: () => ({ x: 0, y: 0, z: 0 }),
      collider: { setMass: () => {} },
      stats: { mass: 3, speed: 7.5, jump: 10.5 },
    };

    try {
      buildDweebModel(fakeD, darken);
      previewModel = fakeD.rig;
      // Center and scale
      const box = new THREE.Box3().setFromObject(previewModel);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.6 / maxDim;
      previewModel.scale.setScalar(scale);
      box.setFromObject(previewModel);
      const center = box.getCenter(new THREE.Vector3());
      previewModel.position.sub(center.multiplyScalar(scale));
      previewModel.position.y -= 0.1;
      previewScene.add(previewModel);
    } catch (e) {
      console.warn('Preview model failed, using capsule fallback:', e);
      previewModel = new THREE.Group();
      createCapsuleFallback(previewModel, color);
      previewScene.add(previewModel);
    }
  }

  // Initial preview
  updatePreview(selectedType);

  // Stat bars
  const statsPanel = document.createElement('div');
  statsPanel.style.display = 'flex';
  statsPanel.style.flexDirection = 'column';
  statsPanel.style.gap = '8px';
  statsPanel.style.width = '100%';
  statsPanel.style.maxWidth = '220px';

  const statBars = {};

  for (const key of statKeys) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.fontSize = '13px';
    row.style.fontWeight = '900';
    row.style.fontFamily = 'var(--body)';

    const label = document.createElement('span');
    label.textContent = statLabels[key];
    label.style.width = '55px';
    label.style.color = 'var(--ink)';

    const barWrap = document.createElement('div');
    barWrap.style.flex = '1';
    barWrap.style.height = '14px';
    barWrap.style.background = '#fff';
    barWrap.style.border = '2px solid var(--ink)';
    barWrap.style.borderRadius = '7px';
    barWrap.style.overflow = 'hidden';

    const fill = document.createElement('div');
    fill.style.height = '100%';
    fill.style.width = '50%';
    fill.style.background = 'linear-gradient(90deg, var(--yellow), var(--pink), var(--blue))';
    fill.style.transition = 'width 0.3s ease-out';
    barWrap.appendChild(fill);

    const value = document.createElement('span');
    value.style.width = '36px';
    value.style.textAlign = 'right';
    value.style.fontFamily = 'var(--display)';
    value.style.fontSize = '14px';
    value.style.color = 'var(--ink)';

    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(value);
    statsPanel.appendChild(row);

    statBars[key] = { fill, value };
  }

  // Blurb
  const blurbEl = document.createElement('div');
  blurbEl.className = 'type-blurb';
  blurbEl.style.fontSize = '14px';
  blurbEl.style.opacity = '0.85';
  blurbEl.style.textAlign = 'center';
  blurbEl.style.lineHeight = '1.4';
  blurbEl.style.maxWidth = '220px';
  blurbEl.style.fontWeight = '700';
  blurbEl.style.color = 'var(--ink)';

  // RANDOM button
  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'btn';
  randomBtn.style.width = '100%';
  randomBtn.style.maxWidth = '220px';
  randomBtn.style.fontSize = '18px';
  randomBtn.style.padding = '10px 16px';
  randomBtn.textContent = '🎲 RANDOM';
  randomBtn.addEventListener('click', () => {
    const randomChar = CHARACTER_ROSTER[Math.floor(Math.random() * CHARACTER_ROSTER.length)];
    selectedType = randomChar.id;
    setType(selectedType);
    updateCardSelection();
    renderBlurb(selectedType);
  });

  sidePanel.appendChild(previewWrap);
  sidePanel.appendChild(statsPanel);
  sidePanel.appendChild(blurbEl);
  sidePanel.appendChild(randomBtn);

  mainRow.appendChild(grid);
  mainRow.appendChild(sidePanel);
  container.appendChild(mainRow);

  // Initial blurb/stats
  renderBlurb(selectedType);

  // ─── Cleanup function for when match starts ───
  function disposePreview() {
    previewActive = false;
    if (previewAnimId) {
      cancelAnimationFrame(previewAnimId);
      previewAnimId = null;
    }
    if (previewModel) {
      // Geometry/materials come from DweebModel's shared caches: never dispose them here,
      // or the in-game dweebs lose their meshes.
      previewScene.remove(previewModel);
      previewModel = null;
    }
    if (previewRenderer) {
      previewRenderer.dispose();
      previewRenderer = null;
    }
    previewScene = null;
    previewCamera = null;
  }

  // Return cleanup function
  function resumePreview() {
    try { updatePreview(selectedType); } catch { /* preview is optional */ }
  }

  return { disposePreview, resumePreview };
}