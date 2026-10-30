// WarfareNet.js — Dweeb Warfare online client. Talks to the existing dweebs-server WebSocket
// (same URL resolution as the brawler: ?server= / saved setting / VITE_SERVER_URL / same-origin /ws,
// localhost:8787 in dev) using the JSON `wf` lockstep protocol from server/warfare.js.
// The brawler's binary frames that the server sends every socket (welcome/online counts) are ignored.
//
// Reconnects: if the socket drops mid-battle, `rejoin()` opens a fresh socket and resumes the same
// match — the server replays missed turns from its ring buffer and both peers hash immediately
// (see server/warfare.js `_rejoin`), so a laggy reconnect can't silently desync the battle.
export class WarfareNet {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = {};
    this.turns = [];           // received turns, in order
    this.nextTurn = 0;         // next turn number the sim needs
    this.match = null;         // {slot, team, token, map, mode, seed, difficulty, turnTicks, turnMs}
  }

  on(type, fn) { this.handlers[type] = fn; return this; }

  _bindMessages(ws) {
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m.wf !== 'string') return;
      if (m.wf === 'turn') { this.turns.push(m); this.lastTurnAt = performance.now(); }
      if (m.wf === 'start' || (m.wf === 'resync' && m.ok)) {
        this.match = {
          ...(this.match || {}),
          slot: m.slot, team: m.team, token: m.token, map: m.map, mode: m.mode,
          seed: m.seed, difficulty: m.difficulty, turnTicks: m.turnTicks, turnMs: m.turnMs,
        };
      }
      if (m.wf === 'resync' && m.ok) for (const t of m.turns || []) this.turns.push(t);
      this.handlers[m.wf]?.(m);
    };
  }

  connect(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (ok, err) => { if (done) return; done = true; clearTimeout(t); ok ? resolve(this) : reject(err); };
      const t = setTimeout(() => { finish(false, new Error('timeout')); try { this.ws?.close(); } catch { /* closing */ } }, timeoutMs);
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { finish(false, e); return; }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => finish(true);
      ws.onerror = () => finish(false, new Error('cannot reach server'));
      ws.onclose = () => { if (done) this.handlers.close?.(); else finish(false, new Error('closed')); };
      this._bindMessages(ws);
    });
  }

  /**
   * Resume a dropped match on a fresh socket. The server replays every turn since
   * `nextTurn` and both peers hash immediately, so divergence is caught at once.
   * Resolves on the `resync` reply; rejects if the turn log expired or the match is gone.
   */
  rejoin(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const match = this.match;
      if (!match || !match.token) { reject(new Error('no match to rejoin')); return; }
      let done = false;
      const finish = (ok, err) => { if (done) return; done = true; clearTimeout(t); ok ? resolve(this) : reject(err); };
      const t = setTimeout(() => { finish(false, new Error('rejoin timeout')); try { this.ws?.close(); } catch { /* closing */ } }, timeoutMs);
      // Turns already queued are stale: the server replays everything from nextTurn.
      this.turns = [];
      const from = this.nextTurn;
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { finish(false, e); return; }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => this._send({ wf: 'rejoin', token: match.token, from });
      ws.onerror = () => finish(false, new Error('cannot reach server'));
      ws.onclose = () => { if (done) this.handlers.close?.(); else finish(false, new Error('closed')); };
      this._bindMessages(ws);
      const prev = this.handlers.resync;
      this.handlers.resync = m => {
        try { prev?.(m); } finally {
          if (m && m.ok) finish(true, this);
          else finish(false, new Error((m && m.reason) || 'resync refused'));
        }
      };
    });
  }

  _send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  queue(mode, { code = '', name = 'Dweeb', difficulty = 'normal', map = 'meadow' } = {}) { this.turns = []; this.nextTurn = 0; this._send({ wf: 'queue', mode, code, name, difficulty, map }); }
  cancel() { this._send({ wf: 'cancel' }); }
  sendCmds(cmds) { if (cmds.length) this._send({ wf: 'cmd', cmds }); }
  sendHash(turn, h) { this._send({ wf: 'hash', turn, h }); }
  over() { this._send({ wf: 'over' }); }
  leave() { this._send({ wf: 'leave' }); }

  /** Pop the commands for turn `n` if it has arrived, else null. */
  takeTurn(n) {
    if (!this.turns.length || this.turns[0].n !== n) {
      // drop anything stale (should not happen: the socket is ordered)
      while (this.turns.length && this.turns[0].n < n) this.turns.shift();
      if (!this.turns.length || this.turns[0].n !== n) return null;
    }
    return this.turns.shift().cmds;
  }

  get buffered() { return this.turns.length; }

  close() {
    this.handlers = {};
    try { this.ws?.close(); } catch { /* already closed */ }
    this.ws = null;
  }
}
