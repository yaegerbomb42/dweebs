// QA-owned: light lint config. No formatting rules — never reformat the codebase.
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        location: 'readonly', localStorage: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        performance: 'readonly', console: 'readonly',
        AudioContext: 'readonly', sessionStorage: 'readonly',
        // NET: src/net/** uses the WebSocket API and the TextEncoder/TextDecoder
        // binary helpers, plus URLSearchParams for ?lag=120&loss=2 parsing.
        WebSocket: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        URLSearchParams: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-self-assign': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': ['error', 'except-parens'],
    },
  },
  {
    files: ['test/**/*.js', 'tools/**/*.mjs', 'server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        performance: 'readonly', globalThis: 'readonly',
        // tools/app/** drives Chrome over CDP and serves files with node:http.
        URL: 'readonly', fetch: 'readonly', WebSocket: 'readonly', Buffer: 'readonly',
        // Node 18+ exposes the fetch family (Response/Request/Headers) as globals; the PWA
        // guard test drives public/sw.js inside node:vm with real Response objects.
        Response: 'readonly', Request: 'readonly', Headers: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
    },
  },
  {
    // T23: sim/ purity boundary — nothing in src/sim may import three/DOM/audio.
    // Test file test/sim-purity.test.js enforces the same rule in-suite.
    files: ['src/sim/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['three', 'three/*'] }],
    },
  },
  {
    files: ['*.config.js', 'vite.config.js', 'vitest.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
