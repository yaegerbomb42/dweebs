/*
 * DWEEBS offline cache (service worker).
 *
 * Why this file exists: src/app/runtime.js registers `${BASE_URL}sw.js` in production, and
 * until now nothing was served at that path — the registration 404'd, so the "offline
 * single-player" deliverable silently did nothing. A registration that fails quietly is
 * worse than no registration, because the code LOOKED like it shipped.
 *
 * What it caches, and why that shape:
 *   - Navigations are NETWORK-FIRST with a cache fallback. Serving a stale index.html is the
 *     classic way to ship a broken build forever, so the HTML never comes from cache while
 *     the network is up.
 *   - /assets/* are content-hashed, so they are immutable and safe to serve cache-first for
 *     as long as they live. Vite can rename a file and no cached copy will ever be served
 *     under the new name.
 *   - Cross-origin requests are ignored completely. There are none today (the offline smoke
 *     asserts exactly that), and there must never be a cached opaque response if one appears:
 *     opaque responses bloat the cache, cannot be inspected, and would be replayed blindly.
 *
 * Bump CACHE_NAME on every deploy that changes the shell. Old caches are dropped in activate.
 */

const CACHE_NAME = 'dweebs-mall-v1';
const SHELL = ['./', './index.html', './favicon.svg', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // individual shell entries may legitimately be missing (favicon variants); one 404
      // must not abort the whole install and leave the app with no offline story at all.
      .then(cache => Promise.allSettled(SHELL.map(path => cache.add(path))))
      .then(() => self.skipWaiting())
  );
});

// Cache only real, complete successes. A cached 404/500 page gets served as the offline
// shell until the next successful navigation, which is how "offline mode" quietly turns into
// "permanently broken until the user clears site data". Opaque/partial responses are excluded
// for the same reason: they cannot be inspected and would be replayed as if they were real.
function stash(key, res) {
  if (!res || !res.ok || res.status !== 200) return;
  const copy = res.clone();
  caches.open(CACHE_NAME).then(c => c.put(key, copy)).catch(() => {});
}

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // Only drop OUR old shells. Deleting every cache we do not own would take out any
      // other app sharing this origin, and that failure is invisible until someone else's
      // offline mode breaks in production.
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('dweebs-') && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;      // never intercept fonts/CDN/anything else
  if (url.pathname.endsWith('/sw.js')) return;          // never cache the worker itself

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => { stash('./', res); return res; })
        .catch(() => caches.match('./').then(r => r || caches.match('./index.html')))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        stash(req, res);
        return res;
      }))
    );
    return;
  }

  // everything else same-origin: answer from cache immediately, refresh in the background
  e.respondWith(
    caches.match(req).then(hit => {
      const refreshed = fetch(req)
        .then(res => { stash(req, res); return res; })
        .catch(() => hit);
      return hit || refreshed;
    })
  );
});
