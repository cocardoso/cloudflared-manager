import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_ACCOUNT, SECOND_ACCOUNT, startFakeCloudflare, type FakeCf } from '../../test/fake-cloudflare';
import { AccountDirectory } from './account-directory';
import { CfClient } from './client';

let cf: FakeCf;
let token: string;
let now: number;
let dir: AccountDirectory;
beforeEach(async () => {
  cf = await startFakeCloudflare();
  token = cf.token;
  now = 0;
  dir = new AccountDirectory(() => new CfClient({ token, baseUrl: cf.baseUrl }), { ttlMs: 60_000, now: () => now });
});
afterEach(() => cf.close());

const summary = (l: Awaited<ReturnType<AccountDirectory['list']>>) => l.map((a) => ({ name: a.name, zones: a.zones.map((z) => z.name) }));

describe('AccountDirectory', () => {
  it('lists every account with its zones, sorted by name', async () => {
    cf.state.addSecondAccount();
    expect(summary(await dir.list())).toEqual([
      { name: 'Home Lab', zones: ['example.com', 'other.dev'] },
      { name: 'Second Org', zones: ['second.net'] },
    ]);
  });
  it('adds accounts only visible through their zones', async () => {
    cf.state.addSecondAccount();
    cf.state.accounts = [FAKE_ACCOUNT];
    expect((await dir.list()).map((a) => a.id)).toEqual([FAKE_ACCOUNT.id, SECOND_ACCOUNT.id]);
    cf.state.accounts = [];
    expect((await new AccountDirectory(() => new CfClient({ token, baseUrl: cf.baseUrl })).list()).map((a) => a.name)).toEqual(['Home Lab', 'Second Org']);
  });
  it('keeps an account without zones', async () => {
    cf.state.accounts.push({ id: 'c'.repeat(32), name: 'Empty' });
    expect(summary(await dir.list())).toContainEqual({ name: 'Empty', zones: [] });
  });
  it('caches for the TTL and refetches after it or after invalidate()', async () => {
    await dir.list();
    const count = () => cf.state.requests.filter((r) => r === 'GET /zones').length;
    await dir.list();
    expect(count()).toBe(1);
    now = 60_001;
    await dir.list();
    expect(count()).toBe(2);
    dir.invalidate();
    await dir.list();
    expect(count()).toBe(3);
  });
  it('never serves another token from the cache', async () => {
    await dir.list();
    token = 'another-token-0123456789abcdefghij';
    await expect(dir.list()).rejects.toMatchObject({ code: 'CF_TOKEN_INVALID' });
  });
  it('get() finds an account or throws ACCOUNT_NOT_FOUND', async () => {
    expect((await dir.get(FAKE_ACCOUNT.id)).name).toBe('Home Lab');
    await expect(dir.get('c'.repeat(32))).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
  });
});
