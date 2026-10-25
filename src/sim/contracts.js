// src/sim/contracts.js — the published boundary between SIM, NET and the view layer.
//
// TYPES + CONSTANTS ONLY. It imports nothing and touches no DOM, no three.js and no Rapier, so
// both the browser bundle and a bare Node process can load it. NET builds against exactly this
// shape; any change here is a board post, not a silent edit.
//
// ─── The four rules the sim obeys ───
//  1. Fixed 60 Hz step. The render loop may run at any rate; it feeds an accumulator and
//     interpolates between the last two states. No sim code ever sees a variable dt.
//  2. One input frame per player per tick, and nothing else. The sim never reads the DOM, the
//     camera, the keyboard or the clock.
//  3. The sim is the only source of truth. It emits events; Fx / Hud / audio subscribe and may
//     be arbitrarily late without changing the outcome.
//  4. snapshot() → restore() must resume a bit-exact run — that is what makes rollback,
//     server reconciliation and the desync test possible.

/** Simulation rate in hertz. Every dt in sim code is exactly 1/TICK_HZ seconds. */
export const TICK_HZ = 60;

/** The one and only sim step in seconds: 1/60, not 0.016 (the latter drifts). */
export const TICK_DT = 1 / TICK_HZ;

/** Ceiling on catch-up steps per render frame, so a stalled tab can't spiral. */
export const MAX_STEPS_PER_FRAME = 5;

/** Longest frame the accumulator will honour; beyond this, time is discarded. */
export const MAX_FRAME_TIME = 0.25;

/** @typedef {number} EntityId Stable dense integer, unique within a match. */
/** @typedef {0|1|2|3|4|5|6|7} PlayerId Slot index, 0..7 (the brief caps a room at 8). */
/** @typedef {number} ItemKindId Index into the sim's item table. */

export const MAX_PLAYERS = 8;

/**
 * Allocates and frees the small integer ids used everywhere in the protocol. Object references
 * are never serialized. Slots are recycled lowest-first so two runs of the same match produce
 * identical ids — a prerequisite for checksum equality in CI.
 */
export class IdAllocator {
  constructor() {
    /** @type {number} */ this.next = 1;
    /** Sorted array used as a min-queue (free ids are small dense ints). */
    /** @type {number[]} */ this.free = [];
  }

  /** @returns {EntityId} */
  alloc() {
    if (this.free.length) return this.free.shift();
    return this.next++;
  }

  /** @param {EntityId} id */
  release(id) {
    if (!Number.isInteger(id) || id <= 0) return;
    if (id >= this.next || this.free.includes(id)) return;
    // Insertion-sorted: free stays tiny (entities per match), binary insert keeps alloc O(1).
    let lo = 0, hi = this.free.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.free[mid] < id) lo = mid + 1; else hi = mid; }
    this.free.splice(lo, 0, id);
  }

  snapshot() { return { next: this.next, free: [...this.free] }; }

  /** @param {ReturnType<IdAllocator['snapshot']>} s */
  restore(s) { this.next = s.next >>> 0 || 1; this.free = [...(s.free || [])].sort((a, b) => a - b); }
}

// ─── Inputs ────────────────────────────────────────────────────────────────────

/**
 * One tick of intent from one player. Plain numbers and booleans only: this is the object the
 * client sends, the server buffers, replays and (client-side) predicts with.
 *
 * Axes are unit-length world-space floor directions (x, z), never camera-relative: the view
 * resolves WASD against the camera once, then sends world-space intent, so a headless server and
 * a browser client can agree. A missing frame must be sent as NEUTRAL_INPUT rather than
 * omitted, so tick alignment is never ambiguous.
 *
 * @typedef {object} InputFrame
 * @property {PlayerId} player   Slot this frame belongs to. Redundant on purpose: the client
 *                              sends a batch and the server must not trust batch order.
 * @property {number}   tick     Tick this frame applies to.
 * @property {number}   moveX    Floor move x in [-1, 1]; magnitude is throttle (1 = walk speed).
 * @property {number}   moveZ    Floor move z in [-1, 1] (see moveX).
 * @property {boolean}  jump     HELD, not pressed: rising edge = jump / double jump, held =
 *                              variable jump height and up-DI while airborne.
 * @property {boolean}  attack   HELD: rising edge starts a charge, falling edge releases. A
 *                              one-tick pulse is a jab.
 * @property {boolean}  grab     Rising edge grabs (or starts a throw charge when already
 *                              holding), falling edge releases the throw.
 * @property {boolean}  dodge    One-shot: dive on the ground, air-dodge airborne, tech a hard
 *                              landing while tumbling.
 * @property {?number}  aimYaw   Throw/facing yaw in radians, or null to keep current facing.
 * @property {number}   aimLoft  Throw elevation in radians, ~[-0.35, 0.95]. 0.2 ≈ flat.
 * @property {?number}  charge   Explicit charge for this tick in [0, 1] when the client already
 *                              integrated it (mouse hold). null = sim integrates from edges.
 * @property {boolean}  superYeet Rising edge arms the style meter for the next release.
 * @property {boolean}  drop     Rising edge drops the held item.
 */

