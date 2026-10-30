// Fx.js — "game feel" hub: particles, sound, camera shake, hit-stop and comic popups for every event.

import * as THREE from 'three';
import { BALANCE } from './Balance.js';

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const HIT_WORDS = ['POW!', 'BONK!', 'WHAM!', 'BOP!', 'THWACK!', 'SMACK!'];
const BIG_WORDS = ['KA-POW!', 'SMASH!', 'KABLAM!', 'YEET!'];
const MEGA_WORDS = ['KABOOOM!', 'MEGA YEET!', 'SAYONARA!', 'BONKERS!'];
const J = BALANCE.juice;
const hitTier = launch => (launch >= J.tiers[2] ? 3 : launch >= J.tiers[1] ? 2 : launch >= J.tiers[0] ? 1 : 0);

export class Fx {
  constructor({ particles, audio, camera, cameraController, hud, arena, bursts, decals, haptics }) {
    this.bursts = bursts;
    this.decals = decals;
    this.particles = particles;
    this.audio = audio;
    this.haptics = haptics;
    this.camera = camera;
    this.cam = cameraController;
    this.hud = hud;
    this.arena = arena;
    this.hitStop = 0;
    this.player = null;
  }

  /** Stereo pan (-1..1) and a distance-based volume factor for a world position. */
  _pan(pos) {
    _v.set(pos.x, pos.y, pos.z).sub(this.camera.position);
    const dist = _v.length() || 1;
    _r.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    return THREE.MathUtils.clamp(_v.dot(_r) / dist, -1, 1) * 0.8;
  }

  _near(pos, range = 14) {
    const p = this.player?.getPosition();
    if (!p) return 1;
    return Math.max(0, 1 - Math.hypot(p.x - pos.x, p.z - pos.z) / range);
  }

  // ─── Combat ───

  /** Hit feedback in four tiers (jab / solid / ragdoll / fireworks): small hits stay crisp, big ones get loud. */
  hit(victim, attacker, launch, kind) {
    const pos = victim.getPosition();
    const power = Math.min(1, launch / 20);
    const tier = hitTier(launch);
    const involvesPlayer = victim.isPlayer || attacker?.isPlayer;
    const color = attacker ? attacker.color : 0xffffff;

    if (tier >= 2) this.particles.bigHit(pos, color);
    else this.particles.hit(pos, color);
    if (tier >= 1) this.bursts.spawn(pos, 0.8 + power * 1.4, color);
    this.audio.playPunch(power, this._pan(pos));
    if (launch >= 14) this.audio.playLaunch(this._pan(pos));

    // Hit-stop, shake and squash come from the tier table (softened when the player isn't involved)
    this.hitStop = Math.max(this.hitStop, J.hitStop[tier] * (involvesPlayer ? 1 : 0.6));
    this.cam.shake(J.shake[tier] * (involvesPlayer ? 1 : 0.4 + this._near(pos) * 0.6));
    this.haptics?.hit(tier, this._near(pos, 24), involvesPlayer);
    victim.landSquash = Math.max(victim.landSquash || 0, J.squash[tier]);
    if (involvesPlayer && tier >= 2) this.cam.kickFov(tier === 3 ? 12 : 7);

    // Fireworks tier: confetti pop, colour ring, impact frame — a toybox gag, not gore
    if (tier === 3) {
      this.particles.confetti(pos, 36);
      this.particles.ring(pos, { color, size: 4.5, life: 0.45 });
      this.particles.sparkle(pos, 0xffd23f);
      this.bursts.spawn(pos, 2.6, 0xffd23f);
      if (involvesPlayer) { this.hud.flashImpact?.(); this.cam.punchZoom(0.8); }
      this.arena.excite(0.7);
    } else if (launch >= 14) this.arena.excite(0.4);

    if (tier >= 2 || involvesPlayer) {
      const words = tier === 3 ? MEGA_WORDS : tier === 2 ? BIG_WORDS : HIT_WORDS;
      const word = kind === 'boom' ? 'KABOOM!' : words[Math.floor(Math.random() * words.length)];
      this.hud.popup(word, pos, tier >= 2 ? 'big' : 'small', color);
    }
  }

  /** Heavy throws telegraph their heft: grunt popup, dust, a tiny freeze. */
  heavyThrow(d, obj, mass) {
    const pos = d.getPosition();
    this.particles.dust({ x: pos.x, y: pos.y - 0.45, z: pos.z }, 8);
    this.cam.shake(d.isPlayer ? 0.18 : 0.06);
    this.hitStop = Math.max(this.hitStop, d.isPlayer ? 0.04 : 0.02);
    if (d.isPlayer) this.haptics?.throwHeavy();
    if (d.isPlayer || this._near(pos, 12) > 0) this.hud.popup(mass >= 5 ? 'HNNNGH!' : 'HUP!', pos, 'small', d.color);
  }

