// Offline: the service worker must precache every build asset Dweeb Warfare needs on the FIRST visit,
// and Warfare itself must not depend on the network to play solo.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { injectPrecache, precacheList } from '../tools/precache.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sw = () => readFileSync(join(root, 'public/sw.js'), 'utf8');

function installSW(src) {
  const listeners = new Map();
  const added = [];
  const self = {
    location: new URL('http://localhost:4321/sw.js'),
    addEventListener: (t, fn) => listeners.set(t, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const caches = {
    open: name => Promise.resolve({ name, add: p => { added.push([name, p]); return Promise.resolve(); }, put: () => Promise.resolve() }),
    keys: () => Promise.resolve([]), match: () => Promise.resolve(undefined), delete: () => Promise.resolve(true),
  };
  vm.runInNewContext(src, { self, caches, fetch: () => Promise.reject(new Error('offline')), URL, Promise, console });
  let wait;
  listeners.get('install')({ waitUntil: p => { wait = p; } });
  return wait.then(() => added);
}

describe('warfare offline', () => {
  it('sw.js keeps the build placeholders and a bumped cache version', () => {
    const src = sw();
    expect(src).toMatch(/const PRECACHE = \[\];/);
    expect(src).toMatch(/const BUILD_ID = 'dev';/);
    expect(src).toMatch(/const CACHE_VERSION = 'dweebs-mall-v2';/);
  });
  it('precache list keeps the bundle, css and woff2 fonts; drops maps, woff, html', () => {
    const list = precacheList(['assets/index-a.js', 'assets/index-a.js.map', 'assets/index-b.css', 'assets/f.woff2', 'assets/f.woff', 'index.html', 'sw.js']);
    expect(list).toEqual(['./assets/f.woff2', './assets/index-a.js', './assets/index-b.css']);
  });
  it('install precaches every injected asset plus the shell, under a per-build cache', async () => {
    const files = ['./assets/index-a.js', './assets/index-b.css', './assets/f.woff2'];
    const added = await installSW(injectPrecache(sw(), files, 'b123'));
    const paths = added.map(a => a[1]);
    for (const f of [...files, './', './index.html']) expect(paths).toContain(f);
    expect(new Set(added.map(a => a[0]))).toEqual(new Set(['dweebs-mall-v2-b123']));
  });
  it('injection refuses a worker without placeholders (so a broken build fails loudly)', () => {
    expect(() => injectPrecache('self.x = 1', [], 'x')).toThrow();
  });
  it('solo Warfare code makes no network requests', () => {
    const dir = join(root, 'src/warfare');
    const files = readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'WarfareNet.js').map(f => join(dir, f));
    files.push(...readdirSync(join(root, 'src/sim')).filter(f => f.startsWith('warfare')).map(f => join(root, 'src/sim', f)));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\bfetch\(|https?:\/\/|new WebSocket|XMLHttpRequest/);
    }
  });
});
