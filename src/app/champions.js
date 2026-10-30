// champions.js — cross-game champion import.
//
// Lets the player fight arena matches AS their saved Build-A-Dweeb creations.
// Reads the builder's save slots (localStorage `dweebs-build-slots-v1`) and
// converts a build config into an arena seat: name, fighter type, color, and
// stat modifiers derived from the build's own stats. DOM-free and storage-
// guarded so it runs in node tests.

export const CHAMPION_SLOTS_KEY = 'dweebs-build-slots-v1';

/** Builder body shape → arena fighter type. */
export const SHAPE_TO_TYPE = {
  blob: 'blob',
  cube: 'cube',
  spiky: 'spiky',
  star: 'starry',
  chonk: 'chonk',
  capsule: 'blink',
  pyramid: 'triclops',
  donut: 'gumball',
};

/** Baselines the builder stats are authored against (see DEFAULT_BUILD_CONFIG). */
const BASE_STATS = { mass: 3.0, speed: 1.0, jump: 1.0, armor: 1.0 };
const clampMod = v => Math.max(0.7, Math.min(1.4, v));

function readSlots() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(CHAMPION_SLOTS_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}

/**
 * List saved builder champions.
 * @returns {{slot:number,name:string,savedAt:number,config:object}[]}
 */
export function listChampions() {
  const slots = readSlots();
  const out = [];
  for (let i = 1; i <= 8; i++) {
    const entry = slots[i];
    if (entry?.config) {
      out.push({
        slot: i,
        name: entry.name || entry.config.name || 'Saved build',
        savedAt: entry.savedAt || 0,
        config: entry.config,
      });
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** '#ff4d5e' → 0xff4d5e (falls back to arena yellow). */
export function cssToHex(css) {
  if (typeof css === 'string') {
    const m = css.trim().match(/^#([0-9a-f]{6})$/i);
    if (m) return parseInt(m[1], 16);
  }
  return 0xffd23f;
}

/**
 * Convert a champion into an arena seat definition.
 * @returns {{name:string,type:string,color:number,statMods:object,tier:string}}
 */
export function championToArenaSeat(champ) {
  const config = champ?.config || {};
  const stats = config.stats || {};
  const shape = config.shape || 'blob';
  return {
    name: champ?.name || config.name || 'Champion',
    type: SHAPE_TO_TYPE[shape] || 'blob',
    color: cssToHex(config.primaryColor),
    statMods: {
      // Mass is authored around 3.0; the rest around 1.0.
      mass: clampMod((stats.mass ?? BASE_STATS.mass) / BASE_STATS.mass),
      move: clampMod(stats.speed ?? BASE_STATS.speed),
      jump: clampMod(stats.jump ?? BASE_STATS.jump),
      armor: clampMod(stats.armor ?? BASE_STATS.armor),
    },
  };
}

/**
 * Apply stat modifiers onto a base stat table (clone — never mutate shared).
 * @param {object} base e.g. TYPE_STATS[type]
 * @param {object} mods e.g. {mass, move, jump, armor}
 */
export function applyStatMods(base, mods = {}) {
  const out = { ...base };
  for (const key of ['mass', 'move', 'jump', 'armor', 'growthTaken', 'airAccel', 'escape', 'diveCd', 'diveDmg', 'hitDmg']) {
    if (typeof mods[key] === 'number' && typeof out[key] === 'number') {
      out[key] = out[key] * mods[key];
    }
  }
  return out;
}
