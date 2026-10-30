// server/warfare.js — Dweeb Warfare online: matchmaking + lockstep turn relay.
//
// Warfare's battle sim (src/sim/warfareBattle.js) is deterministic, so the server never runs it.
// It pairs two players, hands both the same seed, then every TURN_MS broadcasts a numbered turn
// holding every command it received since the last one. Both clients apply turn n at the same sim
// tick and stay bit-identical; they report battle hashes so a desync is caught, not guessed at.
//
// Wire: JSON text frames tagged with `wf` (the brawler protocol is binary and its opcodes are all
// < 0x7b, so a frame starting with '{' is unambiguous). Same port, same process, same rate limiter.
//
//   client → server  {wf:'queue', mode:'coop'|'versus', name?, code?, difficulty?} · {wf:'cancel'} · {wf:'cmd', cmds:[…]}
//                    {wf:'hash', turn, h} · {wf:'over'} (my battle ended normally) · {wf:'leave'} (quit / forfeit)
//   server → client  {wf:'queued', mode, code} · {wf:'start', seed, mode, slot, team, turnTicks, turnMs, partner}
//                    {wf:'turn', n, cmds:[…]} · {wf:'desync', turn} · {wf:'peerLeft'} · {wf:'error', message}

import { BATTLEGROUND_IDS } from '../src/warfare/Battlegrounds.js';

export const TURN_MS = 100;           // 10 turns/s
export const TURN_TICKS = 3;          // sim runs at 30 Hz → 3 ticks per turn
export const MAX_CMDS_PER_TURN = 12;  // per player, per turn
/** Ring buffer of recent turn broadcasts per match, so a reconnecting player can catch up. */
export const TURN_LOG = 240;          // 24 s of turns
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const RECRUITABLE = new Set(['shield', 'rocket', 'stealer', 'kami']);
const STANCES = new Set(['charge', 'defense']);
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