export const NEUTRAL_INPUT = Object.freeze({
  player: -1, tick: -1, moveX: 0, moveZ: 0, jump: false, attack: false, grab: false,
  dodge: false, aimYaw: null, aimLoft: 0.2, charge: null, superYeet: false, drop: false,
});

/** Field aliases accepted on the wire / from legacy callers (canonical: moveZ). */
export const INPUT_ALIASES = Object.freeze({ moveY: 'moveZ' });

const _b = v => v === true || v === 1 || v === '1';
const _n = (v, d) => (Number.isFinite(v) ? v : d);
const _cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Build a canonical InputFrame from any partial/legacy input.
 * Pure + total: never throws, never returns shared mutable state.
 * Accepts legacy `moveY` (net wire) as an alias for canonical `moveZ`.
 */
export function makeInput(partial = {}, player = -1, tick = -1) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const mz = _n(p.moveZ, _n(p.moveY, 0));
  return {
    player: Number.isInteger(p.player) ? p.player : player,
    tick: Number.isInteger(p.tick) ? p.tick : tick,
    moveX: _cl(_n(p.moveX, 0), -1, 1),
    moveZ: _cl(mz, -1, 1),
    jump: _b(p.jump), attack: _b(p.attack), grab: _b(p.grab), dodge: _b(p.dodge),
    aimYaw: Number.isFinite(p.aimYaw) ? p.aimYaw : null,
    aimLoft: _cl(_n(p.aimLoft, 0.2), -0.35, 0.95),
    charge: Number.isFinite(p.charge) ? _cl(p.charge, 0, 1) : null,
    superYeet: _b(p.superYeet ?? p.special),
    drop: _b(p.drop ?? p.down),
  };
}

/** True when a frame is all-neutral (safe to skip sending / treat as fill). */
export function isNeutralInput(f) {
  return !f || (f.moveX === 0 && (f.moveZ ?? f.moveY ?? 0) === 0 && !f.jump && !f.attack &&
    !f.grab && !f.dodge && (f.charge ?? 0) === 0 && !f.superYeet && !f.drop);
}

/**
 * Inputs for one tick, keyed by PlayerId. Missing slots read as NEUTRAL_INPUT.
 * @typedef {Map<PlayerId, InputFrame>|Record<number, InputFrame>} InputsByPlayer
 */

/**
 * The output of Bot.think(simState) — deliberately the same shape as a human's frame.
 * @typedef {InputFrame} BotFrame
 */

// ─── Configuration ─────────────────────────────────────────────────────────────

/**
 * Everything a match starts with. Fully serializable, and the only thing allowed to influence
 * setup: a snapshot restores state, not config, so config is versioned and hashed with the
 * checksum.
 *
 * @typedef {object} SimConfig
 * @property {number}   version       Bumped on any breaking contract change.
 * @property {number}   seed          Seed for the sim RNG. Same seed + same inputs = same run.
 *                                    The sim never calls Math.random().
 * @property {number}   stocks        Stocks per dweeb.
 * @property {number}   roundsToWin   Rounds needed to win.
 * @property {number}   roundTime     Round length in seconds.
 * @property {number}   suddenDeathAt Seconds remaining when the arena starts closing in.
 * @property {string}   botDifficulty 'easy' | 'normal' | 'hard' for bot-filled slots.
 * @property {boolean}  items         Whether the drop table runs at all.
 * @property {number}   tickHz        Must equal TICK_HZ; a mismatch should be loud, not subtle.
 * @property {PlayerId[]} order      Slot order, so spawn positions are reproducible.
 */

/** Defaults matching current offline settings: 3 stocks, best of 3, 120 s rounds. */
export const DEFAULT_CONFIG = Object.freeze({
  version: 1, seed: 1, stocks: 3, roundsToWin: 2, roundTime: 120, suddenDeathAt: 40,
  botDifficulty: 'normal', items: true, tickHz: TICK_HZ, order: [0, 1, 2, 3],
});

// ─── Simulation state ──────────────────────────────────────────────────────────

