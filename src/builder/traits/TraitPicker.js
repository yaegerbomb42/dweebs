// TraitPicker.js — searchable trait browser for the Build-A-Dweeb Lab.
// Toggle traits, watch the budget/power meters, see stat pushes and conflicts live.

import { TRAITS, TRAIT_BY_ID, CATEGORIES, CORE_STATS, TRAIT_COUNT, RARITIES } from './TraitCatalog.js';
import { loadCollection, saveCollection, isOwned, ownedTraits, unlockHint } from './TraitCollection.js';
import { normalizeBuild, conflictsFor, TRAIT_BUDGET, MAX_TRAITS, POWER_CAP, PRODUCT_CAPS, generateBuild, rawStats, applyCouplings, corePoints, CORE_MIN, CORE_MAX, resolveTraitConflicts } from './TraitBalance.js';

const css = `
#tp-root{position:fixed;inset:0;z-index:960;background:rgba(20,16,28,.55);display:flex;align-items:center;justify-content:center;font-family:'Lilita One',system-ui,sans-serif;color:#14101c}
#tp-win{width:min(1100px,96vw);height:min(720px,92vh);background:#fff8ee;border:4px solid #14101c;border-radius:18px;box-shadow:0 8px 0 #14101c;display:grid;grid-template-columns:1fr 330px;overflow:hidden}
#tp-left{display:flex;flex-direction:column;min-height:0;padding:12px;border-right:3px solid #14101c}
#tp-list{overflow:auto;flex:1;margin-top:8px;font-family:system-ui;font-size:13px}
.tp-row{display:flex;align-items:center;gap:8px;padding:5px 7px;border:2px solid #14101c;border-radius:9px;margin:4px 0;background:#fff;cursor:pointer}
.tp-row.on{background:#d8f8dc}.tp-row.bad{background:#ffe1e1}
.tp-row b{font-family:'Lilita One',system-ui;font-size:14px;min-width:170px}
.tp-chip{display:inline-block;font-size:11px;padding:1px 5px;border-radius:6px;margin:1px}
.up{background:#c9f5cf}.dn{background:#ffd2d2}
.tp-tab{font-family:inherit;border:2px solid #14101c;border-radius:9px;padding:4px 9px;margin:2px;background:#fff;cursor:pointer}
.tp-tab.on{background:#ffd23f}
#tp-right{padding:12px;overflow:auto;font-size:13px}
.tp-meter{height:14px;border:2px solid #14101c;border-radius:7px;background:#eee;overflow:hidden;margin:3px 0 8px}
.tp-meter i{display:block;height:100%}
.tp-stat{display:grid;grid-template-columns:86px 1fr 34px;gap:5px;align-items:center;font-family:system-ui;font-size:11px;margin:1px 0}
.tp-stat .b{height:8px;background:#eee;border-radius:4px;position:relative;overflow:hidden}
.tp-stat .b i{position:absolute;top:0;bottom:0;background:#2f6fe0}.tp-stat .b em{position:absolute;top:0;bottom:0;border-right:2px dashed #ff6b6b}
.tp-c{font:bold 11px system-ui;width:18px;height:18px;border:2px solid #14101c;border-radius:5px;background:#ffd23f;cursor:pointer;padding:0;margin:0 2px}
.tp-btn{font-family:inherit;font-size:14px;background:#ffd23f;border:3px solid #14101c;border-radius:10px;padding:5px 10px;cursor:pointer;box-shadow:0 3px 0 #14101c;margin:2px}
`;

export class TraitPicker {
  constructor({ traits = [], core = {}, onChange, onBrawl, onWilds, onClose } = {}) {
    this.coll = loadCollection();
    this.sel = traits.filter(id => isOwned(this.coll, id));
    this.core = { ...core };
    this.onChange = onChange; this.onBrawl = onBrawl; this.onWilds = onWilds; this.onClose = onClose;
    this.cat = 'owned'; this.q = ''; this.limit = 150;
    const root = document.createElement('div'); root.id = 'tp-root';
    root.innerHTML = `<style>${css}</style><div id="tp-win">
      <div id="tp-left">
        <div style="display:flex;align-items:center;gap:8px"><span style="font-size:24px">🧬 TRAIT LAB</span><small style="font-family:system-ui;opacity:.7">${TRAIT_COUNT} traits · ${CORE_STATS.length} core stats</small>
          <input id="tp-q" placeholder="Search traits or stats (e.g. speed, coward, slide)…" style="flex:1;font-size:14px;padding:6px 9px;border:2px solid #14101c;border-radius:9px"></div>
        <div id="tp-tabs" style="margin-top:6px"></div>
        <div id="tp-list"></div>
      </div>
      <div id="tp-right"></div></div>`;
    document.body.appendChild(root); this.root = root;
    root.querySelector('#tp-q').addEventListener('input', e => { this.q = e.target.value.trim().toLowerCase(); this.limit = 150; this.renderList(); });
    root.addEventListener('click', e => { if (e.target === root) this.close(); });
    this._key = e => { if (e.key === 'Escape') this.close(); };
    window.addEventListener('keydown', this._key);
    this.renderTabs(); this.render();
  }

