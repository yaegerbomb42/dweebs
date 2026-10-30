// Mutators.js — Round mutators system for Dweebs brawl modes.
// Mutators are per-round modifiers that spice up gameplay. Applied after match.beginRound(),
// ticked each frame while match is playing, and fully reverted at round end.

export const MUTATORS = [
  {
    id: 'moonGravity',
    name: 'MOON GRAVITY',
    blurb: 'Low gravity — float like a feather, fall like a dream',
    color: 0x8fe9ff,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutGravPrev = ctx.physics.gravityScale ?? 1;
      ctx.physics.setGravityScale(ctx._mutGravPrev * 0.35);
      for (const d of ctx.dweebs) {
        d._mutatorOrigGravity = d.gravityScale;
        d._mutatorOrigJump = d.jumpScale;
        d.jumpScale = (d.jumpScale ?? 1) * 0.82; // low-g already floats you; keep jumps on-screen
      }
    },
    revert(ctx) {
      ctx.physics.setGravityScale(ctx._mutGravPrev ?? 1);
      for (const d of ctx.dweebs) {
        if (d._mutatorOrigGravity != null) d.gravityScale = d._mutatorOrigGravity;
        if (d._mutatorOrigJump != null) d.jumpScale = d._mutatorOrigJump;
        d._mutatorOrigGravity = d._mutatorOrigJump = null;
      }
    },
  },
  {
    id: 'heavyWorld',
    name: 'HEAVY WORLD',
    blurb: 'Crushing gravity — jumps are short, falls are fast',
    color: 0x8b5a2b,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutGravPrev = ctx.physics.gravityScale ?? 1;
      ctx.physics.setGravityScale(ctx._mutGravPrev * 1.8);
      for (const d of ctx.dweebs) {
        d._mutatorOrigGravity = d.gravityScale;
        d._mutatorOrigJump = d.jumpScale;
        d.jumpScale = (d.jumpScale ?? 1) * 1.15; // a little extra hop so heavy world isn't a slog
      }
    },
    revert(ctx) {
      ctx.physics.setGravityScale(ctx._mutGravPrev ?? 1);
      for (const d of ctx.dweebs) {
        if (d._mutatorOrigGravity != null) d.gravityScale = d._mutatorOrigGravity;
        if (d._mutatorOrigJump != null) d.jumpScale = d._mutatorOrigJump;
        d._mutatorOrigGravity = d._mutatorOrigJump = null;
      }
    },
  },
  {
    id: 'iceRink',
    name: 'ICE RINK',
    blurb: 'Slippery floor — slide forever, traction is a myth',
    color: 0x8fe9ff,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      for (const d of ctx.dweebs) {
        d._mutatorOrigSlide = d.slide;
        d._mutatorOrigTraction = d.traction;
        d.slide = 2.2;
        d.traction = 0.25;
      }
    },
    revert(ctx) {
      for (const d of ctx.dweebs) {
        if (d._mutatorOrigSlide != null) d.slide = d._mutatorOrigSlide;
        if (d._mutatorOrigTraction != null) d.traction = d._mutatorOrigTraction;
        d._mutatorOrigSlide = d._mutatorOrigTraction = null;
      }
    },
  },
  {
    id: 'itemRain',
    name: 'ITEM RAIN',
    blurb: 'Items fall from the sky every 2.5 seconds!',
    color: 0xffd23f,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutatorItemRainTimer = 0;
    },
    tick(ctx, dt) {
      if (!ctx.match?.running) return;
      ctx._mutatorItemRainTimer = (ctx._mutatorItemRainTimer || 0) + dt;
      if (ctx._mutatorItemRainTimer >= 2.5) {
        ctx._mutatorItemRainTimer = 0;
        const p = ctx.arena.randomGroundPoint?.(8);
        if (p) ctx.arena.dropRandomItem(ctx.time);
      }
    },
    revert(ctx) {
      ctx._mutatorItemRainTimer = 0;
    },
  },
  {
    id: 'powerUpParty',
    name: 'POWER-UP PARTY',
    blurb: 'Power-ups spawn every 4 seconds — grab them all!',
    color: 0x3fa9ff,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutatorPowerUpTimer = 0;
    },
    tick(ctx, dt) {
      if (!ctx.match?.running) return;
      ctx._mutatorPowerUpTimer = (ctx._mutatorPowerUpTimer || 0) + dt;
      if (ctx._mutatorPowerUpTimer >= 4) {
        ctx._mutatorPowerUpTimer = 0;
        ctx.arena.spawnPowerUp?.();
      }
    },
    revert(ctx) {
      ctx._mutatorPowerUpTimer = 0;
    },
  },
  {
    id: 'sugarRush',
    name: 'SUGAR RUSH',
    blurb: 'Move speed ×1.35 — everything is faster!',
    color: 0xff6fb5,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      for (const d of ctx.dweebs) {
        d._mutatorOrigMove = d.stats?.move;
        if (d.stats?.move) d.stats.move *= 1.35;
        d._mutatorOrigSlide = d.slide;
        d.slide = (d.slide || 1) * 1.2;
      }
    },
    revert(ctx) {
      for (const d of ctx.dweebs) {
        if (d._mutatorOrigMove != null && d.stats) d.stats.move = d._mutatorOrigMove;
        if (d._mutatorOrigSlide != null) d.slide = d._mutatorOrigSlide;
        d._mutatorOrigMove = d._mutatorOrigSlide = null;
      }
    },
  },
  {
    id: 'bouncy',
    name: 'BOUNCY',
    blurb: 'Jump height ×1.5 — reach for the stars!',
    color: 0x5ee06a,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      for (const d of ctx.dweebs) {
        d._mutatorOrigJump = d.jumpScale;
        d.jumpScale = (d.jumpScale || 1) * 1.5;
      }
    },
    revert(ctx) {
      for (const d of ctx.dweebs) {
        if (d._mutatorOrigJump != null) d.jumpScale = d._mutatorOrigJump;
        d._mutatorOrigJump = null;
      }
    },
  },
  {
    id: 'melonStorm',
    name: 'MELON STORM',
    blurb: 'Exploding melons rain down near brawlers every 5s (max 6)',
    color: 0xff4d5e,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutatorMelonTimer = 0;
      ctx._mutatorMelonCount = 0;
    },
    tick(ctx, dt) {
      if (!ctx.match?.running) return;
      if (ctx._mutatorMelonCount >= 6) return;
      ctx._mutatorMelonTimer = (ctx._mutatorMelonTimer || 0) + dt;
      if (ctx._mutatorMelonTimer >= 5) {
        ctx._mutatorMelonTimer = 0;
        const alive = ctx.dweebs.filter(d => d.active && !d.eliminated);
        if (!alive.length) return;
        const target = alive[Math.floor(Math.random() * alive.length)];
        const pos = target.getPosition();
        // Lands near (not on) someone: a warning shadow-and-whistle beat, then chaos.
        const spawnPos = { x: pos.x + (Math.random() - 0.5) * 4, z: pos.z + (Math.random() - 0.5) * 4 };
        ctx.arena.spawnItem('explodingMelon', { x: spawnPos.x, y: 12, z: spawnPos.z });
        ctx._mutatorMelonCount++;
      }
    },
    revert(ctx) {
      ctx._mutatorMelonTimer = 0;
      ctx._mutatorMelonCount = 0;
    },
  },
  {
    id: 'turboChaos',
    name: 'TURBO CHAOS',
    blurb: 'Speed ×1.25, jump ×1.3, gravity 0.7 — pure mayhem!',
    color: 0xff8a3c,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutGravPrev = ctx.physics.gravityScale ?? 1;
      ctx.physics.setGravityScale(ctx._mutGravPrev * 0.7);
      for (const d of ctx.dweebs) {
        d._mutatorOrigGravity = d.gravityScale;
        d._mutatorOrigJump = d.jumpScale;
        d.jumpScale = (d.jumpScale || 1) * 1.3;
        d._mutatorOrigMove = d.stats?.move;
        if (d.stats?.move) d.stats.move *= 1.25;
        d._mutatorOrigSlide = d.slide;
        d.slide = (d.slide || 1) * 1.15;
      }
    },
    revert(ctx) {
      ctx.physics.setGravityScale(ctx._mutGravPrev ?? 1);
      for (const d of ctx.dweebs) {
        if (d._mutatorOrigGravity != null) d.gravityScale = d._mutatorOrigGravity;
        if (d._mutatorOrigJump != null) d.jumpScale = d._mutatorOrigJump;
        if (d._mutatorOrigMove != null && d.stats) d.stats.move = d._mutatorOrigMove;
        if (d._mutatorOrigSlide != null) d.slide = d._mutatorOrigSlide;
        d._mutatorOrigGravity = d._mutatorOrigJump = d._mutatorOrigMove = d._mutatorOrigSlide = null;
      }
    },
  },
  {
    id: 'slowMoMoon',
    name: 'SLOW-MO MOON',
    blurb: 'Low gravity + slow motion feel — graceful chaos',
    color: 0xb56cff,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutGravPrev = ctx.physics.gravityScale ?? 1;
      ctx.physics.setGravityScale(ctx._mutGravPrev * 0.4);
      for (const d of ctx.dweebs) {
        d._mutatorOrigGravity = d.gravityScale;
        d._mutatorOrigJump = d.jumpScale;
        d.jumpScale = 1.4;
        d._mutatorOrigMove = d.stats?.move;
        if (d.stats?.move) d.stats.move *= 0.85;
      }
    },
    revert(ctx) {
      ctx.physics.setGravityScale(ctx._mutGravPrev ?? 1);
      for (const d of ctx.dweebs) {
        if (d._mutatorOrigGravity != null) d.gravityScale = d._mutatorOrigGravity;
        if (d._mutatorOrigJump != null) d.jumpScale = d._mutatorOrigJump;
        if (d._mutatorOrigMove != null && d.stats) d.stats.move = d._mutatorOrigMove;
        d._mutatorOrigGravity = d._mutatorOrigJump = d._mutatorOrigMove = null;
      }
    },
  },
  {
    id: 'pinataNight',
    name: 'PIÑATA NIGHT',
    blurb: 'Piñatas spawn every 6s — smash them for loot!',
    color: 0xff9a3c,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutatorPinataTimer = 0;
    },
    tick(ctx, dt) {
      if (!ctx.match?.running) return;
      ctx._mutatorPinataTimer = (ctx._mutatorPinataTimer || 0) + dt;
      if (ctx._mutatorPinataTimer >= 6) {
        ctx._mutatorPinataTimer = 0;
        const p = ctx.arena.randomGroundPoint?.(8);
        if (p) ctx.arena.spawnItem('pinata', { x: p.x, y: 14, z: p.z });
      }
    },
    revert(ctx) {
      ctx._mutatorPinataTimer = 0;
    },
  },
  {
    id: 'windyDay',
    name: 'WINDY DAY',
    blurb: 'Constant gusts push everyone sideways — hold on!',
    color: 0x3fa9ff,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      ctx._mutatorWindDir = Math.random() < 0.5 ? 1 : -1;
      ctx._mutatorWindTimer = 0;
    },
    tick(ctx, dt) {
      if (!ctx.match?.running) return;
      ctx._mutatorWindTimer = (ctx._mutatorWindTimer || 0) + dt;
      // Shift wind direction every 8 seconds
      if (ctx._mutatorWindTimer >= 8) {
        ctx._mutatorWindTimer = 0;
        ctx._mutatorWindDir *= -1;
      }
      const force = 3.5 * ctx._mutatorWindDir;
      for (const d of ctx.dweebs) {
        if (!d.active || d.eliminated || d.grabbedBy) continue;
        const v = d.body?.linvel?.();
        if (v) {
          d.body.setLinvel({ x: v.x + force * dt * (d.grounded ? 0.3 : 1), y: v.y, z: v.z }, true);
        }
      }
      // Also push items
      for (const obj of ctx.arena.objects) {
        if (obj.isDebris || obj.isGrabbed || !obj.body) continue;
        const m = obj.body.mass?.() ?? 1;
        ctx.physics.applyImpulse(obj.body, { x: force * dt * m * 0.5, y: 0, z: 0 });
      }
    },
    revert(ctx) {
      ctx._mutatorWindDir = 0;
      ctx._mutatorWindTimer = 0;
    },
  },
  {
    id: 'superBouncy',
    name: 'SUPER BOUNCY',
    blurb: 'Everything bounces — floor, walls, dweebs, items!',
    color: 0x5ee06a,
    modes: ['derby', 'brawl', 'walldrop'],
    apply(ctx) {
      // Increase restitution feel via jumpScale and slide
      for (const d of ctx.dweebs) {
        d._mutatorOrigJump = d.jumpScale;
        d.jumpScale = (d.jumpScale || 1) * 1.8;
        d._mutatorOrigSlide = d.slide;
        d.slide = (d.slide || 1) * 1.4;
        d._mutatorOrigTraction = d.traction;
        d.traction = (d.traction || 1) * 0.5;
      }
    },
    revert(ctx) {
      for (const d of ctx.dweebs) {
        if (d._mutatorOrigJump != null) d.jumpScale = d._mutatorOrigJump;
        if (d._mutatorOrigSlide != null) d.slide = d._mutatorOrigSlide;
        if (d._mutatorOrigTraction != null) d.traction = d._mutatorOrigTraction;
        d._mutatorOrigJump = d._mutatorOrigSlide = d._mutatorOrigTraction = null;
      }
    },
  },
];

