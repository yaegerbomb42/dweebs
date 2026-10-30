// archaeology.js — dig sites that yield relics and gold.
//
// Three ancient dig sites dot the meadow. Archaeologist citizens dig at them;
// each dig takes time and yields gold or a rare relic (cosmetic hat).

export const DIG_SITES = [
  { id: 'north', x: -15, z: -25 },
  { id: 'east', x: 25, z: 10 },
  { id: 'west', x: -25, z: 20 },
];

export const RELICS = ['🦖 Dino Skull', '🏺 Ancient Vase', '⚱️ Golden Urn', '🗿 Tiny Idol', '👑 Rusty Crown'];

export class ArchaeologyManager {
  constructor() {
    this.sites = DIG_SITES.map(s => ({ ...s, progress: 0, digs: 0 }));
  }

  /**
   * Dig at a site. Returns loot when the dig completes.
   * @param {string} siteId
   * @param {number} amount dig progress (0-1)
   * @param {function} rng
   * @returns {object|null} loot {gold, relic} or null if not complete
   */
  dig(siteId, amount = 0.34, rng = Math.random) {
    const site = this.sites.find(s => s.id === siteId);
    if (!site) return null;
    site.progress += amount;
    if (site.progress < 1) return null;
    site.progress = 0;
    site.digs++;
    const loot = { gold: 5 + Math.floor(rng() * 10), relic: null };
    if (rng() < 0.25) {
      loot.relic = RELICS[Math.floor(rng() * RELICS.length)];
    }
    return loot;
  }

  /** The site nearest to (x, z). */
  nearestSite(x, z) {
    let best = null, bestD = Infinity;
    for (const s of this.sites) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }
}
