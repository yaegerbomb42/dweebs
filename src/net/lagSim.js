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
 * Wraps a WebSocket-like object (send + on/addEventListener). Outgoing and
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
  let sendAt = 0;
  sock.send = data => {
    if (rand() * 100 < f.loss) return;                  // dropped on the way out
    // Monotonic, like inbound: TCP never reorders, the sim shouldn't see to either.
    const now = Date.now();
    const delay = f.lag + (f.jitter ? rand() * f.jitter : 0);
    sendAt = Math.max(now + delay, sendAt);
    const wait = sendAt - now;
    if (wait <= 0) innerSend(data);
    else setTimeout(() => innerSend(data), wait);
  };

  // Inbound: delay + drop, delivered EXACTLY once. Two shapes because the two
  // runtimes expose different interception points:
  //
  // Node (ws): override emit(). Every consumer — .on('message'),
  // addEventListener('message'), onmessage= — funnels through it, so this is the
  // single interception point. This also finally makes --lag/--loss apply to
  // server-side inbound frames, which the old code never did (.on bypassed it).
  //
  // Browsers: capture the onmessage= handler (the only inbound API NetClient
  // uses) behind a shadowed property, so the dispatch can't reach it directly.
  //
  // (The old addEventListener interception double-delivered to onmessage= users:
  // the event reached the handler on dispatch AND again from the delayed path —
  // every snapshot processed twice, and a delayed greeting copy could arrive
  // after the real welcome and clobber the client's slot.)
  const innerEmit = typeof sock.emit === 'function' ? sock.emit.bind(sock) : null;
  // Delivery is monotonic per socket: each frame goes out no earlier than the
  // previous one. Independent random delays would reorder frames, which TCP never
  // does — and a reordered greeting arriving after the real welcome used to
  // clobber the client's slot.
  let deliverAt = 0;
  const scheduleIn = (fn, delay) => {
    const now = Date.now();
    deliverAt = Math.max(now + delay, deliverAt);
    const wait = deliverAt - now;
    if (wait <= 0) fn();
    else setTimeout(fn, wait);
  };
  if (innerEmit) {
    sock.emit = (type, ...args) => {
      if (type !== 'message') return innerEmit(type, ...args);
      if (rand() * 100 < f.loss) return false;            // dropped on the way in
      const delay = f.lag + (f.jitter ? rand() * f.jitter : 0);
      scheduleIn(() => innerEmit(type, ...args), delay);
      return true;
    };
  } else {
    let onmsg = null;
    const deliver = ev => {
      if (rand() * 100 < f.loss) return;
      const h = onmsg;
      const delay = f.lag + (f.jitter ? rand() * f.jitter : 0);
      scheduleIn(() => { if (h) h.call(sock, ev); }, delay);
    };
    try {
      Object.defineProperty(sock, 'onmessage', {
        configurable: true, enumerable: true,
        get: () => onmsg,
        set: fn => { onmsg = typeof fn === 'function' ? fn : null; },
      });
      sock.addEventListener('message', deliver);
    } catch {
      // Last resort on exotic targets: plain interception (may double-deliver).
      sock.addEventListener('message', deliver, { capture: true });
    }
  }
  sock.__lagSim = f;
  return sock;
}
