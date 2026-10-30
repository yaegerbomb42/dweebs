// performance.js — Adaptive Quality Governor
//
// Monitors frame times and automatically adjusts quality level when
// quality === 'auto'. Uses hysteresis to avoid oscillation.

/* global console */

const LEVELS = [
  // 0: high
  { dpr: (dpr) => Math.min(dpr, 2), shadows: true, shadowMapSize: 2048, outline: true, budget: 1 },
  // 1: medium
  { dpr: 1.25, shadows: true, shadowMapSize: 1024, outline: true, budget: 0.7 },
  // 2: low
  { dpr: 1, shadows: false, shadowMapSize: 0, outline: false, budget: 0.45 },
  // 3: potato
  { dpr: 0.7, shadows: false, shadowMapSize: 0, outline: false, budget: 0.25 },
];

const LEVEL_LABELS = ['High', 'Medium', 'Low', 'Potato'];

export function createQualityGovernor({ renderer, getOutline, setOutline, particles, onChange, sunLight }) {
  let level = 0;
  let frameTimes = [];
  let lastChangeTime = 0;
  let lastLevel = 0;
  let sustainedHighTime = 0;
  let sustainedLowTime = 0;
  let isAuto = false;

  function applyLevel(lvl) {
    if (lvl < 0) lvl = 0;
    if (lvl > 3) lvl = 3;
    if (lvl === level) return false;

    const prevLevel = level;
    level = lvl;
    lastLevel = level;
    lastChangeTime = performance.now();

    const cfg = LEVELS[level];
    const dpr = typeof cfg.dpr === 'function' ? cfg.dpr(window.devicePixelRatio || 1) : cfg.dpr;

    // Apply DPR
    try {
      renderer.setPixelRatio(dpr);
      renderer.setSize(window.innerWidth, window.innerHeight);
    } catch { /* ignore */ }

    // Apply shadows
    renderer.shadowMap.enabled = cfg.shadows;
    if (sunLight) {
      if (cfg.shadows && sunLight.shadow && sunLight.shadow.map) {
        const newSize = cfg.shadowMapSize;
        if (sunLight.shadow.mapSize.x !== newSize) {
          sunLight.shadow.map.dispose();
          sunLight.shadow.mapSize.set(newSize, newSize);
          sunLight.shadow.map = null; // three.js will recreate on next render
        }
      }
      sunLight.castShadow = cfg.shadows;
    }

    // Apply outline
    setOutline(cfg.outline);

    // Apply particle budget
    if (particles && typeof particles.setBudget === 'function') {
      particles.setBudget(cfg.budget);
    }

    // Notify change
    if (onChange && prevLevel !== level) {
      onChange(level, LEVEL_LABELS[level]);
    }

    return true;
  }

  function update(rawDt) {
    if (!isAuto) return;

    const now = performance.now();
    const frameMs = rawDt * 1000;

    // Rolling average of last 90 frames (~1.5s at 60fps, ~3s at 30fps)
    frameTimes.push(frameMs);
    if (frameTimes.length > 90) frameTimes.shift();

    if (frameTimes.length < 30) return; // Need some samples first

    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const dtSec = rawDt;

    // Step DOWN: avg > 22ms for 2s
    if (avg > 22) {
      sustainedHighTime += dtSec;
      sustainedLowTime = 0;
    } else {
      sustainedHighTime = 0;
    }

    // Step UP: avg < 13ms for 6s
    if (avg < 13) {
      sustainedLowTime += dtSec;
    } else {
      sustainedLowTime = 0;
    }

    // Hysteresis: max one change per 4s
    const timeSinceChange = now - lastChangeTime;
    if (timeSinceChange < 4000) return;

    if (sustainedHighTime >= 2 && level < 3) {
      applyLevel(level + 1);
      sustainedHighTime = 0;
      sustainedLowTime = 0;
    } else if (sustainedLowTime >= 6 && level > 0) {
      applyLevel(level - 1);
      sustainedHighTime = 0;
      sustainedLowTime = 0;
    }
  }

  function setAuto(enabled, initialLevel = 0) {
    if (enabled === isAuto && frameTimes.length) return; // unrelated settings change
    const was = isAuto;
    isAuto = enabled;
    if (!enabled && was) { level = 0; applyLevel(0); return; } // hand back to the fixed preset
    if (enabled) {
      level = initialLevel;
      lastLevel = initialLevel;
      frameTimes = [];
      sustainedHighTime = 0;
      sustainedLowTime = 0;
      lastChangeTime = performance.now();
      applyLevel(level);
    }
  }

  function getLevel() {
    return level;
  }

  function getLevelLabel() {
    return LEVEL_LABELS[level];
  }

  function forceLevel(lvl) {
    if (lvl < 0) lvl = 0;
    if (lvl > 3) lvl = 3;
    level = lvl;
    lastLevel = lvl;
    applyLevel(lvl);
  }

  return {
    update,
    setAuto,
    getLevel,
    getLevelLabel,
    forceLevel,
    applyLevel,
  };
}