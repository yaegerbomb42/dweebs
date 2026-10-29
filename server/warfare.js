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

export const TURN_MS = 100;           // 10 turns/s
export const TURN_TICKS = 3;          // sim runs at 30 Hz → 3 ticks per turn
export const MAX_CMDS_PER_TURN = 12;  // per player, per turn
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const RECRUITABLE = new Set(['shield', 'rocket', 'stealer', 'kami']);
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
  if (c.type === 'stance') {
    return c.stance === 'charge' || c.stance === 'defense' ? { type: 'stance', team, stance: c.stance } : null;
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
      const entry = { client, mode, code: this._code(), name, difficulty };
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
    const players = [
      { client: a.client, slot: 0, team: 'blue', name: a.name, alive: true },
      { client: b.client, slot: 1, team: mode === 'versus' ? 'red' : 'blue', name: b.name, alive: true },
    ];
    const difficulty = a.difficulty || 'normal'; // the host (whoever waited) picks
    const match = { mode, seed, difficulty, players, turn: 0, inbox: [], hashes: new Map(), desynced: false };
    this.matches.add(match);
    for (const p of players) {
      this.byClient.set(p.client, match);
      const other = players[1 - p.slot];
      p.client.send({ wf: 'start', seed, mode, difficulty, slot: p.slot, team: p.team, turnTicks: TURN_TICKS, turnMs: TURN_MS, partner: other.name });
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
    const turn = m.turn | 0;
    const rec = match.hashes.get(turn) || {};
    rec[p.slot] = m.h >>> 0;
    match.hashes.set(turn, rec);
    if (rec[0] !== undefined && rec[1] !== undefined) {
      match.hashes.delete(turn);
      if (rec[0] !== rec[1]) {
        match.desynced = true;
        for (const q of match.players) if (q.alive) q.client.send({ wf: 'desync', turn });
      }
    }
    if (match.hashes.size > 64) match.hashes.clear();
  }

  /** Broadcast one turn for every live match. Call every TURN_MS. */
  tick() {
    for (const match of this.matches) {
      const msg = { wf: 'turn', n: match.turn, cmds: match.inbox };
      match.inbox = [];
      match.turn++;
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
