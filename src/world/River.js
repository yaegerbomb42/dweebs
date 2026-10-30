import * as THREE from 'three';

/**
 * The Living River: the Meadowlands' biggest landmark becomes interactive.
 * Currents push anyone in the water downstream (stronger in rain), buoyancy bobs
 * them to the surface, cargo crates drift down the gorge for the taking, and fish
 * leap out of the water (more often when it rains) and can be snatched mid-air.
 * The curve matches Meadowlands._getHeight's river gorge exactly.
 */
export const WATER_Y = -0.45;
export const riverCurveX = (z) => -10 + z * 0.6 + Math.sin(z * 0.08) * 8;
const Z_MIN = -38, Z_MAX = 44;

const CARGO = [
  { label: '🪵 Driftwood', res: 'wood', n: 3, color: 0x8b5a2b },
  { label: '🍓 Berry Crate', res: 'berries', n: 4, color: 0xd7263d },
  { label: '🪨 Stone Sack', res: 'stone', n: 2, color: 0x94a3b8 },
  { label: '🪙 Lost Purse', res: 'gold', n: 1, color: 0xffd23f },
];

export class River {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    world.group.add(this.group);
    this.crates = [];
    this.fish = [];
    this.t = 0;
    for (let i = 0; i < 4; i++) this._spawnCrate(Z_MIN + i * 20);
    for (let i = 0; i < 4; i++) this._spawnFish();
    this.onCatch = null; // (label, pos) — main wires this to hud popups
  }

  /** Depth/current at a point, or null when not over the river. */
  infoAt(x, z) {
    const dist = Math.abs(x - riverCurveX(z));
    if (dist > 6.5) return null;
    const ground = this.world._getHeight(x, z);
    const depth = WATER_Y - ground;
    if (depth <= 0.05) return null;
    const dxdz = 0.6 + 0.64 * Math.cos(z * 0.08);
    const len = Math.hypot(dxdz, 1);
    const rain = this.world.weather === 'rain';
    // Faster mid-channel, faster in rain (rapids)
    const strength = (1.6 + (1 - dist / 6.5) * 1.6) * (rain ? 1.8 : 1);
    return { depth, dir: { x: dxdz / len, z: 1 / len }, strength };
  }

  _crateMesh(kind) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.8), new THREE.MeshToonMaterial({ color: 0xb07a45 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.84), new THREE.MeshToonMaterial({ color: kind.color }));
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), new THREE.MeshBasicMaterial({ color: kind.color }));
    flag.position.y = 0.5;
    g.add(box, band, flag);
    return g;
  }

  _spawnCrate(z = Z_MIN) {
    const kind = CARGO[Math.floor(Math.random() * CARGO.length)];
    const mesh = this._crateMesh(kind);
    this.group.add(mesh);
    this.crates.push({ kind, mesh, z, off: (Math.random() - 0.5) * 3, spin: Math.random() * 6 });
  }

  _spawnFish() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshToonMaterial({ color: 0xff8a3d }));
    body.scale.set(0.6, 0.7, 1.4);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.25, 4), new THREE.MeshToonMaterial({ color: 0xff5a1f }));
    tail.rotation.x = Math.PI / 2; tail.position.z = -0.38;
    g.add(body, tail);
    g.visible = false;
    this.group.add(g);
    this.fish.push({ mesh: g, wait: 1 + Math.random() * 6, jump: -1, x: 0, z: 0, dx: 0, dz: 0 });
  }

  _crateReset(c) {
    c.z = Z_MIN; c.off = (Math.random() - 0.5) * 3;
    c.kind = CARGO[Math.floor(Math.random() * CARGO.length)];
    this.group.remove(c.mesh); c.mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    c.mesh = this._crateMesh(c.kind); this.group.add(c.mesh);
  }

  update(dt, dweebs, colony) {
    this.t += dt;
    const rain = this.world.weather === 'rain';
    const player = dweebs.find(d => d.isPlayer);
    const pp = player?.active ? player.getPosition() : null;

    // Currents + buoyancy for everyone in the water
    for (const d of dweebs) {
      if (!d.active || !d.body || d.grabbedBy) continue;
      const p = d.getPosition();
      const info = p.y < WATER_Y + 0.6 ? this.infoAt(p.x, p.z) : null;
      const was = d.inRiver;
      d.inRiver = !!info;
      if (!info) continue;
      const v = d.body.linvel();
      // Movement code rewrites velocity every step, so the current carries bodies by
      // displacing them directly (they can still swim against it, just slower).
      const push = info.strength * dt * (d.ragdolling ? 1.2 : 0.85);
      let ny = p.y;
      const sub = WATER_Y + 0.25 - p.y; // how far below the floating line
      if (sub > 0) ny = p.y + Math.min(sub, 1.2) * Math.min(1, dt * 3);
      d.body.setTranslation({ x: p.x + info.dir.x * push, y: ny, z: p.z + info.dir.z * push }, true);
      if (sub > 0 && v.y < 0) d.body.setLinvel({ x: v.x, y: v.y * 0.5, z: v.z }, true);
      if (!was) {
        this.world.fx?.particles?.splash?.({ x: p.x, y: WATER_Y, z: p.z });
        this.world.fx?.audio?.playSplash?.(0, Math.min(1, Math.abs(v.y) / 10));
      }
    }

    // Drifting cargo
    for (const c of this.crates) {
      const info = this.infoAt(riverCurveX(c.z) + c.off, c.z);
      c.z += (info ? info.strength * 0.7 : 1.6) * dt;
      if (c.z > Z_MAX) { this._crateReset(c); continue; }
      const x = riverCurveX(c.z) + c.off + Math.sin(this.t * 0.7 + c.spin) * 0.6;
      c.spin += dt * 0.6;
      c.mesh.position.set(x, WATER_Y + 0.12 + Math.sin(this.t * 2.4 + c.spin) * 0.08, c.z);
      c.mesh.rotation.set(Math.sin(this.t * 1.7 + c.spin) * 0.15, c.spin, Math.cos(this.t * 1.3 + c.spin) * 0.12);
      if (pp && Math.hypot(pp.x - x, pp.z - c.z) < 1.7 && Math.abs(pp.y - WATER_Y) < 2.2) {
        colony?.addResource?.(c.kind.res, c.kind.n);
        colony?._addLog?.(`🌊 Fished ${c.kind.label} out of the river (+${c.kind.n} ${c.kind.res})`);
        this.onCatch?.(`${c.kind.label} +${c.kind.n}`, { x, y: WATER_Y + 1, z: c.z });
        this.world._pushStunt?.('cargo', x, c.z);
        this._crateReset(c);
      }
    }

    // Leaping fish
    for (const f of this.fish) {
      if (f.jump < 0) {
        f.wait -= dt * (rain ? 2.5 : 1);
        if (f.wait > 0) continue;
        f.z = Z_MIN + 8 + Math.random() * (Z_MAX - Z_MIN - 16);
        f.x = riverCurveX(f.z) + (Math.random() - 0.5) * 4;
        const a = Math.random() * Math.PI * 2;
        f.dx = Math.cos(a) * 1.6; f.dz = Math.sin(a) * 1.6;
        f.jump = 0; f.mesh.visible = true;
        this.world.fx?.particles?.splash?.({ x: f.x, y: WATER_Y, z: f.z });
      }
      f.jump += dt;
      const T = 1.1, u = f.jump / T;
      const x = f.x + f.dx * f.jump, z = f.z + f.dz * f.jump;
      const y = WATER_Y + Math.sin(Math.min(1, u) * Math.PI) * 1.8;
      f.mesh.position.set(x, y, z);
      f.mesh.rotation.set(-Math.cos(u * Math.PI) * 1.1, Math.atan2(f.dx, f.dz), 0);
      if (pp && Math.hypot(pp.x - x, pp.z - z) < 1.3 && Math.abs(pp.y - y) < 1.4) {
        colony?.addResource?.('berries', 2);
        colony?._addLog?.('🐟 Snatched a leaping fish! (+2 berries worth of snacks)');
        this.onCatch?.('🐟 CAUGHT ONE! +2', { x, y: y + 0.8, z });
        f.jump = T;
      }
      if (f.jump >= T) {
        f.mesh.visible = false; f.jump = -1; f.wait = 2 + Math.random() * 7;
      }
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
