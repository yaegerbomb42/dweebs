import * as THREE from 'three';

/**
 * Meadowlands Quest Board: a few toy NPCs around the campfire who hand out rotating
 * quests, plus hidden Moss Tablets (secrets) that fill a little journal. Everything is
 * driven by polling colony/world state each tick (diffs), so no other system needs hooks.
 * Progress persists in localStorage separately from the village save.
 */
const SAVE_KEY = 'dweebs.quests.v1';

export const NPC_DEFS = [
  { id: 'gramble', name: 'Old Gramble', color: 0xb48b5a, hat: 0x3d6b35, x: 4.5, z: 3.5,
    idle: ['Back in my day the islands were flat!', 'Got a job for ya, sprout.', 'Mind the critters after dark.'] },
  { id: 'pip', name: 'Pip the Tinker', color: 0x6fb8ff, hat: 0xffd23f, x: -5, z: 2.5,
    idle: ['Gears! Springs! More springs!', 'I could build anything with enough wood.', 'Bring me stone, I make wonders.'] },
  { id: 'moss', name: 'Sister Moss', color: 0x8fd18a, hat: 0x5b2a86, x: 0.5, z: -6,
    idle: ['The old tablets hum at night…', 'The vaults remember who opened them.', 'Listen to the grass, little one.'] },
];

/** Each quest: who gives it, a goal measured against a stat snapshot, and a reward. */
export const QUEST_DEFS = [
  { id: 'wood6', npc: 'gramble', text: 'Stack up 6 wood for the winter pile', stat: 'woodGained', goal: 6, reward: { berries: 6 } },
  { id: 'stone5', npc: 'pip', text: 'Haul 5 stone to my workshop', stat: 'stoneGained', goal: 5, reward: { wood: 6 } },
  { id: 'build1', npc: 'pip', text: 'Raise any new structure', stat: 'built', goal: 1, reward: { stone: 4 }, unlock: 'cannon' },
  { id: 'vault1', npc: 'moss', text: 'Open an ancient vault', stat: 'vaults', goal: 1, reward: { gold: 3 } },
  { id: 'tablet2', npc: 'moss', text: 'Find 2 hidden Moss Tablets', stat: 'tablets', goal: 2, reward: { gold: 2 } },
  { id: 'critter3', npc: 'gramble', text: 'Shoo away 3 critters', stat: 'critters', goal: 3, reward: { berries: 8 } },
  { id: 'berries10', npc: 'gramble', text: 'Gather 10 berries for the feast', stat: 'berriesGained', goal: 10, reward: { wood: 4, stone: 2 } },
  { id: 'build3', npc: 'pip', text: 'Build 3 more structures', stat: 'built', goal: 3, reward: { gold: 4 } },
  { id: 'tablet5', npc: 'moss', text: 'Find all 5 Moss Tablets', stat: 'tablets', goal: 5, reward: { gold: 8 }, unlock: 'ziptower' },
];

export const TABLET_DEFS = [
  { id: 't1', x: 22, z: -18, lore: 'Tablet I: "Before the islands floated, the Dweebs dug."' },
  { id: 't2', x: -26, z: 14, lore: 'Tablet II: "The first throw was a berry. It hit the moon."' },
  { id: 't3', x: 8, z: 30, lore: 'Tablet III: "Never trust a critter with a bow tie."' },
  { id: 't4', x: -18, z: -28, lore: 'Tablet IV: "The vaults hold toys, and the toys hold secrets."' },
  { id: 't5', x: 34, z: 8, lore: 'Tablet V: "When all five hum, the meadow sings." 🎶' },
];

const TALK_R = 3.2, TABLET_R = 1.8;