  /** A thrown hit with style: tags like LONG SHOT / BANK SHOT / AIR SHOT. */
  trickshot(victim, attacker, tags, dist) {
    const pos = victim.getPosition();
    const color = attacker?.color ?? 0xffffff;
    const title = tags.length > 1 || dist >= 18 ? 'TRICKSHOT!' : tags[0] + '!';
    this.hud.popup(title, { x: pos.x, y: pos.y + 0.8, z: pos.z }, 'big', color);
    if (attacker?.isPlayer) {
      const detail = tags.length > 1 ? `${tags.join(' + ')} · ` : '';
      this.hud.announce(`${title}<small>${detail}${Math.round(dist)}m</small>`, 'trick', 1.3);
      this.cam.kickFov(7);
    }
    this.particles.confetti(pos, 24 + tags.length * 12);
    this.particles.ring(pos, { color, size: 3 + tags.length, life: 0.45 });
    this.bursts.spawn(pos, 1.6 + tags.length * 0.4, color);
    this.audio.playTrickshot(tags.length, this._pan(pos));
    this.arena.excite(0.5 + tags.length * 0.25);
    this.hitStop = Math.max(this.hitStop, 0.1 + tags.length * 0.02);
    if (attacker) attacker.trickshots = (attacker.trickshots || 0) + 1;
  }

  aimLock() {
    this.audio.playAimLock();
  }

  // ─── Style meter / Super Yeet ───

  styleFeed(d, label) {
    const n = Math.max(1, d.styleCombo || 1);
    this.hud.styleFeed?.(d, `STYLE x${n} · ${label}`);
  }

  styleTier(d, tier) {
    if (!d.isPlayer) return;
    this.audio.playStyleTier(tier);
    this.hud.styleTier?.(tier);
  }

  superReady(d) {
    if (!d.isPlayer) return;
    this.audio.playSuperReady();
    this.hud.announce('SUPER YEET READY<small>F / middle mouse</small>', 'trick', 1.2);
  }

  superArm(d) {
    const pos = d.getPosition();
    this.particles.sparkle(pos, d.color);
    this.particles.ring(pos, { color: d.color, size: 3, life: 0.4 });
    if (d.isPlayer) this.hud.popup('ARMED!', pos, 'small', d.color);
  }

  superYeet(victim, attacker) {
    const pos = victim.getPosition();
    this.particles.confetti(pos, 80);
    this.particles.ring(pos, { color: attacker?.color ?? 0xffd23f, size: 6, life: 0.6 });
    this.bursts.spawn(pos, 3, attacker?.color ?? 0xffd23f);
    this.hud.popup('SUPER YEET!', { x: pos.x, y: pos.y + 1, z: pos.z }, 'big', attacker?.color ?? 0xffd23f);
    this.audio.playSuperYeet(this._pan(pos));
    this.audio.playTrickshot(3, this._pan(pos));
    this.hitStop = Math.max(this.hitStop, 0.2);
    this.cam.shake(0.8);
    this.cam.kickFov(12);
    this.arena.excite(1);
  }

  /**
   * A thrown rare drop connected: each rare gets its own read so a thrown anvil never looks
   * like a thrown cake. Explosive rares (rocket, barrel) go through explosion() instead.
   */
  rareHit(pos, key, launch) {
    const p = this.particles;
    const power = Math.min(1, launch / 20);
    if (key === 'giantHammer') {
      // cartoon clang: gold ring + sparks
      p.ring(pos, { color: 0xffd23f, size: 3.5 + power * 2, life: 0.5 });
      p.sparkle(pos, 0xffe9a8);
      p.emit(pos, { count: 18, colors: [0xffd23f, 0xffffff], speed: 8, up: 4, size: 0.1, life: 0.5 });
      this.bursts.spawn(pos, 1.6, 0xffd23f);
      this.audio.playClang?.(this._pan(pos));
    } else if (key === 'anvil') {
      // heavy blacksmith thud: iron ring + dust
      p.ring(pos, { color: 0x9aa4b5, size: 3 + power * 2, life: 0.45 });
      p.dust(pos, 10);
      p.emit(pos, { count: 14, colors: [0x9aa4b5, 0x5a626e], speed: 5, up: 2, size: 0.14, life: 0.6 });
      this.bursts.spawn(pos, 2, 0x9aa4b5);
      this.audio.playThud?.(this._pan(pos));
    } else {
      // fallback for future rares: a gold confetti pop
      p.confetti(pos, 30);
      p.ring(pos, { color: 0xffd23f, size: 3, life: 0.4 });
    }
    this.cam.shake(0.15 + power * 0.35);
    this.hitStop = Math.max(this.hitStop, 0.05 + power * 0.06);
    this.haptics?.hit(2, this._near(pos, 24), false);
  }

  // ─── Recovery ───

  airDodge(d) {
    const pos = d.getPosition();
    this.particles.ring(pos, { color: 0xffffff, size: 1.8, life: 0.2 });
    this.particles.emit(pos, { count: 6, colors: [0xffffff, d.color], speed: 2, up: 0, size: 0.14, life: 0.3, gravity: 0 });
    if (d.isPlayer || this._near(pos, 10) > 0) this.audio.playWhoosh(this._pan(pos), 0.9);
  }

  tech(d) {
    const pos = d.getPosition();
    this.particles.ring({ x: pos.x, y: pos.y - 0.45, z: pos.z }, { color: 0xbff4ff, size: 2.2, life: 0.3 });
    this.particles.sparkle(pos, 0xbff4ff);
    this.audio.playTech(this._pan(pos));
    if (d.isPlayer || this._near(pos, 14) > 0) this.hud.popup('TECH!', pos, 'small', 0xbff4ff);
  }

