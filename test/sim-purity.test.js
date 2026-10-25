// T23: sim/ purity gate — no three.js/DOM/audio/Math.random in the sim hot path.
// Catches the #1 regression risk of the split: a view import creeping into headless code.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim');
const files = readdirSync(dir).filter(f => f.endsWith('.js'));
const BANNED = [
  [/from\s+['"]three['"]/, 'three.js import'],
  [/require\(\s*['"]three['"]\s*\)/, 'three.js require'],
  [/\bMath\.random\s*\(/, 'Math.random()'],
  [/\bdocument\b/, 'document'],
  [/\bwindow\b/, 'window'],
  [/\bAudioContext\b/, 'AudioContext'],
  [/\blocalStorage\b/, 'localStorage'],
];
// simView/simAdapter are the bridge: they may mention mesh/visible but never import three.
const BRIDGE_OK = new Set(['simView.js', 'simAdapter.js', 'viewAdapter.js']);
describe('sim purity (T23)', () => {
  it('no banned imports/globals in src/sim/**', () => {
    const violations = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
      const lines = noBlock.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        const code = line.split('//')[0];
        for (const [re, label] of BANNED) {
          if (re.test(code)) violations.push(`${f}:${i + 1}: ${label}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    // Bridge files document the boundary; they still must not import three or call random.
    const hard = violations.filter(v => !BRIDGE_OK.has(v.split(':')[0]) || /three\.js|Math\.random/.test(v));
    expect(hard, hard.join('\n')).toEqual([]);
    expect(violations, violations.join('\n')).toEqual([]);
  });
  it('covers every sim module', () => {
    expect(files.length).toBeGreaterThan(8);
    expect(files).toContain('Sim.js');
  });
});
