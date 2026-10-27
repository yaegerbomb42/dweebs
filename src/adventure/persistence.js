// persistence.js — Automatic save/load of village state (Expedition & Dynasty)
//
// The village (colony population, built structures, gathered resources, vault
// progress, time of day) is saved to localStorage so a session picks up where
// the last one ended. Storage is injected so headless tests can pass a fake.
//
// Save shape (versioned, so old saves can be rejected cleanly):
//   { version: 1, savedAt: ISO string,
//     colony: Colony.serialize(), structures: [ {id,x,y,z,stored?,hp?} ],
//     world: Meadowlands.serialize() }

export const SAVE_KEY = 'dweebs-village-v1';
export const SAVE_VERSION = 1;

function defaultStorage() {
  return typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
}

/** Serialize the live village and write it to storage. */
export function saveVillage({ colony, buildingManager, world }, storage = defaultStorage()) {
  if (!storage || typeof storage.setItem !== 'function') {
    return { ok: false, reason: 'no-storage' };
  }
  const data = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    colony: colony ? colony.serialize() : null,
    structures: buildingManager
      ? buildingManager.placedStructures.map(s => (typeof s.serialize === 'function' ? s.serialize() : { id: s.id, x: s.pos.x, y: s.pos.y, z: s.pos.z }))
      : [],
    world: world && typeof world.serialize === 'function' ? world.serialize() : null,
  };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return { ok: true, savedAt: data.savedAt };
  } catch (err) {
    return { ok: false, reason: String(err && err.message ? err.message : err) };
  }
}

/** Read the saved village, or null when there is none / it is unusable. */
export function loadVillage(storage = defaultStorage()) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  let raw;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.version !== SAVE_VERSION) return null;
  return data;
}

/** Remove the saved village. */
export function clearSave(storage = defaultStorage()) {
  if (!storage || typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a loaded save to a freshly built village.
 * Citizens must already exist on the colony (added from the spawned Dweebs);
 * they are matched to saved citizens by index.
 * Returns a summary of what was restored.
 */
export function applySave(save, { colony, buildingManager, world }) {
  const summary = { citizens: 0, structures: 0, gold: 0 };
  if (!save) return summary;
  if (colony && save.colony) {
    colony.restore(save.colony);
    summary.citizens = colony.citizens.length;
    summary.gold = colony.resources.gold || 0;
  }
  if (buildingManager && Array.isArray(save.structures)) {
    for (const data of save.structures) {
      const s = buildingManager.placeSaved(data, world, colony);
      if (s) summary.structures += 1;
    }
  }
  if (world && save.world && typeof world.restore === 'function') {
    world.restore(save.world);
  }
  return summary;
}
