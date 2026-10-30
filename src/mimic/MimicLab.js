// MimicLab.js — First-Person Toy Lab & Mutation Sandbox (Game 4)
//
// In first-person, you demonstrate physical antics (throwing, stacking, jumping, kicking).
// Crowds of googly-eyed Dweeb pupils watch you, take notes, and enthusiastically try to copy
// and hilariously mutate that action.

import * as THREE from 'three';
import { toonMat, noOutline, PALETTE } from '../render/Toon.js';

export const MUTATION_TYPES = [
  { id: 'overachiever', name: 'OVER-ACHIEVER', blurb: 'Winds up 300% too hard and spins like a tornado!' },
  { id: 'clumsy', name: 'CLUMSY SLAPSTICK', blurb: 'Stumbles on air, drops the prop on their foot, and squashes flat!' },
  { id: 'substitute', name: 'MAD SCIENTIST', blurb: 'Substituted the item with an explosive barrel or anvil!' },
  { id: 'swarm', name: 'CHAOS SWARM', blurb: 'Multiple Dweebs try to do it simultaneously and yeet each other!' },
  { id: 'backfire', name: 'BACKFIRE', blurb: 'The prop detonates right in their face. Oops.' },
  { id: 'slowmo', name: 'SLO-MO SAGE', blurb: 'Attempts the move in dramatic slow motion. Very artsy. Very slow.' },
  { id: 'prodigy', name: 'PRODIGY', blurb: 'Nails it PERFECTLY on the first try. Show-off!' },
];

/** Seconds of player input kept on tape. */
const TAPE_KEEP = 4;
/** Pupils copy from this long before the demonstrated beat … */
const COPY_LEAD = 1.4;
/** … to this long after it (the follow-through), then start performing. */
const COPY_FOLLOW = 1.1;

export class MimicLab {
  constructor(physicsWorld, scene, options = {}) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.hud = options.hud || null;
    this.fx = options.fx || null;
    this.audio = options.audio || null;
    this.arena = options.arena || null;   // props are real arena items: grab / throw / explode all work
    this.combat = null;
    this.items = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.colliders = [];
    this.bodyIds = [];
    this.props = [];
    this.clock = 0;
    this.lastAction = null;
    this.activeMutation = null;
    this.mutationCooldown = 0;
    this.chain = 0;
    this.chainTimer = 0;
    this.hintEl = null;
    this.hintTimer = null;

    // Ghost replay: a rolling recording of the player's inputs so pupils copy the actual performance.
    this.tape = [];            // { t, mx, my, x, z, ev } sampled every frame, last TAPE_KEEP seconds
    this.pendingCopy = null;   // { at, from, mut, actionName, pupils } waiting for the follow-through
    this.ghosts = [];          // pupils currently replaying a performance
    this._tapeEv = null;

    // Edge-detection state for real player demonstrations.
    this._wasJumpRising = false;
    this._wasDiving = false;
    this._wasRagdolling = false;
    this._prevHitstun = 0;
    this._prevHeld = null;
    // PhysicsWorld body ids created by this lab — removed on dispose so
    // re-entering the lab doesn't stack invisible phantom colliders.
    this._physIds = [];