/**
 * The serializable half of the world: the shape the view renders, the shape the checksum is
 * computed over, and the shape NET delta-encodes.
 *
 * @typedef {object} SimState
 * @property {number}    tick       Monotonic tick counter — the only clock the sim trusts.
 * @property {number}    time       Seconds since the match started (tick / TICK_HZ).
 * @property {string}    phase      'menu' | 'countdown' | 'playing' | 'roundEnd' | 'results'.
 * @property {DweebState[]} dweebs  One per occupied slot, indexed by slot.
 * @property {ItemState[]}  items   Live stage items, plus hold relationships.
 * @property {number}    round      1-based round number.
 * @property {number[]}  roundWins  Rounds won per slot.
 * @property {number}    timer      Seconds left in the round.
 * @property {number}    countdown  Countdown seconds left.
 * @property {number}    phaseTimer Round-end / results timer.
 * @property {boolean}   suddenDeath Whether the arena is closing in.
 * @property {number}    blastSide  Current side blast radius (shrinks in sudden death).
 */

/**
 * A dweeb as the view sees it. Physics bodies are deliberately NOT in here: the sim owns the
 * Rapier world, and this is the read-only projection used by snapshots, rendering and the
 * quantizer.
 *
 * @typedef {object} DweebState
 * @property {EntityId} id          Stable id, distinct from the slot.
 * @property {PlayerId} slot
 * @property {string}   name        Display name; cosmetic, never used by sim maths.
 * @property {string}   type        'cube' | 'blob' | 'spiky'.
 * @property {number}   color       Packed 0xRRGGBB. Cosmetic but travels with the id so a
 *                                  remote slot shows the right dweeb.
 * @property {number[]} pos         [x, y, z] metres; quantized to 1 cm on the wire.
 * @property {number[]} vel         [x, y, z] m/s.
 * @property {number}   yaw         Facing yaw in radians (yaw only, no Euler gimbal).
 * @property {number}   percent     Damage percent, hashed at 0.1.
 * @property {number}   stocks
 * @property {boolean}  active      In the round (false between KO and respawn).
 * @property {boolean}  out         Currently knocked out, waiting to respawn.
 * @property {boolean}  eliminated  Out of stocks.
 * @property {boolean}  grounded
 * @property {boolean}  holding     Carrying something (see ItemState.heldBy).
 * @property {EntityId} held        Item id in hand, or 0.
 * @property {EntityId} heldBy      Dweeb id that grabbed this one, or 0.
 * @property {number}   style       Style meter 0..100.
 * @property {number}   styleTier   0..3, index into the style tier names.
 * @property {boolean}  isBot       Slot filled by a bot, never a human.
 * @property {boolean}  isLocal     View-only; never present in snapshots.
 */

/**
 * An item, projectile, power-up, or a thrown dweeb's body. Spawned by the drop table (the same
 * weighted picker, rare caps and cooldowns QA tests in Arena) and consumed by combat.
 *
 * @typedef {object} ItemState
 * @property {EntityId}   id
 * @property {ItemKindId} kind    Index into the item table, e.g. the key in OBJECT_DEFS.
 * @property {number[]}   pos
 * @property {number[]}   vel
 * @property {number[]}   spin    Angular velocity rad/s, for the tumble.
 * @property {EntityId}   heldBy  Dweeb id holding it, or 0.
 * @property {boolean}    active
 * @property {number}     ttl     Ticks left before despawn (0 = never).
 */

// ─── Events ────────────────────────────────────────────────────────────────────

/**
 * The full event list. The sim pushes these during step(); the view drains them afterwards and
 * turns them into Fx, Hud, audio and camera work. Events are descriptive only — they carry
 * positions and magnitudes, never instructions, and nothing in the sim may read them back.
 *
 * @typedef {object} SimEvent
 * @property {string}   tick   Tick the event happened on, for replay and client dedup.
 * @property {string}   type   One of {@link EVENT_TYPES}.
 * @property {EntityId} [a]    Primary entity: victim, item or dweeb.
 * @property {EntityId} [b]    Secondary entity: attacker, thrown target, stage piece.
 * @property {number}   [x]    Point of interest x.
 * @property {number}   [y]    Point of interest y.
 * @property {number}   [z]    Point of interest z.
 * @property {number}   [mag]  Magnitude: damage, launch speed, charge, blast radius, seconds.
 * @property {string}   [kind] Sub-kind, e.g. KO cause 'side' | 'top' | 'splash'.
 * @property {number}   [tier] Juice tier or style tier, where the view cares.
 */

