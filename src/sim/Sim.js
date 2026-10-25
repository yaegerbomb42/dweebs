// The step order is fixed and load-bearing, and it mirrors the order the live main.js loop used:
//   1. input → dweeb.preStep (the state machine reads input and writes velocity)
//   2. physics.step (Rapier integrates, one fixed 1/60 tick)
//   3. dweeb.sync (read positions back, detect grounded)
//   4. arena.step (turntable, drop timer)
//   5. combat resolution (swings, item contacts, hazards)
//   6. match rules (stocks, blast zones, rounds, sudden death)
//   7. events drained
//
// Every one of those is a pure function of (state, inputs, rng). No wall-clock time, no frame
// rate, no rendering. That is the entire determinism argument, and tools/headless-match.mjs
// demonstrates it by running the same match twice and comparing checksums.

import {
  TICK_DT, TICK_HZ, CONTRACTS_VERSION, DEFAULT_CONFIG, IdAllocator,
} from './contracts.js';
import { RngStreams } from './rng.js';
import { FixedStepClock } from './accumulator.js';
import { EventQueue } from './events.js';
import { SimPhysics } from './physics.js';
import { SimArena, STAGE_RADIUS, WATER_LEVEL } from './arena.js';
import { SimDweeb } from './dweeb.js';
import { SimCombat } from './combat.js';
import { SimMatch, Phase } from './match.js';
import { Bot } from './bot.js';
import { checksumOf } from './checksum.js';
import { itemDef, ITEM_KIND_IDS, POWERUP_KEYS } from './tables.js';

const SNAPSHOT_VERSION = 1;
// Where KO'd bodies wait: far below the lagoon, out of every collision group in play.
const KO_PARK_X = 0, KO_PARK_Y = -500, KO_PARK_Z = 0;

export class Sim {
  /** @param {import('./contracts.js').SimConfig} [config] */
  constructor(config = DEFAULT_CONFIG) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.version = `sim/${CONTRACTS_VERSION}`;
    this.tick = 0;
    this.time = 0;

    this.rng = new RngStreams(this.config.seed);
    this.clock = new FixedStepClock();
    this.events = new EventQueue();
    this.ids = new IdAllocator();

