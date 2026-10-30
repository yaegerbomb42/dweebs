// splicer.test.js — DNA splicer.
import { describe, it, expect } from 'vitest';
import { splice, randomMask, TRAITS } from '../src/builder/splicer.js';

const parentA = {
  name: 'Alpha', bodyShape: 'blob', feet: 'sneakers', brows: 'angry',
  mouth: 'smile', palette: 'ember', primaryColor: '#ff0000', accentColor: '#00ff00',
  appendages: ['horns'],
};
const parentB = {
  name: 'Beta', bodyShape: 'cube', feet: 'boots', brows: 'sad',
  mouth: 'frown', palette: 'frost', primaryColor: '#0000ff', accentColor: '#ffff00',
  appendages: ['wings'],
};

describe('DNA splicer', () => {
  it('splices traits from both parents', () => {
    const child = splice(parentA, parentB, { bodyShape: 'a', feet: 'b' }, () => 0.5);
    expect(child.bodyShape).toBe('blob');
    expect(child.feet).toBe('boots');
  });

  it('defaults to random 50/50', () => {
    const child = splice(parentA, parentB, {}, () => 0.1); // always 'a'
    expect(child.bodyShape).toBe('blob');
  });

  it('generates a name', () => {
    const child = splice(parentA, parentB);
    expect(child.name).toContain('Alpha');
    expect(child.name).toContain('Beta');
  });

  it('accent follows palette parent', () => {
    const child = splice(parentA, parentB, { palette: 'a' });
    expect(child.accentColor).toBe('#00ff00');
  });

  it('randomMask covers all traits', () => {
    const mask = randomMask(() => 0.5);
    for (const t of TRAITS) {
      expect(['a', 'b']).toContain(mask[t]);
    }
  });
});
