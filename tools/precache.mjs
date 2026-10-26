// Shared by vite.config.js (build) and test/warfare-offline.test.js: inject the build's hashed
// assets and a build id into the service worker source.
export function precacheList(fileNames) {
  return fileNames
    .filter(f => !f.endsWith('.map') && !/\.woff$/.test(f) && f !== 'index.html' && f !== 'sw.js')
    .sort()
    .map(f => './' + f);
}

export function injectPrecache(src, files, buildId) {
  if (!/const PRECACHE = \[\];/.test(src) || !/const BUILD_ID = 'dev';/.test(src)) {
    throw new Error('sw.js is missing the PRECACHE / BUILD_ID placeholders');
  }
  return src
    .replace(/const PRECACHE = \[\];/, `const PRECACHE = ${JSON.stringify(files)};`)
    .replace(/const BUILD_ID = 'dev';/, `const BUILD_ID = '${buildId}';`);
}
