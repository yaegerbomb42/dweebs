import * as THREE from 'three';

/**
 * Vault cosmetics made real: every HAT_POOL / TOOL_POOL string maps to a tiny low-poly
 * mesh that sits on the player's head or in their right hand, in every mode.
 * Stat-free. Ownership is the union of colony.hats/tools ever found (persisted here so
 * brawl can show what adventure earned). Equipped choice persists too.
 */
const KEY = 'dweebs.wardrobe.v1';
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, ...extra });

const HATS = {
  'Berry Beret': () => {
    const g = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xd7263d));
    cap.scale.set(1.15, 0.55, 1.15); cap.rotation.z = 0.2;
    const stem = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 6), toon(0x3d8b37));
    stem.position.y = 0.15;
    for (let i = 0; i < 8; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 4), toon(0xffe08a)); const a = i * 0.8; s.position.set(Math.cos(a) * 0.2, 0.06 + (i % 2) * 0.03, Math.sin(a) * 0.2); g.add(s); }
    g.add(cap, stem); return g;
  },
  'Tin Crown': () => {
    const g = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.12, 10, 1, true), toon(0xc9d1d9, { side: THREE.DoubleSide }));
    band.position.y = 0.06; g.add(band);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 4), toon(0xc9d1d9));
      const a = (i / 5) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.19, 0.18, Math.sin(a) * 0.19); g.add(sp);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), toon([0xff4d6d, 0x4dabff, 0x5ee06a, 0xffd23f, 0xb07cff][i]));
      gem.position.set(Math.cos(a) * 0.205, 0.06, Math.sin(a) * 0.205); g.add(gem);
    }
    return g;
  },
  'Top Hat': () => {
    const g = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 14), toon(0x1b1030));
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.19, 0.36, 14), toon(0x1b1030));
    crown.position.y = 0.19;
    const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.192, 0.192, 0.06, 14), toon(0xff384b));
    ribbon.position.y = 0.06;
    g.add(brim, crown, ribbon); return g;
  },
  'Moss Cap': () => {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x5f8f4e));
    const bill = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 12, 1, false, -Math.PI / 2, Math.PI), toon(0x4a7a3d));
    bill.position.set(0, 0.01, 0.12); bill.scale.set(1, 1, 0.8);
    for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), toon(0x8fd18a)); const a = i * 1.1; t.position.set(Math.cos(a) * 0.13, 0.17, Math.sin(a) * 0.13); g.add(t); }
    g.add(dome, bill); return g;
  },
  'Acorn Helm': () => {
    const g = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), toon(0x8b5a2b));
    cup.scale.y = 0.8;
    const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.12, 6), toon(0x5a3a1a));
    nub.position.y = 0.24; nub.rotation.z = 0.3;
    g.add(cup, nub); return g;
  },
};

const TOOLS = {
  'Wobbly Wrench': () => {
    const g = new THREE.Group();
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.03), toon(0x9aa5b1)); h.position.y = -0.18;
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.022, 6, 10, Math.PI * 1.5), toon(0x9aa5b1)); head.position.y = -0.38;
    g.add(h, head); return g;
  },
  'Plush Hammer': () => {
    const g = new THREE.Group();
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 6), toon(0xd4a86a)); h.position.y = -0.18;
    const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.14, 4, 8), toon(0xff7eb6)); head.rotation.z = Math.PI / 2; head.position.y = -0.38;
    g.add(h, head); return g;
  },
  'Snip-Snips': () => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.22, 4), toon(0xdfe6ee)); blade.position.set(s * 0.02, -0.25, 0); blade.rotation.set(Math.PI, 0, s * 0.15);
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.014, 5, 10), toon(0xff384b)); loop.position.set(s * 0.045, -0.08, 0);
      g.add(blade, loop);
    }
    return g;
  },
  'Magnet Mitt': () => {
    const g = new THREE.Group();
    const u = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.035, 6, 12, Math.PI), toon(0xff384b)); u.rotation.z = Math.PI; u.position.y = -0.14;
    for (const s of [-1, 1]) { const tip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.07), toon(0xe6edf3)); tip.position.set(s * 0.08, -0.12, 0); g.add(tip); }
    g.add(u); return g;
  },
};

/** "🎩 Top Hat" -> "Top Hat" */
export const cosmeticKey = (s) => String(s || '').replace(/^[^A-Za-z]+/, '').trim();
export const hatNames = () => Object.keys(HATS);
export const toolNames = () => Object.keys(TOOLS);

