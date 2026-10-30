/**
 * Critter taming: feed a wandering critter 3 berries (G when close) and it becomes a pet.
 * Pets get a name and a trait, stop being hostile (towers/cannons/citizens ignore them),
 * trot after you with a happy bounce, and now and then bring you a little gift.
 * Up to 3 pets; they persist in localStorage and re-hatch next time you visit.
 */
const KEY = 'dweebs.pets.v1';
const NAMES = ['Pudding', 'Gizmo', 'Noodle', 'Biscuit', 'Waffles', 'Pickle', 'Sprocket', 'Muffin', 'Tater', 'Beans', 'Zippy', 'Crumb'];
const TRAITS = [
  { id: 'forager', label: 'Forager', gift: 'berries', n: 2, every: 35 },
  { id: 'hoarder', label: 'Hoarder', gift: 'gold', n: 1, every: 70 },
  { id: 'lumberjack', label: 'Lumberjack', gift: 'wood', n: 2, every: 40 },
  { id: 'rockhound', label: 'Rockhound', gift: 'stone', n: 1, every: 40 },
];
export const MAX_PETS = 3, TAME_COST = 3, TAME_RANGE = 2.6;

export class PetPen {
  constructor({ world, colony, hud, audio = null }) {
    this.world = world; this.colony = colony; this.hud = hud; this.audio = audio;
    this.pets = [];
    this._promptCd = 0;
    this._restore();
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.pets.map(p => ({ kind: p.kind, name: p.name, trait: p.trait.id })))); } catch { /* full */ }
  }

  _restore() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { saved = []; }
    for (const s of saved.slice(0, MAX_PETS)) {
      const c = this.world.spawnCritter?.(s.kind || 'mischief');
      if (!c) continue;
      c.x = (Math.random() - 0.5) * 6; c.z = (Math.random() - 0.5) * 6;
      this._adopt(c, s.name, TRAITS.find(t => t.id === s.trait), true);
    }
  }

  /** Nearest wild critter within range of p, or null. */
  nearestWild(p) {
    let best = null, bd = TAME_RANGE;
    for (const c of this.world.critters || []) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _adopt(c, name, trait, quiet = false) {
    const i = this.world.critters.indexOf(c);
    if (i !== -1) this.world.critters.splice(i, 1); // leave the mesh in the world group
    c.hostile = false; c.state = 'pet'; c.chewTarget = null;
    const pet = { c, kind: c.kind, name: name || NAMES[Math.floor(Math.random() * NAMES.length)],
      trait: trait || TRAITS[Math.floor(Math.random() * TRAITS.length)], giftT: 10 + Math.random() * 20,
      slot: this.pets.length, hop: Math.random() * 6 };
    this.pets.push(pet);
    if (!quiet) {
      this.hud?.announce?.(`NEW PET: ${pet.name.toUpperCase()}!`, `${pet.trait.label} ${c.kind}`, 1.8);
      this.colony?._addLog?.(`🐾 ${pet.name} the ${pet.trait.label} ${c.kind} joined your family!`);
      this.audio?.playDiscovery?.();
      this._save();
    }
    return pet;
  }

  /** G pressed: try to tame the nearest critter. Returns a status string. */
  tryTame(player) {
    if (!player) return 'none';
    const p = player.getPosition();
    const c = this.nearestWild(p);
    if (!c) return 'none';
    if (this.pets.length >= MAX_PETS) { this.hud?.popup?.('PET PEN FULL (3)', c.mesh?.position ?? p, 'small', 0xffd23f); return 'full'; }
    if ((this.colony?.resources?.berries || 0) < TAME_COST) { this.hud?.popup?.(`NEED ${TAME_COST} 🍓`, c.mesh?.position ?? p, 'small', 0xff8fc0); return 'poor'; }
    this.colony.resources.berries -= TAME_COST;
    this.hud?.popup?.('💕 TAMED!', c.mesh?.position ?? p, 'big', 0xff8fc0);
    this._adopt(c);
    return 'tamed';
  }

  update(dt, player) {
    const p = player?.active ? player.getPosition() : null;
    const clock = this.world.clock || 0;
    for (const pet of this.pets) {
      const c = pet.c;
      if (p) {
        // Trail behind in a little fan; trot faster when far
        const ang = (player.yaw ?? 0) + Math.PI + (pet.slot - 1) * 0.6;
        const tx = p.x + Math.sin(ang) * 2.2, tz = p.z + Math.cos(ang) * 2.2;
        const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
        if (dist > 0.3) {
          const sp = Math.min(dist * 2.5, dist > 12 ? 14 : 6.5);
          c.x += (dx / dist) * sp * dt; c.z += (dz / dist) * sp * dt;
          pet.hop += dt * 12;
        } else pet.hop += dt * 3;
        if (dist > 40) { c.x = tx; c.z = tz; } // teleport-catch-up
      }
      const g = this.world._getHeight?.(c.x, c.z) ?? 0;
      c.y = g;
      if (c.mesh) {
        c.mesh.position.set(c.x, g + (c.hover || 0.7) + Math.abs(Math.sin(pet.hop)) * 0.35, c.z);
        if (p) c.mesh.rotation.y = Math.atan2(p.x - c.x, p.z - c.z);
      }
      pet.giftT -= dt;
      if (pet.giftT <= 0) {
        pet.giftT = pet.trait.every * (0.8 + Math.random() * 0.4);
        this.colony?.addResource?.(pet.trait.gift, pet.trait.n);
        this.hud?.popup?.(`${pet.name} brought +${pet.trait.n} ${pet.trait.gift}!`, c.mesh?.position ?? { x: c.x, y: g + 1.5, z: c.z }, 'small', 0x5ee06a);
      }
    }
    // Hint when a wild critter is close enough to befriend
    this._promptCd -= dt;
    if (p && this._promptCd <= 0 && this.pets.length < MAX_PETS) {
      const c = this.nearestWild(p);
      if (c && c.mesh) { this.hud?.popup?.(`[G] Feed ${TAME_COST} 🍓 to tame`, c.mesh.position, 'small', 0xffffff); this._promptCd = 5; }
    }
  }

  dispose() {
    this._save();
    for (const pet of this.pets) if (pet.c.mesh) this.world.group?.remove(pet.c.mesh);
    this.pets = [];
  }
}
