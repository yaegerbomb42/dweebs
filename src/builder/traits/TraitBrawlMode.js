// TraitBrawlMode.js — "Dweeb Brawl Sim": watch trait-built Dweebs fight on their own
// in the Toy Playroom (tube slides, rails, trampolines, smashable chalkboards,
// toy blocks, spiky fuzzballs). Owns its own canvas/renderer so it can't disturb
// the main game loop. The simulation itself lives in TraitBrawl.js.

import * as THREE from 'three';
import { TraitBrawl, ARENA } from './TraitBrawl.js';
import { generateBuild } from './TraitBalance.js';
import { TRAITS, TRAIT_BY_ID, RARITIES } from './TraitCatalog.js';
import { loadCollection, fightFacts, rollDrops, grantTraits, isOwned } from './TraitCollection.js';

const STORAGE_KEY = 'dweebs-custom-build';
const STABLE_KEY = 'dweebs-stable-v1';
const AI_NAMES = ['Bonk', 'Wobbles', 'Sir Squish', 'Tater', 'Zippy', 'Grumbo', 'Pickle', 'Noodle', 'Chonk', 'Fizz', 'Gremlo', 'Dot'];
const AI_COLORS = ['#ffd23f', '#5ee06a', '#2f6fe0', '#b25ee0', '#ff6b9e', '#f28a1e', '#1fb5a8', '#e03a3a'];