    /** @type {SimPhysics|null} */ this.physics = null;
    /** @type {(SimDweeb|undefined)[]} */ this.dweebs = [];
    /** @type {SimArena|null} */ this.arena = null;
    /** @type {SimCombat|null} */ this.combat = null;
    /** @type {SimMatch|null} */ this.match = null;
    /** @type {(Bot|undefined)[]} */ this.bots = [];
    /** @type {object[]} */ this.items = [];
    /** @type {string[]} item key per item id, index 0 = id 1 */
    this.itemKeys = [];
    this.powerupTimer = 0;
    this.highlight = { launch: 0, id: 0, by: 0 };
  }

  /** Build the world. Await exactly once before adding seats or stepping. */
  async init() {
    this.physics = await SimPhysics.create();
    this.arena = new SimArena(this.physics, this.rng.stream('drops'));
    this.match = new SimMatch({ events: this.events, config: this.config });
    this.combat = new SimCombat({
      physics: this.physics,
      arena: this.arena,
      rng: this.rng.stream('combat'),
      itemKeys: this.itemKeys,
    });
    return this;
  }

  /**
   * Seat a player or a bot: creates the capsule and, for bots, the brain.
   * @param {object} seat { slot, name, type, color, isBot }
   * @returns {SimDweeb}
   */
  addSeat({ slot = 0, name = 'Dweeb', type = 'cube', color = 0xffd23f, isBot = false } = {}) {
    const id = this.ids.alloc();
    const d = new SimDweeb({ physics: this.physics, id, slot, name, type, color, isBot });
    d.stocks = this.config.stocks;
    this.dweebs[slot] = d;
    if (isBot) {
      this.bots[slot] = new Bot({ slot, difficulty: this.config.botDifficulty, rng: this.rng.stream('bot' + slot) });
    }
    return d;
  }

  /** Start the match: seat everyone, then begin round 1. */
  startMatch() {
    this.match.startMatch(this.dweebs.filter(Boolean));
    this.beginRound();
  }

  /** Reset the stage and the dweebs for a fresh round, then run the countdown. */
  beginRound() {
    const seated = this.dweebs.filter(Boolean);
    const spawnR = Math.min(6, STAGE_RADIUS * 0.4);
    seated.forEach((d, i) => {
      // Spawns sit on a small evenly-spaced circle: deterministic without touching the RNG, so a
      // restore at a round boundary does not depend on how many draws happened before it.
      const a = (i / Math.max(1, seated.length)) * Math.PI * 2;
      d.park({ x: Math.cos(a) * spawnR, y: 3, z: Math.sin(a) * spawnR });
      // park() parks; a round start is exactly when they come back to life.
      d.active = true;
      d.eliminated = false;
      d.out = false;
    });
    this.clearItems();
    this.arena.suddenDeath = false;
    this.arena.time = 0;
    this.arena.itemTimer = Math.round(6 * TICK_HZ);
    this.arena.lastRareDrop = Object.create(null);
    this.powerupTimer = Math.round(10 * TICK_HZ);
    this.match.beginRound(this._api());
  }

  clearItems() {
    for (const it of this.items) this.physics.remove(it.id);
    this.items = [];
    this.itemKeys = [];
  }

  /** Drop an item from the sky, if the table allows one and the live cap is not reached. */
  dropItem(bias = null) {
    if (!this.config.items) return null;
    if (this.items.length >= this.arena.itemCap) return null;
    const live = new Map();
    for (const it of this.items) live.set(it.key, (live.get(it.key) || 0) + 1);
    const key = this.arena.pickDropItem(bias, live);
    if (!key) return null;
    const p = this.arena.randomGroundPoint(8.5);
    return this.spawnItem(key, { x: p.x, y: 14, z: p.z });
  }

  /** @returns {object} a live item record */
  spawnItem(key, pos) {
    const id = this.ids.alloc();
    const def = itemDef(key);
    this.physics.item(pos.x, pos.y, pos.z, key, id);
    this.itemKeys[id - 1] = key;
    const it = {
      id, key, pos: [pos.x, pos.y, pos.z], vel: [0, 0, 0], spin: [0, 0, 0],
      heldBy: 0, active: true, ttl: 0, thrown: 0, trick: false, thrower: 0,
      fuse: def.explosive ? 1.5 : 0, explosive: !!def.explosive,
    };
    this.items.push(it);
    this.events.emit('spawn', { a: id, x: pos.x, y: pos.y, z: pos.z, kind: key });
    return it;
  }

  despawnItem(item, broke) {
    if (!item?.active) return;
    item.active = false;
    this.events.emit(broke ? 'break' : 'despawn',
      { a: item.id, x: item.pos[0], y: item.pos[1], z: item.pos[2], kind: item.key });
    this.physics.remove(item.id);
    this.ids.release(item.id);
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  byId(id) { return this.dweebs.find(d => d?.id === id) ?? null; }
  itemById(id) { return this.items.find(i => i.id === id) ?? null; }

  /** The callback bundle every subsystem receives instead of a view. */
  _api() {
    if (this._apiObj) return this._apiObj;
    this._apiObj = {
      sim: this,
      get time() { return this.sim.time; },
      emit: (type, f) => this.events.emit(type, f),
      arena: this.arena,
      byId: id => this.byId(id),
      itemById: id => this.itemById(id),
      despawnItem: (it, broke) => this.despawnItem(it, broke),
      noteLaunch: (d, launch) => this._noteLaunch(d, launch),
      onJump: (d, isDouble) => this.events.emit('jump', { a: d.id, kind: isDouble ? 'double' : 'jump' }),
      onSplashJump: d => this.events.emit('splashJump', { a: d.id, x: d.position[0], y: d.position[1], z: d.position[2] }),
      onRespawn: d => this._respawn(d),
      onKO: d => this._koBody(d),
      onNextRound: () => this.beginRound(),
      onGrab: d => this.combat.grab(d, this.dweebs.filter(Boolean), this.items, this._api()),
      onDrop: d => this.combat.drop(d, this.items, this._api()),
      onReleaseAttack: (d, charge) => this.combat.resolveSwing(d, charge, this.dweebs.filter(Boolean), this._api()),
      onReleaseThrow: (d, charge) => this.combat.throwHeld(d, charge, this._api()),
    };
    return this._apiObj;
  }

  _noteLaunch(d, launch) {
    if (launch <= this.highlight.launch) return;
    this.highlight = { launch, id: d.id, by: d.lastHitBy };
  }

  _respawn(d) {
    const p = this.arena.randomGroundPoint(5);
    d.respawn({ x: p.x, y: 9, z: p.z });
    this.events.emit('respawn', { a: d.id, x: p.x, y: 9, z: p.z });
  }

  /**
   * Take a KO'd dweeb out of play. The live game does this by disabling the body and hiding the
   * mesh; here the body is parked far below the lagoon with gravity off, which is the same thing
   * without needing Rapier's setEnabled (and without a mesh to hide). Either way the important
   * part is that a KO'd capsule stops integrating — otherwise it free-falls forever, drags the
   * island's contacts with it, and shows up in a soak report as a body at y = -2700.
   */
  _koBody(d) {
    if (d.heldKind === 'item' && d.held) {
      const it = this.itemById(d.held);
      if (it) it.heldBy = 0;
    }
    // If someone was carrying this dweeb, the carry ends — a KO is not a carry.
    for (const other of this.dweebs) {
      if (other && other.held === d.id && other.heldKind === 'dweeb') {
        other.held = 0;
        other.heldKind = '';
      }
    }
    d.held = 0;
    d.heldKind = '';
    d.grabbedBy = 0;
    d.isCharging = false;
    d.charge = 0;
    d.swimFlail = 0;
    d.ragdolling = false;
    d.physics?.setGravityScale(d.id, 0);
    this.physics.setPos(d.id, KO_PARK_X, KO_PARK_Y, KO_PARK_Z);
    this.physics.setVel(d.id, 0, 0, 0);
    this.physics.lockRotations(d.id, true);
  }

  // ─── The tick ─────────────────────────────────────────────────────────────────

  /**
   * Advance exactly one tick.
   *
   * @param {import('./contracts.js').InputsByPlayer} [inputs] Keyed by slot. A slot with no frame
   *   is treated as NEUTRAL_INPUT, never as "repeat the last frame" — repeating would let a stalled
   *   client keep walking, and would make a reconnect ambiguous.
   * @returns {import('./contracts.js').SimEvent[]} the events produced this tick, in order
   */
  step(inputs = {}) {
    const api = this._api();
    this.tick++;
    this.time = this.tick * TICK_DT;
    this.events.tick = this.tick;
    const seated = this.dweebs.filter(Boolean);
    const playing = this.match.phase === Phase.PLAYING;

    // 1. input → state machine
    //
    // A human frame always wins where one arrives, so a server can promote a bot slot to a player
    // on join without a stale bot frame lingering for a tick. Bots are called exactly once.
    for (const d of seated) {
      const human = pick(inputs, d.slot);
      if (human) d.preStep(human, api);
      else if (this.bots[d.slot]) d.preStep(this.bots[d.slot].think(this.getState()), api);
      else d.preStep(undefined, api);
    }

    // 2. physics: one fixed step, never a variable one
    this.physics.step();

    // 3. read the world back
    for (const d of seated) d.sync();
    for (const it of this.items) this._syncItem(it);

    // 4. the stage moves
    if (this.arena.step() === 'drop') this.dropItem(this.match.suddenDeath ? FINALE_BIAS : null);
    if (--this.powerupTimer <= 0) {
      this.powerupTimer = Math.round(10 * TICK_HZ);
      this._dropPowerUp();
    }

    // 5. combat and hazards
    if (playing) {
      this.combat.diveContacts(seated, api);
      for (const it of this.items) this.combat.itemContacts(it, seated, api);
      this.combat.stageHazards(seated, this.arena, api);
      this._carryItems();
      this._tickItemLifetimes();
    }

    // 6. rules
    this.match.step(seated, api);

    // 7. events
    return this.events.drain(this.tick);
  }

  /**
   * VIEW ONLY. Feed elapsed wall-clock seconds; run as many fixed ticks as the accumulator allows
   * and return the concatenated events. A server must NOT call this — it steps at its own 60 Hz.
   * @param {number} elapsed
   * @returns {import('./contracts.js').SimEvent[]}
   */
  advance(elapsed) {
    const n = this.clock.advance(elapsed);
    const out = [];
    for (let i = 0; i < n; i++) for (const e of this.step()) out.push(e);
    return out;
  }

  /** 0..1, how far the view should sit between the previous and current tick. */
  interpolationAlpha() { return this.clock.alpha(); }

  drainEvents() { return this.events.drain(this.tick); }

  _syncItem(it) {
    const p = this.physics.pos(it.id), v = this.physics.vel(it.id), a = this.physics.angvel(it.id);
    it.pos[0] = p.x; it.pos[1] = p.y; it.pos[2] = p.z;
    it.vel[0] = v.x; it.vel[1] = v.y; it.vel[2] = v.z;
    it.spin[0] = a.x; it.spin[1] = a.y; it.spin[2] = a.z;
  }

  /** A held item rides in the holder's hands: pinned just above and in front of them. */
  _carryItems() {
    for (const d of this.dweebs) {
      if (!d?.held || d.heldKind !== 'item') continue;
      const it = this.itemById(d.held);
      if (!it) { d.held = 0; d.heldKind = ''; continue; }
      const yaw = d.input.aimYaw ?? d.yaw;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      this.physics.setVel(it.id, d.velocity[0], d.velocity[1] + 6, d.velocity[2]);
      this.physics.setPos(it.id,
        d.position[0] + fx * 0.75, d.position[1] + 0.9, d.position[2] + fz * 0.75);
      it.heldBy = d.id;
    }
  }

  _tickItemLifetimes() {
    for (const it of [...this.items]) {
      if (it.heldBy) continue;
      if (it.thrown > 0) it.thrown--;
      else if (it.trick) it.trick = false;
      // Anything below the lagoon is gone.
      if (it.pos[1] < WATER_LEVEL - 1) this.despawnItem(it, false);
    }
  }

  /** Power-ups are a sim concept with a view icon: pick one from the seeded stream, drop it. */
  _dropPowerUp() {
    if (this.items.length >= this.arena.itemCap) return;
    const rng = this.rng.stream('powerup');
    const kind = POWERUP_KEYS[rng.int(POWERUP_KEYS.length)];
    const p = this.arena.randomGroundPoint(8);
    const it = this.spawnItem('box', { x: p.x, y: 12, z: p.z });
    it.powerup = kind;
    this.events.emit('powerup', { a: it.id, kind, x: p.x, y: 12, z: p.z });
  }

  // ─── Read-only projection ─────────────────────────────────────────────────────

  /**
   * The current state, for the view, for the network and for `Bot.think`. Built fresh on each call
   * (about 1 KB at 8 players) because a cached projection is a stale-projection bug waiting for the
   * first prediction to happen.
   * @returns {import('./contracts.js').SimState}
   */
  getState() {
    return {
      tick: this.tick,
      time: this.time,
      phase: this.match.phase,
      dweebs: this.dweebs.map(d => (d ? d.toState(false) : null)).filter(Boolean),
      items: this.items.map(it => ({
        id: it.id, key: it.key, kind: ITEM_KIND[it.key] ?? 0,
        pos: [...it.pos], vel: [...it.vel], spin: [...it.spin],
        heldBy: it.heldBy, active: it.active, ttl: it.ttl,
        grabbable: !it.explosive, weapon: itemDef(it.key).weapon === true,
        powerup: it.powerup ?? null,
      })),
      round: this.match.round,
      roundWins: [...this.match.roundWins],
      timer: this.match.timer,
      countdown: this.match.countdown,
      phaseTimer: this.match.phaseTimer,
      suddenDeath: this.match.suddenDeath,
      blastSide: this.match.blastSide,
      // Read by bots; the wire contract does not require them.
      stageRadius: STAGE_RADIUS,
      groundRadius: this.arena.edgeRadius(),
      hazards: this.arena.hazards,
    };
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────────

  /**
   * Capture everything needed to resume. Restoring this and continuing must be bit-identical to
   * never having stopped — the invariant QA's determinism test asserts.
   *
   * The Rapier bytes dominate the size, and they are the reason NET sends state deltas at
   * 20–30 Hz and reserves a full snapshot for join and hard desync.
   * @returns {import('./contracts.js').Snapshot}
   */
  snapshot() {
    return {
      version: SNAPSHOT_VERSION,
      tick: this.tick,
      config: { ...this.config },
      rapier: this.physics.takeSnapshot(),
      dweebs: this.dweebs.filter(Boolean).map(d => d.snapshot()),
      items: this.items.map(it => ({
        id: it.id, key: it.key, pos: [...it.pos], vel: [...it.vel], spin: [...it.spin],
        heldBy: it.heldBy, active: it.active, ttl: it.ttl, thrown: it.thrown,
        trick: it.trick, thrower: it.thrower, fuse: it.fuse, powerup: it.powerup ?? null,
      })),
      itemKeys: [...this.itemKeys],
      arena: {
        time: this.arena.time, itemTimer: this.arena.itemTimer,
        suddenDeath: this.arena.suddenDeath, lastRareDrop: { ...this.arena.lastRareDrop },
        spinAngle: this.arena.spinAngle,
      },
      match: this.match.snapshot(),
      bots: this.bots.map(b => (b ? b.snapshot() : null)).filter(Boolean),
      rng: this.rng.snapshot(),
      ids: this.ids.snapshot(),
      powerupTimer: this.powerupTimer,
      highlight: { ...this.highlight },
      idOrder: this.physics.dynamicIdOrder(),
      clock: this.clock.snapshot(),
      checksum: this.checksum(),
    };
  }

  /**
   * Resume from a snapshot. Also resets the accumulator and clears the event queue: half a tick of
   * accumulator, and a backlog of events from before the snapshot, would both be meaningless after
   * it — and carrying them over is how a client ends up replaying a KO it already saw.
   *
   * Order matters: RNG first (so the arena's own stream is current), then the Rapier world, then
   * the entities, then the rules.
   * @param {import('./contracts.js').Snapshot} snap
   */
  restore(snap) {
    if (snap?.version !== SNAPSHOT_VERSION) {
      throw new Error(`Sim.restore: snapshot version ${snap?.version} != ${SNAPSHOT_VERSION}`);
    }
    this.config = { ...snap.config };
    this.tick = snap.tick;
    this.time = snap.tick * TICK_DT;

    this.rng.restore(snap.rng);
    this.ids.restore(snap.ids);
    this.clock.restore(snap.clock ?? { acc: 0, ticks: snap.tick }).reset();

    // The Rapier world first: everything after this re-links against the restored bodies.
    this.physics.kinds = new Map();
    for (const d of snap.dweebs) this.physics.kinds.set(d.id, 'dweeb');
    for (const it of snap.items) this.physics.kinds.set(it.id, 'item');
    this.physics.restoreSnapshot(snap.rapier, snap.idOrder);

    this.items = snap.items.map(it => ({
      ...it, pos: [...it.pos], vel: [...it.vel], spin: [...it.spin],
      explosive: itemDef(it.key).explosive === true,
    }));
    this.itemKeys = [...(snap.itemKeys ?? [])];

    Object.assign(this.arena, snap.arena, { lastRareDrop: { ...snap.arena.lastRareDrop } });
    this.match.dweebs = this.dweebs.filter(Boolean);
    this.match.restore(snap.match);

    // Dweeb entities last, so their restore() reads the restored physics bodies.
    for (const s of snap.dweebs) {
      const d = this.dweebs.find(x => x?.id === s.id);
      if (d) d.restore(s);
    }
    // Bots hold a direct reference to their Rng object, and `RngStreams.restore` builds NEW Rng
    // objects — so every brain must be re-pointed at the restored stream before it is restored.
    // Forgetting this is a silent desync: the bot carries on drawing from the pre-snapshot
    // generator, so its decisions diverge from everyone else's while the checksum looks fine for
    // a long time.
    for (const b of this.bots) {
      if (b) b.rng = this.rng.stream('bot' + b.slot);
    }
    for (let i = 0; i < snap.bots.length; i++) this.bots[i]?.restore(snap.bots[i]);

    this.arena.rng = this.rng.stream('drops');
    this.combat.rng = this.rng.stream('combat');

    this.powerupTimer = snap.powerupTimer;
    this.highlight = { ...snap.highlight };
    this.events.clear();
    return this;
  }

  /**
   * A short hash of the current state. Two runs agree exactly when their checksums do. Deliberately
   * coarse (see checksum.js): it should catch divergence, not float noise.
   * @returns {string}
   */
  checksum() {
    return checksumOf(this.getState(), {
      tick: this.tick,
      time: this.time,
      phase: this.match.phase,
      round: this.match.round,
      roundWins: this.match.roundWins,
      timer: this.match.timer,
      blastSide: this.match.blastSide,
      rng: this.rng.stream('drops').snapshot(),
    });
  }
}

/** Item key → stable kind id for the wire (see tables.js). */
const ITEM_KIND = Object.freeze({ ...ITEM_KIND_IDS });

/** Sudden-death drop bias: the last stretch of a round rains explosives. Mirrors main.js. */
const FINALE_BIAS = Object.freeze({ toyRocket: 5, explosiveBarrel: 5, giantHammer: 0.5, anvil: 0.5 });

/** Read one slot's input from a Map or a plain object, tolerating a missing entry. */
function pick(inputs, slot) {
  if (!inputs) return undefined;
  const f = inputs instanceof Map ? inputs.get(slot) : inputs[slot];
  return f ?? undefined;
}
