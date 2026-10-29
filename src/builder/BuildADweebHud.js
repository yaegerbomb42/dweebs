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
  computeBattleProfile,
  dnaStanceLabel,
  dnaAimLabel,
  dnaAgilityLabel,
  dnaScavengeLabel,
} from './CustomDweebModel.js';

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
.bd-label { font-size: 13px; font-weight: 800; opacity: 0.9; margin-bottom: 4px; display: flex; justify-content: space-between; }
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
    this._createDom();

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
        <div class="bd-top-actions">
          <button class="bd-btn icon alt" id="bd-btn-undo" title="Undo (Ctrl+Z)" disabled>⟲</button>
          <button class="bd-btn icon alt" id="bd-btn-redo" title="Redo (Ctrl+Shift+Z)" disabled>⟳</button>
          <button class="bd-btn pink" id="bd-btn-soft">🧪 SOFT MUTATE</button>
          <button class="bd-btn green" id="bd-btn-breed" title="Breed your build with the selected opponent">🧬 BREED</button>
          <button class="bd-btn alt" id="bd-btn-evolve" title="Evolve toward a higher fight rating">🧬 EVOLVE</button>
          <button class="bd-btn yellow" id="bd-btn-random">🎲 RANDOM MUTANT</button>
          <button class="bd-btn alt" id="bd-btn-exit">◀ DWEEB MALL</button>
        </div>
      </div>

      <div class="bd-main">
        <!-- Left Panel: Anatomy & Style -->
        <div class="bd-panel">
          <div class="bd-sec-title">🧬 ANATOMY &amp; SHAPE</div>
          
          <div class="bd-row">
            <div class="bd-label">BODY ARCHETYPE</div>
            <div class="bd-seg" id="bd-seg-shape">
              ${BODY_SHAPES.map(s => `<button class="bd-seg-btn" data-v="${s}">${s.toUpperCase()}</button>`).join('')}
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">BODY WIDTH <span id="bd-lbl-w">1.0x</span></div>
            <input type="range" class="bd-slider" id="bd-slider-w" min="0.5" max="1.8" step="0.05" value="1.0">
          </div>

          <div class="bd-row">
            <div class="bd-label">BODY HEIGHT <span id="bd-lbl-h">1.0x</span></div>
            <input type="range" class="bd-slider" id="bd-slider-h" min="0.5" max="1.8" step="0.05" value="1.0">
          </div>

          <div class="bd-row">
            <div class="bd-label">BODY DEPTH <span id="bd-lbl-d">1.0x</span></div>
            <input type="range" class="bd-slider" id="bd-slider-d" min="0.5" max="1.8" step="0.05" value="1.0">
          </div>

          <div class="bd-row">
            <div class="bd-label">COLORS</div>
            <div style="display:flex; gap:12px; align-items:center;">
              <label style="font-size:12px; font-weight:800;">Primary: <input type="color" class="bd-color-picker" id="bd-col-primary" value="#ff4d5e"></label>
              <label style="font-size:12px; font-weight:800;">Accent: <input type="color" class="bd-color-picker" id="bd-col-accent" value="#ffd23f"></label>
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">EYE COUNT</div>
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

          <div class="bd-row">
            <div class="bd-label">EYE SPACING <span id="bd-lbl-eyespacing">1.0x</span></div>
            <input type="range" class="bd-slider" id="bd-slider-eyespacing" min="0.4" max="2.0" step="0.05" value="1.0">
          </div>

          <div class="bd-row">
            <div class="bd-label">APPENDAGES &amp; GEAR</div>
            <div class="bd-seg" id="bd-seg-app">
              ${APPENDAGES.map(a => `<button class="bd-seg-btn" data-v="${a}">${a.replace('_', ' ').toUpperCase()}</button>`).join('')}
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">FEET / LEGS</div>
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
          <span style="font-size:12px; font-weight:800; background:rgba(20,16,28,0.8); border-radius:8px; padding:3px 10px;">100% AUTONOMOUS AI BATTLE · ZERO USER INPUT</span>
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

          <div class="bd-row">
            <div class="bd-label">CONFIDENCE (STANCE) <span id="bd-lbl-conf">Rushdown</span></div>
            <input type="range" class="bd-slider" id="bd-slider-conf" min="0.1" max="1.0" step="0.05" value="0.8">
            <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.75; margin-top:2px;">
              <span>Elusive Kiter</span>
              <span>Balanced</span>
              <span>Berserk Rushdown</span>
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">AIM MASTERY <span id="bd-lbl-aim">Calculated</span></div>
            <input type="range" class="bd-slider" id="bd-slider-aim" min="0.1" max="1.0" step="0.05" value="0.7">
            <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.75; margin-top:2px;">
              <span>Rapid Chaos Spam</span>
              <span>Sniper Yeeter</span>
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">AGILITY &amp; DODGING <span id="bd-lbl-agi">Fast</span></div>
            <input type="range" class="bd-slider" id="bd-slider-agi" min="0.3" max="1.0" step="0.05" value="0.75">
          </div>

          <div class="bd-row">
            <div class="bd-label">SCAVENGING APPETITE <span id="bd-lbl-scav">Item Hunter</span></div>
            <input type="range" class="bd-slider" id="bd-slider-scav" min="0.1" max="1.0" step="0.05" value="0.6">
            <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.75; margin-top:2px;">
              <span>Fists Only</span>
              <span>Weapon / Toy Hunter</span>
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">MASS &amp; KNOCKBACK WEIGHT <span id="bd-lbl-mass">3.0 kg</span></div>
            <input type="range" class="bd-slider" id="bd-slider-mass" min="1.8" max="4.5" step="0.1" value="3.0">
          </div>

          <div class="bd-row">
            <div class="bd-label">EYEBROW EXPRESSION</div>
            <div class="bd-seg" id="bd-seg-brows">
              ${BROW_STYLES.map(b => `<button class="bd-seg-btn" data-v="${b}">${b.toUpperCase()}</button>`).join('')}
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">MOUTH STYLE</div>
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

    // Exit back to mall
    $('#bd-btn-exit').addEventListener('click', () => {
      this.handlers.onExit?.();
    });

    // Launch Arena
    $('#bd-btn-launch').addEventListener('click', () => {
      const oppType = $('#bd-select-opp').value;
      this.handlers.onLaunchArena?.(oppType);
    });
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

    const mass = config.stats?.mass ?? config.mass;
    if (mass !== undefined && $('#bd-slider-mass')) {
      $('#bd-slider-mass').value = mass;
      if ($('#bd-lbl-mass')) $('#bd-lbl-mass').textContent = `${Number(mass).toFixed(1)} kg`;
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

  show() {
    this.root?.classList.remove('hidden');
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
