// disasters.js — weather disasters for Expedition & Dynasty.
//
// Rare, dramatic weather events with teeth: thunderstorms hurl lightning at
// structures, meteor showers crater the meadow but seed starmetal. Pure logic;
// the world supplies structure adapters and visual hooks through ctx, which
// keeps this fully testable.

export const DISASTER_TYPES = {
  storm: {
    id: 'storm', name: 'Thunderstorm', icon: '⛈️',
    duration: 25, strikeEvery: [3, 6], strikeDamage: 12, blastRadius: 0,
    blurb: 'Lightning seeks the tallest roofs!',
  },
  meteor: {
    id: 'meteor', name: 'Meteor Shower', icon: '☄️',
    duration: 30, strikeEvery: [4, 7], strikeDamage: 15, blastRadius: 4,
    starmetal: [2, 4],
    blurb: 'The sky is falling — grab the starmetal!',
  },
};

const DISASTER_IDS = Object.keys(DISASTER_TYPES);

export class DisasterManager {
  /**
   * @param {object} opts
   * @param {() => number} opts.rng random source (injectable for tests)
   */
  constructor(opts = {}) {
    this.rng = opts.rng ?? Math.random;
    this.active = null; // {type, timeLeft, strikeTimer}
    this.disastersSeen = 0;
  }

  get isActive() { return this.active !== null; }

  /** Begin a specific disaster (or a random one). Returns the type. */
  start(id, ctx) {
    const type = DISASTER_TYPES[id] ?? DISASTER_TYPES[DISASTER_IDS[Math.floor(this.rng() * DISASTER_IDS.length)]];
    this.active = { type, timeLeft: type.duration, strikeTimer: 1.5 };
    this.disastersSeen++;
    ctx.onEvent?.({ type: 'disasterStart', disaster: type.id });
    ctx.colony?._addLog(`${type.icon} ${type.name}! ${type.blurb}`);
    return type;
  }

  /**
   * @param {number} dt seconds
   * @param {object} ctx
   * @param {object} ctx.colony
   * @param {() => object[]} ctx.structures live structures {x,z,hp,label}
   * @param {(s, n) => void} ctx.damageStructure
   * @param {(x, z) => void} ctx.onStrike visual hook (flash / fireball)
   * @param {(e) => void} ctx.onEvent
   */
  update(dt, ctx) {
    if (!this.active) return;
    const d = this.active;
    d.timeLeft -= dt;
    if (d.timeLeft <= 0) {
      ctx.onEvent?.({ type: 'disasterEnd', disaster: d.type.id });
      ctx.colony?._addLog(`${d.type.icon} The ${d.type.name.toLowerCase()} passes. The village takes stock.`);
      this.active = null;
      return;
    }
    d.strikeTimer -= dt;
    if (d.strikeTimer > 0) return;
    const [lo, hi] = d.type.strikeEvery;
    d.strikeTimer = lo + this.rng() * (hi - lo);
    this._strike(ctx, d.type);
  }

  _strike(ctx, type) {
    const structs = ctx.structures();
    // Lightning aims at structures; meteors fall anywhere in the meadow.
    let x, z, target = null;
    if (type.id === 'storm' && structs.length > 0) {
      target = structs[Math.floor(this.rng() * structs.length)];
      x = target.x; z = target.z;
    } else {
      const a = this.rng() * Math.PI * 2;
      const r = 8 + this.rng() * 25;
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    ctx.onStrike?.(x, z, type.id);
    // Blast damage.
    let hitAny = false;
    for (const s of structs) {
      if ((s.hp ?? 1) <= 0) continue;
      if (Math.hypot(s.x - x, s.z - z) <= type.blastRadius + 0.5) {
        ctx.damageStructure(s, type.strikeDamage);
        hitAny = true;
        ctx.onEvent?.({ type: 'disasterHit', disaster: type.id, structure: s.label });
        if ((s.hp ?? 1) <= 0) {
          ctx.colony?._addLog(`${type.icon} The ${s.label} was destroyed by the ${type.name.toLowerCase()}!`);
        }
      }
    }
    if (type.id === 'meteor') {
      const [lo, hi] = type.starmetal;
      const n = lo + Math.floor(this.rng() * (hi - lo + 1));
      if (typeof ctx.colony?.addResource === 'function') ctx.colony.addResource('starmetal', n);
      else if (ctx.colony) ctx.colony.resources.starmetal = (ctx.colony.resources.starmetal || 0) + n;
      ctx.colony?._addLog(`${type.icon} A meteor crashed nearby! +${n} starmetal${hitAny ? ' (and a crushed roof)' : ''}.`);
    } else if (!hitAny) {
      ctx.colony?._addLog(`${type.icon} Lightning splits a tree at the meadow's edge!`);
    }
  }

  serialize() {
    return {
      active: this.active ? this.active.type.id : null,
      timeLeft: this.active?.timeLeft ?? 0,
      disastersSeen: this.disastersSeen,
    };
  }
}