  ledge(d) {
    const pos = d.getPosition();
    this.particles.dust({ x: pos.x, y: pos.y + 0.4, z: pos.z }, 4);
    if (d.isPlayer) this.audio.playGrab(this._pan(pos));
  }

  fuse(obj) {
    const pos = obj.getPosition();
    this.particles.emit(pos, { count: 10, colors: [0xffd23f, 0xff6a3c, 0xffffff], speed: 2.5, up: 2, size: 0.1, life: 0.4 });
    this.audio.playFuse(this._pan(pos));
    if (this._near(pos, 16) > 0) this.hud.popup('HISSS…', pos, 'small', 0xff6a3c);
  }

  fuseSpark(obj, left) {
    const pos = obj.getPosition();
    _v.set(pos.x, pos.y + 0.7, pos.z);
    this.particles.emit(_v, { count: left < 2 ? 3 : 1, colors: [0xffd23f, 0xff6a3c, 0xffffff], speed: 2, up: 2, size: 0.09, life: 0.3 });
    if (left < 2 && this._near(pos, 16) > 0 && Math.random() < 0.15) this.hud.popup('TICK!', pos, 'small', 0xff6a3c);
  }

  bonk(pos, obj) {
    this.particles.hit(pos, 0xffffff);
    this.audio.playComicBonk(this._pan(pos));
  }

  whoopee(pos, sitter) {
    const p = { x: pos.x, y: pos.y + 0.1, z: pos.z };
    this.particles.emit(p, { count: 26, colors: [0x9ccc3c, 0xb8e05a, 0x7ea832, 0xd4ef8a], speed: 3.2, up: 0.9, size: 0.34, life: 1.1, gravity: 0.6, drag: 2.4, grow: 1.6 });
    this.particles.ring(p, { color: 0xb8e05a, size: 5.5, life: 0.45 });
    this.particles.dust({ x: pos.x, y: pos.y, z: pos.z }, 6);
    this.audio.playWhoopee?.(this._pan(p), 0.85 + Math.random() * 0.35);
    this.hud.popup(Math.random() < 0.5 ? 'PFFFFT!' : 'BRAAAP!', { x: p.x, y: p.y + 1.4, z: p.z }, 'big', 0xb8e05a);
    this.cam.shake(0.12);
    if (sitter) this.haptics?.hit(0.8, this._near(p, 24), !!sitter.isPlayer);
    this.arena?.excite?.(0.4);
  }

  whiff(d, weapon) {
    if (d.isPlayer || this._near(d.getPosition(), 8) > 0) this.audio.playWhoosh(this._pan(d.getPosition()));
  }

  grab(d, target) {
    const pos = d.getPosition();
    this.audio.playGrab(this._pan(pos));
    if (target) this.hud.popup('GOTCHA!', target.getPosition(), 'small', d.color);
  }

  escape(t) {
    const pos = t.getPosition();
    this.particles.sparkle(pos, t.color);
    this.audio.playSpringBoing(this._pan(pos));
  }

  bubblePop(d) {
    const pos = d.getPosition();
    this.particles.emit(pos, { count: 22, colors: [0xffffff, 0x8fe9ff], speed: 6, up: 2, size: 0.14, life: 0.5, gravity: -2 });
    this.audio.playBubblePop(this._pan(pos));
    this.hud.popup('POP!', pos, 'small', 0x8fe9ff);
  }

  throw(d, mass = 3) {
    const pan = this._pan(d.getPosition());
    this.audio.playThrow(pan, mass);
    if (mass >= 3 || mass < 0.5) this.audio.playSlideWhistle(pan);
  }

  rocketLaunch(obj) {
    const pos = obj.getPosition();
    this.particles.emit(pos, { count: 14, colors: [0xffd23f, 0xff9a3c, 0xffffff], speed: 4, up: 1, size: 0.16, life: 0.4, gravity: 0 });
    this.audio.playSlideWhistle(this._pan(pos));
    if (this._near(pos, 16) > 0) this.hud.popup('WHOOSH!', pos, 'small', 0xff9a3c);
  }

  /** Called every frame while a rocket burns: a puffy candy-coloured exhaust trail. */
  rocketSmoke(pos, dir) {
    _v.set(pos.x - dir.x * 0.5, pos.y - dir.y * 0.5, pos.z - dir.z * 0.5);
    this.particles.emit(_v, { count: 1, colors: [0xffffff, 0xf3eefc], speed: 0.6, up: 0.4, size: 0.3, life: 0.6, gravity: 1, grow: 1.5 });
    this.particles.emit(_v, { count: 1, colors: [0xffd23f, 0xff9a3c], speed: 1.5, up: 0, size: 0.12, life: 0.18, gravity: 0 });
  }

  /** Pinball bumper / trampoline boing. */
  bumper(pos, color, hitDweeb) {
    this.particles.ring(pos, { color, size: 2.4, life: 0.3 });
    this.bursts.spawn(pos, hitDweeb ? 1.3 : 0.8, color);
    this.audio.playComicBonk(this._pan(pos));
    if (hitDweeb && this._near(pos, 16) > 0) this.hud.popup('BOING!', pos, 'small', color);
  }

