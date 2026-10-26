import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { injectPrecache, precacheList } from './tools/precache.mjs';

/**
 * Writes the hashed build assets into dist/sw.js so the service worker precaches them on install
 * (offline after the first visit). Source maps and legacy .woff duplicates are skipped.
 */
function precacheManifest() {
  let outDir = 'dist';
  return {
    name: 'dweebs-precache-manifest',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    writeBundle(_opts, bundle) {
      const sw = join(outDir, 'sw.js');
      if (!existsSync(sw)) return;
      writeFileSync(sw, injectPrecache(readFileSync(sw, 'utf8'), precacheList(Object.keys(bundle)), Date.now().toString(36)));
    },
  };
}

export default defineConfig({
  plugins: [precacheManifest()],
  base: './',
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat']
  }
});