/** The complete event vocabulary. The view may not react to anything outside this list. */
export const EV = Object.freeze({
  /** Dweeb a hit by b. mag = damage, tier = launch speed. Drives hit Fx, sound, shake. */
  HIT: 'hit',
  /** Dweeb a launched. mag = launch speed — the number Match.noteLaunch keeps as a highlight. */
  LAUNCH: 'launch',
  /** Dweeb a KO'd. kind = 'side' | 'top' | 'splash' | 'star'. b = credited attacker, 0 = self. */
  KO: 'ko',
  /** Dweeb a lost a stock; respawns in mag seconds. Distinct from KO, which is the moment. */
  STOCK_LOST: 'stockLost',
  /** Dweeb a is eliminated (out of stocks). */
  ELIMINATED: 'eliminated',
  /** Dweeb a respawned at (x, y, z). */
  RESPAWN: 'respawn',
  /** Dweeb a began the water splash-jump flail at (x, y, z). Was Match.onFlail. */
  FLAIL: 'flail',
  /** Dweeb a splash-jumped clear of the water — the successful half of a flail. */
  SPLASH_JUMP: 'splashJump',
  /** Something entered the lagoon; (x, y, z) is the splash. */
  SPLASH: 'splash',
  /** Dweeb a landed hard. mag = fall speed, drives the thud and the landing lag. */
  LAND: 'land',
  /** Dweeb a jumped / double-jumped / air-dodged / teched. kind names which. */
  JUMP: 'jump',
  /** Dweeb a started a charge. mag = charge, kind = attack kind. */
  CHARGE: 'charge',
  /** Dweeb a released an attack. mag = charge, kind = attack name. */
  ATTACK: 'attack',
  /** An attack hit nothing. Cosmetic; the view may drop it. */
  WHIFF: 'whiff',
  /** Dweeb a grabbed dweeb b. */
  GRAB: 'grab',
  /** Dweeb a threw. b is the dweeb thrown, or 0 when a held item was thrown instead. */
  THROW: 'throw',
  /** Dweeb a dropped its held item voluntarily. */
  DROP: 'drop',
  /** Item a left dweeb b's hand as a trickshot. mag = trick bonus factor. */
  TRICK_SHOT: 'trickShot',
  /** Item a shattered on impact at (x, y, z). */
  BREAK: 'break',
  /** Item a spawned from the drop table at (x, y, z). */
  SPAWN: 'spawn',
  /** Item a despawned (ttl expired, or a round reset it). */
  DESPAWN: 'despawn',
  /** Explosion centred at (x, y, z). mag = radius, kind = source item. */
  EXPLOSION: 'explosion',
  /** Dweeb a picked up a power-up. kind = power-up name. */
  POWERUP: 'powerup',
  /** Physics impulse above the impact threshold. b = other collider, mag = |Δv|. */
  IMPACT: 'impact',
  /** A bumper at (x, y, z) flung dweeb a outward. */
  BUMPER: 'bumper',
  /** A trampoline launched dweeb a. */
  TRAMPOLINE: 'trampoline',
  /** Countdown number; mag is the number announced (3, 2, 1). */
  COUNTDOWN: 'countdown',
  /** Play has started. */
  GO: 'go',
  /** Sudden death began; the arena starts closing in. */
  SUDDEN_DEATH: 'suddenDeath',
  /** Round over. a = winner dweeb, kind = 'match' when the whole match ended. */
  ROUND_END: 'roundEnd',
  /** Match over. a = winner dweeb. */
  MATCH_END: 'matchEnd',
  /** Stage segment b is about to fall (sudden-death crumble warning). */
  SEGMENT_WARN: 'segmentWarn',
  /** Stage segment b fell. */
  SEGMENT_FALL: 'segmentFall',
  /** Dweeb a is hanging off the ledge. x = ledge angle, mag = hang time. */
  LEDGE: 'ledge',
  /** Dweeb a reached style tier (1..3). */
  STYLE_UP: 'styleUp',
});

/** Every event name, for validation and for QA's exhaustiveness check. */
export const EVENT_TYPES = Object.freeze(Object.values(EV));

// ─── Snapshots ─────────────────────────────────────────────────────────────────

