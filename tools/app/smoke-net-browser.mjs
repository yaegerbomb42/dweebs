/* global fetch, WebSocket */
// smoke-net-browser.mjs — THE two-browser test the board has been missing.
//
// Opens two REAL Chrome tabs, both running the shipped NetClient against the real
// authoritative server (DWEEBS_SIM=real), and compares them at the same server tick.
// Everything before this ran Node's `ws` behind a shim; this is the first check of the
// parts a browser does differently: BinaryType=arraybuffer frames, the real event loop,
// the real clock. It also asserts the world actually MOVED — a frozen server agrees with
// itself perfectly, which is how the lobby-phase bug hid.
//
//   node tools/app/smoke-net-browser.mjs
// Env: CHROME_PATH, SMOKE_PORT (static), NET_PORT (server)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE_PORT = Number(process.env.SMOKE_PORT || 4399);
const NET_PORT = Number(process.env.NET_PORT || 8831);
const CDP_PORT = Number(process.env.CDP_PORT || 9344);
// NB: the room alphabet deliberately excludes I/L/O (a code must survive being read aloud),
// so a hand-written code like 'SMOK' is REJECTED as malformed. Use ROOM_ALPHABET letters.
const ROOM = 'SWMQ';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

// ─── static server for the project root (the probe's import graph is plain relative ESM,
// so no bundler is needed — which is also why this test can run against source) ───
const site = createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, p === '/' ? 'index.html' : p);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => site.listen(SITE_PORT, r));

const simMode = process.env.DWEEBS_SIM || 'real';
const srv = spawn(process.execPath, [join(ROOT, 'server', 'index.js'), '--port', String(NET_PORT), '--codec', 'bin'],
  { cwd: ROOT, env: { ...process.env, DWEEBS_SIM: simMode }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; if (process.env.VERBOSE) process.stdout.write(`[srv] ${d}`); });
srv.stderr.on('data', d => { srvLog += d; process.stderr.write(`[srv!] ${d}`); });
await sleep(900);

// ─── chrome ───
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=/tmp/dweebs-net-${Date.now()}`,
  '--window-size=1024,768', 'about:blank'], { stdio: 'ignore' });

// Tab management. Chrome is launched with ONE about:blank, so a second tab has to be
// created over CDP rather than assumed: Target.createTarget on the browser-level socket,
// then attach to the page target it hands back. (Assuming "Chrome opens N tabs from N URL
// args" is the kind of thing that works until it doesn't.)
let browserWs = null;
async function browserSocket() {
  if (browserWs) return browserWs;
  for (let i = 0; i < 60; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      browserWs = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise(res => browserWs.onopen = res);
      return browserWs;
    } catch { await sleep(200); }
  }
  throw new Error('no CDP browser endpoint');
}
async function createTarget(url) {
  const ws = await browserSocket();
  const id = Math.floor(Math.random() * 1e9);
  ws.send(JSON.stringify({ id, method: 'Target.createTarget', params: { url } }));
  const targetId = await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('Target.createTarget timed out')), 8000);
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id === id) { clearTimeout(to); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result.targetId); }
    };
  });
  return targetId;
}

async function attachPage(targetId) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.id === targetId);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(res => ws.onopen = res);
        const t = { ws, targetId, id: 0, pending: new Map() };
        ws.onmessage = e => {
          const m = JSON.parse(e.data);
          if (m.id && t.pending.has(m.id)) { const { res, rej } = t.pending.get(m.id); t.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
        };
        return t;
      }
    } catch { /* target not listed yet */ }
    await sleep(200);
  }
  throw new Error('no chrome tab available');
}
function send(t, method, params = {}) {
  const i = ++t.id;
  return new Promise((res, rej) => { t.pending.set(i, { res, rej }); t.ws.send(JSON.stringify({ id: i, method, params })); });
}
async function evalJS(t, expr) {
  const r = await send(t, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result.value;
}
const mkTab = async (url) => {
  const t = await attachPage(await createTarget('about:blank'));
  await send(t, 'Page.enable');
  await send(t, 'Page.navigate', { url });
  return t;
};
await sleep(600);

const url = (extra) => `http://127.0.0.1:${SITE_PORT}/tools/app/netSmokePage.html?server=ws://127.0.0.1:${NET_PORT}&room=${ROOM}&${extra}`;

