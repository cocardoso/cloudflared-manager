import { describe, expect, it } from 'vitest';
import { statusRefetchInterval } from './hooks';

describe('statusRefetchInterval', () => {
  it('polls while connected without any account, and not otherwise', () => {
    expect(statusRefetchInterval({ connected: true, tokenSuffix: 'x', lastAccountId: null, accounts: [] })).toBe(10_000);
    expect(statusRefetchInterval({ connected: true, tokenSuffix: 'x', lastAccountId: null, accounts: [{ id: 'a', name: 'A', enabled: true, zones: [] }] })).toBe(false);
    expect(statusRefetchInterval({ connected: false, tokenSuffix: null, lastAccountId: null, accounts: [] })).toBe(false);
    expect(statusRefetchInterval(undefined)).toBe(false);
  });
});
