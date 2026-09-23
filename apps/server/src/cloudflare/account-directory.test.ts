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
  it('lists only active accounts, while listAll() keeps every reachable one', async () => {
    cf.state.addSecondAccount();
    const active = new AccountDirectory(() => new CfClient({ token, baseUrl: cf.baseUrl }), { isEnabled: (id) => id === SECOND_ACCOUNT.id });
    expect((await active.list()).map((a) => a.name)).toEqual(['Second Org']);
    expect((await active.listAll()).map((a) => a.name)).toEqual(['Home Lab', 'Second Org']);
    await expect(active.get(FAKE_ACCOUNT.id)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
  it('reports every account it discovers', async () => {
    const seen: string[] = [];
    await new AccountDirectory(() => new CfClient({ token, baseUrl: cf.baseUrl }), { onDiscovered: (l) => seen.push(...l.map((a) => a.name)) }).list();
    expect(seen).toEqual(['Home Lab']);
  });
  it('falls back to zones when GET /accounts is forbidden', async () => {
    cf.state.failNext(/^\/accounts$/, 403, [{ code: 9109, message: 'Unauthorized to access requested resource' }]);
    expect((await dir.list()).map((a) => a.name)).toEqual(['Home Lab']);
  });
  it('remembers a failed discovery briefly instead of retrying on every call', async () => {
    const d = new AccountDirectory(() => new CfClient({ token, baseUrl: cf.baseUrl }), { now: () => now, failureTtlMs: 10_000 });
    cf.state.failNext(/^\/zones$/, 429, [{ code: 971, message: 'Please wait' }]);
    await expect(d.list()).rejects.toMatchObject({ code: 'CF_RATE_LIMITED' });
    await expect(d.list()).rejects.toMatchObject({ code: 'CF_RATE_LIMITED' });
    expect(cf.state.requests.filter((r) => r === 'GET /zones')).toHaveLength(1);
    now = 10_001;
    expect(await d.list()).toHaveLength(1);
  });
  it('survives a failing onDiscovered callback', async () => {
    const d = new AccountDirectory(() => new CfClient({ token, baseUrl: cf.baseUrl }), { onDiscovered: () => { throw new Error('disk full'); } });
    expect(await d.list()).toHaveLength(1);
  });
  it('reports a missing token as a rejected promise, never a synchronous throw', async () => {
    const d = new AccountDirectory(() => {
      throw new Error('not connected');
    });
    let p: Promise<unknown> | undefined;
    expect(() => (p = d.listAll())).not.toThrow();
    await expect(p).rejects.toThrow('not connected');
  });
});
