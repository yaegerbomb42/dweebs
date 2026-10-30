// WarfareBoard.js — the toy battlefield: a bevelled plastic play-mat, wooden dowel fences,
// dowel-bundle barricades and brass-geared forts. No voxel terrain anywhere.
import * as THREE from 'three';
import { toonMat, noOutline } from '../render/Toon.js';
import { FIELD, FORT_X, FORT_RADIUS } from '../sim/warfareBattle.js';
import { getBattleground } from './Battlegrounds.js';
import { TEAM_COLORS, sharedMats } from './WarfareModels.js';

/** Barricades: three stacked dowel logs with brass bands, at each circle in `list`.
 *  Destructible bundles (with hp) get scorched bands so commanders can tell them apart.
 *  Returns { group, meshes } where meshes = [{x, z, r, g}] is tracked so the view can
 *  hide a barricade when the sim reports it broken (barricadeDown). */
export function buildBarricades(list) {
  const mats = sharedMats();
  const g = new THREE.Group();
  const meshes = [];
  const logGeo = new THREE.CylinderGeometry(0.42, 0.42, 3.4, 7);
  const bandGeo = new THREE.TorusGeometry(0.5, 0.08, 4, 10);
  for (const b of list) {
    const bg = new THREE.Group();
    const spots = [[-0.45, 0.42], [0.45, 0.42], [0, 1.1]];
    for (const [ox, y] of spots) {
      const log = new THREE.Mesh(logGeo, mats.wood);
      log.rotation.x = Math.PI / 2;
      log.position.set(ox, y, 0);
      log.castShadow = true;
      bg.add(log);
    }
    const bandMat = b.hp > 0 ? toonMat({ color: 0x8a5a2a }) : mats.brass;
    for (const oz of [-1.1, 1.1]) {
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.scale.set(1.6, 1.5, 1);
      band.position.set(0, 0.75, oz);
      bg.add(band);
    }
    const s = b.r / 1.5;
    bg.scale.set(s, 1, s);
    bg.position.set(b.x, 0, b.z);
    g.add(bg);
    meshes.push({ x: b.x, z: b.z, r: b.r, g: bg });
  }
  return { group: g, meshes };
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function buildBoard(map = getBattleground('meadow')) {
  const mats = sharedMats();
  const group = new THREE.Group();
  const W = FIELD.halfX * 2 + 4, H = FIELD.halfZ * 2 + 4;

  // Play-mat: bevelled plastic slab, top face at y = 0
  const slab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(W, H, 4), { depth: 1.4, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.5, bevelSegments: 1, curveSegments: 3 }),
    toonMat({ color: 0x8fd16a }),
  );
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = -1.75;
  slab.receiveShadow = true;
  group.add(slab);

  const paint = (w, h, color, x, z, opacity = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    noOutline(m);
    group.add(m);
    return m;
  };
  // team zones and a dashed midline, like a printed board game
  paint(12, H - 4, 0xcfe9ff, -FIELD.halfX + 6, 0);
  paint(12, H - 4, 0xffd9dd, FIELD.halfX - 6, 0);
  for (let z = -FIELD.halfZ + 2; z < FIELD.halfZ - 1; z += 3) paint(0.35, 1.6, 0xfff8ee, 0, z + 0.8, 0.8);
  for (const x of [-14, 14]) paint(0.2, H - 6, 0xfff8ee, x, 0, 0.35);

  // Gullies: dark painted cracks in the play-mat that bridges span.
  for (const gl of map.gullies || []) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(gl.w, gl.h), new THREE.MeshBasicMaterial({ color: 0x4a3b2c, transparent: true, opacity: 0.85, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = gl.rot || 0;
    m.position.set(gl.x, 0.012, gl.z);
    noOutline(m);
    group.add(m);
  }

  // Mud: dark glossy discs with a subtle ripple. Rendered before high ground so plateaus sit on top.
  const mudMeshes = [];
  for (const m of map.mud || []) {
    const mudGeo = new THREE.CircleGeometry(m.r, 32);
    const mudMat = new THREE.MeshStandardMaterial({
      color: 0x2d2520,
      roughness: 0.15,
      metalness: 0.35,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const mud = new THREE.Mesh(mudGeo, mudMat);
    mud.rotation.x = -Math.PI / 2;
    mud.position.set(m.x, 0.02, m.z);
    mud.receiveShadow = true;
    noOutline(mud);
    // Store time offset for ripple animation in the view
    mud.userData = { mudTimeOffset: m.x * 0.7 + m.z * 0.3, radius: m.r };
    group.add(mud);
    mudMeshes.push(mud);
  }

  // High ground: raised plastic plateaus (the sim grants +damage from up here).
  for (const hg of map.highGround || []) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(hg.w, 0.7, hg.h), toonMat({ color: 0x7cc45e }));
    ridge.position.set(hg.x, 0.35, hg.z);
    ridge.castShadow = true;
    ridge.receiveShadow = true;
    group.add(ridge);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(hg.w + 0.5, 0.12, hg.h + 0.5), toonMat({ color: 0x5da244 }));
    rim.position.set(hg.x, 0.68, hg.z);
    group.add(rim);
  }

  // Bridges: plank decks on dowel posts over the gullies.
  for (const br of map.bridges || []) {
    const bg = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(br.len, 0.25, 3.2), mats.wood);
    deck.castShadow = true;
    bg.add(deck);
    for (const s of [-1, 1]) {
      const railP = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, br.len, 5), mats.darkWood);
      railP.rotation.z = Math.PI / 2;
      railP.position.set(0, 0.75, s * 1.5);
      bg.add(railP);
      for (const px of [-br.len / 2 + 0.4, br.len / 2 - 0.4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 5), mats.darkWood);
        post.position.set(px, -0.4, s * 1.5);
        bg.add(post);
      }
    }
    bg.position.set(br.x, 0.85, br.z);
    bg.rotation.y = br.rot || 0;
    group.add(bg);
  }

  // Dowel fence: instanced posts plus long rails
  const postGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.5, 6);
  const posts = [];
  for (let x = -FIELD.halfX - 1; x <= FIELD.halfX + 1; x += 3.5) { posts.push([x, -FIELD.halfZ - 1.2], [x, FIELD.halfZ + 1.2]); }
  for (let z = -FIELD.halfZ + 2; z <= FIELD.halfZ - 2; z += 3.5) { posts.push([-FIELD.halfX - 1.4, z], [FIELD.halfX + 1.4, z]); }
  const inst = new THREE.InstancedMesh(postGeo, mats.wood, posts.length);
  const m4 = new THREE.Matrix4();
  posts.forEach(([x, z], i) => { m4.makeTranslation(x, 0.75, z); inst.setMatrixAt(i, m4); });
  inst.castShadow = true;
  group.add(inst);
  const railGeo = new THREE.CylinderGeometry(0.1, 0.1, 1, 6);
  const rail = (len, x, z, alongX, y) => {
    const r = new THREE.Mesh(railGeo, mats.darkWood);
    r.scale.y = len;
    if (alongX) r.rotation.z = Math.PI / 2; else r.rotation.x = Math.PI / 2;
    r.position.set(x, y, z);
    group.add(r);
  };
  for (const y of [0.55, 1.2]) {
    rail(FIELD.halfX * 2 + 2, 0, -FIELD.halfZ - 1.2, true, y);
    rail(FIELD.halfX * 2 + 2, 0, FIELD.halfZ + 1.2, true, y);
    rail(FIELD.halfZ * 2 - 2, -FIELD.halfX - 1.4, 0, false, y);
    rail(FIELD.halfZ * 2 - 2, FIELD.halfX + 1.4, 0, false, y);
  }

  // Barricades: three stacked dowel logs with brass bands. Destructible bundles (map hp)
  // get scorched bands so commanders can tell them apart; the view hides them when broken.
  // Built into a sub-group so setBarricades can swap just the barricades per battle/map.
  const barr = buildBarricades(map.barricades);
  group.add(barr.group);
  const barricadeMeshes = barr.meshes;

  const forts = { blue: buildFort('blue', -FORT_X), red: buildFort('red', FORT_X) };
  group.add(forts.blue.group, forts.red.group);

  // invisible pick plane for rally clicks
  const pick = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ visible: false }));
  pick.rotation.x = -Math.PI / 2;
  group.add(pick);

  return { group, pick, forts, barricades: barricadeMeshes, barr: barr.group, mud: mudMeshes, mapId: map.id };
}

