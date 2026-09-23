import { describe, expect, it } from 'vitest';
import { appendCapped, levelMatches } from './log-stream';

const l = (n: number, level: 'info' | 'warn' | 'error' = 'info') => ({ time: String(n), level, message: `m${n}` });

describe('appendCapped', () => {
  it('keeps the newest lines up to cap', () => {
    expect(appendCapped([l(1), l(2)], [l(3), l(4)], 3).map((x) => x.message)).toEqual(['m2', 'm3', 'm4']);
  });
});

describe('levelMatches', () => {
  it('filters by minimum level', () => {
    expect(levelMatches(l(1, 'info'), 'warn')).toBe(false);
    expect(levelMatches(l(1, 'error'), 'warn')).toBe(true);
    expect(levelMatches(l(1, 'info'), 'all')).toBe(true);
  });
});
