import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { startFakeCloudflare, type FakeCf } from '../../test/fake-cloudflare';
import { loadConfig } from '../config';
import { buildApp } from './app';
import { createContext } from './context';
import { FakeBackend } from '../services/fake-backend';

let cf: FakeCf;
let app: FastifyInstance;
let dir: string;

async function makeApp(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({ DATA_DIR: dir, ETC_DIR: join(dir, 'etc'), SERVICE_BACKEND: 'fake', CF_API_BASE: cf.baseUrl, ...extraEnv });
  return buildApp(createContext(config, { latestVersion: async () => '2026.10.0' }));
}

beforeEach(async () => {
  cf = await startFakeCloudflare();
  dir = mkdtempSync(join(tmpdir(), 'tm-'));
  app = await makeApp();
});
afterEach(async () => {
  await app.close();
  await cf.close();
});

const PW = 'a-very-long-password';
async function setupAdmin() {
  const r = await app.inject({ method: 'POST', url: '/api/setup/admin', payload: { username: 'admin', password: PW } });
  expect(r.statusCode).toBe(201);
  return { cookie: `tm_session=${r.cookies.find((c) => c.name === 'tm_session')!.value}` };
}
async function connect(headers: { cookie: string }) {
  const r = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers, payload: { token: cf.token } });
  expect(r.statusCode).toBe(200);
}

describe('setup and auth', () => {
  it('reports setup status and blocks second admin', async () => {
    expect((await app.inject('/api/setup/status')).json()).toEqual({ adminCreated: false, cloudflareConnected: false });
    await setupAdmin();
    const again = await app.inject({ method: 'POST', url: '/api/setup/admin', payload: { username: 'x', password: PW } });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('SETUP_ALREADY_DONE');
  });
  it('requires session for protected routes', async () => {
    const r = await app.inject('/api/tunnels');
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('UNAUTHORIZED');
  });
  it('logs in with correct password only and rate-limits', async () => {
    await setupAdmin();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } });
    expect(bad.json().code).toBe('INVALID_CREDENTIALS');
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: PW } });
    expect(ok.statusCode).toBe(204);
    const c = ok.cookies.find((x) => x.name === 'tm_session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    for (let i = 0; i < 4; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } });
    const limited = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: PW } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('RATE_LIMITED');
  });
  it('logout revokes the session', async () => {
    const h = await setupAdmin();
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: h })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/auth/me', headers: h })).statusCode).toBe(401);
  });
  it('changing password invalidates old sessions', async () => {
    const h = await setupAdmin();
    const r = await app.inject({ method: 'POST', url: '/api/auth/password', headers: h, payload: { currentPassword: PW, newPassword: 'another-long-password' } });
    expect(r.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/auth/me', headers: h })).statusCode).toBe(401);
    const fresh = `tm_session=${r.cookies.find((c) => c.name === 'tm_session')!.value}`;
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: fresh } })).json()).toEqual({ username: 'admin' });
  });
});

describe('cloudflare connection', () => {
  it('connects, never returns the token, exposes suffix and zones', async () => {
    const h = await setupAdmin();
    await connect(h);
    const s = (await app.inject({ url: '/api/cloudflare/status', headers: h })).json();
    expect(s).toMatchObject({ connected: true, accountName: 'Home Lab', tokenSuffix: cf.token.slice(-4) });
    expect(JSON.stringify(s)).not.toContain(cf.token);
    expect(s.zones.map((z: { name: string }) => z.name)).toEqual(['example.com', 'other.dev']);
    expect((await app.inject('/api/setup/status')).json()).toEqual({ adminCreated: true, cloudflareConnected: true });
  });
  it('asks for account selection when token has several accounts', async () => {
    const h = await setupAdmin();
    cf.state.accounts.push({ id: 'b'.repeat(32), name: 'Work' });
    cf.state.zones.push({ id: `${'y'.repeat(31)}3`, name: 'work.io', status: 'active', account: { id: 'b'.repeat(32), name: 'Work' } });
    const r = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers: h, payload: { token: cf.token } });
    expect(r.statusCode).toBe(409);
    expect(r.json().details.accounts).toHaveLength(2);
    const ok = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers: h, payload: { token: cf.token, accountId: 'b'.repeat(32) } });
    expect(ok.json().accountName).toBe('Work');
  });
  it('discovers the account from zones when /accounts comes back empty', async () => {
    // Tokens without "Account Settings: Read" get an empty account list.
    const h = await setupAdmin();
    cf.state.accounts = [];
    const r = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers: h, payload: { token: cf.token } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ connected: true, accountName: 'Home Lab' });
  });
  it('rejects invalid token', async () => {
    const h = await setupAdmin();
    const r = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers: h, payload: { token: 'x'.repeat(40) } });
    expect(r.json().code).toBe('CF_TOKEN_INVALID');
  });
  it('names the missing permission', async () => {
    const h = await setupAdmin();
    cf.state.failNext(/cfd_tunnel$/, 403, [{ code: 10000, message: 'Authentication error' }]);
    const r = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers: h, payload: { token: cf.token } });
    expect(r.json()).toMatchObject({
      code: 'CF_PERMISSION_MISSING',
      details: { permission: 'Account: Cloudflare Tunnel: Edit', accountName: 'Home Lab', cloudflare: [{ code: 10000, message: 'Authentication error' }] },
    });
  });
  it('returns CF_NOT_CONNECTED before token is set', async () => {
    const h = await setupAdmin();
    expect((await app.inject({ url: '/api/tunnels', headers: h })).json().code).toBe('CF_NOT_CONNECTED');
  });
});

