// challenge-m1.mjs — Empirical challenge and stress testing harness for Milestone 1.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Minimal shim for router tests in pure Node
const eventListeners = new Map();
globalThis.window = globalThis;
globalThis.addEventListener = (t, f) => {
  if (!eventListeners.has(t)) eventListeners.set(t, []);
  eventListeners.get(t).push(f);
};
globalThis.removeEventListener = (t, f) => {
  const list = eventListeners.get(t);
  if (list) {
    const idx = list.indexOf(f);
    if (idx >= 0) list.splice(idx, 1);
  }
};
globalThis.dispatchEvent = (e) => {
  for (const f of eventListeners.get(e.type) || []) f(e);
  return true;
};
globalThis.location = { hash: '', origin: 'http://localhost', pathname: '/', search: '' };
globalThis.history = {
  pushState(s, t, u) { globalThis.location.hash = u; },
  replaceState(s, t, u) { globalThis.location.hash = u; },
  back() {},
};

let pass = 0;
let fail = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    results.push({ name, passed: false, error: err.message });
    console.error(`  ✗ ${name}\n    Error: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    pass++;
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    results.push({ name, passed: false, error: err.message });
    console.error(`  ✗ ${name}\n    Error: ${err.message}`);
  }
}

console.log('====================================================');
console.log('CHALLENGER M1: EMPIRICAL VERIFICATION HARNESS');
console.log('====================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: DOM Elements & Mall Title Shell
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- GROUP 1: DOM Elements & Mall Title Shell ---');

const screensJs = read('src/app/screens.js');
const indexHtml = read('index.html');

test('Mall Subtitle: displays 4 massive physics experiences', () => {
  assert.match(
    screensJs,
    /<p class="mall-subtitle">\s*4 massive physics experiences — one living universe\s*<\/p>/,
    'screens.js must contain updated mall-subtitle'
  );
  assert.doesNotMatch(
    screensJs,
    /5 games in one living universe/i,
    'obsolete "5 games" subtitle must not be present'
  );
});

test('Mall Grid: contains exactly 4 experience cards in responsive grid', () => {
  assert.match(
    screensJs,
    /<div class="mall-grid"[^>]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(280px,\s*1fr\)\)/,
    'mall-grid must have responsive repeat(auto-fit, minmax(280px, 1fr)) style'
  );
  assert.match(screensJs, /id="mall-card-1"/, 'Card 1 (Knockout Arena) must exist');
  assert.match(screensJs, /id="mall-card-2"/, 'Card 2 (Expedition & Dynasty) must exist');
  assert.match(screensJs, /id="mall-card-5"/, 'Card 3 (Dweeb Warfare) must exist');
  assert.match(screensJs, /id="mall-card-builder"/, 'Card 4 (Build-A-Dweeb) must exist');

  // Verify obsolete cards are removed from the grid
  assert.doesNotMatch(screensJs, /id="mall-card-3"/, 'Obsolete Card 3 (Escape Rooms) must be removed');
  assert.doesNotMatch(screensJs, /id="mall-card-4"/, 'Obsolete Card 4 (Mimic & Mutate) must be removed');
});

test('Card 4 (Build-A-Dweeb): styling parity and no anomalous dark inline style', () => {
  const cardBuilderMatch = screensJs.match(/<article class="mall-card card-builder"[^>]*>([\s\S]*?)<\/article>/);
  assert.ok(cardBuilderMatch, 'Card builder article must be present');
  const cardContent = cardBuilderMatch[0];

  assert.doesNotMatch(
    cardContent,
    /style="[^"]*background:\s*#281845/i,
    'Card 4 must not have dark inline background override'
  );
  assert.doesNotMatch(
    cardContent,
    /style="[^"]*border-color:\s*#ffd23f/i,
    'Card 4 must not have inline border-color override'
  );
  assert.match(cardContent, /class="mall-badge badge-purple"/, 'Card 4 must have badge-purple class');
  assert.match(cardContent, /class="btn mall-btn purple"\s+id="app-btn-builder"/, 'Card 4 button must have purple class');
});

test('1-Click Mall Exit in #pause-screen (index.html)', () => {
  const pauseScreenMatch = indexHtml.match(/<div id="pause-screen"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(pauseScreenMatch, '#pause-screen must exist');
  const pauseHtml = pauseScreenMatch[0];

  assert.match(
    pauseHtml,
    /<button class="btn yellow" id="btn-pause-mall">\s*🏛️ THE DWEEB MALL\s*<\/button>/,
    '#btn-pause-mall must be present with .btn.yellow class and label "🏛️ THE DWEEB MALL"'
  );
});

test('1-Click Mall Exit in #results-screen (index.html)', () => {
  const resultsScreenMatch = indexHtml.match(/<div id="results-screen"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(resultsScreenMatch, '#results-screen must exist');
  const resultsHtml = resultsScreenMatch[0];

  assert.match(
    resultsHtml,
    /<button class="btn yellow" id="btn-results-mall">\s*🏛️ THE DWEEB MALL\s*<\/button>/,
    '#btn-results-mall must be present with .btn.yellow class and label "🏛️ THE DWEEB MALL"'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: Routing Behavior & Match Lock Clearing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- GROUP 2: Routing Behavior & Match Lock Clearing ---');

const bootJs = read('src/app/boot.js');
const mainJs = read('src/main.js');

test('boot.js: match lock clearing microtask listener includes mall exit buttons', () => {
  const listenerChunk = bootJs.match(/for\s*\(\s*const id of \[(.*?)\]\s*\)\s*\{\s*document\.getElementById\(id\)\?\.addEventListener\('click'/);
  assert.ok(listenerChunk, 'microtask unlock listener array must exist');
  assert.match(listenerChunk[1], /'btn-pause-mall'/, 'must include btn-pause-mall');
  assert.match(listenerChunk[1], /'btn-results-mall'/, 'must include btn-results-mall');
});

test('boot.js: dedicated click handlers for btn-pause-mall and btn-results-mall unlock and go to /', () => {
  assert.match(
    bootJs,
    /for\s*\(\s*const id of \['btn-pause-mall',\s*'btn-results-mall'\]\)\s*\{\s*document\.getElementById\(id\)\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*router\.setMatchLock\(false\);\s*router\.go\('\/'\);/,
    'boot.js must explicitly call router.setMatchLock(false) and router.go("/") on mall button click'
  );
});

test('boot.js: watchGameScreens onMenu guard prevents redirect when returning to mall', () => {
  assert.match(
    bootJs,
    /onMenu:\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(router\.path === '\/' \|\| location\.hash === '#\/' \|\| location\.hash === ''\)\s*return;/,
    'onMenu must guard against redirecting to /play when path or hash is root /'
  );
});

test('main.js: returnToMall helper clears pause, rematch, hides menus and navigates to mall', () => {
  assert.match(mainJs, /const returnToMall = \(\) => \{/, 'returnToMall helper must exist');
  assert.match(mainJs, /setPaused\(false\);/, 'returnToMall must unpause');
  assert.match(mainJs, /clearRematch\(\);/, 'returnToMall must clear rematch');
  assert.match(mainJs, /toMenu\(\);/, 'returnToMall must call toMenu()');
  assert.match(mainJs, /\$\('main-menu'\)\?\.classList\.add\('hidden'\);/, 'returnToMall must hide main-menu');
  assert.match(mainJs, /window\.__dweebsApp\.router\.setMatchLock\(false\);/, 'returnToMall must clear router match lock');
  assert.match(mainJs, /window\.__dweebsApp\.router\.go\('\/'\);/, 'returnToMall must call router.go("/")');
});

test('main.js: returnToMall event bindings', () => {
  assert.match(mainJs, /\$\('btn-pause-mall'\)\?\.addEventListener\('click',\s*returnToMall\);/);
  assert.match(mainJs, /\$\('btn-results-mall'\)\?\.addEventListener\('click',\s*returnToMall\);/);
  assert.match(mainJs, /\$\('btn-switcher-to-mall'\)\?\.addEventListener\('click',\s*returnToMall\);/);
  assert.match(mainJs, /\$\('btn-back-to-mall'\)\?\.addEventListener\('click',\s*returnToMall\);/);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: Sub-Mode Stock Configurations & Game Launch
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- GROUP 3: Sub-Mode Stock Configurations & Rules ---');

await testAsync('GAME_MODES: stock configuration rules', async () => {
  const { GAME_MODES } = await import('../src/game/GameModes.js');
  assert.equal(GAME_MODES.derby?.stocks, 99, 'Derby mode must have 99 stocks');
  assert.equal(GAME_MODES.walldrop?.stocks, 1, 'Wall Drop mode must have 1 stock');
  assert.equal(GAME_MODES.brawl?.stocks, 3, 'Brawl mode must have 3 stocks');
  assert.equal(GAME_MODES.adventure?.stocks, 999, 'Adventure mode must have 999 stocks');
  assert.equal(GAME_MODES.warfare?.stocks, 999, 'Warfare mode must have 999 stocks');
  assert.equal(GAME_MODES.build?.stocks, 3, 'Build mode must have 3 stocks');
});

test('main.js: startMatch applies authentic mode stocks instead of stale settings', () => {
  assert.match(
    mainJs,
    /match\.settings\.stocks\s*=\s*\(GAME_MODES\[currentMode\]\?\.stocks\s*\?\?\s*\+settings\.stocks\);/,
    'startMatch must assign match.settings.stocks from GAME_MODES[currentMode]'
  );
  assert.match(
    mainJs,
    /match\.settings\.mode\s*=\s*currentMode;/,
    'startMatch must assign match.settings.mode'
  );
});

await testAsync('Match.js: startMatch & beginRound sets stock count on each dweeb and handles elimination', async () => {
  const { Match } = await import('../src/game/Match.js');
  const { GAME_MODES } = await import('../src/game/GameModes.js');

  for (const [mode, expectedStocks] of [
    ['derby', 99],
    ['walldrop', 1],
    ['brawl', 3],
  ]) {
    const match = new Match();
    match.settings.mode = mode;
    match.settings.stocks = GAME_MODES[mode].stocks;

    const mockDweebs = [
      { id: 0, active: true, stocks: 0, percent: 0, eliminated: false, deaths: 0, kills: 0 },
      { id: 1, active: true, stocks: 0, percent: 0, eliminated: false, deaths: 0, kills: 0 },
    ];

    match.startMatch(mockDweebs);
    match.beginRound();

    assert.equal(match.settings.stocks, expectedStocks, `${mode} match settings stocks must be ${expectedStocks}`);
    assert.equal(mockDweebs[0].stocks, expectedStocks, `dweeb 0 initial stocks in ${mode} must be ${expectedStocks}`);
    assert.equal(mockDweebs[1].stocks, expectedStocks, `dweeb 1 initial stocks in ${mode} must be ${expectedStocks}`);

    // Simulate 1 death
    mockDweebs[0].stocks--;
    if (mockDweebs[0].stocks <= 0) {
      mockDweebs[0].eliminated = true;
    }

    if (mode === 'walldrop') {
      assert.equal(mockDweebs[0].stocks, 0, 'walldrop dweeb has 0 stocks after 1 death');
      assert.equal(mockDweebs[0].eliminated, true, 'walldrop dweeb eliminated after 1 death');
    } else if (mode === 'brawl') {
      assert.equal(mockDweebs[0].stocks, 2, 'brawl dweeb has 2 stocks remaining after 1 death');
      assert.equal(mockDweebs[0].eliminated, false, 'brawl dweeb NOT eliminated after 1 death');
    } else if (mode === 'derby') {
      assert.equal(mockDweebs[0].stocks, 98, 'derby dweeb has 98 stocks remaining after 1 death');
      assert.equal(mockDweebs[0].eliminated, false, 'derby dweeb NOT eliminated after 1 death');
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: Functional Simulation & Stress Testing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- GROUP 4: Functional Simulation & Stress Testing ---');

await testAsync('Router: lock & unlock lifecycle stress test', async () => {
  const { createRouter } = await import('../src/app/router.js');
  globalThis.location.hash = '#/match';

  let routed = null;
  const router = createRouter({
    onRoute: (r) => { routed = r; },
  });

  router.setMatchLock(true);
  assert.equal(router.locked, true, 'router must be locked');

  // Attempt navigation while locked
  router.go('/play');
  assert.equal(router.path, '/match', 'locked router must block navigation away from /match');

  // Unlock and navigate to /
  router.setMatchLock(false);
  assert.equal(router.locked, false, 'router must be unlocked');
  router.go('/');
  assert.equal(router.path, '/', 'unlocked router must navigate to /');
});

test('returnToMall: safe fallback when window.__dweebsApp is undefined', () => {
  const codeFragment = mainJs.slice(mainJs.indexOf('const returnToMall'), mainJs.indexOf('const returnToMall') + 400);
  assert.match(
    codeFragment,
    /if\s*\(window\.__dweebsApp\?\.router\)\s*\{[\s\S]*?\}\s*else\s*\{\s*location\.hash\s*=\s*'#\/';\s*\}/,
    'returnToMall must have a fallback when window.__dweebsApp or router is not present'
  );
});

test('Match.js: pausedForCinema guards ROUND_END phaseTimer countdown', () => {
  const matchJs = read('src/game/Match.js');
  assert.match(
    matchJs,
    /if\s*\(this\.phase === Phase\.ROUND_END\)\s*\{\s*if\s*\(this\.pausedForCinema\)\s*return;/,
    'Match.js must guard round end timer with pausedForCinema'
  );
});

test('Match.js: adventure mode disables sudden death timer', () => {
  const matchJs = read('src/game/Match.js');
  assert.match(
    matchJs,
    /if\s*\(this\.phase !== Phase\.PLAYING\)\s*return;\s*if\s*\(this\.settings\.mode === 'adventure'\)\s*return;/,
    'Match.js must bypass match timer in adventure mode'
  );
});

console.log('\n====================================================');
console.log(`SUMMARY: ${pass} passed, ${fail} failed (Total: ${pass + fail})`);
console.log('====================================================');

if (fail > 0) {
  process.exit(1);
}
