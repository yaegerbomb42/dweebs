// WarfareNet.js — Dweeb Warfare online client. Talks to the existing dweebs-server WebSocket
// (same URL resolution as the brawler: ?server= / saved setting / VITE_SERVER_URL / same-origin /ws,
// localhost:8787 in dev) using the JSON `wf` lockstep protocol from server/warfare.js.
// The brawler's binary frames that the server sends every socket (welcome/online counts) are ignored.
export class WarfareNet {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = {};
    this.turns = [];           // received turns, in order
    this.nextTurn = 0;         // next turn number the sim needs
  }

  on(type, fn) { this.handlers[type] = fn; return this; }

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
      ws.onmessage = ev => {
        if (typeof ev.data !== 'string') return;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || typeof m.wf !== 'string') return;
        if (m.wf === 'turn') { this.turns.push(m); this.lastTurnAt = performance.now(); }
        this.handlers[m.wf]?.(m);
      };
    });
  }

  _send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  queue(mode, { code = '', name = 'Dweeb', difficulty = 'normal' } = {}) { this.turns = []; this.nextTurn = 0; this._send({ wf: 'queue', mode, code, name, difficulty }); }
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