  bounce(pos, color) {
    this.particles.ring({ x: pos.x, y: pos.y + 0.05, z: pos.z }, { color, size: 3, life: 0.35 });
    this.particles.emit(pos, { count: 8, colors: [color, 0xffffff], speed: 3, up: 3, size: 0.12, life: 0.4 });
    this.audio.playSpringBoing(this._pan(pos));
  }

  // ─── Toy-set architecture ───

  _toyWord(word, pos, color = 0xffd23f, size = 'small') {
    if (this._near(pos, 16) > 0) this.hud.popup(word, pos, size, color);
  }

  doorThwack(pos) {
    this.particles.dust({ x: pos.x, y: pos.y - 0.4, z: pos.z }, 10);
    this.particles.emit(pos, { count: 10, colors: [0xffd23f, 0xffffff, 0xd4a86a], speed: 5, up: 2, size: 0.12, life: 0.35 });
    this.audio.playComicBonk(this._pan(pos));
    this.audio.playWoodBreak(this._pan(pos));
    this._toyWord('THWACK!', pos, 0xffd23f, 'big');
    this.cam?.shake?.(0.16);
  }

  doorOpen(pos) {
    this.audio.playWhoosh(this._pan(pos), 0.6);
    this.particles.dust({ x: pos.x, y: pos.y - 0.7, z: pos.z }, 3);
  }

  doorClose(pos) {
    this.audio.playWoodBreak(this._pan(pos));
    this.particles.dust({ x: pos.x, y: pos.y - 0.7, z: pos.z }, 3);
  }

  trapdoor(pos) {
    this.audio.playWoodBreak(this._pan(pos));
    this.particles.dust({ x: pos.x, y: pos.y - 0.2, z: pos.z }, 8);
    this.particles.ring(pos, { color: 0xffd23f, size: 1.8, life: 0.25 });
  }

  lever(pos) {
    this.audio.playTech(this._pan(pos));
    this.particles.sparkle(pos, 0xffd23f);
  }

  crank(pos) {
    this.audio.playUIClick();
    this.audio.playWhoosh(this._pan(pos), 0.25);
    this.particles.emit(pos, { count: 4, colors: [0xffd23f, 0xffffff], speed: 2, up: 1, size: 0.08, life: 0.3 });
  }

  button(pos) {
    this.audio.playUIClick();
    this.particles.ring({ x: pos.x, y: pos.y + 0.1, z: pos.z }, { color: 0xffd23f, size: 1.3, life: 0.22 });
  }

  ladder(pos) {
    this.audio.playGrab(this._pan(pos));
    this.particles.sparkle(pos, 0xffd23f);
  }

  ropeSwing(pos) {
    this.audio.playWhoosh(this._pan(pos), 0.9);
    this.particles.emit(pos, { count: 5, colors: [0xd4a86a, 0xffffff], speed: 2.5, up: 1, size: 0.1, life: 0.3 });
  }

  zipStart(pos) {
    this.audio.playSpringBoing(this._pan(pos));
    this.audio.playWhoosh(this._pan(pos), 1);
    this.particles.sparkle(pos, 0x3ee6d0);
    this._toyWord('WHEEE!', pos, 0x3ee6d0);
  }

  zipEnd(pos) {
    this.particles.dust({ x: pos.x, y: pos.y, z: pos.z }, 10);
    this.particles.ring(pos, { color: 0x3ee6d0, size: 2.0, life: 0.3 });
    this.audio.playLand(8, this._pan(pos));
  }

  sailLaunch(pos) {
    this.particles.emit(pos, { count: 12, colors: [0xfff8ee, 0xffd23f, 0xffffff], speed: 5, up: 4, size: 0.14, life: 0.5 });
    this.audio.playWhoosh(this._pan(pos), 1);
    this.audio.playSpringBoing(this._pan(pos));
    this._toyWord('WHOOOSH!', pos, 0xfff8ee);
  }

  poolSplash(pos, color = 0x3fa9ff) {
    this.particles.ring({ x: pos.x, y: pos.y, z: pos.z }, { color, size: 2.2, life: 0.35 });
    this.particles.emit(pos, { count: 18, colors: [color, 0xffffff], speed: 4, up: 5, size: 0.13, life: 0.5, gravity: 9 });
    this.audio.playSplash(this._pan(pos), 0.8);
  }

  fortSmash(pos, color = 0xd4a86a, power = 1) {
    this.particles.emit(pos, { count: 20 + Math.round(power * 8), colors: [color, 0x6b3f1d, 0xffd23f, 0xffffff], speed: 7 * power, up: 4, size: 0.15, life: 0.6 });
    this.particles.ring(pos, { color: 0xffd23f, size: 2.4, life: 0.28 });
    this.audio.playWoodBreak(this._pan(pos));
    this.audio.playComicBonk(this._pan(pos));
    this._toyWord(power > 1 ? 'KABLOOEY!' : 'CRUNCH!', pos, 0xffd23f, power > 1 ? 'big' : 'small');
    this.cam?.shake?.(0.35 * power);
  }

  fortRepair(pos) {
    this.particles.sparkle(pos, 0x5ee06a);
    this.particles.emit(pos, { count: 5, colors: [0x5ee06a, 0xffffff], speed: 2, up: 2, size: 0.09, life: 0.4 });
    this.audio.playComicBonk(this._pan(pos));
    this._toyWord('FIXED!', pos, 0x5ee06a);
  }