console.log(`\n=== two browsers, DWEEBS_SIM=${simMode}, one real server on :${NET_PORT} ===`);

// ─── browser A joins and creates the room; browser B joins after A is in ───
const A = await mkTab(url('create=1&name=browserA'));
let a = null;
for (let i = 0; i < 80; i++) { await sleep(250); a = await evalJS(A, 'window.__netSmoke'); if (a?.alive) break; }
ok(!!a?.alive, `browser A joined (status=${a?.status} slot=${a?.slot})`);

const B = await mkTab(url('create=0&name=browserB'));
let b = null;
for (let i = 0; i < 80; i++) { await sleep(250); b = await evalJS(B, 'window.__netSmoke'); if (b?.alive) break; }
ok(!!b?.alive, `browser B joined (status=${b?.status} slot=${b?.slot})`);
ok(a?.slot >= 0 && b?.slot >= 0 && a.slot !== b.slot, `distinct slots: A=${a?.slot} B=${b?.slot}`);

// ─── let them play, then compare at a shared authoritative tick ───
await sleep(4000);
const snapShot = (t) => evalJS(t, `(() => { const M = window.__netSmoke; const ticks = Object.keys(M.snapByTick||{}); return { status: M.status, slot: M.slot, snaps: M.snaps, events: M.events, movedCm: M.maxEntityCm, entities: M.entities, rtt: Math.round(M.rtt||0), ticks: ticks.map(Number), lastTick: M.tick }; })()`);
const A2 = await snapShot(A);
const B2 = await snapShot(B);

ok(A2.snaps > 30 && B2.snaps > 30, `both browsers received snapshots (A=${A2.snaps} B=${B2.snaps})`);
ok((A2.movedCm || 0) > 50, `browser A world is alive (moved ${Math.round(A2.movedCm || 0)} cm)`);
ok((B2.movedCm || 0) > 50, `browser B world is alive (moved ${Math.round(B2.movedCm || 0)} cm)`);
ok(A2.lastTick > 60 && B2.lastTick > 60, `server tick advancing (A=${A2.lastTick} B=${B2.lastTick})`);

// The decisive check: the highest server tick both browsers saw must be byte-identical.
const common = A2.ticks.filter(t => B2.ticks.includes(t)).sort((x, y) => y - x)[0];
ok(common !== undefined, `both browsers saw tick ${common} (A had ${A2.ticks.length}, B had ${B2.ticks.length} buffered)`);
if (common !== undefined) {
  const [ea, eb] = await Promise.all([
    evalJS(A, `JSON.stringify(window.__netSmoke.snapByTick[${common}])`),
    evalJS(B, `JSON.stringify(window.__netSmoke.snapByTick[${common}])`),
  ]);
  const sa = JSON.parse(ea), sb = JSON.parse(eb);
  let worst = 0, compared = 0;
  for (const id of Object.keys(sa)) {
    if (!sb[id]) continue;
    compared++;
    worst = Math.max(worst, Math.abs(sa[id].x - sb[id].x), Math.abs(sa[id].y - sb[id].y), Math.abs(sa[id].z - sb[id].z), Math.abs(sa[id].q - sb[id].q), Math.abs(sa[id].state - sb[id].state));
  }
  ok(compared >= 4, `compared ${compared} entities at tick ${common}`);
  ok(worst === 0, `cross-browser disagreement at tick ${common}: ${worst} (must be 0)`);
}

console.log(`\nA: ${JSON.stringify(A2)}`);
console.log(`B: ${JSON.stringify(B2)}`);
if (srvLog.includes('keyframe')) console.log(`server keyframes: ${srvLog.split('\n').filter(l => l.includes('keyframe')).length}`);
console.log(fail ? `\nFAIL (${fail} of ${pass + fail})` : `\nPASS (${pass}/${pass})`);

chrome.kill('SIGKILL');
srv.kill('SIGINT');
site.close();
process.exit(fail ? 1 : 0);
