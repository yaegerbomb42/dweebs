// lagSim.js — latency and packet-loss injection, on either end of the socket.
/* global URLSearchParams, setTimeout */
//
// Client: NetClient reads ?lag=120&loss=2 from the URL (ms one-way, % loss) and wraps
// send/recv. Server: `node server/index.js --lag 120 --loss 2` applies the same numbers
// to every client, so you can test bad networks without touching the browser.

const DEFAULT = { lag: 0, loss: 0, jitter: 0 };

/** @param {string|URLSearchParams|object} query ?lag=120&loss=2&jitter=20 */
export function parseNetFlags(query) {
  const p = typeof query === 'string' ? new URLSearchParams(query.replace(/^\?/, ''))
    : (query && typeof query.get === 'function') ? query
      : new URLSearchParams(Object.entries(query || {}).map(([k, v]) => `${k}=${v}`).join('&'));
  const num = (k, lo, hi) => {
    const v = Number(p.get(k));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;
  };
  return {
    lag: num('lag', 0, 2000),
    loss: num('loss', 0, 100),
    jitter: num('jitter', 0, 200),
  };
}

/**
 * Wraps a WebSocket-like object (send + addEventListener/onmessage). Outgoing and
 * incoming frames are delayed by `lag` ms (± jitter) and dropped with probability
 * `loss`% — applied independently per direction, as real packet loss behaves.
 * @param {WebSocket|object} sock
 * @param {{lag:number, loss:number, jitter:number}} flags
 * @param {() => number} [rand]
 */
export function addNetSimulation(sock, flags, rand = Math.random) {
  const f = { ...DEFAULT, ...flags };
  if (!f.lag && !f.loss && !f.jitter) return sock;
  const innerSend = sock.send.bind(sock);
  sock.send = data => {
    if (rand() * 100 < f.loss) return;                  // dropped on the way out
    setTimeout(() => innerSend(data), f.lag + (f.jitter ? rand() * f.jitter : 0));
  };

  // Browsers: intercept the message event. Node callers set sock.__onmessage.
  if (typeof sock.addEventListener === 'function') {
    sock.addEventListener('message', ev => {
      if (rand() * 100 < f.loss) return;
      setTimeout(() => {
        if (sock.__onmessage) sock.__onmessage(ev);
        else if (sock.onmessage) sock.onmessage(ev);
      }, f.lag + (f.jitter ? rand() * f.jitter : 0));
    }, { capture: true });
  }
  sock.__lagSim = f;
  return sock;
}