  propLaunch(pos, color = 0xff6fb5) {
    this.particles.ring(pos, { color, size: 1.4, life: 0.25 });
    this.particles.emit(pos, { count: 8, colors: [color, 0xffffff], speed: 3, up: 2, size: 0.1, life: 0.35 });
    this.audio.playLaunch(this._pan(pos));
  }

  gate(pos) {
    this.audio.playTech(this._pan(pos));
    this.particles.emit(pos, { count: 10, colors: [0x3ee6d0, 0xffffff], speed: 2.5, up: 2, size: 0.1, life: 0.4 });
    this._toyWord('CLUNK!', pos, 0x3ee6d0);
  }

  drawbridge(pos) {
    this.audio.playWoodBreak(this._pan(pos));
    this.particles.dust({ x: pos.x, y: pos.y, z: pos.z }, 12);
    this._toyWord('CREAK…', pos, 0xd4a86a);
  }

  dive(d) {
    const pos = d.getPosition();
    this.particles.dust({ x: pos.x, y: pos.y - 0.4, z: pos.z }, 8);
    this.audio.playWhoosh(this._pan(pos));
    if (d.isPlayer) this.cam.kickFov(10);
  }

  explosion(pos) {
    this.particles.explosion(pos);
    this.bursts.spawn(pos, 3.2, 0xffd23f);
    this.decals.spawnOnGround('scorch', pos, 5, 0x2a1a30, 0.7, 12);
    this.audio.playExplosion(this._pan(pos));
    this.cam.shake(0.3 + this._near(pos, 20) * 0.9);
    this.haptics?.explosion(this._near(pos, 26));
    this.hitStop = Math.max(this.hitStop, 0.08);
    this.arena.excite(0.6);
  }

  /** Material-specific breakage: glints for glass, juice + splat for fruit, chips and dust for the rest. */
  break(pos, obj) {
    const def = obj.def;
    const color = def.color ?? 0xc4a06a;
    const p = this.particles;
    let word = def.breakWord ?? 'CRUNCH!';
    switch (def.material) {
      case 'glass':
        p.emit(pos, { count: 24, colors: [0xffffff, 0xbff4ff, color], speed: 7, up: 3, size: 0.09, life: 0.6 });
        p.sparkle(pos, 0xbff4ff);
        word = def.breakWord ?? 'SHATTER!';
        break;
      case 'ceramic':
        p.emit(pos, { count: 16, colors: [color, 0xf3e6cf], speed: 5, up: 3, size: 0.12, life: 0.6 });
        p.dust(pos, 5);
        word = def.breakWord ?? 'CRASH!';
        break;
      case 'fruit':
        p.emit(pos, { count: 30, colors: def.breakColors ?? [0xff4d6a, 0xff8a9a, 0xffd0d8, 0x2f8f3a], speed: 6, up: 4, size: 0.15, life: 0.7, gravity: -18 });
        word = def.breakWord ?? 'SPLAT!';
        break;
      case 'cardboard':
        p.emit(pos, { count: 14, colors: [color, 0xefdfb0], speed: 4, up: 3, size: 0.2, life: 0.8, gravity: -6 });
        word = def.breakWord ?? 'RIIP!';
        break;
      case 'metal':
        p.emit(pos, { count: 16, colors: [0xffd23f, 0xffffff, color], speed: 8, up: 3, size: 0.08, life: 0.35, gravity: -4 });
        break;
      default:
        p.emit(pos, { count: 16, color, speed: 5, up: 3, size: 0.18, life: 0.7 });
        p.dust(pos, 6);
    }
    // Treasure-filled props (piñata, gumballs, piggy bank) spray their contents
    if (def.breakColors && def.material !== 'fruit') p.emit(pos, { count: 36, colors: def.breakColors, speed: 7, up: 6, size: 0.13, life: 1.1, gravity: -16 });
    const splat = def.splat ?? (def.material === 'fruit' ? 0xff4d6a : null);
    if (splat != null) this.decals.spawnOnGround('splat', pos, 2, splat, 0.9);
    this.bursts.spawn(pos, 1.8, 0xffffff);
    this.particles.ring(pos, { color, size: 2.2, life: 0.3 });
    this.cam.shake(0.12 + this._near(pos, 14) * 0.2);
    this.hitStop = Math.max(this.hitStop, 0.03);
    if (this._near(pos, 22) > 0) this.hud.popup(word, pos, 'big', color);
    this.audio.playBreak(def.material, this._pan(pos));
  }

  pickup(d, pu) {
    const pos = d.getPosition();
    this.particles.sparkle(pos, pu.def.color);
    this.particles.ring(pos, { color: pu.def.color, size: 3, life: 0.4 });
    this.audio.playPowerUp();
    this.hud.popup(pu.def.label + '!', pos, 'big', pu.def.color);
  }

  // ─── Parry, aerials & gadgets ───

  /** C: a bright little guard ring so the counter window is readable. */
  parryStart(d) {
    const pos = d.getPosition();
    this.particles.ring(pos, { color: 0xffffff, size: 2, life: 0.2 });
    this.particles.sparkle(pos, 0xfff3c4);
    this.audio.playParryStart(this._pan(pos));
  }

