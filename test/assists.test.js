// assists.test.js — KO assist tracking.
import { describe, it, expect } from 'vitest';

// Minimal fake dweebs with the creditAssists contract.
function fakeDweeb(name) {
  return {
    name,
    assists: 0,
    recentHits: [],
    creditAssists(killer) {
      const seen = new Set();
      const assisters = [];
      for (const h of this.recentHits) {
        if (h.attacker && h.attacker !== killer && h.attacker !== this && !seen.has(h.attacker)) {
          seen.add(h.attacker);
          h.attacker.assists = (h.attacker.assists || 0) + 1;
          assisters.push(h.attacker);
        }
      }
      this.recentHits.length = 0;
      return assisters;
    },
  };
}

describe('assist credit', () => {
  it('credits recent damagers besides the killer', () => {
    const victim = fakeDweeb('victim');
    const killer = fakeDweeb('killer');
    const helper = fakeDweeb('helper');
    victim.recentHits = [
      { attacker: helper, time: 10 },
      { attacker: killer, time: 11 },
    ];
    const assisters = victim.creditAssists(killer);
    expect(assisters).toEqual([helper]);
    expect(helper.assists).toBe(1);
    expect(killer.assists).toBe(0);
  });

  it('dedupes multiple hits from the same helper', () => {
    const victim = fakeDweeb('victim');
    const killer = fakeDweeb('killer');
    const helper = fakeDweeb('helper');
    victim.recentHits = [
      { attacker: helper, time: 10 },
      { attacker: helper, time: 10.5 },
      { attacker: killer, time: 11 },
    ];
    victim.creditAssists(killer);
    expect(helper.assists).toBe(1);
  });

  it('no assisters when only the killer hit', () => {
    const victim = fakeDweeb('victim');
    const killer = fakeDweeb('killer');
    victim.recentHits = [{ attacker: killer, time: 11 }];
    expect(victim.creditAssists(killer)).toEqual([]);
  });

  it('clears recent hits after crediting', () => {
    const victim = fakeDweeb('victim');
    const killer = fakeDweeb('killer');
    victim.recentHits = [{ attacker: killer, time: 11 }];
    victim.creditAssists(killer);
    expect(victim.recentHits).toEqual([]);
  });

  it('self-hits do not count', () => {
    const victim = fakeDweeb('victim');
    const killer = fakeDweeb('killer');
    victim.recentHits = [{ attacker: victim, time: 10 }, { attacker: killer, time: 11 }];
    expect(victim.creditAssists(killer)).toEqual([]);
  });
});
