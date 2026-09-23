import { beforeEach, describe, expect, it } from 'vitest';
import { getStoredTheme } from './theme';

describe('theme', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to light', () => {
    expect(getStoredTheme()).toBe('light');
  });
  it('keeps a stored choice', () => {
    localStorage.setItem('tm.theme', 'dark');
    expect(getStoredTheme()).toBe('dark');
  });
});