  emit() { this.onChange?.(this.sel, this.core); }

  close() { window.removeEventListener('keydown', this._key); this.root.remove(); this.onClose?.(this.sel); }

  toggle(id) {
    if (!isOwned(this.coll, id)) return;
    if (this.sel.includes(id)) this.sel = this.sel.filter(x => x !== id);
    else {
      // newest toggle wins: drop whatever it conflicts with
      const clash = conflictsFor(id, this.sel);
      this.sel = [id, ...this.sel.filter(x => !clash.includes(x))];
    }
    this.sel = normalizeBuild(this.sel, this.core).traits;
    this.emit();
    this.render();
  }

  renderTabs() {
    const el = this.root.querySelector('#tp-tabs');
    el.innerHTML = [{ id: 'owned', label: 'Collection', icon: '🎒' }, { id: 'on', label: 'Equipped', icon: '✅' }, { id: 'all', label: 'All (incl. locked)', icon: '🔒' }, ...CATEGORIES].map(c => `<button class="tp-tab ${this.cat === c.id ? 'on' : ''}" data-c="${c.id}">${c.icon} ${c.label}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this.cat = b.dataset.c; this.limit = 150; this.renderTabs(); this.renderList(); }));
  }

  render() { this.renderList(); this.renderSide(); }

  renderList() {
    const q = this.q;
    let list = TRAITS.filter(t => (this.cat === 'all' || (this.cat === 'owned' ? isOwned(this.coll, t.id) : this.cat === 'on' ? this.sel.includes(t.id) : t.cat === this.cat)));
    if (q) list = list.filter(t => t.name.toLowerCase().includes(q) || t.tags.some(g => g.includes(q)) || Object.keys(t.fx).some(k => k.toLowerCase().includes(q)));
    const total = list.length;
    list = list.slice(0, this.limit);
    const el = this.root.querySelector('#tp-list');
    el.innerHTML = list.map(t => {
      const on = this.sel.includes(t.id);
      const own = isOwned(this.coll, t.id);
      const rar = RARITIES.find(r => r.id === t.rarity);
      if (!own) return `<div class="tp-row" style="opacity:.55;cursor:default" title="${unlockHint(t)}">🔒<b>${t.name}</b><span style="color:${rar.color}">${rar.label}</span><span>${unlockHint(t)}</span></div>`;
      const clash = on ? [] : conflictsFor(t.id, this.sel);
      const chips = Object.entries(t.fx).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => `<span class="tp-chip ${v > 0 ? 'up' : 'dn'}">${v > 0 ? '▲' : '▼'}${k} ${Math.round(Math.abs(v) * 100)}</span>`).join('');
      const note = clash.length ? `<span style="color:#c0262d"> ⚠ replaces ${clash.map(c => TRAIT_BY_ID.get(c).name).join(', ')}</span>` : '';
      return `<div class="tp-row ${on ? 'on' : clash.length ? 'bad' : ''}" data-id="${t.id}"><input type="checkbox" ${on ? 'checked' : ''} style="pointer-events:none"><b style="color:${rar.color === '#9aa3b0' ? '#14101c' : rar.color}">${t.name}</b><span style="min-width:44px">${t.cost} pts</span><span>${chips}${note}</span></div>`;
    }).join('') + (total > list.length ? `<button class="tp-btn" id="tp-more">Show more (${total - list.length} left)</button>` : '') + `<div style="opacity:.6;margin:6px">${total} matching traits</div>`;
    el.querySelectorAll('.tp-row').forEach(r => r.addEventListener('click', () => this.toggle(r.dataset.id)));
    el.querySelector('#tp-more')?.addEventListener('click', () => { this.limit += 300; this.renderList(); });
  }

  renderSide() {
    const b = normalizeBuild(this.sel, this.core);
    const pre = applyCouplings(rawStats(b.traits, this.core));
    const pct = Math.min(100, (b.points / TRAIT_BUDGET) * 100);
    const pw = Math.min(100, (b.power / POWER_CAP) * 100);
    const capsHit = PRODUCT_CAPS.filter(c => { const xa = Math.max(0, pre[c.a] - 0.5) / 0.5, xb = Math.max(0, pre[c.b] - 0.5) / 0.5; return xa * xb > c.cap; });
    const el = this.root.querySelector('#tp-right');
    el.innerHTML = `
      <div style="font-family:system-ui;font-size:12px;margin-bottom:6px">🎒 ${ownedTraits(this.coll).length}/${TRAIT_COUNT} discovered
        <label style="margin-left:6px"><input type="checkbox" id="tp-sandbox" ${this.coll.sandbox ? 'checked' : ''}> Sandbox: all unlocked</label></div>
      <div style="font-size:18px">Budget ${b.points}/${TRAIT_BUDGET} pts</div>
      <div class="tp-meter"><i style="width:${pct}%;background:${b.points > TRAIT_BUDGET ? '#ff4d5e' : '#5ee06a'}"></i></div>
      ${b.points > TRAIT_BUDGET ? `<div style="color:#c0262d;font-family:system-ui">Over budget: every bonus squeezed to ${(b.budgetScale * 100).toFixed(0)}%.</div>` : ''}
      <div style="font-size:16px">Power ${(b.power / POWER_CAP * 100).toFixed(0)}% of cap ${b.shrink < 1 ? '<span style="color:#c0262d">(capped)</span>' : ''}</div>
      <div class="tp-meter"><i style="width:${pw}%;background:#b25ee0"></i></div>
      <div style="font-family:system-ui;font-size:11px;margin-bottom:6px">${b.traits.length}/${MAX_TRAITS} equip slots used${this.flash ? ` · 🎰 rolled <b>${this.flash}</b>` : ''}${capsHit.length ? `<br><span style="color:#c0262d">Trade-off limits hit: ${capsHit.map(c => c.label).join(', ')}</span>` : ''}</div>
      ${CORE_STATS.map(s => {
        const v = b.stats[s.id], raw = rawStats(b.traits, this.core)[s.id];
        const n = this.core[s.id] || 0;
        const ctl = s.group === 'mind' ? '<span></span>' : `<span style="white-space:nowrap"><button class="tp-c" data-s="${s.id}" data-d="-1">−</button>${n > 0 ? '+' : ''}${n}<button class="tp-c" data-s="${s.id}" data-d="1">+</button></span>`;
        return `<div class="tp-stat" style="grid-template-columns:86px 1fr 34px 64px" title="${s.group}"><span>${s.label}</span><span class="b"><i style="width:${(v * 100).toFixed(0)}%;background:${s.group === 'mind' ? '#b25ee0' : s.group === 'combat' ? '#f28a1e' : '#2f6fe0'}"></i>${Math.abs(raw - v) > 0.02 ? `<em style="width:${Math.min(100, Math.max(0, raw * 100)).toFixed(0)}%"></em>` : ''}</span><span>${Math.round(v * 100)}</span>${ctl}</div>`;
      }).join('')}
      <div style="font-family:system-ui;font-size:10px;opacity:.7;margin:4px 0">± buttons hand-pick core stat points (${corePoints(this.core)} pts; raising gets pricier each step, lowering refunds a little). Dashed line = what the traits asked for, before trade-offs and caps.</div>
      <div style="margin-top:8px"><button class="tp-btn" id="tp-rand">🎲 Randomize</button><button class="tp-btn" id="tp-roul" style="background:#ff9ee0">🎰 Mutation Roulette</button><button class="tp-btn" id="tp-clear" style="background:#ff6b6b">Clear</button></div>
      <div><button class="tp-btn" id="tp-brawl" style="background:#7dd3fc">🤖 Brawl Sim</button><button class="tp-btn" id="tp-wilds" style="background:#5ee06a">🌲 Dweeb Wilds</button><button class="tp-btn" id="tp-done" style="background:#5ee06a">✔ Done</button></div>`;
    el.querySelector('#tp-rand').addEventListener('click', () => {
      this.core = {}; this.sel = generateBuild((Date.now() & 0xffffff) + 1, ownedTraits(this.coll), MAX_TRAITS); this.emit(); this.render();
    });
    el.querySelector('#tp-roul').addEventListener('click', () => {
      // swap one equipped trait (or fill an empty slot) with a random legal trait from your collection
      const pool = ownedTraits(this.coll).filter(t => !this.sel.includes(t.id));
      for (let tries = 0; tries < 40 && pool.length; tries++) {
        const t = pool[Math.floor(Math.random() * pool.length)];
        const base = this.sel.length >= MAX_TRAITS || Math.random() < 0.6 ? this.sel.filter((_, i) => i !== Math.floor(Math.random() * this.sel.length)) : [...this.sel];
        const { kept } = resolveTraitConflicts([t.id, ...base]);
        if (kept.includes(t.id) && normalizeBuild(kept, this.core).points <= TRAIT_BUDGET) { this.sel = kept; this.flash = t.name; break; }
      }
      this.emit(); this.render();
    });
    el.querySelector('#tp-sandbox').addEventListener('change', e => { this.coll.sandbox = e.target.checked; saveCollection(this.coll); this.sel = this.sel.filter(id => isOwned(this.coll, id)); this.emit(); this.render(); });
    el.querySelectorAll('.tp-c').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.s; const n = Math.max(CORE_MIN, Math.min(CORE_MAX, (this.core[k] || 0) + +btn.dataset.d));
      if (n) this.core[k] = n; else delete this.core[k];
      this.emit(); this.renderSide();
    }));
    el.querySelector('#tp-clear').addEventListener('click', () => { this.sel = []; this.emit(); this.render(); });
    el.querySelector('#tp-done').addEventListener('click', () => this.close());
    el.querySelector('#tp-brawl').addEventListener('click', () => { this.close(); this.onBrawl?.(); });
    el.querySelector('#tp-wilds').addEventListener('click', () => { this.close(); this.onWilds?.(); });
  }
}
