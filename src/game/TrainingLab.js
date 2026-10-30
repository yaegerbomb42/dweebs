// TrainingLab.js — offline Free Play: no timer, endless stocks, dummies you
// can switch between stand / walk / fight, an item palette, slow-mo and a
// live damage + combo readout. Owns only its DOM panel; main.js asks it for
// a time scale and whether a given bot should think this frame.

const ITEMS = [
  ['giantHammer', '🔨'], ['boxingGlove', '🥊'], ['melonCannon', '🍉'], ['explodingMelon', '💥'],
  ['spikyBall', '🦔'], ['freezeRay', '❄️'], ['magnet', '🧲'], ['rubberChicken', '🐔'],
  ['bowlingBall', '🎳'], ['explosiveBarrel', '🛢️'],
];
const SPEEDS = [1, 0.5, 0.25];
const DUMMY = ['stand', 'walk', 'fight'];

export class TrainingLab {
  constructor({ arena, getPlayer, getDweebs, onReset }) {
    this.arena = arena;
    this.getPlayer = getPlayer;
    this.getDweebs = getDweebs;
    this.onReset = onReset;
    this.speedIdx = 0;
    this.dummyIdx = 0;
    this.combo = 0;
    this.comboDmg = 0;
    this.comboTimer = 0;
    this.best = 0;
    this.lastHit = 0;
    this._t = 0;
    this._build();
  }

  get timeScale() { return SPEEDS[this.speedIdx]; }
  get dummyMode() { return DUMMY[this.dummyIdx]; }

  /** Called from main when any dweeb takes damage. */
  noteHit(victim, damage) {
    if (victim?.isPlayer) return;
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboDmg = (this.comboTimer > 0 ? this.comboDmg : 0) + damage;
    this.comboTimer = 1.1;
    this.lastHit = damage;
    if (this.combo > this.best) this.best = this.combo;
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'training-panel';
    el.innerHTML = `
      <div class="tl-title">🧪 TRAINING LAB <span class="tl-keys">[R] reset · [T] slow-mo · [Y] dummy</span></div>
      <div class="tl-row">
        <button data-tl="reset">↺ Reset</button>
        <button data-tl="speed">⏱ 1×</button>
        <button data-tl="dummy">🎯 Dummy: stand</button>
        <button data-tl="clear">🧹 Clear items</button>
      </div>
      <div class="tl-row tl-items">${ITEMS.map(([k, i]) => `<button data-item="${k}" title="${k}">${i}</button>`).join('')}</div>
      <div class="tl-read"><span data-r="last">last hit —</span><span data-r="combo">combo 0</span><span data-r="best">best 0</span><span data-r="pct"></span></div>`;
    const css = document.createElement('style');
    css.textContent = `#training-panel{position:fixed;left:12px;bottom:12px;z-index:40;background:rgba(14,18,34,.82);color:#fff;
      font:600 12px system-ui;padding:8px 10px;border-radius:12px;border:2px solid #7c5cff;max-width:360px;pointer-events:auto}
      #training-panel button{background:#2a2f52;color:#fff;border:0;border-radius:7px;padding:4px 7px;margin:2px;cursor:pointer;font:inherit}
      #training-panel button:hover{background:#7c5cff}.tl-title{color:#c9b8ff;margin-bottom:4px}.tl-keys{opacity:.6;font-weight:400}
      .tl-items button{font-size:15px;padding:2px 5px}.tl-read{display:flex;gap:10px;margin-top:4px;color:#ffd23f}
      .tl-read .pop{animation:tlPop .25s ease-out}@keyframes tlPop{from{transform:scale(1.5)}to{transform:none}}`;
    el.appendChild(css);
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      b.blur();
      if (b.dataset.item) return this.spawn(b.dataset.item);
      this.action(b.dataset.tl);
    });
    this._key = e => {
      if (e.repeat) return;
      if (e.code === 'KeyR') this.action('reset');
      else if (e.code === 'KeyT') this.action('speed');
      else if (e.code === 'KeyY') this.action('dummy');
    };
    window.addEventListener('keydown', this._key);
    document.body.appendChild(el);
    this.el = el;
  }

  action(a) {
    if (a === 'reset') {
      for (const d of this.getDweebs()) { d.percent = 0; d.eliminated = false; }
      this.onReset?.();
      this.combo = 0; this.comboTimer = 0;
    } else if (a === 'speed') {
      this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
      this.el.querySelector('[data-tl="speed"]').textContent = `⏱ ${SPEEDS[this.speedIdx]}×`;
    } else if (a === 'dummy') {
      this.dummyIdx = (this.dummyIdx + 1) % DUMMY.length;
      this.el.querySelector('[data-tl="dummy"]').textContent = `🎯 Dummy: ${this.dummyMode}`;
    } else if (a === 'clear') {
      for (const o of [...(this.arena.objects || [])]) {
        if (o._trainingSpawn && !this.getDweebs().some(d => d.held === o)) { o.destroy?.(); this.arena.objects.splice(this.arena.objects.indexOf(o), 1); }
      }
    }
  }

  spawn(key) {
    const p = this.getPlayer()?.getPosition();
    if (!p) return;
    const yaw = this.getPlayer().yaw || 0;
    const obj = this.arena.spawnItem(key, { x: p.x - Math.sin(yaw) * 2, y: p.y + 2.5, z: p.z - Math.cos(yaw) * 2 });
    if (obj) obj._trainingSpawn = true;
  }

  /** Should this bot run its AI this frame? 'walk' thinks at a lazy 1-in-3 cadence. */
  botActive() {
    if (this.dummyIdx === 2) return true;
    if (this.dummyIdx === 1) return (this._t * 20 | 0) % 3 === 0;
    return false;
  }

  update(dt) {
    this._t += dt;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    const q = s => this.el.querySelector(`[data-r="${s}"]`);
    const set = (s, t) => { const n = q(s); if (n.textContent !== t) { n.textContent = t; n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); } };
    set('last', this.lastHit ? `last hit ${this.lastHit.toFixed(1)}%` : 'last hit —');
    set('combo', this.combo > 1 ? `combo ${this.combo} (${Math.round(this.comboDmg)}%)` : 'combo 0');
    set('best', `best ${this.best}`);
    const dummies = this.getDweebs().filter(d => !d.isPlayer);
    // Damage readout without hooking combat: diff each dummy's percent.
    for (const d of dummies) {
      const prev = d._tlPct ?? d.percent;
      if (d.percent > prev + 0.01) this.noteHit(d, d.percent - prev);
      d._tlPct = d.percent;
    }
    set('pct', dummies.length ? `dummy ${Math.round(dummies[0].percent)}%` : '');
  }

  dispose() {
    window.removeEventListener('keydown', this._key);
    this.el?.remove();
    this.el = null;
  }
}
