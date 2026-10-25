// T24: the offline/PWA story has to be TRUE, not just declared.
//
// Why this file exists: src/app/runtime.js registers `${BASE_URL}sw.js` in production and
// index.html links /manifest.webmanifest, but for a while neither file was in public/. The
// registration 404'd, so "offline single-player" shipped as a no-op with a console error —
// caught only by tools/app/smoke-shell.mjs, which is a Chrome harness and therefore too slow
// and too optional to guard a regression this easy to make. These tests are the fast guard.
//
// The second half runs public/sw.js for real inside node:vm with fake `self`/`caches`/`fetch`,
// because the interesting failures are behavioural (serving a 500 as the offline shell,
// answering for a cross-origin request) rather than textual.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
// Read lazily: if public/sw.js goes missing, the existence test must report THAT, instead of
// throwing during module collection and taking the whole suite down with it.
const swSrc = () => read('public/sw.js');
const ORIGIN = 'http://localhost:4321';
const SW_URL = `${ORIGIN}/sw.js`;

describe('declared offline assets exist (T24)', () => {
  it('every service worker src/app/runtime.js registers is served', () => {
    const src = read('src/app/runtime.js');
    const declared = [...src.matchAll(/register\(\s*`\$\{[^}]+\}([A-Za-z0-9_.-]+)`/g)].map(m => m[1]);
    expect(declared, 'runtime.js no longer registers a service worker — update this test').toContain('sw.js');
    for (const file of declared) {
      expect(existsSync(join(root, 'public', file)), `public/${file} is registered but does not exist`).toBe(true);
    }
  });

  it('the manifest linked from index.html exists and is installable JSON', () => {
    const href = read('index.html').match(/<link[^>]+rel="manifest"[^>]+href="([^"]+)"/)?.[1];
    expect(href, 'index.html must link a web manifest').toBeTruthy();
    const file = join(root, 'public', href.replace(/^\//, ''));
    expect(existsSync(file), `manifest ${href} does not exist in public/`).toBe(true);
    const m = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of ['name', 'short_name', 'start_url', 'display', 'theme_color', 'icons']) {
      expect(m[key], `manifest.${key} is required for installability`).toBeTruthy();
    }
    expect(m.icons.length).toBeGreaterThan(0);
    expect(m.icons[0].src.replace(/^\//, '')).toBe('favicon.svg');
    expect(existsSync(join(root, 'public', 'favicon.svg'))).toBe(true);
  });
});

/** Minimal service-worker environment: a cache store keyed by absolute URL, a scriptable
 *  fetch, and listener capture so a test can fire install/activate/fetch by hand. */
function bootSW({ fetchImpl }) {
  const listeners = new Map();
  const stores = new Map();
  const abs = u => new URL(typeof u === 'string' ? u : u.url, SW_URL).href;
  const cache = name => {
    const store = stores.get(name) ?? new Map();
    stores.set(name, store);
    return {
      add: async u => { const res = await fetchImpl(abs(u)); if (!res.ok) throw new Error(`add ${u} -> ${res.status}`); store.set(abs(u), res); },
      put: async (key, res) => { store.set(abs(key), res); },
      match: async key => store.get(abs(key)),
    };
  };
  const caches = {
    open: async name => cache(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async key => {
      for (const store of stores.values()) if (store.has(abs(key))) return store.get(abs(key));
      return undefined;
    },
    _stores: stores,
  };
  const self = {
    location: { href: SW_URL, origin: ORIGIN },
    addEventListener: (type, fn) => listeners.set(type, fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(swSrc(), { self, caches, fetch: fetchImpl, URL, Response, Request, console });
  const fire = type => { const ev = { waitUntil: p => (ev.done = p) }; listeners.get(type)(ev); return ev.done; };
  const request = (url, extra = {}) => {
    const ev = { request: { method: 'GET', mode: 'cors', url: new URL(url, ORIGIN).href, ...extra } };
    listeners.get('fetch')({ ...ev, respondWith: p => { ev.response = p; } });
    return ev.response;
  };
  return { fire, request, caches };
}

const ok = body => new Response(body, { status: 200 });

describe('service worker behaviour (T24)', () => {
  it('precaches the shell and survives a missing file', async () => {
    const served = new Set([`${ORIGIN}/`, `${ORIGIN}/index.html`, `${ORIGIN}/manifest.webmanifest`]);
    const { fire, caches } = bootSW({ fetchImpl: async url => (served.has(url) ? ok('x') : new Response('', { status: 404 })) });
    await expect(fire('install')).resolves.toBeUndefined();   // one 404 must not abort install
    expect(await caches.match(`${ORIGIN}/index.html`)).toBeTruthy();
    expect(await caches.match(`${ORIGIN}/manifest.webmanifest`)).toBeTruthy();
  });

  it("drops obsolete shells but never someone else's cache", async () => {
    const { fire, caches } = bootSW({ fetchImpl: async () => new Response('', { status: 404 }) });
    caches._stores.set('dweebs-v1', new Map());
    caches._stores.set('some-other-app', new Map());
    await fire('activate');
    expect(caches._stores.has('dweebs-v1')).toBe(false);
    expect(caches._stores.has('some-other-app'), 'activate must not clear foreign caches').toBe(true);
  });

  it('ignores non-GET, cross-origin and its own script', async () => {
    const { request } = bootSW({ fetchImpl: async () => ok('x') });
    expect(request(`${ORIGIN}/index.html`, { method: 'POST' })).toBeUndefined();
    expect(request('http://127.0.0.1:8831/mnet'), 'the netcode server must never be intercepted').toBeUndefined();
    expect(request(`${ORIGIN}/sw.js`)).toBeUndefined();
  });

  it('navigations are network-first, then the cached shell (the actual offline promise)', async () => {
    let online = true;
    const { request } = bootSW({ fetchImpl: async () => { if (!online) throw new TypeError('offline'); return ok('<html>fresh</html>'); } });
    const live = await request(`${ORIGIN}/`, { mode: 'navigate' });
    expect(await live.text()).toBe('<html>fresh</html>');
    online = false;
    const offline = await request(`${ORIGIN}/`, { mode: 'navigate' });
    expect(offline, 'offline navigation must fall back to the cached shell').toBeTruthy();
    expect(await offline.text()).toBe('<html>fresh</html>');
  });

  it('never caches a failed navigation as the shell', async () => {
    const { request, caches } = bootSW({ fetchImpl: async () => new Response('boom', { status: 500 }) });
    const res = await request(`${ORIGIN}/`, { mode: 'navigate' });
    expect(res.status).toBe(500);
    await new Promise(r => setTimeout(r, 0));   // let the background put() settle
    expect(await caches.match(`${ORIGIN}/`), 'a 500 must not become the offline shell').toBeUndefined();
  });

  it('serves hashed assets cache-first so a second load works offline', async () => {
    let online = true;
    const { request } = bootSW({ fetchImpl: async () => { if (!online) throw new TypeError('offline'); return ok('bundle'); } });
    expect(await (await request(`${ORIGIN}/assets/index-abc.js`)).text()).toBe('bundle');
    online = false;
    const cached = await request(`${ORIGIN}/assets/index-abc.js`);
    expect(await cached.text(), 'cached asset must survive the network going away').toBe('bundle');
  });
});