/** Read the player's saved builds (current lab build + Stable slots). */
export function loadPlayerBuilds() {
  const out = [];
  const coll = loadCollection();
  const add = (cfg, label) => {
    if (!cfg) return;
    out.push({ name: cfg.name || label, color: cfg.primaryColor || '#ffd23f', traits: Array.isArray(cfg.traits) ? cfg.traits.filter(id => TRAIT_BY_ID.has(id) && isOwned(coll, id)) : [], core: cfg.traitCore || {}, shape: (cfg.height || 1) > 1.25 ? 'capsule' : 'cube', src: label });
  };
  try { add(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'), 'Current build'); } catch { /* ignore */ }
  try {
    const st = JSON.parse(localStorage.getItem(STABLE_KEY) || '[]');
    if (Array.isArray(st)) st.forEach((e, i) => e?.config && add(e.config, `Stable ${i + 1}`));
  } catch { /* ignore */ }
  return out;
}

function aiBuild(seed, i) {
  return { name: AI_NAMES[(seed + i * 5) % AI_NAMES.length], color: AI_COLORS[(seed * 3 + i) % AI_COLORS.length], traits: generateBuild(seed * 977 + i * 131, TRAITS), core: {}, shape: (seed + i) % 2 ? 'capsule' : 'cube', ai: true };
}

const css = `
#tb-root{position:fixed;inset:0;z-index:950;font-family:'Lilita One',system-ui,sans-serif;color:#14101c;background:#dfe3ea}
#tb-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.tb-panel{position:absolute;background:#fff8ee;border:3px solid #14101c;border-radius:14px;box-shadow:0 5px 0 #14101c;padding:10px 12px}
.tb-btn{font-family:inherit;font-size:15px;background:#ffd23f;border:3px solid #14101c;border-radius:10px;padding:6px 12px;cursor:pointer;box-shadow:0 3px 0 #14101c;margin:2px}
.tb-btn.alt{background:#7dd3fc}.tb-btn.red{background:#ff6b6b}.tb-btn.on{background:#5ee06a}
.tb-roster{top:12px;width:230px;font-size:13px;max-height:calc(100% - 40px);overflow:auto}
.tb-f{margin:4px 0 7px}.tb-f .bar{height:8px;background:#ddd;border:2px solid #14101c;border-radius:5px;overflow:hidden}
.tb-f .bar i{display:block;height:100%;background:#5ee06a}.tb-f.dead{opacity:.35}.tb-f small{opacity:.7;font-family:system-ui;font-size:11px}
.tb-feed{left:50%;transform:translateX(-50%);bottom:12px;width:min(520px,70%);font-size:13px;font-family:system-ui;min-height:30px}
.tb-top{left:50%;top:12px;transform:translateX(-50%);font-size:20px;text-align:center;white-space:nowrap}
.tb-setup{left:50%;top:50%;transform:translate(-50%,-50%);width:min(640px,92%);max-height:88%;overflow:auto}
.tb-pick{display:flex;gap:8px;align-items:center;border:2px solid #14101c;border-radius:10px;padding:6px 8px;margin:5px 0;cursor:pointer;background:#fff}
.tb-pick.sel{background:#d8f8dc}.tb-sw{width:18px;height:18px;border-radius:5px;border:2px solid #14101c}
.tb-pop{position:absolute;pointer-events:none;font-weight:bold;font-size:18px;color:#fff;-webkit-text-stroke:1px #14101c;transition:transform .8s,opacity .8s}
`;

export class TraitBrawlMode {
  constructor({ onExit } = {}) {
    this.onExit = onExit;
    this.root = document.createElement('div');
    this.root.id = 'tb-root';
    const style = document.createElement('style'); style.textContent = css; this.root.appendChild(style);
    document.body.appendChild(this.root);
    this.picked = new Set([0]);
    this.speed = 1;
    this.seed = (Date.now() % 100000) | 0;
    this.showSetup();
  }

  // ─── Setup screen ─────────────────────────────────────────────────────────
  showSetup() {
    this.stopBattle();
    const builds = loadPlayerBuilds();
    this.builds = builds;
    const el = document.createElement('div');
    el.className = 'tb-panel tb-setup';
    const rows = builds.length ? builds.map((b, i) => `
      <div class="tb-pick ${this.picked.has(i) ? 'sel' : ''}" data-i="${i}">
        <span class="tb-sw" style="background:${b.color}"></span>
        <b>${escapeHtml(b.name)}</b><small style="opacity:.6;font-family:system-ui">${b.src} · ${b.traits.length} traits</small>
      </div>`).join('') : '<p style="font-family:system-ui">No saved builds yet — make one in Build-A-Dweeb (🧬 TRAITS). You can still watch AI squads.</p>';
    el.innerHTML = `
      <div style="font-size:28px">🤖 DWEEB BRAWL SIM</div>
      <p style="font-family:system-ui;font-size:13px;margin:4px 0 8px">Send up to 3 Dweebs into the Toy Playroom. They fight on their own — their traits decide whether they rush in, hide behind chalkboards, grind rails, bounce off trampolines or bail. Rivals are generated on the same trait budget.</p>
      <div id="tb-list">${rows}</div>
      <div style="margin-top:10px">
        <button class="tb-btn" id="tb-go">⚔️ SEND THEM IN</button>
        <button class="tb-btn alt" id="tb-ai">👀 Watch AI vs AI</button>
        <button class="tb-btn red" id="tb-exit">⬅ Back</button>
      </div>`;
    this.root.appendChild(el);
    this.setupEl = el;
    el.querySelectorAll('.tb-pick').forEach(p => p.addEventListener('click', () => {
      const i = +p.dataset.i;
      if (this.picked.has(i)) this.picked.delete(i); else if (this.picked.size < 3) this.picked.add(i);
      p.classList.toggle('sel', this.picked.has(i));
    }));
    el.querySelector('#tb-go').addEventListener('click', () => this.start([...this.picked].map(i => builds[i]).filter(Boolean)));
    el.querySelector('#tb-ai').addEventListener('click', () => this.start([]));
    el.querySelector('#tb-exit').addEventListener('click', () => this.exit());
  }

  start(mine) {
    this.setupEl?.remove(); this.setupEl = null;
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    const team0 = mine.slice(0, 3).map(b => ({ ...b }));
    for (let i = team0.length; i < 3; i++) team0.push(aiBuild(this.seed, i));
    const team1 = [0, 1, 2].map(i => aiBuild(this.seed + 17, i + 3));
    this.lastTeams = [team0, team1];
    this.sim = new TraitBrawl([team0, team1], { seed: this.seed });
    this.buildScene();
    this.buildHud();
    this.last = performance.now(); this.acc = 0;
    const loop = now => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
      this.acc += dt * this.speed;
      while (this.acc >= 1 / 60) { this.sim.step(1 / 60); this.handleEvents(); this.acc -= 1 / 60; }
      this.renderFrame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stopBattle() {
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = null;
    this.hud?.remove(); this.hud = null;
    if (this.renderer) {
      this.scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
      this.renderer.dispose(); this.renderer.domElement.remove(); this.renderer = null;
    }
    window.removeEventListener('resize', this._onResize || (() => {}));
  }

  exit() { this.stopBattle(); this.root.remove(); this.onExit?.(); }

  // ─── Scene: the Toy Playroom ──────────────────────────────────────────────
  buildScene() {
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.insertBefore(r.domElement, this.root.children[1] || null);
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe3ea);
    scene.fog = new THREE.Fog(0xdfe3ea, 45, 90);
    this.scene = scene;
    const cam = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 200);
    cam.position.set(0, 20, 27); this.camera = cam; this.camLook = new THREE.Vector3(0, 0, 0);
    this._onResize = () => { cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix(); r.setSize(window.innerWidth, window.innerHeight); };
    window.addEventListener('resize', this._onResize);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(10, 26, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 20, bottom: -20, near: 1, far: 70 });
    scene.add(sun);

    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.55, ...o });
    const glossy = c => mat(c, { roughness: 0.25, metalness: 0.05 });
    const add = (geo, m, x, y, z, cast = true) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = cast; me.receiveShadow = true; scene.add(me); return me; };
    const H = ARENA, L = this.sim.layout;

    // floor + walls
    add(new THREE.BoxGeometry(H.hx * 2 + 4, 0.4, H.hz * 2 + 4), mat(0xeceff3), 0, -0.2, 0, false);
    const wallM = mat(0xd5dae2);
    add(new THREE.BoxGeometry(H.hx * 2 + 4, 14, 1), wallM, 0, 7, -H.hz - 1.5, false);
    add(new THREE.BoxGeometry(1, 14, H.hz * 2 + 4), wallM, -H.hx - 1.5, 7, 0, false);
    add(new THREE.BoxGeometry(1, 14, H.hz * 2 + 4), wallM, H.hx + 1.5, 7, 0, false);
    // tiered ledges along the back wall
    add(new THREE.BoxGeometry(H.hx * 2 + 2, 2, 4), mat(0xe4e8ee), 0, 1, -H.hz + 1);
    add(new THREE.BoxGeometry(H.hx * 2 + 2, 3.8, 2.4), mat(0xdde1e8), 0, 1.9, -H.hz - 0.2);
    // arched openings
    const archM = mat(0x5b6270);
    for (const s of L.slides) {
      const onBack = s.top.z < -10;
      const arch = add(new THREE.CylinderGeometry(1.4, 1.4, 0.4, 14, 1, false, 0, Math.PI), archM, s.top.x, 5.2, -H.hz - 0.9, false);
      arch.rotation.set(Math.PI / 2, 0, Math.PI / 2 * (onBack ? 1 : 0));
      if (!onBack) { arch.position.set(-H.hx - 0.9, 5.2, s.top.z); arch.rotation.set(Math.PI / 2, 0, 0); arch.rotation.y = Math.PI / 2; }
      add(new THREE.BoxGeometry(onBack ? 2.8 : 0.4, 2.2, onBack ? 0.4 : 2.8), archM, onBack ? s.top.x : -H.hx - 0.9, 4.1, onBack ? -H.hz - 0.9 : s.top.z, false);
    }
    // tube slides (glossy, low-poly): curve from wall opening down to the floor
    for (const s of L.slides) {
      const top = s.top, bot = s.bottom;
      const pts = [
        new THREE.Vector3(top.x, 4.6, top.z - (top.z < -10 ? 1.2 : 0)),
        new THREE.Vector3(top.x + (bot.x - top.x) * 0.3 + 1.5, 3.6, top.z + (bot.z - top.z) * 0.3),
        new THREE.Vector3(top.x + (bot.x - top.x) * 0.65 - 1, 1.8, top.z + (bot.z - top.z) * 0.65),
        new THREE.Vector3(bot.x, 0.5, bot.z),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      add(new THREE.TubeGeometry(curve, 28, 0.75, 9, false), glossy(s.color), 0, 0, 0);
      const lip = add(new THREE.TorusGeometry(0.78, 0.14, 6, 12), glossy(s.color), bot.x, 0.5, bot.z);
      const tan = curve.getTangent(1); lip.lookAt(bot.x + tan.x, 0.5 + tan.y, bot.z + tan.z);
      // support posts
      for (const u of [0.35, 0.7]) { const p = curve.getPoint(u); add(new THREE.CylinderGeometry(0.12, 0.12, p.y, 6), mat(0x9aa3b0), p.x, p.y / 2, p.z); }
    }
    // rails with ties on the ledges
    const railM = mat(0x6b7280, { metalness: 0.4 }), tieM = mat(0x8a5a35);
    for (const rl of L.rails) {
      const dx = rl.b.x - rl.a.x, dz = rl.b.z - rl.a.z, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
      for (const side of [-0.45, 0.45]) {
        const m = add(new THREE.BoxGeometry(0.12, 0.12, len), railM, (rl.a.x + rl.b.x) / 2 + Math.cos(ang) * side, 2.1, (rl.a.z + rl.b.z) / 2 - Math.sin(ang) * side);
        m.rotation.y = ang;
      }
      for (let i = 0; i <= len; i += 1.1) {
        const t = add(new THREE.BoxGeometry(1.3, 0.1, 0.3), tieM, rl.a.x + dx * (i / len), 2.02, rl.a.z + dz * (i / len)); t.rotation.y = ang;
      }
    }
    // wooden ramps
    for (const [x, z, ry] of [[-2, -7.5, 0.2], [12, -7.5, -0.3]]) { const rp = add(new THREE.BoxGeometry(2.4, 0.25, 5), mat(0xd9a866), x, 1, z); rp.rotation.set(-0.42, ry, 0); }
    // giant gears on the walls
    this.gears = [];
    const gear = (x, y, z, rad, color, ry = 0) => {
      const g = new THREE.Group();
      const m = mat(color, { metalness: 0.3 });
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.5, 18), m));
      const n = Math.round(rad * 7);
      for (let i = 0; i < n; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(rad * 0.35, 0.5, rad * 0.35), m); const a = (i / n) * Math.PI * 2; t.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad); t.rotation.y = -a; g.add(t); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.3, rad * 0.3, 0.7, 10), mat(0x4b5260)); g.add(hub);
      g.rotation.x = Math.PI / 2;
      const holder = new THREE.Group(); holder.add(g); holder.rotation.y = ry; scene.add(holder);
      holder.position.set(x, y, z);
      g.castShadow = true; this.gears.push({ g, s: (Math.random() < 0.5 ? -1 : 1) * (0.6 / rad) });
    };
    gear(-17, 9, -H.hz - 0.8, 2.2, 0x9aa3b0); gear(-13.5, 10.5, -H.hz - 0.8, 1.2, 0xf2a93b);
    gear(10, 9.5, -H.hz - 0.8, 1.6, 0xffd23f); gear(14, 8, -H.hz - 0.8, 2.4, 0x9aa3b0);
    gear(-H.hx - 0.8, 8, -4, 1.8, 0xf28a1e, Math.PI / 2); gear(-H.hx - 0.8, 10, 2, 1.1, 0x9aa3b0, Math.PI / 2);
    // scaffold tower
    for (const [x, z] of [[17, -11], [18.5, -11], [17, -9.5], [18.5, -9.5]]) add(new THREE.BoxGeometry(0.18, 9, 0.18), mat(0x6b7280), x, 4.5, z);
    for (let y = 1.5; y < 9; y += 2.2) add(new THREE.BoxGeometry(1.7, 0.15, 1.7), mat(0xe03a3a), 17.75, y, -10.25);
    // trampolines
    this.trampMesh = {};
    for (const tp of L.trampolines) {
      const g = new THREE.Group(); g.position.set(tp.x, 0, tp.z);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(tp.r * 0.9, tp.r * 0.9, 0.08, 20), mat(0x2b2f3a)); pad.position.y = 0.75; g.add(pad);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(tp.r, 0.18, 8, 24), glossy(tp.color)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.78; g.add(rim);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.78, 5), mat(0x9aa3b0)); leg.position.set(Math.cos(a) * tp.r * 0.95, 0.39, Math.sin(a) * tp.r * 0.95); g.add(leg); }
      g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
      scene.add(g); this.trampMesh[tp.id] = { g, pad, t: 0 };
    }
    // chalkboards with chalk doodles (line segments, no textures)
    this.boardMesh = {};
    for (const bd of L.boards) {
      const g = new THREE.Group(); g.position.set(bd.x, 0, bd.z); g.rotation.y = bd.rot;
      const wood = mat(0xb57a45);
      const face = new THREE.Mesh(new THREE.BoxGeometry(bd.w, 3, 0.18), mat(0x2f3a3a, { roughness: 0.9 })); face.position.y = 2.6; g.add(face);
      for (const [w, h, x, y] of [[bd.w + 0.4, 0.25, 0, 4.2], [bd.w + 0.4, 0.25, 0, 1.0], [0.25, 3.4, -bd.w / 2 - 0.1, 2.6], [0.25, 3.4, bd.w / 2 + 0.1, 2.6]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), wood); m.position.set(x, y, 0); g.add(m); }
      for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.22), wood); leg.position.set(sx * bd.w * 0.4, 0.5, 0); g.add(leg); const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 1.6), wood); foot.position.set(sx * bd.w * 0.4, 0.07, 0); g.add(foot); }
      const pts = [];
      const rnd = mulberry(bd.id.charCodeAt(1) * 99 + 7);
      for (let d = 0; d < 6; d++) { // smiley suns, stick dweebs, squiggles
        const cx = (rnd() - 0.5) * (bd.w - 0.8), cy = 1.6 + rnd() * 1.8, rr = 0.2 + rnd() * 0.3, n = 10;
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, b2 = (i + 1) / n * Math.PI * 2; pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.1, cx + Math.cos(b2) * rr, cy + Math.sin(b2) * rr, 0.1); }
        pts.push(cx, cy - rr, 0.1, cx, cy - rr - 0.35, 0.1, cx - 0.2, cy - rr - 0.6, 0.1, cx, cy - rr - 0.35, 0.1, cx + 0.2, cy - rr - 0.6, 0.1, cx, cy - rr - 0.35, 0.1);
      }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      for (const zf of [1, -1]) { const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: [0xe6fff0, 0xbff7c4, 0xffe7a0][bd.id.charCodeAt(1) % 3] })); ls.scale.z = zf; g.add(ls); }
      g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
      scene.add(g); this.boardMesh[bd.id] = { g, shake: 0 };
    }
    // toy blocks
    const blockGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    this.blockMesh = L.blocks.map(k => add(blockGeo, glossy(k.color), k.x, 0.35, k.z));
    // fuzzball critters
    const fuzzM = mat(0xe0303a), spikeGeo = new THREE.ConeGeometry(0.12, 0.45, 4);
    this.fuzzMesh = this.sim.fuzz.map(() => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), fuzzM));
      const ico = new THREE.IcosahedronGeometry(0.5, 0).getAttribute('position');
      for (let i = 0; i < ico.count; i += 3) { const v = new THREE.Vector3().fromBufferAttribute(ico, i).normalize(); const sp = new THREE.Mesh(spikeGeo, fuzzM); sp.position.copy(v.clone().multiplyScalar(0.55)); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v); g.add(sp); }
      addEyes(g, 0.5, 0.18, 0.12);
      g.traverse(o => { o.castShadow = true; });
      scene.add(g); return g;
    });
    // dweebs
    this.dweebMesh = this.sim.fighters.map(f => {
      const g = new THREE.Group();
      const body = new THREE.Group(); g.add(body);
      const col = new THREE.Color(f.color);
      const bm = glossy(col);
      const sz = 0.7 + f.stats.size * 0.8;
      let mesh;
      if (f.shape === 'capsule') { mesh = new THREE.Mesh(new THREE.CapsuleGeometry(sz * 0.42, sz * 0.7, 4, 8), bm); mesh.position.y = sz * 0.8; }
      else { mesh = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz * 0.85), bm); mesh.position.y = sz / 2; }
      body.add(mesh);
      const eyes = new THREE.Group(); eyes.position.y = mesh.position.y + sz * 0.15; addEyes(eyes, sz * 0.43, sz * 0.2, sz * 0.15); body.add(eyes);
      for (const sx of [-1, 1]) { const ft = new THREE.Mesh(new THREE.BoxGeometry(sz * 0.25, sz * 0.15, sz * 0.35), mat(col.clone().multiplyScalar(0.6))); ft.position.set(sx * sz * 0.25, 0.05, 0.05); body.add(ft); }
      // team ring + hp bar
      const ring = new THREE.Mesh(new THREE.TorusGeometry(sz * 0.7, 0.06, 4, 20), new THREE.MeshBasicMaterial({ color: f.team === 0 ? 0x2f9bff : 0xff4040 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.04; g.add(ring);
      const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.14), new THREE.MeshBasicMaterial({ color: 0x14101c })); hpBg.position.y = sz * 1.7 + 0.3; g.add(hpBg);
      const hp = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.09), new THREE.MeshBasicMaterial({ color: 0x5ee06a })); hp.position.z = 0.01; hpBg.add(hp);
      g.traverse(o => { if (o.isMesh && o !== hp && o !== hpBg && o !== ring) o.castShadow = true; });
      scene.add(g);
      return { g, body, mesh, hp, hpBg, bm, sz };
    });
    // debris pool
    this.debris = [];
    this.debrisGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  }

  spawnDebris(x, y, z, n, colors, speed = 6, life = 1.4, size = 1) {
    for (let i = 0; i < n; i++) {
      if (this.debris.length > 260) { const old = this.debris.shift(); this.scene.remove(old.m); old.m.material.dispose(); }
      const m = new THREE.Mesh(this.debrisGeo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], flatShading: true }));
      m.scale.setScalar(size * (0.5 + Math.random()));
      m.position.set(x, y, z); m.castShadow = true;
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random());
      this.debris.push({ m, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 2 + Math.random() * speed, life, rx: Math.random() * 8, settled: false });
    }
  }

  popText(x, y, z, text, color = '#ffd23f') {
    if (!this.hud) return;
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const el = document.createElement('div');
    el.className = 'tb-pop'; el.textContent = text; el.style.color = color;
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.hud.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = 'translateY(-40px)'; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 850);
  }

  handleEvents() {
    for (const e of this.sim.events) {
      if (e.type === 'hit') { this.spawnDebris(e.x, e.y, e.z, e.blocked ? 3 : 7, ['#ffffff', '#ffd23f', this.sim.fighters[e.o].color], 5, 0.7, 0.8); this.popText(e.x, e.y + 1, e.z, e.blocked ? `🛡${e.dmg}` : `-${e.dmg}`, e.blocked ? '#7dd3fc' : '#ff6b6b'); this.shake = Math.max(this.shake || 0, 0.15 + e.dmg * 0.01); }
      else if (e.type === 'ko') { this.spawnDebris(e.x, 1, e.z, 24, ['#ffd23f', '#ff6b9e', '#5ee06a', '#2f6fe0'], 9, 1.6, 1.2); this.shake = 0.6; }
      else if (e.type === 'break') {
        const bm = this.boardMesh[e.board];
        if (bm) { this.scene.remove(bm.g); }
        this.spawnDebris(e.x, 2.5, e.z, 40, ['#2f3a3a', '#b57a45', '#d8d0c4', '#c9c2b6'], 7, 99, 1.4); // rubble stays
        this.shake = 0.8;
      } else if (e.type === 'boardHit') { const bm = this.boardMesh[e.board]; if (bm) bm.shake = 0.3; this.spawnDebris(e.x, 2, e.z, 4, ['#d8d0c4', '#b57a45'], 4, 1.2); }
      else if (e.type === 'bounce') { const t = this.trampMesh[e.tramp]; if (t) t.t = 0.35; }
      else if (e.type === 'land' && e.big) { this.spawnDebris(e.x, 0.2, e.z, 10, ['#d8d0c4', '#ffffff'], 6, 0.8); this.shake = 0.35; }
      else if (e.type === 'bite') this.spawnDebris(e.x, 0.8, e.z, 4, ['#e0303a'], 3, 0.6);
      else if (e.type === 'end') this.showResults();
    }
  }

  renderFrame(dt) {
    const S = this.sim;
    for (const gr of this.gears) gr.g.rotation.y += gr.s * dt;
    for (const id in this.trampMesh) { const t = this.trampMesh[id]; t.t = Math.max(0, t.t - dt); t.pad.position.y = 0.75 - Math.sin(t.t * 18) * t.t * 0.8; }
    for (const id in this.boardMesh) { const b = this.boardMesh[id]; b.shake = Math.max(0, b.shake - dt); b.g.rotation.z = Math.sin(b.shake * 50) * b.shake * 0.15; }
    S.layout.blocks.forEach((k, i) => { const m = this.blockMesh[i]; m.position.set(k.x, k.y + 0.35, k.z); if (k.vx || k.vz) { m.rotation.x += k.vx * dt * 0.6; m.rotation.z += k.vz * dt * 0.6; } });
    S.fuzz.forEach((z, i) => { const m = this.fuzzMesh[i]; m.visible = z.hp > 0; m.position.set(z.x, z.y + 0.55, z.z); m.rotation.y = Math.atan2(z.vx, z.vz); });
    let cx = 0, cz = 0, n = 0;
    S.fighters.forEach((f, i) => {
      const D = this.dweebMesh[i];
      if (!f.alive) { D.g.position.y = Math.max(-2, D.g.position.y - dt * 1.5); D.body.rotation.z = Math.min(Math.PI / 2, D.body.rotation.z + dt * 4); D.hpBg.visible = false; return; }
      cx += f.x; cz += f.z; n++;
      D.g.position.set(f.x, f.y, f.z);
      D.body.rotation.y = f.face;
      const sq = f.squash; const wind = f.action === 'windup' ? 0.15 : 0;
      D.body.scale.set(1 + sq * 0.5 + wind, 1 - sq * 0.6 - wind * 0.5, 1 + sq * 0.5);
      D.body.rotation.x = f.ride ? 0.6 : (f.action === 'recover' ? -0.25 : (f.blocking ? 0.15 : 0));
      D.bm.emissive.setRGB(f.hitFlash * 3, f.hitFlash * 3, f.hitFlash * 3);
      const r = f.hp / f.maxHp; D.hp.scale.x = Math.max(0.001, r); D.hp.position.x = -(1 - r) * 0.56; D.hp.material.color.setHex(r > 0.5 ? 0x5ee06a : r > 0.25 ? 0xffd23f : 0xff4d5e);
      D.hpBg.quaternion.copy(this.camera.quaternion);
    });
    // debris physics
    for (const d of this.debris) {
      if (d.settled) continue;
      d.vy -= 18 * dt; d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt; d.m.rotation.x += d.rx * dt; d.m.rotation.y += d.rx * dt;
      if (d.m.position.y < 0.1) { d.m.position.y = 0.1; d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; if (Math.abs(d.vy) < 0.8) { d.vy = 0; if (d.life > 50) d.settled = true; } }
      d.life -= dt;
    }
    this.debris = this.debris.filter(d => { if (d.life <= 0) { this.scene.remove(d.m); d.m.material.dispose(); return false; } return true; });
    // camera: follow the action, gentle sway, shake on big hits
    if (n) this.camLook.lerp(new THREE.Vector3(cx / n * 0.6, 0, cz / n * 0.5), Math.min(1, dt * 1.5));
    const t = performance.now() / 1000;
    this.shake = Math.max(0, (this.shake || 0) - dt * 1.8);
    const sh = this.shake * 0.6;
    this.camera.position.set(this.camLook.x + Math.sin(t * 0.15) * 5 + (Math.random() - 0.5) * sh, 19 + (Math.random() - 0.5) * sh, this.camLook.z + 24);
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
    this.updateHud();
  }

  // ─── HUD ──────────────────────────────────────────────────────────────────
  buildHud() {
    const h = document.createElement('div');
    h.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    h.innerHTML = `
      <div class="tb-panel tb-roster" style="left:12px" id="tb-r0"></div>
      <div class="tb-panel tb-roster" style="right:12px" id="tb-r1"></div>
      <div class="tb-panel tb-top" style="pointer-events:auto"><span id="tb-time">0</span>
        <button class="tb-btn" id="tb-speed">1×</button><button class="tb-btn alt" id="tb-again">🔁</button><button class="tb-btn red" id="tb-back">⬅</button></div>
      <div class="tb-panel tb-feed" id="tb-feed"></div>`;
    this.root.appendChild(h); this.hud = h;
    h.querySelector('#tb-speed').addEventListener('click', e => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1; e.target.textContent = `${this.speed}×`; });
    h.querySelector('#tb-again').addEventListener('click', () => { const teams = this.lastTeams; this.stopBattle(); this.start(teams[0].filter(b => !b.ai)); });
    h.querySelector('#tb-back').addEventListener('click', () => this.showSetup());
    this._hudT = 0;
  }

  updateHud() {
    if (!this.hud || (this._hudT = (this._hudT + 1) % 6) !== 0) return;
    const S = this.sim;
    const verb = { attack: '⚔️ attacking', defend: '🛡 guarding', flee: '💨 fleeing', hide: '🫣 hiding', flank: '↪ flanking', grab: '🧱 grabbing', throw: '🎯 throwing', bounce: '🦘 trampoline', slide: '🛝 slide', rail: '🛤 rail', smash: '🔨 smashing', regroup: '🤝 regrouping', taunt: '🕺 showing off', rest: '😮‍💨 catching breath' };
    for (const tm of [0, 1]) {
      const el = this.hud.querySelector(`#tb-r${tm}`);
      el.innerHTML = `<div style="font-size:16px;color:${tm ? '#e03a3a' : '#2f6fe0'}">${tm ? 'RIVALS' : 'YOUR SQUAD'}</div>` + S.fighters.filter(f => f.team === tm).map(f => {
        const top = topTraits(f);
        return `<div class="tb-f ${f.alive ? '' : 'dead'}"><b style="color:${f.color};-webkit-text-stroke:.5px #14101c">${escapeHtml(f.name)}</b> <small>${f.alive ? (f.ride ? (f.ride.kind === 'slide' ? '🛝 sliding!' : '🛤 grinding!') : verb[f.plan?.kind] || '') : 'KO'}</small>
          <div class="bar"><i style="width:${(f.hp / f.maxHp * 100).toFixed(0)}%"></i></div><small>${top}</small></div>`;
      }).join('');
    }
    this.hud.querySelector('#tb-time').textContent = `⏱ ${Math.max(0, Math.ceil(S.timeLimit - S.t))}s`;
    this.hud.querySelector('#tb-feed').innerHTML = S.feed.slice(0, 4).map(x => `<div>${escapeHtml(x.text)}</div>`).join('') || '<div style="opacity:.6">Dweebs are sizing each other up…</div>';
  }

  showResults() {
    const S = this.sim;
    // Battle loot: each of YOUR Dweebs rolls drops from what it actually did.
    const coll = loadCollection();
    const loot = [];
    if (!coll.sandbox) {
      for (const f of S.fighters) {
        if (f.isAi || f.team !== 0) continue;
        const ids = rollDrops(fightFacts(f, S.winner === 0), this.seed * 31 + f.idx, coll);
        const fresh = grantTraits(coll, ids);
        loot.push(...ids.map(id => ({ who: f.name, t: TRAIT_BY_ID.get(id), fresh: fresh.includes(id) })));
      }
      coll.battles = (coll.battles || 0) + 1; grantTraits(coll, []);
    }
    const rc = Object.fromEntries(RARITIES.map(r => [r.id, r.color]));
    const lootHtml = loot.length ? `<div style="font-size:18px;margin-top:6px">🎁 TRAIT DROPS</div>` + loot.map(l => `<div style="font-family:system-ui;font-size:13px"><b style="color:${rc[l.t.rarity]}">[${l.t.rarity}] ${escapeHtml(l.t.name)}</b> → ${escapeHtml(l.who)}${l.fresh ? ' <b style="color:#c0262d">NEW!</b>' : ' (dupe)'}</div>`).join('') : (coll.sandbox ? '<div style="font-family:system-ui;font-size:12px;opacity:.7">Sandbox on — no drops.</div>' : '<div style="font-family:system-ui;font-size:12px;opacity:.7">Send your own Dweebs in to earn trait drops.</div>');
    setTimeout(() => {
      if (!this.hud || this.sim !== S) return;
      const el = document.createElement('div');
      el.className = 'tb-panel tb-setup'; el.style.pointerEvents = 'auto';
      const rows = S.fighters.map(f => {
        const dec = Object.entries(f.decisions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(', ');
        return `<tr><td style="color:${f.team ? '#e03a3a' : '#2f6fe0'}">${escapeHtml(f.name)}</td><td>${f.kos}</td><td>${f.dmgDealt}</td><td style="font-family:system-ui;font-size:12px">${dec}</td></tr>`;
      }).join('');
      el.innerHTML = `<div style="font-size:30px">${S.winner === 'draw' ? '🤝 DRAW' : S.winner === 0 ? '🏆 YOUR SQUAD WINS' : '💀 RIVALS WIN'}</div>
        <table style="width:100%;margin:8px 0;font-size:14px"><tr><th align=left>Dweeb</th><th>KOs</th><th>Dmg</th><th align=left>Favourite moves</th></tr>${rows}</table>${lootHtml}<div style="height:8px"></div>
        <button class="tb-btn" id="tb-r-again">🔁 Rematch</button><button class="tb-btn alt" id="tb-r-setup">Change squad</button><button class="tb-btn red" id="tb-r-exit">⬅ Exit</button>`;
      this.hud.appendChild(el);
      el.querySelector('#tb-r-again').addEventListener('click', () => { const teams = this.lastTeams; this.stopBattle(); this.start(teams[0].filter(b => !b.ai)); });
      el.querySelector('#tb-r-setup').addEventListener('click', () => this.showSetup());
      el.querySelector('#tb-r-exit').addEventListener('click', () => this.exit());
    }, 1600);
  }
}

function topTraits(f) {
  const s = f.stats;
  const tags = [];
  if (s.speed > 0.65) tags.push('fast'); if (s.speed < 0.38) tags.push('slow');
  if (s.weight > 0.65) tags.push('heavy'); if (s.armor > 0.65) tags.push('armored');
  if (s.aggression > 0.65) tags.push('aggressive'); if (s.caution > 0.62) tags.push('cautious');
  if (s.cunning > 0.62) tags.push('cunning'); if (s.bounce > 0.62) tags.push('bouncy');
  return `${f.traits.length} traits${tags.length ? ' · ' + tags.slice(0, 3).join(', ') : ''}`;
}
function addEyes(g, z, r, sp) {
  const w = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }), p = new THREE.MeshBasicMaterial({ color: 0x14101c });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), w); e.position.set(sx * (sp + r * 0.6), 0, z); g.add(e);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 8, 6), p); pu.position.set(sx * (sp + r * 0.6), 0, z + r * 0.7); g.add(pu);
  }
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