/**
 * A complete, serializable resume point. Restoring a snapshot and continuing must be
 * bit-identical to never having stopped — that invariant is QA's determinism test.
 *
 * @typedef {object} Snapshot
 * @property {number}    version   Snapshot format version, independent of SimConfig.version.
 * @property {number}    tick
 * @property {SimConfig} config    Carried so a client can verify it is restoring the same match.
 * @property {Uint8Array} rapier   `world.takeSnapshot()`: the whole Rapier world — bodies,
 *                                 colliders, joints, island data. Base64 in JSON, raw in binary.
 *                                 ~1–3 KB at 40 items. This is the one part that is not cheap,
 *                                 which is why NET sends state deltas at 20–30 Hz and a full
 *                                 snapshot only on join and on hard desync.
 * @property {DweebState[]} dweebs Full projection: no deltas, no omissions.
 * @property {ItemState[]}  items
 * @property {MatchState}  match    Phases, timers, round wins, stocks, style, cooldowns.
 * @property {RngState}    rng      The sim RNG's internal state, so randomness resumes exactly.
 * @property {object}      ids      IdAllocator snapshot.
 * @property {string}      checksum Checksum of the state this snapshot was taken at. Recompute
 *                                 after restore and compare — that is the desync check.
 */

/**
 * @typedef {object} MatchState
 * @property {string}   phase
 * @property {number}   round
 * @property {number[]} roundWins
 * @property {number}   timer
 * @property {number}   countdown
 * @property {number}   phaseTimer
 * @property {number}   time
 * @property {boolean}  suddenDeath
 * @property {number}   blastSide
 * @property {?number}  roundWinner
 * @property {?number}  matchWinner
 */

/**
 * The sim RNG's serializable state: the 32-bit accumulator and how many draws have been taken.
 * @typedef {{ s: number, draws: number }} RngState
 */

// ─── The Sim interface (implemented by src/sim/Sim.js) ──────────────────────────

/**
 * The contract NET builds against. `Sim.js` is the only file allowed to touch Rapier; nothing
 * here requires three.js, the DOM or WebAudio, which is what makes the headless run possible.
 *
 * @typedef {object} SimApi
 *
 * @property {(inputs: InputsByPlayer) => SimEvent[]} step
 *   Advance exactly one tick and return the events produced, in order. A player with no frame
 *   for this tick is treated as NEUTRAL_INPUT. Invalid frames are clamped and ignored, never
 *   fatal — a malformed input must not take the server down.
 *
 * @property {(elapsedSeconds: number) => SimEvent[]} advance
 *   VIEW ONLY. Feed elapsed wall-clock time; run as many fixed ticks as the accumulator allows,
 *   capped at MAX_STEPS_PER_FRAME, and return the concatenated events. The server must call
 *   `step()` from its own fixed 60 Hz loop instead and must not use this.
 *
 * @property {() => number} interpolationAlpha
 *   0..1 — how far the view should sit between the previous and current tick. Presentation only;
 *   it is part of no checksum.
 *
 * @property {() => Snapshot} snapshot
 *   Capture everything needed to resume, including the Rapier world and the RNG state.
 *
 * @property {(snap: Snapshot) => void} restore
 *   Resume from a snapshot. Must also reset the accumulator and clear the event queue.
 *
 * @property {() => string} checksum
 *   Order-independent hash (FNV-1a, hex) over positions rounded to 1 cm, velocities to 0.01 m/s,
 *   percent to 0.1, plus stocks and style. Deliberately coarse: it must catch divergence without
 *   tripping over float noise. Two runs agree exactly when their checksums do.
 *
 * @property {() => SimState} getState
 *   The current read-only projection, for the view and for `Bot.think`.
 *
 * @property {() => SimEvent[]} drainEvents
 *   Pull anything left in the event buffer — for a client that took a snapshot mid-tick. `step()`
 *   already returns its own events, so this is only about leftovers.
 *
 * @property {() => string} version
 *   Contract + implementation version. A client that disagrees with the server must refuse to
 *   connect rather than quietly desync.
 */

// ─── Notes for consumers ───────────────────────────────────────────────────────
//
// NET: send one InputFrame per slot per tick (redundantly the last 3). Clamp moveX/moveZ to
//      [-1,1] and aimLoft to [-0.35, 0.95] before stepping, and never trust a client's
//      `percent`, `stocks` or anything else in DweebState — those are outputs, not inputs. Use
//      `checksum` to detect desync and log it at keyframes (round start/end, every KO) so a
//      drifting client is caught early rather than at the first visible glitch.
// APP: render DweebState / ItemState, subscribe to SimEvent for Fx, Hud and audio, and
//      interpolate with `interpolationAlpha` from snapshots arriving 20–30 Hz. Keep remote
//      players ~100 ms in the past.
// SIM: no Math.random() anywhere reachable from step(). Cosmetic randomness — particles, decals,
//      Fx jitter, screen shake — stays in the view and is explicitly allowed to be random.

/** Contract version. Bumped on any breaking change to anything above. */
export const CONTRACTS_VERSION = 1;