    this._buildAmphitheater();
    this._spawnToyTrunk();
    this._showHint();
  }

  _trackBody(result) {
    if (result?.id != null) this.bodyIds.push(result.id);
    return result;
  }

  _showHint() {
    if (typeof document === 'undefined' || !document.body) return;
    const el = document.createElement('div');
    el.textContent = "Do something dumb. They'll copy it... badly.";
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:118px',
      'transform:translateX(-50%)',
      'z-index:35',
      'padding:8px 16px',
      'border-radius:999px',
      'background:rgba(23,23,23,.78)',
      'border:2px solid rgba(250,204,21,.75)',
      'color:#fef9c3',
      'font:700 14px/1.3 "Nunito",system-ui,sans-serif',
      'letter-spacing:.02em',
      'text-align:center',
      'pointer-events:none',
      'text-shadow:0 2px 0 rgba(0,0,0,.45)',
      'box-shadow:0 6px 18px rgba(0,0,0,.28)',
    ].join(';');
    document.body.appendChild(el);
    this.hintEl = el;
    this.hintTimer = setTimeout(() => {
      this.hintEl?.remove();
      this.hintEl = null;
      this.hintTimer = null;
    }, 7000);
  }

  _announce(text, style = 'trick', duration = 1.8) {
    if (this.hud?.announce) {
      this.hud.announce(text, style, duration);
      return;
    }
    const announcer = document.getElementById('announcer');
    if (announcer) {
      announcer.className = `show ${style}`;
      announcer.innerHTML = text;
    }
  }

  /** Register a PhysicsWorld creation result for cleanup on dispose. */
  _trackPhysics(entry) {
    if (entry && entry.id) this._physIds.push(entry.id);
    return entry;
  }

  _buildAmphitheater() {
    const floorMat = toonMat({ color: 0xfef08a, flatShading: true });
    const woodMat = toonMat({ color: 0x78350f, flatShading: true });

    // Central circular arena floor (r = 18)
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(18, 18.5, 0.8, 24), floorMat);
    floor.position.y = -0.4;
    this.group.add(floor);
    if (this.physicsWorld) {
      this._trackPhysics(this.physicsWorld.createFixedCylinder(0, -0.4, 0, 18, 0.4, 'toy'));
    }

    // Checkered center testing rug
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(6, 16),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.5, flatShading: true })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.03;
    this.group.add(rug);
    noOutline(rug);

    // Tiered wooden bleachers encircling the lab
    for (let tier = 0; tier < 3; tier++) {
      const radius = 17 + tier * 1.8;
      const height = 0.6 + tier * 0.7;
      const bleacher = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.6, 6, 24),
        woodMat
      );
      bleacher.rotation.x = Math.PI / 2;
      bleacher.position.y = height;
      this.group.add(bleacher);

      if (this.physicsWorld) {
        this._trackPhysics(this.physicsWorld.createFixedCylinder(0, height, 0, radius, 0.35, 'wood'));
      }
    }

    // Sunny overhead lab lighting
    const light = new THREE.DirectionalLight(0xfffaed, 2.8);
    light.position.set(12, 22, 10);
    this.group.add(light);
  }

  _spawnToyTrunk() {
    // The Toy Trunk where props replenish
    const trunkX = 0, trunkZ = -10;
    const trunk = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 1.4, 2.2),
      toonMat({ color: 0xb45309, flatShading: true })
    );
    trunk.position.set(trunkX, 0.7, trunkZ);
    this.group.add(trunk);
    if (this.physicsWorld) {
      this._trackPhysics(this.physicsWorld.createStaticBox(trunkX, 0.7, trunkZ, 2.1, 0.7, 1.1, 'wood'));
    }

    // Starting toys, as real arena items so the player can grab, throw and blow them up
    // In the game they're real arena items; without an arena (standalone lab) they're local physics props.
    const toys = [['watermelon', 0, -8, 'fruit', 2.0], ['bowlingBall', -2.5, -7, 'metal', 4.5], ['crate', 2.5, -7, 'wood', 3.0],
      ['rubberChicken', -1.2, -6, 'rubber', 0.8], ['explosiveBarrel', 1.5, -6, 'toy', 2.5], ['giantDie', -3.5, -5, 'toy', 2.0]];
    for (const [key, x, z, mat, mass] of toys) {
      if (this.arena) this._spawnItem(key, x, 1.6, z);
      else this._spawnProp(key, x, 1.5, z, mat, mass, key === 'explosiveBarrel');
    }
  }

  _spawnItem(key, x, y, z) {
    if (!this.arena) return null;
    try {
      const o = this.arena.spawnItem(key, { x, y, z });
      if (o) this.items.push(o);
      return o;
    } catch { return null; }
  }

  /** Collider shape matched to the prop's visual so boxes don't roll like balls. */
  _propCollider(name) {
    if (name === 'crate' || name === 'giantDie') return { shape: 'box', dims: { hx: 0.6, hy: 0.6, hz: 0.6 } };
    if (name === 'watermelon') return { shape: 'sphere', dims: { radius: 0.65 } };
    if (name === 'bowlingBall') return { shape: 'sphere', dims: { radius: 0.6 } };
    if (name === 'rubberChicken') return { shape: 'capsule', dims: { halfHeight: 0.45, radius: 0.28 } };
    return { shape: 'cylinder', dims: { halfHeight: 0.65, radius: 0.55 } }; // explosiveBarrel
  }

  _spawnProp(name, x, y, z, material, mass, isExplosive = false) {
    let geo;
    let mat = toonMat({ color: PALETTE.red, flatShading: true });
    if (name === 'watermelon') {
      geo = new THREE.SphereGeometry(0.65, 8, 8);
      mat = toonMat({ color: 0x16a34a, flatShading: true });
    } else if (name === 'bowlingBall') {
      geo = new THREE.SphereGeometry(0.6, 12, 12);
      mat = toonMat({ color: 0x1e293b, flatShading: true });
    } else if (name === 'crate' || name === 'giantDie') {
      geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
      mat = toonMat({ color: name === 'giantDie' ? 0xffffff : 0xca8a04, flatShading: true });
    } else if (name === 'rubberChicken') {
      geo = new THREE.CylinderGeometry(0.2, 0.35, 1.2, 6);
      mat = toonMat({ color: PALETTE.yellow, flatShading: true });
    } else {
      geo = new THREE.CylinderGeometry(0.55, 0.55, 1.3, 8);
      mat = toonMat({ color: PALETTE.red, flatShading: true });
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.group.add(mesh);

    let body = null;
    if (this.physicsWorld) {
      const { shape, dims } = this._propCollider(name);
      const b = this._trackPhysics(
        this.physicsWorld.createDynamicBody(x, y, z, shape, dims, { material, mass })
      );
      body = b.body;
    }

    this.props.push({ name, mesh, body, isExplosive });
  }

  update(dt, player, dweebs = [], combat = null) {
    this.clock += dt;
    if (combat) this.combat = combat;
    if (this.arena) this.items = this.items.filter(o => this.arena.objects.includes(o));
    this.mutationCooldown = Math.max(0, this.mutationCooldown - dt);
    if (this.chainTimer > 0) {
      this.chainTimer = Math.max(0, this.chainTimer - dt);
      if (this.chainTimer <= 0) this.chain = 0;
    }

    this._updateGhosts(dt, dweebs);
    if (!player || !player.body || !player.active) return;
    this._record(player);

    // Jump (the Dweeb sets jumpRising for both ground jumps and double jumps).
    if (player.jumpRising && !this._wasJumpRising) {
      this._tag('jump');
      this.triggerDemonstration(player.jumpsLeft === 0 ? 'DOUBLE JUMP' : 'BIG JUMP', dweebs);
    }
    this._wasJumpRising = !!player.jumpRising;

    // Ground dive.
    const diving = player.diveTimer > 0;
    if (diving && !this._wasDiving) { this._tag('dive'); this.triggerDemonstration('FLYING DIVE', dweebs); }
    this._wasDiving = diving;

    // Getting launched: a fresh hit bumps hitstun; big ones also start a ragdoll.
    const launched = player.hitstun > this._prevHitstun + 0.05;
    if (launched || (player.ragdolling && !this._wasRagdolling)) {
      this.triggerDemonstration('GETTING LAUNCHED', dweebs);
    }
    this._prevHitstun = player.hitstun || 0;
    this._wasRagdolling = !!player.ragdolling;

    // Grab / throw transitions. A drop (Q) throws nothing, so only count fast releases.
    const held = player.held;
    if (held && !this._prevHeld) {
      this._tag('grab');
      this.triggerDemonstration(`GRAB (${held.kind === 'dweeb' ? 'A PUPIL' : 'A TOY'})`, dweebs);
    } else if (!held && this._prevHeld) {
      this._tag('throw');
      const ref = this._prevHeld.ref;
      if (ref?.body) {
        const v = ref.body.linvel();
        if (Math.hypot(v.x, v.y, v.z) > 7) {
          this.triggerDemonstration(`MEGA THROW (${this._prevHeld.kind === 'dweeb' ? 'PUPIL' : 'TOY'})`, dweebs);
        }
      }
    }
    this._prevHeld = held ? { kind: held.kind, ref: held.ref } : null;
  }

  triggerDemonstration(actionName, dweebs = [], forceMutationId = null) {
    // Tests (and scripted demos) may force a mutation and bypass the cooldown.
    if (!forceMutationId && this.mutationCooldown > 0) return false;

    // Encore escalation: repeating the same demo back-to-back hypes the
    // pupils up — impulses scale up to +75% by the 4th consecutive encore.
    if (actionName === this.lastAction) this.encoreCount = (this.encoreCount || 1) + 1;
    else this.encoreCount = 1;
    this.lastAction = actionName;
    this.mutationCooldown = 2.5;
    this.boost = 1 + 0.25 * Math.min(3, this.encoreCount - 1);

    // Chain hype: repeated demos inside the 7s window build a bigger MIMIC combo.
    this.chain = this.chainTimer > 0 ? Math.min(9, this.chain + 1) : 1;
    this.chainTimer = 7.0;

    // At chain 3+, the pupils attempt the spectacular mutations only.
    const pool = this.chain >= 3
      ? MUTATION_TYPES.filter(m => m.id === 'swarm' || m.id === 'substitute')
      : MUTATION_TYPES;
    const mut = forceMutationId
      ? (MUTATION_TYPES.find(m => m.id === forceMutationId) || MUTATION_TYPES[0])
      : (pool[Math.floor(Math.random() * pool.length)] || MUTATION_TYPES[0]);
    this.activeMutation = mut;

    const style = this.chain >= 3 ? 'danger' : 'trick';
    const encoreTag = this.encoreCount > 1 ? ` <small>ENCORE x${this.encoreCount}!</small>` : '';
    this._announce(
      `MIMIC x${this.chain}: ${mut.name}!<small>${actionName} → ${mut.blurb}</small>${encoreTag}`,
      style,
      2.0
    );
    this.audio?.playCheer?.(Math.min(1, 0.3 + this.chain * 0.12));

    // Choose a Dweeb pupil to execute the mutated copycat action.
    const pupils = dweebs.filter(d => !d.isPlayer && d.active !== false && d.body && !d.mimicGhost);
    if (pupils.length === 0) return true;

    const pupil = pupils[Math.floor(Math.random() * pupils.length)];

    // Ghost replay: the pupil(s) take notes while you finish the move, then perform YOUR inputs
    // back (run-up, jumps, dives, grabs, throws), mutated. The punchline fires at the copied beat.
    if (this.tape.length > 10 && !this.pendingCopy) {
      const crew = mut.id === 'swarm' ? pupils.slice(0, 6) : [pupil];
      for (const p of crew) this.hud?.popup?.('📝 TAKING NOTES…', p.getPosition(), 'small', 0x7dd3fc);
      this.pendingCopy = { at: this.clock + COPY_FOLLOW, beat: this.clock, mut, actionName, crew };
      return true;
    }
    this._punchline(mut, pupil, pupils);
    return true;
  }

  /** The mutation's comedic payoff (applied on the copied beat, or instantly if nothing was taped). */
  _punchline(mut, pupil, pupils) {
    const boost = this.boost || 1;
    if (!pupil?.body || pupil.active === false) return;

    // The rest of the crowd cheers the performer with a little hop.
    const cheer = () => {
      for (const p of pupils) {
        if (p !== pupil && p.body) {
          p.body.setLinvel({ x: (Math.random() - 0.5) * 2, y: 3.0, z: (Math.random() - 0.5) * 2 }, true);
        }
      }
    };

    if (mut.id === 'overachiever') {
      // Wind up and blast upward into the stratosphere!
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 8, y: 28.0 * boost, z: (Math.random() - 0.5) * 8 }, true);
      if (pupil.onBounce) pupil.onBounce();
      cheer();
    } else if (mut.id === 'clumsy') {
      // Trip, tumble, and ragdoll
      pupil.body.setLinvel({ x: 0, y: 4.0, z: 0 }, true);
      pupil.ragdolling = true;
      pupil.hitstun = 2.5;
      cheer();
    } else if (mut.id === 'substitute') {
      // Swapped the prop for an explosive barrel… with the fuse already lit
      const pp = pupil.getPosition();
      const barrel = this._spawnItem('explosiveBarrel', pp.x, pp.y + 1.6, pp.z);
      if (barrel?.body) {
        barrel.body.setLinvel({ x: (Math.random() - 0.5) * 6, y: 6, z: (Math.random() - 0.5) * 6 }, true);
        this.combat?.lightFuse?.(barrel, pupil, 1.4);
      }
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 10, y: 7.0, z: (Math.random() - 0.5) * 10 }, true);
    } else if (mut.id === 'swarm') {
      // Launch all pupils in a comedic fountain burst!
      for (const p of pupils) {
        if (p.body) {
          p.body.setLinvel({
            x: (Math.random() - 0.5) * 12,
            y: (16 + Math.random() * 8) * boost,
            z: (Math.random() - 0.5) * 12,
          }, true);
        }
      }
    } else if (mut.id === 'backfire') {
      // Prop detonates in their face: launched, ragdolled, dazed.
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 6, y: 14.0 * boost, z: (Math.random() - 0.5) * 6 }, true);
      pupil.ragdolling = true;
      pupil.hitstun = 2.0;
      cheer();
    } else if (mut.id === 'slowmo') {
      // Dramatic slow-motion attempt: gentle float, maximum gravitas.
      pupil.body.setLinvel({ x: (Math.random() - 0.5) * 2, y: 6.0, z: (Math.random() - 0.5) * 2 }, true);
      pupil.slowmoT = 3.0;
      cheer();
    } else if (mut.id === 'prodigy') {
      // Nails it perfectly: clean vertical pop with a victory bounce.
      pupil.body.setLinvel({ x: 0, y: 12.0 * boost, z: 0 }, true);
      if (pupil.onBounce) pupil.onBounce();
      cheer();
    }
  }

  // ═══ Ghost replay ═══

  _tag(ev) { this._tapeEv = this._tapeEv ? `${this._tapeEv},${ev}` : ev; }

  _record(player) {
    const p = player.getPosition();
    const mi = player.moveInput;
    this.tape.push({ t: this.clock, mx: mi?.x || 0, my: mi?.y || 0, x: p.x, z: p.z, ev: this._tapeEv });
    this._tapeEv = null;
    while (this.tape.length && this.tape[0].t < this.clock - TAPE_KEEP) this.tape.shift();

    const pc = this.pendingCopy;
    if (pc && this.clock >= pc.at) {
      this.pendingCopy = null;
      const from = pc.beat - COPY_LEAD;
      const clip = this.tape.filter(f => f.t >= from && f.t <= pc.at).map(f => ({ ...f, t: f.t - from }));
      if (clip.length < 5) return;
      const beatT = pc.beat - from;
      const start = clip[0], end = clip[clip.length - 1];
      const disp = { x: end.x - start.x, z: end.z - start.z };
      pc.crew.forEach((d, i) => {
        if (!d?.body || !d.active) return;
        const o = d.getPosition();
        d.mimicGhost = {
          clip, i: 0, t: -i * 0.18, beatT, beatDone: false, mut: pc.mut, crewIdx: i,
          ox: o.x, oz: o.z, disp, stumbleT: pc.mut.id === 'clumsy' ? beatT * (0.4 + Math.random() * 0.5) : -1,
        };
        this.ghosts.push(d);
        this.hud?.popup?.(i === 0 ? 'MY TURN!' : 'ME TOO!', o, 'small', 0xffd23f);
      });
    }
  }

  _updateGhosts(dt, dweebs) {
    if (!this.ghosts.length) return;
    const pupils = dweebs.filter(d => !d.isPlayer && d.active && d.body);
    for (let k = this.ghosts.length - 1; k >= 0; k--) {
      const d = this.ghosts[k];
      const g = d?.mimicGhost;
      if (!g || !d.body || !d.active) { if (d) d.mimicGhost = null; this.ghosts.splice(k, 1); continue; }
      g.t += dt;
      if (g.t < 0) continue;               // swarm stagger
      const clip = g.clip;
      while (g.i < clip.length - 1 && clip[g.i + 1].t <= g.t) {
        g.i++;
        const ev = clip[g.i].ev;
        if (ev) this._ghostEvent(d, g, ev);
      }
      const f = clip[g.i];
      const wobble = g.mut.id === 'clumsy' ? 0.35 : 0;
      let mx = f.mx + (Math.random() - 0.5) * wobble, my = f.my + (Math.random() - 0.5) * wobble;
      d.moveInput?.set?.(mx, my);
      if (g.stumbleT > 0 && g.t >= g.stumbleT) {
        g.stumbleT = -1;
        d.startRagdoll?.(1.4, 9);
        this.hud?.popup?.('WHOOPS!', d.getPosition(), 'small', 0xff6fb5);
      }
      if (!g.beatDone && g.t >= g.beatT) {
        g.beatDone = true;
        if (g.crewIdx === 0) this._punchline(g.mut, d, pupils);
      }
      if (g.t >= clip[clip.length - 1].t) {
        this._grade(d, g);
        d.moveInput?.set?.(0, 0);
        d.mimicGhost = null;
        this.ghosts.splice(k, 1);
      }
    }
  }

  _ghostEvent(d, g, evs) {
    const c = this.combat;
    for (const ev of evs.split(',')) {
      try {
        if (ev === 'jump') {
          d.requestJump?.();
          if (g.mut.id === 'overachiever' && d.body) {
            const v = d.body.linvel();
            d.body.setLinvel({ x: v.x * 1.6, y: Math.max(v.y, 0) + 9, z: v.z * 1.6 }, true);
          }
        } else if (ev === 'dive') c?.dive?.(d);
        else if (ev === 'grab') { if (!d.held) c?.grab?.(d); }
        else if (ev === 'throw') {
          if (d.held) c?.throwHeld?.(d, g.mut.id === 'overachiever' ? 1 : 0.6);
          else if (g.mut.id === 'clumsy') this.hud?.popup?.('…NOTHING IN HAND', d.getPosition(), 'small', 0xb0b0b0);
        }
      } catch { /* a pupil mid-ragdoll can refuse an action; skip it */ }
    }
  }

  /** Judge the copy: how closely did the pupil's path match the player's? */
  _grade(d, g) {
    const p = d.getPosition();
    const dx = p.x - g.ox, dz = p.z - g.oz;
    const want = Math.hypot(g.disp.x, g.disp.z);
    const err = Math.hypot(dx - g.disp.x, dz - g.disp.z);
    const score = 1 - err / (want + 2.5);
    const [word, color] = score > 0.7 ? ['NAILED IT!', 0x4ade80]
      : score > 0.35 ? ['CLOSE ENOUGH', 0xffd23f]
      : ['WHAT WAS THAT?!', 0xff6a3c];
    this.hud?.popup?.(word, p, score > 0.7 ? 'big' : 'small', color);
    if (score > 0.7) this.audio?.playCheer?.(0.5);
  }

  dispose() {
    for (const d of this.ghosts) if (d) { d.mimicGhost = null; d.moveInput?.set?.(0, 0); }
    this.ghosts.length = 0;
    this.pendingCopy = null;
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    if (this.hintEl) {
      this.hintEl.remove();
      this.hintEl = null;
    }

    // Remove every body this lab created, not just the dynamic props.
    if (this.physicsWorld) {
      for (const id of [...this.bodyIds, ...this._physIds]) {
        try { this.physicsWorld.removeBody(id); } catch { /* already gone */ }
      }
    }
    this.bodyIds.length = 0;
    this._physIds = [];

    // Legacy collider entries (if any code pushed them manually).
    for (const c of this.colliders) {
      if (!this.physicsWorld || !c?.body) continue;
      if (c.id) this.physicsWorld.removeBody(c.id);
      else this.physicsWorld.world.removeRigidBody(c.body);
    }
    this.colliders.length = 0;
    this.props.length = 0;
    if (this.arena) for (const o of this.items) if (this.arena.objects.includes(o)) this.arena.removeObject(o);
    this.items = [];

    this.group.traverse(obj => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m?.dispose?.();
    });
    this.group.clear();
    this.scene.remove(this.group);
  }
}
