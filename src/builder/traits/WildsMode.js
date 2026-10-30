// WildsMode.js — "Dweeb Wilds": spawn your trait-built Dweeb into a huge open playground
// and watch it try to survive. Zero player control — only a spectator camera.
// Owns its own canvas/renderer (like TraitBrawlMode) so it can't disturb the main loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WildsSim, WORLD, BIOMES, MATCH } from './WildsSim.js';
import { loadPlayerBuilds } from './TraitBrawlMode.js';
import { generateBuild } from './TraitBalance.js';
import { TRAITS, TRAIT_BY_ID, RARITIES } from './TraitCatalog.js';
import { loadCollection, fightFacts, rollDrops, grantTraits } from './TraitCollection.js';
import { createQualityGovernor } from '../../app/performance.js';

const AI_NAMES = ['Bonk', 'Wobbles', 'Sir Squish', 'Tater', 'Zippy', 'Grumbo', 'Pickle', 'Noodle', 'Chonk', 'Fizz', 'Gremlo', 'Dot', 'Mochi', 'Bean', 'Sprocket', 'Gizmo'];
const AI_COLORS = ['#5ee06a', '#2f6fe0', '#b25ee0', '#ff6b9e', '#f28a1e', '#1fb5a8', '#e03a3a', '#9aa3b0', '#ffffff', '#8a5a35', '#7dd3fc'];
const PICK_COLORS = { food: 0xe03a3a, health: 0xff6b9e, energy: 0xffd23f, toy: 0x2f6fe0 };

function aiEntrant(seed, i) {
  return { name: AI_NAMES[(seed + i * 7) % AI_NAMES.length], color: AI_COLORS[(seed * 3 + i) % AI_COLORS.length], traits: generateBuild(seed * 613 + i * 97, TRAITS), core: {}, shape: (seed + i) % 2 ? 'capsule' : 'cube', ai: true };
}

const css = `
#wl-root{position:fixed;inset:0;z-index:950;font-family:'Lilita One',system-ui,sans-serif;color:#14101c;background:#f6c9a0}
#wl-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.wl-panel{position:absolute;background:#fff8ee;border:3px solid #14101c;border-radius:14px;box-shadow:0 5px 0 #14101c;padding:8px 10px}
.wl-btn{font-family:inherit;font-size:14px;background:#ffd23f;border:3px solid #14101c;border-radius:10px;padding:5px 10px;cursor:pointer;box-shadow:0 3px 0 #14101c;margin:2px}
.wl-btn.alt{background:#7dd3fc}.wl-btn.red{background:#ff6b6b}.wl-btn.on{background:#5ee06a}
.wl-roster{left:10px;top:10px;width:250px;max-height:calc(100% - 30px);overflow:auto;font-size:13px;pointer-events:auto}
.wl-d{padding:4px 5px;margin:3px 0;border-radius:8px;cursor:pointer;border:2px solid transparent}
.wl-d.me{background:#fff1b8}.wl-d.cam{border-color:#14101c}.wl-d.dead{opacity:.35}
.wl-d .th{font-family:system-ui;font-size:11px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wl-bars{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-top:2px}
.wl-bars span{height:6px;background:#ddd;border:1px solid #14101c;border-radius:3px;overflow:hidden}.wl-bars i{display:block;height:100%}
.wl-top{left:50%;top:10px;transform:translateX(-50%);text-align:center;white-space:nowrap;pointer-events:auto;font-size:16px}
.wl-feed{right:10px;bottom:10px;width:min(360px,40%);font-size:12px;font-family:system-ui;max-height:40%;overflow:hidden}
.wl-feed div{margin:2px 0}
.wl-focus{left:50%;bottom:10px;transform:translateX(-50%);width:min(420px,50%);font-size:13px;text-align:center}
.wl-focus .big{font-size:18px}
.wl-setup{left:50%;top:50%;transform:translate(-50%,-50%);width:min(680px,94%);max-height:90%;overflow:auto;pointer-events:auto}
.wl-pick{display:flex;gap:8px;align-items:center;border:2px solid #14101c;border-radius:10px;padding:6px 8px;margin:5px 0;cursor:pointer;background:#fff}
.wl-pick.sel{background:#d8f8dc}.wl-sw{width:18px;height:18px;border-radius:5px;border:2px solid #14101c}
.wl-tag{position:absolute;pointer-events:none;font-size:12px;font-family:system-ui;font-weight:700;background:#fff8eecc;border:2px solid #14101c;border-radius:8px;padding:1px 6px;transform:translate(-50%,-100%);white-space:nowrap}
.wl-tag.me{background:#ffd23f}
.wl-legend{font-family:system-ui;font-size:10px;opacity:.7}
`;

export class WildsMode {
  constructor({ onExit } = {}) {
    this.onExit = onExit;
    this.root = document.createElement('div'); this.root.id = 'wl-root';
    const st = document.createElement('style'); st.textContent = css; this.root.appendChild(st);
    document.body.appendChild(this.root);
    this.pickedIdx = 0; this.opponents = 7; this.speed = 1; this.paused = false;
    this.seed = (Date.now() % 100000) | 0;
    this.showSetup();
  }

  // ─── Setup ────────────────────────────────────────────────────────────────
  showSetup() {
    this.stop();
    const builds = this.builds = loadPlayerBuilds();
    if (this.pickedIdx >= builds.length) this.pickedIdx = builds.length ? 0 : -1;
    const el = document.createElement('div'); el.className = 'wl-panel wl-setup';
    const rows = builds.map((b, i) => `<div class="wl-pick ${i === this.pickedIdx ? 'sel' : ''}" data-i="${i}"><span class="wl-sw" style="background:${b.color}"></span><b>${esc(b.name)}</b><small style="opacity:.6;font-family:system-ui">${b.src} · ${b.traits.length} traits</small></div>`).join('')
      || '<p style="font-family:system-ui;font-size:13px">No saved builds yet — make one in Build-A-Dweeb (🧬 TRAITS). You can still spectate an all-AI match.</p>';
    el.innerHTML = `<div style="font-size:30px">🌲 DWEEB WILDS</div>
      <p style="font-family:system-ui;font-size:13px;margin:4px 0 8px">Drop your Dweeb into a giant open playground — Toy Playroom, Junkyard Forts, Swing Park, Sandbox Beach and the Gear Works. You don't control it. Its traits decide everything: whether it explores, forages, hides, ambushes, plays on the merry-go-round or picks fights. A storm closes in after ${MATCH.zoneStart}s. Last Dweeb standing wins.</p>
      <div style="font-size:16px">Your Dweeb</div><div id="wl-list">${rows}</div>
      <div style="margin:8px 0;font-family:system-ui;font-size:13px">AI opponents: <input id="wl-n" type="range" min="3" max="11" value="${this.opponents}"> <b id="wl-nv">${this.opponents}</b> <span class="wl-legend">(equal-budget random legal builds)</span></div>
      <button class="wl-btn" id="wl-go">🪂 DROP IN</button><button class="wl-btn alt" id="wl-ai">👀 Spectate AI only</button><button class="wl-btn red" id="wl-exit">⬅ Back</button>`;
    this.root.appendChild(el); this.setupEl = el;
    el.querySelectorAll('.wl-pick').forEach(p => p.addEventListener('click', () => { this.pickedIdx = +p.dataset.i; el.querySelectorAll('.wl-pick').forEach(q => q.classList.toggle('sel', q === p)); }));
    el.querySelector('#wl-n').addEventListener('input', e => { this.opponents = +e.target.value; el.querySelector('#wl-nv').textContent = this.opponents; });
    el.querySelector('#wl-go').addEventListener('click', () => this.start(builds[this.pickedIdx] || null));
    el.querySelector('#wl-ai').addEventListener('click', () => this.start(null));
    el.querySelector('#wl-exit').addEventListener('click', () => this.exit());
  }