export class QuestBoard {
  constructor({ world, colony, hud, audio = null, buildingManager = null }) {
    this.world = world; this.colony = colony; this.hud = hud; this.audio = audio;
    this.bm = buildingManager;
    this.group = new THREE.Group();
    world.group?.add(this.group);
    this.stats = { woodGained: 0, stoneGained: 0, berriesGained: 0, built: 0, vaults: 0, tablets: 0, critters: 0 };
    this.done = new Set();
    this.active = new Map();    // npcId -> { id, base }
    this.found = new Set();     // tablet ids
    this.journal = [];
    this.npcs = [];
    this.tablets = [];
    this._prev = null;
    this._talkCd = new Map();
    this._t = 0;
    this._load();
    this._buildNpcs();
    this._buildTablets();
    // Count critter defeats by wrapping the world's remover (instance-only, undone in dispose).
    if (typeof world.removeCritter === 'function') {
      const orig = world.removeCritter;
      this._origRemove = orig;
      world.removeCritter = (c) => { if (c?.hostile !== false && c?.kind !== 'beetle') this.stats.critters++; return orig.call(world, c); };
    }
    for (const def of NPC_DEFS) this._offer(def.id);
  }

  _ground(x, z) { try { return this.world._getHeight?.(x, z) ?? 0; } catch { return 0; } }

