// BuildADweebHud.js — UI Cockpit & Control Panel for Build-A-Dweeb
//
// Provides interactive sliders, color pickers, trait buttons, combat DNA meters,
// name editor, random mutant generator, and "SEND TO ARENA" trigger.

/* global CustomEvent:readonly */

import {
  BODY_SHAPES,
  APPENDAGES,
  FEET_TYPES,
  BROW_STYLES,
  MOUTH_STYLES,
  ARCHETYPE_PRESETS,
  // Merge: milestone #4 (elemental palettes + appendage gameplay) and wave-2
  // (battle profile + dna labels) imports are all kept.
  ELEMENTAL_PALETTES,
  applyElementalPalette,
  APPENDAGE_GAMEPLAY,
  computeBattleProfile,
  dnaStanceLabel,
  dnaAimLabel,
  dnaAgilityLabel,
  dnaScavengeLabel,
} from './CustomDweebModel.js';

const TELEMETRY_KEY = 'dweebs-last-telemetry';

// ─── Share/Import toast helper (juicy feedback) ───────────────────────────────
function showShareToast(root, text, color = '#5ee06a') {
  if (!root) return;
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%) scale(0.8);
    background: ${color}; color: #14101c; font-family: 'Lilita One', sans-serif;
    font-size: 18px; padding: 10px 24px; border: 3px solid #fff8ee; border-radius: 14px;
    box-shadow: 0 8px 0 #14101c, 0 0 20px ${color}88; z-index: 1000; opacity: 0;
    pointer-events: none; white-space: nowrap; transition: transform 0.2s, opacity 0.2s;
  `;
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) scale(1)'; });
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) scale(0.9)';
    setTimeout(() => toast.remove(), 200);
  }, 1800);
}

function showShareError(root, text) {
  if (!root) return;
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%) scale(0.8);
    background: #ff4d5e; color: #fff; font-family: 'Lilita One', sans-serif;
    font-size: 16px; padding: 10px 24px; border: 3px solid #fff8ee; border-radius: 14px;
    box-shadow: 0 8px 0 #14101c, 0 0 20px #ff4d5e88; z-index: 1000; opacity: 0;
    pointer-events: none; white-space: nowrap; transition: transform 0.2s, opacity 0.2s;
  `;
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) scale(1)'; });
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) scale(0.9)';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

const CSS = `
#build-dweeb-hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  font-family: 'Nunito', system-ui, sans-serif;
  color: #fff8ee;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 16px 20px;
  user-select: none;
}
#build-dweeb-hud.hidden { display: none !important; }
#build-dweeb-hud * { box-sizing: border-box; }
.bd-top {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(27, 16, 48, 0.88);
  border: 4px solid #fff8ee;
  border-radius: 20px;
  padding: 10px 22px;
  box-shadow: 0 6px 0 #14101c;
  gap: 12px;
  flex-wrap: wrap;
}
.bd-title-group { display: flex; align-items: center; gap: 14px; }
.bd-logo {
  font-family: 'Lilita One', sans-serif;
  font-size: 28px;
  color: #ffd23f;
  letter-spacing: 1px;
}
.bd-presets-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bd-preset-btn {
  pointer-events: auto;
  font-family: 'Lilita One', sans-serif;
  font-size: 13px;
  background: #332357;
  color: #fff8ee;
  border: 2px solid #ffd23f;
  border-radius: 10px;
  padding: 6px 11px;
  cursor: pointer;
  transition: transform 0.08s, background 0.15s, color 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}
.bd-preset-btn:hover {
  transform: translateY(-2px);
  background: #ffd23f;
  color: #14101c;
}
.bd-preset-btn.active {
  background: #ffd23f;
  color: #14101c;
  box-shadow: 0 0 10px rgba(255, 210, 63, 0.5);
}
.bd-name-input {
  background: #14101c;
  border: 2px solid #ffd23f;
  border-radius: 10px;
  color: #fff8ee;
  font-family: 'Lilita One', sans-serif;
  font-size: 20px;
  padding: 4px 12px;
  width: 220px;
}
.bd-top-actions { display: flex; gap: 10px; }

/* Stable row — six saved creature slots */
.bd-stable-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.bd-stable-label {
  font-family: 'Lilita One', sans-serif;
  font-size: 13px;
  color: #ffd23f;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
.bd-stable-slots {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.bd-stable-slot {
  pointer-events: auto;
  font-family: 'Nunito', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  background: #1a1230;
  color: #fff8ee;
  border: 2px solid #332357;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  min-width: 120px;
  max-width: 160px;
  transition: transform 0.08s, border-color 0.15s, background 0.15s, box-shadow 0.15s;
  position: relative;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bd-stable-slot:hover {
  transform: translateY(-2px);
  border-color: #ffd23f;
  box-shadow: 0 0 8px rgba(255, 210, 63, 0.3);
}
.bd-stable-slot.active {
  border-color: #ffd23f;
  background: rgba(255, 210, 63, 0.15);
  box-shadow: 0 0 10px rgba(255, 210, 63, 0.25);
}
.bd-stable-slot.empty {
  opacity: 0.5;
  border-style: dashed;
  color: #8870a0;
}
.bd-stable-slot .slot-name {
  display: block;
  font-family: 'Lilita One', sans-serif;
  font-size: 12px;
  color: #ffd23f;
}
.bd-stable-slot .slot-meta {
  display: block;
  font-size: 10px;
  opacity: 0.75;
  margin-top: 2px;
}
.bd-stable-slot .slot-delete {
  position: absolute;
  top: 2px;
  right: 4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(255, 77, 94, 0.2);
  color: #ff4d5e;
  border: 1px solid #ff4d5e;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  pointer-events: auto;
}
.bd-stable-slot:hover .slot-delete {
  opacity: 1;
}
.bd-stable-slot .slot-delete:hover {
  background: #ff4d5e;
  color: #fff;
}

.bd-btn {
  pointer-events: auto;
  font-family: 'Lilita One', sans-serif;
  font-size: 16px;
  padding: 8px 16px;
  border: 3px solid #14101c;
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.08s, filter 0.15s;
}
.bd-btn:hover { transform: translateY(-2px); filter: brightness(1.1); }
.bd-btn:active { transform: translateY(2px); }
.bd-btn.yellow { background: #ffd23f; color: #14101c; }
.bd-btn.pink { background: #ff4d5e; color: #fff; }
.bd-btn.green { background: #5ee06a; color: #14101c; }
.bd-btn.alt { background: #fff8ee; color: #14101c; }

.bd-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  pointer-events: none;
}
.bd-panel {
  pointer-events: auto;
  background: rgba(27, 16, 48, 0.88);
  border: 4px solid #fff8ee;
  border-radius: 22px;
  padding: 16px 20px;
  width: 330px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  box-shadow: 0 8px 0 #14101c;
}
.bd-sec-title {
  font-family: 'Lilita One', sans-serif;
  font-size: 20px;
  color: #ffd23f;
  margin-bottom: 12px;
  border-bottom: 2px solid rgba(255, 255, 255, 0.15);
  padding-bottom: 4px;
}
.bd-row { margin-bottom: 12px; }
.bd-label { font-size: 13px; font-weight: 800; opacity: 0.9; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
.bd-seg { display: flex; flex-wrap: wrap; gap: 6px; }
.bd-seg-btn {
  font-family: 'Lilita One', sans-serif;
  font-size: 12px;
  background: #332357;
  color: #fff8ee;
  border: 2px solid #14101c;
  border-radius: 8px;
  padding: 4px 8px;
  cursor: pointer;
}
.bd-seg-btn.active {
  background: #ffd23f;
  color: #14101c;
}
.bd-slider {
  width: 100%;
  accent-color: #ffd23f;
}
.bd-color-picker {
  border: 2px solid #fff8ee;
  border-radius: 8px;
  width: 44px;
  height: 28px;
  cursor: pointer;
  padding: 0;
  background: none;
}

/* Lock buttons */
.bd-lock-btn {
  pointer-events: auto;
  background: transparent;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 2px 6px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: #fff8ee;
  opacity: 0.45;
  transition: opacity 0.15s, transform 0.08s, background 0.15s, border-color 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
}
.bd-lock-btn:hover {
  opacity: 1;
  transform: scale(1.15);
  background: rgba(255, 255, 255, 0.08);
}
.bd-lock-btn.locked {
  opacity: 1;
  color: #ffd23f;
  border-color: #ffd23f;
  background: rgba(255, 210, 63, 0.15);
}
.bd-lock-btn.locked:hover {
  background: rgba(255, 210, 63, 0.3);
}
.bd-row-locked { position: relative; }
.bd-row-locked .bd-label { padding-right: 36px; }
/* Battle profile telemetry */
.bd-profile {
  background: #14101c;
  border: 2px solid #ffd23f;
  border-radius: 12px;
  padding: 8px 12px;
  margin-bottom: 14px;
}
.bd-profile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.bd-tier {
  font-family: 'Lilita One', sans-serif;
  font-size: 22px;
  background: #ffd23f;
  color: #14101c;
  border-radius: 8px;
  padding: 0 10px;
  line-height: 1.4;
}
.bd-rating { font-size: 12px; font-weight: 800; opacity: 0.9; }
.bd-meter { margin-bottom: 5px; }
.bd-meter-top { display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; margin-bottom: 2px; }
.bd-meter-track { height: 8px; background: #332357; border-radius: 5px; overflow: hidden; }
.bd-meter-fill { height: 100%; background: linear-gradient(90deg, #ff4d5e, #ffd23f); border-radius: 5px; transition: width 0.15s; }
.bd-dna-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.bd-dna-tag {
  font-size: 10px;
  font-weight: 800;
  background: #332357;
  border-radius: 6px;
  padding: 2px 7px;
  white-space: nowrap;
}

.bd-btn.icon { padding: 8px 12px; font-size: 15px; }
.bd-btn:disabled { opacity: 0.35; cursor: default; transform: none !important; }

/* Dojo controls */
.bd-dojo-row {
  pointer-events: auto;
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
}
.bd-dojo-btn {
  font-family: 'Lilita One', sans-serif;
  font-size: 14px;
  padding: 8px 14px;
  border: 3px solid #fff8ee;
  border-radius: 12px;
  background: #332357;
  color: #fff8ee;
  cursor: pointer;
  box-shadow: 0 4px 0 #14101c;
  transition: transform 0.08s, filter 0.15s;
}
.bd-dojo-btn:hover { transform: translateY(-2px); filter: brightness(1.15); }
.bd-dojo-btn:active { transform: translateY(2px); }
.bd-records {
  font-size: 11px;
  font-weight: 800;
  background: rgba(20,16,28,0.8);
  border-radius: 8px;
  padding: 3px 10px;
  white-space: nowrap;
}

/* Build slots */
.bd-slots { display: flex; gap: 6px; flex-wrap: wrap; }
.bd-slot-btn {
  font-family: 'Lilita One', sans-serif;
  font-size: 11px;
  background: #332357;
  color: #fff8ee;
  border: 2px solid #ffd23f;
  border-radius: 8px;
  padding: 5px 8px;
  cursor: pointer;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bd-slot-btn:hover { background: #ffd23f; color: #14101c; }
.bd-slot-btn.empty { opacity: 0.45; border-style: dashed; }
.bd-slot-save {
  font-family: 'Lilita One', sans-serif;
  font-size: 11px;
  background: #14101c;
  color: #5ee06a;
  border: 2px solid #5ee06a;
  border-radius: 8px;
  padding: 5px 8px;
  cursor: pointer;
}
.bd-slot-save:hover { background: #5ee06a; color: #14101c; }

/* Dojo report modal */
.bd-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 6, 20, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  pointer-events: auto;
}
.bd-modal-backdrop.hidden { display: none !important; }
.bd-modal {
  background: #1b1030;
  border: 4px solid #ffd23f;
  border-radius: 20px;
  padding: 20px 24px;
  width: 520px;
  max-width: calc(100vw - 60px);
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  box-shadow: 0 10px 0 #14101c, 0 0 40px rgba(255, 210, 63, 0.25);
  color: #fff8ee;
  font-family: 'Nunito', system-ui, sans-serif;
}
.bd-modal h2 {
  font-family: 'Lilita One', sans-serif;
  color: #ffd23f;
  margin: 0 0 10px 0;
  font-size: 24px;
}
.bd-modal-close {
  float: right;
  font-family: 'Lilita One', sans-serif;
  font-size: 16px;
  background: #ff4d5e;
  color: #fff;
  border: 2px solid #14101c;
  border-radius: 10px;
  padding: 4px 12px;
  cursor: pointer;
}
.bd-result-banner {
  font-family: 'Lilita One', sans-serif;
  font-size: 30px;
  text-align: center;
  padding: 8px;
  border-radius: 12px;
  margin-bottom: 12px;
}
.bd-result-banner.win { background: #1d5c2a; color: #5ee06a; }
.bd-result-banner.loss { background: #5c1d1d; color: #ff4d5e; }
.bd-result-banner.draw { background: #332357; color: #ffd23f; }
.bd-fight-log {
  background: #14101c;
  border: 2px solid #332357;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.5;
  max-height: 180px;
  overflow-y: auto;
  margin-top: 10px;
}
.bd-vs-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.bd-vs-card {
  flex: 1;
  background: #14101c;
  border: 2px solid #332357;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
}
.bd-vs-card .bd-vs-name { font-family: 'Lilita One', sans-serif; font-size: 15px; color: #ffd23f; }
.bd-gauntlet-round {
  display: flex;
  justify-content: space-between;
  background: #14101c;
  border: 2px solid #332357;
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 800;
}
.bd-gauntlet-round.won { border-color: #5ee06a; }
.bd-gauntlet-round.lost { border-color: #ff4d5e; }
.bd-evo-spark {
  font-family: monospace;
  font-size: 13px;
  background: #14101c;
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 8px;
  letter-spacing: 1px;
}
.bd-synergy-tag {
  font-size: 10px;
  font-weight: 800;
  background: #3fa9ff;
  color: #14101c;
  border-radius: 6px;
  padding: 2px 7px;
  white-space: nowrap;
}

.bd-center-action {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.bd-launch-btn {
  font-family: 'Lilita One', sans-serif;
  font-size: 26px;
  padding: 14px 34px;
  border: 4px solid #fff8ee;
  border-radius: 20px;
  background: #ff4d5e;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 8px 0 #14101c, 0 0 24px rgba(255, 77, 94, 0.4);
  animation: pulse 1.8s infinite alternate;
}
.bd-launch-btn:hover { transform: scale(1.05); filter: brightness(1.15); }
@keyframes pulse { from { transform: scale(1); } to { transform: scale(1.03); } }

.bd-card {
  pointer-events: auto;
  background: rgba(27, 16, 48, 0.88);
  border: 3px solid #fff8ee;
  border-radius: 16px;
  padding: 10px 14px;
  width: 340px;
  box-shadow: 0 6px 0 #14101c;
  font-size: 13px;
}
.bd-card h4 {
  font-family: 'Lilita One', sans-serif;
  font-size: 16px;
  color: #ffd23f;
  margin: 0 0 8px 0;
  letter-spacing: 0.5px;
}
.bd-tourney-btn {
  font-family: 'Lilita One', sans-serif;
  font-size: 15px;
  padding: 8px 14px;
  border: 3px solid #14101c;
  border-radius: 12px;
  background: #ffd23f;
  color: #14101c;
  cursor: pointer;
}
.bd-tourney-btn:hover { transform: translateY(-2px); filter: brightness(1.08); }
.bd-tourney-btn.fight { background: #ff4d5e; color: #fff; }
.bd-tourney-btn.small { font-size: 12px; padding: 5px 10px; }
.bd-bracket { margin: 8px 0; max-height: 180px; overflow-y: auto; }
.bd-bracket-round { margin-bottom: 6px; }
.bd-bracket-round-title { font-weight: 800; font-size: 11px; opacity: 0.85; letter-spacing: 1px; }
.bd-bout { display: flex; justify-content: space-between; gap: 6px; padding: 2px 0; font-size: 12px; }
.bd-bout .winner { color: #5ee06a; font-weight: 800; }
.bd-bout .pending { opacity: 0.75; }
.bd-bout .you { color: #ffd23f; font-weight: 800; }
.bd-tele-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.bd-tele-dps { font-family: 'Lilita One', sans-serif; font-size: 20px; color: #5ee06a; }
.bd-gauge { height: 12px; background: #14101c; border-radius: 6px; overflow: hidden; border: 2px solid #fff8ee; }
.bd-gauge-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #5ee06a, #ffd23f, #ff4d5e); transition: width 0.2s; }
#bd-recap-canvas { width: 100%; height: 120px; background: #14101c; border-radius: 8px; border: 2px solid #fff8ee; }
.bd-recap-table { width: 100%; font-size: 11px; border-collapse: collapse; margin-top: 6px; }
.bd-recap-table td, .bd-recap-table th { padding: 2px 4px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.12); }
.bd-recap-table td:first-child, .bd-recap-table th:first-child { text-align: left; }
`;