  start(mine) {
    this.setupEl?.remove(); this.setupEl = null;
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    this.mine = mine;
    const ents = [];
    if (mine) ents.push({ ...mine, player: true });
    for (let i = 0; ents.length < this.opponents + 1; i++) ents.push(aiEntrant(this.seed, i));
    this.sim = new WildsSim(ents, { seed: this.seed });
    this.followIdx = mine ? 0 : 0; this.freeCam = false;
    this.buildScene(); this.buildHud();
    this.last = performance.now(); this.acc = 0; this.ended = false;
    const loop = now => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
      if (!this.paused) {
        this.acc += dt * this.speed; let n = 0;
        while (this.acc >= 1 / 40 && n++ < 24) { this.sim.step(1 / 40); this.handleEvents(); this.acc -= 1 / 40; }
        if (n >= 24) this.acc = 0;
      }
      this.governor?.update(dt);
      this.renderFrame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = null;
    this.hud?.remove(); this.hud = null;
    this.controls?.dispose(); this.controls = null;
    if (this.renderer) {
      this.scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => x.dispose?.()); });
      this.renderer.dispose(); this.renderer.domElement.remove(); this.renderer = null;
    }
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._onKey) window.removeEventListener('keydown', this._onKey);
  }
  exit() { this.stop(); this.root.remove(); this.onExit?.(); }

  // ─── Scene ────────────────────────────────────────────────────────────────
  buildScene() {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.insertBefore(r.domElement, this.root.children[1] || null); this.renderer = r;
    const scene = this.scene = new THREE.Scene();
    // warm low-poly sunset (junkyard reference), soft haze
    scene.background = new THREE.Color(0xf6c9a0); scene.fog = new THREE.Fog(0xf3c7a4, 90, 230);
    const cam = this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.3, 500);
    cam.position.set(0, 120, 150);
    const ctl = this.controls = new OrbitControls(cam, r.domElement);
    ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * 0.47; ctl.minDistance = 6; ctl.maxDistance = 260; ctl.target.set(0, 0, 0);
    ctl.addEventListener('start', () => { this.userTouched = true; });
    this._onResize = () => { cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix(); r.setSize(window.innerWidth, window.innerHeight); };
    window.addEventListener('resize', this._onResize);

    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x7a6a8a, 1.35));
    const sun = this.sun = new THREE.DirectionalLight(0xffd2a1, 2.1);
    sun.position.set(-40, 60, -30); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
    scene.add(sun, sun.target);
    try { this.governor = createQualityGovernor({ renderer: r, sunLight: sun, getOutline: () => false, setOutline: () => {}, particles: null }); this.governor.setAuto(true, 1); } catch { this.governor = null; }

    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.7, ...o });
    const G = (c) => M(c, { roughness: 0.3 });
    const add = (geo, mat, x, y, z, parent = scene, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
    const W = this.sim.world, H = WORLD.half;

    // Ground: one low-poly plane, vertex-coloured by biome; hills rise outside the arena
    const seg = 90, size = H * 2 + 90;
    const gg = new THREE.PlaneGeometry(size, size, seg, seg); gg.rotateX(-Math.PI / 2);
    const pos = gg.getAttribute('position'), cols = [];
    const c = new THREE.Color(), base = new THREE.Color(0xc9a46e);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), edge = Math.max(Math.abs(x), Math.abs(z)) - H;
      let y = Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.15;
      if (edge > 0) y += edge * 0.55 + Math.sin(x * 0.3 + z * 0.2) * edge * 0.12;
      pos.setY(i, y);
      c.copy(base);
      let bw = 0;
      for (const b of BIOMES) { const d = Math.hypot(x - b.x, z - b.z) / b.r; const w = Math.max(0, 1.1 - d); if (w > bw) { bw = w; c.copy(base).lerp(new THREE.Color(b.ground), Math.min(1, w * 2)); } }
      if (edge > 0) c.lerp(new THREE.Color(0x9e6f4e), Math.min(1, edge / 12)).lerp(new THREE.Color(0x6aa35a), edge > 25 ? 0.4 : 0);
      c.offsetHSL(0, 0, (Math.sin(i * 12.9898) * 0.5) * 0.04);
      cols.push(c.r, c.g, c.b);
    }
    gg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    ground.receiveShadow = true; scene.add(ground);
    // dirt roads connecting biomes to the centre
    for (const b of BIOMES) { if (b.id === 'machine') continue; const len = Math.hypot(b.x, b.z); const rd = add(new THREE.PlaneGeometry(6, len), M(0xd8bf94), b.x / 2, 0.03, b.z / 2, scene, false); rd.rotation.x = -Math.PI / 2; rd.rotation.z = -Math.atan2(b.x, b.z) + Math.PI; }

    // Canyon cliffs ring (instanced dodecahedra) — the junkyard valley walls
    const cliffN = 140, cliff = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), M(0xb07a5a), cliffN);
    const dm = new THREE.Object3D(), rnd = mulberry(this.sim.seed);
    for (let i = 0; i < cliffN; i++) {
      const a = (i / cliffN) * Math.PI * 2, R = H + 22 + rnd() * 25, s = 8 + rnd() * 14;
      dm.position.set(Math.cos(a) * R * 1.05, s * 0.5 + 8, Math.sin(a) * R * 1.05); dm.scale.set(s, s * (1 + rnd()), s); dm.rotation.set(rnd(), rnd() * 6, rnd()); dm.updateMatrix(); cliff.setMatrixAt(i, dm.matrix);
      cliff.setColorAt(i, new THREE.Color().setHSL(0.05 + rnd() * 0.04, 0.35, 0.45 + rnd() * 0.15));
    }
    cliff.receiveShadow = true; scene.add(cliff);

    // Decor (instanced per kind)
    const decorKinds = {
      tree: [new THREE.ConeGeometry(1.4, 3.6, 6), M(0x3f8f4f), 2.6],
      rock: [new THREE.DodecahedronGeometry(0.9, 0), M(0x9a8f88), 0.5],
      tire: [new THREE.TorusGeometry(0.7, 0.3, 6, 10), M(0x2b2b2b), 0.3],
      shell: [new THREE.ConeGeometry(0.4, 0.5, 5), M(0xffe1c9), 0.25],
      block: [new THREE.BoxGeometry(0.8, 0.8, 0.8), G(0xffffff), 0.4],
      bolt: [new THREE.CylinderGeometry(0.4, 0.4, 0.5, 6), M(0x6b7280, { metalness: 0.4 }), 0.25],
    };
    const trunks = [];
    for (const [k, [geo, mat, y]] of Object.entries(decorKinds)) {
      const items = W.decor.filter(d => d.kind === k); if (!items.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((d, i) => { dm.position.set(d.x, y * d.s, d.z); dm.scale.setScalar(d.s); dm.rotation.set(k === 'tire' ? Math.PI / 2 : 0, d.rot, 0); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); if (k === 'block') im.setColorAt(i, new THREE.Color(d.color)); if (k === 'tree') trunks.push(d); });
      im.castShadow = true; im.receiveShadow = true; scene.add(im);
    }
    if (trunks.length) { const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.3, 1.4, 5), M(0x7a5232), trunks.length); trunks.forEach((d, i) => { dm.position.set(d.x, 0.7 * d.s, d.z); dm.scale.setScalar(d.s); dm.rotation.set(0, 0, 0); dm.updateMatrix(); tm.setMatrixAt(i, dm.matrix); }); scene.add(tm); }

    // Biome signposts / flags
    for (const b of BIOMES) {
      add(new THREE.CylinderGeometry(0.15, 0.15, 7, 5), M(0x8a5a35), b.x + b.r * 0.6, 3.5, b.z + 2);
      const fl = add(new THREE.BoxGeometry(2.6, 1.4, 0.08), M(new THREE.Color().setHSL(BIOMES.indexOf(b) / 5, 0.7, 0.55)), b.x + b.r * 0.6 + 1.3, 6.2, b.z + 2); this.flags = this.flags || []; this.flags.push(fl);
    }

    // Props
    this.propMesh = {};
    for (const p of W.props) {
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z); scene.add(g);
      const pm = { g };
      if (p.type === 'tramp') {
        const pad = add(new THREE.CylinderGeometry(p.r * 0.9, p.r * 0.9, 0.08, 18), M(0x2b2f3a), 0, 0.75, 0, g);
        const rim = add(new THREE.TorusGeometry(p.r, 0.18, 6, 20), G(p.color), 0, 0.78, 0, g); rim.rotation.x = Math.PI / 2;
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(new THREE.CylinderGeometry(0.07, 0.07, 0.78, 5), M(0x9aa3b0), Math.cos(a) * p.r * 0.95, 0.39, Math.sin(a) * p.r * 0.95, g); }
        pm.pad = pad; pm.t = 0;
      } else if (p.type === 'slide') {
        g.position.set(0, 0, 0);
        const pts = [new THREE.Vector3(p.top.x, p.h, p.top.z), new THREE.Vector3(lerp(p.top.x, p.bottom.x, 0.35) + 1.5, p.h * 0.65, lerp(p.top.z, p.bottom.z, 0.35)), new THREE.Vector3(lerp(p.top.x, p.bottom.x, 0.7) - 1, p.h * 0.3, lerp(p.top.z, p.bottom.z, 0.7)), new THREE.Vector3(p.bottom.x, 0.5, p.bottom.z)];
        const curve = new THREE.CatmullRomCurve3(pts);
        add(new THREE.TubeGeometry(curve, 26, 0.8, 9, false), G(p.color), 0, 0, 0, g);
        add(new THREE.BoxGeometry(2.6, p.h, 2.6), M(0xd5dae2), p.top.x, p.h / 2 - 0.4, p.top.z, g);
        for (let y = 0.6; y < p.h; y += 0.8) add(new THREE.BoxGeometry(1.4, 0.1, 0.1), M(0x9aa3b0), p.top.x, y, p.top.z + 1.35, g);
      } else if (p.type === 'merry') {
        const disc = new THREE.Group(); g.add(disc);
        add(new THREE.CylinderGeometry(p.r, p.r, 0.35, 16), G(p.color), 0, 0.3, 0, disc);
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 5), M(i % 2 ? 0xffd23f : 0xffffff), Math.cos(a) * p.r * 0.85, 1.2, Math.sin(a) * p.r * 0.85, disc); }
        add(new THREE.CylinderGeometry(0.3, 0.3, 2, 6), M(0x9aa3b0), 0, 1.2, 0, disc);
        add(new THREE.ConeGeometry(p.r * 0.95, 0.8, 8), G(0xff6b9e), 0, 2.4, 0, disc);
        pm.disc = disc;
      } else if (p.type === 'swing') {
        g.rotation.y = -p.rot;
        for (const sx of [-2.6, 2.6]) for (const sz of [-1.1, 1.1]) { const leg = add(new THREE.CylinderGeometry(0.1, 0.1, 4.6, 5), M(p.color), sx * 0.95, 2.2, sz, g); leg.rotation.x = sz > 0 ? -0.25 : 0.25; }
        add(new THREE.CylinderGeometry(0.12, 0.12, 5.4, 6), M(0x9aa3b0), 0, 4.4, 0, g).rotation.z = Math.PI / 2;
        pm.seats = [-1, 1].map(sx => { const piv = new THREE.Group(); piv.position.set(sx, 4.4, 0); g.add(piv); add(new THREE.BoxGeometry(0.03, 3.2, 0.03), M(0x6b7280), 0, -1.6, 0, piv); add(new THREE.BoxGeometry(0.9, 0.12, 0.5), M(0x2b2b2b), 0, -3.2, 0, piv); return piv; });
      } else if (p.type === 'seesaw') {
        g.rotation.y = -p.rot;
        add(new THREE.ConeGeometry(0.6, 0.9, 4), M(0x9aa3b0), 0, 0.45, 0, g);
        const beam = new THREE.Group(); beam.position.y = 0.9; g.add(beam);
        add(new THREE.BoxGeometry(5, 0.2, 0.6), G(p.color), 0, 0, 0, beam);
        for (const sx of [-2.2, 2.2]) add(new THREE.BoxGeometry(0.1, 0.6, 0.5), M(0xffd23f), sx, 0.4, 0, beam);
        pm.beam = beam;
      } else if (p.type === 'gym') {
        const n = Math.round(p.h / 1.3), w = p.r;
        const barM = M(p.color, { metalness: 0.2 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(p.tower ? 0.18 : 0.09, p.tower ? 0.18 : 0.09, p.h + 0.5, 5), barM, sx * w * 0.6, (p.h + 0.5) / 2, sz * w * 0.6, g);
        for (let i = 1; i <= n; i++) { const y = i * p.h / n; for (const rot of [0, Math.PI / 2]) for (const s of [-1, 1]) { const b = add(new THREE.BoxGeometry(w * 1.2, 0.08, 0.08), barM, 0, y, s * w * 0.6, g); if (rot) { b.rotation.y = rot; b.position.set(s * w * 0.6, y, 0); } } }
        if (p.tower) { add(new THREE.BoxGeometry(w * 1.5, 0.2, w * 1.5), M(0x8a5a35), 0, p.h, 0, g); add(new THREE.ConeGeometry(w * 1.1, 1.4, 4), M(0x6b4a2b), 0, p.h + 2.2, 0, g).rotation.y = Math.PI / 4; for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.12, 1.5, 0.12), M(0x8a5a35), sx * w * 0.7, p.h + 0.8, sz * w * 0.7, g); const flag = add(new THREE.BoxGeometry(1.2, 0.7, 0.05), M(0x4f7a3a), 0.6, p.h + 3.6, 0, g); add(new THREE.CylinderGeometry(0.05, 0.05, 2, 4), M(0x333333), 0, p.h + 3.2, 0, g); pm.flag = flag; }
        else add(new THREE.BoxGeometry(w * 1.2, 0.12, w * 1.2), G(0xffd23f), 0, p.h, 0, g);
      } else if (p.type === 'platform') {
        g.position.set(p.cur.x, 0, p.cur.z);
        add(new THREE.BoxGeometry(3.4, 0.4, 3.4), G(p.color), 0, 1.1, 0, g);
        add(new THREE.BoxGeometry(3.4, 0.15, 0.15), M(0xffd23f), 0, 1.35, 1.6, g); add(new THREE.BoxGeometry(3.4, 0.15, 0.15), M(0xffd23f), 0, 1.35, -1.6, g);
        // track
        const dx = p.b.x - p.a.x, dz = p.b.z - p.a.z, len = Math.hypot(dx, dz);
        const tr = add(new THREE.BoxGeometry(0.6, 0.15, len + 3), M(0x4b5260), (p.a.x + p.b.x) / 2, 0.08, (p.a.z + p.b.z) / 2, scene, false); tr.rotation.y = Math.atan2(dx, dz);
      }
      this.propMesh[p.id] = pm;
    }
    // Hides
    for (const h of W.hides) {
      const g = new THREE.Group(); g.position.set(h.x, 0, h.z); g.rotation.y = h.rot || 0; scene.add(g);
      if (h.kind === 'tunnel') { const t = add(new THREE.CylinderGeometry(1.4, 1.4, 4, 12, 1, true), new THREE.MeshStandardMaterial({ color: h.color, flatShading: true, side: THREE.DoubleSide, roughness: 0.3 }), 0, 1.2, 0, g); t.rotation.x = Math.PI / 2; }
      else if (h.kind === 'tires') { for (let i = 0; i < 7; i++) { const tt = add(new THREE.TorusGeometry(0.75, 0.32, 6, 10), M(0x2b2b2b), (i % 3 - 1) * 1.2, 0.35 + Math.floor(i / 3) * 0.6, (i % 2) * 0.6 - 0.3, g); tt.rotation.x = Math.PI / 2; } }
      else { add(new THREE.BoxGeometry(2.4, 1.8, 2.4), M(0xc49a6c), 0, 0.9, 0, g); add(new THREE.BoxGeometry(2.5, 0.08, 0.3), M(0x8a6a44), 0, 1.81, 0, g); add(new THREE.BoxGeometry(1.2, 1.1, 0.1), M(0x3a2a1a), 0, 0.55, 1.21, g); }
    }
    // Breakables
    this.brkMesh = {};
    for (const b of W.breakables) {
      const g = new THREE.Group(); g.position.set(b.x, 0, b.z); g.rotation.y = b.rot || 0; scene.add(g);
      if (b.kind === 'board') {
        add(new THREE.BoxGeometry(3.2, 2.4, 0.18), M(0x2f3a3a), 0, 2.2, 0, g);
        for (const [w, hh, x, y] of [[3.6, 0.22, 0, 3.4], [3.6, 0.22, 0, 1.0], [0.22, 2.8, -1.7, 2.2], [0.22, 2.8, 1.7, 2.2]]) add(new THREE.BoxGeometry(w, hh, 0.26), M(0xb57a45), x, y, 0, g);
        for (const sx of [-1.2, 1.2]) add(new THREE.BoxGeometry(0.2, 1.1, 0.2), M(0xb57a45), sx, 0.5, 0, g);
        const pts = []; const rr = mulberry(b.id.length * 31 + b.x * 7);
        for (let d = 0; d < 4; d++) { const cx = (rr() - 0.5) * 2.2, cy = 1.6 + rr() * 1.4, ra = 0.2 + rr() * 0.25; for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283, a2 = (i + 1) / 8 * 6.283; pts.push(cx + Math.cos(a) * ra, cy + Math.sin(a) * ra, 0.1, cx + Math.cos(a2) * ra, cy + Math.sin(a2) * ra, 0.1); } }
        const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xe6fff0 })));
      } else {
        add(new THREE.BoxGeometry(1.8, 1.8, 1.8), M(0xa8743f), 0, 0.9, 0, g);
        for (const y of [0.3, 1.5]) add(new THREE.BoxGeometry(1.86, 0.18, 1.86), M(0x7a5232), 0, y, 0, g);
        add(new THREE.BoxGeometry(0.15, 1.9, 2.4), M(0x7a5232), 0, 0.9, 0, g).rotation.x = 0.75;
      }
      this.brkMesh[b.id] = { g, shake: 0 };
    }
    // Ground zones
    for (const z of W.zones) {
      if (z.kind === 'conveyor') {
        const g = new THREE.Group(); g.position.set(z.x, 0, z.z); g.rotation.y = Math.atan2(z.dx, z.dz); scene.add(g);
        add(new THREE.BoxGeometry(z.w + 0.6, 0.35, z.len + 0.6), M(0x4b5260), 0, 0.15, 0, g);
        const belt = add(new THREE.BoxGeometry(z.w, 0.05, z.len), M(0x2b2f3a), 0, 0.35, 0, g, false);
        const stripes = []; for (let i = 0; i < 6; i++) stripes.push(add(new THREE.BoxGeometry(z.w * 0.9, 0.06, 0.25), M(0xffd23f), 0, 0.38, -z.len / 2 + i * z.len / 6, g, false));
        z._mesh = { belt, stripes };
      } else {
        const m = add(new THREE.CircleGeometry(z.r, 14), M(z.kind === 'sand' ? 0xf5dfa8 : 0x5fb3e8, z.kind === 'sand' ? {} : { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.8 }), z.x, 0.04, z.z, scene, false);
        m.rotation.x = -Math.PI / 2;
        if (z.kind === 'sand') { const rim = add(new THREE.TorusGeometry(z.r, 0.3, 4, 16), M(0xb57a45), z.x, 0.15, z.z, scene, false); rim.rotation.x = Math.PI / 2; for (let i = 0; i < 3; i++) add(new THREE.ConeGeometry(0.6, 0.6, 6), M(0xe8cf8f), z.x + (i - 1) * z.r * 0.4, 0.3, z.z + Math.sin(i) * z.r * 0.3, scene); }
      }
    }
    // Hazards
    this.hazMesh = {};
    for (const h of W.hazards) {
      if (h.kind === 'pendulum') {
        const frame = new THREE.Group(); frame.position.set(h.x, 0, h.z); frame.rotation.y = Math.atan2(h.ax, h.az) + Math.PI / 2; scene.add(frame);
        for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.35, 11, 0.35), M(0xe03a3a), s * 1.6, 5.5, 0, frame); }
        add(new THREE.BoxGeometry(3.6, 0.4, 0.4), M(0xe03a3a), 0, 11, 0, frame);
        const chain = add(new THREE.CylinderGeometry(0.06, 0.06, 1, 4), M(0x333333), h.x, 6, h.z);
        const ball = add(new THREE.IcosahedronGeometry(1.3, 0), M(0x3a3a3a, { metalness: 0.5, roughness: 0.4 }), h.x, 1, h.z);
        this.hazMesh[h.id] = { chain, ball };
      } else {
        const ball = add(new THREE.IcosahedronGeometry(h.r, 1), h.beach ? M(0xffffff) : M(h.color, { metalness: 0.3 }), h.x, h.r, h.z);
        if (h.beach) { for (let i = 0; i < 3; i++) { const band = new THREE.Mesh(new THREE.TorusGeometry(h.r * 1.002, 0.25, 4, 16), M([0xe03a3a, 0x2f6fe0, 0xffd23f][i])); band.rotation.y = i * Math.PI / 3; ball.add(band); } }
        this.hazMesh[h.id] = { ball };
      }
    }
    // Storm wall
    const zg = new THREE.CylinderGeometry(1, 1, 40, 48, 1, true);
    this.zoneMesh = new THREE.Mesh(zg, new THREE.MeshBasicMaterial({ color: 0x8a4fff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    this.zoneMesh.position.set(this.sim.zone.x, 20, this.sim.zone.z); scene.add(this.zoneMesh);
    // Pickups
    this.pickGeo = { food: new THREE.IcosahedronGeometry(0.45, 0), health: new THREE.OctahedronGeometry(0.5, 0), energy: new THREE.ConeGeometry(0.35, 0.9, 5), toy: new THREE.BoxGeometry(0.7, 0.7, 0.7) };
    this.pickMat = Object.fromEntries(Object.entries(PICK_COLORS).map(([k, c]) => [k, G(c)]));
    this.pickMesh = new Map();
    // Dweebs
    this.dweebMesh = this.sim.dweebs.map(f => {
      const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
      const col = new THREE.Color(f.color), bm = G(col), sz = 0.7 + f.stats.size * 0.8;
      const mesh = f.shape === 'capsule' ? new THREE.Mesh(new THREE.CapsuleGeometry(sz * 0.42, sz * 0.7, 4, 8), bm) : new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz * 0.85), bm);
      mesh.position.y = f.shape === 'capsule' ? sz * 0.8 : sz / 2; mesh.castShadow = true; body.add(mesh);
      const eyes = new THREE.Group(); eyes.position.y = mesh.position.y + sz * 0.15; addEyes(eyes, sz * 0.43, sz * 0.2, sz * 0.15); body.add(eyes);
      for (const sx of [-1, 1]) { const ft = new THREE.Mesh(new THREE.BoxGeometry(sz * 0.25, sz * 0.15, sz * 0.35), M(col.clone().multiplyScalar(0.6))); ft.position.set(sx * sz * 0.25, 0.05, 0.05); body.add(ft); }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(sz * 0.75, f.isPlayer ? 0.12 : 0.05, 4, 20), new THREE.MeshBasicMaterial({ color: f.isPlayer ? 0xffd23f : 0xffffff, transparent: true, opacity: f.isPlayer ? 1 : 0.5 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; g.add(ring);
      let star = null;
      if (f.isPlayer) { star = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), new THREE.MeshBasicMaterial({ color: 0xffd23f })); star.position.y = sz * 2 + 1.2; g.add(star); }
      scene.add(g);
      return { g, body, bm, ring, star, sz };
    });
    this.debris = []; this.debrisGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    this._onKey = e => {
      if (!this.hud) return;
      if (e.key === ' ') { this.paused = !this.paused; this.syncSpeed(); e.preventDefault(); }
      else if (e.key === 'Tab' || e.key === 'n') { this.cycle(1); e.preventDefault(); }
      else if (e.key === 'f') { this.freeCam = true; this.syncCam(); }
      else if (e.key === 'm') this.followMine();
      else if (['1', '2', '4'].includes(e.key)) { this.speed = +e.key; this.paused = false; this.syncSpeed(); }
    };
    window.addEventListener('keydown', this._onKey);
  }

  cycle(dir) {
    const alive = this.sim.dweebs.filter(d => d.alive); if (!alive.length) return;
    const cur = alive.findIndex(d => d.idx === this.followIdx);
    this.followIdx = alive[(cur + dir + alive.length) % alive.length].idx; this.freeCam = false; this.syncCam();
  }
  followMine() { const me = this.sim.dweebs.find(d => d.isPlayer); if (me) { this.followIdx = me.idx; this.freeCam = false; this.syncCam(); } }

  spawnDebris(x, y, z, n, colors, speed = 6, life = 1.2) {
    for (let i = 0; i < n; i++) {
      if (this.debris.length > 220) { const o = this.debris.shift(); this.scene.remove(o.m); o.m.material.dispose(); }
      const m = new THREE.Mesh(this.debrisGeo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], flatShading: true }));
      m.position.set(x, y, z); m.scale.setScalar(0.6 + Math.random()); this.scene.add(m);
      const a = Math.random() * 6.283, s = speed * (0.4 + Math.random());
      this.debris.push({ m, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 2 + Math.random() * speed, life });
    }
  }

  handleEvents() {
    const S = this.sim;
    for (const e of S.events) {
      if (e.type === 'hit') this.spawnDebris(e.x, e.y, e.z, 5, ['#ffffff', '#ffd23f', S.dweebs[e.o].color], 5, 0.6);
      else if (e.type === 'ko') { this.spawnDebris(e.x, 1, e.z, 22, ['#ffd23f', '#ff6b9e', '#5ee06a', '#2f6fe0'], 9, 1.5); if (e.o === this.followIdx && !this.freeCam) this.pendingCycle = 2; }
      else if (e.type === 'break') { const bm = this.brkMesh[e.id]; if (bm) this.scene.remove(bm.g); this.spawnDebris(e.x, 1.5, e.z, 26, e.kind === 'board' ? ['#2f3a3a', '#b57a45', '#d8d0c4'] : ['#a8743f', '#7a5232', '#d8bf94'], 7, 2.5); }
      else if (e.type === 'brkHit') { const bm = this.brkMesh[e.id]; if (bm) bm.shake = 0.3; }
      else if (e.type === 'bounce') { const pm = this.propMesh[e.id]; if (pm) pm.t = 0.35; }
      else if (e.type === 'land' && e.big) this.spawnDebris(e.x, 0.2, e.z, 10, ['#d8bf94', '#ffffff'], 6, 0.8);
      else if (e.type === 'pickup') this.spawnDebris(e.x, 0.6, e.z, 6, ['#' + PICK_COLORS[e.kind].toString(16).padStart(6, '0'), '#ffffff'], 3, 0.6);
      else if (e.type === 'end' && !this.ended) { this.ended = true; this.showResults(); }
    }
  }

  renderFrame(dt) {
    const S = this.sim, W = S.world, t = S.t;
    for (const p of W.props) {
      const pm = this.propMesh[p.id]; if (!pm) continue;
      if (p.type === 'merry') pm.disc.rotation.y = -p.ang;
      else if (p.type === 'platform') pm.g.position.set(p.cur.x, 0, p.cur.z);
      else if (p.type === 'tramp') { pm.t = Math.max(0, pm.t - dt); pm.pad.position.y = 0.75 - Math.sin(pm.t * 18) * pm.t * 0.8; }
      else if (p.type === 'swing') pm.seats.forEach((s, i) => { s.rotation.x = Math.sin(t * 2.2 + p.phase + i) * 0.7; });
      else if (p.type === 'seesaw') pm.beam.rotation.z = Math.sin(t * 2 + p.phase) * 0.3;
      if (pm.flag) pm.flag.rotation.y = Math.sin(performance.now() / 300) * 0.3;
    }
    for (const z of W.zones) if (z._mesh) z._mesh.stripes.forEach((s, i) => { s.position.z = ((i * z.len / 6 + t * z.speed) % z.len) - z.len / 2; });
    for (const h of W.hazards) {
      const hm = this.hazMesh[h.id];
      if (h.kind === 'pendulum') { hm.ball.position.set(h.bob.x, h.bob.y, h.bob.z); const top = new THREE.Vector3(h.x, 11, h.z), bp = hm.ball.position; hm.chain.position.copy(top).add(bp).multiplyScalar(0.5); hm.chain.scale.y = top.distanceTo(bp); hm.chain.lookAt(top); hm.chain.rotateX(Math.PI / 2); hm.ball.rotation.y += dt * 2; }
      else { hm.ball.position.set(h.x, h.r, h.z); hm.ball.rotation.x += h.vz * dt / h.r; hm.ball.rotation.z -= h.vx * dt / h.r; }
    }
    for (const id in this.brkMesh) { const b = this.brkMesh[id]; if (b.shake > 0) { b.shake = Math.max(0, b.shake - dt); b.g.rotation.z = Math.sin(b.shake * 50) * b.shake * 0.2; } }
    // storm
    const zr = Math.max(0.1, S.zone.r); this.zoneMesh.scale.set(zr, 1, zr); this.zoneMesh.visible = zr < 150; this.zoneMesh.material.opacity = 0.12 + Math.sin(performance.now() / 400) * 0.04;
    // pickups (pooled meshes keyed by pickup id)
    const seen = new Set();
    for (const p of W.pickups) {
      seen.add(p.id);
      let m = this.pickMesh.get(p.id);
      if (!m) { m = new THREE.Mesh(this.pickGeo[p.type], this.pickMat[p.type]); m.castShadow = true; this.scene.add(m); this.pickMesh.set(p.id, m); }
      const bob = p.heldBy || p.thrown || p.y > 0 ? 0 : 0.5 + Math.sin(performance.now() / 300 + p.id) * 0.15;
      m.position.set(p.x, p.y + bob, p.z); m.rotation.y += dt * 1.5;
    }
    for (const [id, m] of this.pickMesh) if (!seen.has(id)) { this.scene.remove(m); this.pickMesh.delete(id); }
    // dweebs
    S.dweebs.forEach((f, i) => {
      const D = this.dweebMesh[i];
      if (!f.alive) { D.g.position.y = Math.max(-2, D.g.position.y - dt * 1.2); D.body.rotation.z = Math.min(Math.PI / 2, D.body.rotation.z + dt * 4); if (D.star) D.star.visible = false; return; }
      D.g.position.set(f.x, f.y, f.z); D.body.rotation.y = f.face;
      const sq = f.squash, wind = f.action === 'windup' ? 0.15 : 0;
      D.body.scale.set(1 + sq * 0.5 + wind, 1 - sq * 0.6 - wind * 0.5, 1 + sq * 0.5);
      D.body.rotation.x = f.use?.obj?.type === 'slide' ? 0.6 : f.action === 'recover' ? -0.25 : 0;
      D.body.visible = !f.hidden || i === this.followIdx || f.isPlayer;
      D.bm.emissive.setRGB(f.hitFlash * 3, f.hitFlash * (f.zoneHurt ? 0 : 3), f.hitFlash * 3);
      if (D.star) { D.star.rotation.y += dt * 3; D.star.position.y = D.sz * 2 + 1.2 + Math.sin(performance.now() / 250) * 0.2; }
      D.ring.scale.setScalar(i === this.followIdx ? 1.25 + Math.sin(performance.now() / 200) * 0.1 : 1);
    });
    for (const d of this.debris) { d.vy -= 18 * dt; d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt; d.m.rotation.x += 6 * dt; if (d.m.position.y < 0.1) { d.m.position.y = 0.1; d.vy *= -0.3; d.vx *= 0.6; d.vz *= 0.6; } d.life -= dt; }
    this.debris = this.debris.filter(d => { if (d.life <= 0) { this.scene.remove(d.m); d.m.material.dispose(); return false; } return true; });
    // camera
    if (this.pendingCycle != null) { this.pendingCycle -= dt; if (this.pendingCycle <= 0) { this.pendingCycle = null; if (!S.dweebs[this.followIdx].alive) this.cycle(1); } }
    const f = S.dweebs[this.followIdx];
    const ctl = this.controls;
    if (!this.freeCam && f) {
      const goal = new THREE.Vector3(f.x, f.y + 1, f.z);
      const delta = goal.clone().sub(ctl.target).multiplyScalar(Math.min(1, dt * 4));
      ctl.target.add(delta); this.camera.position.add(delta);
      const off = this.camera.position.clone().sub(ctl.target);
      if (!this.userTouched && off.length() > 26) { off.setLength(lerp(off.length(), 24, Math.min(1, dt * 1.5))); this.camera.position.copy(ctl.target).add(off); }
    }
    ctl.update();
    this.sun.position.set(ctl.target.x - 40, 60, ctl.target.z - 30); this.sun.target.position.copy(ctl.target);
    this.renderer.render(this.scene, this.camera);
    this.updateHud();
  }

  // ─── HUD ──────────────────────────────────────────────────────────────────
  buildHud() {
    const h = document.createElement('div'); h.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    h.innerHTML = `<div class="wl-panel wl-roster" id="wl-roster"></div>
      <div class="wl-panel wl-top"><span id="wl-time">0</span> · <span id="wl-zone"></span> · <span id="wl-alive"></span><br>
        <button class="wl-btn" data-sp="0">⏸</button><button class="wl-btn" data-sp="1">1×</button><button class="wl-btn" data-sp="2">2×</button><button class="wl-btn" data-sp="4">4×</button>
        <button class="wl-btn alt" id="wl-prev">◀</button><button class="wl-btn alt" id="wl-next">▶ Follow</button><button class="wl-btn alt" id="wl-mine">⭐ Mine</button><button class="wl-btn alt" id="wl-free">🎥 Free</button>
        <button class="wl-btn red" id="wl-back">⬅</button>
        <div class="wl-legend">Drag to orbit · scroll to zoom · Tab cycle · M mine · F free cam · Space pause · 1/2/4 speed</div></div>
      <div class="wl-panel wl-focus" id="wl-focus"></div>
      <div class="wl-panel wl-feed" id="wl-feed"></div><div id="wl-tags"></div>`;
    this.root.appendChild(h); this.hud = h;
    h.querySelectorAll('[data-sp]').forEach(b => b.addEventListener('click', () => { const v = +b.dataset.sp; if (v === 0) this.paused = !this.paused; else { this.speed = v; this.paused = false; } this.syncSpeed(); }));
    h.querySelector('#wl-prev').addEventListener('click', () => this.cycle(-1));
    h.querySelector('#wl-next').addEventListener('click', () => this.cycle(1));
    h.querySelector('#wl-mine').addEventListener('click', () => this.followMine());
    h.querySelector('#wl-free').addEventListener('click', () => { this.freeCam = !this.freeCam; this.syncCam(); });
    h.querySelector('#wl-back').addEventListener('click', () => this.showSetup());
    h.querySelector('#wl-roster').addEventListener('click', e => { const d = e.target.closest('[data-f]'); if (d) { this.followIdx = +d.dataset.f; this.freeCam = false; this.syncCam(); } });
    this.tagEls = this.sim.dweebs.map(f => { const el = document.createElement('div'); el.className = 'wl-tag' + (f.isPlayer ? ' me' : ''); h.querySelector('#wl-tags').appendChild(el); return el; });
    this._hudT = 0; this.syncSpeed(); this.syncCam();
  }
  syncSpeed() { this.hud?.querySelectorAll('[data-sp]').forEach(b => b.classList.toggle('on', +b.dataset.sp === 0 ? this.paused : (!this.paused && +b.dataset.sp === this.speed))); }
  syncCam() { this.hud?.querySelector('#wl-free')?.classList.toggle('on', this.freeCam); }

  updateHud() {
    if (!this.hud) return;
    const S = this.sim, v = new THREE.Vector3();
    // floating name tags (only near the camera, so the big map stays readable)
    S.dweebs.forEach((f, i) => {
      const el = this.tagEls[i];
      v.set(f.x, f.y + this.dweebMesh[i].sz * 2 + 0.6, f.z);
      const camD = v.distanceTo(this.camera.position);
      v.project(this.camera);
      const show = f.alive && v.z < 1 && camD < 75 && (!f.hidden || i === this.followIdx || f.isPlayer);
      el.style.display = show ? 'block' : 'none';
      if (show) { el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`; if ((this._hudT % 6) === 0) el.textContent = (f.isPlayer ? '⭐ ' : '') + f.name + (i === this.followIdx ? ' · ' + f.thought : ''); }
    });
    if ((this._hudT = (this._hudT + 1) % 6) !== 0) return;
    const bar = (v, c) => `<span><i style="width:${Math.max(0, Math.min(100, v)).toFixed(0)}%;background:${c}"></i></span>`;
    const order = [...S.dweebs].sort((a, b) => (b.alive - a.alive) || (b.isPlayer - a.isPlayer) || (b.hp - a.hp));
    this.hud.querySelector('#wl-roster').innerHTML = `<div style="font-size:15px">🌲 DWEEBS <span class="wl-legend">❤️ hp · ⚡ energy · 🍎 food · 🎈 fun</span></div>` + order.map(f => `<div class="wl-d ${f.isPlayer ? 'me' : ''} ${f.idx === this.followIdx ? 'cam' : ''} ${f.alive ? '' : 'dead'}" data-f="${f.idx}">
      <b style="color:${f.color};-webkit-text-stroke:.5px #14101c">${f.isPlayer ? '⭐ ' : ''}${esc(f.name)}</b> <small style="font-family:system-ui;opacity:.6">${f.alive ? traitBlurb(f) : `#${f.place} · ${f.cause}`}</small>
      ${f.alive ? `<div class="th">${esc(f.thought)}</div><div class="wl-bars">${bar(f.hp / f.maxHp * 100, '#5ee06a')}${bar(f.sta / f.maxSta * 100, '#ffd23f')}${bar(f.hunger, '#e03a3a')}${bar(f.fun, '#b25ee0')}</div>` : ''}</div>`).join('');
    const zr = S.zone.r, tl = S.t < MATCH.zoneStart ? `🌀 storm in ${Math.ceil(MATCH.zoneStart - S.t)}s` : `🌀 safe zone ${Math.round(zr)}m`;
    this.hud.querySelector('#wl-time').textContent = `⏱ ${fmt(S.t)} / ${fmt(S.timeLimit)}`;
    this.hud.querySelector('#wl-zone').textContent = tl;
    this.hud.querySelector('#wl-alive').textContent = `🧍 ${S.alive().length} left`;
    const f = S.dweebs[this.followIdx];
    if (f) this.hud.querySelector('#wl-focus').innerHTML = `<div class="big">${this.freeCam ? '🎥 Free cam · ' : '🎬 Following '}<b style="color:${f.color};-webkit-text-stroke:.5px #14101c">${f.isPlayer ? '⭐ ' : ''}${esc(f.name)}</b></div><div style="font-family:system-ui">${f.alive ? esc(f.thought) : `Out — #${f.place}`}</div><div class="wl-legend">${statLine(f)}</div>`;
    this.hud.querySelector('#wl-feed').innerHTML = S.feed.slice(0, 9).map(x => `<div><span style="opacity:.5">${fmt(x.t)}</span> ${esc(x.text)}</div>`).join('') || '<div style="opacity:.6">Dweebs are dropping in…</div>';
  }

  showResults() {
    const S = this.sim, coll = loadCollection(), me = S.dweebs.find(d => d.isPlayer);
    let loot = [];
    if (me && !coll.sandbox) {
      const facts = fightFacts(me, me.place === 1);
      facts.team = me.place <= 3 ? 1 : 0;
      const ids = rollDrops(facts, this.seed * 17 + 5, coll), fresh = grantTraits(coll, ids);
      loot = ids.map(id => ({ t: TRAIT_BY_ID.get(id), fresh: fresh.includes(id) }));
      coll.battles = (coll.battles || 0) + 1; grantTraits(coll, []);
    }
    const rc = Object.fromEntries(RARITIES.map(r => [r.id, r.color]));
    setTimeout(() => {
      if (!this.hud || this.sim !== S) return;
      const el = document.createElement('div'); el.className = 'wl-panel wl-setup'; el.id = 'wl-results';
      const rows = S.ranking().map(f => `<tr style="${f.isPlayer ? 'background:#fff1b8' : ''}"><td>#${f.place}</td><td style="color:${f.color};-webkit-text-stroke:.4px #14101c">${f.isPlayer ? '⭐ ' : ''}${esc(f.name)}</td><td>${fmt(f.alive ? S.t : f.deathT)}</td><td>${f.kos}</td><td>${f.score}</td><td style="font-family:system-ui;font-size:11px">${f.alive ? 'survived' : f.cause} · ${Object.entries(f.decisions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(', ')}</td></tr>`).join('');
      const hl = S.highlights.slice(-8).map(h => `<div>${fmt(h.t)} ${esc(h.text)}</div>`).join('');
      const lootHtml = me ? (coll.sandbox ? '<div class="wl-legend">Sandbox on — no drops.</div>' : `<div style="font-size:17px;margin-top:6px">🎁 TRAIT DROPS for ${esc(me.name)}</div>` + (loot.map(l => `<div style="font-family:system-ui;font-size:13px"><b style="color:${rc[l.t.rarity]}">[${l.t.rarity}] ${esc(l.t.name)}</b>${l.fresh ? ' <b style="color:#c0262d">NEW!</b>' : ' (dupe)'}</div>`).join('') || '<div class="wl-legend">No drops this time.</div>')) : '<div class="wl-legend">Drop your own Dweeb in to earn trait drops.</div>';
      el.innerHTML = `<div style="font-size:28px">🏆 ${esc(S.winner.name)} SURVIVED THE WILDS</div>
        ${me ? `<div style="font-size:18px">Your ${esc(me.name)} placed #${me.place} of ${S.dweebs.length} · survived ${fmt(me.alive ? S.t : me.deathT)} · ate ${me.eats} snacks · played ${me.plays}× · ${me.kos} KOs · travelled ${Math.round(me.dist)}m</div>` : ''}
        <table style="width:100%;margin:8px 0;font-size:13px"><tr><th>#</th><th align=left>Dweeb</th><th>Time</th><th>KOs</th><th>Score</th><th align=left>Fate · favourite moves</th></tr>${rows}</table>
        <div style="font-size:16px">🎬 HIGHLIGHTS</div><div style="font-family:system-ui;font-size:12px">${hl}</div>${lootHtml}<div style="height:8px"></div>
        <button class="wl-btn" id="wl-again">🔁 Again</button><button class="wl-btn alt" id="wl-setup2">Change Dweeb</button><button class="wl-btn red" id="wl-exit2">⬅ Exit</button>`;
      this.hud.appendChild(el);
      el.querySelector('#wl-again').addEventListener('click', () => { const m = this.mine; this.stop(); this.start(m); });
      el.querySelector('#wl-setup2').addEventListener('click', () => this.showSetup());
      el.querySelector('#wl-exit2').addEventListener('click', () => this.exit());
    }, 1500);
  }
}

function traitBlurb(f) {
  const s = f.stats, t = [];
  if (s.speed > 0.62) t.push('fast'); if (s.speed < 0.38) t.push('slow'); if (s.weight > 0.62) t.push('heavy'); if (s.weight < 0.35) t.push('light');
  if (s.aggression > 0.62) t.push('aggro'); if (s.caution > 0.6) t.push('cautious'); if (s.cunning > 0.6) t.push('sneaky'); if (f.playful > 0.6) t.push('playful'); if (s.grip > 0.62) t.push('grippy');
  return t.slice(0, 3).join(' · ') || `${f.traits.length} traits`;
}
function statLine(f) { const s = f.stats, p = k => Math.round(s[k] * 100); return `SPD ${p('speed')} · STR ${p('strength')} · WGT ${p('weight')} · GRIP ${p('grip')} · AGG ${p('aggression')} · CAU ${p('caution')} · CUN ${p('cunning')} · CUR ${p('curiosity')} · ${f.traits.length} traits`; }
function fmt(t) { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
function lerp(a, b, t) { return a + (b - a) * t; }
function addEyes(g, z, r, sp) {
  const w = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }), p = new THREE.MeshBasicMaterial({ color: 0x14101c });
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), w); e.position.set(sx * (sp + r * 0.6), 0, z); g.add(e); const pu = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 6, 5), p); pu.position.set(sx * (sp + r * 0.6), 0, z + r * 0.7); g.add(pu); }
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
