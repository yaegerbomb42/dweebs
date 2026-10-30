// Teams.js — Team Battle squads for the offline match: who's on which team, and the
// glowing foot rings that make squads readable at a glance in a 6-dweeb pile-up.
// Friendly-fire is enforced in Dweeb.receiveHit (same team → no hit), bots skip
// teammates in Bot._think, and Match._endRound banks the round for the whole squad.

import * as THREE from 'three';
import { DWEEB_HALF } from '../player/Dweeb.js';

export const TEAMS = [
  { id: 'pink', name: 'PINK', color: 0xff4d5e },
  { id: 'cyan', name: 'CYAN', color: 0x3fa9ff },
  { id: 'lime', name: 'LIME', color: 0x7be36b },
];

export const teamById = id => TEAMS.find(t => t.id === id) || null;

/**
 * Split `dweebs` into squads. Spawn points run round the ring in index order, so
 * contiguous index blocks put teammates next to each other. 6+ → 2v2v2, else two sides.
 */
export function assignTeams(dweebs) {
  const n = dweebs.length;
  const count = n >= 6 ? 3 : 2;
  dweebs.forEach((d, i) => {
    const t = TEAMS[Math.min(count - 1, Math.floor((i * count) / n))];
    d.team = t.id;
    d.teamColor = t.color;
  });
}

export class TeamRings {
  constructor(scene) {
    this.scene = scene;
    this.rings = new Map();
    this.t = 0;
  }

  _ring(d) {
    let r = this.rings.get(d);
    if (r) return r;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: d.teamColor, transparent: true, opacity: 0.85, depthWrite: false });
    const band = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.82, 32), mat);
    band.rotation.x = -Math.PI / 2;
    const dotMat = new THREE.MeshBasicMaterial({ color: d.teamColor, transparent: true, opacity: 0.25, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), dotMat);
    fill.rotation.x = -Math.PI / 2;
    g.add(band, fill);
    g.renderOrder = 2;
    this.scene.add(g);
    r = { g, mat, dotMat };
    this.rings.set(d, r);
    return r;
  }

  update(dt, dweebs) {
    this.t += dt;
    for (const d of dweebs) {
      if (d.team == null) continue;
      const r = this._ring(d);
      r.mat.color.setHex(d.teamColor);
      r.dotMat.color.setHex(d.teamColor);
      const show = d.active && !d.eliminated;
      r.g.visible = show;
      if (!show) continue;
      const p = d.getPosition();
      r.g.position.set(p.x, p.y - DWEEB_HALF + 0.04, p.z);
      const s = 1 + Math.sin(this.t * 4 + (d.id || 0)) * 0.06;
      r.g.scale.set(s, 1, s);
    }
  }

  dispose() {
    for (const r of this.rings.values()) {
      this.scene.remove(r.g);
      r.g.traverse(o => { o.geometry?.dispose(); });
      r.mat.dispose();
      r.dotMat.dispose();
    }
    this.rings.clear();
  }
}
