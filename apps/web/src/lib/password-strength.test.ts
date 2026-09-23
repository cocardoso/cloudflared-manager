import { describe, expect, it } from 'vitest';
import { passwordStrength } from './password-strength';

describe('passwordStrength', () => {
  it.each([
    ['', 0],
    ['abc', 1],
    ['password1', 1],
    ['111111111111', 1],
    ['abcdefgh1234', 2],
    ['Tr0ub4dor&3', 3],
    ['correct-horse-battery-staple', 4],
    ['Aa1!Aa1!Aa1!Bb2@', 4],
  ])('%s → %i', (pw, level) => {
    expect(passwordStrength(pw)).toBe(level);
  });
});
