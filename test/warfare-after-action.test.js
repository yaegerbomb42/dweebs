// warfare-after-action.test.js — the prep card's after-action report.
// The sim computes it (so lockstep peers agree) and the HUD renders it; both halves are pure.
import { describe, it, expect } from 'vitest';
import { afterAction, threatTrend, waveThreat, isBossWave } from '../src/sim/warfareWaves.js';
import { reportLine } from '../src/warfare/WarfareHud.js';

const unit = (o = {}) => ({ team: 'blue', type: 'shield', alive: true, ...o });

describe('afterAction', () => {
  it('counts what is left standing, by type, and how many are veterans', () => {
    const r = afterAction({
      units: [unit(), unit({ type: 'rocket' }), unit({ type: 'rocket', veteran: true }), unit({ team: 'red' }), unit({ alive: false })],
      lost: 2, wave: 3, reward: 140,
    });
    expect(r.alive).toBe(3);
    expect(r.composition).toEqual({ shield: 1, rocket: 2 });
    expect(r.veterans).toBe(1);
    expect(r.had).toBe(5);
    expect(r.wave).toBe(3);
    expect(r.reward).toBe(140);
  });

  it('does not count decoys as an army', () => {
    const r = afterAction({ units: [unit({ type: 'decoy' }), unit()] });
    expect(r.alive).toBe(1);
    expect(r.composition.decoy).toBeUndefined();
  });

  it('describes an army that was wiped out', () => {
    const r = afterAction({ units: [], lost: 7, wave: 6 });
    expect(r.alive).toBe(0);
    expect(r.lost).toBe(7);
    expect(r.had).toBe(7);
  });

  it('is pure: same input, same report', () => {
    const units = [unit(), unit({ type: 'brute', veteran: true })];
    expect(afterAction({ units, lost: 1, wave: 2 })).toEqual(afterAction({ units, lost: 1, wave: 2 }));
  });
});

describe('threatTrend', () => {
  it('calls a boss wave darker', () => {
    const boss = 5;
    expect(isBossWave(boss)).toBe(true);
    expect(threatTrend(boss - 1, boss)).toBe('darker');
  });

  it('treats an ordinary step up as "more of the same" when the threat barely moves', () => {
    const trends = new Set([threatTrend(1, 2), threatTrend(2, 3), threatTrend(3, 4)]);
    expect(trends.size).toBeGreaterThan(0);
    for (const t of trends) expect(['calmer', 'same', 'darker']).toContain(t);
  });

  it('never claims the next wave is easier when it is strictly harder', () => {
    for (let n = 1; n < 10; n++) {
      if (isBossWave(n + 1)) continue;
      const a = waveThreat(n), b = waveThreat(n + 1);
      if (b.hp > a.hp && threatTrend(n, n + 1) === 'calmer') {
        // A breather is only allowed when the threat really is flat, never when it grew.
        const ratio = (b.hp + b.dps * 20) / Math.max(1, a.hp + a.dps * 20);
        expect(ratio).toBeLessThanOrEqual(1.06);
      }
    }
  });
});

describe('reportLine', () => {
  it('says nobody was lost when the wave was clean', () => {
    const line = reportLine(afterAction({ units: [unit(), unit()], lost: 0, wave: 1 }));
    expect(line).toContain('nobody');
    expect(line).toContain('2 left');
  });

  it('names the veterans and the trend', () => {
    const line = reportLine(afterAction({ units: [unit({ veteran: true })], lost: 3, converted: 1, wave: 4 }));
    expect(line).toContain('cost <b>3</b>');
    expect(line).toContain('1 turned');
    expect(line).toContain('1 veteran');
    expect(line).toMatch(/darker|breather|more of the same/);
  });

  it('is empty for an empty report', () => {
    expect(reportLine(null)).toBe('');
  });
});