/** Keep only well-formed commands, and force the sender's team (a client cannot command the other side). */
export function sanitizeCmd(c, team) {
  if (!c || typeof c !== 'object') return null;
  if (c.type === 'rally') {
    const x = Number(c.x), z = Number(c.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { type: 'rally', team, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
  }
  if (c.type === 'recruit') return RECRUITABLE.has(c.unit) ? { type: 'recruit', team, unit: c.unit } : null;
  if (c.type === 'startWave') return { type: 'startWave', team };
  if (c.type === 'stance') return STANCES.has(c.stance) ? { type: 'stance', team, stance: c.stance } : null;
  // Commander powers (Q/E/R): the client burns the local cooldown when the button is
  // pressed, so a dropped command is a power that fizzles online but works offline.
  // Artillery carries an aim point like rally (rounded the same way, so both sims see
  // identical floats); supply needs no coordinates (the sim heals around the rally
  // point); stance is allowlisted to the two real formations.
  if (c.type === 'artillery') {
    const x = Number(c.x), z = Number(c.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { type: 'artillery', team, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
  }
  if (c.type === 'supply') return { type: 'supply', team };
  // New commander powers (wave 2): warhorn and repair are team-scoped with no
  // coordinates (the sim derives position from the rally point / base); trap
  // carries an aim point like artillery, rounded the same way.
  if (c.type === 'warhorn') return { type: 'warhorn', team };
  if (c.type === 'repair') return { type: 'repair', team };
  if (c.type === 'trap') {
    const x = Number(c.x), z = Number(c.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { type: 'trap', team, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
  }
  return null;
}

export class WarfareLobby {
  constructor({ rand = Math.random } = {}) {
    this.rand = rand;
    this.waiting = [];            // {client, mode, code, name}
    this.matches = new Set();
    this.byClient = new Map();    // client -> match
  }

  _code() {
    const A = CODE_ALPHABET.length;
    for (let tries = 0; ; tries++) {
      let s = '';
      // after a few unlucky draws, walk the code space so a bad rand can never spin forever
      for (let i = 0; i < 4; i++) s += CODE_ALPHABET[(Math.floor(this.rand() * A) + (tries > 8 ? Math.floor(tries / A ** i) : 0)) % A];
      if (!this.waiting.some(w => w.code === s)) return s;
    }
  }

  get stats() { return { waiting: this.waiting.length, matches: this.matches.size, players: this.byClient.size }; }

  handle(client, m) {
    switch (m.wf) {
      case 'queue': return this._queue(client, m);
      case 'cancel': this._unqueue(client); return;
      case 'cmd': return this._cmd(client, m);
      case 'hash': return this._hash(client, m);
      case 'rejoin': return this._rejoin(client, m);
      case 'over': return this._over(client);
      case 'leave': this.drop(client); return;
      default: client.send({ wf: 'error', message: `unknown ${m.wf}` });
    }
  }

  _queue(client, m) {
    if (this.byClient.has(client)) return client.send({ wf: 'error', message: 'already in a match' });
    this._unqueue(client);
    const mode = m.mode === 'versus' ? 'versus' : 'coop';
    const name = String(m.name || 'Dweeb').slice(0, 16);
    const code = typeof m.code === 'string' ? m.code.toUpperCase().slice(0, 4) : '';
    let partner = null;
    if (code) {
      partner = this.waiting.find(w => w.code === code && w.client !== client);
      if (!partner) return client.send({ wf: 'error', message: `no one is waiting with code ${code}` });
    } else {
      partner = this.waiting.find(w => w.mode === mode && w.client !== client);
    }
    if (!partner) {
      const difficulty = DIFFICULTIES.has(m.difficulty) ? m.difficulty : 'normal';
      const map = BATTLEGROUND_IDS.includes(m.map) ? m.map : 'meadow';
      const entry = { client, mode, code: this._code(), name, difficulty, map };
      this.waiting.push(entry);
      client.send({ wf: 'queued', mode, code: entry.code });
      return;
    }
    this.waiting.splice(this.waiting.indexOf(partner), 1);
    this._start(partner, { client, mode: partner.mode, name });
  }

  _unqueue(client) {
    this.waiting = this.waiting.filter(w => w.client !== client);
  }

  _start(a, b) {
    const seed = (Math.floor(this.rand() * 0x7ffffffe) + 1) | 0;
    const mode = a.mode;
    const map = BATTLEGROUND_IDS.includes(a.map) ? a.map : 'meadow';
    const tok = () => {
      let s = '';
      for (let i = 0; i < 12; i++) s += CODE_ALPHABET[Math.floor(this.rand() * CODE_ALPHABET.length)];
      return s;
    };
    const players = [
      { client: a.client, slot: 0, team: 'blue', name: a.name, alive: true, token: tok() },
      { client: b.client, slot: 1, team: mode === 'versus' ? 'red' : 'blue', name: b.name, alive: true, token: tok() },
    ];
    const difficulty = a.difficulty || 'normal'; // the host (whoever waited) picks
    const match = { mode, seed, difficulty, map, players, turn: 0, inbox: [], hashes: new Map(), desynced: false, log: [], lastAgreed: null, expectHash: 0 };
    this.matches.add(match);
    for (const p of players) {
      this.byClient.set(p.client, match);
      const other = players[1 - p.slot];
      p.client.send({ wf: 'start', seed, mode, difficulty, map, slot: p.slot, team: p.team, token: p.token, turnTicks: TURN_TICKS, turnMs: TURN_MS, partner: other.name });
    }
  }

  _cmd(client, m) {
    const match = this.byClient.get(client);
    if (!match) return;
    const p = match.players.find(q => q.client === client);
    const list = Array.isArray(m.cmds) ? m.cmds.slice(0, MAX_CMDS_PER_TURN) : [];
    for (const c of list) {
      const clean = sanitizeCmd(c, p.team);
      if (clean) match.inbox.push({ ...clean, slot: p.slot });
    }
  }

  _hash(client, m) {
    const match = this.byClient.get(client);
    if (!match || match.desynced) return;
    const p = match.players.find(q => q.client === client);
    if (!p) return;
    const turn = m.turn | 0;
    const rec = match.hashes.get(turn) || {};
    rec[p.slot] = m.h >>> 0;
    match.hashes.set(turn, rec);
    if (rec[0] !== undefined && rec[1] !== undefined) {
      match.hashes.delete(turn);
      if (rec[0] !== rec[1]) {
        match.desynced = true;
        for (const q of match.players) if (q.alive) q.client.send({ wf: 'desync', turn });
      } else {
        match.lastAgreed = { turn, h: rec[0] >>> 0 };
        if (match.expectHash && turn >= match.expectHash) match.expectHash = 0;
      }
    }
    if (match.hashes.size > 64) match.hashes.clear();
  }

  /**
   * A dropped co-op player rejoins on a fresh socket: {wf:'rejoin', token, from}.
   * Missed turns are replayed from the ring buffer, then both peers are asked for an
   * immediate hash at the resync turn (tightened check — no waiting for the next
   * scheduled hash after a reconnect on a laggy link).
   */
  _rejoin(client, m) {
    if (this.byClient.has(client)) return client.send({ wf: 'error', message: 'already in a match' });
    const token = String(m.token || '');
    let found = null;
    for (const match of this.matches) {
      const p = match.players.find(q => q.token === token);
      if (p) { found = { match, p }; break; }
    }
    if (!found) return client.send({ wf: 'error', message: 'no match to rejoin' });
    const { match, p } = found;
    // A laggy client often reconnects before its dead socket's close is processed:
    // the new socket takes over the slot, and the stale close becomes a no-op.
    if (p.alive) this.byClient.delete(p.client);
    const from = Math.max(0, m.from | 0);
    const missed = match.log.filter(t => t.n >= from);
    if (missed.length && missed[0].n !== from) {
      // the ring buffer no longer reaches back far enough: a clean forfeit beats a bad resync
      return client.send({ wf: 'resync', ok: false, reason: 'turn log expired' });
    }
    p.client = client;
    p.alive = true;
    this.byClient.set(client, match);
    match.expectHash = match.turn; // both peers must agree once more, right now
    client.send({ wf: 'resync', ok: true, slot: p.slot, team: p.team, token: p.token, mode: match.mode, seed: match.seed, difficulty: match.difficulty, map: match.map, turnTicks: TURN_TICKS, turnMs: TURN_MS, from, turns: missed, lastAgreed: match.lastAgreed });
    for (const q of match.players) {
      if (q !== p && q.alive) q.client.send({ wf: 'peerBack', name: p.name });
      if (q.alive) q.client.send({ wf: 'verifyHash', turn: match.turn });
    }
  }

  /** Broadcast one turn for every live match. Call every TURN_MS. */
  tick() {
    for (const match of this.matches) {
      const msg = { wf: 'turn', n: match.turn, cmds: match.inbox };
      match.inbox = [];
      match.turn++;
      match.log.push(msg);
      if (match.log.length > TURN_LOG) match.log.splice(0, match.log.length - TURN_LOG);
      for (const p of match.players) if (p.alive) p.client.send(msg);
    }
  }

  /** The battle ended for this client. Not an abandonment: a lagging partner keeps getting turns until it ends too. */
  _over(client) {
    this._unqueue(client);
    const match = this.byClient.get(client);
    if (!match) return;
    this.byClient.delete(client);
    const p = match.players.find(q => q.client === client);
    if (p) p.alive = false;
    if (!match.players.some(q => q.alive)) this.matches.delete(match);
  }

  /** A client left mid-match (socket closed, or quit). Partner is told; versus ends, co-op carries on solo. */
  drop(client) {
    this._unqueue(client);
    const match = this.byClient.get(client);
    if (!match) return;
    this.byClient.delete(client);
    const p = match.players.find(q => q.client === client);
    if (p) p.alive = false;
    const left = match.players.filter(q => q.alive);
    for (const q of left) q.client.send({ wf: 'peerLeft' });
    if (!left.length || match.mode === 'versus') {
      for (const q of left) this.byClient.delete(q.client);
      this.matches.delete(match);
    }
  }
}
