// HillZone.js — the glowing centre for King of the Hill.
//
// Match.js has scored the hill since the mode landed (hillScore, onHillHold, onHillScore),
// but nothing ever drew it: no zone on the stage, no scoreboard, no bots going for it.
// This is the visible half: a pulsing ring + light pillar tinted by whoever holds it,
// a red strobe when it's contested, and a small live race-to-60 board.

import * as THREE from 'three';
import { noOutline } from '../render/Toon.js';

const NEUTRAL = 0xfff3c4, CONTESTED = 0xff4d5e;
const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);

export class HillZone {
  /** @param {THREE.Scene} scene @param {{ radius: number, target: number }} cfg */
  constructor(scene, cfg) {
    this.scene = scene;
    this.radius = cfg.radius;
    this.target = cfg.target;
    this.group = new THREE.Group();
    this.group.position.set(0, 0.04, 0);
    this.color = new THREE.Color(NEUTRAL);
    this._want = new THREE.Color(NEUTRAL);
    this.t = 0;
    this.state = 'empty';   // 'empty' | 'held' | 'contested'

    const R = this.radius;
    this.discMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.18, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), this.discMat);
    disc.rotation.x = -Math.PI / 2;
    this.ringMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.22, R, 64), this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    // A dashed inner ring that spins with the capture rate
    this.dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    this.dash = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const seg = new THREE.Mesh(new THREE.RingGeometry(R * 0.72, R * 0.8, 6, 1, (i / 12) * Math.PI * 2, Math.PI / 14), this.dashMat);
      seg.rotation.x = -Math.PI / 2;
      seg.position.y = 0.02;
      this.dash.add(seg);
    }
    this.pillarMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
    this.pillar = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 9, 40, 1, true), this.pillarMat);
    this.pillar.position.y = 4.5;
    this.group.add(disc, ring, this.dash, this.pillar);
    noOutline(this.group);
    this.group.renderOrder = 3;
    scene.add(this.group);

    this._buildBoard();
  }

  _buildBoard() {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'hill-board';
    el.style.cssText = 'position:fixed;left:14px;top:56px;z-index:40;pointer-events:none;background:#fff6e0;border:3px solid #1b1030;'
      + 'border-radius:14px;box-shadow:0 4px 0 #1b1030;padding:7px 11px;font:800 12px/1.3 Nunito,system-ui,sans-serif;color:#1b1030;min-width:190px';
    document.body.appendChild(el);
    this.board = el;
  }

  /** Who's inside right now (same rule as Match._hillTick) → 'empty' | 'held' | 'contested'. */
  _occupants(dweebs) {
    return dweebs.filter(d => {
      if (d.eliminated || d.out || !d.active) return false;
      const p = d.getPosition();
      return p.y < 4 && Math.hypot(p.x, p.z) < this.radius;
    });
  }

  update(dt, dweebs, holder, nameOf) {
    this.t += dt;
    const inside = this._occupants(dweebs);
    this.state = holder ? 'held' : inside.length > 1 ? 'contested' : 'empty';
    if (this.state === 'held') this._want.setHex(holder.color ?? NEUTRAL);
    else if (this.state === 'contested') this._want.setHex((Math.sin(this.t * 14) > 0) ? CONTESTED : 0xffffff);
    else this._want.setHex(NEUTRAL);
    this.color.lerp(this._want, Math.min(1, dt * (this.state === 'contested' ? 30 : 6)));
    for (const m of [this.discMat, this.ringMat, this.pillarMat]) m.color.copy(this.color);

    const pulse = 0.5 + 0.5 * Math.sin(this.t * (this.state === 'held' ? 6 : 2.4));
    this.discMat.opacity = this.state === 'held' ? 0.26 + pulse * 0.12 : 0.14 + pulse * 0.06;
    this.pillarMat.opacity = this.state === 'held' ? 0.16 + pulse * 0.08 : this.state === 'contested' ? 0.14 : 0.06;
    this.pillar.scale.set(1, this.state === 'held' ? 1 + pulse * 0.08 : 0.7, 1);
    this.pillar.position.y = 4.5 * this.pillar.scale.y;
    this.dash.rotation.y += dt * (this.state === 'held' ? 2.2 : this.state === 'contested' ? -0.6 : 0.35);

    this._paint(dweebs, holder, nameOf);
  }

  _paint(dweebs, holder, nameOf) {
    if (!this.board) return;
    const ranked = [...dweebs].sort((a, b) => (b.hillScore || 0) - (a.hillScore || 0)).slice(0, 6);
    const key = ranked.map(d => `${d.name}:${Math.floor(d.hillScore || 0)}`).join('|') + this.state + (holder?.name || '');
    if (key === this._key) return;
    this._key = key;
    const status = this.state === 'held' ? `👑 <span style="color:${hex(holder.color)}">${nameOf(holder)}</span> holds it`
      : this.state === 'contested' ? '<span style="color:#e11d48">⚔️ CONTESTED!</span>' : '⬜ The hill is open';
    const rows = ranked.map(d => {
      const s = Math.min(this.target, Math.floor(d.hillScore || 0));
      const pct = (s / this.target) * 100;
      return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
        <span style="width:58px;overflow:hidden;white-space:nowrap;color:${hex(d.color)}">${nameOf(d)}</span>
        <span style="flex:1;height:9px;border:2px solid #1b1030;border-radius:6px;background:#efe2c4;overflow:hidden">
          <span style="display:block;height:100%;width:${pct}%;background:${hex(d.color)}"></span></span>
        <span style="width:22px;text-align:right">${s}</span></div>`;
    }).join('');
    this.board.innerHTML = `<div style="font-size:13px;letter-spacing:.04em">👑 KING OF THE HILL · first to ${this.target}</div>`
      + `<div style="margin:2px 0 2px;font-size:12px">${status}</div>${rows}`;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.board?.remove();
    this.board = null;
  }
}