export class MutatorDirector {
  constructor() {
    this._active = null;
    this._prevId = null;
  }

  /**
   * Pick a mutator for the given mode.
   * 35% chance of no mutator.
   * Never repeats the previous round's mutator.
   */
  pick(modeId, rng = Math.random) {
    // 35% chance of no mutator
    if (rng() < 0.35) {
      this._prevId = null;
      return null;
    }

    // Filter mutators valid for this mode
    const valid = MUTATORS.filter(m => m.modes === null || m.modes.includes(modeId));
    if (!valid.length) return null;

    // Filter out the previous mutator
    const filtered = this._prevId ? valid.filter(m => m.id !== this._prevId) : valid;
    const pool = filtered.length ? filtered : valid;

    const idx = Math.floor(rng() * pool.length);
    const def = pool[idx];
    this._prevId = def.id;
    return def;
  }

  /**
   * Begin a mutator — call its apply(ctx).
   */
  begin(def, ctx) {
    if (!def) return;
    this._active = def;
    try {
      if (def.apply) def.apply(ctx);
    } catch (e) {
      console.error('[Mutator] apply error:', e);
      this._active = null;
    }
  }

  /**
   * Tick the active mutator — call its tick(ctx, dt) if it has one.
   */
  update(dt, ctx) {
    if (!this._active) return;
    if (!this._active.tick) return;
    try {
      this._active.tick(ctx, dt);
    } catch (e) {
      console.error('[Mutator] tick error:', e);
    }
  }

  /**
   * End the active mutator — call its revert(ctx).
   */
  end(ctx) {
    if (!this._active) return;
    try {
      if (this._active.revert) this._active.revert(ctx);
    } catch (e) {
      console.error('[Mutator] revert error:', e);
    }
    this._active = null;
  }

  get active() {
    return this._active;
  }
}