export class BuildADweebHud {
  constructor(containerOrHandlers = {}, maybeHandlers = null) {
    if (containerOrHandlers && (containerOrHandlers.nodeType || containerOrHandlers === document.body)) {
      this.container = containerOrHandlers;
      this.handlers = maybeHandlers || {};
    } else {
      this.container = document.body;
      this.handlers = containerOrHandlers || {};
    }
    this.root = null;
    // Stable state
    this._stableSelected = -1; // currently selected slot index (-1 = none)
    this._createDom();
    // Merge: milestone #4 renders any in-progress tournament bracket;
    // wave-2 wires the lab event bridge (config/history/dojo/slots) + undo-redo shortcuts.
    // If a tournament is already in progress (restored from storage by the
    // lab), render its bracket immediately.
    const existingTournament = this.handlers.onTournamentState?.();
    if (existingTournament) this.renderTournament(existingTournament);
    // If a gauntlet is already in progress, render its wave card immediately.
    const existingGauntlet = this.handlers.onGauntletState?.();
    if (existingGauntlet) this.renderGauntlet(existingGauntlet);
    // Initial stable render
    this.renderStable();

    // Lab event bridge: the lab announces config/history changes over document
    // CustomEvents so the HUD stays in sync without the app shell wiring anything.
    this._onConfigSync = e => this.syncForm(e.detail?.config);
    this._onHistorySync = e => this._syncHistoryButtons(e.detail || {});
    this._onDojoReport = e => this._renderDojoReport(e.detail || {});
    this._onSlotsSync = e => this._renderSlots(e.detail?.slots || {});
    this._slots = {};
    this._records = null;

    // Undo/redo keyboard shortcuts (skipped while typing in a field).
    this._onKeyDown = e => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== 'z') {
        if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.requestRedo(); }
        return;
      }
      e.preventDefault();
      if (e.shiftKey) this.requestRedo();
      else this.requestUndo();
    };
    if (
      typeof document !== 'undefined'
      && typeof document.addEventListener === 'function'
      && typeof document.removeEventListener === 'function'
    ) {
      document.addEventListener('bd-config-sync', this._onConfigSync);
      document.addEventListener('bd-history-sync', this._onHistorySync);
      document.addEventListener('bd-dojo-report', this._onDojoReport);
      document.addEventListener('bd-slots-sync', this._onSlotsSync);
      document.addEventListener('keydown', this._onKeyDown);
      // Pull initial lab state (slots + dojo records) via the event bridge.
      if (typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('bd-slots-request'));
        document.dispatchEvent(new CustomEvent('bd-dojo-records-request'));
      }
    }
  }

  _notifyChange(patch) {
    (this.handlers.onConfigChange || this.handlers.onChange)?.(patch);
    // A manual tweak voids the preset badge: clear preset actives.
    // (Inlined — not a method call — so _notifyChange stays safe when invoked
    // on a bare { handlers } object, as the dedup tests do.)
    this.root?.querySelectorAll('#bd-presets-row .bd-preset-btn.active')
      ?.forEach(b => b.classList.remove('active'));
  }

  /** Ask the lab to do something: prefer an explicit handler, else the event bridge. */
  _askLab(handlerName, eventName) {
    const fn = this.handlers[handlerName];
    if (typeof fn === 'function') {
      fn();
    } else if (
      typeof document !== 'undefined'
      && typeof document.dispatchEvent === 'function'
      && typeof CustomEvent === 'function'
    ) {
      document.dispatchEvent(new CustomEvent(eventName));
    }
  }

  requestUndo() { this._askLab('onUndo', 'bd-undo'); }
  requestRedo() { this._askLab('onRedo', 'bd-redo'); }
  requestSoftMutate() { this._askLab('onSoftMutate', 'bd-soft-mutate'); }

  /** Breed the current build with the selected opponent (or a raw config). */
  requestBreed(partner) {
    const fn = this.handlers.onBreed;
    if (typeof fn === 'function') { fn(partner); return; }
    this._dispatchLabEvent('bd-breed', { partner });
  }

  /** Guided evolution toward a fight-rating target. */
  requestEvolve(rounds = 12, target = 80) {
    const fn = this.handlers.onEvolve;
    if (typeof fn === 'function') { fn({ rounds, target }); return; }
    this._dispatchLabEvent('bd-evolve', { rounds, target });
  }

  /** Simulated dojo spar vs the selected opponent. */
  requestDojoSpar(opp, bestOf = 3) {
    const fn = this.handlers.onDojoSpar;
    if (typeof fn === 'function') { fn(opp, { bestOf }); return; }
    this._dispatchLabEvent('bd-dojo-spar', { opp, bestOf });
  }

  /** Simulated dojo gauntlet: 'ladder' or 'endless'. */
  requestDojoGauntlet(mode = 'ladder') {
    const fn = this.handlers.onDojoGauntlet;
    if (typeof fn === 'function') { fn(mode); return; }
    this._dispatchLabEvent('bd-dojo-gauntlet', { mode });
  }

  requestSlotSave(slot) {
    const fn = this.handlers.onSlotSave;
    if (typeof fn === 'function') { fn(slot); return; }
    this._dispatchLabEvent('bd-slot-save', { slot });
  }

  requestSlotLoad(slot) {
    const fn = this.handlers.onSlotLoad;
    if (typeof fn === 'function') { fn(slot); return; }
    this._dispatchLabEvent('bd-slot-load', { slot });
  }

  _dispatchLabEvent(name, detail) {
    if (
      typeof document !== 'undefined'
      && typeof document.dispatchEvent === 'function'
      && typeof CustomEvent === 'function'
    ) {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  _syncHistoryButtons({ canUndo, canRedo }) {
    const undo = this.root?.querySelector('#bd-btn-undo');
    const redo = this.root?.querySelector('#bd-btn-redo');
    if (undo) undo.disabled = !canUndo;
    if (redo) redo.disabled = !canRedo;
  }

  /** Render build-slot buttons from the lab's slot state. */
  _renderSlots(slots = {}) {
    this._slots = slots || {};
    const el = this.root?.querySelector('#bd-slots');
    if (!el) return;
    el.querySelectorAll('[data-slot]').forEach(btn => {
      const i = btn.dataset.slot;
      const s = this._slots[i];
      btn.classList.toggle('empty', !s);
      btn.textContent = s ? `SLOT ${i}: ${(s.name || 'Saved').toUpperCase().slice(0, 14)}` : `SLOT ${i}: EMPTY`;
      btn.title = s ? `Load "${s.name}" (saved ${s.savedAt ? new Date(s.savedAt).toLocaleDateString() : 'earlier'})` : `Slot ${i} is empty — hit 💾${i} to save here`;
    });
  }

  /** Render the dojo records strip. */
  _renderRecords(r = {}) {
    this._records = r;
    const el = this.root?.querySelector('#bd-dojo-records');
    if (!el) return;
    el.textContent =
      `🥋 SPAR ${r.sparWins ?? 0}-${r.sparLosses ?? 0}-${r.sparDraws ?? 0}` +
      ` · 🏆 LADDER BEST ${r.bestLadder ?? 0}/6${(r.ladderClears ?? 0) > 0 ? ` (${r.ladderClears}👑)` : ''}` +
      ` · ∞ BEST ${r.bestEndless ?? 0}`;
  }

  _showDojoModal(html) {
    const body = this.root?.querySelector('#bd-dojo-body');
    const modal = this.root?.querySelector('#bd-dojo-modal');
    if (!body || !modal) return;
    body.innerHTML = html;
    modal.classList.remove('hidden');
  }

  _hideDojoModal() {
    this.root?.querySelector('#bd-dojo-modal')?.classList.add('hidden');
  }

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Handle lab reports: spar / gauntlet / breed / evolve / records. */
  _renderDojoReport(detail = {}) {
    if (detail.records) this._renderRecords(detail.records);
    const kind = detail.kind;
    if (kind === 'records') return; // records strip updated above
    if (kind === 'spar') return this._showDojoModal(this._sparHtml(detail));
    if (kind === 'gauntlet') return this._showDojoModal(this._gauntletHtml(detail));
    if (kind === 'breed') return this._showDojoModal(this._breedHtml(detail));
    if (kind === 'evolve') return this._showDojoModal(this._evolveHtml(detail));
  }

  _vsCard(snap, align = 'left') {
    const syn = (snap.synergies || []).map(t => `<div>✨ ${this._esc(t)}</div>`).join('');
    return `<div class="bd-vs-card" style="text-align:${align}">
      <div class="bd-vs-name">${this._esc(snap.name)}</div>
      <div>RATING ${snap.rating} · TIER ${snap.tier}</div>${syn}
    </div>`;
  }

  _sparHtml({ player, opponent, bout }) {
    const cls = bout.winner === 0 ? 'win' : bout.winner === 1 ? 'loss' : 'draw';
    const title = bout.winner === 0 ? '🏆 YOU WIN THE SPAR' : bout.winner === 1 ? '💀 SPAR LOST' : '🤝 DRAW';
    const lastDuel = bout.duels[bout.duels.length - 1];
    const logLines = (lastDuel?.log || []).slice(-10).map(l => `<div>▸ ${this._esc(l)}</div>`).join('');
    return `
      <h2>🥋 DOJO SPAR <span style="font-size:13px; opacity:0.7;">(simulated bout)</span></h2>
      <div class="bd-result-banner ${cls}">${title} — ${bout.winsA} : ${bout.winsB}${bout.draws ? ` (${bout.draws} draw${bout.draws > 1 ? 's' : ''})` : ''}</div>
      <div class="bd-vs-row">
        ${this._vsCard(player)}
        <div style="font-family:'Lilita One',sans-serif; font-size:20px;">VS</div>
        ${this._vsCard(opponent, 'right')}
      </div>
      <div style="font-size:12px; font-weight:800; opacity:0.85;">
        AVG ROUNDS ${bout.avgRounds} · DMG DEALT ${bout.totalDmgA} · DMG TAKEN ${bout.totalDmgB}
      </div>
      <div class="bd-fight-log">${logLines || '<div>No highlights logged.</div>'}</div>
      <div style="font-size:11px; opacity:0.6; margin-top:8px;">Simulated — the live arena (SEND TO ARENA) runs the real physics fight.</div>
    `;
  }

  _gauntletHtml({ mode, rounds, cleared, total, champion, records }) {
    const endless = mode === 'endless';
    const bannerCls = (endless ? cleared > 0 : champion) ? 'win' : (cleared > 0 ? 'draw' : 'loss');
    const banner = endless
      ? (cleared > 0 ? `🔥 ${cleared} ROUNDS CLEARED` : '💀 KNOCKED OUT')
      : (champion ? '👑 GAUNTLET CHAMPION!' : `🛡️ CLEARED ${cleared}/${total}`);
    const rows = rounds.map(r => {
      const label = endless ? `R${r.round} — ${this._esc(r.opponent)} (×${r.scale})` : `${this._esc(r.tier)} — ${this._esc(r.opponent)}`;
      const score = r.bout ? `${r.bout.winsA}:${r.bout.winsB}` : `${r.duel.winner === 0 ? 'W' : 'L'} · ${r.duel.rounds}r`;
      return `<div class="bd-gauntlet-round ${r.won ? 'won' : 'lost'}"><span>${label}</span><span>${r.won ? '✅' : '❌'} ${score}</span></div>`;
    }).join('');
    return `
      <h2>${endless ? '∞ ENDLESS GAUNTLET' : '🏆 DOJO GAUNTLET'} <span style="font-size:13px; opacity:0.7;">(simulated)</span></h2>
      <div class="bd-result-banner ${bannerCls}">${banner}</div>
      ${rows}
      <div style="font-size:12px; font-weight:800; margin-top:8px; opacity:0.85;">
        BEST LADDER ${records?.bestLadder ?? 0}/6 · BEST ENDLESS ${records?.bestEndless ?? 0} · 👑 ${records?.ladderClears ?? 0}
      </div>
    `;
  }

  _breedHtml({ parentA, partnerName, ratingBefore, ratingAfter }) {
    const delta = ratingAfter - ratingBefore;
    const cls = delta >= 0 ? 'win' : 'loss';
    return `
      <h2>🧬 BREEDING COMPLETE</h2>
      <div class="bd-result-banner ${cls}">${this._esc(parentA)}</div>
      <div style="font-size:13px; font-weight:800;">
        ${this._esc(partnerName)} × your build → child<br>
        FIGHT RATING ${ratingBefore} → ${ratingAfter} (${delta >= 0 ? '+' : ''}${delta})
      </div>
      <div style="font-size:11px; opacity:0.6; margin-top:8px;">Genes blended 50/50 with a small jitter. Undo (⟲) restores the parent.</div>
    `;
  }

  _evolveHtml({ ratingBefore, ratingAfter, roundsRun, history }) {
    const delta = ratingAfter - ratingBefore;
    const spark = (history || []).map(h => {
      const bars = '▁▂▃▄▅▆▇█';
      const idx = Math.max(0, Math.min(7, Math.floor(h.rating / 100 * 8)));
      return bars[idx];
    }).join('');
    return `
      <h2>🧬 EVOLUTION COMPLETE</h2>
      <div class="bd-result-banner ${delta >= 0 ? 'win' : 'loss'}">
        RATING ${ratingBefore} → ${ratingAfter} (${delta >= 0 ? '+' : ''}${delta})
      </div>
      <div style="font-size:13px; font-weight:800;">${roundsRun} evolution rounds · hill-climb kept the best build seen</div>
      <div class="bd-evo-spark" title="Rating per round">${this._esc(spark)}</div>
      <div style="font-size:11px; opacity:0.6; margin-top:8px;">Undo (⟲) restores the pre-evolution build.</div>
    `;
  }

  /** Render the glanceable battle-profile telemetry from a build config. */
  syncProfile(config) {
    if (!this.root || !config) return;
    const $ = s => this.root.querySelector(s);
    const p = computeBattleProfile(config);
    const stats = config.stats || {};
    const setMeter = (barId, valId, norm, raw) => {
      const bar = $(barId), val = $(valId);
      if (bar) bar.style.width = `${Math.round(norm * 100)}%`;
      if (val) val.textContent = Number.isFinite(raw) ? raw.toFixed(2) : '—';
    };
    if ($('#bd-prof-tier')) $('#bd-prof-tier').textContent = p.tier;
    if ($('#bd-prof-rating')) $('#bd-prof-rating').textContent = `FIGHT RATING ${p.rating}`;
    setMeter('#bd-prof-mass', '#bd-prof-mass-v', p.mass, stats.mass);
    setMeter('#bd-prof-speed', '#bd-prof-speed-v', p.speed, stats.speed);
    setMeter('#bd-prof-jump', '#bd-prof-jump-v', p.jump, stats.jump);
    setMeter('#bd-prof-armor', '#bd-prof-armor-v', p.armor, stats.armor);
    const dnaEl = $('#bd-prof-dna');
    if (dnaEl) {
      const tags = [p.stance, p.aim, p.agility, p.scavenge];
      const synergyTags = (p.synergies || []).map(s => `<span class="bd-synergy-tag">${s}</span>`);
      dnaEl.innerHTML = tags.map(t => `<span class="bd-dna-tag">${t}</span>`).join('') + synergyTags.join('');
    }
  }

  _createDom() {
    let style = document.getElementById('build-dweeb-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'build-dweeb-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const el = document.createElement('div');
    el.id = 'build-dweeb-hud';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="bd-top">
        <div class="bd-title-group">
          <span class="bd-logo">🛠️ BUILD-A-DWEEB LAB</span>
          <input type="text" class="bd-name-input" id="bd-name" value="Robo-Brawler" maxlength="18">
        </div>
        <div class="bd-presets-row" id="bd-presets-row">
          ${Object.entries(ARCHETYPE_PRESETS).map(([key, p]) =>
            `<button class="bd-preset-btn" data-preset="${key}" title="${p.name}">${p.badge}</button>`
          ).join('')}
        </div>
        <!-- Dweeb Stable — six saved creature slots -->
        <div class="bd-stable-row" id="bd-stable-row">
          <span class="bd-stable-label">STABLE</span>
          <div class="bd-stable-slots" id="bd-stable-slots"></div>
          <button class="bd-btn yellow" id="bd-btn-stable-save" title="Save current build to selected slot">SAVE</button>
          <button class="bd-btn alt" id="bd-btn-stable-clear" title="Clear selected slot">CLEAR</button>
        </div>
        <div class="bd-top-actions">
          <button class="bd-btn icon alt" id="bd-btn-undo" title="Undo (Ctrl+Z)" disabled>⟲</button>
          <button class="bd-btn icon alt" id="bd-btn-redo" title="Redo (Ctrl+Shift+Z)" disabled>⟳</button>
          <button class="bd-btn pink" id="bd-btn-soft">🧪 SOFT MUTATE</button>
          <button class="bd-btn green" id="bd-btn-breed" title="Breed your build with the selected opponent">🧬 BREED</button>
          <button class="bd-btn alt" id="bd-btn-evolve" title="Evolve toward a higher fight rating">🧬 EVOLVE</button>
          <button class="bd-btn yellow" id="bd-btn-random">🎲 RANDOM MUTANT</button>
          <button class="bd-btn yellow" id="bd-btn-reroll-unlocked" style="display:none;">🔁 REROLL UNLOCKED</button>
          <button class="bd-btn green" id="bd-btn-share">📤 SHARE CODE</button>
          <button class="bd-btn green" id="bd-btn-import">📥 IMPORT CODE</button>
          <button class="bd-btn alt" id="bd-btn-exit">◀ DWEEB MALL</button>
        </div>
      </div>

      <div class="bd-main">
        <!-- Left Panel: Anatomy & Style -->
        <div class="bd-panel">
          <div class="bd-sec-title">🧬 ANATOMY &amp; SHAPE</div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">BODY ARCHETYPE</div>
            <button class="bd-lock-btn" data-lock="shape" aria-pressed="false" title="Lock body shape" aria-label="Lock body shape">🔓</button>
            <div class="bd-seg" id="bd-seg-shape">
              ${BODY_SHAPES.map(s => `<button class="bd-seg-btn" data-v="${s}">${s.toUpperCase()}</button>`).join('')}
            </div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">BODY WIDTH <span id="bd-lbl-w">1.0x</span></div>
            <button class="bd-lock-btn" data-lock="width" aria-pressed="false" title="Lock body width" aria-label="Lock body width">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-w" min="0.5" max="1.8" step="0.05" value="1.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">BODY HEIGHT <span id="bd-lbl-h">1.0x</span></div>
            <button class="bd-lock-btn" data-lock="height" aria-pressed="false" title="Lock body height" aria-label="Lock body height">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-h" min="0.5" max="1.8" step="0.05" value="1.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">BODY DEPTH <span id="bd-lbl-d">1.0x</span></div>
            <button class="bd-lock-btn" data-lock="depth" aria-pressed="false" title="Lock body depth" aria-label="Lock body depth">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-d" min="0.5" max="1.8" step="0.05" value="1.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">COLORS</div>
            <button class="bd-lock-btn" data-lock="primaryColor" aria-pressed="false" title="Lock primary color" aria-label="Lock primary color">🔓</button>
            <button class="bd-lock-btn" data-lock="accentColor" aria-pressed="false" title="Lock accent color" aria-label="Lock accent color">🔓</button>
            <div style="display:flex; gap:12px; align-items:center;">
              <label style="font-size:12px; font-weight:800;">Primary: <input type="color" class="bd-color-picker" id="bd-col-primary" value="#ff4d5e"></label>
              <label style="font-size:12px; font-weight:800;">Accent: <input type="color" class="bd-color-picker" id="bd-col-accent" value="#ffd23f"></label>
            </div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">EYE COUNT &amp; SIZE</div>
            <button class="bd-lock-btn" data-lock="eyeCount" aria-pressed="false" title="Lock eye count" aria-label="Lock eye count">🔓</button>
            <button class="bd-lock-btn" data-lock="eyeSize" aria-pressed="false" title="Lock eye size" aria-label="Lock eye size">🔓</button>
            <button class="bd-lock-btn" data-lock="eyeSpacing" aria-pressed="false" title="Lock eye spacing" aria-label="Lock eye spacing">🔓</button>
            <div class="bd-seg" id="bd-seg-eyes" style="margin-bottom:6px;">
              <button class="bd-seg-btn" data-v="1">1 CYCLOPS</button>
              <button class="bd-seg-btn active" data-v="2">2 EYES</button>
              <button class="bd-seg-btn" data-v="3">3 ALIEN</button>
              <button class="bd-seg-btn" data-v="4">4 SPIDER</button>
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">EYE SIZE <span id="bd-lbl-eyesize">1.0x</span></div>
            <input type="range" class="bd-slider" id="bd-slider-eyesize" min="0.5" max="1.8" step="0.05" value="1.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">EYE SPACING <span id="bd-lbl-eyespacing">1.0x</span></div>
            <input type="range" class="bd-slider" id="bd-slider-eyespacing" min="0.4" max="2.0" step="0.05" value="1.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">APPENDAGES &amp; GEAR</div>
            <button class="bd-lock-btn" data-lock="appendage" aria-pressed="false" title="Lock appendage" aria-label="Lock appendage">🔓</button>
            <div class="bd-seg" id="bd-seg-app">
              ${APPENDAGES.map(a => {
                const g = APPENDAGE_GAMEPLAY[a];
                const tip = g ? `${g.label} — ${g.desc}` : a;
                return `<button class="bd-seg-btn" data-v="${a}" title="${tip}">${a.replace(/_/g, ' ').toUpperCase()}</button>`;
              }).join('')}
            </div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">ELEMENTAL PALETTE <span style="opacity:0.7;">unlock via tournament</span></div>
            <button class="bd-lock-btn" data-lock="palette" aria-pressed="false" title="Lock elemental palette" aria-label="Lock elemental palette">🔓</button>
            <div class="bd-seg" id="bd-seg-palette">
              ${Object.entries(ELEMENTAL_PALETTES).map(([id, p]) =>
                `<button class="bd-seg-btn" data-v="${id}" title="${p.name} — ${p.unlock}">⚡ ${p.name.toUpperCase()}</button>`
              ).join('')}
            </div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">FEET / LEGS</div>
            <button class="bd-lock-btn" data-lock="feet" aria-pressed="false" title="Lock feet type" aria-label="Lock feet type">🔓</button>
            <div class="bd-seg" id="bd-seg-feet">
              ${FEET_TYPES.map(f => `<button class="bd-seg-btn" data-v="${f}">${f.toUpperCase()}</button>`).join('')}
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">💾 BUILD SLOTS <span style="opacity:0.6; font-weight:400;">click = load · 💾 = save current</span></div>
            <div class="bd-slots" id="bd-slots">
              ${[1, 2, 3].map(i => `
                <button class="bd-slot-btn empty" data-slot="${i}" title="Load slot ${i}">SLOT ${i}: EMPTY</button>
                <button class="bd-slot-save" data-save-slot="${i}" title="Save current build to slot ${i}">💾${i}</button>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Center: Send to Arena Trigger -->
        <div class="bd-center-action">
          <div style="background:rgba(27,16,48,0.85); border:3px solid #fff8ee; border-radius:14px; padding:6px 14px; display:flex; gap:10px; align-items:center;">
            <span style="font-size:13px; font-weight:800;">OPPONENT:</span>
            <select id="bd-select-opp" style="background:#14101c; color:#ffd23f; border:2px solid #ffd23f; border-radius:8px; font-family:'Lilita One',sans-serif; font-size:15px; padding:3px 8px; cursor:pointer;">
              <option value="random">👾 RANDOM MUTANT CPU</option>
              <option value="mirror">🤖 MIRROR RIVAL</option>
              <option value="juggernaut">🥊 JUGGERNAUT BRUTE</option>
              <option value="gremlin">⚡ SPEED GREMLIN</option>
              <option value="sniper">🎯 SNIPER BEAN</option>
              <option value="pugilist">🥊 PUGILIST CHAMP</option>
            </select>
          </div>
          <button class="bd-launch-btn" id="bd-btn-launch">⚔️ SEND TO ARENA</button>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <button class="bd-launch-btn" id="bd-btn-traits" style="background:#b25ee0; font-size:15px; flex:1;">🧬 TRAITS</button>
            <button class="bd-launch-btn" id="bd-btn-brawlsim" style="background:#7dd3fc; font-size:15px; flex:1;">🤖 BRAWL SIM</button>
          </div>
          <span style="font-size:12px; font-weight:800; background:rgba(20,16,28,0.8); border-radius:8px; padding:3px 10px;">100% AUTONOMOUS AI BATTLE · ZERO USER INPUT</span>
          <!-- Merge: milestone #4 tournament card + combat telemetry card -->

          <div class="bd-card" id="bd-tournament-card" style="margin-top:10px;">
            <h4>🏆 COLOSSEUM LADDER</h4>
            <div id="bd-tournament-body">
              <div style="font-size:12px; opacity:0.85; margin-bottom:8px;">Quarterfinals → Semifinals → Grand Final. Champions get meaner every round.</div>
              <button class="bd-tourney-btn" id="bd-btn-tournament" data-tact="start">🏆 START TOURNAMENT</button>
            </div>
          </div>

          <div class="bd-card" id="bd-gauntlet-card" style="margin-top:10px;">
            <h4>🌊 ENDLESS GAUNTLET</h4>
            <div id="bd-gauntlet-body">
              <div style="font-size:12px; opacity:0.85; margin-bottom:8px;">Wave survival: every champion you beat comes back heavier, tougher and smarter. How far can your build go?</div>
              <button class="bd-tourney-btn" id="bd-btn-gauntlet" data-gact="start">🌊 START GAUNTLET</button>
            </div>
          </div>

          <div class="bd-card" id="bd-telemetry-card" style="margin-top:10px;">
            <h4>📊 COMBAT TELEMETRY</h4>
            <div class="bd-tele-row"><span>DPS (live)</span><span class="bd-tele-dps" id="bd-t-dps">—</span></div>
            <div class="bd-tele-row"><span>Peak impact force</span><span id="bd-t-impact-num" style="font-weight:800;">—</span></div>
            <div class="bd-gauge"><div class="bd-gauge-fill" id="bd-t-impact"></div></div>
            <div id="bd-recap-wrap" style="margin-top:8px;">
              <div style="font-size:11px; font-weight:800; opacity:0.8; margin-bottom:4px;">LAST BOUT RECAP</div>
              <canvas id="bd-recap-canvas" width="300" height="120"></canvas>
              <table class="bd-recap-table" id="bd-recap-table"></table>
            </div>
          </div>
          <!-- Merge: wave-2 simulated-dojo controls -->
          <div class="bd-dojo-row" title="Simulated dojo bouts — instant, no arena load">
            <button class="bd-dojo-btn" id="bd-btn-dojo-spar">🥋 DOJO SPAR</button>
            <button class="bd-dojo-btn" id="bd-btn-dojo-ladder">🏆 GAUNTLET</button>
            <button class="bd-dojo-btn" id="bd-btn-dojo-endless">∞ ENDLESS</button>
          </div>
          <span class="bd-records" id="bd-dojo-records">🥋 DOJO RECORDS —</span>
        </div>

        <!-- Right Panel: Combat Stats & AI DNA -->
        <div class="bd-panel">
          <div class="bd-sec-title">🧠 COMBAT STATS &amp; AI DNA</div>

          <div class="bd-profile" id="bd-profile">
            <div class="bd-profile-head">
              <span style="font-family:'Lilita One',sans-serif; font-size:16px; color:#ffd23f;">⚔️ BATTLE PROFILE</span>
              <span class="bd-tier" id="bd-prof-tier">B</span>
            </div>
            <div class="bd-rating" id="bd-prof-rating">FIGHT RATING 50</div>
            <div style="height:6px"></div>
            <div class="bd-meter"><div class="bd-meter-top"><span>💪 MASS</span><span id="bd-prof-mass-v">—</span></div><div class="bd-meter-track"><div class="bd-meter-fill" id="bd-prof-mass"></div></div></div>
            <div class="bd-meter"><div class="bd-meter-top"><span>💨 SPEED</span><span id="bd-prof-speed-v">—</span></div><div class="bd-meter-track"><div class="bd-meter-fill" id="bd-prof-speed"></div></div></div>
            <div class="bd-meter"><div class="bd-meter-top"><span>🦘 JUMP</span><span id="bd-prof-jump-v">—</span></div><div class="bd-meter-track"><div class="bd-meter-fill" id="bd-prof-jump"></div></div></div>
            <div class="bd-meter"><div class="bd-meter-top"><span>🛡️ ARMOR</span><span id="bd-prof-armor-v">—</span></div><div class="bd-meter-track"><div class="bd-meter-fill" id="bd-prof-armor"></div></div></div>
            <div class="bd-dna-tags" id="bd-prof-dna"></div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">CONFIDENCE (STANCE) <span id="bd-lbl-conf">Rushdown</span></div>
            <button class="bd-lock-btn" data-lock="dna.confidence" aria-pressed="false" title="Lock confidence" aria-label="Lock confidence">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-conf" min="0.1" max="1.0" step="0.05" value="0.8">
            <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.75; margin-top:2px;">
              <span>Elusive Kiter</span>
              <span>Balanced</span>
              <span>Berserk Rushdown</span>
            </div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">AIM MASTERY <span id="bd-lbl-aim">Calculated</span></div>
            <button class="bd-lock-btn" data-lock="dna.aimAccuracy" aria-pressed="false" title="Lock aim accuracy" aria-label="Lock aim accuracy">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-aim" min="0.1" max="1.0" step="0.05" value="0.7">
            <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.75; margin-top:2px;">
              <span>Rapid Chaos Spam</span>
              <span>Sniper Yeeter</span>
            </div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">AGILITY &amp; DODGING <span id="bd-lbl-agi">Fast</span></div>
            <button class="bd-lock-btn" data-lock="dna.agility" aria-pressed="false" title="Lock agility" aria-label="Lock agility">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-agi" min="0.3" max="1.0" step="0.05" value="0.75">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">SCAVENGING APPETITE <span id="bd-lbl-scav">Item Hunter</span></div>
            <button class="bd-lock-btn" data-lock="dna.scavenge" aria-pressed="false" title="Lock scavenging" aria-label="Lock scavenging">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-scav" min="0.1" max="1.0" step="0.05" value="0.6">
            <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.75; margin-top:2px;">
              <span>Fists Only</span>
              <span>Weapon / Toy Hunter</span>
            </div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">MASS &amp; KNOCKBACK WEIGHT <span id="bd-lbl-mass">3.0 kg</span></div>
            <button class="bd-lock-btn" data-lock="stats.mass" aria-pressed="false" title="Lock mass" aria-label="Lock mass">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-mass" min="1.8" max="4.5" step="0.1" value="3.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">SPEED <span id="bd-lbl-speed">1.0x</span></div>
            <button class="bd-lock-btn" data-lock="stats.speed" aria-pressed="false" title="Lock speed" aria-label="Lock speed">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-speed" min="0.5" max="1.6" step="0.05" value="1.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">JUMP POWER <span id="bd-lbl-jump">1.0x</span></div>
            <button class="bd-lock-btn" data-lock="stats.jump" aria-pressed="false" title="Lock jump" aria-label="Lock jump">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-jump" min="0.5" max="1.6" step="0.05" value="1.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">ARMOR <span id="bd-lbl-armor">1.0x</span></div>
            <button class="bd-lock-btn" data-lock="stats.armor" aria-pressed="false" title="Lock armor" aria-label="Lock armor">🔓</button>
            <input type="range" class="bd-slider" id="bd-slider-armor" min="0.5" max="1.6" step="0.05" value="1.0">
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">EYEBROW EXPRESSION</div>
            <button class="bd-lock-btn" data-lock="brows" aria-pressed="false" title="Lock eyebrows" aria-label="Lock eyebrows">🔓</button>
            <div class="bd-seg" id="bd-seg-brows">
              ${BROW_STYLES.map(b => `<button class="bd-seg-btn" data-v="${b}">${b.toUpperCase()}</button>`).join('')}
            </div>
          </div>

          <div class="bd-row bd-row-locked">
            <div class="bd-label">MOUTH STYLE</div>
            <button class="bd-lock-btn" data-lock="mouth" aria-pressed="false" title="Lock mouth" aria-label="Lock mouth">🔓</button>
            <div class="bd-seg" id="bd-seg-mouth">
              ${MOUTH_STYLES.map(m => `<button class="bd-seg-btn" data-v="${m}">${m.toUpperCase()}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="bd-modal-backdrop hidden" id="bd-dojo-modal">
        <div class="bd-modal">
          <button class="bd-modal-close" id="bd-dojo-close">✕ CLOSE</button>
          <div id="bd-dojo-body"></div>
        </div>
      </div>
    `;

    (this.container || document.body).appendChild(el);
    this.root = el;
    this._wireEvents();
  }

  _wireEvents() {
    const $ = s => this.root.querySelector(s);

    // Name change
    $('#bd-name').addEventListener('input', e => {
      this._notifyChange({ name: e.target.value.trim() || 'Custom Dweeb' });
    });

    // Preset buttons
    const presetRow = $('#bd-presets-row');
    if (presetRow) {
      presetRow.addEventListener('click', e => {
        const btn = e.target.closest('.bd-preset-btn[data-preset]');
        if (!btn) return;
        const key = btn.dataset.preset;
        const preset = ARCHETYPE_PRESETS[key];
        presetRow.querySelectorAll('.bd-preset-btn').forEach(b => b.classList.remove('active'));

        if (preset) {
          this.syncForm(preset);
          // _notifyChange clears preset actives (a manual tweak voids the
          // preset badge), so re-mark AFTER it — and the lab's config-sync
          // echo re-marks again via syncForm when wired.
          this._notifyChange(preset);
          btn.classList.add('active');
        }
        if (this.handlers.onPresetSelect) {
          this.handlers.onPresetSelect(key);
        }
      });
    }

    // Color pickers
    $('#bd-col-primary').addEventListener('input', e => {
      this._notifyChange({ primaryColor: e.target.value });
    });
    $('#bd-col-accent').addEventListener('input', e => {
      this._notifyChange({ accentColor: e.target.value });
    });

    // Sliders
    const wireSlider = (id, lblId, key, fmt) => {
      const slider = $(id);
      const lbl = $(lblId);
      slider.addEventListener('input', e => {
        const val = parseFloat(e.target.value);
        if (lbl) lbl.textContent = fmt ? fmt(val) : val;
        this._notifyChange({ [key]: val });
      });
    };

    wireSlider('#bd-slider-w', '#bd-lbl-w', 'width', v => `${v.toFixed(2)}x`);
    wireSlider('#bd-slider-h', '#bd-lbl-h', 'height', v => `${v.toFixed(2)}x`);
    wireSlider('#bd-slider-d', '#bd-lbl-d', 'depth', v => `${v.toFixed(2)}x`);
    wireSlider('#bd-slider-eyesize', '#bd-lbl-eyesize', 'eyeSize', v => `${v.toFixed(2)}x`);
    wireSlider('#bd-slider-eyespacing', '#bd-lbl-eyespacing', 'eyeSpacing', v => `${v.toFixed(2)}x`);

    // DNA Sliders
    $('#bd-slider-conf').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-conf').textContent = dnaStanceLabel(v);
      this._notifyChange({ dna: { confidence: v } });
    });

    $('#bd-slider-aim').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-aim').textContent = dnaAimLabel(v);
      this._notifyChange({ dna: { aimAccuracy: v } });
    });

    $('#bd-slider-agi').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-agi').textContent = dnaAgilityLabel(v);
      this._notifyChange({ dna: { agility: v }, stats: { speed: 0.7 + v * 0.6 } });
    });

    $('#bd-slider-scav').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-scav').textContent = dnaScavengeLabel(v);
      this._notifyChange({ dna: { scavenge: v } });
    });

    $('#bd-slider-mass').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-mass').textContent = `${v.toFixed(1)} kg`;
      this._notifyChange({ stats: { mass: v } });
    });

    // New stat sliders
    for (const k of ['speed', 'jump', 'armor']) {
      $(`#bd-slider-${k}`)?.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        const lbl = $(`#bd-lbl-${k}`);
        if (lbl) lbl.textContent = `${v.toFixed(2)}x`;
        this._notifyChange({ stats: { [k]: v } });
      });
    }

    // Segmented selectors
    const wireSeg = (containerId, key, parseVal = x => x) => {
      const container = $(containerId);
      if (!container) return;
      container.addEventListener('click', e => {
        const btn = e.target.closest('button[data-v]');
        if (!btn) return;
        container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._notifyChange({ [key]: parseVal(btn.dataset.v) });
      });
    };

    wireSeg('#bd-seg-shape', 'shape');
    wireSeg('#bd-seg-eyes', 'eyeCount', x => parseInt(x, 10));
    wireSeg('#bd-seg-app', 'appendage');
    wireSeg('#bd-seg-feet', 'feet');
    wireSeg('#bd-seg-brows', 'brows');
    wireSeg('#bd-seg-mouth', 'mouth');

    // Lock buttons
    this.root.querySelectorAll('.bd-lock-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const key = btn.dataset.lock;
        if (!key) return;
        const locked = this.handlers.onToggleLock?.(key);
        if (locked !== undefined) {
          btn.classList.toggle('locked', locked);
          btn.setAttribute('aria-pressed', locked);
          btn.textContent = locked ? '🔒' : '🔓';
          // Show/hide reroll unlocked button
          const rerollBtn = this.root?.querySelector('#bd-btn-reroll-unlocked');
          if (rerollBtn) {
            const anyLocked = this.root.querySelectorAll('.bd-lock-btn.locked').length > 0;
            rerollBtn.style.display = anyLocked ? 'inline-flex' : 'none';
          }
        }
      });
    });

    // Reroll unlocked button
    $('#bd-btn-reroll-unlocked').addEventListener('click', () => {
      this.handlers.onRerollUnlocked?.();
    });

    // Undo / redo
    $('#bd-btn-undo').addEventListener('click', () => this.requestUndo());
    $('#bd-btn-redo').addEventListener('click', () => this.requestRedo());

    // Soft mutate (evolve current build) vs full random mutant
    $('#bd-btn-soft').addEventListener('click', () => this.requestSoftMutate());

    // Breed with the selected opponent, or guided evolution toward a rating target
    $('#bd-btn-breed').addEventListener('click', () => {
      const partner = $('#bd-select-opp')?.value || 'random';
      this.requestBreed(partner);
    });
    $('#bd-btn-evolve').addEventListener('click', () => this.requestEvolve(12, 80));

    // Dojo: simulated bouts (instant, no arena load)
    $('#bd-btn-dojo-spar').addEventListener('click', () => {
      const opp = $('#bd-select-opp')?.value || 'random';
      this.requestDojoSpar(opp, 3);
    });
    $('#bd-btn-dojo-ladder').addEventListener('click', () => this.requestDojoGauntlet('ladder'));
    $('#bd-btn-dojo-endless').addEventListener('click', () => this.requestDojoGauntlet('endless'));

    // Build slots
    const slotsEl = $('#bd-slots');
    if (slotsEl) {
      slotsEl.addEventListener('click', e => {
        const loadBtn = e.target.closest('[data-slot]');
        const saveBtn = e.target.closest('[data-save-slot]');
        if (loadBtn) this.requestSlotLoad(Number(loadBtn.dataset.slot));
        else if (saveBtn) this.requestSlotSave(Number(saveBtn.dataset.saveSlot));
      });
    }

    // Dojo modal close
    $('#bd-dojo-close').addEventListener('click', () => this._hideDojoModal());
    $('#bd-dojo-modal').addEventListener('click', e => {
      if (e.target.id === 'bd-dojo-modal') this._hideDojoModal();
    });

    // Random button
    $('#bd-btn-random').addEventListener('click', () => {
      this.handlers.onRandomMutant?.();
    });

    // SHARE CODE — copy to clipboard with fallback text box
    $('#bd-btn-share').addEventListener('click', async () => {
      const code = this.handlers.onExportCode?.();
      if (!code) {
        showShareError(this.root, '❌ NO CODE — Build a dweeb first!');
        return;
      }
      let copied = false;
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch {
        // Clipboard API may fail in non-secure contexts
      }
      if (!copied) {
        // Fallback: show a selectable text box
        const box = document.createElement('textarea');
        box.value = code;
        box.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
        document.body.appendChild(box);
        box.select();
        try { document.execCommand('copy'); copied = true; } catch { /* ignore */ }
        box.remove();
      }
      if (copied) {
        showShareToast(this.root, '📤 SHARE CODE COPIED!', '#ffd23f');
        // Juice: camera shake + toy word via handler if available
        this.handlers.onShareJuice?.();
      } else {
        showShareError(this.root, '❌ COPY FAILED — Select the code manually');
      }
    });

    // IMPORT CODE — prompt + textarea modal
    $('#bd-btn-import').addEventListener('click', () => {
      const paste = prompt('Paste a DWEEB share code (starts with DWEEB1-):', '');
      if (!paste) return;
      const result = this.handlers.onImportCode?.(paste.trim());
      if (result?.ok) {
        this.syncForm(result.config);
        showShareToast(this.root, '📥 BUILD IMPORTED!', '#5ee06a');
        this.handlers.onImportJuice?.();
      } else {
        showShareError(this.root, '❌ ' + (result?.error || 'Invalid share code'));
      }
    });

    // Exit back to mall
    $('#bd-btn-exit').addEventListener('click', () => {
      this.handlers.onExit?.();
    });

    // Trait Lab + autonomous Brawl Sim (src/builder/traits)
    $('#bd-btn-traits')?.addEventListener('click', () => this.handlers.onOpenTraits?.());
    $('#bd-btn-brawlsim')?.addEventListener('click', () => this.handlers.onOpenBrawlSim?.());

    // Launch Arena
    $('#bd-btn-launch').addEventListener('click', () => {
      const oppType = $('#bd-select-opp').value;
      this.handlers.onLaunchArena?.(oppType);
    });

    // Elemental palette
    const palSeg = $('#bd-seg-palette');
    if (palSeg) {
      palSeg.addEventListener('click', e => {
        const btn = e.target.closest('button[data-v]');
        if (!btn) return;
        palSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._notifyChange(applyElementalPalette({}, btn.dataset.v));
      });
    }

    // Tournament card (delegated — the body re-renders as the bracket advances)
    const tBody = $('#bd-tournament-body');
    if (tBody) {
      tBody.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tact]');
        if (!btn) return;
        const act = btn.dataset.tact;
        if (act === 'start') {
          const state = this.handlers.onTournamentStart?.();
          if (state) this.renderTournament(state);
        } else if (act === 'fight') {
          const opp = this.handlers.onTournamentFight?.();
          if (opp && this.handlers.onLaunchTournament) {
            this.handlers.onLaunchTournament(opp, { tournament: true });
          } else {
            // Fallback: main.js maps 'tournament' via its own wiring.
            this.handlers.onLaunchArena?.('tournament');
          }
        } else if (act === 'won' || act === 'lost') {
          const state = this.handlers.onTournamentResult?.(act === 'won');
          if (state) this.renderTournament(state);
        } else if (act === 'abandon') {
          this.handlers.onTournamentAbandon?.();
          this.renderTournament(null);
        }
      });
    }

    // Gauntlet card (delegated — the body re-renders as waves advance)
    const gBody = this.root?.querySelector('#bd-gauntlet-body');
    if (gBody) {
      gBody.addEventListener('click', e => {
        const btn = e.target.closest('button[data-gact]');
        if (!btn) return;
        const act = btn.dataset.gact;
        if (act === 'start') {
          const state = this.handlers.onGauntletStart?.();
          if (state) this.renderGauntlet(state);
        } else if (act === 'fight') {
          // The bout result is recorded automatically by main.js when the arena match ends.
          if (this.handlers.onGauntletFight?.()) this.handlers.onLaunchGauntlet?.();
        } else if (act === 'abandon') {
          this.handlers.onGauntletAbandon?.();
          this.renderGauntlet(null);
        }
      });
    }

    // Stable row — slot strip + SAVE/CLEAR buttons
    const stableSlots = $('#bd-stable-slots');
    if (stableSlots) {
      // Click a slot to select/load; Shift-click or × to delete
      stableSlots.addEventListener('click', e => {
        const slotEl = e.target.closest('.bd-stable-slot');
        const delBtn = e.target.closest('.slot-delete');
        if (!slotEl) return;
        const idx = parseInt(slotEl.dataset.idx, 10);
        if (Number.isNaN(idx)) return;

        if (delBtn) {
          // Delete via × button
          e.stopPropagation();
          this.handlers.onStableDelete?.(idx);
          return;
        }

        if (e.shiftKey) {
          // Shift-click to delete
          this.handlers.onStableDelete?.(idx);
          return;
        }

        // Normal click: select slot (visual) and load if different
        this._stableSelected = idx;
        this.renderStable();
        this.handlers.onStableLoad?.(idx);
      });
    }

    // SAVE button — write current build to selected slot
    const saveBtn = $('#bd-btn-stable-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (this._stableSelected >= 0) {
          this.handlers.onStableSave?.(this._stableSelected);
        }
      });
    }

    // CLEAR button — clear selected slot
    const clearBtn = $('#bd-btn-stable-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (this._stableSelected >= 0) {
          this.handlers.onStableDelete?.(this._stableSelected);
        }
      });
    }
  }

  syncForm(config) {
    if (!this.root || !config) return;
    const $ = s => this.root.querySelector(s);

    if ($('#bd-name')) $('#bd-name').value = config.name || 'Robo-Brawler';
    if ($('#bd-col-primary')) $('#bd-col-primary').value = config.primaryColor || '#ff4d5e';
    if ($('#bd-col-accent')) $('#bd-col-accent').value = config.accentColor || '#ffd23f';
    if ($('#bd-slider-w')) $('#bd-slider-w').value = config.width ?? 1.0;
    if ($('#bd-slider-h')) $('#bd-slider-h').value = config.height ?? 1.0;
    if ($('#bd-slider-d')) $('#bd-slider-d').value = config.depth ?? 1.0;
    if ($('#bd-lbl-w')) $('#bd-lbl-w').textContent = `${(config.width ?? 1.0).toFixed(2)}x`;
    if ($('#bd-lbl-h')) $('#bd-lbl-h').textContent = `${(config.height ?? 1.0).toFixed(2)}x`;
    if ($('#bd-lbl-d')) $('#bd-lbl-d').textContent = `${(config.depth ?? 1.0).toFixed(2)}x`;

    if ($('#bd-slider-eyesize')) $('#bd-slider-eyesize').value = config.eyeSize ?? 1.0;
    if ($('#bd-lbl-eyesize')) $('#bd-lbl-eyesize').textContent = `${(config.eyeSize ?? 1.0).toFixed(2)}x`;
    if ($('#bd-slider-eyespacing')) $('#bd-slider-eyespacing').value = config.eyeSpacing ?? 1.0;
    if ($('#bd-lbl-eyespacing')) $('#bd-lbl-eyespacing').textContent = `${(config.eyeSpacing ?? 1.0).toFixed(2)}x`;

    const setSeg = (containerId, val) => {
      const c = $(containerId);
      if (!c) return;
      c.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === String(val)));
    };

    setSeg('#bd-seg-shape', config.shape);
    setSeg('#bd-seg-eyes', config.eyeCount);
    setSeg('#bd-seg-app', config.appendage || config.appendages);
    setSeg('#bd-seg-feet', config.feet);
    setSeg('#bd-seg-brows', config.brows || config.brow);
    setSeg('#bd-seg-mouth', config.mouth);
    setSeg('#bd-seg-palette', config.palette);

    const dna = config.dna || config.DNA;
    if (dna) {
      if ($('#bd-slider-conf')) {
        const c = dna.confidence ?? 0.8;
        $('#bd-slider-conf').value = c;
        if ($('#bd-lbl-conf')) $('#bd-lbl-conf').textContent = dnaStanceLabel(c);
      }
      if ($('#bd-slider-aim')) {
        const a = dna.aimAccuracy ?? 0.7;
        $('#bd-slider-aim').value = a;
        if ($('#bd-lbl-aim')) $('#bd-lbl-aim').textContent = dnaAimLabel(a);
      }
      if ($('#bd-slider-agi')) {
        const ag = dna.agility ?? 0.75;
        $('#bd-slider-agi').value = ag;
        if ($('#bd-lbl-agi')) $('#bd-lbl-agi').textContent = dnaAgilityLabel(ag);
      }
      if ($('#bd-slider-scav')) {
        const sc = dna.scavenge ?? 0.6;
        $('#bd-slider-scav').value = sc;
        if ($('#bd-lbl-scav')) $('#bd-lbl-scav').textContent = dnaScavengeLabel(sc);
      }
    }

    const stats = config.stats || {};
    if ($('#bd-slider-mass')) {
      const m = stats.mass ?? config.mass ?? 3.0;
      $('#bd-slider-mass').value = m;
      if ($('#bd-lbl-mass')) $('#bd-lbl-mass').textContent = `${Number(m).toFixed(1)} kg`;
    }
    if ($('#bd-slider-speed')) {
      const s = stats.speed ?? 1.0;
      $('#bd-slider-speed').value = s;
      if ($('#bd-lbl-speed')) $('#bd-lbl-speed').textContent = `${Number(s).toFixed(2)}x`;
    }
    if ($('#bd-slider-jump')) {
      const j = stats.jump ?? 1.0;
      $('#bd-slider-jump').value = j;
      if ($('#bd-lbl-jump')) $('#bd-lbl-jump').textContent = `${Number(j).toFixed(2)}x`;
    }
    if ($('#bd-slider-armor')) {
      const a = stats.armor ?? 1.0;
      $('#bd-slider-armor').value = a;
      if ($('#bd-lbl-armor')) $('#bd-lbl-armor').textContent = `${Number(a).toFixed(2)}x`;
    }

    const presetRow = $('#bd-presets-row');
    if (presetRow) {
      presetRow.querySelectorAll('.bd-preset-btn').forEach(b => {
        const key = b.dataset.preset;
        const p = ARCHETYPE_PRESETS[key];
        const match = p && (config.badge === p.badge || config.name === p.name);
        b.classList.toggle('active', !!match);
      });
    }

    this.syncProfile(config);
  }

  // ─── Dweeb Stable UI ────────────────────────────────────────────────

  /** Render the six-slot stable strip from the lab's stableSlots array. */
  renderStable(slots = null) {
    const container = this.root?.querySelector('#bd-stable-slots');
    if (!container) return;
    // If slots not passed, try to get from lab via handler
    const stable = slots ?? this.handlers.onStableGet?.() ?? [];
    container.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const entry = stable[i];
      const isSelected = i === this._stableSelected;
      const slot = document.createElement('div');
      slot.className = `bd-stable-slot${entry ? '' : ' empty'}${isSelected ? ' active' : ''}`;
      slot.dataset.idx = String(i);
      if (entry) {
        const mass = entry.config?.stats?.mass ?? entry.config?.mass ?? 3.0;
        slot.innerHTML = `
          <span class="slot-name">${this._esc(entry.name || `Dweeb ${i + 1}`)}</span>
          <span class="slot-meta">${this._esc(entry.shape || 'block')} · ${Number(mass).toFixed(1)} kg</span>
          <span class="slot-delete" title="Delete this slot">×</span>
        `;
      } else {
        slot.innerHTML = `<span class="slot-name">EMPTY</span><span class="slot-meta">Slot ${i + 1}</span>`;
      }
      container.appendChild(slot);
    }
  }

  /** Tiny HTML escaper for slot labels. */
  _esc(s) {
    return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&', '<': '<', '>': '>' }[c]));
  }

  // ─── Lock button sync (called from lab when locks change) ───────────────────

  /** Update lock button UI to match lab's lockedParts set. */
  syncLocks(lockedParts = new Set()) {
    if (!this.root) return;
    this.root.querySelectorAll('.bd-lock-btn').forEach(btn => {
      const key = btn.dataset.lock;
      const locked = lockedParts.has(key);
      btn.classList.toggle('locked', locked);
      btn.setAttribute('aria-pressed', locked);
      btn.textContent = locked ? '🔒' : '🔓';
    });
    const rerollBtn = this.root?.querySelector('#bd-btn-reroll-unlocked');
    if (rerollBtn) {
      const anyLocked = lockedParts.size > 0;
      rerollBtn.style.display = anyLocked ? 'inline-flex' : 'none';
    }
  }

  // ─── Tournament ladder UI ────────────────────────────────────────────────

  /** Render the tournament bracket card from a TournamentBracket.state(). */
  renderTournament(state) {
    const body = this.root?.querySelector('#bd-tournament-body');
    if (!body) return;
    if (!state) {
      body.innerHTML = `
        <div style="font-size:12px; opacity:0.85; margin-bottom:8px;">Quarterfinals → Semifinals → Grand Final. Champions get meaner every round.</div>
        <button class="bd-tourney-btn" data-tact="start">🏆 START TOURNAMENT</button>`;
      return;
    }
    if (state.status === 'eliminated') {
      body.innerHTML = `
        <div style="font-size:13px; font-weight:800; color:#ff4d5e; margin-bottom:6px;">💀 ELIMINATED — ${state.roundName}</div>
        ${this._bracketHtml(state)}
        <button class="bd-tourney-btn small" data-tact="start">🔄 RUN IT BACK</button>
        <button class="bd-tourney-btn small" data-tact="abandon" style="background:#332357;color:#fff8ee;">DISMISS</button>`;
      return;
    }
    if (state.status === 'champion') {
      body.innerHTML = `
        <div style="font-size:15px; font-weight:800; color:#ffd23f; margin-bottom:6px;">🏆 COLOSSEUM CHAMPION!</div>
        ${this._bracketHtml(state)}
        <button class="bd-tourney-btn small" data-tact="start">🔄 DEFEND THE CROWN</button>
        <button class="bd-tourney-btn small" data-tact="abandon" style="background:#332357;color:#fff8ee;">DISMISS</button>`;
      return;
    }
    const pm = state.playerMatch;
    const opp = state.opponent;
    body.innerHTML = `
      <div style="font-size:14px; font-weight:800; color:#ffd23f; margin-bottom:4px;">${state.roundName}</div>
      ${pm && opp ? `
        <div class="bd-bout" style="font-size:13px; margin-bottom:6px;">
          <span class="you">YOU</span><span style="opacity:0.7;">vs</span>
          <span><b>${opp.name || 'Champion'}</b> <span style="opacity:0.7;">${opp.badge || ''}</span></span>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
          <button class="bd-tourney-btn fight" data-tact="fight">⚔️ FIGHT ${state.roundName}</button>
        </div>
        <div style="font-size:11px; opacity:0.75; margin-bottom:4px;">After the bout, record the result:</div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <button class="bd-tourney-btn small" data-tact="won" style="background:#5ee06a;">✓ I WON</button>
          <button class="bd-tourney-btn small" data-tact="lost" style="background:#ff4d5e;color:#fff;">✗ I LOST</button>
        </div>` : `
        <div style="font-size:12px; opacity:0.8; margin-bottom:8px;">No pending bout.</div>`}
      ${this._bracketHtml(state)}
      <button class="bd-tourney-btn small" data-tact="abandon" style="background:#332357;color:#fff8ee;">ABANDON</button>`;
  }

  _bracketHtml(state) {
    const esc = s => String(s ?? '').replace(/</g, '&lt;');
    return `<div class="bd-bracket">${state.rounds.map(r => `
      <div class="bd-bracket-round">
        <div class="bd-bracket-round-title">${esc(r.name)}</div>
        ${r.matches.map(m => {
          const aWin = m.winnerId === m.aId, bWin = m.winnerId === m.bId;
          const nm = (id, name) => id === 'player' ? '<span class="you">YOU</span>' : esc(name);
          return `<div class="bd-bout">
            <span class="${aWin ? 'winner' : m.winnerId ? '' : 'pending'}">${aWin ? '👑 ' : ''}${nm(m.aId, m.aName)}</span>
            <span style="opacity:0.5;">vs</span>
            <span class="${bWin ? 'winner' : m.winnerId ? '' : 'pending'}">${nm(m.bId, m.bName)}${bWin ? ' 👑' : ''}</span>
          </div>`;
        }).join('')}
      </div>`).join('')}</div>`;
  }

  // ─── Endless Gauntlet UI ────────────────────────────────────────────────────

  /** Render the gauntlet wave card from a gauntlet state object. */
  renderGauntlet(state) {
    const body = this.root?.querySelector('#bd-gauntlet-body');
    if (!body) return;
    const best = state?.best ? `<div style="font-size:12px; font-weight:800; color:#ffd23f; margin-bottom:6px;">🏆 BEST: ${state.best} WAVE${state.best === 1 ? '' : 'S'} CLEARED</div>` : '';
    if (!state) {
      body.innerHTML = `
        <div style="font-size:12px; opacity:0.85; margin-bottom:8px;">Wave survival: every champion you beat comes back heavier, tougher and smarter. How far can your build go?</div>
        <button class="bd-tourney-btn" data-gact="start">🌊 START GAUNTLET</button>`;
      return;
    }
    if (!state.alive) {
      body.innerHTML = `
        <div style="font-size:14px; font-weight:800; color:#ff4d5e; margin-bottom:6px;">💀 KNOCKED OUT ON WAVE ${state.wave}</div>
        ${best}
        <button class="bd-tourney-btn small" data-gact="start">🔄 RUN IT BACK</button>
        <button class="bd-tourney-btn small" data-gact="abandon" style="background:#332357;color:#fff8ee;">DISMISS</button>`;
      return;
    }
    const opp = state.opponent;
    body.innerHTML = `
      <div style="font-size:14px; font-weight:800; color:#00f5d4; margin-bottom:4px;">
        ${state.lastCleared ? `✓ WAVE ${state.lastCleared} CLEARED · ` : ''}🌊 WAVE ${state.wave}
      </div>
      ${best}
      ${opp ? `
        <div class="bd-bout" style="font-size:13px; margin-bottom:6px;">
          <span class="you">YOU</span><span style="opacity:0.7;">vs</span>
          <span><b>${opp.name || 'Champion'}</b> <span style="opacity:0.7;">${opp.badge || ''}</span></span>
        </div>` : ''}
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
        <button class="bd-tourney-btn fight" data-gact="fight">⚔️ FIGHT WAVE ${state.wave}</button>
      </div>
      <button class="bd-tourney-btn small" data-gact="abandon" style="background:#332357;color:#fff8ee;">ABANDON RUN</button>`;
  }

  // ─── Combat telemetry UI ───────────────────────────────────────────────────

  /** Attach a live CombatTelemetry feed; call updateTelemetry() per frame to refresh. */
  attachTelemetry(t) {
    this.telemetry = t || null;
    this.updateTelemetry();
  }

  /** Refresh the live DPS readout + kinetic impact force gauge from the feed. */
  updateTelemetry() {
    const root = this.root;
    if (!root) return;
    const dpsEl = root.querySelector('#bd-t-dps');
    const impEl = root.querySelector('#bd-t-impact');
    const impNum = root.querySelector('#bd-t-impact-num');
    const t = this.telemetry;
    if (!t) {
      if (dpsEl) dpsEl.textContent = '—';
      if (impNum) impNum.textContent = '—';
      if (impEl) impEl.style.width = '0%';
      return;
    }
    let bestDps = 0, bestName = '';
    let peakImpact = 0;
    for (const id of t.fighterIds()) {
      const d = t.dps(id);
      if (d > bestDps) { bestDps = d; bestName = t.fighters.get(id)?.name || id; }
      peakImpact = Math.max(peakImpact, t.peakImpact(id));
    }
    if (dpsEl) dpsEl.textContent = bestDps > 0 ? `${bestDps.toFixed(1)}${bestName ? ` · ${bestName}` : ''}` : '—';
    if (impNum) impNum.textContent = peakImpact > 0 ? peakImpact.toFixed(1) : '—';
    // 40 force ≈ a massive smash — gauge is relative, computed from real impacts.
    if (impEl) impEl.style.width = `${Math.min(100, (peakImpact / 40) * 100).toFixed(1)}%`;
  }

  /**
   * Render the end-of-match combat recap: damage-over-time graph (canvas) +
   * per-fighter stat table (damage, DPS, evasion rate, recovery jumps, peak
   * impact, KOs). Persists to localStorage so the workshop shows the last bout.
   */
  renderMatchRecap(recap) {
    if (!recap || !this.root) return;
    const canvas = this.root.querySelector('#bd-recap-canvas');
    const ctx2d = canvas?.getContext?.('2d');
    const COLORS = ['#5ee06a', '#ff4d5e', '#3a86ff', '#ffd23f', '#c026d3', '#00f5d4'];
    if (ctx2d && canvas) {
      const W = canvas.width, H = canvas.height;
      ctx2d.clearRect(0, 0, W, H);
      const tl = recap.timeline || [];
      const maxV = Math.max(1, ...tl.map(b => b.total));
      const n = Math.max(1, tl.length);
      const bw = W / n;
      const ids = recap.fighters.map(f => f.id);
      // stacked bars per bucket, one color per fighter
      tl.forEach((b, i) => {
        let y = H;
        ids.forEach((id, k) => {
          const v = (b.per[id] || 0) / maxV * (H - 14);
          y -= v;
          ctx2d.fillStyle = COLORS[k % COLORS.length];
          ctx2d.fillRect(i * bw + 1, y, bw - 2, v);
        });
      });
      // legend
      ctx2d.font = '9px sans-serif';
      ids.forEach((id, k) => {
        ctx2d.fillStyle = COLORS[k % COLORS.length];
        ctx2d.fillRect(4 + k * 72, 4, 8, 8);
        ctx2d.fillStyle = '#fff8ee';
        ctx2d.fillText(String(recap.fighters[k]?.name || id).slice(0, 9), 15 + k * 72, 12);
      });
    }
    const table = this.root.querySelector('#bd-recap-table');
    if (table) {
      const pct = v => `${(v * 100).toFixed(0)}%`;
      table.innerHTML = `
        <tr><th>Fighter</th><th>DMG</th><th>DPS</th><th>EVA</th><th>REC</th><th>IMP</th><th>KO</th></tr>
        ${recap.fighters.map(f => `
          <tr><td>${String(f.name).replace(/</g, '&lt;')}</td><td>${f.damageDealt.toFixed(0)}</td>
          <td>${f.dps.toFixed(1)}</td><td>${pct(f.evasionRate)}</td><td>${f.recoveryJumps}</td>
          <td>${f.peakImpact.toFixed(0)}</td><td>${f.kos}</td></tr>`).join('')}`;
    }
    this.saveLastRecap(recap);
  }

  saveLastRecap(recap) {
    try { localStorage.setItem(TELEMETRY_KEY, JSON.stringify(recap)); } catch { /* private mode */ }
  }

  loadLastRecap() {
    try {
      const saved = localStorage.getItem(TELEMETRY_KEY);
      if (saved) this.renderMatchRecap(JSON.parse(saved));
    } catch { /* corrupted / private mode */ }
  }

  show() {
    this.root?.classList.remove('hidden');
    this.loadLastRecap();
  }

  hide() {
    this.root?.classList.add('hidden');
  }

  dispose() {
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('bd-config-sync', this._onConfigSync);
      document.removeEventListener('bd-history-sync', this._onHistorySync);
      document.removeEventListener('bd-dojo-report', this._onDojoReport);
      document.removeEventListener('bd-slots-sync', this._onSlotsSync);
      document.removeEventListener('keydown', this._onKeyDown);
    }
    this.root?.remove();
  }
}