  /** A connected parry: bell clang, freeze-frame, and the attacker eats the recoil. */
  parry(d, attacker) {
    const pos = d.getPosition();
    const color = d.color;
    this.particles.ring(pos, { color: 0xffffff, size: 3.4, life: 0.3 });
    this.particles.ring(pos, { color: 0xffd23f, size: 5, life: 0.42 });
    this.bursts.spawn(pos, 2.2, 0xffd23f);
    this.particles.sparkle(pos, 0xffffff);
    this.hitStop = Math.max(this.hitStop, J.hitStop[2]);
    this.cam.shake(J.shake[2] * 0.7);
    if (d.isPlayer || attacker?.isPlayer) this.cam.punchZoom(0.4);
    this.audio.playParry(this._pan(pos));
    this.haptics?.parry();
    this.arena.excite(0.6);
    this.hud.popup('PARRY!', pos, 'big', color);
  }

  slamStart(d) {
    const pos = d.getPosition();
    this.particles.dust({ x: pos.x, y: pos.y - 0.4, z: pos.z }, 6);
    this.audio.playWhoosh(this._pan(pos), 0.9);
    if (d.isPlayer) this.cam.kickFov(6);
  }

  /** Ground-slam landing: a fat dust ring, radial sparks and a bassy thud. */
  slam(pos, color, hit, involved = false) {
    this.particles.ring(pos, { color, size: 7, life: 0.4 });
    this.particles.ring({ x: pos.x, y: pos.y + 0.05, z: pos.z }, { color: 0xffffff, size: 4.5, life: 0.28 });
    this.particles.dust({ x: pos.x, y: pos.y - 0.3, z: pos.z }, 18);
    this.particles.emit(pos, { count: 26, colors: [color, 0xffd23f, 0xffffff], speed: 8, up: 5, size: 0.14, life: 0.6, gravity: -12 });
    this.bursts.spawn(pos, 2.6, color);
    this.audio.playSlam(this._pan(pos));
    this.hitStop = Math.max(this.hitStop, BALANCE.air.slamHitStop);
    this.cam.shake(0.3 + this._near(pos, 22) * 0.7);
    this.haptics?.slam(!!involved, this._near(pos, 24));
    this.arena.excite(0.6);
    if (hit) this.hud.popup('SLAM!', pos, 'big', color);
  }

  dropkick(d) {
    const pos = d.getPosition();
    this.particles.emit({ x: pos.x, y: pos.y - 0.2, z: pos.z }, { count: 8, colors: [0xffffff, d.color], speed: 4, up: 1, size: 0.12, life: 0.35 });
    this.audio.playWhoosh(this._pan(pos), 0.7);
  }

  dropkickHit(d, victim, launch) {
    this.hit(victim, d, launch, 'kick');
    this.audio.playDropkickHit(this._pan(victim.getPosition()));
    this.hud.popup('DROP KICK!', victim.getPosition(), 'small', d.color);
  }

