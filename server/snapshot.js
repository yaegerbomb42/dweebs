/** Convert simulation entities into the per-client wire representation. */
export function wireEntities(entities, forSlot = -1, withItems = true) {
  const out = [];
  for (const e of entities) {
    const isDweeb = e.kind === 'dweeb';
    if (!isDweeb && !withItems) continue;
    // SimAdapter already uses centimetres; MockSim uses metres.
    const cm = e._cm ? v => v : v => Math.round(v * 100);
    const own = isDweeb && e.slot === forSlot;
    out.push({
      id: e.id,
      x: cm(e.x), y: cm(e.y), z: cm(e.z),
      q: e.q ?? (Math.round((e.yaw / (Math.PI * 2)) * 255) & 255),
      // Bit 3 is reserved by the codec for velocity, not an item status bit.
      flags: ((e.flags ?? ((isDweeb ? 1 : 0) | (e.slot >= 0 ? 2 : 0))) & ~8) | (own ? 8 : 0),
      state: e.state & 255,
      vx: own ? cm(e.vx) : 0,
      vy: own ? cm(e.vy) : 0,
      vz: own ? cm(e.vz) : 0,
    });
  }
  return out;
}
