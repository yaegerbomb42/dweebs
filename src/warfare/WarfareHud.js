// WarfareHud.js — all Dweeb Warfare DOM: start screen with tutorial hints, top bar, recruit
// cards, wave banners, toasts, pause and the win/lose screen. Self-contained (injects its CSS).
import { UNIT_TYPES, RECRUITABLE, COUNTER_OF } from '../sim/warfareUnits.js';
import { FINAL_WAVE, isBossWave } from '../sim/warfareWaves.js';
import { WF_HZ } from '../sim/warfareBattle.js';

const CSS = `
.wf-root{position:fixed;inset:0;pointer-events:none;z-index:40;font-family:Nunito,system-ui,sans-serif;color:#fff8ee;user-select:none}
.wf-root *{box-sizing:border-box}
.wf-root .wf-hidden{display:none!important}
.wf-root button{pointer-events:auto;font-family:'Lilita One',Nunito,sans-serif;cursor:pointer;border:0;border-radius:14px;padding:10px 18px;font-size:18px;letter-spacing:.5px;color:#1b1030;background:#ffd23f;box-shadow:0 4px 0 #b88a12;transition:transform .08s}
.wf-root button:hover{transform:translateY(-2px)}
.wf-root button:active{transform:translateY(2px);box-shadow:0 1px 0 #b88a12}
.wf-root button.alt{background:#fff8ee;box-shadow:0 4px 0 #b9ad9b}
.wf-root button.blue{background:#3fa9ff;color:#fff;box-shadow:0 4px 0 #1f6fb0}
.wf-root button.red{background:#ff4d5e;color:#fff;box-shadow:0 4px 0 #a82534}
.wf-root button:disabled{opacity:.45;transform:none;cursor:default}
.wf-screen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(27,16,48,.55);backdrop-filter:blur(3px);pointer-events:auto}
.wf-panel{background:#2a1d4a;border:4px solid #fff8ee;border-radius:24px;padding:26px 30px;max-width:720px;width:92vw;box-shadow:0 12px 0 rgba(0,0,0,.25);text-align:center}
.wf-title{font-family:'Lilita One',sans-serif;font-size:56px;line-height:1;margin:0;color:#ffd23f;text-shadow:0 4px 0 #b84a12}
.wf-sub{margin:8px 0 16px;font-weight:700;opacity:.9}
.wf-hints{text-align:left;margin:0 auto 18px;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;font-size:14px;font-weight:700}
.wf-hints li{background:rgba(255,255,255,.07);border-radius:12px;padding:8px 10px}
.wf-hints b{color:#ffd23f}
.wf-modes{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.wf-small{font-size:13px;opacity:.75;margin-top:12px}
.wf-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center}
.wf-chip{background:rgba(27,16,48,.78);border:3px solid #fff8ee;border-radius:14px;padding:6px 12px;font-family:'Lilita One',sans-serif;font-size:18px;white-space:nowrap}
.wf-chip.boss{background:#a82534}
.wf-fort{width:180px}
.wf-bar{height:12px;border-radius:7px;background:rgba(255,255,255,.2);overflow:hidden;margin-top:3px}
.wf-bar i{display:block;height:100%;background:#5ee06a;transition:width .2s}
.wf-bar.low i{background:#ff4d5e}
.wf-count .b{color:#7cc4ff}.wf-count .r{color:#ff8a95}
.wf-corner{position:absolute;top:10px;right:12px;display:flex;gap:8px}
.wf-corner button{padding:6px 12px;font-size:16px}
.wf-prep{position:absolute;top:110px;left:50%;transform:translateX(-50%);text-align:center}
.wf-prep button{font-size:20px}
.wf-prep .t{font-family:'Lilita One',sans-serif;font-size:20px;text-shadow:0 2px 0 #1b1030;margin-bottom:6px}
.wf-cards{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:10px}
.wf-card{pointer-events:auto;cursor:pointer;width:128px;background:rgba(27,16,48,.85);border:3px solid #fff8ee;border-radius:16px;padding:8px;text-align:center;transition:transform .08s}
.wf-card:hover{transform:translateY(-4px)}
.wf-card.off{opacity:.45}
.wf-card.pop{animation:wfpop .25s}
@keyframes wfpop{50%{transform:scale(1.12)}}
.wf-card .k{position:absolute;margin:-14px 0 0 -14px;background:#ffd23f;color:#1b1030;border-radius:8px;padding:0 7px;font-family:'Lilita One',sans-serif}
.wf-card .n{font-family:'Lilita One',sans-serif;font-size:18px}
.wf-card .c{color:#ffd23f;font-weight:900}
.wf-card .h{font-size:11px;opacity:.85;line-height:1.2;margin-top:2px}
.wf-card .ic{height:34px;display:flex;align-items:center;justify-content:center;font-size:26px}
.wf-banner{position:absolute;top:28%;left:0;right:0;text-align:center;font-family:'Lilita One',sans-serif;font-size:64px;color:#ffd23f;text-shadow:0 5px 0 #b84a12,0 0 30px rgba(0,0,0,.4);opacity:0;transform:scale(.6);transition:opacity .2s,transform .25s cubic-bezier(.2,1.6,.4,1)}
.wf-banner.show{opacity:1;transform:scale(1)}
.wf-banner.boss{color:#ff4d5e;text-shadow:0 5px 0 #5a0f18}
.wf-banner.good{color:#5ee06a;text-shadow:0 5px 0 #1d6b26}
.wf-banner small{display:block;font-size:22px;color:#fff8ee;text-shadow:0 2px 0 #1b1030}
.wf-feed{position:absolute;left:12px;bottom:150px;display:flex;flex-direction:column;gap:6px;max-width:340px}
.wf-toast{background:rgba(27,16,48,.85);border-left:5px solid #ffd23f;border-radius:10px;padding:7px 11px;font-weight:700;font-size:14px;animation:wfin .25s}
.wf-toast b{color:#ffd23f}
@keyframes wfin{from{transform:translateX(-30px);opacity:0}}
.wf-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}
.wf-stat{background:rgba(255,255,255,.08);border-radius:14px;padding:10px}
.wf-stat b{display:block;font-family:'Lilita One',sans-serif;font-size:28px;color:#ffd23f}
.wf-stat span{font-size:12px;font-weight:700;opacity:.85}
.wf-net{position:absolute;top:10px;left:12px}
.wf-boss{position:absolute;top:62px;left:50%;transform:translateX(-50%);width:min(420px,80vw);background:rgba(90,15,24,.85);border:3px solid #ffd23f;border-radius:14px;padding:5px 12px;font-family:'Lilita One',sans-serif;text-align:center}
.wf-boss .wf-bar i{background:#ffd23f}
.wf-boss.enraged{animation:wfrage .4s infinite alternate}
@keyframes wfrage{to{border-color:#ff4d5e}}
.wf-dmg-layer{position:fixed;inset:0;pointer-events:none;z-index:39;overflow:hidden}
.wf-dmg{position:absolute;left:0;top:0;font-family:'Lilita One',sans-serif;font-size:18px;color:#fff;text-shadow:0 2px 0 #1b1030,0 0 4px #1b1030;opacity:0;white-space:nowrap;will-change:transform}
.wf-dmg.crit{color:#ffd23f;font-size:24px}
.wf-dmg.weak{color:#c9c4d6;font-size:14px}
.wf-dmg.word{color:#5ee06a;font-size:22px}
body.warfare-active #hud>*{display:none!important}
@media (max-width:640px){.wf-card{width:84px}.wf-card .h{display:none}.wf-title{font-size:40px}.wf-hints{grid-template-columns:1fr}.wf-fort{width:120px}}
`;