describe('tunnels API', () => {
  it('full lifecycle', async () => {
    const h = await setupAdmin();
    await connect(h);
    const created = await app.inject({ method: 'POST', url: '/api/tunnels', headers: h, payload: { name: 'home' } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const detail = (await app.inject({ url: `/api/tunnels/${id}`, headers: h })).json();
    const put = await app.inject({
      method: 'PUT', url: `/api/tunnels/${id}/routes`, headers: h,
      payload: { version: detail.configVersion, routes: [{ hostname: 'ha.example.com', service: 'http://10.0.0.5:8123' }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().routes).toHaveLength(1);
    const stale = await app.inject({ method: 'PUT', url: `/api/tunnels/${id}/routes`, headers: h, payload: { version: 0, routes: [] } });
    expect(stale.statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/tunnels/${id}/stop`, headers: h })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/tunnels/${id}/events`, headers: h })).json()[0].type).toBe('stopped');
    expect((await app.inject({ url: `/api/tunnels/${id}/logs`, headers: h })).json().length).toBeGreaterThan(0);
    expect((await app.inject({ method: 'DELETE', url: `/api/tunnels/${id}`, headers: h })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/tunnels', headers: h })).json()).toEqual([]);
  });
  it('validates ids and bodies', async () => {
    const h = await setupAdmin();
    await connect(h);
    expect((await app.inject({ url: '/api/tunnels/..%2Fetc', headers: h })).json().code).toBe('VALIDATION_ERROR');
    expect((await app.inject({ method: 'POST', url: '/api/tunnels', headers: h, payload: { name: '' } })).json().code).toBe('VALIDATION_ERROR');
  });
  it('tests origins', async () => {
    const h = await setupAdmin();
    const r = await app.inject({ method: 'POST', url: '/api/tools/test-origin', headers: h, payload: { service: 'http_status:404' } });
    expect(r.json().reachable).toBe(true);
  });
  it('reports and updates cloudflared version info', async () => {
    const h = await setupAdmin();
    expect((await app.inject({ url: '/api/system/cloudflared', headers: h })).json())
      .toEqual({ installed: '2026.9.1', latest: '2026.10.0', updateAvailable: true, canSelfUpdate: true });
    expect((await app.inject({ method: 'POST', url: '/api/system/cloudflared/update', headers: h })).statusCode).toBe(200);
  });
  it('refuses in-place cloudflared updates when the backend cannot self-update', async () => {
    await app.close();
    const config = loadConfig({ DATA_DIR: dir, ETC_DIR: join(dir, 'etc'), SERVICE_BACKEND: 'fake', CF_API_BASE: cf.baseUrl });
    const backend = new FakeBackend(join(dir, 'etc'));
    Object.assign(backend, { canSelfUpdate: false });
    app = await buildApp(createContext(config, { backend, latestVersion: async () => '2026.10.0' }));
    const h = await setupAdmin();
    expect((await app.inject({ url: '/api/system/cloudflared', headers: h })).json().canSelfUpdate).toBe(false);
    const r = await app.inject({ method: 'POST', url: '/api/system/cloudflared/update', headers: h });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CLOUDFLARED_UPDATE_UNSUPPORTED');
    expect(backend.calls).not.toContain('upgrade');
  });
  it('exports backup without token and imports it back', async () => {
    const h = await setupAdmin();
    await connect(h);
    const id = (await app.inject({ method: 'POST', url: '/api/tunnels', headers: h, payload: { name: 'home' } })).json().id;
    const b = await app.inject({ url: '/api/backup', headers: h });
    expect(b.json().tunnels).toHaveLength(1);
    expect(b.body).not.toContain(cf.token);
    const backup = b.json();
    backup.tunnels[0].toleranceMinutes = 9;
    expect((await app.inject({ method: 'POST', url: '/api/backup', headers: h, payload: backup })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/tunnels/${id}`, headers: h })).json().settings.toleranceMinutes).toBe(9);
  });
});

describe('static web', () => {
  it('serves SPA fallback but 404s unknown API routes', async () => {
    const web = join(dir, 'web');
    mkdirSync(web);
    writeFileSync(join(web, 'index.html'), '<div id="root"></div>');
    await app.close();
    app = await makeApp({ WEB_DIST: web });
    expect((await app.inject('/tunnels/abc')).body).toContain('id="root"');
    const h = await setupAdmin();
    expect((await app.inject({ url: '/api/nope', headers: h })).statusCode).toBe(404);
  });
  it('returns 404 for missing static assets instead of the SPA shell', async () => {
    const web = join(dir, 'web');
    mkdirSync(web);
    writeFileSync(join(web, 'index.html'), '<div id="root"></div>');
    await app.close();
    app = await makeApp({ WEB_DIST: web });
    const r = await app.inject('/assets/index-deadbeef.js');
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('id="root"');
  });
});
