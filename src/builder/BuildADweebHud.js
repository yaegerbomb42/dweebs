// BuildADweebHud.js — UI Cockpit & Control Panel for Build-A-Dweeb
//
// Provides interactive sliders, color pickers, trait buttons, combat DNA meters,
// name editor, random mutant generator, and "SEND TO ARENA" trigger.

import {
  BODY_SHAPES,
  APPENDAGES,
  FEET_TYPES,
  BROW_STYLES,
  MOUTH_STYLES,
  ARCHETYPE_PRESETS,
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
  }

  _notifyChange(patch) {
    (this.handlers.onConfigChange || this.handlers.onChange)?.(patch);
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
          <button class="bd-preset-btn" data-preset="titan_chonk" title="Titan Chonk">🦏 TITAN CHONK</button>
          <button class="bd-preset-btn" data-preset="speed_gremlin" title="Speed Gremlin">⚡ SPEED GREMLIN</button>
          <button class="bd-preset-btn" data-preset="sniper_bean" title="Sniper Bean">🎯 SNIPER BEAN</button>
          <button class="bd-preset-btn" data-preset="pugilist_champ" title="Pugilist Champ">🥊 PUGILIST CHAMP</button>
        </div>
        <div class="bd-top-actions">
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
            <div class="bd-label">COLORS</div>
            <div style="display:flex; gap:12px; align-items:center;">
              <label style="font-size:12px; font-weight:800;">Primary: <input type="color" class="bd-color-picker" id="bd-col-primary" value="#ff4d5e"></label>
              <label style="font-size:12px; font-weight:800;">Accent: <input type="color" class="bd-color-picker" id="bd-col-accent" value="#ffd23f"></label>
            </div>
          </div>

          <div class="bd-row">
            <div class="bd-label">EYE COUNT &amp; SIZE</div>
            <div class="bd-seg" id="bd-seg-eyes" style="margin-bottom:6px;">
              <button class="bd-seg-btn" data-v="1">1 CYCLOPS</button>
              <button class="bd-seg-btn active" data-v="2">2 EYES</button>
              <button class="bd-seg-btn" data-v="3">3 ALIEN</button>
              <button class="bd-seg-btn" data-v="4">4 SPIDER</button>
            </div>
            <input type="range" class="bd-slider" id="bd-slider-eyesize" min="0.5" max="1.8" step="0.05" value="1.0">
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
        </div>

        <!-- Right Panel: Combat Stats & AI DNA -->
        <div class="bd-panel">
          <div class="bd-sec-title">🧠 COMBAT STATS &amp; AI DNA</div>

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
        btn.classList.add('active');

        if (preset) {
          this.syncForm(preset);
          this._notifyChange(preset);
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
    wireSlider('#bd-slider-eyesize', null, 'eyeSize');

    // DNA Sliders
    $('#bd-slider-conf').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-conf').textContent = v > 0.65 ? 'Berserk Rushdown' : v < 0.4 ? 'Elusive Kiter' : 'Balanced';
      this._notifyChange({ dna: { confidence: v } });
    });

    $('#bd-slider-aim').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-aim').textContent = v > 0.6 ? 'Sniper / Calculated' : 'Rapid Chaos Spam';
      this._notifyChange({ dna: { aimAccuracy: v } });
    });

    $('#bd-slider-agi').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-agi').textContent = v > 0.7 ? 'Hyper-Agile' : 'Steady';
      this._notifyChange({ dna: { agility: v }, stats: { speed: 0.7 + v * 0.6 } });
    });

    $('#bd-slider-scav').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('#bd-lbl-scav').textContent = v > 0.5 ? 'Toy / Bomb Hunter' : 'Fists & Kicks';
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
    if ($('#bd-slider-w')) $('#bd-slider-w').value = config.width || 1.0;
    if ($('#bd-slider-h')) $('#bd-slider-h').value = config.height || 1.0;
    if ($('#bd-lbl-w')) $('#bd-lbl-w').textContent = `${(config.width || 1.0).toFixed(2)}x`;
    if ($('#bd-lbl-h')) $('#bd-lbl-h').textContent = `${(config.height || 1.0).toFixed(2)}x`;

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
        if ($('#bd-lbl-conf')) $('#bd-lbl-conf').textContent = c > 0.65 ? 'Berserk Rushdown' : c < 0.4 ? 'Elusive Kiter' : 'Balanced';
      }
      if ($('#bd-slider-aim')) {
        const a = dna.aimAccuracy ?? 0.7;
        $('#bd-slider-aim').value = a;
        if ($('#bd-lbl-aim')) $('#bd-lbl-aim').textContent = a > 0.6 ? 'Sniper / Calculated' : 'Rapid Chaos Spam';
      }
      if ($('#bd-slider-agi')) {
        const ag = dna.agility ?? 0.75;
        $('#bd-slider-agi').value = ag;
        if ($('#bd-lbl-agi')) $('#bd-lbl-agi').textContent = ag > 0.7 ? 'Hyper-Agile' : 'Steady';
      }
      if ($('#bd-slider-scav')) {
        const sc = dna.scavenge ?? 0.6;
        $('#bd-slider-scav').value = sc;
        if ($('#bd-lbl-scav')) $('#bd-lbl-scav').textContent = sc > 0.5 ? 'Toy / Bomb Hunter' : 'Fists & Kicks';
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
  }

  show() {
    this.root?.classList.remove('hidden');
  }

  hide() {
    this.root?.classList.add('hidden');
  }

  dispose() {
    this.root?.remove();
  }
}