  _buildNpcs() {
    for (const def of NPC_DEFS) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.6, 4, 10), new THREE.MeshToonMaterial({ color: def.color }));
      body.position.y = 0.75;
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 10), new THREE.MeshToonMaterial({ color: def.hat }));
      hat.position.y = 1.65;
      const eyeM = new THREE.MeshBasicMaterial({ color: 0x1b1030 });
      for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), eyeM); e.position.set(s * 0.16, 1.1, 0.4); g.add(e); }
      // Floating "!" marker when a quest is ready
      const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      mark.position.y = 2.4;
      g.add(body, hat, mark);
      g.position.set(def.x, this._ground(def.x, def.z), def.z);
      g.rotation.y = Math.atan2(-def.x, -def.z);
      this.group.add(g);
      this.npcs.push({ def, g, mark, bob: Math.random() * 6 });
    }
  }

  _buildTablets() {
    for (const def of TABLET_DEFS) {
      if (this.found.has(def.id)) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.18),
        new THREE.MeshToonMaterial({ color: 0x5f8f4e, emissive: 0x2f7a3a, emissiveIntensity: 0.6 }));
      m.position.set(def.x, this._ground(def.x, def.z) + 0.6, def.z);
      this.group.add(m);
      this.tablets.push({ def, m });
    }
  }

  _offer(npcId) {
    if (this.active.has(npcId)) return;
    const q = QUEST_DEFS.find(q => q.npc === npcId && !this.done.has(q.id));
    if (q) this.active.set(npcId, { id: q.id, base: this.stats[q.stat] });
  }

  _snapshot() {
    const r = this.colony?.resources || {};
    return {
      wood: r.wood || 0, stone: r.stone || 0, berries: r.berries || 0,
      built: this.bm?.placedStructures?.length ?? this.world.buildingManager?.placedStructures?.length ?? 0,
      vaults: (this.world.ruins || []).filter(x => x.opened).length,
    };
  }

  progress(npcId) {
    const a = this.active.get(npcId); if (!a) return null;
    const q = QUEST_DEFS.find(d => d.id === a.id);
    // Tablet/vault quests measure the total, the rest measure gains since accepting
    const total = q.stat === 'tablets' || q.stat === 'vaults';
    const have = total ? this.stats[q.stat] : this.stats[q.stat] - a.base;
    return { q, have: Math.min(q.goal, Math.max(0, have)) };
  }

  update(dt, player) {
    if (!player) return;
    this._t += dt;
    const s = this._snapshot();
    if (this._prev) {
      for (const k of ['wood', 'stone', 'berries']) {
        const d = s[k] - this._prev[k];
        if (d > 0) this.stats[k + 'Gained'] += d;
      }
      if (s.built > this._prev.built) this.stats.built += s.built - this._prev.built;
    }
    this.stats.vaults = Math.max(this.stats.vaults, s.vaults);
    this._prev = s;

    const p = player.getPosition();
    for (const n of this.npcs) {
      n.bob += dt * 2.2;
      n.g.position.y = (this._ground(n.def.x, n.def.z) + Math.abs(Math.sin(n.bob)) * 0.06);
      const pr = this.progress(n.def.id);
      n.mark.visible = !!pr;
      if (pr) { n.mark.rotation.y += dt * 2; n.mark.material.color.setHex(pr.have >= pr.q.goal ? 0x5ee06a : 0xffd23f); }
      const dist = Math.hypot(p.x - n.def.x, p.z - n.def.z);
      if (dist < TALK_R && (this._talkCd.get(n.def.id) ?? 0) <= this._t) {
        this._talkCd.set(n.def.id, this._t + 6);
        this._talk(n, pr);
      }
      if (pr && pr.have >= pr.q.goal && dist < TALK_R) this._complete(n, pr.q);
    }

    for (let i = this.tablets.length - 1; i >= 0; i--) {
      const t = this.tablets[i];
      t.m.rotation.y += dt * 0.8;
      t.m.material.emissiveIntensity = 0.45 + Math.sin(this._t * 3 + i) * 0.25;
      if (Math.hypot(p.x - t.def.x, p.z - t.def.z) < TABLET_R) {
        this.group.remove(t.m); t.m.geometry.dispose(); t.m.material.dispose();
        this.tablets.splice(i, 1);
        this.found.add(t.def.id);
        this.stats.tablets = this.found.size;
        this._journal(`📜 ${t.def.lore}`);
        this.hud?.announce?.(`MOSS TABLET ${this.found.size}/${TABLET_DEFS.length}`, '', 1.6);
        this.hud?.popup?.('SECRET!', t.m.position, 'big', 0x8fd18a);
        this.audio?.playDiscovery?.();
        this.world._pushStunt?.('secret', t.def.x, t.def.z);
        this._save();
      }
    }
  }

  _talk(n, pr) {
    let line;
    if (pr && pr.have >= pr.q.goal) line = 'You did it! Here, take this!';
    else if (pr) line = `${pr.q.text} (${pr.have}/${pr.q.goal})`;
    else line = n.def.idle[Math.floor(Math.random() * n.def.idle.length)];
    this.hud?.popup?.(`${n.def.name}: ${line}`, { x: n.def.x, y: n.g.position.y + 2.8, z: n.def.z }, 'small', 0xffffff);
    this.hud?.feed?.(`<b>${n.def.name}</b>: ${line}`);
  }

  _complete(n, q) {
    this.active.delete(n.def.id);
    this.done.add(q.id);
    const parts = [];
    for (const [res, amt] of Object.entries(q.reward || {})) {
      this.colony?.addResource?.(res, amt);
      parts.push(`+${amt} ${res}`);
    }
    if (q.unlock) { this.colony?.unlockBlueprint?.(q.unlock); parts.push(`blueprint: ${q.unlock}`); }
    this.colony?._addLog?.(`✅ Quest done for ${n.def.name}: ${q.text} (${parts.join(', ')})`);
    this._journal(`✅ ${q.text} — ${n.def.name}`);
    this.hud?.announce?.('QUEST COMPLETE!', parts.join(' · '), 1.8);
    this.audio?.playQuestComplete?.();
    this._offer(n.def.id);
    this._save();
  }

  _journal(entry) { this.journal.push(entry); if (this.journal.length > 30) this.journal.shift(); }

  /** One line for the objective banner: the nearest unfinished quest. */
  bannerText() {
    for (const n of this.npcs) {
      const pr = this.progress(n.def.id);
      if (pr) return `📋 ${n.def.name}: ${pr.q.text} (${pr.have}/${pr.q.goal})${pr.have >= pr.q.goal ? ' — go claim it!' : ''} · 📜 ${this.found.size}/${TABLET_DEFS.length}`;
    }
    return `📜 Moss Tablets ${this.found.size}/${TABLET_DEFS.length} · All quests done!`;
  }

  _save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        done: [...this.done], found: [...this.found], journal: this.journal, stats: this.stats,
        active: [...this.active.entries()],
      }));
    } catch { /* storage full / private mode */ }
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!d) return;
      this.done = new Set(d.done || []);
      this.found = new Set(d.found || []);
      this.journal = Array.isArray(d.journal) ? d.journal : [];
      if (d.stats) Object.assign(this.stats, d.stats);
      if (Array.isArray(d.active)) this.active = new Map(d.active);
    } catch { /* corrupt save: start fresh */ }
  }

  dispose() {
    this._save();
    if (this._origRemove) this.world.removeCritter = this._origRemove;
    this.group.parent?.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