const ICON = { shield: '🛡️', rocket: '🚀', stealer: '🥷', kami: '💣' };

export class WarfareHud {
  constructor(cb) {
    this.cb = cb;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const root = this.root = document.createElement('div');
    root.className = 'wf-root';
    root.innerHTML = `
      <div class="wf-screen" data-s="title">
        <div class="wf-panel">
          <h1 class="wf-title">DWEEB WARFARE</h1>
          <p class="wf-sub">Command a toy-box army. Hold your brass fort for ${FINAL_WAVE} waves.</p>
          <ul class="wf-hints">
            <li><b>Click the board</b> to plant your rally flag. Your army holds there.</li>
            <li><b>Keys 1–4</b> (or tap a card) recruit units at your fort with coins.</li>
            <li><b>Counters:</b> Shield ▶ Rocket ▶ Stealer ▶ Kami ▶ Shield.</li>
            <li><b>Stealers</b> drag enemies home to convert them, and flip kami fuses.</li>
            <li><b>Space</b> starts the next wave early. Kills and clears pay coins.</li>
            <li><b>Boss every 5 waves.</b> Kamis hit the Brass Bully hardest.</li>
          </ul>
          <div class="wf-modes">
            <button data-a="defense">DEFEND THE FORT</button>
            <button class="blue" data-a="versus">VERSUS AI</button>
            <button class="alt" data-a="online-coop">ONLINE CO-OP</button>
            <button class="alt" data-a="online-versus">ONLINE VERSUS</button>
          </div>
          <div class="wf-small"><span data-f="best"></span> · WASD/arrows pan · wheel zooms · M mutes · Esc pauses</div>
          <div style="margin-top:14px"><button class="alt" data-a="exit">◀ BACK TO THE MALL</button></div>
        </div>
      </div>
      <div class="wf-game wf-hidden" data-s="game">
        <div class="wf-net wf-chip wf-hidden" data-f="net"></div>
        <div class="wf-top">
          <div class="wf-chip" data-f="wave">WAVE 1/${FINAL_WAVE}</div>
          <div class="wf-chip wf-fort"><span data-f="fortLabel">YOUR FORT</span><div class="wf-bar" data-f="fortBar"><i></i></div></div>
          <div class="wf-chip wf-fort wf-hidden" data-f="efort"><span>ENEMY FORT</span><div class="wf-bar"><i></i></div></div>
          <div class="wf-chip">🪙 <span data-f="coins">0</span></div>
          <div class="wf-chip wf-count"><span class="b" data-f="nb">0</span> vs <span class="r" data-f="nr">0</span></div>
        </div>
        <div class="wf-corner">
          <button class="alt" data-a="mute" title="Mute (M)">🔊</button>
          <button class="alt" data-a="pause" title="Pause (Esc)">❚❚</button>
        </div>
        <div class="wf-boss wf-hidden" data-f="boss"><span>⚙️ BRASS BULLY</span><div class="wf-bar"><i></i></div></div>
        <div class="wf-prep" data-f="prep">
          <div class="t" data-f="prepText"></div>
          <button data-a="startWave">START WAVE (SPACE)</button>
        </div>
        <div class="wf-cards">${RECRUITABLE.map((t, i) => `
          <div class="wf-card" data-u="${t}"><span class="k">${i + 1}</span>
            <div class="ic">${ICON[t]}</div>
            <div class="n">${UNIT_TYPES[t].name}</div>
            <div class="c">🪙 ${UNIT_TYPES[t].cost}</div>
            <div class="h">beats ${beatsText(t)}<br>fear ${UNIT_TYPES[COUNTER_OF[t]].name.toLowerCase()}s</div>
          </div>`).join('')}
        </div>
        <div class="wf-feed" data-f="feed"></div>
        <div class="wf-banner" data-f="banner"></div>
      </div>
      <div class="wf-screen wf-hidden" data-s="online">
        <div class="wf-panel">
          <h1 class="wf-title" data-f="onTitle">ONLINE</h1>
          <p class="wf-sub" data-f="onStatus">Connecting…</p>
          <p class="wf-sub" data-f="onCode"></p>
          <div class="wf-modes" style="margin-bottom:10px">
            <input data-f="codeIn" maxlength="4" placeholder="CODE" style="pointer-events:auto;width:110px;text-transform:uppercase;font-family:'Lilita One',sans-serif;font-size:20px;text-align:center;border-radius:12px;border:3px solid #fff8ee;background:#1b1030;color:#fff8ee;padding:6px">
            <button class="blue" data-a="joinCode">JOIN FRIEND</button>
          </div>
          <div class="wf-modes"><button class="alt" data-a="cancelOnline">CANCEL</button></div>
        </div>
      </div>
      <div class="wf-screen wf-hidden" data-s="pause">
        <div class="wf-panel">
          <h1 class="wf-title">PAUSED</h1>
          <p class="wf-sub">Counters: Shield ▶ Rocket ▶ Stealer ▶ Kami ▶ Shield</p>
          <div class="wf-modes"><button data-a="resume">RESUME</button><button class="alt" data-a="restart">RESTART</button><button class="alt" data-a="quit">QUIT TO MENU</button></div>
        </div>
      </div>
      <div class="wf-screen wf-hidden" data-s="end">
        <div class="wf-panel">
          <h1 class="wf-title" data-f="endTitle">VICTORY!</h1>
          <p class="wf-sub" data-f="endSub"></p>
          <div class="wf-stats" data-f="stats"></div>
          <div class="wf-modes"><button data-a="restart">PLAY AGAIN</button><button class="alt" data-a="quit">MENU</button><button class="alt" data-a="exit">BACK TO THE MALL</button></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    this.q = s => root.querySelector(s);
    this.f = name => root.querySelector(`[data-f="${name}"]`);
    root.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const u = e.target.closest('[data-u]')?.dataset.u;
      if (a) this.cb.onAction?.(a);
      if (u) this.cb.onRecruit?.(u);
    });
    // keep clicks on HUD from reaching the board
    root.addEventListener('pointerdown', e => { if (e.target.closest('button,.wf-card,.wf-screen')) e.stopPropagation(); });
    this.bannerT = 0;
    this.last = {};
    this.refreshBest();
  }

  screen(name) {
    for (const s of ['title', 'game', 'pause', 'end', 'online']) this.q(`[data-s="${s}"]`).classList.toggle('wf-hidden', !(s === name || (s === 'game' && (name === 'pause' || name === 'end'))));
  }

  refreshBest() {
    const best = +localStorage.getItem('dweebs-warfare-best') || 0;
    this.f('best').textContent = best ? `Best: wave ${best}${best >= FINAL_WAVE ? ' (fort held!)' : ''}` : 'No record yet';
  }

  setMute(m) { this.q('[data-a="mute"]').textContent = m ? '🔇' : '🔊'; }

  setNet(text) {
    const el = this.f('net');
    el.classList.toggle('wf-hidden', !text);
    el.textContent = text || '';
  }

  onlineStatus({ title, status, code }) {
    if (title !== undefined) this.f('onTitle').textContent = title;
    if (status !== undefined) this.f('onStatus').textContent = status;
    if (code !== undefined) this.f('onCode').innerHTML = code ? `Invite a friend with code <b style="color:#ffd23f;font-size:22px">${code}</b>` : '';
  }

  get codeInput() { return this.f('codeIn').value.trim().toUpperCase(); }

  setModeButtons({ online }) {
    for (const a of ['online-coop', 'online-versus']) {
      const b = this.q(`[data-a="${a}"]`);
      b.disabled = !online;
      b.title = online ? '' : 'Online needs the dweebs server';
    }
  }

  update(st, team, dt) {
    const L = this.last;
    const set = (k, v, fn) => { if (L[k] !== v) { L[k] = v; fn(v); } };
    const versus = st.mode === 'versus';
    set('wave', versus ? 'VERSUS' : `${st.wave}|${isBossWave(st.wave)}`, () => {
      const el = this.f('wave');
      el.textContent = versus ? 'VERSUS' : `WAVE ${Math.max(1, st.wave)}/${FINAL_WAVE}${isBossWave(st.wave) ? ' · BOSS' : ''}`;
      el.classList.toggle('boss', !versus && isBossWave(st.wave));
    });
    const mine = st.forts[team], theirs = st.forts[team === 'blue' ? 'red' : 'blue'];
    set('fort', Math.ceil(mine.hp), () => {
      const p = Math.max(0, mine.hp / mine.maxHp);
      const bar = this.f('fortBar');
      bar.firstElementChild.style.width = (p * 100).toFixed(1) + '%';
      bar.classList.toggle('low', p < 0.3);
    });
    set('efortShow', versus, v => this.f('efort').classList.toggle('wf-hidden', !v));
    if (versus) set('efort', Math.ceil(theirs.hp), () => {
      const p = Math.max(0, theirs.hp / theirs.maxHp);
      this.f('efort').querySelector('i').style.width = (p * 100).toFixed(1) + '%';
    });
    const coins = st.coins[team];
    set('coins', coins, v => { this.f('coins').textContent = v; });
    let nb = 0, nr = 0;
    for (const u of st.units) { if (u.team === 'blue') nb++; else nr++; }
    set('nb', nb, v => { this.f('nb').textContent = v; });
    set('nr', nr, v => { this.f('nr').textContent = v; });
    set('coinsCards', coins, () => {
      for (const c of this.root.querySelectorAll('.wf-card')) c.classList.toggle('off', coins < UNIT_TYPES[c.dataset.u].cost);
    });
    let boss = null;
    for (const u of st.units) if (u.type === 'boss') { boss = u; break; }
    set('bossShow', !!boss, v => this.f('boss').classList.toggle('wf-hidden', !v));
    if (boss) {
      set('bossHp', Math.ceil(boss.hp), () => { this.f('boss').querySelector('i').style.width = Math.max(0, boss.hp / boss.maxHp * 100).toFixed(1) + '%'; });
      set('bossRage', boss.enraged, v => this.f('boss').classList.toggle('enraged', v));
    }
    const prep = st.phase === 'prep';
    set('prep', prep, v => this.f('prep').classList.toggle('wf-hidden', !v));
    if (prep) set('prepT', Math.ceil(st.prepTicks / WF_HZ), s => {
      this.f('prepText').textContent = st.wave === 0 ? `Plant your rally flag and recruit. First wave in ${s}s` : `Wave ${st.wave + 1}${isBossWave(st.wave + 1) ? ' (BOSS!)' : ''} in ${s}s`;
    });
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.f('banner').classList.remove('show');
    }
  }

  pop(type) {
    const c = this.root.querySelector(`.wf-card[data-u="${type}"]`);
    if (!c) return;
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
  }

  banner(text, sub = '', kind = '', secs = 2.2) {
    const el = this.f('banner');
    el.className = 'wf-banner ' + kind;
    el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    void el.offsetWidth;
    el.classList.add('show');
    this.bannerT = secs;
  }

  toast(html, secs = 5) {
    const feed = this.f('feed');
    const el = document.createElement('div');
    el.className = 'wf-toast';
    el.innerHTML = html;
    feed.appendChild(el);
    while (feed.children.length > 4) feed.firstElementChild.remove();
    setTimeout(() => el.remove(), secs * 1000);
  }

  showEnd({ won, title, sub, stats }) {
    this.f('endTitle').textContent = title || (won ? 'VICTORY!' : 'DEFEAT');
    this.f('endTitle').style.color = won ? '#5ee06a' : '#ff4d5e';
    this.f('endSub').textContent = sub || '';
    this.f('stats').innerHTML = stats.map(([label, value]) => `<div class="wf-stat"><b>${value}</b><span>${label}</span></div>`).join('');
    this.screen('end');
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}

function beatsText(t) {
  const beats = Object.entries(COUNTER_OF).filter(([victim, c]) => c === t && RECRUITABLE.includes(victim)).map(([v]) => UNIT_TYPES[v].name.toLowerCase() + 's');
  return beats.join(', ') || '—';
}