function buildFort(team, x) {
  const mats = sharedMats();
  const g = new THREE.Group();
  const color = TEAM_COLORS[team];
  const base = new THREE.Mesh(new THREE.CylinderGeometry(FORT_RADIUS, FORT_RADIUS + 0.3, 1.1, 10), toonMat({ color }));
  base.position.y = 0.55;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.3, 3.2, 8), mats.wood);
  tower.position.y = 2.7;
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.35, 14), mats.brass);
  gear.position.y = 4.4;
  const teeth = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 4), mats.brass);
    const a = (i / 14) * Math.PI * 2;
    t.position.set(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6);
    t.rotation.z = Math.cos(a) * Math.PI / 2;
    t.rotation.x = -Math.sin(a) * Math.PI / 2;
    teeth.add(t);
  }
  teeth.position.y = 4.4;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.2, 8), toonMat({ color }));
  roof.position.y = 5.7;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5), mats.darkWood);
  pole.position.y = 7.6;
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 3), toonMat({ color }));
  flag.rotation.z = -Math.PI / 2;
  flag.scale.z = 0.2;
  flag.position.set(0.65, 8.2, 0);
  for (const m of [base, tower, gear, roof]) { m.castShadow = true; m.receiveShadow = true; }
  g.add(base, tower, gear, teeth, roof, pole, flag);
  g.position.set(x, 0, 0);
  return { group: g, gear: teeth, flag, x };
}