export function loadWardrobe() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && typeof d === 'object') return { hat: d.hat || null, tool: d.tool || null, hats: d.hats || [], tools: d.tools || [] };
  } catch { /* corrupt */ }
  return { hat: null, tool: null, hats: [], tools: [] };
}
export function saveWardrobe(w) { try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* full */ } }

/** Merge newly found vault loot into the persistent wardrobe. Returns names that are new. */
export function syncOwned(w, colony) {
  const fresh = [];
  for (const [list, src, pool] of [[w.hats, colony?.hats, HATS], [w.tools, colony?.tools, TOOLS]]) {
    for (const raw of src || []) { const k = cosmeticKey(raw); if (pool[k] && !list.includes(k)) { list.push(k); fresh.push(k); } }
  }
  if (fresh.length) saveWardrobe(w);
  return fresh;
}

function headTop(d) {
  const prev = d._hatMesh; if (prev) prev.visible = false;
  d.rig.updateMatrixWorld(true);
  const box = new THREE.Box3();
  d.bodyGroup.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o); });
  if (prev) prev.visible = true;
  if (box.isEmpty()) return 0.9;
  const top = new THREE.Vector3(0, box.max.y, 0);
  // into bodyGroup-local Y (ignore XZ)
  const inv = new THREE.Matrix4().copy(d.bodyGroup.matrixWorld).invert();
  const p = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).applyMatrix4(inv);
  return p.y;
}

function disposeObj(o) { o?.parent?.remove(o); o?.traverse?.(c => { c.geometry?.dispose?.(); c.material?.dispose?.(); }); }

export function equipHat(d, name) {
  if (!d?.bodyGroup) return;
  disposeObj(d._hatMesh); d._hatMesh = null;
  const build = HATS[name]; if (!build) return;
  const y = headTop(d);
  const m = build();
  m.position.set(0, y - 0.04, 0);
  m.rotation.z = 0.08;
  d.bodyGroup.add(m);
  d._hatMesh = m;
}

export function equipTool(d, name) {
  disposeObj(d?._toolMesh); if (d) d._toolMesh = null;
  const build = TOOLS[name]; const arm = d?.arms?.find(a => a.side === 1) ?? d?.arms?.[0];
  if (!build || !arm) return;
  const m = build();
  m.position.set(0, -0.3, 0.04);
  m.rotation.x = -0.6;
  arm.pivot.add(m);
  d._toolMesh = m;
}

export function applyWardrobe(d, w = loadWardrobe()) {
  try { equipHat(d, w.hat); equipTool(d, w.tool); } catch (e) { console.warn('[wardrobe]', e); }
}

/** Cycle to the next owned item (or none). Returns the new name or null. */
export function cycle(w, slot) {
  const owned = slot === 'hat' ? w.hats : w.tools;
  if (!owned.length) return undefined;
  const order = [null, ...owned];
  const i = order.indexOf(w[slot]);
  w[slot] = order[(i + 1) % order.length];
  saveWardrobe(w);
  return w[slot];
}

/** A little wardrobe rack + trophy shelf by the campfire. */
export function buildWardrobeRack(parentGroup, x, y, z) {
  const g = new THREE.Group();
  const wood = toon(0x8b5a2b);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 6), wood); post.position.set(s * 0.7, 0.8, 0); g.add(post); }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), wood); bar.rotation.z = Math.PI / 2; bar.position.y = 1.55; g.add(bar);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.4), wood); shelf.position.set(0, 0.55, 0.05); g.add(shelf);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.04), toon(0xffd23f)); sign.position.set(0, 1.85, 0); g.add(sign);
  g.position.set(x, y, z);
  parentGroup.add(g);
  return { group: g, shelf, displayed: [] };
}

/** Show owned items on the rack: hats on the bar, tools on the shelf (up to 6 total). */
export function refreshRack(rack, w) {
  for (const m of rack.displayed) disposeObj(m);
  rack.displayed = [];
  const items = [...w.hats.map(h => ['h', h]), ...w.tools.map(t => ['t', t])].slice(0, 6);
  items.forEach(([kind, name], i) => {
    const m = (kind === 'h' ? HATS : TOOLS)[name]?.(); if (!m) return;
    const x = -0.55 + (i % 6) * 0.22;
    if (kind === 'h') { m.scale.setScalar(0.7); m.position.set(x, 1.3, 0.05); }
    else { m.scale.setScalar(0.8); m.position.set(x, 0.98, 0.1); }
    rack.group.add(m); rack.displayed.push(m);
  });
}