  /** Freeze ray cone: frosty sparks stamped along the beam plus a shiver at the target. */
  freezeBeam(from, to, target) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      this.particles.emit(
        { x: from.x + dx * t, y: from.y + 0.3 + dy * t, z: from.z + dz * t },
        { count: 4, colors: [0xbff4ff, 0xffffff, 0x7fd8ff], speed: 1.8, up: 1.2, size: 0.09, life: 0.28 },
      );
    }
    this.particles.sparkle(to, 0xbff4ff);
    this.bursts.spawn(to, 1.2, 0x8fe9ff);
    if (target?.isPlayer) { this.cam.shake(0.12); this.haptics?.freeze(false); }
  }

  /** Deep-freeze power-up: a big frost nova and every rival locked in place. */
  freezeBurst(d, radius, n) {
    const pos = d.getPosition();
    this.particles.ring(pos, { color: 0x8fe9ff, size: radius * 2, life: 0.6 });
    this.particles.ring(pos, { color: 0xffffff, size: radius * 1.2, life: 0.4 });
    this.particles.emit(pos, { count: 46, colors: [0xbff4ff, 0xffffff, 0x8fe9ff], speed: radius * 1.3, up: 3, size: 0.16, life: 0.85, gravity: 0 });
    this.bursts.spawn(pos, 2.4, 0x8fe9ff);
    this.audio.playFreeze(this._pan(pos), true);
    this.cam.shake(0.3 + this._near(pos, 20) * 0.4);
    this.haptics?.freeze(true);
    this.hitStop = Math.max(this.hitStop, 0.06);
    this.arena.excite(0.5);
    if (n) this.hud.popup('DEEP FREEZE!', pos, 'big', 0x8fe9ff);
  }

  magnet(d) {
    const pos = d.getPosition();
    this.particles.ring(pos, { color: 0xb56cff, size: 4, life: 0.45 });
    this.particles.sparkle(pos, 0xd7b3ff);
    this.audio.playMagnet(this._pan(pos));
  }

  /** One yanked target/object: a violet tether flicker, no sound (the cast already plays it). */
  magnetPull(from, to) {
    this.particles.emit(to, { count: 6, colors: [0xb56cff, 0xffffff, 0x8f5bff], speed: 2.4, up: 1.5, size: 0.1, life: 0.3 });
    this.particles.sparkle(to, 0xb56cff);
  }

  gadget(d, kind, hit) {
    const pos = d.getPosition();
    this.audio.playGadget(kind, this._pan(pos), hit);
    if (!hit && d.isPlayer) this.hud.popup('WHIFF!', pos, 'small', 0xbff4ff);
  }

  /** Volcano lava splash when someone dips into the lagoon. */
  lavaHit(d, launch) {
    const pos = d.getPosition();
    this.particles.emit(pos, { count: 20, colors: [0xff7a2a, 0xffd23f, 0x3a2b3a], speed: 6, up: 6, size: 0.18, life: 0.75, gravity: -14 });
    this.particles.dust(pos, 6);
    this.audio.playLavaHit(this._pan(pos));
    this.cam.shake(0.22 + this._near(pos, 16) * 0.5);
    if (d.isPlayer) this.haptics?.pulse(0.45, 140, 0.2);
    if (this._near(pos, 18) > 0) this.hud.popup('SIZZLE!', pos, 'small', 0xff7a2a);
  }

  // ─── Movement ───

  jump(d, double) {
    const pos = d.getPosition();
    if (double) this.particles.ring({ x: pos.x, y: pos.y - 0.5, z: pos.z }, { color: 0xffffff, size: 1.6, life: 0.25 });
    else this.particles.dust({ x: pos.x, y: pos.y - 0.5, z: pos.z }, 5);
    if (d.isPlayer || this._near(pos, 10) > 0) this.audio.playJump(this._pan(pos), double);
  }

  land(d, speed) {
    const pos = d.getPosition();
    this.particles.dust({ x: pos.x, y: pos.y - 0.5, z: pos.z }, Math.min(12, Math.floor(speed / 2)));
    if (d.isPlayer || speed > 12) this.audio.playLand(speed, this._pan(pos));
    const near = this._near(pos, 18);
    this.haptics?.land(speed, !!d.isPlayer, near);
    if (d.isPlayer && speed > 13) this.cam.shake(Math.min(0.24, (speed - 13) * 0.016));
    if (speed > 14) this.cam.shake(near * Math.min(0.18, speed * 0.006));
  }

  /** Fast-fall start: a short downward puff so the commit reads at a glance. */
  fastFall(d) {
    const pos = d.getPosition();
    this.particles.dust({ x: pos.x, y: pos.y - 0.2, z: pos.z }, 3);
    if (d.isPlayer) this.audio.playWhoosh(this._pan(pos), 0.25);
  }

  /** Landing roll: a spray of dust and a low whoosh while momentum is kept. */
  roll(d) {
    const pos = d.getPosition();
    this.particles.dust({ x: pos.x, y: pos.y - 0.5, z: pos.z }, 9);
    this.particles.ring({ x: pos.x, y: pos.y - 0.45, z: pos.z }, { color: 0xfff8ee, size: 1.5, life: 0.22 });
    this.audio.playWhoosh(this._pan(pos), 0.45);
    if (d.isPlayer) this.haptics?.pulse(0.16, 60, 0.16);
  }

  /** A hard ground turn: dust kicked sideways plus a tiny tactile tick for the player. */
  skid(d, speed = 6) {    const pos = d.getPosition();
    const v = d.velocity || { x: 0, z: 0 };
    this.particles.dust({ x: pos.x - v.x * 0.03, y: pos.y - 0.45, z: pos.z - v.z * 0.03 }, Math.min(6, 2 + Math.floor(speed * 0.35)));
    if (d.isPlayer) this.haptics?.pulse(0.1 + Math.min(0.12, speed * 0.012), 45, 0.18);
  }

  // ─── Physics ───

  /** A contact from PhysicsWorld.getImpacts(): material-aware sound + dust on hard hits */
  impact(imp) {
    const { a, b, speed, pos } = imp;
    // Dweeb-on-stage landings are handled by land(); skip them here
    if ((a.kind === 'dweeb' && b.kind === 'stage') || (b.kind === 'dweeb' && a.kind === 'stage')) return;
    const gain = 0.25 + this._near(pos, 30) * 0.75;
    const src = a.kind === 'object' || a.kind === 'dweeb' ? a : b;
    const other = src === a ? b : a;
    this.audio.impact(src, other, speed, this._pan(pos), gain, src);
    // Comic impact star on hard hits; heavy things crack the floor
    if (speed > 10 && (a.kind === 'object' || b.kind === 'object')) {
      this.bursts.spawn(pos, Math.min(1.7, 0.35 + speed * 0.045), 0xffffff);
      if (speed > 13 && src.mass >= 2 && other.kind === 'stage') this.decals.spawnOnGround('crack', pos, 1.2 + src.mass * 0.25, 0x1b1030, 0.5, 7);
    }
    if (speed > 9) this.particles.dust({ x: pos.x, y: pos.y - 0.2, z: pos.z }, Math.min(8, Math.floor(speed / 3)));

    // Physical crashes carry weight too: a small camera jolt and rumble when they're close.
    const near = this._near(pos, 26);
    const involvesPlayer = !!(a.ref?.isPlayer || b.ref?.isPlayer);
    if (speed > 5 && (involvesPlayer || near > 0.25)) {
      const power = Math.min(0.34, (speed - 4) * 0.02) * (involvesPlayer ? 1 : 0.35 + near * 0.5);
      this.haptics?.pulse(power, 45 + Math.min(70, speed * 4), 0.22);
      if (involvesPlayer) this.cam.shake(Math.min(0.16, speed * 0.007));
    }
  }

  // ─── Match ───

  splash(pos, big = true) {
    _v.set(pos.x, -4.8, pos.z);
    this.particles.splash(_v);
    if (big) {
      // Water entry reads: double plume, foam ring, white spray
      this.particles.splash(_v);
      this.particles.ring(_v, { color: 0xffffff, size: 3.2, life: 0.5 });
      this.particles.emit(_v, { count: 18, colors: [0xffffff, 0x8fe9ff, 0x6ff0ee], speed: 5, up: 9, size: 0.2, life: 0.9, gravity: -20 });
      this.bursts.spawn(_v, 1.6, 0x8fe9ff);
    }
    this.audio.playSplash(this._pan(pos));
    if (big) this.cam.shake(0.25);
  }

  /** Barely under near the lip: a flail (one splash-jump to get out). */
  flail(d, pos) {
    this.splash(pos, false);
    this.particles.ring({ x: pos.x, y: -4.7, z: pos.z }, { color: 0xffffff, size: 2, life: 0.35 });
    if (d.isPlayer) this.hud.announce('FLAIL!<small>JUMP!</small>', 'trick', 0.5);
    else if (this._near(pos, 18) > 0) this.hud.popup('FLAIL!', pos, 'small', 0x8fe9ff);
  }

  flailJump(d) {
    const pos = d.getPosition();
    this.splash(pos, true);
    this.audio.playSpringBoing(this._pan(pos));
    this.hud.popup(d.isPlayer ? 'SPLASH-JUMP!' : 'SPLOOSH!', pos, 'big', 0x8fe9ff);
    this.arena.excite(0.5);
  }

  ko(victim, credited, kind, pos, suddenDeath = false) {
    if (kind === 'splash') this.splash(pos);
    else {
      this.particles.confetti(pos, 50);
      this.audio.playLaunch(this._pan(pos));
    }
    this.audio.playKO();
    this.arena.excite(1.2);
    // Sudden-death KOs hit harder on screen
    const sd = suddenDeath ? 1.6 : 1;
    this.cam.shake((victim.isPlayer ? 0.7 : 0.35) * sd);
    this.haptics?.ko(!!(victim.isPlayer || credited?.isPlayer), suddenDeath);
    if (victim.isPlayer || credited?.isPlayer || suddenDeath) this.hud.flashImpact?.();
  }

  respawn(d) {
    const pos = d.getPosition();
    this.particles.sparkle(pos, d.color);
    this.particles.ring(pos, { color: d.color, size: 2.5, life: 0.5 });
  }

  update(dt) {
    this.hitStop = Math.max(0, this.hitStop - dt);
  }

  // ─── Atmosphere: crowd, arena events, victory ───

  /** The crowd crosses a hype level: swell the cheer and show the chant. */
  crowdRoar(level, kind) {
    this.audio.playCheer(0.25 + level * 0.2);
    const words = ['…', 'OOOOH!', 'ROAR!', 'DEAFENING!', 'PANDEMONIUM!'];
    this.hud.popup(words[Math.min(4, level)] ?? 'OOOOH!', { x: 0, y: 9, z: 0 }, level >= 3 ? 'big' : 'small', 0xffd23f);
    if (level >= 3) this.cam.shake(0.12 * level);
  }

  /** The podium: champion banner, victory sting, confetti over the winner. */
  victoryCelebration(d) {
    const pos = d.getPosition();
    this.audio.playVictory();
    this.audio.playBanner(true);
    this.audio.playCheer(1);
    this.particles.emit({ x: pos.x, y: pos.y + 3, z: pos.z },
      { count: 60, colors: [0xffd23f, 0xff6fb5, 0x8fe9ff, 0x48bb78], speed: 8, up: 4, size: 0.16, life: 1.6, gravity: -6 });
    this.hud.popup('CHAMPION!', { x: pos.x, y: pos.y + 2.2, z: pos.z }, 'big', 0xffd23f);
  }

  /** Storm Spire lightning strike at (x, z). */
  lightningStrike(x, z) {
    const pos = { x, y: 0.4, z };
    this.particles.bigHit(pos, 0xbfe9ff);
    this.particles.emit(pos, { count: 26, colors: [0xbfe9ff, 0xffffff, 0x7c6cf0], speed: 9, up: 10, size: 0.14, life: 0.5, gravity: -20 });
    this.audio.playExplosion(this._pan(pos));
    this.cam.shake(0.5);
  }

  /** Sky Turbine gust: a wall of wind rolling across the arena. */
  windGustFx(dirAngle) {
    this.audio.playWhoosh(0, 0.9);
    this.cam.shake(0.18);
  }

  /** Magnet Core pulse: the whole arena shudders toward the middle. */
  magnetPulseFx(active) {
    this.audio.playMagnet(0);
    if (active) this.cam.shake(0.3);
  }

  /** King of the hill: someone banks a 10-point milestone. */
  hillScoreFx(d, score) {
    const pos = d.getPosition();
    this.hud.popup(`${score} PTS!`, { x: pos.x, y: pos.y + 1.6, z: pos.z }, 'small', 0x7cffb2);
    this.audio.playTrickshot(1, this._pan(pos));
  }
}
